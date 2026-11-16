/**
 * listar-cuentas.mjs — qué cuentas hay en esta base.
 *
 *   En el servidor:  docker compose exec backend node scripts/listar-cuentas.mjs
 *   En local:        npm run build && node scripts/listar-cuentas.mjs
 *
 * Existe porque un `SELECT` a mano no sirve de nada aquí: el nombre y el correo
 * están cifrados con ENCRYPTION_KEY, y en la tabla se ven como un montón de
 * bytes. Esto los descifra con la misma clave del backend, que es la única
 * forma de saber quién está dado de alta.
 *
 * No muestra ninguna clave —en la base solo hay hashes de bcrypt, no se puede—
 * pero sí dice cuáles siguen con una clave temporal sin estrenar, que es lo que
 * se mira antes de una demostración.
 *
 * Con `--docentes` o `--estudiantes` se filtra por rol.
 */
import { pool } from "../dist/db/pool.js";
import { descifrar } from "../dist/security/crypto.js";

const filtro = process.argv.includes("--docentes") ? "teacher"
  : process.argv.includes("--estudiantes") ? "student"
  : null;

/** Lo cifrado se descifra o se dice que no se pudo; nunca se calla el fallo. */
function abrir(valor) {
  if (valor === null || valor === undefined) return "—";
  try {
    return descifrar(valor);
  } catch {
    // Pasa si ENCRYPTION_KEY no es la que cifró estos datos: por ejemplo, una
    // copia de la base restaurada en un servidor con otros secretos.
    return "[ilegible: ¿ENCRYPTION_KEY cambiada?]";
  }
}

try {
  const [filas] = await pool.query(
    `SELECT id, email_enc, username_enc, name_enc, role, must_change_password,
            email_verified, created_at
       FROM users
      ${filtro ? "WHERE role = ?" : ""}
      ORDER BY role, id`,
    filtro ? [filtro] : [],
  );

  if (filas.length === 0) {
    console.log("No hay ninguna cuenta todavía.");
    console.log('Crea la del docente con: node scripts/crear-docente.mjs <correo> "<nombre>"');
  } else {
    console.log(`${filas.length} cuenta(s):\n`);
    for (const f of filas) {
      const quien = abrir(f.email_enc) !== "—" ? abrir(f.email_enc) : abrir(f.username_enc);
      const marcas = [
        f.must_change_password ? "clave temporal sin cambiar" : null,
        f.email_verified ? null : "correo sin verificar",
      ].filter(Boolean);
      console.log(
        `  #${String(f.id).padEnd(4)} ${f.role.padEnd(8)} ${quien.padEnd(34)} ${abrir(f.name_enc)}` +
        (marcas.length ? `\n         └─ ${marcas.join(" · ")}` : ""),
      );
    }
    console.log("\nPara cambiarle la clave a cualquiera: node scripts/cambiar-clave.mjs <correo>");
  }
} catch (error) {
  console.error("[!] No se pudieron leer las cuentas:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
