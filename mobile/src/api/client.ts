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
 * La URL del backend va fija en el APK (ver ./config.ts).
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
 * Con una red que deja salir pero no llega —datos sin saldo, un wifi con portal
 * de acceso— el socket espera el tiempo del sistema: uno o dos minutos de
 * spinner. Doce segundos sobran para un `POST /token`.
 */
const LOGIN_TIMEOUT_MS = 12_000;

/**
 * Por debajo de este tiempo, el fallo volvió sin que hubiera nada que esperar.
 *
 * Es lo único que distingue «sin internet» de «el servidor no contesta» sin
 * meter NetInfo, que no está instalado: `fetch` dice «Network request failed»
 * en los dos casos. Sin datos ni WiFi Android sabe que no hay ruta y falla al
 * instante; con red pero un servidor caído, el intento se queda esperando.
 */
const FALLO_INMEDIATO_MS = 1200;

/**
 * El teléfono no consiguió hablar con el servidor. Es un tipo propio y no un
 * `Error` cualquiera para que la pantalla pueda distinguirlo de un
 * «credenciales incorrectas».
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
  if (Date.now() - inicio < FALLO_INMEDIATO_MS) {
    return new ErrorDeRed(
      "El teléfono no tiene internet. Revisa que el WiFi o los datos estén " +
      "encendidos e inténtalo otra vez."
    );
  }
  return new ErrorDeRed(
    "No se pudo conectar con el servidor. Revisa tu internet e inténtalo otra " +
    "vez en un momento."
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
 * La clave es correcta pero la cuenta todavía no confirmó su correo.
 *
 * Es un tipo propio porque la pantalla de ingreso no lo muestra como un error:
 * lleva al niño a escribir el código que recibió (o a pedir otro).
 */
export class CorreoSinVerificar extends Error {
  /**
   * El correo al que se mandó el código. Viene del servidor porque el niño
   * pudo entrar con su usuario (alta masiva del docente) y no con el correo.
   */
  constructor(mensaje: string, readonly email: string | null) {
    super(mensaje);
  }
}

/**
 * La clave es correcta pero la cuenta todavía no tiene correo: el docente la
 * creó desde su Excel sin él. La pantalla le pide que lo escriba.
 */
export class CorreoRequerido extends Error {}

/**
 * Una petición sin sesión —entrar, registrarse, verificar el correo, recuperar
 * la clave— con el tope de espera corto del ingreso.
 *
 * Lleva su propio tope, más corto que el de las demás peticiones (ver
 * `LOGIN_TIMEOUT_MS`): sin él, una dirección equivocada dejaba el spinner
 * girando hasta que se rendía el sistema operativo, un par de minutos después.
 *
 * El servidor es quien dice por qué no pudo, siempre como `{detail}`, y se
 * muestra tal cual. La única respuesta que se traduce a un tipo propio es la
 * del correo sin verificar, que la pantalla atiende aparte.
 */
async function pedirSinSesion<T>(path: string, init: RequestInit, fallo: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  const inicio = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(`${getApiUrl()}${path}`, { ...init, signal: controller.signal });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new ErrorDeRed(
          "El servidor no contestó a tiempo. Revisa tu internet e inténtalo otra vez."
        );
      }
      throw errorDeRed(e, inicio);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const mensaje = detailToMessage(err?.detail, fallo);
      if (res.status === 403 && err?.code === "correo_sin_verificar") {
        throw new CorreoSinVerificar(mensaje, typeof err?.email === "string" ? err.email : null);
      }
      if (res.status === 403 && err?.code === "correo_requerido") {
        throw new CorreoRequerido(mensaje);
      }
      throw new Error(mensaje);
    }
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

/** POST con cuerpo JSON y sin sesión. */
function postJson<T>(path: string, cuerpo: unknown, fallo: string): Promise<T> {
  return pedirSinSesion<T>(
    path,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(cuerpo),
    },
    fallo,
  );
}

/**
 * Una petición que abre sesión —entrar o confirmar el correo— y guarda sus
 * tokens. Las dos rutas responden con la misma forma (`LoginResponse`).
 */
async function abrirSesion(
  path: string, init: RequestInit, email: string, fallo: string,
): Promise<User> {
  const data = await pedirSinSesion<LoginResponse>(path, init, fallo);
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
}

/**
 * Entra y guarda el token de sesión en el teléfono.
 *
 * Las credenciales viajan como formulario porque así las espera `/token`: el
 * PIN de cuatro dígitos que teclea el niño va como `password`.
 *
 * Si la cuenta no ha confirmado su correo lanza `CorreoSinVerificar`.
 */
export async function login(email: string, password: string): Promise<User> {
  const body = new URLSearchParams({ username: email, password });
  return abrirSesion(
    "/token",
    {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
    },
    email,
    "Credenciales incorrectas",
  );
}

/**
 * Crea la cuenta del estudiante. **No** abre sesión: el servidor manda un
 * código de seis dígitos al correo, y la sesión llega al escribirlo
 * (`verificarCorreo`). Así se comprueba que el correo es de quien se registra.
 *
 * El servidor es quien dice por qué no pudo: correo repetido (409), clave
 * demasiado fácil (422), registro cerrado por el docente (403) o correo sin
 * configurar en el servidor (503). Todos llegan como `{detail}`.
 */
export async function registrar(
  nombre: string, email: string, password: string,
): Promise<void> {
  await postJson("/register", { name: nombre, email, password }, "No se pudo crear la cuenta");
}

/**
 * Confirma el correo con el código recibido y entra.
 *
 * Va también la clave que el niño acaba de elegir (la pantalla la conserva):
 * el servidor solo activa la cuenta con el código **y** la clave juntos.
 */
export async function verificarCorreo(
  email: string, password: string, codigo: string,
): Promise<User> {
  return abrirSesion(
    "/register/verify",
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password, code: codigo }),
    },
    email,
    "No se pudo comprobar el código",
  );
}

/** Pide otro código de verificación. Responde igual exista o no la cuenta. */
/**
 * Pone el correo de una cuenta del alta masiva (o corrige uno sin confirmar) y
 * hace que le llegue el código. Pide las mismas credenciales del ingreso.
 * Devuelve el correo tal como quedó guardado.
 */
export async function agregarCorreo(
  usuario: string, clave: string, correo: string,
): Promise<string> {
  const r = await postJson<{ email: string }>(
    "/account/email", { username: usuario, password: clave, email: correo },
    "No se pudo guardar el correo",
  );
  return r.email;
}

export async function reenviarCodigo(email: string): Promise<void> {
  await postJson("/register/resend", { email }, "No se pudo reenviar el código");
}

/** Pide un código para cambiar la clave olvidada. Responde igual exista o no la cuenta. */
export async function olvideClave(email: string): Promise<void> {
  await postJson("/password/forgot", { email }, "No se pudo enviar el código");
}

/**
 * Cambia la clave olvidada con el código del correo. No abre sesión: después
 * se entra con la clave nueva, como siempre.
 */
export async function restablecerClave(
  email: string, codigo: string, nueva: string,
): Promise<void> {
  await postJson(
    "/password/reset", { email, code: codigo, new_password: nueva }, "No se pudo cambiar la clave",
  );
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
 * Pregunta al servidor cómo está. Lo usa la pantalla de ajustes para mostrar
 * si la app puede trabajar (base de datos, análisis de fotos).
 */
export async function testConnection(timeoutMs = 8000): Promise<HealthStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getApiUrl()}/health`, { signal: controller.signal });
    // Un 404 o un 500 significan que el servidor SÍ está ahí: ese diagnóstico
    // no puede acabar disfrazado de "no hay red", que es justo lo que esta
    // pantalla existe para distinguir.
    if (!res.ok) {
      throw new HealthError(
        `El servidor respondió ${res.status}. Inténtalo otra vez en un momento.`
      );
    }
    return await res.json();
  } catch (e) {
    if (e instanceof HealthError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("El servidor no respondió (tiempo agotado)");
    }
    throw new Error("No se pudo conectar. Revisa tu internet.");
  } finally {
    clearTimeout(timer);
  }
}
