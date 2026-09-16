/**
 * esquemas.ts — las reglas de nombre, correo y clave de una cuenta de estudiante.
 *
 * Viven aparte porque las leen dos rutas que crean la misma fila de `users`
 * por caminos distintos: el alta que hace el docente desde su panel
 * (`POST /students`) y el registro que hace el propio estudiante desde la app
 * (`POST /register`). Con una copia en cada archivo, subir el mínimo del nombre
 * en una y olvidar la otra dejaría dos cuentas «iguales» validadas con reglas
 * distintas, y nadie lo notaría hasta que un correo entrara por un lado y no
 * por el otro.
 */
import { z } from "zod";

/**
 * El mínimo de la clave son 4 caracteres, no 8.
 *
 * No es dejadez: quien escribe aquí es un niño de primaria en la pantalla de un
 * teléfono, y un mínimo que no pueda cumplir acaba en una clave apuntada en el
 * pupitre, que protege bastante menos. Lo que sostiene la seguridad de la cuenta
 * en este sistema es el bloqueo por intentos (`security/intentos.ts`), que hace
 * inviable probar claves a lo bruto aunque sean cortas.
 *
 * El tope de 200 sí es técnico: bcrypt trunca en 72 bytes y aceptar cadenas
 * enormes solo sirve para gastar CPU.
 */
export const reglaClave = z
  .string()
  .min(4, "La clave debe tener al menos 4 caracteres")
  .max(200);

/**
 * Nombre y correo del estudiante.
 *
 * El tope del correo son 254 caracteres porque es el máximo que admite una
 * dirección de correo; el del nombre es holgado a propósito, que los apellidos
 * compuestos existen. El `trim` va dentro del esquema y no en el manejador para
 * que lo que se valide sea exactamente lo que se va a guardar: sin él, un
 * nombre de un solo espacio pasaba el `min(2)` y quedaba en blanco en la lista.
 */
export const esquemaDatosEstudiante = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Ese correo no tiene un formato válido")
    .max(254),
});
