/**
 * clave-temporal.ts — la clave que el docente entrega y el estudiante cambia.
 *
 * Son **cuatro dígitos** y no una cadena larga por una razón de la propia
 * aplicación: la app del estudiante no tiene teclado alfanumérico. El niño
 * escribe su clave en un teclado de diez teclas grandes (`components/Pin.tsx`),
 * así que una clave temporal con letras sería literalmente imposible de teclear
 * en el dispositivo donde hay que teclearla.
 *
 * Que sean cuatro dígitos no deja la cuenta desprotegida, y conviene decir por
 * qué: lo que hace inviable probar claves a lo bruto en este sistema no es la
 * longitud, es el bloqueo por intentos de `security/intentos.ts` —por IP y por
 * cuenta— sumado a las 12 rondas de bcrypt. Y esta clave, además, tiene la vida
 * más corta del sistema: solo sirve para el primer ingreso, porque el servidor
 * no deja jugar hasta que se cambie.
 */
import { randomInt } from "node:crypto";

/**
 * Combinaciones que no se entregan nunca.
 *
 * No es superstición: son las primeras que prueba cualquiera que quiera entrar
 * en la cuenta del compañero, y las primeras que un niño deja puestas si le
 * tocan de salida. Descartarlas cuesta un bucle y quita del mapa el caso
 * realista de ataque en un aula, que no es un script remoto sino el de al lado.
 */
const PROHIBIDAS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "1212", "2121", "0123", "9876",
]);

/**
 * Genera una clave temporal de cuatro dígitos.
 *
 * Usa `randomInt` de `node:crypto` y no `Math.random()`: el generador de
 * JavaScript es predecible a partir de sus salidas, y aquí la salida es la
 * credencial de la cuenta de un niño. Con solo 10 000 combinaciones, un
 * generador adivinable convierte «cuatro dígitos» en «ninguno».
 */
export function generarClaveTemporal(): string {
  for (;;) {
    const clave = String(randomInt(0, 10_000)).padStart(4, "0");
    if (!PROHIBIDAS.has(clave)) return clave;
  }
}
