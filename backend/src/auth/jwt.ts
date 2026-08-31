/**
 * jwt.ts — emisión y verificación de los tokens de sesión.
 *
 * Hay dos tokens, con secretos distintos y vidas distintas:
 *
 *   · **acceso** (1 h) viaja en cada petición y es el que se guarda en el
 *     dispositivo. Como es el que más se expone, dura poco.
 *   · **refresco** (12 h) solo se usa contra `/token/refresh` para obtener uno
 *     de acceso nuevo. Es lo que sostiene la jornada de clase sin pedirle la
 *     clave otra vez al niño.
 *
 * Ambos llevan `ver`, la versión de sesión del usuario. Subirla en la base
 * invalida de golpe todos los tokens ya emitidos, y es lo que permite revocar
 * sin llevar una lista de tokens vivos.
 *
 * La versión anterior devolvía en `/token` la cadena `demo-{id}`, que ningún
 * endpoint llegaba a comprobar: bastaba conocer la URL para leer las sesiones
 * de todo el curso.
 */
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { Rol } from "../types.js";

export interface Identidad {
  id: number;
  name: string;
  role: Rol;
  /** Versión de sesión con la que se emitió el token. */
  ver: number;
}

interface Contenido extends jwt.JwtPayload {
  name: string;
  role: Rol;
  ver: number;
  typ: "access" | "refresh";
}

/**
 * `issuer` y `audience` se firman y se comprueban: un token emitido por otro
 * sistema que compartiera secreto por accidente no valdría aquí.
 */
const EMISOR = "tangram-ia";
const AUDIENCIA = "tangram-app";

function firmar(
  identidad: Identidad,
  tipo: "access" | "refresh",
  secreto: string,
  expira: string,
): string {
  return jwt.sign(
    { name: identidad.name, role: identidad.role, ver: identidad.ver, typ: tipo },
    secreto,
    {
      subject: String(identidad.id),
      expiresIn: expira as jwt.SignOptions["expiresIn"],
      issuer: EMISOR,
      audience: AUDIENCIA,
    },
  );
}

export function firmarAcceso(identidad: Identidad): string {
  return firmar(identidad, "access", config.jwt.secreto, config.jwt.expiraEn);
}

export function firmarRefresco(identidad: Identidad): string {
  return firmar(identidad, "refresh", config.jwt.refrescoSecreto, config.jwt.refrescoExpiraEn);
}

/**
 * Segundos que le quedan de vida a un token de acceso recién emitido.
 *
 * Antes, un formato no reconocido devolvía 3600 en silencio mientras `jwt.sign`
 * firmaba con otra duración: el `expires_in` que recibía el cliente era mentira
 * y la app refrescaba tarde. Ahora el formato lo garantiza `config.ts` al
 * arrancar, así que llegar aquí sin poder interpretarlo es un fallo de
 * programación y se dice en voz alta en vez de inventarse una cifra.
 */
export function segundosDeVida(): number {
  const m = /^(\d+)([smhd])$/.exec(config.jwt.expiraEn);
  if (!m) {
    throw new Error(`JWT_EXPIRES_IN no interpretable: "${config.jwt.expiraEn}"`);
  }
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
}

function verificar(
  token: string, secreto: string, tipoEsperado: "access" | "refresh",
): Identidad | null {
  try {
    const contenido = jwt.verify(token, secreto, {
      issuer: EMISOR,
      audience: AUDIENCIA,
      algorithms: ["HS256"],   // fijado: sin esto, un token con alg 'none' podría colarse
    }) as Contenido;

    // Un token de refresco no puede usarse como token de acceso. Sin esta
    // comprobación, el de refresco —que vive mucho más— serviría para llamar a
    // toda la API.
    if (contenido.typ !== tipoEsperado) return null;

    const id = Number(contenido.sub);
    if (!Number.isInteger(id) || id <= 0) return null;

    return {
      id,
      name: contenido.name,
      role: contenido.role,
      ver: Number(contenido.ver ?? 0),
    };
  } catch {
    return null;
  }
}

/** Devuelve la identidad del token de acceso, o null si no es válido. */
export function verificarAcceso(token: string): Identidad | null {
  return verificar(token, config.jwt.secreto, "access");
}

/** Devuelve la identidad del token de refresco, o null si no es válido. */
export function verificarRefresco(token: string): Identidad | null {
  return verificar(token, config.jwt.refrescoSecreto, "refresh");
}
