/**
 * Comprueba, contra el backend vivo, el contrato exacto que consume la app
 * móvil: los endpoints que llama, los campos que lee de cada respuesta y los
 * códigos de error que sabe interpretar.
 *
 * Existe por una razón concreta. La app móvil y el servidor se publican por
 * separado —el APK se instala en los teléfonos y el backend se reinicia cuando
 * haga falta—, así que un campo renombrado en el servidor no da ningún error
 * aquí: da una pantalla en blanco en el teléfono de un niño, y solo se descubre
 * el día de la demostración. Esta batería convierte eso en un fallo visible
 * antes de salir del escritorio.
 *
 * A diferencia de `probar-seguridad.mjs`, esta NO muta la base más allá de un
 * intento de prueba y de una cuenta de registro que se borra al final: no toca
 * cuentas ajenas, no cierra sesiones y no provoca bloqueos por fuerza bruta,
 * así que se puede repetir cuantas veces se quiera.
 *
 *   node scripts/probar-contrato-movil.mjs
 *   node scripts/probar-contrato-movil.mjs http://192.168.1.10:8000
 *
 * El segundo argumento sirve para lo que de verdad importa el día de la
 * revisión: comprobar el servidor desde la MISMA dirección que va a teclear el
 * teléfono, no desde `localhost`, que siempre funciona aunque el cortafuegos
 * esté cerrado.
 */
import "dotenv/config";

const API = process.argv[2] ?? `http://localhost:${process.env.PORT ?? 8000}`;
let ok = 0, fallo = 0;

function comprobar(desc, condicion, extra = "") {
  if (condicion) { ok++; console.log(`  [OK   ] ${desc.padEnd(54)} ${extra}`); }
  else { fallo++; console.log(`  [FALLA] ${desc.padEnd(54)} ${extra}`); }
}

/**
 * Que un campo exista Y tenga el tipo que la app espera. La distinción importa:
 * un campo ausente llega como `undefined`, la app lo pinta como texto vacío y
 * el fallo pasa desapercibido hasta que alguien mira la pantalla del teléfono.
 */
function campo(obj, ruta, tipo) {
  const valor = ruta.split(".").reduce((o, k) => o?.[k], obj);
  const real = Array.isArray(valor) ? "array" : typeof valor;
  comprobar(`${ruta} es ${tipo}`, real === tipo, real === tipo ? "" : `llegó ${real}`);
  return valor;
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${API}${ruta}`, opciones);
  return { code: res.status, cuerpo: await res.json().catch(() => null) };
}

const auth = (t) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

console.log(`\nContrato app móvil <-> backend · ${API}`);

// ─── 1. Alcanzable y en condiciones ─────────────────────────────────────────
// La pantalla de ajustes del teléfono usa /health SIN autenticar para separar
// "la dirección está mal" de "las credenciales están mal". Si esto falla, no
// hay nada más que probar.
console.log("\n=== 1. /health, que es como el teléfono diagnostica la conexión ===");
let salud;
try {
  salud = await pedir("/health");
} catch (e) {
  console.log(`\n  No se pudo alcanzar ${API}: ${e.message}`);
  console.log("  Si estás probando la IP de la red, revisa que el backend esté");
  console.log("  arrancado y que el cortafuegos deje pasar el puerto.\n");
  process.exit(2);
}
comprobar("responde sin autenticar", salud.code === 200, `HTTP ${salud.code}`);
campo(salud.cuerpo, "status", "string");
campo(salud.cuerpo, "db_connected", "boolean");
campo(salud.cuerpo, "yolo_loaded", "boolean");
campo(salud.cuerpo, "vision_connected", "boolean");
campo(salud.cuerpo, "match_threshold", "number");
comprobar("MySQL conectado", salud.cuerpo?.db_connected === true);
comprobar("servicio de visión conectado", salud.cuerpo?.vision_connected === true);
comprobar("detector cargado (si no, las cifras son simuladas)",
          salud.cuerpo?.yolo_loaded === true,
          salud.cuerpo?.yolo_loaded ? "" : "MODO DEMOSTRACIÓN");

// ─── 2. Ingreso ─────────────────────────────────────────────────────────────
// La app manda el correo en `username` (herencia del esquema OAuth2) y como
// formulario, no como JSON. Las dos cosas se comprueban porque las dos
// romperían el ingreso sin dar ninguna pista.
console.log("\n=== 2. Ingreso ===");
const respLogin = await fetch(`${API}/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: "estudiante@tangram.edu", password: "1234" }).toString(),
});
const entrada = { code: respLogin.status, cuerpo: await respLogin.json().catch(() => null) };
if (entrada.code === 429) {
  console.log("\n  El límite de intentos por IP está agotado (lo agota");
  console.log("  `probar-seguridad.mjs`). Reinicia el backend y repite.\n");
  process.exit(2);
}
comprobar("entra con el correo en `username`", entrada.code === 200, `HTTP ${entrada.code}`);
const token = campo(entrada.cuerpo, "access_token", "string");
campo(entrada.cuerpo, "refresh_token", "string");
campo(entrada.cuerpo, "expires_in", "number");
campo(entrada.cuerpo, "role", "string");
campo(entrada.cuerpo, "name", "string");
const alumno = campo(entrada.cuerpo, "id", "number");

// La app decide qué pantalla abrir con este valor exacto.
comprobar("el rol es 'student'", entrada.cuerpo?.role === "student", `"${entrada.cuerpo?.role}"`);

// Un error de credenciales tiene que llegar como {detail}: es lo único que la
// app sabe pintar, y cualquier otra forma acaba en "Error desconocido".
const respMalas = await fetch(`${API}/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: "estudiante@tangram.edu", password: "clave-mala" }).toString(),
});
const cuerpoMalas = await respMalas.json().catch(() => null);
comprobar("credenciales malas -> {detail} legible",
          typeof cuerpoMalas?.detail === "string", `"${cuerpoMalas?.detail}"`);

// ─── 3. Catálogo ────────────────────────────────────────────────────────────
console.log("\n=== 3. Catálogo de figuras ===");
const figuras = await pedir("/figures", { headers: auth(token) });
comprobar("el catálogo responde", figuras.code === 200, `HTTP ${figuras.code}`);
comprobar("llega una lista no vacía", Array.isArray(figuras.cuerpo) && figuras.cuerpo.length > 0,
          `${figuras.cuerpo?.length} figuras activas`);
const fig = figuras.cuerpo?.[0];
for (const [ruta, tipo] of [
  ["slug", "string"], ["name", "string"], ["emoji", "string"],
  ["description", "string"], ["difficulty", "string"], ["category", "string"],
  ["silhouette", "array"],
]) campo(fig, ruta, tipo);

// La app dibuja la silueta con estos puntos: si vinieran fuera de 0..1 se
// saldrían del lienzo, y si fueran menos de tres no habría polígono que pintar.
const puntos = fig?.silhouette ?? [];
comprobar("la silueta tiene al menos 3 puntos", puntos.length >= 3, `${puntos.length} puntos`);
comprobar("los puntos están normalizados en 0..1",
          puntos.every(p => Array.isArray(p) && p.length === 2 &&
                            p.every(v => typeof v === "number" && v >= -0.01 && v <= 1.01)));

// ─── 4. Análisis de la foto ─────────────────────────────────────────────────
// Es la petición que sostiene la aplicación entera. Se manda una foto
// deliberadamente pobre: no importa el veredicto, importa que la respuesta
// traiga TODOS los campos que la pantalla de resultado lee sin protegerse.
console.log("\n=== 4. /predict, con los campos que lee la pantalla de resultado ===");
const jpegMinimo = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAFQABAQAAAAAA" +
  "AAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AH+f/9k=", "base64");
const inicio = Date.now();
const analisis = await pedir("/predict", {
  method: "POST",
  headers: auth(token),
  body: JSON.stringify({
    image_b64: jpegMinimo.toString("base64"),
    figure_id: fig?.slug,
    crop: [0.1, 0.1, 0.8, 0.8],
  }),
});
const tardo = Date.now() - inicio;
comprobar("analiza la foto", analisis.code === 200, `HTTP ${analisis.code} · ${tardo} ms`);

if (analisis.code === 200) {
  const r = analisis.cuerpo;
  for (const [ruta, tipo] of [
    ["match", "boolean"], ["iou_score", "number"], ["match_threshold", "number"],
    ["feedback", "string"], ["pieces_used", "number"],
    ["pieces", "object"], ["pieces.complete", "boolean"], ["pieces.total", "number"],
    ["pieces.detected", "object"], ["pieces.missing", "object"], ["pieces.extra", "object"],
    ["segments", "array"],
    ["detected_polygon", "array"], ["target_polygon", "array"],
    ["checks", "object"],
    ["checks.inventory.ok", "boolean"], ["checks.overlap.ok", "boolean"],
    ["checks.holes.ok", "boolean"], ["checks.connectivity.ok", "boolean"],
    ["checks.shape.ok", "boolean"], ["checks.shape.iou", "number"],
    ["framing", "object"], ["framing.ok", "boolean"], ["framing.touches_edge", "boolean"],
    ["messages", "array"], ["warnings", "array"],
    ["processing_ms", "number"], ["mock", "boolean"],
  ]) campo(r, ruta, tipo);

  /**
   * Los dos contornos se superponen sobre el mismo lienzo, y van juntos: o
   * llegan los dos o no llega ninguno.
   *
   * Lo que se comprueba es **esa coherencia**, no que vengan llenos. La foto que
   * manda esta prueba es un JPEG mínimo sin ningún Tangram dentro, así que el
   * detector no encuentra nada y los dos salen vacíos: eso es lo correcto, y es
   * justo lo que la interfaz espera para no dibujar una figura degenerada
   * —`AIValidation.tsx` solo pinta la superposición si los dos traen 3 puntos o
   * más—.
   *
   * Antes esto exigía `target_polygon >= 3` a secas y fallaba siempre con esta
   * entrada, avisando de «una pantalla rota» que no lo estaba. Lo que sí sería
   * un fallo real es que llegara uno sin el otro: entonces la app tendría medio
   * dibujo, y ahí sí no habría nada que interpretar.
   */
  const nAlumno = r?.detected_polygon?.length ?? 0;
  const nObjetivo = r?.target_polygon?.length ?? 0;
  comprobar(
    "los dos contornos van a la par (los dos con puntos, o los dos vacíos)",
    (nAlumno >= 3 && nObjetivo >= 3) || (nAlumno === 0 && nObjetivo === 0),
    `armado=${nAlumno} objetivo=${nObjetivo}`,
  );
  comprobar("el feedback no está vacío", (r?.feedback ?? "").length > 0);
  comprobar("no está en modo demostración", r?.mock === false,
            r?.mock ? "las cifras NO salen de la foto" : "");
  comprobar("cabe en la espera del teléfono (45 s)", tardo < 45000, `${tardo} ms`);
}

// ─── 5. Registro del intento ────────────────────────────────────────────────
console.log("\n=== 5. Registro del intento ===");
const guardado = await pedir("/sessions", {
  method: "POST",
  headers: auth(token),
  body: JSON.stringify({
    figure_id: fig?.slug, match: false, iou_score: 0.5,
    time_seconds: 12, errors: 1,
  }),
});
comprobar("el estudiante puede registrar su intento",
          guardado.code === 200 || guardado.code === 201, `HTTP ${guardado.code}`);

// El catálogo del teléfono marca las figuras ya logradas con esta consulta.
const historial = await pedir(`/students/${alumno}/sessions?limit=100`, { headers: auth(token) });
comprobar("el estudiante ve su propio historial", historial.code === 200, `HTTP ${historial.code}`);
campo(historial.cuerpo, "rows", "array");
campo(historial.cuerpo, "total", "number");
const fila = historial.cuerpo?.rows?.[0];
if (fila) for (const [ruta, tipo] of [
  ["figure_id", "string"], ["match_result", "number"], ["iou_score", "number"],
  ["time_seconds", "number"], ["created_at", "string"],
]) campo(fila, ruta, tipo);

/**
 * Las estadísticas de rendimiento ya no son suyas: son del docente.
 *
 * Aquí se comprobaba que un estudiante podía pedir sus propias cifras y recibía
 * un 200. Ahora la regla del sistema es que el progreso de las actividades se
 * mira desde el panel del docente y desde ningún otro sitio, así que lo correcto
 * en esta llamada es un 403 —y comprobarlo es lo que impide que la restricción
 * se deshaga sin que nadie se entere—.
 *
 * Atención al montar la app móvil sobre este contrato: `CatalogueScreen` todavía
 * llama a esta ruta para su barra de progreso. No se rompe —la envuelve en un
 * `.catch()` y se queda sin la cifra—, pero esa barra hay que retirarla cuando
 * se lleve el cambio al teléfono. Lo que el catálogo sí conserva es el historial
 * propio de aquí arriba, que es de donde salen las figuras ya logradas.
 */
const estad = await pedir(`/students/${alumno}/stats`, { headers: auth(token) });
comprobar("sus estadísticas quedan reservadas al docente", estad.code === 403,
          `HTTP ${estad.code}`);
campo(estad.cuerpo, "detail", "string");

// ─── 6. Errores que la app sabe interpretar ─────────────────────────────────
// Todos tienen que llegar como {detail}: es la única forma que la app pinta.
console.log("\n=== 6. Los errores llegan con la forma que la app entiende ===");
const sinToken = await pedir("/figures");
comprobar("sin token -> 401", sinToken.code === 401, `HTTP ${sinToken.code}`);
comprobar("y con {detail}", typeof sinToken.cuerpo?.detail === "string", `"${sinToken.cuerpo?.detail}"`);

const tokenRoto = await pedir("/figures", { headers: auth("no-es-un-token") });
comprobar("token inválido -> 401", tokenRoto.code === 401, `HTTP ${tokenRoto.code}`);
comprobar("y con {detail}", typeof tokenRoto.cuerpo?.detail === "string");

const figuraQueNoExiste = await pedir("/predict", {
  method: "POST", headers: auth(token),
  body: JSON.stringify({ image_b64: jpegMinimo.toString("base64"), figure_id: "no-existe" }),
});
comprobar("figura inexistente -> 404 con {detail}",
          figuraQueNoExiste.code === 404 && typeof figuraQueNoExiste.cuerpo?.detail === "string",
          `HTTP ${figuraQueNoExiste.code}`);

const fotoRota = await pedir("/predict", {
  method: "POST", headers: auth(token),
  body: JSON.stringify({ image_b64: "esto-no-es-una-foto", figure_id: fig?.slug }),
});
comprobar("foto corrupta -> 4xx con {detail}, no 500",
          fotoRota.code >= 400 && fotoRota.code < 500 &&
          typeof fotoRota.cuerpo?.detail === "string", `HTTP ${fotoRota.code}`);

// El listado completo del curso es del docente: un estudiante que lo pida tiene
// que recibir 403, no la lista de sus compañeros.
const listadoAjeno = await pedir("/sessions", { headers: auth(token) });
comprobar("el estudiante NO ve el curso entero", listadoAjeno.code === 403, `HTTP ${listadoAjeno.code}`);

// ─── 7. Renovación del token ────────────────────────────────────────────────
// El token de acceso dura una hora; sin esto, el niño tendría que volver a
// teclear su clave a media actividad.
console.log("\n=== 7. Renovación del token ===");
const renovado = await pedir("/token/refresh", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ refresh_token: entrada.cuerpo?.refresh_token }),
});
comprobar("el token de refresco da uno de acceso nuevo", renovado.code === 200, `HTTP ${renovado.code}`);
campo(renovado.cuerpo, "access_token", "string");
const conNuevo = await pedir("/figures", { headers: auth(renovado.cuerpo?.access_token) });
comprobar("y el token nuevo funciona", conNuevo.code === 200, `HTTP ${conNuevo.code}`);

// ─── 8. Registro desde la app ───────────────────────────────────────────────
// La pantalla de ingreso crea la cuenta con `POST /register` y espera exactamente
// la misma respuesta que `/token`: si el registro dejara de traer los tokens, el
// niño vería «cuenta creada» y a continuación un catálogo que no carga.
//
// Crea una cuenta con un correo único y la borra al final con la cuenta del
// docente de demostración. Si esa cuenta ya no tiene la clave `1234`, la de
// prueba se queda y se avisa para darla de baja desde el panel.
console.log("\n=== 8. Registro desde la app ===");
const correoPrueba = `contrato-${Date.now()}@tangram.edu`;
const registro = await pedir("/register", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Prueba de contrato", email: correoPrueba, password: "2580" }),
});
if (registro.code === 403) {
  console.log("  El registro está cerrado (ALLOW_SELF_REGISTRATION=0): se omite esta sección.");
} else {
  comprobar("crea la cuenta y responde 201", registro.code === 201, `HTTP ${registro.code}`);
  const tokenNuevo = campo(registro.cuerpo, "access_token", "string");
  campo(registro.cuerpo, "refresh_token", "string");
  campo(registro.cuerpo, "expires_in", "number");
  campo(registro.cuerpo, "name", "string");
  const idNuevo = campo(registro.cuerpo, "id", "number");
  comprobar("el rol es 'student'", registro.cuerpo?.role === "student", `"${registro.cuerpo?.role}"`);
  // La clave la eligió el estudiante: no puede nacer marcada como temporal, o
  // la app lo mandaría a cambiarla nada más crearla.
  comprobar("nace con el perfil activo (no pide cambiar la clave)",
            registro.cuerpo?.must_change_password === false);

  // Y la sesión que devuelve sirve tal cual: es lo que evita el segundo viaje.
  const conRegistro = await pedir("/figures", { headers: auth(tokenNuevo) });
  comprobar("la sesión recién creada ya funciona", conRegistro.code === 200, `HTTP ${conRegistro.code}`);

  const repetido = await pedir("/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Otra vez", email: correoPrueba, password: "2580" }),
  });
  comprobar("el correo repetido responde 409 con {detail}",
            repetido.code === 409 && typeof repetido.cuerpo?.detail === "string",
            `HTTP ${repetido.code}`);

  const trivial = await pedir("/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Clave fácil", email: `trivial-${Date.now()}@tangram.edu`, password: "1111" }),
  });
  comprobar("una clave trivial (1111) se rechaza con 422", trivial.code === 422, `HTTP ${trivial.code}`);

  // Limpieza, con la cuenta del docente.
  const respDoc = await fetch(`${API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "docente@tangram.edu", password: "1234" }).toString(),
  });
  const doc = await respDoc.json().catch(() => null);
  if (respDoc.ok && typeof idNuevo === "number") {
    // El docente la ve en su panel antes de borrarla: es lo que se quiere
    // comprobar, que el registro desde el teléfono llega a la lista del curso.
    const lista = await pedir("/students", { headers: auth(doc.access_token) });
    comprobar("el docente ve la cuenta nueva en GET /students",
              Array.isArray(lista.cuerpo) && lista.cuerpo.some(e => e.id === idNuevo));
    const baja = await pedir(`/students/${idNuevo}`, {
      method: "DELETE", headers: auth(doc.access_token),
    });
    comprobar("cuenta de prueba borrada", baja.code === 200, `HTTP ${baja.code}`);
  } else {
    console.log(`  [!] No se pudo entrar como docente para borrar ${correoPrueba}: dala de baja desde el panel.`);
  }
}

console.log("\n" + "=".repeat(62));
console.log(`RESULTADO: ${ok} correctas, ${fallo} fallidas`);
if (fallo > 0) console.log("\nCada línea [FALLA] es una pantalla rota en el teléfono.\n");
else console.log("\nLa app móvil puede hablar con este servidor.\n");
process.exit(fallo > 0 ? 1 : 0);
