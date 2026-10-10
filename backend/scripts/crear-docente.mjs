/**
 * crear-docente.mjs — da de alta una cuenta de docente.
 *
 *   En el servidor:  docker compose exec backend node scripts/crear-docente.mjs <correo> "<nombre>"
 *   En local:        npm run build && node scripts/crear-docente.mjs <correo> "<nombre>"
 *
 * En producción no se siembra ninguna cuenta (ver `sembrarUsuarios` en
 * src/db/schema.ts), así que sin esto nadie puede entrar la primera vez. Y no se
 * puede hacer a mano con un INSERT: el nombre y el correo van cifrados con
 * ENCRYPTION_KEY, y el correo se busca por su índice ciego. Este script usa
 * las mismas funciones que el backend, así que la cuenta queda idéntica a una
 * sembrada por él.
 *
 * La clave se pide por la terminal y no por argumento: un argumento queda en el
 * historial del shell y en la lista de procesos. Al docente se le exigen 12
 * caracteres; el mínimo de 4 es para los estudiantes, que son niños.
 */
import readline from "node:readline";
import bcrypt from "bcryptjs";
import { pool } from "../dist/db/pool.js";
import { RONDAS_BCRYPT } from "../dist/db/users.js";
import { cifrar, indiceCiego } from "../dist/security/crypto.js";

const [correoBruto, nombreBruto] = process.argv.slice(2);
const correo = correoBruto?.trim().toLowerCase();
const nombre = nombreBruto?.trim();

if (!correo || !nombre || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
  console.error('Uso: node scripts/crear-docente.mjs <correo> "<nombre completo>"');
  process.exit(1);
}

/**
 * Una sola interfaz para las dos preguntas, leída como iterador: así las líneas
 * que llegan juntas por una tubería (`printf … | docker compose exec -T`) se
 * guardan en búfer en vez de perderse entre una pregunta y la siguiente. Con
 * terminal, lo que se escribe no se repite en pantalla.
 */
const tty = Boolean(process.stdin.isTTY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
rl._writeToOutput = () => {};
const lineas = rl[Symbol.asyncIterator]();

async function pedirOculto(pregunta) {
  process.stdout.write(pregunta);
  const { value, done } = await lineas.next();
  process.stdout.write("\n");
  return done ? "" : value;
}

const clave = await pedirOculto("Clave del docente (mínimo 12 caracteres): ");
if (clave.length < 12) {
  console.error("La clave debe tener al menos 12 caracteres.");
  process.exit(1);
}
if (clave !== await pedirOculto("Repítela: ")) {
  console.error("Las dos claves no coinciden.");
  process.exit(1);
}
rl.close();

try {
  const [existe] = await pool.query("SELECT id FROM users WHERE email_hash = ?", [indiceCiego(correo)]);
  if (existe.length > 0) {
    console.error(`Ya hay una cuenta con ${correo}. Para cambiarle la clave, usa la aplicación.`);
    process.exitCode = 1;
  } else {
    const hash = await bcrypt.hash(clave, RONDAS_BCRYPT);
    await pool.query(
      `INSERT INTO users (email_hash, email_enc, name_enc, password_hash, role)
       VALUES (?, ?, ?, ?, 'teacher')`,
      [indiceCiego(correo), cifrar(correo), cifrar(nombre), hash],
    );
    console.log(`[OK] Docente ${correo} creado. Ya puede iniciar sesión en la web.`);
  }
} catch (error) {
  console.error("[!] No se pudo crear la cuenta:", error.message);
  console.error("    ¿Arrancó el backend al menos una vez? Es él quien crea las tablas.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
