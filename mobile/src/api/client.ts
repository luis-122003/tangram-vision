import { candidatasApiUrl, getApiUrl, setApiUrl } from "./config";
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

/**
 * El teléfono no consiguió hablar con el servidor: ni WiFi, ni backend, ni la
 * dirección correcta. Es un tipo propio y no un `Error` cualquiera porque el
 * ingreso reacciona a él —busca el servidor en las otras direcciones conocidas
 * y reintenta— y no puede hacer eso con un «credenciales incorrectas».
 */
export class ErrorDeRed extends Error {}

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
function errorDeRed(e: unknown, inicio: number): ErrorDeRed {
  if (e instanceof Error && e.name === "AbortError") {
    return new ErrorDeRed("El servidor tardó demasiado en responder. Inténtalo otra vez.");
  }
  const url = getApiUrl();
  if (Date.now() - inicio < FALLO_INMEDIATO_MS) {
    return new ErrorDeRed(
      `El teléfono no llegó ni a intentarlo con ${url}: el fallo volvió al ` +
      `instante. Casi siempre es el WiFi apagado, o que el backend no esté ` +
      `corriendo en esa dirección.`
    );
  }
  return new ErrorDeRed(
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
}

async function apiFetch<T>(
  path: string, options?: RequestInit, opciones: OpcionesFetch = {},
): Promise<T> {
  const { reintento = false } = opciones;
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
      sesionExpirada();
    }

    if (!res.ok) {
      if (res.status === 401) sesionExpirada();
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
  /** La cuenta todavía tiene la clave temporal del docente. */
  must_change_password?: boolean;
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
        throw new ErrorDeRed(
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
      // `=== true` y no un truthy: un backend viejo no manda el campo, y
      // `undefined` tiene que leerse como «no hay nada que cambiar» en vez de
      // dejar a toda la clase atrapada en la pantalla de la clave.
      must_change_password: data.must_change_password === true,
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
/**
 * Una clave actual equivocada llega como **422**, no como 401.
 *
 * Es lo que permite que esta llamada no necesite ningún trato especial: el 401
 * de aquí significa lo mismo que en cualquier otra ruta —la sesión ya no vale—
 * y se atiende igual, cerrándola. Cuando el servidor devolvía 401 para las dos
 * cosas, distinguirlas obligaba a desatender todos los 401 de esta ruta, y un
 * niño al que le acababan de regenerar la clave —lo que revoca sus sesiones—
 * se quedaba dando vueltas en la pantalla de la clave sin salida posible.
 */
export async function changePassword(actual: string, nueva: string): Promise<void> {
  await apiFetch(
    "/password",
    {
      method: "POST",
      body: JSON.stringify({ current_password: actual, new_password: nueva }),
    },
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
  /**
   * Ruta de la foto que devolvió `/predict`, tal cual y sin tocar.
   *
   * La app no la interpreta ni la construye: solo la devuelve para que el
   * servidor pueda atar la foto al intento. Llega `null` cuando el almacén está
   * apagado o no pudo guardarla, y entonces el intento se registra sin foto.
   */
  imagePath?: string | null;
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
      image_path:   record.imagePath ?? null,
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
 * Lo usa la pantalla de ajustes para validar antes de aceptar la dirección, y
 * también el sondeo de `buscarServidor`, que pide un tope más corto: ahí se
 * prueban varias direcciones a la vez y la mayoría no van a contestar.
 */
export async function testConnection(
  url: string, timeoutMs = 6000,
): Promise<HealthStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

// ─── Búsqueda automática del servidor ──────────────────────────────────────────
/**
 * Tope para la dirección que ya se está usando.
 *
 * Es la apuesta buena: si el servidor está ahí contesta en milisegundos, y lo
 * único que se espera es descubrir que **no** está para pasar a buscar.
 */
const SONDEO_ACTUAL_MS = 2500;

/**
 * Tope del sondeo de las demás. Va más largo porque estas sí pueden ser
 * direcciones de otra red: una IP enrutable pero de una máquina que no está
 * descarta el paquete sin contestar, y el intento se queda esperando.
 */
const SONDEO_MS = 4000;

/** Lo que devuelve la búsqueda: dónde está el servidor y si hubo que mudarse. */
export interface Hallazgo {
  url:    string;
  health: HealthStatus;
  /** `true` si el servidor apareció en una dirección distinta a la que había. */
  cambio: boolean;
}

/**
 * Lanza todos los sondeos a la vez y devuelve el primero que conteste.
 *
 * En paralelo y no en fila: en secuencia, con cuatro direcciones muertas
 * delante, encontrar la buena costaría cuatro esperas seguidas —dieciséis
 * segundos de arranque— cuando el aparato puede preguntarlo todo de golpe.
 * Devuelve `null` cuando ninguna contesta.
 */
function primeraQueResponda(urls: string[]): Promise<Hallazgo | null> {
  return new Promise(resolve => {
    let pendientes = urls.length;
    if (pendientes === 0) { resolve(null); return; }
    let listo = false;
    for (const url of urls) {
      testConnection(url, SONDEO_MS)
        .then(health => {
          if (listo) return;
          listo = true;
          resolve({ url, health, cambio: true });
        })
        .catch(() => { /* esa dirección no era */ })
        .then(() => {
          pendientes -= 1;
          if (pendientes === 0 && !listo) resolve(null);
        });
    }
  });
}

/**
 * Averigua dónde está el backend y se queda con esa dirección.
 *
 * Es lo que hace que cambiar de red no pida nada: al arrancar la app se prueba
 * la dirección guardada y, si no contesta, se sondean todas las conocidas —las
 * horneadas en `app.json` y las que se hayan escrito a mano alguna vez, ver
 * `candidatasApiUrl`—. La que responda `/health` se guarda como la de ahora, y
 * el estudiante entra sin enterarse de que se mudó de aula.
 *
 * Solo cuenta como encontrado lo que responde `/health` **correctamente**: un
 * 404 en esa ruta significa que ahí hay otro servidor cualquiera, no este.
 *
 * Devuelve `null` si nadie contesta: entonces sí hay que escribir la dirección
 * a mano en Ajustes, y `null` es lo que le dice a la pantalla que lo pida.
 */
export async function buscarServidor(): Promise<Hallazgo | null> {
  const candidatas = candidatasApiUrl();
  const actual = candidatas[0] ?? "";

  if (actual !== "") {
    try {
      const health = await testConnection(actual, SONDEO_ACTUAL_MS);
      // Se guarda aunque no haya cambiado nada: puede ser la de `app.json` en
      // el primer arranque, y así queda también en el historial que se sondea.
      await setApiUrl(actual);
      return { url: actual, health, cambio: false };
    } catch {
      // no está ahí: se busca en las demás
    }
  }

  const hallado = await primeraQueResponda(candidatas.slice(1));
  if (!hallado) return null;
  await setApiUrl(hallado.url);
  return hallado;
}
