/**
 * intentos.ts — freno a la fuerza bruta contra el inicio de sesión.
 *
 * Se cuenta por dos vías a la vez, y hacen falta las dos:
 *
 *   · **por IP**: impide que un atacante barra muchas cuentas desde un sitio.
 *   · **por cuenta**: impide que barra el PIN de una cuenta concreta desde
 *     muchos sitios.
 *
 * La segunda es la que de verdad importa aquí. En el móvil el estudiante entra
 * con un PIN de cuatro dígitos —diez mil combinaciones—, que sin freno se
 * prueban enteras en minutos. Con el bloqueo por cuenta, agotarlas llevaría
 * semanas.
 *
 * No hay captcha a propósito: quien inicia sesión es un niño de primaria, y un
 * desafío visual lo dejaría fuera de la actividad. El bloqueo temporal consigue
 * el mismo efecto sin pedirle nada.
 *
 * La cuenta se identifica por el índice ciego de su correo, nunca por el correo
 * en claro: esta tabla no tiene por qué saber quién es nadie.
 */
import { consulta } from "../db/pool.js";

/** Escalado del bloqueo: a más fallos seguidos, más espera. */
const ESCALA: ReadonlyArray<{ fallos: number; bloqueoSegundos: number }> = [
  { fallos: 20, bloqueoSegundos: 30 * 60 },
  { fallos: 10, bloqueoSegundos: 5 * 60 },
  { fallos: 5,  bloqueoSegundos: 60 },
];

/** Ventana en la que se cuentan los fallos. */
const VENTANA_MINUTOS = 15;

export interface Veredicto {
  permitido: boolean;
  /** Segundos que faltan para poder reintentar. */
  esperaSegundos: number;
}

/** Cuenta los fallos recientes y devuelve cuándo fue el último. */
async function fallosRecientes(identifier: string, kind: "ip" | "account") {
  const filas = await consulta<{ n: number; ultimo: Date | null }>(
    `SELECT COUNT(*) AS n, MAX(created_at) AS ultimo
     FROM login_attempts
     WHERE identifier = ? AND kind = ? AND ok = 0
       AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [identifier, kind, VENTANA_MINUTOS],
  );
  return {
    n: Number(filas[0]?.n ?? 0),
    ultimo: filas[0]?.ultimo ? new Date(filas[0].ultimo) : null,
  };
}

function bloqueoPara(fallos: number): number {
  return ESCALA.find(e => fallos >= e.fallos)?.bloqueoSegundos ?? 0;
}

/**
 * ¿Puede intentarlo? Comprueba IP y cuenta, y devuelve la espera más larga de
 * las dos.
 */
export async function comprobarIntentos(
  ip: string, cuentaHash: string | null,
): Promise<Veredicto> {
  const objetivos: Array<[string, "ip" | "account"]> = [[ip, "ip"]];
  if (cuentaHash) objetivos.push([cuentaHash, "account"]);

  let espera = 0;
  for (const [identifier, kind] of objetivos) {
    const { n, ultimo } = await fallosRecientes(identifier, kind);
    const bloqueo = bloqueoPara(n);
    if (bloqueo > 0 && ultimo) {
      const transcurrido = (Date.now() - ultimo.getTime()) / 1000;
      espera = Math.max(espera, Math.ceil(bloqueo - transcurrido));
    }
  }

  return espera > 0
    ? { permitido: false, esperaSegundos: espera }
    : { permitido: true, esperaSegundos: 0 };
}

/** Anota el resultado de un intento. */
export async function registrarIntento(
  ip: string, cuentaHash: string | null, ok: boolean,
): Promise<void> {
  await consulta(
    "INSERT INTO login_attempts (identifier, kind, ok) VALUES (?, 'ip', ?)",
    [ip, ok ? 1 : 0],
  );
  if (cuentaHash) {
    await consulta(
      "INSERT INTO login_attempts (identifier, kind, ok) VALUES (?, 'account', ?)",
      [cuentaHash, ok ? 1 : 0],
    );
  }
}

/**
 * Al entrar bien se borra el historial de fallos de esa cuenta y esa IP.
 *
 * Sin esto, un niño que se equivoca cuatro veces y acierta a la quinta seguiría
 * a un fallo del bloqueo durante el resto de la clase.
 */
export async function limpiarTrasExito(ip: string, cuentaHash: string): Promise<void> {
  await consulta(
    "DELETE FROM login_attempts WHERE (identifier = ? AND kind = 'ip') OR (identifier = ? AND kind = 'account')",
    [ip, cuentaHash],
  );
}

/**
 * Purga los intentos viejos. Se llama al arrancar y una vez por hora: esta
 * tabla solo sirve para la ventana reciente y no tiene por qué crecer sin fin.
 */
export async function purgarIntentosViejos(): Promise<void> {
  await consulta(
    "DELETE FROM login_attempts WHERE created_at < (NOW() - INTERVAL 1 DAY)",
  );
}
