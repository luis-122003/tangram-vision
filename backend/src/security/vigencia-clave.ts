/**
 * vigencia-clave.ts — cuánto lleva puesta una clave y cuándo toca cambiarla.
 *
 * El sistema ya no recupera claves por correo (ver `routes/password.routes.ts`),
 * así que la única defensa que queda frente a una clave que lleva un año puesta
 * —apuntada en un papel, escrita delante de una clase, reutilizada de otro
 * sitio— es pedir que se renueve cada tanto. Un mes es el plazo que se usa aquí.
 *
 * **Solo afecta al docente**, y la asimetría es deliberada. Su cuenta ve los
 * datos de todo el curso y él escribe en un teclado completo. El estudiante
 * teclea su clave en un teclado de diez teclas dentro de la app, y obligarle a
 * inventarse una nueva cada mes termina en la misma clave con un número detrás,
 * o apuntada en el pupitre: más rotación y menos secreto, que es justo lo
 * contrario de lo que se busca.
 *
 * Los días se cuentan completos y hacia abajo: una clave puesta hace veintitrés
 * horas lleva «0 días», que es lo que diría cualquiera mirando el calendario.
 */
import type { Rol } from "../types.js";

/** Días que vale una clave de docente antes de que el servidor pida otra. */
export const DIAS_VIGENCIA_CLAVE = 30;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Días completos desde el último cambio. `null` si la cuenta no tiene fecha,
 * que solo puede pasar si alguien dejó la columna a NULL a mano.
 *
 * Un futuro —reloj del servidor movido hacia atrás, fila editada— se devuelve
 * como 0 y no como un negativo: lo que importa aquí es no inventarse una
 * antigüedad, y desde luego no una caducidad.
 */
export function diasDeClave(desde: Date | null): number | null {
  if (!desde) return null;
  const transcurrido = Date.now() - desde.getTime();
  if (!Number.isFinite(transcurrido) || transcurrido < 0) return 0;
  return Math.floor(transcurrido / MS_POR_DIA);
}

/**
 * ¿Pasó ya el mes?
 *
 * Sin fecha devuelve `false`, no `true`. Es la decisión conservadora a
 * propósito: una columna rara dejaría al docente fuera de su propio panel sin
 * que nada le explique por qué, y eso es peor que un mes de más.
 */
export function claveCaducada(desde: Date | null, rol: Rol): boolean {
  if (rol !== "teacher") return false;
  const dias = diasDeClave(desde);
  return dias !== null && dias >= DIAS_VIGENCIA_CLAVE;
}
