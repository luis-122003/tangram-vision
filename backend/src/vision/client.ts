/**
 * client.ts — cliente del servicio de visión.
 *
 * El análisis de la foto (detector YOLOv8-seg + validador geométrico) vive en
 * un servicio Python aparte, `vision-service/`. La razón es deliberada: el
 * validador es geometría calibrada con `--autotest` y `--calibrar`, y
 * reescribirla cambiaría los números del sistema sin ganar nada.
 *
 * Este backend le manda la foto y la figura objetivo que acaba de leer de
 * MySQL, y devuelve al cliente la respuesta tal cual: el servicio de visión ya
 * construye exactamente el JSON que la app espera de `/predict`.
 */
import { config } from "../config.js";
import { HttpError } from "../http/errors.js";
import type { Punto } from "../types.js";

export interface FiguraObjetivo {
  slug: string;
  name: string;
  silhouette: Punto[];
}

export interface PeticionAnalisis {
  image_b64: string;
  figure: FiguraObjetivo;
  crop?: [number, number, number, number] | null;
}

export interface EstadoVision {
  yolo_loaded: boolean;
  validator_ready: boolean;
  match_threshold?: number;
  /**
   * Cómo se compara la figura armada contra la silueta objetivo: `"geometric"`.
   * Se propaga a `/health` porque en `vision-service/models/` sigue habiendo un
   * U-Net retirado y su presencia hace pensar que falta un modelo por activar.
   * No falta: esa etapa no usa pesos.
   */
  shape_matching?: string;
  /** Modelos realmente cargados. Es uno solo: el detector de fichas. */
  models_loaded?: string[];
  /**
   * Nombre del archivo de pesos con el que arrancó el detector.
   *
   * En `vision-service/models/` conviven dos detectores y **los dos son
   * yolov8s-seg**: arrancar con el que no es no produce ningún error. Cargan
   * igual, `yolo_loaded` sale `true`, `models_loaded` dice lo mismo para ambos
   * y las cifras que devuelven son verosímiles —solo que medidas con otra
   * taxonomía de clases—. Lo único que los distingue es el nombre del archivo.
   *
   * Por eso viaja hasta `/health`: es el único sitio donde se puede comprobar,
   * sin entrar a la máquina, que el servicio está usando el detector que se
   * midió y no el anterior.
   */
  yolo_weights?: string | null;
}

/**
 * Traduce un fallo de red al mensaje que el estudiante puede entender.
 *
 * `silencioso` evita el volcado a consola. Lo usa el sondeo de `/health`, que la
 * pantalla de ajustes de la app dispara en cada «Probar conexión»: con el
 * servicio caído, cada pulsación escupía un stack trace de quince líneas y
 * enterraba los mensajes que sí sirven para arreglarlo.
 */
function fallo(error: unknown, silencioso = false): HttpError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new HttpError(
      504,
      "El análisis de la foto tardó demasiado. Inténtalo otra vez.",
    );
  }
  if (!silencioso) {
    console.error("[visión] no se pudo contactar con el servicio:", error);
  }
  return new HttpError(
    503,
    "El servicio de análisis no está disponible. Avisa al docente.",
  );
}

interface Opciones {
  timeoutMs: number;
  /** No volcar el fallo a la consola. Lo usa el sondeo de `/health`. */
  silencioso?: boolean;
  /** Reintentos ante un fallo de conexión. Ver `esperar` más abajo. */
  reintentos?: number;
}

/** Espera pasiva entre el intento fallido y el siguiente. */
const espera = (ms: number) => new Promise<void>(resolver => setTimeout(resolver, ms));

/** Milisegundos antes de reintentar: lo justo para que un servicio que se está reiniciando levante. */
const ESPERA_REINTENTO_MS = 300;

async function pedir<T>(ruta: string, init: RequestInit, opciones: Opciones): Promise<T> {
  const { timeoutMs, silencioso = false, reintentos = 0 } = opciones;

  let respuesta: Response | null = null;
  for (let intento = 0; ; intento++) {
    try {
      respuesta = await fetch(`${config.vision.url}${ruta}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      break;
    } catch (error) {
      /**
       * Se reintenta solo cuando la conexión ni siquiera llegó a establecerse,
       * y por un motivo concreto: el servicio de visión se reinicia (al tocar
       * un archivo, al recargar los pesos) en un par de cientos de milisegundos,
       * y esa ventana no tiene por qué convertirse en un error delante de un
       * niño que acaba de tomar la foto.
       *
       * No se reintenta si venció el tiempo: ahí el servicio sí respondió al
       * saludo y se está tomando su tiempo, y repetir la petición solo suma
       * otro tope entero de espera —hasta pasarse del que aguanta la app móvil,
       * con lo que el niño acabaría viendo un error de red genérico en vez del
       * mensaje que este backend sabe darle—.
       *
       * Repetir `/analyze` es seguro: el análisis no guarda nada, así que un
       * intento perdido no deja rastro ni cuenta dos veces.
       */
      const vencido = error instanceof DOMException && error.name === "TimeoutError";
      if (intento >= reintentos || vencido) throw fallo(error, silencioso);
      if (!silencioso) {
        console.warn(`[visión] sin conexión con ${ruta}; reintentando una vez…`);
      }
      await espera(ESPERA_REINTENTO_MS);
    }
  }

  if (!respuesta.ok) {
    // El servicio de visión es FastAPI: sus errores ya vienen como {detail}.
    const cuerpo = (await respuesta.json().catch(() => null)) as { detail?: unknown } | null;
    const detalle = typeof cuerpo?.detail === "string" ? cuerpo.detail : null;

    /**
     * El estado del servicio interno no se propaga tal cual.
     *
     * Antes sí: un 404 de visión salía por `/predict` como un 404, y el cliente
     * lo leía como «esa figura no existe» cuando lo que pasaba era que la ruta
     * del servicio había cambiado. Peor todavía con el 500, cuyo `detail` lleva
     * el texto de la excepción de Python: eso es información del servidor, no
     * un mensaje para un niño. Aquí dentro somos nosotros los que llamamos mal
     * o el servicio el que falla, y eso en HTTP son 502 y 503, no el código que
     * venga.
     */
    if (!silencioso) {
      console.error(`[visión] ${ruta} respondió ${respuesta.status}: ${detalle ?? "(sin detalle)"}`);
    }
    throw respuesta.status >= 500
      ? new HttpError(
        503,
        "El servicio de análisis tuvo un problema con la foto. Vuelve a intentarlo.",
      )
      : new HttpError(
        502,
        "El servicio de análisis no aceptó la foto. Vuelve a tomarla y, si sigue igual, avisa al docente.",
      );
  }

  // El `.catch` no sobra: si el servicio contesta 200 con algo que no es JSON
  // —una página de error de un proxy por medio, una respuesta a medias—, el
  // `await` lanzaría un SyntaxError que acabaría en el 500 genérico, y el 500
  // dice «el fallo es de este backend» cuando no lo es.
  const datos = await respuesta.json().catch(() => null);
  if (datos === null || typeof datos !== "object") {
    if (!silencioso) {
      console.error(`[visión] ${ruta} respondió 200 con algo que no es JSON`);
    }
    throw new HttpError(
      502,
      "El servicio de análisis devolvió una respuesta que no se entiende. Avisa al docente.",
    );
  }
  return datos as T;
}

/** Analiza una foto contra la silueta objetivo. Devuelve el JSON de `/predict`. */
export function analizar(peticion: PeticionAnalisis): Promise<Record<string, unknown>> {
  return pedir(
    "/analyze",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(peticion),
    },
    { timeoutMs: config.vision.timeoutMs, reintentos: 1 },
  );
}

/** Lo que devuelve `/silhouette`: la silueta de una figura nueva y qué se vio. */
export interface SiluetaExtraida {
  /** Polígono 0..1 listo para `figures.silhouette`; vacío si no se pudo formar. */
  silhouette: Punto[];
  pieces_used: number;
  coverage: number;
  detection_ok: boolean;
  pieces: {
    detected: Record<string, number>;
    total: number;
    missing: Record<string, number>;
    extra: Record<string, number>;
    complete: boolean;
  };
  warnings: string[];
  processing_ms: number;
}

/**
 * Extrae de una foto la silueta de referencia de una figura nueva.
 *
 * Es lo que el panel del docente llama antes de guardar una figura: el mismo
 * detector que califica los intentos, pero sin figura objetivo, porque aquí lo
 * que se está fabricando **es** la figura objetivo. Sin reintento: la llama un
 * docente mirando la pantalla, que puede volver a pulsar.
 */
export function extraerSilueta(image_b64: string): Promise<SiluetaExtraida> {
  return pedir(
    "/silhouette",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64 }),
    },
    { timeoutMs: config.vision.timeoutMs },
  );
}

/**
 * Estado del detector, para `/health`. Con un tope corto y sin propagar el
 * error: que el servicio de visión esté caído es justo lo que `/health` existe
 * para informar, no un motivo para que `/health` falle.
 *
 * Tampoco reintenta. Esto es un sondeo, no el trabajo de nadie: si el servicio
 * no está, la respuesta útil es decirlo cuanto antes, no tardar el doble en
 * decir lo mismo.
 */
export async function estado(): Promise<EstadoVision> {
  try {
    return await pedir<EstadoVision>(
      "/health", { method: "GET" }, { timeoutMs: 4000, silencioso: true },
    );
  } catch {
    return { yolo_loaded: false, validator_ready: false };
  }
}
