/**
 * auth.routes.ts — inicio de sesión, refresco y cierre.
 *
 * `/token` recibe el formulario en `application/x-www-form-urlencoded` con los
 * campos `username` y `password`, y no JSON. Es herencia del
 * `OAuth2PasswordRequestForm` de FastAPI, y se conserva porque los dos clientes
 * ya envían así sus credenciales. La respuesta mantiene su forma exacta y suma
 * dos campos: el token de refresco y cuánto dura el de acceso.
 */
import { Router } from "express";
import { z } from "zod";
import { revocarSesiones, verificarUsuario, buscarPorId } from "../db/users.js";
import { firmarAcceso, firmarRefresco, segundosDeVida, verificarRefresco } from "../auth/jwt.js";
import { exigirSesion } from "../auth/middleware.js";
import { comprobarIntentos, limpiarTrasExito, registrarIntento } from "../security/intentos.js";
import { indiceCiego } from "../security/crypto.js";
import { limiteLogin } from "../security/headers.js";
import { HttpError, noAutorizado } from "../http/errors.js";
import type { Request } from "express";

export const rutasAuth = Router();

/**
 * Correo y contraseña con topes de longitud.
 *
 * El de la contraseña no es cosmético: bcrypt trunca en 72 bytes, así que
 * aceptar cadenas de megabytes solo sirve para gastar CPU en balde y abrir la
 * puerta a saturar el servidor a base de intentos costosos.
 */
const esquemaLogin = z.object({
  username: z.string().min(1, "Falta el correo").max(254).trim(),
  password: z.string().min(1, "Falta la contraseña").max(200),
});

/** IP del cliente. Depende de `trust proxy`, configurado con TRUST_PROXY. */
function ipDe(req: Request): string {
  return req.ip ?? "desconocida";
}

rutasAuth.post("/token", limiteLogin, async (req, res) => {
  const { username, password } = esquemaLogin.parse(req.body);

  const ip = ipDe(req);
  // La cuenta se identifica por su índice ciego: el registro de intentos no
  // tiene por qué guardar correos.
  const cuentaHash = indiceCiego(username);

  const veredicto = await comprobarIntentos(ip, cuentaHash);
  if (!veredicto.permitido) {
    const minutos = Math.ceil(veredicto.esperaSegundos / 60);
    throw new HttpError(
      429,
      `Demasiados intentos fallidos. Espera ${minutos === 1 ? "un minuto" : `${minutos} minutos`} ` +
      "antes de volver a intentarlo.",
    );
  }

  const usuario = await verificarUsuario(username, password);
  if (!usuario) {
    await registrarIntento(ip, cuentaHash, false);
    // Mismo mensaje siempre: ni una pista de si falló el correo o la clave.
    //
    // El código es 401 y no 400: un 400 dice «la petición está mal formada» y
    // la petición está perfectamente formada —lo que no cuadran son las
    // credenciales—. La diferencia importa para los clientes, que tratan el 401
    // como «hay que volver a pedir la contraseña» y el 400 como un error de
    // programación que no sabrían mostrarle al usuario.
    throw noAutorizado("Credenciales incorrectas");
  }

  await limpiarTrasExito(ip, cuentaHash);

  const identidad = {
    id: usuario.id, name: usuario.name, role: usuario.role, ver: usuario.token_version,
  };
  res.json({
    access_token: firmarAcceso(identidad),
    refresh_token: firmarRefresco(identidad),
    token_type: "bearer",
    expires_in: segundosDeVida(),
    role: usuario.role,
    name: usuario.name,
    id: usuario.id,
  });
});

/**
 * Cambia un token de refresco por uno de acceso nuevo.
 *
 * Se vuelve a leer el usuario de la base para comprobar que sigue existiendo y
 * que su versión de sesión no ha cambiado: si alguien cerró sesión en todos los
 * dispositivos, el refresco tampoco debe funcionar.
 */
rutasAuth.post("/token/refresh", async (req, res) => {
  const { refresh_token } = z
    .object({ refresh_token: z.string().min(1, "Falta el token de refresco").max(4096) })
    .parse(req.body);

  const identidad = verificarRefresco(refresh_token);
  if (!identidad) throw noAutorizado("Tu sesión expiró. Vuelve a iniciar sesión.");

  const usuario = await buscarPorId(identidad.id);
  if (!usuario || usuario.token_version !== identidad.ver) {
    throw noAutorizado("Tu sesión se cerró. Vuelve a iniciar sesión.");
  }

  const actual = {
    id: usuario.id, name: usuario.name, role: usuario.role, ver: usuario.token_version,
  };
  res.json({
    access_token: firmarAcceso(actual),
    token_type: "bearer",
    expires_in: segundosDeVida(),
  });
});

/**
 * Cierra la sesión en **todos** los dispositivos.
 *
 * Sube la versión de sesión del usuario, con lo que cualquier token ya emitido
 * —de acceso o de refresco— deja de valer al instante. Es lo que hay que llamar
 * si un teléfono se pierde o si una cuenta se ve comprometida.
 */
rutasAuth.post("/logout", exigirSesion, async (req, res) => {
  if (req.usuario) await revocarSesiones(req.usuario.id);
  res.json({ ok: true });
});
