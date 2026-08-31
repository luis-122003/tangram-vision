/**
 * crypto.ts — cifrado de los datos personales de los estudiantes.
 *
 * En esta aplicación los datos personales son el nombre y el correo de niños de
 * primaria. Van cifrados en la base con **AES-256-GCM**, que además de ocultar
 * el contenido lo autentica: si alguien modifica una fila por SQL, el descifrado
 * falla en vez de devolver basura silenciosamente.
 *
 * El problema de cifrar el correo es que deja de poder buscarse: dos cifrados
 * del mismo texto son distintos (y tienen que serlo, o el cifrado filtraría qué
 * filas comparten valor). La solución es un **índice ciego**: junto al correo
 * cifrado se guarda un HMAC-SHA256 del correo normalizado, que sí es
 * determinista y sí se puede indexar. El login busca por ese HMAC.
 *
 *   email_hash  HMAC-SHA256(correo, BLIND_INDEX_KEY)  ← se busca por aquí
 *   email_enc   AES-256-GCM(correo, ENCRYPTION_KEY)   ← se muestra desde aquí
 *
 * Las dos claves son distintas a propósito: quien consiga la del índice puede
 * comprobar si un correo concreto está en la base, pero no descifrar nada.
 */
import {
  createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual,
} from "node:crypto";
import { config } from "../config.js";

const ALGORITMO = "aes-256-gcm";
const IV_BYTES = 12;    // recomendado para GCM
const TAG_BYTES = 16;

/**
 * Cifra un texto. El resultado es `base64(iv || tag || ciphertext)`.
 *
 * El IV es aleatorio en cada llamada: reutilizarlo en GCM con la misma clave
 * rompe el cifrado por completo, así que nunca se deriva del contenido.
 */
export function cifrar(texto: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITMO, config.cifrado.clave, iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString("base64");
}

/**
 * Descifra lo que produjo `cifrar`.
 *
 * Lanza si el dato fue alterado o si la clave no es la que se usó para cifrar:
 * es justamente lo que aporta GCM frente a un modo sin autenticación.
 */
export function descifrar(guardado: string): string {
  const bruto = Buffer.from(guardado, "base64");
  if (bruto.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Dato cifrado con formato inválido");
  }
  const iv = bruto.subarray(0, IV_BYTES);
  const tag = bruto.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const cifrado = bruto.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITMO, config.cifrado.clave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString("utf8");
}

/**
 * Descifra sin lanzar. Devuelve `null` si el dato no se puede leer.
 *
 * Lo usan los listados: que una fila corrupta no tumbe el dashboard entero del
 * docente, que se muestre esa fila sin nombre y las demás bien.
 */
export function descifrarSeguro(guardado: string | null | undefined): string | null {
  if (!guardado) return null;
  try {
    return descifrar(guardado);
  } catch {
    return null;
  }
}

/**
 * Índice ciego del correo: HMAC determinista para poder buscarlo.
 *
 * El correo se normaliza antes (minúsculas y sin espacios) para que
 * `Luis@Tangram.edu` y `luis@tangram.edu ` den el mismo índice; de lo contrario
 * el mismo usuario podría registrarse dos veces y el login fallaría según cómo
 * lo escribiera.
 */
export function indiceCiego(correo: string): string {
  return createHmac("sha256", config.cifrado.claveIndice)
    .update(correo.trim().toLowerCase(), "utf8")
    .digest("hex");
}

/**
 * Comparación en tiempo constante de dos cadenas.
 *
 * Se usa donde una diferencia de milisegundos revelaría información —comparar
 * un índice ciego, un token—. `timingSafeEqual` exige longitudes iguales, así
 * que la desigualdad de tamaño se resuelve aparte y sin cortocircuito medible.
 */
export function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
