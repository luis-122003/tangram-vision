/**
 * _consola.mjs — preguntar por la terminal sin que la clave quede escrita.
 *
 * Lo comparten los scripts de cuentas (`crear-estudiante`, `cambiar-clave`).
 * No se pide la clave por argumento a propósito: un argumento queda en el
 * historial del shell y en la lista de procesos, donde lo ve cualquiera que
 * tenga una sesión abierta en el servidor.
 *
 * El guion bajo del nombre dice que no es una orden que se ejecute: es el
 * módulo que usan las demás.
 */
import readline from "node:readline";
import { esClaveTrivial } from "../dist/security/clave-temporal.js";

/**
 * Una sola interfaz para todas las preguntas, leída como iterador.
 *
 * Es la misma forma que usa `crear-docente.mjs`, y por el mismo motivo: así
 * las líneas que llegan juntas por una tubería
 * (`printf 'a\nb\n' | docker compose exec -T …`) se guardan en búfer en vez de
 * perderse entre una pregunta y la siguiente. Con terminal, lo que se escribe
 * no se repite en pantalla.
 */
const tty = Boolean(process.stdin.isTTY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
rl._writeToOutput = () => {};
const lineas = rl[Symbol.asyncIterator]();

export async function preguntar(texto) {
  process.stdout.write(texto);
  const { value, done } = await lineas.next();
  process.stdout.write("\n");
  return done ? "" : value;
}

export function cerrar() {
  rl.close();
}

/**
 * Pide una clave dos veces y la devuelve solo si vale.
 *
 * Las reglas son las mismas que aplica la API, no unas propias: mínimo 4
 * caracteres (`reglaClave` en src/routes/esquemas.ts, pensado para un niño que
 * teclea en un teclado de diez teclas) y nada de las combinaciones que se
 * prueban primero (`esClaveTrivial`). Al docente se le piden 12: su cuenta ve
 * los datos de todo el curso y él escribe en un teclado completo.
 *
 * Si un script pusiera un mínimo distinto, acabaría creando cuentas que la
 * propia aplicación no dejaría crear.
 */
export async function pedirClave(minimo) {
  const clave = await preguntar(`Clave (mínimo ${minimo} caracteres): `);
  if (clave.length < minimo) {
    throw new Error(`La clave debe tener al menos ${minimo} caracteres.`);
  }
  if (clave.length > 200) {
    throw new Error("La clave no puede pasar de 200 caracteres.");
  }
  if (esClaveTrivial(clave)) {
    throw new Error("Esa clave es de las que se prueban primero (1234, 0000…). Elige otra.");
  }
  if (clave !== await preguntar("Repítela: ")) {
    throw new Error("Las dos claves no coinciden.");
  }
  return clave;
}

/** Valida un correo igual que el resto del sistema: lo justo para no colar basura. */
export function normalizarCorreo(bruto) {
  const correo = bruto?.trim().toLowerCase() ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return null;
  return correo;
}
