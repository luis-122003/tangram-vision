/**
 * password.routes.ts — cambio de la contraseña propia.
 *
 * Existe porque sin esto todo lo demás se cae solo: las cuentas se siembran con
 * la clave `1234` y hasta ahora no había ninguna forma de cambiarla desde la
 * aplicación. Se puede cifrar el correo, firmar los tokens y limitar los
 * intentos, que si la clave del docente sigue siendo la de la demostración el
 * resto del trabajo de autenticación no protege nada.
 *
 * Va en su propio archivo y no en `auth.routes.ts` porque aquello son las tres
 * rutas del ciclo del token —entrar, refrescar, salir—, y esto es una operación
 * sobre la cuenta, ya autenticado.
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { buscarPorId, cambiarClave, revocarSesiones } from "../db/users.js";
import { exigirSesion } from "../auth/middleware.js";
import { HttpError, noAutorizado } from "../http/errors.js";

export const rutasClave = Router();

/**
 * El mínimo son 4 caracteres, no 8.
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
const esquemaClave = z.object({
  current_password: z.string().min(1, "Falta la contraseña actual").max(200),
  new_password: z
    .string()
    .min(4, "La contraseña nueva debe tener al menos 4 caracteres")
    .max(200),
});

/**
 * Cambia la contraseña del usuario del token.
 *
 * Se pide la actual aunque ya haya sesión iniciada: si alguien deja el teléfono
 * desbloqueado sobre la mesa, no debe poder quedarse con la cuenta de su
 * compañero con dos toques. Y al terminar se revocan **todas** las sesiones,
 * porque cambiar la clave suele significar «sospecho que alguien más entró», y
 * dejar vivos los tokens que ya tenía ese alguien vaciaría el gesto de sentido.
 * La consecuencia buscada es que haya que volver a entrar en todos los
 * dispositivos, incluido este.
 */
rutasClave.post("/password", exigirSesion, async (req, res) => {
  const { current_password, new_password } = esquemaClave.parse(req.body);

  const identidad = req.usuario;
  if (!identidad) throw noAutorizado();

  // Se relee de la base en vez de fiarse del token: el hash contra el que hay
  // que comparar es el de ahora, no el de cuando se inició la sesión.
  const usuario = await buscarPorId(identidad.id);
  if (!usuario) throw noAutorizado("Tu sesión ya no es válida.");

  /**
   * Es un 422 y no un 401, y la diferencia no es de estilo.
   *
   * Un 401 en esta API significa «tu sesión ya no vale, vuelve a entrar», y los
   * clientes lo tratan así: cierran la sesión y devuelven al ingreso. Usarlo
   * también para «te equivocaste de dígito» obligaba a la app a distinguir dos
   * cosas indistinguibles desde fuera, y la única forma de hacerlo era dejar de
   * atender **todos** los 401 de esta ruta. Con eso, un niño al que el docente
   * le acababa de regenerar la clave —lo que revoca sus sesiones— se quedaba
   * atrapado: cada intento devolvía un 401 de sesión que la app le enseñaba
   * como si hubiera tecleado mal, en bucle y sin salida.
   *
   * Con un 422 aquí, el 401 vuelve a significar una sola cosa en toda la API.
   */
  if (!(await bcrypt.compare(current_password, usuario.password_hash))) {
    throw new HttpError(422, "La contraseña actual no es correcta");
  }

  // Cambiarla por la misma no cambia nada y, sin embargo, cerraría la sesión en
  // todos los dispositivos: mejor decirlo que dejar al niño fuera por nada.
  if (current_password === new_password) {
    throw new HttpError(422, "La contraseña nueva tiene que ser distinta de la actual");
  }

  /**
   * Se revoca **antes** de cambiar, y no después.
   *
   * Son dos `UPDATE` sueltos, así que hay que elegir qué queda si el segundo
   * falla. Cambiando primero, un fallo al revocar deja la clave nueva puesta y
   * los tokens viejos vivos: exactamente el estado que este endpoint existe
   * para evitar. Revocando primero, un fallo al cambiar deja al usuario fuera
   * de sus dispositivos con su clave de siempre, que es un estorbo y no un
   * agujero: vuelve a entrar y lo intenta otra vez.
   *
   * Y `cambiarClave` sin el tercer parámetro deja `must_change_password` en 0:
   * la clave temporal deja de serlo en el mismo `UPDATE` que la sustituye, sin
   * una segunda consulta que pudiera quedarse a medias.
   */
  await revocarSesiones(usuario.id);
  await cambiarClave(usuario.id, new_password);

  res.json({
    ok: true,
    // Se avisa explícitamente para que el cliente pueda llevar al niño a la
    // pantalla de inicio de sesión en vez de dejarlo dando vueltas con un token
    // que acaba de dejar de valer.
    detail: "Contraseña actualizada. Vuelve a iniciar sesión en tus dispositivos.",
  });
});
