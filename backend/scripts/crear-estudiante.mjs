/**
 * crear-estudiante.mjs — da de alta la cuenta de un estudiante.
 *
 *   En el servidor:  docker compose exec backend node scripts/crear-estudiante.mjs <correo> "<nombre>"
 *   En local:        npm run build && node scripts/crear-estudiante.mjs <correo> "<nombre>"
 *
 * El camino normal para dar de alta estudiantes es el panel del docente, uno a
 * uno o con el Excel; esto es para cuando todavía no hay nadie que pueda entrar
 * a ese panel, o para la cuenta con la que se enseña el sistema. En producción
 * no se siembra ninguna cuenta (ver `sembrarUsuarios` en src/db/schema.ts).
 *
 * No se puede hacer con un INSERT a mano: el nombre y el correo van cifrados
 * con ENCRYPTION_KEY y el correo se busca por su índice ciego. Este script usa
 * las mismas funciones que el backend, así que la cuenta queda idéntica a una
 * creada desde el panel.
 *
 * La cuenta nace **sin** la marca de clave temporal: la clave la escribe aquí
 * quien la crea, no la generó el servidor, así que ya es la contraseña de la
 * cuenta y no un trámite de un solo uso. Y nace verificada, igual que un alta
 * del docente: el correo lo respalda él y puede ser uno de aula sin buzón.
 */
import { pool } from "../dist/db/pool.js";
import { crearEstudiante } from "../dist/db/users.js";
import { indiceCiego } from "../dist/security/crypto.js";
import { cerrar, normalizarCorreo, pedirClave } from "./_consola.mjs";

const [correoBruto, nombreBruto] = process.argv.slice(2);
const correo = normalizarCorreo(correoBruto);
const nombre = nombreBruto?.trim();

if (!correo || !nombre) {
  console.error('Uso: node scripts/crear-estudiante.mjs <correo> "<nombre completo>"');
  process.exit(1);
}

try {
  const [existe] = await pool.query("SELECT id FROM users WHERE email_hash = ?", [indiceCiego(correo)]);
  if (existe.length > 0) {
    console.error(`Ya hay una cuenta con ${correo}. Para cambiarle la clave:`);
    console.error(`  node scripts/cambiar-clave.mjs ${correo}`);
    process.exitCode = 1;
  } else {
    // El mínimo de 4 es el de la aplicación: el estudiante teclea su clave en
    // un teclado de diez teclas grandes dentro de la app.
    const clave = await pedirClave(4);
    const id = await crearEstudiante(nombre, correo, clave, false, true);
    console.log(`[OK] Estudiante ${correo} creado (#${id}). Ya puede entrar en la web y en la app.`);
  }
} catch (error) {
  console.error("[!] No se pudo crear la cuenta:", error.message);
  console.error("    ¿Arrancó el backend al menos una vez? Es él quien crea las tablas.");
  process.exitCode = 1;
} finally {
  cerrar();
  await pool.end();
}
