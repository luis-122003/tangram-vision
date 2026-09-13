/**
 * server.ts — API de Tangram IA.
 *
 * Sistema de validación en tiempo real de configuraciones Tangram físicas.
 * Este proceso atiende a la web y a la app móvil: autentica, sirve el catálogo
 * de figuras, guarda los intentos y calcula el progreso del estudiante.
 *
 * El análisis de las fotos —detector YOLOv8-seg y validador geométrico— corre
 * en `vision-service/`, un proceso Python aparte. Ese reparto no es accidental:
 * el validador es geometría calibrada, con sus propias pruebas (`--autotest`) y
 * su estudio de umbrales (`--calibrar`), y traducirlo habría cambiado los
 * resultados del sistema sin mejorar nada.
 *
 * El orden de los middlewares importa y no es arbitrario:
 *   1. `trust proxy`  — sin esto, el límite por IP ve a todos como el mismo.
 *   2. HTTPS          — antes que nada que lea el cuerpo.
 *   3. cabeceras      — para que viajen también en las respuestas de error.
 *   4. CORS           — decide quién puede siquiera hablar.
 *   5. límite general — frena antes de gastar CPU en parsear cuerpos grandes.
 *   6. cuerpos        — ya con todo lo anterior filtrado.
 */
import express from "express";
import cors from "cors";
import type { Server } from "node:http";
import { config } from "./config.js";
import { inicializarBaseDeDatos } from "./db/schema.js";
import { pool } from "./db/pool.js";
import { purgarIntentosViejos } from "./security/intentos.js";
import { cabecerasDeSeguridad, forzarHttps, limiteApi } from "./security/headers.js";
import { manejadorDeErrores, prohibido } from "./http/errors.js";
import { rutasAuth } from "./routes/auth.routes.js";
import { rutasFiguras } from "./routes/figures.routes.js";
import { rutasPredict } from "./routes/predict.routes.js";
import { rutasSesiones } from "./routes/sessions.routes.js";
import { rutasSalud } from "./routes/health.routes.js";
import { rutasClave } from "./routes/password.routes.js";
import { rutasEstudiantes } from "./routes/students.routes.js";
import { estado } from "./vision/client.js";

const app = express();

// Cuántos proxies hay delante. Con un valor mal puesto, `req.ip` deja de ser
// fiable: o todos los clientes parecen el proxy (y un solo abusón bloquea a
// todo el curso), o cualquiera puede falsear su IP con una cabecera.
app.set("trust proxy", config.red.proxiesDeConfianza);
// No se anuncia el motor: es información gratis para quien busca exploits.
app.disable("x-powered-by");

app.use(forzarHttps);
app.use(cabecerasDeSeguridad);

/**
 * CORS. La app móvil llega sin cabecera `Origin` (React Native no la manda),
 * así que las peticiones sin origen se permiten; las de navegador tienen que
 * venir de la lista. En producción `ALLOWED_ORIGINS` no debe quedar en '*'.
 */
app.use(cors({
  origin(origen, callback) {
    if (!origen) return callback(null, true);                  // app móvil, curl
    if (config.red.origenes === "*") return callback(null, true);
    if (config.red.origenesPermitidos.includes(origen)) return callback(null, true);
    // Un `Error` pelado acaba en el 500 genérico y en un volcado en el registro:
    // dice «fallo del servidor» cuando lo que pasa es que ese origen no está en
    // la lista. Con el error tipado sale un 403 con su `{detail}`, que es lo que
    // el navegador y quien mire el log necesitan leer.
    return callback(prohibido("Origen no permitido"));
  },
  credentials: false,
  // PATCH y DELETE están porque el panel de estudiantes los usa, y sin ellos no
  // fallan de forma visible: el navegador manda antes una petición de sondeo
  // (preflight), `cors` contesta que solo admite GET y POST, y **la petición de
  // verdad no llega a salir**. En la web eso se ve como «no se pudo conectar
  // con el servidor», igual que si el backend estuviera apagado, mientras que
  // con curl las dos rutas funcionan perfectamente. Editar y dar de baja a un
  // estudiante eran exactamente eso.
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
}));

app.use(limiteApi);

// `/predict` sube la foto en base64, que abulta un tercio más que el JPEG. El
// límite de fábrica de Express son 100 kB: sin esto, toda foto real se
// rechazaría con un 413. Y sin un tope propio, un cuerpo enorme agota memoria.
app.use(express.json({ limit: `${config.maxImagenMb}mb` }));
// `/token` llega como formulario, no como JSON (ver auth.routes.ts). El tope es
// pequeño: ahí solo caben un correo y una contraseña.
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

app.use(rutasSalud);
app.use(rutasAuth);
app.use(rutasClave);
app.use(rutasFiguras);
app.use(rutasPredict);
app.use(rutasSesiones);
// Va detrás de las sesiones a propósito: `/students/:id/sessions` y
// `/students/:id/stats` los sirve aquel router, y este solo añade `/students`,
// `/students/:id` y el reseteo de clave. Son métodos y rutas distintas, así que
// no se pisan; el orden solo deja el bloque del docente junto en la lectura.
app.use(rutasEstudiantes);

// Ruta desconocida: se responde con la misma forma `{detail}` que el resto de
// los errores, para que los clientes la muestren igual que cualquier otra.
app.use((req, res) => {
  res.status(404).json({ detail: `No existe ${req.method} ${req.path}` });
});

app.use(manejadorDeErrores);

/**
 * ¿Está de verdad el servicio de visión al otro lado?
 *
 * Antes esta línea era un `[OK] Servicio de visión en <url>` que solo repetía la
 * configuración sin comprobar nada. Un `[OK]` que no verifica es peor que no
 * decir nada: se arranca este proceso solo, la consola se ve limpia, y el fallo
 * no aparece hasta que un niño toma una foto y recibe un 503. Esta comprobación
 * traslada ese descubrimiento al arranque, que es donde se puede hacer algo.
 *
 * No bloquea ni impide arrancar: igual que con MySQL, un servidor en pie que
 * explica el problema es más útil que un proceso que muere sin decir por qué.
 */
function comprobarVision(): void {
  estado()
    .then(v => {
      if (!v.validator_ready) {
        console.error("");
        console.error("  ############################################################");
        console.error("  #  El servicio de visión NO responde.                      #");
        console.error("  #  Las fotos no se van a analizar: /predict dará un 503.   #");
        console.error("  #                                                          #");
        console.error(`  #  Esperado en: ${config.vision.url.padEnd(43)}#`);
        console.error("  #  Arráncalo:   cd vision-service                          #");
        console.error("  #               venv\\Scripts\\python -m uvicorn service:app #");
        console.error("  #               --port 8001                                #");
        console.error("  #                                                          #");
        console.error("  #  O levanta los tres procesos juntos con  .\\dev.ps1       #");
        console.error("  ############################################################");
        console.error("");
        return;
      }
      if (!v.yolo_loaded) {
        console.warn(`[!] Visión en ${config.vision.url} · detector NO cargado: responde en`);
        console.warn("    MODO DEMOSTRACIÓN y sus cifras son simuladas. Revisa YOLO_WEIGHTS");
        console.warn("    en vision-service/.env");
        return;
      }
      // `shape_matching` llega en inglés porque es una clave de la API; en la
      // consola se dice en el idioma del resto de los mensajes.
      const comparacion = v.shape_matching === "geometric"
        ? "geométrica (sin pesos)"
        : v.shape_matching ?? "geométrica";
      console.log(
        `[OK] Visión en ${config.vision.url} · detector cargado · comparación ${comparacion}`,
      );
    })
    .catch(() => {
      // `estado()` ya absorbe los fallos de red; esto solo cubre lo imprevisto.
      console.error(`[!] No se pudo comprobar el servicio de visión en ${config.vision.url}`);
    });
}

/**
 * El servidor HTTP, una vez escuchando. Se guarda porque el apagado ordenado
 * necesita cerrarlo, y porque sin la referencia no hay dónde escuchar el error
 * de arranque (un puerto ocupado, sin ir más lejos).
 */
let servidor: Server | null = null;

/** Evita que dos señales seguidas —o un Ctrl-C impaciente— lancen dos cierres. */
let apagando = false;

/**
 * Apagado ordenado.
 *
 * Importa por dos motivos concretos: `servidor.close()` deja terminar la
 * petición que ya está en vuelo —una foto en pleno análisis, por ejemplo—, y
 * `pool.end()` devuelve las conexiones a MySQL en vez de dejarlas colgando
 * hasta que el servidor las expire. Con `tsx watch` esto ocurre en cada guardado
 * de un archivo, así que no es un caso raro de producción: pasa todo el día.
 *
 * El margen de gracia es lo que impide que un cierre limpio se convierta en un
 * proceso zombi: si a los 5 segundos algo sigue sin soltar —una conexión
 * mantenida viva por el navegador es suficiente—, se sale por las bravas.
 */
async function apagar(motivo: string, codigo = 0): Promise<void> {
  if (apagando) return;
  apagando = true;
  console.log(`[..] ${motivo}: cerrando ordenadamente…`);

  const forzar = setTimeout(() => {
    console.error("[!] El cierre tardó más de 5 s; se fuerza la salida.");
    process.exit(codigo === 0 ? 1 : codigo);
  }, 5000);
  // `unref` para que este temporizador no sea, él solo, lo que mantenga vivo al
  // proceso cuando todo lo demás ya se cerró.
  forzar.unref();

  try {
    if (servidor) {
      await new Promise<void>(resolver => servidor?.close(() => resolver()));
    }
    await pool.end();
    console.log("[OK] Cerrado.");
  } catch (error) {
    console.error("[!] Fallo durante el cierre:", error);
    codigo = codigo === 0 ? 1 : codigo;
  } finally {
    clearTimeout(forzar);
    process.exit(codigo);
  }
}

for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => { void apagar(senal); });
}

/**
 * Red de seguridad del proceso.
 *
 * Express 5 ya encamina al manejador de errores lo que lanzan las rutas, así
 * que llegar aquí significa que algo se rompió fuera de una petición: un
 * `setInterval`, una promesa suelta, el propio arranque. Sin estos dos oyentes,
 * Node imprime la traza y mata el proceso sin cerrar el pool, y en el aula eso
 * se ve como «la app dejó de funcionar» sin nada que explique por qué.
 */
process.on("unhandledRejection", (motivo) => {
  console.error("[!] Promesa rechazada sin manejar:", motivo);
  void apagar("promesa rechazada sin manejar", 1);
});

process.on("uncaughtException", (error) => {
  console.error("[!] Excepción no capturada:", error);
  void apagar("excepción no capturada", 1);
});

async function arrancar(): Promise<void> {
  try {
    await inicializarBaseDeDatos();
    await purgarIntentosViejos();
    // La tabla de intentos solo sirve para la ventana reciente; se limpia sola
    // para que no crezca sin fin. `unref` deja que el proceso termine si es lo
    // único que queda vivo.
    setInterval(() => {
      purgarIntentosViejos().catch(e => console.error("[intentos] purga:", e));
    }, 3600_000).unref();
  } catch (error) {
    // Igual que en la versión anterior, un MySQL caído no impide arrancar: el
    // servidor queda en pie y `/health` informa del problema, que es más útil
    // que un proceso que muere y no puede explicar por qué.
    console.error("[!] MySQL no disponible en el arranque:", error);
  }

  servidor = app.listen(config.puerto, () => {
    console.log(`[OK] API escuchando en http://localhost:${config.puerto}`);
    console.log(
      `[OK] Seguridad · CORS: ${config.red.origenes}` +
      ` · HTTPS forzado: ${config.red.forzarHttps ? "sí" : "no"}` +
      ` · foto máx: ${config.maxImagenMb} MB`,
    );
    if (!config.produccion && config.red.origenes === "*") {
      console.warn("[!] ALLOWED_ORIGINS='*': acótalo antes de desplegar.");
    }
    comprobarVision();
  });

  /**
   * Errores del propio socket de escucha. El habitual es tener ya otra copia
   * del backend corriendo, y el mensaje de Node para eso —`listen EADDRINUSE`—
   * no dice qué hacer. Aquí se traduce a algo accionable, porque es el fallo
   * que más veces se encuentra quien arranca el proyecto por primera vez.
   */
  servidor.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `[!] Ya hay algo escuchando en el puerto ${config.puerto}: probablemente otra\n` +
        "    copia de este backend. Ciérrala, o cambia PORT en backend/.env.",
      );
    } else if (error.code === "EACCES") {
      console.error(
        `[!] Sin permiso para escuchar en el puerto ${config.puerto}. Usa uno por\n` +
        "    encima de 1024 en PORT (backend/.env).",
      );
    } else {
      console.error("[!] El servidor no pudo escuchar:", error);
    }
    process.exit(1);
  });
}

/**
 * Un arranque que falla tiene que notarse. Sin este `catch`, el rechazo de la
 * promesa quedaba sin manejar: Node avisaba con una traza confusa y el proceso
 * podía quedarse en pie sin estar escuchando, que es la peor de las dos cosas.
 */
arrancar().catch(error => {
  console.error("[!] No se pudo arrancar el servidor:", error);
  process.exit(1);
});
