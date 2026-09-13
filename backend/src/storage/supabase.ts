/**
 * supabase.ts — las fotos de los intentos, en Supabase Storage.
 *
 * Hasta ahora la foto del estudiante se analizaba y se tiraba. Se guarda para
 * que el docente pueda mirarla desde su panel: en el registro de intentos ve que
 * una figura dio un IoU de 0,42 y no tiene forma de saber si el niño la armó mal,
 * si la foto salió movida o si había media mesa dentro del encuadre. La cifra
 * sola no se puede interpretar; con la foto al lado, sí.
 *
 * Tres decisiones sostienen el resto del archivo:
 *
 *   · **El bucket es privado.** Son fotos de niños de primaria. No hay ninguna
 *     URL que funcione sin firmar, y las firmadas caducan en un minuto.
 *   · **Solo el backend habla con Supabase**, con la clave `service_role`, que
 *     salta todas las políticas RLS y por eso no sale del servidor. Es la misma
 *     regla que ya vale para MySQL: ningún cliente toca el almacén.
 *   · **Nada de esto puede dejar a un niño sin jugar.** Subir una foto es un
 *     efecto secundario de analizarla, no un paso del análisis: si Supabase está
 *     caído, `subirFoto` devuelve `null` y el intento sigue su curso sin imagen.
 *
 * Se habla con la API REST por `fetch` en vez de instalar `@supabase/supabase-js`.
 * Son tres llamadas —subir, firmar, borrar— y el SDK traería un cliente entero
 * (auth, realtime, postgrest) del que no se usa nada. `vision/client.ts` hace lo
 * mismo con el servicio de visión.
 */
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

/** Tope de espera de cada llamada al almacén. */
const TIMEOUT_MS = 15_000;

/** Cabeceras comunes: la credencial va en las dos, que es como la espera Supabase. */
function cabeceras(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.storage.clave}`,
    apikey: config.storage.clave,
  };
}

/**
 * Los formatos que `validarImagen` reconoce, con su extensión y su tipo MIME.
 *
 * La tabla es una sola para que extensión y `Content-Type` no puedan discrepar.
 * Antes la extensión se decidía con `tipo === "image/png" ? "png" : "jpg"`, que
 * guardaba un WebP como `.jpg`: el navegador del docente se lo tragaba por el
 * `Content-Type`, pero el archivo quedaba con el nombre mintiendo sobre su
 * contenido, y eso se paga al exportar o al depurar meses después.
 */
const FORMATOS: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: "jpg",  mime: "image/jpeg" },
  png:  { ext: "png",  mime: "image/png"  },
  webp: { ext: "webp", mime: "image/webp" },
  bmp:  { ext: "bmp",  mime: "image/bmp"  },
};

/**
 * Ruta dentro del bucket: `{id del estudiante}/{año-mes}/{uuid}.{ext}`.
 *
 * El id va **primero** y eso no es cosmético: dar de baja a un estudiante tiene
 * que llevarse sus fotos, y con este prefijo esa operación es listar y borrar una
 * carpeta en vez de cruzar la tabla de intentos con el bucket fila a fila.
 *
 * El nombre del archivo es un UUID y no el id del intento porque la foto se sube
 * durante `/predict`, cuando todavía no existe ninguna fila de `sessions` a la
 * que pertenecer —y puede que no llegue a existir, si el niño no registra el
 * intento—.
 */
function rutaDeFoto(estudianteId: number, formato: string): string {
  const ahora = new Date();
  const mes = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, "0")}`;
  const ext = FORMATOS[formato]?.ext ?? "jpg";
  return `${estudianteId}/${mes}/${randomUUID()}.${ext}`;
}

/**
 * ¿Esta ruta es de este estudiante?
 *
 * La ruta de la foto viaja al cliente en la respuesta de `/predict` y vuelve en
 * el cuerpo de `/sessions`, así que llega de fuera y no puede creerse sin más:
 * sin esta comprobación, un estudiante podría anotar en su intento la foto de un
 * compañero —cuya ruta no conoce, pero que se adivina probando ids—, y el panel
 * del docente se la mostraría como suya. Se apoya en que el id del estudiante es
 * el primer segmento de la ruta, que es justo lo que `rutaDeFoto` garantiza.
 */
export function rutaPerteneceA(ruta: string, estudianteId: number): boolean {
  return ruta.startsWith(`${estudianteId}/`);
}

/**
 * Sube la foto y devuelve su ruta dentro del bucket, o `null` si no se pudo.
 *
 * **Nunca lanza.** Quien llama está en mitad de `/predict`, con un niño
 * esperando el resultado de su figura: un fallo del almacén se registra en la
 * consola del servidor y se sigue adelante sin foto. Perder la evidencia de un
 * intento es un contratiempo para el docente; perder el intento es un problema
 * del niño, y no son comparables.
 */
export async function subirFoto(
  estudianteId: number, imagen: Buffer, formato: string,
): Promise<string | null> {
  if (!config.storage.activo) return null;

  const ruta = rutaDeFoto(estudianteId, formato);
  const url =
    `${config.storage.url}/storage/v1/object/${config.storage.bucket}/${ruta}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...cabeceras(),
        "Content-Type": FORMATOS[formato]?.mime ?? "image/jpeg",
        // Que dos intentos no puedan pisarse: el nombre es un UUID, así que un
        // choque significaría que algo va mal y es mejor enterarse.
        "x-upsert": "false",
      },
      body: new Uint8Array(imagen),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(
        `[storage] no se pudo subir la foto (HTTP ${res.status}):`,
        (await res.text().catch(() => "")).slice(0, 300),
      );
      return null;
    }
    return ruta;
  } catch (error) {
    console.error("[storage] no se pudo subir la foto:", error);
    return null;
  }
}

/**
 * URL temporal para ver una foto. `null` si no se pudo firmar.
 *
 * Caduca en `SUPABASE_SIGN_TTL` segundos (un minuto por defecto): lo justo para
 * que el navegador del docente la cargue, y poco para que el enlace siga
 * sirviendo a nadie si acaba pegado en un chat.
 */
export async function urlFirmada(ruta: string): Promise<string | null> {
  if (!config.storage.activo) return null;

  const url =
    `${config.storage.url}/storage/v1/object/sign/${config.storage.bucket}/${ruta}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...cabeceras(), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: config.storage.firmaSegundos }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[storage] no se pudo firmar ${ruta} (HTTP ${res.status})`);
      return null;
    }
    // Supabase devuelve `signedURL` relativo a /storage/v1.
    const cuerpo = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const firmada = cuerpo.signedURL ?? cuerpo.signedUrl;
    if (!firmada) return null;
    return `${config.storage.url}/storage/v1${firmada.startsWith("/") ? "" : "/"}${firmada}`;
  } catch (error) {
    console.error(`[storage] no se pudo firmar ${ruta}:`, error);
    return null;
  }
}

/**
 * Firma varias rutas de una vez. Devuelve un mapa `ruta → URL firmada`.
 *
 * Existe por el listado del docente, que puede traer cien intentos: firmarlos
 * uno a uno son cien peticiones a Supabase encadenadas antes de poder responder,
 * y el panel se quedaría en blanco mientras tanto. Supabase tiene un extremo
 * para firmar en lote y esto lo usa; si falla, el mapa vuelve vacío y el panel
 * se pinta igual, con los intentos sin foto.
 *
 * Las rutas que Supabase no pueda firmar —una foto borrada a mano, por ejemplo—
 * simplemente no aparecen en el mapa, y quien lo consulta obtiene `null`.
 */
export async function urlsFirmadas(rutas: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!config.storage.activo || rutas.length === 0) return mapa;

  try {
    const res = await fetch(
      `${config.storage.url}/storage/v1/object/sign/${config.storage.bucket}`,
      {
        method: "POST",
        headers: { ...cabeceras(), "Content-Type": "application/json" },
        body: JSON.stringify({
          expiresIn: config.storage.firmaSegundos,
          paths: rutas,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.error(`[storage] no se pudieron firmar ${rutas.length} rutas (HTTP ${res.status})`);
      return mapa;
    }

    const cuerpo = (await res.json()) as Array<{
      path?: string | null;
      signedURL?: string | null;
      error?: string | null;
    }>;

    for (const entrada of cuerpo) {
      if (!entrada.path || !entrada.signedURL || entrada.error) continue;
      const sep = entrada.signedURL.startsWith("/") ? "" : "/";
      mapa.set(entrada.path, `${config.storage.url}/storage/v1${sep}${entrada.signedURL}`);
    }
    return mapa;
  } catch (error) {
    console.error("[storage] fallo al firmar en lote:", error);
    return mapa;
  }
}

/**
 * Borra todas las fotos de un estudiante. Se llama al darlo de baja.
 *
 * Devuelve cuántas borró. No lanza: la baja del estudiante ya ocurrió en MySQL y
 * no se va a deshacer porque el almacén no conteste; lo que queda entonces son
 * archivos huérfanos, que se ven y se limpian, y no una cuenta a medio borrar.
 */
export async function borrarFotosDe(estudianteId: number): Promise<number> {
  if (!config.storage.activo) return 0;

  try {
    const rutas = await listarFotosDe(estudianteId);
    if (rutas.length === 0) return 0;

    const res = await fetch(
      `${config.storage.url}/storage/v1/object/${config.storage.bucket}`,
      {
        method: "DELETE",
        headers: { ...cabeceras(), "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: rutas }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.error(
        `[storage] no se pudieron borrar las fotos del estudiante ${estudianteId}` +
        ` (HTTP ${res.status})`,
      );
      return 0;
    }
    return rutas.length;
  } catch (error) {
    console.error(`[storage] fallo al borrar las fotos del estudiante ${estudianteId}:`, error);
    return 0;
  }
}

/**
 * Todas las rutas de fotos de un estudiante.
 *
 * El listado de Supabase no es recursivo: devuelve lo que hay en una carpeta,
 * y las subcarpetas como entradas sin `id`. Como las fotos se guardan en
 * `{id}/{año-mes}/`, hay que bajar un nivel — de ahí las dos vueltas.
 */
async function listarFotosDe(estudianteId: number): Promise<string[]> {
  const carpetas = await listar(`${estudianteId}`);
  const rutas: string[] = [];

  for (const carpeta of carpetas) {
    if (carpeta.id) {
      // Un archivo suelto en la raíz del estudiante (formato antiguo).
      rutas.push(`${estudianteId}/${carpeta.name}`);
      continue;
    }
    for (const archivo of await listar(`${estudianteId}/${carpeta.name}`)) {
      if (archivo.id) rutas.push(`${estudianteId}/${carpeta.name}/${archivo.name}`);
    }
  }
  return rutas;
}

interface EntradaListado {
  name: string;
  /** Las carpetas llegan sin `id`; los archivos, con él. */
  id: string | null;
}

async function listar(prefijo: string): Promise<EntradaListado[]> {
  const res = await fetch(
    `${config.storage.url}/storage/v1/object/list/${config.storage.bucket}`,
    {
      method: "POST",
      headers: { ...cabeceras(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: prefijo, limit: 1000 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!res.ok) return [];
  return (await res.json()) as EntradaListado[];
}

/**
 * ¿Responde el almacén? Lo usa `/health` para que el docente vea si las fotos se
 * están guardando, en vez de descubrirlo al abrir un intento y no encontrar nada.
 */
export async function comprobarStorage(): Promise<boolean> {
  if (!config.storage.activo) return false;
  try {
    const res = await fetch(
      `${config.storage.url}/storage/v1/bucket/${config.storage.bucket}`,
      { headers: cabeceras(), signal: AbortSignal.timeout(5_000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}
