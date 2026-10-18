/**
 * Batería del alta masiva desde Excel y del correo en el primer ingreso.
 *
 * Se ejecuta contra el backend vivo, con un servidor SMTP que guarde lo que
 * recibe para leer los códigos de verdad (Mailpit, o cualquier buzón local que
 * escriba cada mensaje como una línea JSON `{ para, cuerpo }` en BUZON_JSONL).
 *
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_USER= SMTP_PASS= npm run dev
 *   BUZON_JSONL=/ruta/correos.jsonl npx tsx scripts/probar-alta-masiva.mjs
 *
 * Necesita una cuenta de docente: firma su token con `firmarAcceso` del propio
 * backend (por eso va con tsx), así que no hace falta conocer su clave. Crea cuentas `prueba.lote.*` y las borra
 * al terminar.
 */
import "dotenv/config";
import fs from "node:fs";
import { firmarAcceso } from "../src/auth/jwt.js";
import mysql from "mysql2/promise";

const API = process.env.API ?? "http://localhost:8000";
const BUZON = process.env.BUZON_JSONL;
let ok = 0, fallo = 0;

function comprobar(desc, condicion, extra = "") {
  if (condicion) { ok++; console.log(`  [OK   ] ${desc.padEnd(62)} ${extra}`); }
  else { fallo++; console.log(`  [FALLA] ${desc.padEnd(62)} ${extra}`); }
}

const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

async function pedir(ruta, cuerpo, token) {
  const res = await fetch(`${API}${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  return { code: res.status, cuerpo: await res.json().catch(() => null) };
}

async function login(usuario, clave) {
  const res = await fetch(`${API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: usuario, password: clave }).toString(),
  });
  return { code: res.status, cuerpo: await res.json().catch(() => null) };
}

/** Último código de 6 cifras recibido por `correo`, esperando hasta 5 s. */
async function codigoPara(correo) {
  const fin = Date.now() + 5000;
  while (Date.now() < fin) {
    if (fs.existsSync(BUZON)) {
      const msgs = fs.readFileSync(BUZON, "utf8").trim().split("\n").filter(Boolean)
        .map(l => JSON.parse(l)).filter(m => m.para.includes(correo));
      const ultimo = msgs.at(-1);
      // El cuerpo va en quoted-printable: se quitan los saltos suaves antes de buscar.
      const m = ultimo?.cuerpo.replace(/=\r?\n/g, "").match(/\b(\d{6})\b/);
      if (m) return m[1];
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

const [[docente]] = await db.query(
  "SELECT id, token_version FROM users WHERE role = 'teacher' ORDER BY id LIMIT 1",
);
if (!docente) { console.error("No hay ninguna cuenta de docente en la base."); process.exit(1); }
const tokenDocente = firmarAcceso({
  id: docente.id, name: "docente", role: "teacher", ver: docente.token_version,
});

const sello = Date.now();
const correoA = `prueba.lote.${sello}@example.com`;
const correoB = `prueba.lote.b.${sello}@example.com`;
const nombreSin = `Prueba Lote${sello}`;

console.log("\n1. Alta masiva");
const lote = await pedir("/students/bulk", {
  students: [
    { name: "Prueba Con Correo", email: correoA },
    { name: nombreSin, email: "" },
    { name: "Prueba Repetida", email: correoA },
    { name: "X", email: "no-es-correo" },
  ],
}, tokenDocente);
comprobar("POST /students/bulk responde 201", lote.code === 201, `(${lote.code} ${lote.cuerpo?.detail ?? ""})`);
const [conCorreo, sinCorreo, repetida, mala] = lote.cuerpo?.results ?? [];
comprobar("fila con correo: usuario = correo, clave de 4 dígitos",
  conCorreo?.ok && conCorreo.username === correoA && /^\d{4}$/.test(conCorreo.password));
comprobar("fila sin correo: usuario generado nombre.apellido",
  sinCorreo?.ok && sinCorreo.username === `prueba.lote${sello}` && sinCorreo.email === null,
  `(${sinCorreo?.username})`);
comprobar("correo repetido en el archivo: falla solo esa fila",
  repetida && !repetida.ok && /ya hay una cuenta/i.test(repetida.error));
comprobar("nombre corto y correo inválido: falla solo esa fila", mala && !mala.ok, `(${mala?.error})`);
comprobar("se crearon 2 cuentas", lote.cuerpo?.created === 2);

const sinPermiso = await pedir("/students/bulk", { students: [{ name: "Nadie" }] });
comprobar("sin sesión de docente: 401", sinPermiso.code === 401);

console.log("\n2. Cuenta sin correo: usuario → correo → código → clave");
let r = await login(sinCorreo.username, "0000");
comprobar("clave equivocada: 401", r.code === 401);
r = await login(sinCorreo.username, sinCorreo.password);
comprobar("ingreso con usuario: 403 correo_requerido", r.code === 403 && r.cuerpo?.code === "correo_requerido",
  `(${r.code} ${r.cuerpo?.code})`);

r = await pedir("/account/email", { username: sinCorreo.username, password: "0000", email: correoB });
comprobar("/account/email con clave mala: 401", r.code === 401);
r = await pedir("/account/email", { username: sinCorreo.username, password: sinCorreo.password, email: correoA });
comprobar("/account/email con el correo de otra cuenta: 409", r.code === 409, `(${r.cuerpo?.detail})`);
r = await pedir("/account/email", { username: sinCorreo.username, password: sinCorreo.password, email: correoB });
comprobar("/account/email con correo nuevo: 200 y lo devuelve", r.code === 200 && r.cuerpo?.email === correoB,
  `(${r.code} ${r.cuerpo?.detail})`);
const codigoB = await codigoPara(correoB);
comprobar("llegó el código al correo nuevo", !!codigoB);

r = await pedir("/register/verify", { email: correoB, password: sinCorreo.password, code: codigoB });
comprobar("/register/verify abre sesión con clave temporal pendiente",
  r.code === 200 && r.cuerpo?.must_change_password === true, `(${r.code})`);
const tokenB = r.cuerpo?.access_token;
r = await pedir("/password", { current_password: sinCorreo.password, new_password: "5829" }, tokenB);
comprobar("elige su clave (POST /password)", r.code === 200, `(${r.code} ${r.cuerpo?.detail ?? ""})`);
r = await login(sinCorreo.username, "5829");
comprobar("entra con el usuario y su clave nueva", r.code === 200 && !r.cuerpo?.must_change_password);
r = await login(correoB, "5829");
comprobar("entra también con el correo", r.code === 200);
r = await pedir("/account/email", { username: correoB, password: "5829", email: `otro.${sello}@example.com` });
comprobar("con el correo ya confirmado no se puede cambiar: 409", r.code === 409);

console.log("\n3. Cuenta con correo: el código llega al entrar");
r = await login(correoA, conCorreo.password);
comprobar("ingreso: 403 correo_sin_verificar con el correo",
  r.code === 403 && r.cuerpo?.code === "correo_sin_verificar" && r.cuerpo?.email === correoA,
  `(${r.code} ${r.cuerpo?.code})`);
const codigoA = await codigoPara(correoA);
comprobar("el ingreso mandó el código", !!codigoA);
r = await pedir("/register/verify", { email: correoA, password: conCorreo.password, code: codigoA });
comprobar("verify abre sesión y pide cambiar la clave",
  r.code === 200 && r.cuerpo?.must_change_password === true);

console.log("\n4. El registro por la app no puede apropiarse de una cuenta del docente");
const lote2 = await pedir("/students/bulk", { students: [{ name: "Prueba Ajena", email: `prueba.lote.c.${sello}@example.com` }] }, tokenDocente);
r = await pedir("/register", { name: "Intruso", email: `prueba.lote.c.${sello}@example.com`, password: "Kq7mZp42" });
comprobar("/register sobre cuenta pendiente del docente: 409", r.code === 409, `(${r.code})`);
const clave2 = lote2.cuerpo?.results?.[0]?.password;
r = await login(`prueba.lote.c.${sello}@example.com`, clave2);
comprobar("la clave del docente sigue valiendo", r.code === 403 && r.cuerpo?.code === "correo_sin_verificar");

// Limpieza: las cuentas `prueba.lote*`, por correo o por usuario.
const lista = await (await fetch(`${API}/students`, {
  headers: { Authorization: `Bearer ${tokenDocente}` },
})).json();
const ids = lista
  .filter(e => (e.email ?? "").startsWith("prueba.lote.") || (e.username ?? "").startsWith("prueba.lote"))
  .map(e => e.id);
for (const id of ids) {
  await fetch(`${API}/students/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${tokenDocente}` } });
}
console.log(`\n  ${ids.length} cuentas de prueba borradas`);
await db.end();

console.log(`\n${ok} bien, ${fallo} mal`);
process.exit(fallo ? 1 : 0);
