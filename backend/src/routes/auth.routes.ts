/**
 * auth.routes.ts — inicio de sesión, registro, refresco y cierre.
 *
 * `/token` recibe el formulario en `application/x-www-form-urlencoded` con los
 * campos `username` y `password`, y no JSON. Es herencia del
 * `OAuth2PasswordRequestForm` de FastAPI, y se conserva porque los dos clientes
 * ya envían así sus credenciales. La respuesta mantiene su forma exacta y suma
 * dos campos: el token de refresco y cuánto dura el de acceso.
 *
 * `/register` es la otra puerta de entrada: el estudiante se crea la cuenta
 * desde la app y sale ya con sesión abierta, con la misma respuesta que
 * `/token`. Va aquí y no en `students.routes.ts` porque aquello es el panel
 * del docente —todo detrás de `exigirDocente`— y esto lo llama alguien que
 * todavía no tiene ninguna cuenta con la que autenticarse.
 */
import { Router } from "express";
import { z } from "zod";
import {
  buscarPorId, crearEstudiante, esCorreoDuplicado, revocarSesiones, verificarUsuario,
} from "../db/users.js";
import { firmarAcceso, firmarRefresco, segundosDeVida, verificarRefresco } from "../auth/jwt.js";
import { exigirSesion } from "../auth/middleware.js";
import { comprobarIntentos, limpiarTrasExito, registrarIntento } from "../security/intentos.js";
import { indiceCiego } from "../security/crypto.js";
import { limiteLogin, limiteRegistro } from "../security/headers.js";
import { esClaveTrivial } from "../security/clave-temporal.js";
import { config } from "../config.js";
import { HttpError, noAutorizado, prohibido } from "../http/errors.js";
import { esquemaDatosEstudiante, reglaClave } from "./esquemas.js";
import type { Request } from "express";
import type { Usuario } from "../types.js";

export const rutasAuth = Router();

/**
 * La respuesta con la que se abre una sesión.
 *
 * La comparten `/token` y `/register` a propósito: la app móvil lee de las dos
 * exactamente los mismos campos, y con dos literales separados el día que se
 * añadiera uno al ingreso el registro se quedaría sin él y nadie lo notaría
 * hasta que un niño recién registrado viera una pantalla en blanco.
 */
function respuestaDeSesion(usuario: Usuario) {
  const identidad = {
    id: usuario.id, name: usuario.name, role: usuario.role, ver: usuario.token_version,
  };
  return {
    access_token: firmarAcceso(identidad),
    refresh_token: firmarRefresco(identidad),
    token_type: "bearer",
    expires_in: segundosDeVida(),
    role: usuario.role,
    name: usuario.name,
    id: usuario.id,
    /**
     * La cuenta todavía tiene la clave temporal que le puso el docente.
     *
     * Viaja en la respuesta del ingreso, y no dentro del token, porque el
     * cliente tiene que saberlo **ahora** para llevar al estudiante a cambiarla
     * en vez de al catálogo. Que el servidor además lo impida por su cuenta
     * (ver `exigirClaveDefinitiva`) es lo que hace que este campo sea una
     * comodidad de la interfaz y no la única barrera.
     */
    must_change_password: usuario.must_change_password,
  };
}

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

  res.json(respuestaDeSesion(usuario));
});

/**
 * Nombre, correo y clave con los que el estudiante se registra.
 *
 * Son las mismas reglas del alta que hace el docente (`esquemas.ts`), con una
 * diferencia: aquí la clave es obligatoria. No hay nadie a quien enseñarle una
 * clave generada, así que la elige quien va a usarla.
 */
const esquemaRegistro = esquemaDatosEstudiante.extend({ password: reglaClave });

/**
 * Registro desde la app: el estudiante se crea la cuenta y entra en el acto.
 *
 * La cuenta nace **sin** clave temporal —`must_change_password = 0`— porque la
 * clave la eligió su dueño: obligarle a cambiarla en la pantalla siguiente
 * sería pedirle dos veces lo mismo. Y nace con el rol de estudiante y con
 * ningún otro: el rol no viene en el cuerpo ni se lee de él, así que por esta
 * puerta no se puede entrar como docente.
 *
 * Responde 201 con la misma forma que `/token`. La app no tiene que hacer un
 * segundo viaje para entrar, y cualquier campo que lea del ingreso lo tiene
 * también aquí (ver `respuestaDeSesion`).
 *
 * El correo repetido llega como 409, igual que en el alta del docente. Es el
 * único caso en que se confirma que un correo existe, y se asume a propósito:
 * el estudiante que se registra dos veces necesita saber que tiene que entrar
 * y no volver a registrarse, y la alternativa —crear una cuenta duplicada o
 * fallar sin decir por qué— le deja peor. Lo que sí queda tapado es el ingreso:
 * ahí sigue sin distinguirse «no existe» de «clave mala».
 */
rutasAuth.post("/register", limiteRegistro, async (req, res) => {
  if (!config.registroAbierto) {
    throw prohibido(
      "El registro desde la app está cerrado. Pídele tu cuenta al docente.",
    );
  }

  const { name, email, password } = esquemaRegistro.parse(req.body);

  // Mismo criterio que el generador de claves temporales: lo que el servidor
  // se niega a repartir tampoco lo acepta cuando lo escribe un niño.
  if (esClaveTrivial(password)) {
    throw new HttpError(422, "Esa clave es muy fácil de adivinar. Elige otra.");
  }

  let id: number;
  try {
    id = await crearEstudiante(name, email, password, false);
  } catch (error) {
    if (esCorreoDuplicado(error)) {
      throw new HttpError(409, "Ya hay una cuenta con ese correo. Entra con tu clave.");
    }
    throw error;
  }

  // Se relee de la base y no se arma a mano: la fila recién insertada es la
  // que dice qué versión de sesión y qué nombre —ya recortado— lleva el token.
  const usuario = await buscarPorId(id);
  if (!usuario) throw new HttpError(500, "La cuenta se creó pero no se pudo leer");

  res.status(201).json(respuestaDeSesion(usuario));
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
    /**
     * Va también aquí para que la respuesta del refresco describa la cuenta tal
     * como está, y no como estaba al entrar. En la práctica un cliente rara vez
     * lo verá cambiar: regenerar la clave desde el panel revoca las sesiones,
     * así que el refresco de ese usuario falla antes de llegar a esta línea. Es
     * el estado de la cuenta, no una notificación.
     */
    must_change_password: usuario.must_change_password,
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
