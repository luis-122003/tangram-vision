import { getApiUrl } from "./config";
import {
  actualizarAcceso, cabeceraAuth, cerrarSesion, iniciarSesion,
  obtenerAcceso, obtenerRefresco, sesionExpirada,
} from "./session";
import type { Figure, PredictResponse, Session, StudentStats, User } from "./types";

/** Página de resultados que devuelven los listados del backend. */
export interface Pagina<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * La URL del backend es dinámica: se configura desde la pantalla de ajustes
 * y se guarda en el teléfono (ver ./config.ts). En el celular "localhost"
 * apunta al propio celular, no a la PC, por eso hay que usar la IP de la PC
 * en la red WiFi (ej: http://192.168.1.105:8000).
 */

/**
 * Tiempo máximo de espera. `/predict` sube una foto y corre el detector, pero
 * sin tope el estudiante se queda mirando el spinner para siempre si el
 * servidor acepta la conexión y luego no responde.
 */
const TIMEOUT_MS = 45_000;

/**
 * Tope propio del ingreso, mucho más corto que el de las demás peticiones.
 *
 * Entrar es lo primero que se hace y es lo único que no puede quedarse colgado.
 * Con una IP enrutable pero equivocada —la de otra máquina de la misma red— el
 * paquete se descarta sin contestar y el socket espera el tiempo del sistema:
 * uno o dos minutos de spinner. Doce segundos sobran para un `POST /token` en
 * la red del aula, y quien se equivocó de dirección se entera a tiempo de
 * corregirla en Ajustes.
 */
const LOGIN_TIMEOUT_MS = 12_000;

/**
 * Por debajo de este tiempo, el fallo volvió sin que hubiera nada que esperar.
 *
 * Es lo único que distingue «sin conexión» de «dirección equivocada» sin meter
 * NetInfo, que no está instalado: `fetch` dice «Network request failed» en los
 * dos casos. Con el WiFi apagado Android sabe que no hay ruta y falla al
 * instante; con WiFi y una IP que no contesta, el intento se queda esperando.
 * Un fallo instantáneo también lo produce el backend apagado —el sistema
 * responde que ahí no escucha nadie—, así que el mensaje nombra las dos causas
 * en vez de afirmar una: mandar a revisar lo que no es fue justo el problema.
 */
const FALLO_INMEDIATO_MS = 1200;

/** FastAPI devuelve `detail` como texto o, en un 422, como lista de objetos. */
function detailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    if (first?.msg) return first.msg;
  }
  return fallback;
}

/**
 * Convierte un fallo de red en un mensaje que diga qué revisar. `inicio` es el
 * instante en que se lanzó la petición: cuánto tardó en fallar es el dato que
 * separa las dos averías (ver `FALLO_INMEDIATO_MS`).
 */
function errorDeRed(e: unknown, inicio: number): Error {
  if (e instanceof Error && e.name === "AbortError") {
    return new Error("El servidor tardó demasiado en responder. Inténtalo otra vez.");
  }
  const url = getApiUrl();
  if (Date.now() - inicio < FALLO_INMEDIATO_MS) {
    return new Error(
      `El teléfono no llegó ni a intentarlo con ${url}: el fallo volvió al ` +
      `instante. Casi siempre es el WiFi apagado, o que el backend no esté ` +
      `corriendo en esa dirección.`
    );
  }
  return new Error(
    `No se pudo conectar con el servidor (${url}). Revisa la dirección en ` +
    `Ajustes, que estés en el mismo WiFi que la PC y que el backend esté corriendo.`
  );
}

/**
 * Una sola renovación de token en vuelo a la vez.
 *
 * El catálogo lanza tres peticiones juntas al abrirse; sin esto, las tres
 * pedirían un token nuevo y dos trabajarían con uno ya reemplazado.
 */
let refrescoEnCurso: Promise<boolean> | null = null;

async function refrescarToken(): Promise<boolean> {
  const refresh = obtenerRefresco();
  if (!refresh) return false;

  refrescoEnCurso ??= (async () => {
    try {
      const res = await fetch(`${getApiUrl()}/token/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      await actualizarAcceso(data.access_token);
      return true;
    } catch {
      return false;
    } finally {
      refrescoEnCurso = null;
    }
  })();

  return refrescoEnCurso;
}

interface OpcionesFetch {
  /** Es la repetición de una petición tras renovar el token. */
  reintento?: boolean;
  /**
   * En esta ruta, un 401 significa «la clave que acabas de escribir no es esa»,
   * no «tu sesión caducó».
   *
   * Lo pide `/password`: el servidor rechaza con 401 la contraseña actual
   * equivocada, y con el trato de siempre —cerrar la sesión ante cualquier 401—
   * un niño que se equivocaba de dígito acababa **expulsado al ingreso**, sin
   * llegar a ver el mensaje, porque su pantalla se desmontaba con él. Se sigue
   * intentando renovar el token, que es inofensivo; lo que no se hace es dar la
   * sesión por muerta.
   */
  el401EsDeLaClave?: boolean;
}

async function apiFetch<T>(
  path: string, options?: RequestInit, opciones: OpcionesFetch = {},
): Promise<T> {
  const { reintento = false, el401EsDeLaClave = false } = opciones;
  const controller = new AbortController();
  // El tope tiene que cubrir también la lectura del cuerpo, no solo abrir la
  // conexión: un servidor que manda las cabeceras y se cuelga a mitad del JSON
  // dejaba a `res.json()` esperando sin ningún límite, porque la cancelación
  // vivía en el `finally` del `fetch`. Por eso el `try` envuelve todo.
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const inicio = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(`${getApiUrl()}${path}`, {
        signal: controller.signal,
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...cabeceraAuth(),
          ...options?.headers,
        },
      });
    } catch (e) {
      throw errorDeRed(e, inicio);
    }

    if (res.status === 401 && !reintento) {
      // El token de acceso dura una hora, así que esto pasa a diario a media
      // clase. Se renueva y se repite la petición sin que el niño note nada.
      if (await refrescarToken()) {
        return await apiFetch<T>(path, options, { ...opciones, reintento: true });
      }
      if (!el401EsDeLaClave) sesionExpirada();
    }

    if (!res.ok) {
      if (res.status === 401 && !el401EsDeLaClave) sesionExpirada();
      const err = await res.json().catch(() => null);
      throw new Error(detailToMessage(err?.detail, `El servidor respondió ${res.status}`));
    }

    try {
      return await res.json() as T;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error("El servidor cortó la respuesta a medias. Inténtalo otra vez.");
      }
      throw new Error("El servidor respondió algo que no se pudo leer.");
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
export interface LoginResponse {
  access_token:  string;
  refresh_token: string;
  token_type:    string;
  expires_in:    number;
  role:          string;
  name:          string;
  id:            number;
}

/**
 * Entra y guarda el token de sesión en el teléfono.
 *
 * Las credenciales viajan como formulario porque así las espera `/token`: el
 * PIN de cuatro dígitos que teclea el niño va como `password`.
 *
 * Lleva su propio tope de espera, más corto que el de las demás peticiones
 * (ver `LOGIN_TIMEOUT_MS`): sin él, una dirección equivocada dejaba el spinner
 * girando hasta que se rendía el sistema operativo, un par de minutos después.
 */
export async function login(email: string, password: string): Promise<User> {
  const body = new URLSearchParams({ username: email, password });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  const inicio = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(`${getApiUrl()}/token`, {
        method:  "POST",
        signal:  controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    body.toString(),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(
          `El servidor (${getApiUrl()}) no contestó. Comprueba la dirección en ` +
          `Ajustes: si apunta a una máquina que no es, el intento se queda ` +
          `esperando una respuesta que no llega.`
        );
      }
      throw errorDeRed(e, inicio);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(detailToMessage(err?.detail, "Credenciales incorrectas"));
    }
    const data: LoginResponse = await res.json();
    const usuario: User = {
      id:    data.id,
      name:  data.name,
      email,
      role:  data.role as User["role"],
    };
    await iniciarSesion(data.access_token, data.refresh_token, usuario);
    return usuario;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cierra la sesión en todos los dispositivos.
 *
 * Avisa al servidor para que invalide también el token de refresco: sin eso,
 * salir solo borraría la copia del teléfono y el token seguiría valiendo hasta
 * caducar. Importa en un aula donde los teléfonos se comparten.
 *
 * El orden no es indiferente: primero se borra lo del teléfono y después se
 * avisa al servidor, con el token que se guardó antes de borrarlo. Al revés,
 * con el backend inalcanzable había hasta 45 segundos en los que el token
 * seguía en el almacenamiento, y matar la app en esa ventana dejaba que
 * `restaurarSesion()` reabriera la sesión del que acababa de salir.
 */
export async function logout(): Promise<void> {
  const token = obtenerAcceso();
  await cerrarSesion();
  if (!token) return;
  try {
    // La cabecera va explícita: `cabeceraAuth()` ya devuelve vacío porque la
    // sesión local está cerrada, que es justo lo que se quería.
    await apiFetch("/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Si el servidor no responde, la sesión local ya quedó cerrada igualmente.
  }
}

/**
 * Cambia la clave del estudiante que tiene la sesión abierta.
 *
 * Se pide la actual aunque ya esté dentro, y lo exige el servidor: si alguien
 * deja el teléfono desbloqueado sobre el pupitre, su compañero no debe poder
 * quedarse con la cuenta en dos toques.
 *
 * **Al terminar, la sesión deja de valer.** El servidor revoca todos los tokens
 * del usuario —cambiar la clave suele querer decir «sospecho que alguien más
 * entró», y dejar vivos los que ya tuviera ese alguien vaciaría el gesto de
 * sentido—, así que aquí se cierra también la sesión del teléfono. Quien llame
 * tiene que llevar al estudiante de vuelta al ingreso: cualquier otra petición
 * respondería 401.
 */
export async function changePassword(actual: string, nueva: string): Promise<void> {
  await apiFetch(
    "/password",
    {
      method: "POST",
      body: JSON.stringify({ current_password: actual, new_password: nueva }),
    },
    // Aquí el 401 es «esa no es tu clave de ahora», y no puede acabar echando al
    // estudiante al ingreso: ver `el401EsDeLaClave`.
    { el401EsDeLaClave: true },
  );
  await cerrarSesion();
}

// ─── Catálogo de figuras (viene de MySQL) ──────────────────────────────────────
export async function getFigures(): Promise<Figure[]> {
  return apiFetch<Figure[]>("/figures");
}

// ─── Validación de la foto ─────────────────────────────────────────────────────
export async function predict(
  imageBase64: string, figureSlug: string, studentId: number,
  /**
   * Cuadro de encuadre sobre la foto, [x, y, ancho, alto] normalizados. El
   * servidor recorta ahí antes de buscar las fichas: las figuras armadas son
   * grandes y la foto se toma de lejos, así que sin recortar cada ficha llega al
   * detector con muy pocos píxeles. Si se omite, se analiza la foto completa.
   */
  crop?: [number, number, number, number],
): Promise<PredictResponse> {
  return apiFetch<PredictResponse>("/predict", {
    method: "POST",
    body: JSON.stringify({
      image_b64:  imageBase64,
      figure_id:  figureSlug,
      student_id: studentId,
      crop,
    }),
  });
}

// ─── Sesiones y estadísticas ───────────────────────────────────────────────────
export async function saveSession(record: {
  studentId: number; figureSlug: string; match: boolean;
  iou: number; timeSeconds: number; errors: number;
}): Promise<void> {
  // `student_id` ya no se envía: el servidor lo toma del token. Si se mandara,
  // lo ignoraría igualmente, y aceptarlo permitiría anotar intentos a nombre de
  // un compañero.
  await apiFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({
      figure_id:    record.figureSlug,
      match:        record.match,
      iou_score:    record.iou,
      time_seconds: record.timeSeconds,
      errors:       record.errors,
    }),
  });
}

export async function getStudentStats(studentId: number): Promise<StudentStats> {
  return apiFetch<StudentStats>(`/students/${studentId}/stats`);
}

/**
 * Los intentos de un estudiante, del más reciente al más viejo.
 *
 * Es `/students/{id}/sessions` y no `/sessions`: aquel listado trae las sesiones
 * de todo el curso y es del docente. Aquí solo se piden las propias, que es lo
 * único que el teléfono necesita —y lo único que debería ver—.
 *
 * El servidor recorta el `limit` a 100 aunque se le pida más.
 */
export async function getStudentSessions(
  studentId: number, limit = 20, offset = 0,
): Promise<Pagina<Session>> {
  return apiFetch<Pagina<Session>>(
    `/students/${studentId}/sessions?limit=${limit}&offset=${offset}`,
  );
}

/**
 * Figuras que el estudiante ya logró alguna vez, para marcarlas en el catálogo.
 *
 * Antes esto se resolvía pidiendo `/sessions` —todas las sesiones de todos los
 * estudiantes— y filtrando en el teléfono. Además de traer al aparato datos de
 * los compañeros que no le hacen falta, ese listado es ahora del docente. El
 * backend expone `/students/{id}/sessions`, así que se piden solo las propias.
 *
 * LIMITACIÓN CONOCIDA. Solo se mira la primera página, y el backend recorta el
 * `limit` a 100 aunque se le pida más. Con 100 intentos o menos —un curso
 * entero de uso normal— se ven todas; a partir de ahí las marcas de las figuras
 * logradas hace tiempo desaparecen del catálogo, porque las sesiones vienen de
 * la más reciente a la más vieja y las antiguas quedan fuera de la página. La
 * figura sigue estando lograda en la base de datos y las estadísticas del
 * docente no cambian: lo único que se pierde es el sello verde.
 *
 * No se arregla paginando desde aquí —serían N peticiones al abrir el
 * catálogo—: lo que hace falta es un endpoint que devuelva directamente las
 * figuras distintas ya logradas, y ese contrato lo decide el backend.
 */
export async function getSolvedFigures(studentId: number): Promise<Set<string>> {
  const pagina = await getStudentSessions(studentId, 100);
  const solved = new Set<string>();
  for (const row of pagina.rows) {
    if (row.match_result) solved.add(row.figure_id);
  }
  return solved;
}

// ─── Diagnóstico de conexión ───────────────────────────────────────────────────
/** El servidor contestó, pero con un código de error: no es un fallo de red. */
class HealthError extends Error {}

export interface HealthStatus {
  status:       string;
  yolo_loaded:  boolean;
  /**
   * El validador geométrico no tiene pesos que cargar, así que siempre está
   * listo. Se informa igual para que la pantalla de ajustes muestre las dos
   * etapas del pipeline: detectar las fichas y revisar el armado.
   */
  validator_ready: boolean;
  db_connected: boolean;
  /** Acierto mínimo que exige el servidor para dar una figura por correcta. */
  match_threshold?: number;
}

/**
 * Prueba la conexión contra una URL concreta (sin guardarla todavía).
 * Lo usa la pantalla de ajustes para validar antes de aceptar la dirección.
 */
export async function testConnection(url: string): Promise<HealthStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    // Un 404 o un 500 significan que el servidor SÍ está ahí: ese diagnóstico
    // no puede acabar disfrazado de "no hay red", que es justo lo que esta
    // pantalla existe para distinguir.
    if (!res.ok) {
      throw new HealthError(
        `El servidor respondió ${res.status}. ¿Es la dirección del backend de Tangram?`
      );
    }
    return await res.json();
  } catch (e) {
    if (e instanceof HealthError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("El servidor no respondió (tiempo agotado)");
    }
    throw new Error("No se pudo conectar. Revisa la dirección, el wifi y el firewall.");
  } finally {
    clearTimeout(timer);
  }
}
