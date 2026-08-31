/**
 * imagen.ts — validación de la foto que sube el estudiante.
 *
 * `/predict` es la única entrada de archivos de todo el sistema, y llega como
 * base64 dentro de un JSON. Antes de gastar un segundo de detector en ella hay
 * que comprobar tres cosas, en este orden:
 *
 *   1. que el base64 sea base64 y no un texto cualquiera;
 *   2. que quepa en el límite, medido sobre los bytes **decodificados** y no
 *      sobre la cadena;
 *   3. que los primeros bytes sean los de una imagen de un formato admitido.
 *
 * El tercer punto es el que importa: la extensión o el `data:` que anuncie el
 * cliente no significan nada, porque los pone quien envía. Lo único que dice de
 * verdad qué es un archivo son sus primeros bytes, y por eso se miran esos.
 */
import { config } from "../config.js";
import { HttpError } from "../http/errors.js";

/** Firmas de los formatos que el detector sabe leer. */
const FIRMAS: ReadonlyArray<{ formato: string; bytes: number[]; desde?: number }> = [
  { formato: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { formato: "png",  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { formato: "webp", bytes: [0x57, 0x45, 0x42, 0x50], desde: 8 },  // "WEBP" tras "RIFF????"
  { formato: "bmp",  bytes: [0x42, 0x4d] },
];

function coincide(buf: Buffer, firma: (typeof FIRMAS)[number]): boolean {
  const desde = firma.desde ?? 0;
  if (buf.length < desde + firma.bytes.length) return false;
  return firma.bytes.every((b, i) => buf[desde + i] === b);
}

export interface ImagenValidada {
  /** Base64 limpio, sin el prefijo `data:`, listo para el servicio de visión. */
  base64: string;
  formato: string;
  bytes: number;
}

/**
 * Comprueba que lo recibido es una imagen admitida y de tamaño razonable.
 *
 * Lanza `HttpError` con un mensaje que un niño pueda entender: el estudiante no
 * tiene por qué saber qué es un base64, pero sí puede volver a tomar la foto.
 */
export function validarImagen(entrada: string): ImagenValidada {
  // El cliente puede mandar `data:image/jpeg;base64,...`. Se acepta el prefijo,
  // pero no se cree lo que dice: el tipo se decide luego por los bytes.
  const recortada = entrada.trim();
  const coma = recortada.indexOf(",");
  const cuerpo = recortada.startsWith("data:") && coma > 0
    ? recortada.slice(coma + 1)
    : recortada;

  /**
   * Se normaliza antes de validar porque el base64 legítimo llega de más de una
   * forma y el regex anterior solo aceptaba una:
   *
   *   · **saltos de línea y espacios** — quien codifica con las herramientas de
   *     correo (MIME) envuelve la cadena a 76 columnas, y un JSON puede traerla
   *     así tal cual;
   *   · **variante URL-safe** (`-` y `_` en lugar de `+` y `/`) — es la que
   *     produce, entre otros, el base64 de las bibliotecas pensadas para meter
   *     el dato en una URL.
   *
   * Las dos decodifican a los mismos bytes, así que rechazarlas era rechazar
   * fotos buenas con un «la foto llegó dañada» que el niño no podía arreglar
   * volviendo a tomarla, porque no era culpa de la foto.
   */
  const limpio = cuerpo.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (limpio.length === 0) {
    throw new HttpError(422, "No llegó ninguna foto. Vuelve a tomarla.");
  }
  // El relleno con '=' es opcional: la variante URL-safe suele venir sin él y
  // `Buffer.from` lo deduce igual de la longitud.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpio)) {
    throw new HttpError(422, "La foto llegó dañada. Vuelve a tomarla.");
  }

  // Tamaño estimado antes de decodificar: así un cuerpo enorme se rechaza sin
  // reservar memoria para él.
  const maxBytes = config.maxImagenMb * 1024 * 1024;
  if ((limpio.length * 3) / 4 > maxBytes) {
    throw new HttpError(
      413,
      `La foto es demasiado grande (máximo ${config.maxImagenMb} MB). ` +
      "Vuelve a tomarla con menos resolución.",
    );
  }

  const buf = Buffer.from(limpio, "base64");
  if (buf.length < 64) {
    throw new HttpError(422, "La foto llegó incompleta. Vuelve a tomarla.");
  }
  if (buf.length > maxBytes) {
    throw new HttpError(413, `La foto es demasiado grande (máximo ${config.maxImagenMb} MB).`);
  }

  const firma = FIRMAS.find(f => coincide(buf, f));
  if (!firma) {
    // Aquí es donde se para un archivo que se hace pasar por foto.
    throw new HttpError(
      422,
      "Eso no parece una foto. Envía una imagen JPG o PNG tomada con la cámara.",
    );
  }

  return { base64: limpio, formato: firma.formato, bytes: buf.length };
}
