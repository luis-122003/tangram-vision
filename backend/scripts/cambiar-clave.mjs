/**
 * cambiar-clave.mjs — fija una clave nueva a una cuenta que ya existe.
 *
 *   En el servidor:  docker compose exec backend node scripts/cambiar-clave.mjs <correo>
 *   En local:        npm run build && node scripts/cambiar-clave.mjs <correo>
 *
 * Es la salida para cuando la clave se perdió y no se puede recuperar por la
 * aplicación: el docente que no entra a su panel, o una cuenta de demostración
 * cuya clave llegó a estar escrita en un sitio público. El camino normal sigue
 * siendo `POST /password` desde la web o la app, que pide la clave actual.
 *
 * Al terminar **revoca las sesiones abiertas** de esa cuenta (sube su
 * `token_version`). Es la mitad que importa: cambiar la clave sin esto deja
 * entrando a quien ya tuviera un token, que es justo de quien se quiere
 * recuperar la cuenta.
 *
 * La clave nueva no queda marcada como temporal: la escribe aquí quien
 * administra el servidor y es ya la contraseña de la cuenta.
 */
import { pool } from "../dist/db/pool.js";
import { cambiarClave, revocarSesiones } from "../dist/db/users.js";
import { descifrar, indiceCiego } from "../dist/security/crypto.js";
import { cerrar, normalizarCorreo, pedirClave } from "./_consola.mjs";

const correo = normalizarCorreo(process.argv[2]);

if (!correo) {
  console.error("Uso: node scripts/cambiar-clave.mjs <correo>");
  console.error("Para ver qué cuentas hay: node scripts/listar-cuentas.mjs");
  process.exit(1);
}

try {
  const [filas] = await pool.query(
    "SELECT id, name_enc, role FROM users WHERE email_hash = ?",
    [indiceCiego(correo)],
  );

  if (filas.length === 0) {
    console.error(`No hay ninguna cuenta con ${correo}.`);
    console.error("Compruébalo con: node scripts/listar-cuentas.mjs");
    process.exitCode = 1;
  } else {
    const { id, role } = filas[0];
    let nombre = "";
    try { nombre = descifrar(filas[0].name_enc); } catch { nombre = "(nombre ilegible)"; }

    const esDocente = role === "teacher";
    console.log(`Cuenta #${id} · ${esDocente ? "docente" : "estudiante"} · ${nombre}`);

    // Al docente se le exigen 12 caracteres y al estudiante 4, la misma
    // diferencia que hace el resto del sistema: el docente ve los datos de
    // todo el curso y escribe en un teclado completo.
    const clave = await pedirClave(esDocente ? 12 : 4);

    await cambiarClave(id, clave, false);
    await revocarSesiones(id);
    console.log(`[OK] Clave cambiada. Las sesiones abiertas de ${correo} quedaron cerradas.`);
  }
} catch (error) {
  console.error("[!] No se pudo cambiar la clave:", error.message);
  process.exitCode = 1;
} finally {
  cerrar();
  await pool.end();
}
