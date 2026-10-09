/**
 * codigos.ts — códigos de un solo uso enviados por correo.
 *
 * Sirven para dos cosas: confirmar que el correo de una cuenta recién
 * registrada es de quien la registró (`verify`) y recuperar la clave
 * (`reset`). Son seis dígitos porque los teclea un niño en un teléfono; lo que
 * los hace seguros no es la longitud, sino tres topes a la vez:
 *
 *   · caducan (`EMAIL_CODE_TTL`, 15 minutos por defecto);
 *   · cada código admite `MAX_FALLOS` intentos y luego se destruye, así que
 *     acertar a ciegas tiene una probabilidad de 5 entre un millón por correo;
 *   · pedir otro código tiene una espera mínima (`EMAIL_CODE_RESEND`) y las
 *     rutas van detrás de un límite por IP.
 *
 * En la base se guarda un HMAC del código, nunca el código: quien lea la tabla
 * no puede usar ninguno. El HMAC lleva dentro la cuenta y el propósito, así que
 * un código de verificación no vale como código de recuperación ni para otra
 * cuenta aunque coincidan los dígitos.
 */
import { createHmac, randomInt } from "node:crypto";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { igualSeguro } from "./crypto.js";

export type Proposito = "verify" | "reset";

/** Fallos que admite un código antes de destruirse. */
const MAX_FALLOS = 5;

function huella(userId: number, proposito: Proposito, codigo: string): string {
  return createHmac("sha256", config.cifrado.claveIndice)
    .update(`email-code:${userId}:${proposito}:${codigo}`, "utf8")
    .digest("hex");
}

export type Emision =
  | { ok: true; codigo: string }
  | { ok: false; esperaSegundos: number };

/**
 * Genera un código nuevo para la cuenta y lo deja guardado, sustituyendo al
 * anterior si lo había.
 *
 * Devuelve el código en claro para que quien llama lo envíe; no se guarda ni
 * se registra en ningún otro sitio. Si el último se pidió hace menos de
 * `EMAIL_CODE_RESEND`, no genera nada y devuelve cuánto falta.
 *
 * Las fechas se calculan en MySQL (`NOW()`) y no en Node: así la caducidad y la
 * espera no dependen de que los dos relojes y sus zonas horarias coincidan.
 */
export async function emitirCodigo(userId: number, proposito: Proposito): Promise<Emision> {
  const [previos] = await pool.query<any[]>(
    `SELECT GREATEST(0, ? - TIMESTAMPDIFF(SECOND, created_at, NOW())) AS espera
     FROM email_codes WHERE user_id = ? AND purpose = ?`,
    [config.smtp.reenvioSegundos, userId, proposito],
  );
  const espera = Number(previos[0]?.espera ?? 0);
  if (espera > 0) return { ok: false, esperaSegundos: espera };

  // `randomInt` usa el generador criptográfico; `Math.random` no sirve para
  // esto. Se rellena con ceros: 000042 es un código tan bueno como cualquiera.
  const codigo = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await pool.query(
    `INSERT INTO email_codes (user_id, purpose, code_hash, attempts, expires_at, created_at)
     VALUES (?, ?, ?, 0, NOW() + INTERVAL ? SECOND, NOW())
     ON DUPLICATE KEY UPDATE
       code_hash = VALUES(code_hash), attempts = 0,
       expires_at = VALUES(expires_at), created_at = VALUES(created_at)`,
    [userId, proposito, huella(userId, proposito, codigo), config.smtp.codigoSegundos],
  );
  return { ok: true, codigo };
}

/**
 * Comprueba un código y, si es bueno, lo gasta.
 *
 * Va en una transacción con `FOR UPDATE`: dos peticiones simultáneas con el
 * mismo código no pueden darlo por bueno las dos, ni dos fallos simultáneos
 * contarse como uno.
 */
export async function consumirCodigo(
  userId: number, proposito: Proposito, codigo: string,
): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [filas] = await conn.query<any[]>(
      `SELECT id, code_hash, attempts, expires_at > NOW() AS vigente
       FROM email_codes WHERE user_id = ? AND purpose = ? FOR UPDATE`,
      [userId, proposito],
    );
    const fila = filas[0];
    if (!fila) {
      await conn.commit();
      return false;
    }

    if (Number(fila.vigente) === 1 && igualSeguro(fila.code_hash, huella(userId, proposito, codigo))) {
      await conn.query("DELETE FROM email_codes WHERE id = ?", [fila.id]);
      await conn.commit();
      return true;
    }

    // Caducado o con demasiados fallos: se destruye y hay que pedir otro.
    if (Number(fila.vigente) !== 1 || Number(fila.attempts) + 1 >= MAX_FALLOS) {
      await conn.query("DELETE FROM email_codes WHERE id = ?", [fila.id]);
    } else {
      await conn.query("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?", [fila.id]);
    }
    await conn.commit();
    return false;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/** Borra los códigos de una cuenta para un propósito (tras usarse por otra vía). */
export async function descartarCodigos(userId: number, proposito: Proposito): Promise<void> {
  await pool.query("DELETE FROM email_codes WHERE user_id = ? AND purpose = ?", [userId, proposito]);
}

/** Purga los códigos caducados. Va en la misma purga horaria que los intentos. */
export async function purgarCodigosCaducados(): Promise<void> {
  await pool.query("DELETE FROM email_codes WHERE expires_at < NOW()");
}
