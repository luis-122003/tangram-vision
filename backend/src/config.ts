/**
 * config.ts — configuración del backend, leída del entorno una sola vez.
 *
 * Todo lo que puede variar entre máquinas vive aquí y no repartido por el
 * código. Si falta algo imprescindible el servidor no arranca: es preferible un
 * fallo inmediato y explicado a un backend en pie que responde mal a la tercera
 * petición, y sobre todo a uno que arranca con un secreto por defecto.
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz del paquete backend/, tanto ejecutando src/ (tsx) como dist/ (node). */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requerido(nombre: string, ayuda: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(
      `Falta la variable de entorno ${nombre} en backend/.env.\n  ${ayuda}`,
    );
  }
  return valor;
}

/**
 * Secreto en hexadecimal, con longitud mínima comprobada.
 *
 * La comprobación no es un adorno: un `JWT_SECRET=1234` arranca igual de bien
 * que uno de 48 bytes y deja los tokens falsificables sin que nada lo avise.
 */
function secreto(nombre: string, bytesMinimos: number): string {
  const valor = requerido(
    nombre,
    `Genera uno con: node -e "console.log(require('crypto').randomBytes(${bytesMinimos}).toString('hex'))"`,
  );
  if (!/^[0-9a-fA-F]+$/.test(valor) || valor.length < bytesMinimos * 2) {
    throw new Error(
      `${nombre} debe ser hexadecimal de al menos ${bytesMinimos} bytes ` +
      `(${bytesMinimos * 2} caracteres). Regénéralo con:\n` +
      `  node -e "console.log(require('crypto').randomBytes(${bytesMinimos}).toString('hex'))"`,
    );
  }
  return valor;
}

/**
 * Entero de configuración, validado entero y con mínimo.
 *
 * `parseInt` no sirve aquí: se queda con el prefijo numérico y da por bueno un
 * `PAGE_SIZE=12abc` como 12, así que se exige que **todo** el valor sea un
 * número. El mínimo tampoco es un adorno: `PAGE_SIZE=0` pasaba la validación y
 * dejaba todos los listados vacíos —sin error, sin aviso, sin nada que mirar—,
 * que es la peor forma de fallar. Solo `TRUST_PROXY` admite el cero, y por eso
 * el mínimo es un parámetro y no una constante.
 */
function entero(nombre: string, porDefecto: number, minimo = 1): number {
  const bruto = process.env[nombre]?.trim();
  if (!bruto) return porDefecto;
  if (!/^-?\d+$/.test(bruto)) {
    throw new Error(`La variable ${nombre} debe ser un número entero, y vale "${bruto}"`);
  }
  const n = Number(bruto);
  if (n < minimo) {
    throw new Error(
      `La variable ${nombre} debe ser ${minimo === 0 ? "cero o mayor" : "mayor que cero"}, ` +
      `y vale "${bruto}"`,
    );
  }
  return n;
}

/**
 * Duración de un token, en el formato que entienden `jsonwebtoken` y el resto
 * del backend: un número seguido de s, m, h o d.
 *
 * Se valida al arrancar porque el formato lo leen dos piezas distintas:
 * `jwt.sign`, que firma el token, y `segundosDeVida()`, que le dice al cliente
 * cuánto le queda. Un valor raro como `1 hora` no rompía nada visible: la firma
 * tomaba una cosa, el `expires_in` devolvía otra, y el cliente refrescaba
 * cuando ya era tarde. Un fallo al arrancar es infinitamente más barato que
 * perseguir sesiones que caducan antes de tiempo.
 */
function duracion(nombre: string, porDefecto: string): string {
  const bruto = process.env[nombre]?.trim();
  if (!bruto) return porDefecto;
  if (!/^\d+[smhd]$/.test(bruto)) {
    throw new Error(
      `La variable ${nombre} debe ser un número seguido de s, m, h o d ` +
      `(por ejemplo 30m, 1h, 12h), y vale "${bruto}"`,
    );
  }
  return bruto;
}

function bandera(nombre: string, porDefecto = false): boolean {
  const bruto = process.env[nombre];
  if (bruto === undefined) return porDefecto;
  return !["0", "false", "no", ""].includes(bruto.toLowerCase());
}

const produccion = (process.env.NODE_ENV ?? "development") === "production";

/**
 * Orígenes permitidos, en bruto y ya separados. La lista se calcula una sola
 * vez aquí porque la usan dos sitios con criterios distintos —CORS decide quién
 * puede hablar, y la redirección a HTTPS decide a qué host se puede redirigir—
 * y con dos copias del mismo `split` acabarían discrepando.
 */
const origenesBruto = process.env.ALLOWED_ORIGINS ?? "http://localhost:5173";
const origenesPermitidos = origenesBruto.split(",").map(o => o.trim()).filter(Boolean);

export const config = {
  puerto: entero("PORT", 8000),
  produccion,

  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: entero("DB_PORT", 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "tangram_ia",
    /** Umbral a partir del cual una consulta se registra como lenta. */
    consultaLentaMs: entero("DB_SLOW_QUERY_MS", 400),
  },

  jwt: {
    secreto: secreto("JWT_SECRET", 32),
    /**
     * El token de acceso dura poco a propósito. Es el que viaja en cada
     * petición y el que se guarda en el dispositivo, así que si se filtra
     * interesa que caduque pronto; la jornada la sostiene el de refresco.
     */
    expiraEn: duracion("JWT_EXPIRES_IN", "1h"),
    /** Secreto distinto: filtrar uno no debe permitir fabricar el otro. */
    refrescoSecreto: secreto("REFRESH_SECRET", 32),
    refrescoExpiraEn: duracion("REFRESH_EXPIRES_IN", "12h"),
  },

  cifrado: {
    /** AES-256-GCM sobre nombre y correo de los estudiantes (datos de menores). */
    clave: Buffer.from(secreto("ENCRYPTION_KEY", 32), "hex"),
    /**
     * Clave del índice ciego: un HMAC del correo que permite buscarlo sin
     * guardarlo en claro. Va aparte de la de cifrado para que quien obtenga el
     * índice no pueda descifrar nada.
     */
    claveIndice: Buffer.from(secreto("BLIND_INDEX_KEY", 32), "hex"),
  },

  vision: {
    url: (process.env.VISION_URL ?? "http://127.0.0.1:8001").replace(/\/+$/, ""),
    /**
     * Tope de espera al servicio de visión. Tiene que quedar por debajo del
     * tope del cliente (45 s en la app móvil): si el que se rinde primero es el
     * teléfono, el niño ve un error de red genérico en vez del mensaje que este
     * backend sabe darle.
     */
    timeoutMs: entero("VISION_TIMEOUT_MS", 40_000),
  },

  /**
   * Supabase Storage: dónde quedan las fotos que manda el estudiante.
   *
   * Es **opcional a propósito**. Sin `SUPABASE_URL` el sistema funciona
   * exactamente como antes —se analiza la foto y se descarta—, que es lo que
   * permite seguir trabajando sin credenciales y, sobre todo, que un problema
   * con el almacén no deje a un niño sin poder jugar. `activo` es la condición
   * que miran los dos sitios que suben o firman.
   *
   * La clave es la `service_role`, que **salta todas las políticas RLS**: por
   * eso vive solo aquí y no sale nunca del servidor. Ningún cliente habla con
   * Supabase, igual que ninguno habla con MySQL.
   */
  storage: (() => {
    const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
    const clave = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
    return {
      url,
      clave,
      bucket: (process.env.SUPABASE_BUCKET ?? "intentos").trim(),
      /**
       * Cuánto vive la URL firmada con la que el docente ve una foto. Un minuto
       * basta para que el navegador la cargue y es poco para que el enlace, si
       * se copia, siga sirviendo a nadie.
       */
      firmaSegundos: entero("SUPABASE_SIGN_TTL", 60),
      /** Hay dónde guardar y con qué credencial. Si no, no se sube nada. */
      activo: url !== "" && clave !== "",
    };
  })(),

  /**
   * Catálogo semilla. Vive en el servicio de visión porque allí lo usan
   * `--autotest` y `--calibrar` con su ruta por defecto; aquí solo se lee una
   * vez, la primera, para sembrar MySQL.
   */
  figurasSeed: process.env.FIGURES_SEED
    ? path.resolve(RAIZ, process.env.FIGURES_SEED)
    : path.resolve(RAIZ, "..", "vision-service", "data", "figures_seed.json"),

  /**
   * `/predict` sube una foto en base64, que abulta un tercio más que el JPEG.
   * El límite por defecto de Express son 100 kB: sin subirlo, toda foto real se
   * rechazaría con un 413. Y sin un tope propio, cualquiera puede agotar la
   * memoria del servidor mandando un cuerpo enorme.
   */
  maxImagenMb: entero("MAX_IMAGE_MB", 12),

  red: {
    /**
     * Orígenes permitidos por CORS. En producción no puede quedar en '*': una
     * página cualquiera podría montar peticiones contra este backend.
     */
    origenes: origenesBruto,
    /** La misma lista ya separada y sin espacios. Ver `origenesPermitidos`. */
    origenesPermitidos,
    /**
     * Redirigir a HTTPS y mandar HSTS. Se activa cuando hay TLS delante; en el
     * aula, con el móvil hablando por IP en la red local, no lo hay, y forzarlo
     * dejaría la app inutilizable.
     */
    forzarHttps: bandera("FORCE_HTTPS", produccion),
    /**
     * Proxies de confianza delante del backend. Importa para el límite de
     * peticiones: con un proxy sin declarar, todas las IP llegan como la misma
     * y un solo cliente puede bloquear a todo el curso.
     */
    proxiesDeConfianza: entero("TRUST_PROXY", 0, 0),
  },

  limites: {
    /** Peticiones por ventana y por IP, para el conjunto de la API. */
    apiPorMinuto: entero("RATE_LIMIT_API", 120),
    /** `/predict` corre un detector: es caro y se limita aparte. */
    predictPorMinuto: entero("RATE_LIMIT_PREDICT", 20),
    /** Intentos de inicio de sesión por IP en 15 minutos. */
    loginPorIp: entero("RATE_LIMIT_LOGIN_IP", 30),
    /** Filas máximas que devuelve un listado sin paginar. */
    filasPorPagina: entero("PAGE_SIZE", 100),
  },
} as const;
