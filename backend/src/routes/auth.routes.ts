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
 * desde la app, recibe un código de seis dígitos en su correo y, al escribirlo
 * en `/register/verify`, sale con sesión abierta y la misma respuesta que
 * `/token`. Va aquí y no en `students.routes.ts` porque aquello es el panel
 * del docente —todo detrás de `exigirDocente`— y esto lo llama alguien que
 * todavía no tiene ninguna cuenta con la que autenticarse.
 */
import { Router } from "express";
import { z } from "zod";
import {
  buscarPorEmail, buscarPorId, crearEstudiante, esCorreoDuplicado, marcarVerificado,
  rehacerPendiente, revocarSesiones, verificarUsuario,
} from "../db/users.js";
import { firmarAcceso, firmarRefresco, segundosDeVida, verificarRefresco } from "../auth/jwt.js";
import { exigirSesion } from "../auth/middleware.js";
import { comprobarIntentos, limpiarTrasExito, registrarIntento } from "../security/intentos.js";
import { indiceCiego } from "../security/crypto.js";
import { limiteCorreo, limiteLogin, limiteRegistro } from "../security/headers.js";
import { consumirCodigo, descartarCodigos, emitirCodigo } from "../security/codigos.js";
import { enviarCorreo } from "../mail/transporte.js";
import { correoVerificacion } from "../mail/plantillas.js";
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
 * La comparten `/token` y `/register/verify` a propósito: la app móvil lee de las dos
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
export function ipDe(req: Request): string {
  return req.ip ?? "desconocida";
}

/**
 * Claves con las que se cuentan los fallos al escribir un código de correo.
 *
 * Usan la tabla y la escala de bloqueo de `intentos.ts`, pero con
 * identificadores propios: un niño que se equivoca con el código no debe
 * quedarse además sin poder entrar con su clave, ni al revés. Siguen sin
 * guardar el correo en claro: la de la cuenta es otro índice ciego.
 */
export function clavesDeCodigo(req: Request, correo: string): [string, string] {
  return [`c:${ipDe(req)}`, indiceCiego(`codigo:${correo}`)];
}

/** Espera de un bloqueo, en palabras. */
export function textoEspera(segundos: number): string {
  const minutos = Math.ceil(segundos / 60);
  return minutos === 1 ? "un minuto" : `${minutos} minutos`;
}

/** 503 de las rutas que necesitan correo cuando no hay SMTP configurado. */
export function exigirCorreoConfigurado(): void {
  if (!config.smtp.activo) {
    throw new HttpError(
      503,
      "El envío de correos no está configurado en el servidor. Pídele ayuda al docente.",
    );
  }
}

rutasAuth.post("/token", limiteLogin, async (req, res) => {
  const { username, password } = esquemaLogin.parse(req.body);

  const ip = ipDe(req);
  // La cuenta se identifica por su índice ciego: el registro de intentos no
  // tiene por qué guardar correos.
  const cuentaHash = indiceCiego(username);

  const veredicto = await comprobarIntentos(ip, cuentaHash);
  if (!veredicto.permitido) {
    throw new HttpError(
      429,
      `Demasiados intentos fallidos. Espera ${textoEspera(veredicto.esperaSegundos)} ` +
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

  /**
   * Clave correcta, pero el correo sigue sin confirmar.
   *
   * Solo se llega aquí con la clave buena, así que decir que la cuenta existe
   * no le cuenta nada a quien no la conociera ya. El `code` es lo que permite a
   * la app llevar al niño a la pantalla del código en vez de enseñarle un error.
   */
  if (!usuario.email_verified) {
    throw new HttpError(
      403,
      "Todavía no confirmaste tu correo. Escribe el código que te enviamos.",
      "correo_sin_verificar",
    );
  }

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
 * Envía el código de verificación a una cuenta pendiente.
 *
 * Si ya se mandó uno hace menos de `EMAIL_CODE_RESEND`, no se manda otro: el
 * anterior sigue valiendo y basta con esperar a que llegue. Si el envío falla
 * se descarta el código, para que el siguiente intento no tenga que esperar.
 */
async function enviarVerificacion(usuario: Usuario): Promise<void> {
  const emision = await emitirCodigo(usuario.id, "verify");
  if (!emision.ok) return;
  try {
    await enviarCorreo(correoVerificacion(usuario.email, usuario.name, emision.codigo));
  } catch (error) {
    await descartarCodigos(usuario.id, "verify");
    console.error("[correo] no se pudo enviar la verificación:", (error as Error).message);
    throw new HttpError(
      502,
      "No pudimos enviar el correo con tu código. Inténtalo otra vez en un momento.",
    );
  }
}

/**
 * Registro desde la app: el estudiante se crea la cuenta y recibe un código
 * en su correo. **No** sale con sesión: la cuenta queda pendiente hasta que
 * escriba el código en `/register/verify`, que es lo que demuestra que el
 * correo es suyo y no de un compañero.
 *
 * La cuenta nace **sin** clave temporal —`must_change_password = 0`— porque la
 * clave la eligió su dueño: obligarle a cambiarla en la pantalla siguiente
 * sería pedirle dos veces lo mismo. Y nace con el rol de estudiante y con
 * ningún otro: el rol no viene en el cuerpo ni se lee de él, así que por esta
 * puerta no se puede entrar como docente.
 *
 * El correo de una cuenta **ya verificada** llega como 409, igual que en el
 * alta del docente. Es el único caso en que se confirma que un correo existe,
 * y se asume a propósito: el estudiante que se registra dos veces necesita
 * saber que tiene que entrar y no volver a registrarse. El de una cuenta
 * **pendiente** no: nadie ha demostrado ser su dueño, así que se rehace con
 * los datos nuevos y se vuelve a enviar el código (ver `rehacerPendiente`).
 */
rutasAuth.post("/register", limiteRegistro, async (req, res) => {
  if (!config.registroAbierto) {
    throw prohibido(
      "El registro desde la app está cerrado. Pídele tu cuenta al docente.",
    );
  }
  exigirCorreoConfigurado();

  const { name, email, password } = esquemaRegistro.parse(req.body);

  // Mismo criterio que el generador de claves temporales: lo que el servidor
  // se niega a repartir tampoco lo acepta cuando lo escribe un niño.
  if (esClaveTrivial(password)) {
    throw new HttpError(422, "Esa clave es muy fácil de adivinar. Elige otra.");
  }

  const duplicado = () =>
    new HttpError(409, "Ya hay una cuenta con ese correo. Entra con tu clave.");

  const existente = await buscarPorEmail(email);
  let id: number;
  if (existente) {
    if (existente.email_verified || !(await rehacerPendiente(existente.id, name, password))) {
      throw duplicado();
    }
    // El código que hubiera se emitió con la clave anterior: deja de valer, y
    // así el reenvío no tiene que esperar.
    await descartarCodigos(existente.id, "verify");
    id = existente.id;
  } else {
    try {
      id = await crearEstudiante(name, email, password, false, false);
    } catch (error) {
      if (esCorreoDuplicado(error)) throw duplicado();
      throw error;
    }
  }

  // Se relee de la base y no se arma a mano: el nombre ya recortado y el
  // correo normalizado son los de la fila.
  const usuario = await buscarPorId(id);
  if (!usuario) throw new HttpError(500, "La cuenta se creó pero no se pudo leer");

  await enviarVerificacion(usuario);

  res.status(201).json({
    verification_required: true,
    email: usuario.email,
    detail: "Te enviamos un código a tu correo. Escríbelo para activar tu cuenta.",
  });
});

/**
 * Cuerpo de `/register/verify`.
 *
 * Pide también la clave, y no por desconfiar del niño: es lo que cierra el
 * caso en que otra persona registra el mismo correo pendiente con una clave
 * suya. Sin la clave, el dueño del correo podría activar sin saberlo la cuenta
 * con la clave del otro; con ella, la cuenta solo se activa en manos de quien
 * conoce a la vez el código y la clave. La app la tiene en memoria desde la
 * pantalla anterior, así que al niño no se le pide dos veces.
 */
const esquemaVerificar = z.object({
  email: z.string().trim().toLowerCase().min(1, "Falta el correo").max(254),
  password: z.string().min(1, "Falta la clave").max(200),
  code: z.string().trim().regex(/^\d{6}$/, "El código son 6 números"),
});

/** Confirma el correo con el código y abre la sesión. */
rutasAuth.post("/register/verify", limiteCorreo, async (req, res) => {
  const { email, password, code } = esquemaVerificar.parse(req.body);

  const [ip, cuenta] = clavesDeCodigo(req, email);
  const veredicto = await comprobarIntentos(ip, cuenta);
  if (!veredicto.permitido) {
    throw new HttpError(
      429,
      `Demasiados códigos equivocados. Espera ${textoEspera(veredicto.esperaSegundos)}.`,
    );
  }

  const usuario = await verificarUsuario(email, password);
  const valido =
    !!usuario && !usuario.email_verified && (await consumirCodigo(usuario.id, "verify", code));
  if (!usuario || !valido) {
    await registrarIntento(ip, cuenta, false);
    // Un solo mensaje para todo: no se distingue «clave mala» de «código malo»
    // ni de «esa cuenta no existe».
    throw new HttpError(422, "El código no es correcto o ya caducó. Revísalo o pide otro.");
  }

  await limpiarTrasExito(ip, cuenta);
  await marcarVerificado(usuario.id);

  const verificado = await buscarPorId(usuario.id);
  if (!verificado) throw new HttpError(500, "La cuenta se verificó pero no se pudo leer");
  res.json(respuestaDeSesion(verificado));
});

/** Cuerpo de las rutas que solo piden un correo. */
export const esquemaCorreo = z.object({
  email: z.string().trim().toLowerCase().min(1, "Falta el correo").max(254),
});

/**
 * Vuelve a enviar el código de verificación.
 *
 * Responde siempre lo mismo, exista o no una cuenta pendiente con ese correo:
 * esta ruta no puede servir para averiguar quién se registró. Por la misma
 * razón el envío no se espera —tardaría más justo cuando la cuenta existe— y
 * sus fallos solo quedan en el registro del servidor.
 */
rutasAuth.post("/register/resend", limiteCorreo, async (req, res) => {
  exigirCorreoConfigurado();
  const { email } = esquemaCorreo.parse(req.body);

  const usuario = await buscarPorEmail(email);
  if (usuario && !usuario.email_verified) {
    enviarVerificacion(usuario).catch(() => { /* ya quedó en el registro */ });
  }

  res.json({
    ok: true,
    detail: "Si hay una cuenta pendiente con ese correo, te enviamos un código nuevo.",
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
