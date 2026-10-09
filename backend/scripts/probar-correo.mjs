/**
 * Batería de la verificación de correo y la recuperación de clave.
 *
 * Se ejecuta contra el backend vivo y contra un servidor SMTP de verdad:
 * Mailpit, que guarda los correos que recibe y los expone por su API. Los
 * códigos que se prueban son los que el backend envió de verdad, leídos del
 * buzón, no fabricados por la prueba.
 *
 *   mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025
 *   (backend/.env con SMTP_HOST=127.0.0.1, SMTP_PORT=1025, SMTP_FROM=...)
 *   npm run probar-correo
 *
 * La batería hace más de veinte peticiones a las rutas de correo y varios
 * registros, así que con los límites por IP de fábrica (20 y 10 por hora) solo
 * cabe una ejecución por hora. Para repetirla, arranca el backend con
 * RATE_LIMIT_EMAIL_IP=200 y RATE_LIMIT_REGISTER_IP=100 en el entorno.
 *
 * Crea cuentas `prueba.correo.*@example.com` y las borra al terminar.
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import mysql from "mysql2/promise";

const API = "http://localhost:8000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
let ok = 0, fallo = 0;

function comprobar(desc, condicion, extra = "") {
  if (condicion) { ok++; console.log(`  [OK   ] ${desc.padEnd(60)} ${extra}`); }
  else { fallo++; console.log(`  [FALLA] ${desc.padEnd(60)} ${extra}`); }
}

async function pedir(ruta, cuerpo) {
  const res = await fetch(`${API}${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

/** Correos recibidos por un destinatario, del más nuevo al más viejo. */
async function buzon(correo) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  return (await res.json()).messages ?? [];
}

/** Espera a que el buzón tenga `n` correos (los envíos en segundo plano tardan un poco). */
async function esperarCorreos(correo, n, ms = 5000) {
  const fin = Date.now() + ms;
  let msgs = await buzon(correo);
  while (msgs.length < n && Date.now() < fin) {
    await new Promise(r => setTimeout(r, 200));
    msgs = await buzon(correo);
  }
  return msgs;
}

async function mensaje(id) {
  return (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
}

const codigoDe = (msg) => /\b(\d{6})\b/.exec(msg?.Subject ?? "")?.[1];

/** Un código de 6 dígitos distinto del bueno. */
const otroCodigo = (c) => String((Number(c) + 1) % 1_000_000).padStart(6, "0");

const indiceCiego = (correo) =>
  createHmac("sha256", Buffer.from(process.env.BLIND_INDEX_KEY, "hex"))
    .update(correo.trim().toLowerCase(), "utf8").digest("hex");

// ─── Comprobaciones previas ──────────────────────────────────────────────────
try {
  await fetch(`${MAILPIT}/api/v1/info`);
} catch {
  console.error(`\n  Mailpit no responde en ${MAILPIT}. Arráncalo antes:`);
  console.error("    mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025\n");
  process.exit(2);
}

const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
const [[{ ahora: inicio }]] = await db.query("SELECT NOW() AS ahora");

/** Borra los fallos de código que la propia batería provoca a propósito. */
async function limpiarIntentos() {
  await db.query("DELETE FROM login_attempts WHERE created_at >= ?", [inicio]);
}

const sello = Date.now();
const A = `prueba.correo.a.${sello}@example.com`;
const B = `prueba.correo.b.${sello}@example.com`;
const C = `prueba.correo.c.${sello}@example.com`;
const CLAVE = "Kx9-prueba";

try {
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== 1. El registro no abre sesión y envía un código ===");
  const reg = await pedir("/register", { name: "Ana <b>Prueba</b>", email: A, password: CLAVE });
  comprobar("responde 201", reg.code === 201, `${reg.code}: ${reg.cuerpo?.detail}`);
  comprobar("pide verificación", reg.cuerpo?.verification_required === true);
  comprobar("no devuelve token de acceso", reg.cuerpo?.access_token === undefined);
  comprobar("no devuelve token de refresco", reg.cuerpo?.refresh_token === undefined);

  const correosA = await esperarCorreos(A, 1);
  comprobar("llega un correo al destinatario", correosA.length === 1, `${correosA.length} correo(s)`);
  const codigoA = codigoDe(correosA[0]);
  comprobar("el correo trae un código de 6 dígitos", !!codigoA);
  const cuerpoA = await mensaje(correosA[0]?.ID);
  comprobar("el código va también en el texto", cuerpoA.Text?.includes(codigoA));
  comprobar("el nombre va escapado en el HTML", !cuerpoA.HTML?.includes("<b>Prueba</b>") &&
    cuerpoA.HTML?.includes("&lt;b&gt;Prueba"));

  const [[filaA]] = await db.query(
    "SELECT id, email_verified FROM users WHERE email_hash = ?", [indiceCiego(A)]);
  comprobar("la cuenta queda sin verificar en la base", filaA?.email_verified === 0);
  const [codigosA] = await db.query("SELECT * FROM email_codes WHERE user_id = ?", [filaA.id]);
  comprobar("hay un único código guardado", codigosA.length === 1);
  comprobar("se guarda un HMAC, no el código", /^[0-9a-f]{64}$/.test(codigosA[0]?.code_hash) &&
    !JSON.stringify(codigosA).includes(codigoA));

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== 2. Ingreso de una cuenta sin verificar ===");
  const sinVerificar = await login(A, CLAVE);
  comprobar("con la clave buena: 403 correo_sin_verificar",
    sinVerificar.code === 403 && sinVerificar.cuerpo?.code === "correo_sin_verificar",
    `${sinVerificar.code} ${sinVerificar.cuerpo?.code}`);
  comprobar("no entrega tokens", sinVerificar.cuerpo?.access_token === undefined);
  const claveMala = await login(A, "otra-clave");
  comprobar("con la clave mala: 401 genérico, sin pista",
    claveMala.code === 401 && claveMala.cuerpo?.code === undefined, `${claveMala.code}`);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== 3. Reenvío ===");
  const reenvio = await pedir("/register/resend", { email: A });
  comprobar("responde 200", reenvio.code === 200);
  await new Promise(r => setTimeout(r, 1500));
  comprobar("dentro de la espera no manda otro correo", (await buzon(A)).length === 1);
  const reenvioNadie = await pedir("/register/resend", { email: `nadie.${sello}@example.com` });
  comprobar("con un correo inexistente responde igual",
    reenvioNadie.code === 200 && reenvioNadie.cuerpo?.detail === reenvio.cuerpo?.detail);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== 4. Verificación ===");
  const sinClave = await pedir("/register/verify", { email: A, password: "otra-clave", code: codigoA });
  comprobar("código bueno con clave mala: 422", sinClave.code === 422, `${sinClave.code}`);
  const malo = await pedir("/register/verify", { email: A, password: CLAVE, code: otroCodigo(codigoA) });
  comprobar("código malo: 422", malo.code === 422, `${malo.code}: ${malo.cuerpo?.detail}`);
  const formato = await pedir("/register/verify", { email: A, password: CLAVE, code: "12ab" });
  comprobar("código con formato inválido: 422", formato.code === 422);
  const bueno = await pedir("/register/verify", { email: A, password: CLAVE, code: codigoA });
  comprobar("código bueno: 200 con sesión", bueno.code === 200 &&
    typeof bueno.cuerpo?.access_token === "string" && typeof bueno.cuerpo?.refresh_token === "string",
    `${bueno.code}`);
  comprobar("la respuesta tiene la forma de /token", bueno.cuerpo?.role === "student" &&
    bueno.cuerpo?.name === "Ana <b>Prueba</b>" && bueno.cuerpo?.must_change_password === false);
  const [[filaA2]] = await db.query("SELECT email_verified FROM users WHERE id = ?", [filaA.id]);
  comprobar("la cuenta queda verificada", filaA2.email_verified === 1);
  const [restantes] = await db.query("SELECT id FROM email_codes WHERE user_id = ?", [filaA.id]);
  comprobar("el código se gasta", restantes.length === 0);
  const reuso = await pedir("/register/verify", { email: A, password: CLAVE, code: codigoA });
  comprobar("no se puede reutilizar", reuso.code === 422);
  comprobar("ya entra por /token", (await login(A, CLAVE)).code === 200);

  const repetido = await pedir("/register", { name: "Otra", email: A, password: "Zq7-otra" });
  comprobar("registrar un correo verificado: 409", repetido.code === 409);
  comprobar("y no cambia su clave", (await login(A, CLAVE)).code === 200);
  await limpiarIntentos();

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== 5. Nadie puede apartar el correo de otro ===");
  await pedir("/register", { name: "Intruso", email: B, password: "Ww3-intruso" });
  const [primero] = await esperarCorreos(B, 1);
  const codigoIntruso = codigoDe(primero);
  const dueño = await pedir("/register", { name: "Dueño", email: B, password: CLAVE });
  comprobar("re-registrar un correo pendiente: 201", dueño.code === 201, `${dueño.code}`);
  const correosB = await esperarCorreos(B, 2);
  comprobar("se envía un código nuevo sin esperar", correosB.length === 2);
  const codigoDueño = codigoDe(correosB[0]);
  comprobar("el código anterior deja de valer",
    (await pedir("/register/verify", { email: B, password: CLAVE, code: codigoIntruso })).code === 422);
  comprobar("la clave anterior deja de valer",
    (await pedir("/register/verify", { email: B, password: "Ww3-intruso", code: codigoDueño })).code === 422);
  const okB = await pedir("/register/verify", { email: B, password: CLAVE, code: codigoDueño });
  comprobar("el dueño activa la cuenta con su clave", okB.code === 200 && okB.cuerpo?.name === "Dueño");
  await limpiarIntentos();

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== 6. Topes del código ===");
  await pedir("/register", { name: "Carla", email: C, password: CLAVE });
  const codigoC = codigoDe((await esperarCorreos(C, 1))[0]);
  const [[filaC]] = await db.query("SELECT id FROM users WHERE email_hash = ?", [indiceCiego(C)]);
  // Cuatro fallos ya contados: el quinto destruye el código.
  await db.query("UPDATE email_codes SET attempts = 4 WHERE user_id = ?", [filaC.id]);
  await pedir("/register/verify", { email: C, password: CLAVE, code: otroCodigo(codigoC) });
  const [trasQuinto] = await db.query("SELECT id FROM email_codes WHERE user_id = ?", [filaC.id]);
  comprobar("al quinto fallo el código se destruye", trasQuinto.length === 0);
  comprobar("y el código bueno ya no sirve",
    (await pedir("/register/verify", { email: C, password: CLAVE, code: codigoC })).code === 422);

  await pedir("/register/resend", { email: C });
  const correosC = await esperarCorreos(C, 2);
  comprobar("tras destruirse se puede pedir otro al momento", correosC.length === 2);
  const codigoC2 = codigoDe(correosC[0]);
  await db.query(
    "UPDATE email_codes SET expires_at = NOW() - INTERVAL 1 SECOND WHERE user_id = ?", [filaC.id]);
  comprobar("un código caducado no sirve",
    (await pedir("/register/verify", { email: C, password: CLAVE, code: codigoC2 })).code === 422);
  await limpiarIntentos();

  console.log("\n=== 7. Bloqueo por fallos repetidos ===");
  for (let i = 0; i < 5; i++) {
    await pedir("/register/verify", { email: C, password: CLAVE, code: "000000" });
  }
  const bloqueado = await pedir("/register/verify", { email: C, password: CLAVE, code: "000000" });
  comprobar("tras 5 fallos: 429", bloqueado.code === 429, `${bloqueado.code}: ${bloqueado.cuerpo?.detail}`);
  comprobar("el bloqueo de códigos no bloquea el ingreso",
    (await login(A, CLAVE)).code === 200);
  await limpiarIntentos();

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== 8. Recuperación de clave ===");
  const sesionVieja = await login(A, CLAVE);
  const antes = (await buzon(A)).length;
  const nadie = await pedir("/password/forgot", { email: `nadie.${sello}@example.com` });
  const pendiente = await pedir("/password/forgot", { email: C });
  const forgot = await pedir("/password/forgot", { email: A });
  comprobar("responde 200", forgot.code === 200);
  comprobar("con un correo inexistente responde igual",
    nadie.code === 200 && nadie.cuerpo?.detail === forgot.cuerpo?.detail);
  const correosReset = await esperarCorreos(A, antes + 1);
  comprobar("llega el correo de recuperación", correosReset.length === antes + 1);
  comprobar("es el de recuperación, no el de verificación",
    /cambiar la clave/.test(correosReset[0]?.Subject ?? ""), `"${correosReset[0]?.Subject}"`);
  comprobar("a una cuenta sin verificar no se le envía",
    pendiente.code === 200 && (await buzon(C)).length === 2);
  const codigoReset = codigoDe(correosReset[0]);

  const trivial = await pedir("/password/reset", { email: A, code: codigoReset, new_password: "1234" });
  comprobar("clave trivial: 422 sin gastar el código", trivial.code === 422);
  const resetMalo = await pedir("/password/reset", {
    email: A, code: otroCodigo(codigoReset), new_password: "Nueva-77x",
  });
  comprobar("código malo: 422", resetMalo.code === 422);
  const cruzado = await pedir("/register/verify", { email: A, password: CLAVE, code: codigoReset });
  comprobar("un código de recuperación no sirve para verificar", cruzado.code === 422);
  const reset = await pedir("/password/reset", { email: A, code: codigoReset, new_password: "Nueva-77x" });
  comprobar("código bueno: 200", reset.code === 200, `${reset.code}: ${reset.cuerpo?.detail}`);
  comprobar("no devuelve tokens", reset.cuerpo?.access_token === undefined);
  comprobar("la clave vieja ya no entra", (await login(A, CLAVE)).code === 401);
  comprobar("la nueva sí", (await login(A, "Nueva-77x")).code === 200);
  const refresco = await pedir("/token/refresh", { refresh_token: sesionVieja.cuerpo?.refresh_token });
  comprobar("las sesiones anteriores quedan revocadas", refresco.code === 401, `${refresco.code}`);
  const reusoReset = await pedir("/password/reset", { email: A, code: codigoReset, new_password: "Otra-88y" });
  comprobar("el código no se puede reutilizar", reusoReset.code === 422);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== 9. Cuentas que ya existían ===");
  const [[previas]] = await db.query(
    "SELECT COUNT(*) AS n FROM users WHERE email_verified = 0 AND created_at < ?", [inicio]);
  comprobar("ninguna cuenta anterior quedó sin verificar", Number(previas.n) === 0, `${previas.n}`);
} finally {
  await db.query("DELETE FROM users WHERE email_hash IN (?, ?, ?)",
    [indiceCiego(A), indiceCiego(B), indiceCiego(C)]);
  await limpiarIntentos();
  await db.end();
}

console.log(`\nRESULTADO: ${ok} correctas, ${fallo} fallidas`);
process.exit(fallo > 0 ? 1 : 0);
