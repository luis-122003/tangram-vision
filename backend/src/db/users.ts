/**
 * users.ts — acceso a `users` y verificación de credenciales.
 *
 * El nombre y el correo están cifrados en la base, así que ninguna consulta
 * puede filtrar por correo directamente: se busca por su índice ciego y se
 * descifra al salir. Esa traducción vive aquí y solo aquí; el resto del backend
 * trabaja con un `Usuario` normal.
 */
import bcrypt from "bcryptjs";
import { pool } from "./pool.js";
import { descifrarSeguro, indiceCiego } from "../security/crypto.js";
import type { Usuario, UsuarioFila } from "../types.js";

/**
 * Coste del hash de contraseña. Es el punto donde una clave débil deja de poder
 * probarse en masa: con 12 rondas, cada intento cuesta ~200 ms de CPU.
 *
 * Vive aquí, junto al resto del acceso a `users`, para que la siembra inicial
 * (db/schema.ts) y el cambio de contraseña usen el mismo número. Con dos
 * constantes separadas, cambiar una y olvidar la otra deja hashes de dos costes
 * distintos en la misma tabla sin que nada lo avise.
 */
export const RONDAS_BCRYPT = 12;

/**
 * Hash de referencia contra el que se compara cuando el correo no existe.
 *
 * Sin esto, un correo inexistente respondería en un milisegundo y uno real
 * tardaría los ~200 ms de bcrypt, y esa diferencia basta para averiguar qué
 * cuentas hay dadas de alta. Comparar siempre contra un hash real iguala el
 * tiempo. Es un hash de una cadena aleatoria: nunca coincide con nada.
 */
const HASH_SEÑUELO = bcrypt.hashSync("cuenta-inexistente-" + Date.now(), RONDAS_BCRYPT);

/**
 * Pasa la fila cifrada a un `Usuario` legible.
 *
 * Se descifra con `descifrarSeguro`, que devuelve `null` en vez de lanzar, y no
 * es un detalle menor: `buscarPorId` se ejecuta en **cada petición
 * autenticada** desde `auth/middleware.ts`, así que una sola fila ilegible
 * —una clave rotada a medias, un valor tocado a mano en MySQL— tumbaba con un
 * 500 hasta el `/figures` de un usuario que no tiene nada que ver. Sin nombre
 * se puede seguir trabajando; sin poder autenticarse, no.
 */
function descifrarUsuario(fila: UsuarioFila): Usuario {
  return {
    id: fila.id,
    email: descifrarSeguro(fila.email_enc) ?? "—",
    name: descifrarSeguro(fila.name_enc) ?? "—",
    role: fila.role,
    password_hash: fila.password_hash,
    token_version: fila.token_version,
  };
}

export async function buscarPorEmail(email: string): Promise<Usuario | null> {
  const [filas] = await pool.query<any[]>(
    "SELECT * FROM users WHERE email_hash = ? LIMIT 1",
    [indiceCiego(email)],
  );
  return filas[0] ? descifrarUsuario(filas[0] as UsuarioFila) : null;
}

export async function buscarPorId(id: number): Promise<Usuario | null> {
  const [filas] = await pool.query<any[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
  return filas[0] ? descifrarUsuario(filas[0] as UsuarioFila) : null;
}

/**
 * Comprueba correo y contraseña. Devuelve el usuario o null.
 *
 * Tarda lo mismo exista la cuenta o no (ver `HASH_SEÑUELO`), y nunca dice cuál
 * de los dos datos falló: quien lo pregunta desde fuera no tiene por qué poder
 * distinguir «ese correo no existe» de «la contraseña es otra».
 */
export async function verificarUsuario(
  email: string,
  clave: string,
): Promise<Usuario | null> {
  const usuario = await buscarPorEmail(email);
  const hash = usuario?.password_hash ?? HASH_SEÑUELO;
  const correcta = await bcrypt.compare(clave, hash);
  return usuario && correcta ? usuario : null;
}

/**
 * Guarda una contraseña nueva, ya hasheada.
 *
 * Solo se guarda el hash: la contraseña en claro no se registra, ni se devuelve,
 * ni pasa por ninguna otra tabla. Quien llame a esto debe además revocar las
 * sesiones (`revocarSesiones`), o los dispositivos que ya tenían un token
 * seguirían dentro con la clave vieja.
 */
export async function cambiarClave(userId: number, claveNueva: string): Promise<void> {
  const hash = await bcrypt.hash(claveNueva, RONDAS_BCRYPT);
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId]);
}

/**
 * Invalida todas las sesiones abiertas de un usuario.
 *
 * Subir `token_version` deja fuera de juego a cualquier token ya emitido, sin
 * necesidad de llevar una lista de tokens vivos. Es lo que hace utilizable el
 * «cerrar sesión en todos los dispositivos» y lo que hay que ejecutar si una
 * cuenta se ve comprometida.
 */
export async function revocarSesiones(userId: number): Promise<void> {
  await pool.query(
    "UPDATE users SET token_version = token_version + 1 WHERE id = ?",
    [userId],
  );
}
