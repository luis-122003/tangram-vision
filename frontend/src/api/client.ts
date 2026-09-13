import type {
  PredictRequest, PredictResponse, SessionRecord, StudentStats, SessionRow,
  Figure, Student, StudentCreated, User,
} from "../types";
import {
  actualizarAcceso, cabeceraAuth, cerrarSesion, iniciarSesion,
  obtenerRefresco, sesionExpirada,
} from "./session";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Página de resultados que devuelven los listados del backend. */
export interface Pagina<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Refresco del token ────────────────────────────────────────────────────────
/**
 * Una sola renovación en vuelo a la vez.
 *
 * Sin esto, si tres peticiones reciben 401 al mismo tiempo se lanzarían tres
 * refrescos y dos de ellos trabajarían con un token ya reemplazado.
 */
let refrescoEnCurso: Promise<boolean> | null = null;

async function refrescarToken(): Promise<boolean> {
  const refresh = obtenerRefresco();
  if (!refresh) return false;

  refrescoEnCurso ??= (async () => {
    try {
      const res = await fetch(`${API}/token/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      actualizarAcceso(data.access_token);
      return true;
    } catch {
      return false;
    } finally {
      refrescoEnCurso = null;
    }
  })();

  return refrescoEnCurso;
}

// ─── Helper ────────────────────────────────────────────────────────────────────
/**
 * Tope de espera de una petición corriente. `/predict` es la excepción y pide
 * el suyo: el backend le da 40 s al servicio de visión, así que rendirse antes
 * cambiaría el mensaje que el niño puede entender por un error de red.
 */
const ESPERA_MS = 15_000;
const ESPERA_PREDICT_MS = 50_000;

/**
 * Traduce el fallo de `fetch` a algo que se pueda leer en pantalla.
 *
 * Un `TypeError: Failed to fetch` es lo que se ve cuando el servidor está
 * apagado, y ese literal en inglés acababa impreso tal cual en el panel de
 * resultados y en el catálogo. Aquí se convierte una vez, y todas las pantallas
 * heredan el mensaje.
 */
function errorDeRed(e: unknown): Error {
  if (e instanceof DOMException && e.name === "AbortError") {
    return new Error(
      "El servidor tardó demasiado en responder. Comprueba que esté encendido e inténtalo de nuevo.",
    );
  }
  if (e instanceof TypeError) {
    return new Error(
      `No se pudo conectar con el servidor (${API}). Comprueba que esté encendido y que estés en la misma red.`,
    );
  }
  return e instanceof Error ? e : new Error("Error desconocido");
}

async function apiFetch<T>(
  path: string, options?: RequestInit, reintento = false, esperaMs = ESPERA_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      // Sin tope, una caída del servicio de visión dejaba la web esperando
      // indefinidamente con una barra de progreso que ya no avanzaba.
      signal: AbortSignal.timeout(esperaMs),
      headers: {
        "Content-Type": "application/json",
        ...cabeceraAuth(),
        ...options?.headers,
      },
    });
  } catch (e) {
    throw errorDeRed(e);
  }

  if (res.status === 401 && !reintento) {
    // El token de acceso dura una hora, así que esto pasa a diario a mitad de
    // clase. Se renueva y se repite la petición sin que el niño note nada.
    if (await refrescarToken()) return apiFetch<T>(path, options, true, esperaMs);
    const err = await res.json().catch(() => ({ detail: null }));
    // El backend explica por qué caducó ("Tu sesión expiró..."); ese texto es
    // el que ve el estudiante al volver al login, así que se propaga.
    sesionExpirada(err.detail ?? undefined);
    throw new Error(err.detail ?? "Tu sesión expiró. Vuelve a iniciar sesión.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 401) sesionExpirada(err.detail ?? undefined);
    throw new Error(err.detail ?? "Error del servidor");
  }
  return res.json();
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type:   string;
  expires_in:   number;
  role:         string;
  name:         string;
  id:           number;
  /** La cuenta sigue con la clave temporal que le puso el docente. */
  must_change_password?: boolean;
}

/**
 * Inicia sesión y guarda los tokens.
 *
 * Las credenciales viajan como formulario porque así las espera `/token`
 * (herencia del esquema OAuth2 del backend anterior, conservada para no
 * obligar a publicar la app móvil a la vez que el servidor).
 */
export async function login(email: string, password: string): Promise<User> {
  const body = new URLSearchParams({ username: email, password });
  let res: Response;
  try {
    res = await fetch(`${API}/token`, {
      method: "POST", body, signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (e) {
    throw errorDeRed(e);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Credenciales incorrectas" }));
    throw new Error(err.detail ?? "Credenciales incorrectas");
  }
  const data: LoginResponse = await res.json();

  /**
   * Un estudiante con la clave temporal todavía puesta no entra por aquí.
   *
   * No es una restricción arbitraria: el sitio donde se cambia la clave es la
   * app del celular —es la que tiene el teclado de cuatro dígitos y la pantalla
   * de activación—, y esta web no tiene ninguna forma de cambiarla. Dejarlo
   * entrar sería darle un catálogo en el que puede elegir figura, armarla y
   * fotografiarla para recibir un 403 al final, sin una sola palabra que
   * explique por qué. Mejor decírselo antes de empezar.
   *
   * La sesión **no se abre**: se lanza antes de `iniciarSesion`, así que no
   * queda ningún token guardado de un intento que no prosperó.
   */
  if (data.must_change_password === true && data.role === "student") {
    throw new Error(
      "Tu clave todavía es la temporal que te dio tu profesor. Ábrela en la " +
      "app del celular para cambiarla; después podrás entrar también aquí.",
    );
  }

  const usuario: User = {
    id:    data.id,
    name:  data.name,
    email,
    role:  data.role as User["role"],
  };
  iniciarSesion(data.access_token, data.refresh_token, usuario);
  return usuario;
}

/** Cierra la sesión en todos los dispositivos. */
export async function logout(): Promise<void> {
  try {
    await apiFetch("/logout", { method: "POST" });
  } catch {
    // Si el servidor no responde, la sesión local se cierra igual: es
    // preferible quedarse fuera aquí a seguir dentro por un fallo de red.
  }
  cerrarSesion();
}

// ─── Catálogo de figuras (viene de MySQL) ──────────────────────────────────────
export async function getFigures(): Promise<Figure[]> {
  return apiFetch<Figure[]>("/figures");
}

// ─── Predicción ────────────────────────────────────────────────────────────────
export async function predict(payload: PredictRequest): Promise<PredictResponse> {
  return apiFetch<PredictResponse>("/predict", {
    method: "POST",
    body:   JSON.stringify(payload),
  }, false, ESPERA_PREDICT_MS);
}

// ─── Sesiones ──────────────────────────────────────────────────────────────────
export async function saveSession(record: SessionRecord): Promise<void> {
  await apiFetch("/sessions", {
    method: "POST",
    body:   JSON.stringify({
      figure_id:    record.figureId,
      match:        record.match,
      iou_score:    record.iou,
      time_seconds: record.time,
      errors:       record.errors,
    }),
  });
}

/**
 * Historial completo del curso. Solo lo puede pedir el docente, y llega
 * paginado: sin tope, el dashboard tendría que descifrar y descargar el curso
 * entero de una vez.
 */
export async function getSessions(limit = 100, offset = 0): Promise<Pagina<SessionRow>> {
  return apiFetch<Pagina<SessionRow>>(`/sessions?limit=${limit}&offset=${offset}`);
}

/** Historial de un estudiante: el suyo propio, o cualquiera si es el docente. */
export async function getStudentSessions(
  studentId: number, limit = 100, offset = 0,
): Promise<Pagina<SessionRow>> {
  return apiFetch<Pagina<SessionRow>>(
    `/students/${studentId}/sessions?limit=${limit}&offset=${offset}`,
  );
}

/**
 * Cifras de rendimiento de un estudiante. **Solo el docente**: a un estudiante
 * le responde 403, aunque pregunte por sí mismo.
 *
 * Dejó de usarse en la pantalla de inicio del estudiante cuando esas tarjetas se
 * retiraron; el progreso de las actividades se consulta desde el panel.
 */
export async function getStudentStats(studentId: number): Promise<StudentStats> {
  return apiFetch<StudentStats>(`/students/${studentId}/stats`);
}

// ─── Gestión de estudiantes (solo docente) ─────────────────────────────────────
/**
 * Estas cinco llamadas responden 403 a un estudiante. No es solo una cuestión
 * de permisos: son los datos personales de todo el curso, y el backend los
 * comprueba contra la base en cada petición, no contra lo que diga el token.
 */
export async function getStudents(): Promise<Student[]> {
  return apiFetch<Student[]>("/students");
}

/**
 * Da de alta un estudiante y devuelve la clave con la que va a entrar.
 *
 * `password` es opcional y decide el régimen de la cuenta: si el docente la
 * escribe, esa es ya la contraseña del estudiante; si la omite, el servidor
 * genera cuatro dígitos y el niño tendrá que cambiarlos la primera vez.
 *
 * En los dos casos la clave viene en la respuesta y **no se puede volver a
 * pedir**: el servidor guarda solo su hash. Quien llame tiene que enseñarla
 * hasta que el docente la descarte a propósito, no en un aviso que se desvanezca
 * solo. Se envía omitiendo el campo —no como cadena vacía— porque el esquema del
 * backend valida un mínimo de 4 caracteres y un `""` sería un 422.
 */
export async function createStudent(
  name: string, email: string, password?: string,
): Promise<StudentCreated> {
  return apiFetch<StudentCreated>("/students", {
    method: "POST",
    body:   JSON.stringify(password ? { name, email, password } : { name, email }),
  });
}

export async function updateStudent(
  id: number, cambios: { name?: string; email?: string },
): Promise<{ student: Student }> {
  return apiFetch<{ student: Student }>(`/students/${id}`, {
    method: "PATCH",
    body:   JSON.stringify(cambios),
  });
}

/**
 * Genera una clave temporal nueva. Para cuando un niño olvida la suya.
 *
 * Cierra además las sesiones que ese estudiante tuviera abiertas: si la clave
 * se resetea porque alguien más entró en la cuenta, dejar viva la sesión de ese
 * alguien vaciaría el gesto de sentido.
 */
export async function resetStudentPassword(id: number): Promise<StudentCreated> {
  return apiFetch<StudentCreated>(`/students/${id}/password/reset`, { method: "POST" });
}

/** Da de baja al estudiante **y borra todos sus intentos**. No tiene vuelta atrás. */
export async function deleteStudent(id: number): Promise<void> {
  await apiFetch(`/students/${id}`, { method: "DELETE" });
}

// ─── Health check ──────────────────────────────────────────────────────────────
export interface HealthStatus {
  status:        string;
  yolo_loaded:   boolean;
  /** El validador geométrico no tiene pesos que cargar: siempre está listo. */
  validator_ready: boolean;
  db_connected:  boolean;
  /** ¿Responde el servicio de visión? Distingue su caída de la de MySQL. */
  vision_connected?: boolean;
  /** Acierto mínimo que exige el servidor para dar una figura por correcta. */
  match_threshold?: number;
}

/** Queda sin autenticar: sirve para diagnosticar la conexión antes del login. */
export async function healthCheck(): Promise<HealthStatus> {
  return apiFetch<HealthStatus>("/health");
}
