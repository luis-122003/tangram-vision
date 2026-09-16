/**
 * headers.ts — cabeceras de seguridad, HTTPS y límites de peticiones.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";
import { HttpError } from "../http/errors.js";

/**
 * Cabeceras de seguridad.
 *
 * La CSP es la pieza que más importa para este backend: aunque aquí no se
 * sirve HTML, la política viaja igualmente y cierra la puerta a que una
 * respuesta acabe interpretándose como página. Es también la mitigación que
 * sostiene la decisión de guardar el token en el dispositivo en vez de en una
 * cookie httpOnly: si no se puede inyectar script, no hay quien lo lea.
 */
export const cabecerasDeSeguridad = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  // La API responde JSON: que ningún navegador intente adivinar otro tipo.
  xContentTypeOptions: true,
  referrerPolicy: { policy: "no-referrer" },
  // HSTS solo cuando hay TLS delante. Mandarlo sobre HTTP en la red del aula
  // dejaría el navegador del docente incapaz de volver a entrar por http://.
  hsts: config.red.forzarHttps
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
    : false,
  crossOriginResourcePolicy: { policy: "same-site" },
});

/**
 * Hosts a los que se puede redirigir, sacados de `ALLOWED_ORIGINS`.
 *
 * La cabecera `Host` la escribe quien llama, así que construir el destino de la
 * redirección con ella es fiarse del cliente para decidir a dónde mandarlo:
 * basta un `Host: sitio-falso.example` para que este servidor conteste un 308
 * hacia allí con su propia firma, y eso es lo que convierte una redirección en
 * una redirección abierta —y en veneno para cualquier caché por medio—.
 * Comparándolo contra la lista de orígenes, el destino solo puede ser uno de
 * los sitios que ya se habían declarado de confianza.
 *
 * Si la API vive en un host distinto al de la web (api.ejemplo.edu frente a
 * ejemplo.edu), hay que añadirlo también a ALLOWED_ORIGINS. Con la lista en
 * '*' no queda nada contra lo que comparar y no se redirige: acotarla es parte
 * de poner el sistema en producción, no un extra.
 */
const HOSTS_PERMITIDOS: ReadonlySet<string> = new Set(
  config.red.origenesPermitidos.flatMap(origen => {
    try {
      return [new URL(origen).host.toLowerCase()];
    } catch {
      return [];   // no es una URL ('*', o una entrada mal escrita): no se usa
    }
  }),
);

/**
 * Redirige a HTTPS cuando está activado.
 *
 * Va apagado por defecto y es deliberado: en el aula el móvil habla con la PC
 * por IP en la red local, donde no hay certificado que valga, y forzar HTTPS
 * dejaría la app sin poder conectarse. Se enciende con `FORCE_HTTPS=1` en
 * cuanto haya un proxy con TLS delante, que es donde tiene sentido.
 */
export function forzarHttps(req: Request, res: Response, next: NextFunction): void {
  if (!config.red.forzarHttps) { next(); return; }

  // Detrás de un proxy, `req.secure` mira X-Forwarded-Proto, y eso solo es
  // fiable si `trust proxy` está bien configurado (ver TRUST_PROXY).
  if (req.secure) { next(); return; }

  if (req.method === "GET" || req.method === "HEAD") {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!HOSTS_PERMITIDOS.has(host)) {
      next(new HttpError(
        400,
        "El servidor no reconoce este Host. Revisa ALLOWED_ORIGINS en la configuración.",
      ));
      return;
    }
    res.redirect(308, `https://${host}${req.originalUrl}`);
    return;
  }
  // Un POST no se redirige: el cliente reenviaría el cuerpo por el canal
  // inseguro antes de saber que había que cambiar de esquema.
  next(new HttpError(403, "Esta API solo acepta conexiones HTTPS"));
}

/** Mensaje unificado para cualquier límite superado. */
function alSuperarLimite(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(429, "Demasiadas peticiones. Espera un momento e inténtalo otra vez."));
}

const comunes = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  handler: alSuperarLimite,
};

/** Límite general de la API, por IP. */
export const limiteApi: RequestHandler = rateLimit({
  ...comunes,
  windowMs: 60_000,
  limit: config.limites.apiPorMinuto,
});

/**
 * `/predict` va aparte porque cada llamada arranca el detector: es la ruta más
 * cara del sistema y la que antes tumbaría el servicio si se abusara de ella.
 * El límite se aplica **por usuario**, no por IP, porque un aula entera sale a
 * Internet por la misma dirección y un límite por IP castigaría a todo el grupo.
 */
export const limitePredict: RequestHandler = rateLimit({
  ...comunes,
  windowMs: 60_000,
  limit: config.limites.predictPorMinuto,
  keyGenerator: (req: Request) =>
    req.usuario ? `u:${req.usuario.id}` : ipKeyGenerator(req.ip ?? "desconocida"),
});

/**
 * Límite del inicio de sesión por IP. Es la primera barrera; la segunda, por
 * cuenta y con bloqueo creciente, está en `security/intentos.ts`.
 */
export const limiteLogin: RequestHandler = rateLimit({
  ...comunes,
  windowMs: 15 * 60_000,
  limit: config.limites.loginPorIp,
  skipSuccessfulRequests: true,
});

/**
 * Límite del registro desde la app, por IP y por hora.
 *
 * A diferencia del ingreso, aquí **cuentan también los intentos que salen
 * bien**: una cuenta creada es justo lo que hay que racionar, porque cada una
 * es una fila cifrada con bcrypt de por medio y un nombre más en el panel del
 * docente. Con `skipSuccessfulRequests` un script podría crear cuentas sin
 * tope mientras no fallara ninguna.
 */
export const limiteRegistro: RequestHandler = rateLimit({
  ...comunes,
  windowMs: 60 * 60_000,
  limit: config.limites.registroPorIp,
});
