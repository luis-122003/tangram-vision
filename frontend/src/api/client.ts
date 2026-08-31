import type { PredictRequest, PredictResponse, SessionRecord, StudentStats, SessionRow, Figure, User } from "../types";
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

export async function getStudentStats(studentId: number): Promise<StudentStats> {
  return apiFetch<StudentStats>(`/students/${studentId}/stats`);
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
