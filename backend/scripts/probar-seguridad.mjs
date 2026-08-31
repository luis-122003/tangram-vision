/** Batería de pruebas del endurecimiento. Se ejecuta contra el backend vivo. */
import "dotenv/config";
import mysql from "mysql2/promise";

const API = "http://localhost:8000";
let ok = 0, fallo = 0;

function comprobar(desc, condicion, extra = "") {
  if (condicion) { ok++; console.log(`  [OK   ] ${desc.padEnd(52)} ${extra}`); }
  else { fallo++; console.log(`  [FALLA] ${desc.padEnd(52)} ${extra}`); }
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${API}${ruta}`, opciones);
  const cuerpo = await res.json().catch(() => null);
  return { code: res.status, cuerpo, headers: res.headers };
}

async function login(usuario, clave) {
  const res = await fetch(`${API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: usuario, password: clave }).toString(),
  });
  return { code: res.status, cuerpo: await res.json().catch(() => null) };
}

const auth = (t) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

console.log("\n=== 1. El login sigue funcionando tras cifrar los datos ===");
const est = await login("estudiante@tangram.edu", "1234");

// La propia batería genera fallos de inicio de sesión a propósito (sección 8),
// así que ejecutarla varias veces seguidas agota el límite por IP. Ese contador
// vive en la memoria del proceso, no en la base, y no se puede limpiar desde
// aquí: hay que reiniciar el backend o esperar la ventana de 15 minutos.
//
// Sin este aviso, la siguiente ejecución reportaría veinte fallos confusos
// cuando lo que ocurre es que la protección está haciendo su trabajo.
if (est.code === 429) {
  console.log("\n  El límite de intentos por IP está agotado, y es lo esperado:");
  console.log("  esta batería provoca fallos de login a propósito.");
  console.log("\n  Reinicia el backend (Ctrl+C y `npm run dev`) y vuelve a lanzarla,");
  console.log("  o espera 15 minutos a que se cierre la ventana.\n");
  process.exit(2);
}
comprobar("estudiante entra", est.code === 200, `id=${est.cuerpo?.id} rol=${est.cuerpo?.role}`);
comprobar("el nombre se descifra bien", est.cuerpo?.name === "Luis García", `"${est.cuerpo?.name}"`);
comprobar("devuelve token de refresco", typeof est.cuerpo?.refresh_token === "string");
comprobar("informa de la caducidad", typeof est.cuerpo?.expires_in === "number", `${est.cuerpo?.expires_in}s`);
const doc = await login("docente@tangram.edu", "1234");
comprobar("docente entra", doc.code === 200, `"${doc.cuerpo?.name}"`);
comprobar("mayúsculas del correo no importan", (await login("Estudiante@Tangram.EDU", "1234")).code === 200);

console.log("\n=== 2. Los datos están realmente cifrados en MySQL ===");
const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
const [cols] = await db.query(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=? AND TABLE_NAME='users'`, [process.env.DB_NAME]);
const nombres = cols.map(c => c.COLUMN_NAME);
comprobar("ya no existe la columna 'email' en claro", !nombres.includes("email"));
comprobar("ya no existe la columna 'name' en claro", !nombres.includes("name"));
comprobar("existe el índice ciego email_hash", nombres.includes("email_hash"));
const [filas] = await db.query("SELECT email_enc, name_enc, email_hash, token_version FROM users LIMIT 1");
const u = filas[0];
comprobar("el correo guardado no es legible", !String(u.email_enc).includes("@"), `"${String(u.email_enc).slice(0, 24)}…"`);
comprobar("el nombre guardado no es legible", !/Luis|Mart/.test(String(u.name_enc)), `"${String(u.name_enc).slice(0, 24)}…"`);
comprobar("el índice ciego es un HMAC de 64 hex", /^[0-9a-f]{64}$/.test(u.email_hash));
const [busqueda] = await db.query("SELECT COUNT(*) c FROM users WHERE email_enc LIKE '%tangram.edu%'");
comprobar("no se puede buscar por correo en claro", busqueda[0].c === 0);

console.log("\n=== 3. Manipulación de campos ===");
const tEst = est.cuerpo.access_token;
await pedir("/sessions", {
  method: "POST", headers: auth(tEst),
  body: JSON.stringify({ student_id: doc.cuerpo.id, figure_id: "house", match: true, iou_score: 0.9, time_seconds: 10, errors: 0 }),
});
const [ultima] = await db.query("SELECT student_id FROM sessions ORDER BY id DESC LIMIT 1");
comprobar("student_id se toma del token, no del cuerpo", ultima[0].student_id === est.cuerpo.id,
  `guardado=${ultima[0].student_id} enviado=${doc.cuerpo.id}`);

const iouMalo = await pedir("/sessions", {
  method: "POST", headers: auth(tEst),
  body: JSON.stringify({ figure_id: "house", match: true, iou_score: 99, time_seconds: 10, errors: 0 }),
});
comprobar("rechaza un IoU fuera de rango", iouMalo.code === 422, `${iouMalo.code}: ${iouMalo.cuerpo?.detail}`);
const tiempoMalo = await pedir("/sessions", {
  method: "POST", headers: auth(tEst),
  body: JSON.stringify({ figure_id: "house", match: true, iou_score: 0.9, time_seconds: -5, errors: 0 }),
});
comprobar("rechaza un tiempo negativo", tiempoMalo.code === 422);
const docSesion = await pedir("/sessions", {
  method: "POST", headers: auth(doc.cuerpo.access_token),
  body: JSON.stringify({ figure_id: "house", match: true, iou_score: 0.9, time_seconds: 10, errors: 0 }),
});
comprobar("el docente no puede registrar intentos", docSesion.code === 403);

console.log("\n=== 4. Validación de la foto (subidas) ===");
const noEsImagen = await pedir("/predict", {
  method: "POST", headers: auth(tEst),
  body: JSON.stringify({ image_b64: Buffer.from("#!/bin/sh\nrm -rf /").toString("base64"), figure_id: "house" }),
});
comprobar("rechaza un archivo que no es imagen", noEsImagen.code === 422, `${noEsImagen.code}`);
const b64Falso = await pedir("/predict", {
  method: "POST", headers: auth(tEst),
  body: JSON.stringify({ image_b64: "esto no es base64!!!", figure_id: "house" }),
});
comprobar("rechaza un base64 inválido", b64Falso.code === 422);
const svg = await pedir("/predict", {
  method: "POST", headers: auth(tEst),
  body: JSON.stringify({ image_b64: Buffer.from('<svg onload="alert(1)"></svg>').toString("base64"), figure_id: "house" }),
});
comprobar("rechaza un SVG con script", svg.code === 422);
// Firma JPEG válida pero contenido que no es un JPEG real. Debe superar la
// validación de este backend —su trabajo es mirar la firma— y ser el servicio
// de visión quien lo rechace al no poder decodificarlo. Se distingue por el
// mensaje: "Eso no parece una foto" es de aquí; "Imagen inválida", de visión.
const jpegFirma = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x20)]);
const jpeg = await pedir("/predict", {
  method: "POST", headers: auth(tEst),
  body: JSON.stringify({ image_b64: jpegFirma.toString("base64"), figure_id: "house" }),
});
comprobar("la firma JPEG supera la validación del backend",
  !String(jpeg.cuerpo?.detail ?? "").startsWith("Eso no parece una foto"),
  `${jpeg.code}: ${String(jpeg.cuerpo?.detail).slice(0, 40)}`);
const figuraRara = await pedir("/predict", {
  method: "POST", headers: auth(tEst),
  body: JSON.stringify({ image_b64: jpegFirma.toString("base64"), figure_id: "../../etc/passwd" }),
});
comprobar("rechaza un slug con caracteres raros", figuraRara.code === 422);

console.log("\n=== 5. Paginación forzada ===");
const pag = await pedir("/sessions?limit=999999", { headers: auth(doc.cuerpo.access_token) });
comprobar("el límite se recorta al máximo del servidor", pag.cuerpo?.limit <= 100, `limit=${pag.cuerpo?.limit} total=${pag.cuerpo?.total}`);
comprobar("devuelve el total del curso", typeof pag.cuerpo?.total === "number");

console.log("\n=== 6. Cabeceras de seguridad ===");
const h = (await pedir("/health")).headers;
comprobar("Content-Security-Policy", !!h.get("content-security-policy"));
comprobar("X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff");
comprobar("Referrer-Policy: no-referrer", h.get("referrer-policy") === "no-referrer");
comprobar("no anuncia el motor (X-Powered-By)", !h.get("x-powered-by"));
comprobar("cabeceras de límite de peticiones", !!h.get("ratelimit") || !!h.get("ratelimit-limit"));

console.log("\n=== 7. Refresco y revocación de sesión ===");
const refrescado = await pedir("/token/refresh", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ refresh_token: est.cuerpo.refresh_token }),
});
comprobar("el token de refresco da uno de acceso nuevo", refrescado.code === 200);
const comoAcceso = await pedir("/figures", { headers: auth(est.cuerpo.refresh_token) });
comprobar("el de refresco NO sirve como token de acceso", comoAcceso.code === 401);

const tokenAntes = refrescado.cuerpo.access_token;
comprobar("el token nuevo funciona", (await pedir("/figures", { headers: auth(tokenAntes) })).code === 200);
await pedir("/logout", { method: "POST", headers: auth(tokenAntes) });
comprobar("tras salir, el token queda invalidado", (await pedir("/figures", { headers: auth(tokenAntes) })).code === 401);
const refrescoTrasSalir = await pedir("/token/refresh", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ refresh_token: est.cuerpo.refresh_token }),
});
comprobar("tras salir, el de refresco tampoco vale", refrescoTrasSalir.code === 401);

console.log("\n=== 8. Fuerza bruta contra el PIN ===");
await db.query("DELETE FROM login_attempts");
let bloqueado = null;
for (let i = 1; i <= 8; i++) {
  const r = await login("estudiante@tangram.edu", `000${i}`);
  if (r.code === 429) { bloqueado = i; break; }
}
comprobar("bloquea la cuenta tras varios fallos", bloqueado !== null && bloqueado <= 7, `bloqueado en el intento ${bloqueado}`);
const conClaveBuena = await login("estudiante@tangram.edu", "1234");
comprobar("el bloqueo aguanta aun con la clave correcta", conClaveBuena.code === 429, `${conClaveBuena.code}`);
comprobar("el mensaje dice cuánto esperar", /minuto/i.test(String(conClaveBuena.cuerpo?.detail)), `"${conClaveBuena.cuerpo?.detail}"`);

const [reg] = await db.query("SELECT identifier, kind FROM login_attempts WHERE kind='account' LIMIT 1");
comprobar("el registro de intentos no guarda el correo", reg[0] && !String(reg[0].identifier).includes("@"));

await db.query("DELETE FROM login_attempts");
const tras = await login("estudiante@tangram.edu", "1234");
comprobar("al limpiar el bloqueo, vuelve a entrar", tras.code === 200);

console.log("\n=== 9. Mensajes que no filtran información ===");
const inexistente = await login("nadie@tangram.edu", "1234");
const claveMala = await login("estudiante@tangram.edu", "clave-incorrecta");
comprobar("mismo mensaje exista o no la cuenta",
  inexistente.cuerpo?.detail === claveMala.cuerpo?.detail, `"${inexistente.cuerpo?.detail}"`);

await db.query("DELETE FROM login_attempts");
await db.end();

console.log(`\n${"=".repeat(62)}`);
console.log(`RESULTADO: ${ok} correctas, ${fallo} fallidas`);
process.exit(fallo > 0 ? 1 : 0);
