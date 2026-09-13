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
import { cifrar, descifrarSeguro, indiceCiego } from "../security/crypto.js";
import type { EstudianteResumen, Usuario, UsuarioFila } from "../types.js";

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
    // MySQL devuelve TINYINT como number, y `=== 1` es deliberado frente a un
    // `Boolean(...)`: una columna añadida por la migración llega como 0, y un
    // truthy suelto sobre `null` —si alguien la dejara nullable a mano— habría
    // dejado a toda la clase sin poder jugar.
    must_change_password: fila.must_change_password === 1,
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
export async function cambiarClave(
  userId: number,
  claveNueva: string,
  /**
   * La clave que se guarda es provisional: la puso el docente, no el dueño de
   * la cuenta. Marcarlo aquí y no en quien llama es lo que impide que un alta
   * nueva se olvide de marcarlo y entregue una cuenta que nunca pide cambiarla.
   */
  temporal = false,
): Promise<void> {
  const hash = await bcrypt.hash(claveNueva, RONDAS_BCRYPT);
  await pool.query(
    "UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?",
    [hash, temporal ? 1 : 0, userId],
  );
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

// ─── Gestión de estudiantes (panel del docente) ───────────────────────────────

/**
 * Todos los estudiantes con su progreso, para el panel del docente.
 *
 * El nombre y el correo están cifrados, así que no se puede ordenar por nombre
 * en MySQL: se ordena por `created_at` en la consulta y, si hace falta orden
 * alfabético, se ordena aquí ya descifrado. Es el precio de cifrar los datos
 * personales, y se paga sobre una lista del tamaño de un curso.
 *
 * Las cuentas de docente no salen: este panel administra estudiantes, y ofrecer
 * un botón de borrar junto a la cuenta con la que se está mirando la pantalla
 * es una forma rebuscada de quedarse sin sistema.
 */
export async function listarEstudiantes(): Promise<EstudianteResumen[]> {
  // El recuento va con una subconsulta agregada y no con un `JOIN ... GROUP BY`
  // sobre las filas de `sessions`: así el agrupamiento ocurre una vez sobre la
  // tabla de intentos y no se multiplica por cada estudiante.
  const [filas] = await pool.query<any[]>(
    `SELECT u.id, u.email_enc, u.name_enc, u.must_change_password, u.created_at,
            COALESCE(s.attempts, 0) AS attempts,
            COALESCE(s.passed, 0)   AS passed,
            s.last_attempt
     FROM users u
     LEFT JOIN (
       SELECT student_id,
              COUNT(*)              AS attempts,
              SUM(match_result = 1) AS passed,
              MAX(created_at)       AS last_attempt
       FROM sessions GROUP BY student_id
     ) s ON s.student_id = u.id
     WHERE u.role = 'student'
     ORDER BY u.created_at DESC, u.id DESC`,
  );

  return filas.map(f => ({
    id: f.id,
    // `descifrarSeguro` y no `descifrar`: una sola fila ilegible —una clave
    // rotada a medias— no puede dejar al docente sin lista.
    name: descifrarSeguro(f.name_enc) ?? "—",
    email: descifrarSeguro(f.email_enc) ?? "—",
    must_change_password: f.must_change_password === 1,
    created_at: f.created_at,
    attempts: Number(f.attempts ?? 0),
    passed: Number(f.passed ?? 0),
    last_attempt: f.last_attempt ?? null,
  }));
}

/** Un estudiante concreto, con su progreso. Null si no existe o no es estudiante. */
export async function buscarEstudiante(id: number): Promise<EstudianteResumen | null> {
  const todos = await listarEstudiantes();
  return todos.find(e => e.id === id) ?? null;
}

/**
 * Da de alta un estudiante.
 *
 * Devuelve solo el id: la clave en claro la conoce quien la generó y la va a
 * enseñar una vez en pantalla, y no tiene por qué volver a salir de aquí.
 *
 * `temporal` distingue los dos caminos del alta, y la diferencia es de
 * intención, no de seguridad: una clave que **generó el servidor** nace marcada
 * como temporal porque nadie la eligió —el niño tiene que cambiarla por una
 * suya—, mientras que una que **escribió el docente** es ya la contraseña de la
 * cuenta y obligar a cambiarla la convertiría en un trámite de un solo uso. En
 * los dos casos se guarda únicamente el hash.
 *
 * El correo único lo garantiza el índice `uk_users_email_hash` de la base, no
 * una consulta previa: entre el `SELECT` de comprobación y el `INSERT` cabe
 * otra alta con el mismo correo, y el índice es el único que no se equivoca.
 * Quien llama traduce el `ER_DUP_ENTRY` a un mensaje (ver `esCorreoDuplicado`).
 */
export async function crearEstudiante(
  nombre: string, correo: string, clave: string, temporal = true,
): Promise<number> {
  const hash = await bcrypt.hash(clave, RONDAS_BCRYPT);
  const [res] = await pool.query<any>(
    `INSERT INTO users
       (email_hash, email_enc, name_enc, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, 'student', ?)`,
    [indiceCiego(correo), cifrar(correo), cifrar(nombre), hash, temporal ? 1 : 0],
  );
  return Number(res.insertId);
}

/** ¿El fallo de MySQL es «ese correo ya está dado de alta»? */
export function esCorreoDuplicado(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ER_DUP_ENTRY";
}

/**
 * Cambia el nombre y/o el correo de un estudiante.
 *
 * Cambiar el correo obliga a rehacer las dos columnas a la vez —el cifrado y su
 * índice ciego—, y por eso no se pueden actualizar por separado: con el índice
 * viejo y el correo nuevo, la cuenta deja de encontrarse en el login y nadie
 * sabría por qué.
 *
 * Devuelve false si no existe o no es un estudiante, que es lo que convierte
 * `/students/:id` en un 404 en vez de un «ok» sobre una fila que no se tocó.
 */
export async function actualizarEstudiante(
  id: number, cambios: { nombre?: string; correo?: string },
): Promise<boolean> {
  const campos: string[] = [];
  const valores: unknown[] = [];

  if (cambios.nombre !== undefined) {
    campos.push("name_enc = ?");
    valores.push(cifrar(cambios.nombre));
  }
  if (cambios.correo !== undefined) {
    campos.push("email_enc = ?", "email_hash = ?");
    valores.push(cifrar(cambios.correo), indiceCiego(cambios.correo));
  }
  if (campos.length === 0) return true;

  valores.push(id);
  const [res] = await pool.query<any>(
    `UPDATE users SET ${campos.join(", ")} WHERE id = ? AND role = 'student'`,
    valores,
  );
  // `affectedRows` y no `changedRows`: guardar el mismo nombre que ya tenía es
  // una edición válida, y `changedRows` la contaría como si la fila no
  // existiera. Además el cifrado es distinto en cada llamada (IV aleatorio),
  // así que los dos números ni siquiera coincidirían.
  return Number(res.affectedRows) > 0;
}

/**
 * Da de baja a un estudiante.
 *
 * Sus intentos se van con él: `sessions` tiene `ON DELETE CASCADE`. Es lo que
 * se quiere —los datos de un niño que sale del curso no tienen por qué
 * quedarse—, pero conviene que quien llama lo advierta en pantalla, porque es
 * irreversible y el docente está mirando esas cifras.
 */
export async function eliminarEstudiante(id: number): Promise<boolean> {
  const [res] = await pool.query<any>(
    "DELETE FROM users WHERE id = ? AND role = 'student'",
    [id],
  );
  return Number(res.affectedRows) > 0;
}
