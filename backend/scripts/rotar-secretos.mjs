/**
 * rotar-secretos.mjs — regenera los secretos de backend/.env.
 *
 *   npm run rotar-secretos            JWT_SECRET y REFRESH_SECRET
 *   npm run rotar-secretos -- --todo  además las claves de cifrado
 *
 * Los valores nunca se imprimen: se escriben directamente en el archivo. Un
 * secreto que pasa por una consola queda en el historial del terminal, en los
 * registros de la sesión o en una captura, y desde ese momento hay que darlo
 * por comprometido.
 *
 * CUIDADO con `--todo`: al cambiar ENCRYPTION_KEY y BLIND_INDEX_KEY, los datos
 * ya cifrados en la base dejan de poder leerse. Solo tiene sentido sobre una
 * base vacía o acompañado de un recifrado. Rotar solo los de sesión es
 * inofensivo: lo único que pasa es que todos tienen que volver a entrar.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destino = path.join(RAIZ, ".env");

if (!fs.existsSync(destino)) {
  console.error("No existe backend/.env. Cópialo de .env.example primero.");
  process.exit(1);
}

const todo = process.argv.includes("--todo");
const claves = todo
  ? { JWT_SECRET: 48, REFRESH_SECRET: 48, ENCRYPTION_KEY: 32, BLIND_INDEX_KEY: 32 }
  : { JWT_SECRET: 48, REFRESH_SECRET: 48 };

// Copia de seguridad antes de tocar nada: si algo sale mal, el .env anterior
// sigue ahí. Sin esto, un fallo a media escritura deja el backend sin arrancar.
const respaldo = `${destino}.bak`;
fs.copyFileSync(destino, respaldo);

let contenido = fs.readFileSync(destino, "utf-8");
for (const [clave, bytes] of Object.entries(claves)) {
  const valor = randomBytes(bytes).toString("hex");
  const patron = new RegExp(`^${clave}\\s*=.*$`, "m");
  contenido = patron.test(contenido)
    ? contenido.replace(patron, `${clave}=${valor}`)
    : `${contenido.trimEnd()}\n${clave}=${valor}\n`;
}
fs.writeFileSync(destino, contenido, "utf-8");

console.log(`Rotados en backend/.env: ${Object.keys(claves).join(", ")}`);
console.log(`Copia del anterior en: ${path.basename(respaldo)}  (bórrala cuando confirmes que todo va)`);
console.log("Efecto: todas las sesiones abiertas se cierran; hay que volver a entrar.");
if (todo) {
  console.log("\nATENCIÓN: cambiaste las claves de cifrado. Los datos ya cifrados");
  console.log("en la base son ilegibles con las nuevas. Restaura el .bak si no era eso.");
}
