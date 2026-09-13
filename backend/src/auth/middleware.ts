/**
 * middleware.ts — quién puede llamar a qué.
 *
 * Cuatro reglas, y cada una responde a un caso real del aula:
 *   · `exigirSesion`  — hay que haber iniciado sesión, y el token tiene que
 *                       seguir siendo válido *hoy* (ver la comprobación de
 *                       versión más abajo).
 *   · `exigirDocente` — el listado completo de intentos es del docente; un
 *                       estudiante no tiene por qué ver los de sus compañeros.
 *   · `exigirPropioODocente` — un estudiante consulta lo suyo, el docente lo de
 *                       cualquiera.
 *   · `soloEstudiante` — el docente no juega: no registra intentos a su nombre.
 *   · `exigirClaveDefinitiva` — con la clave temporal todavía puesta se puede
 *                       entrar y cambiarla, pero no usar la aplicación.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { verificarAcceso, type Identidad } from "./jwt.js";
import { buscarPorId } from "../db/users.js";
import { HttpError, noAutorizado, prohibido } from "../http/errors.js";

/** Lo que se responde cuando el `:id` de la ruta no es un identificador. */
const MENSAJE_ID = "El identificador del estudiante debe ser un número entero positivo";

/**
 * Identificador de estudiante tal como viene en la ruta (`/students/:id/…`).
 *
 * Se define aquí y se exporta porque lo leen dos sitios —este middleware y los
 * manejadores de `sessions.routes.ts`— y antes cada uno hacía su propio
 * `Number(...)`. Con un `:id` no numérico eso daba `NaN`, el middleware dejaba
 * pasar al docente sin comprobarlo, y el `NaN` llegaba hasta MySQL, que
 * contestaba «Unknown column 'NaN'»: un 500 con pinta de fallo del servidor
 * cuando lo que había era una URL mal escrita. Validado aquí, es un 422.
 */
export const idDeRuta = z.coerce
  .number({ invalid_type_error: MENSAJE_ID })
  .int(MENSAJE_ID)
  .positive(MENSAJE_ID);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Presente en toda ruta que pase por `exigirSesion`. */
      usuario?: Identidad;
      /**
       * La cuenta sigue con la clave temporal que le puso el docente.
       *
       * Se deja aquí y no dentro de `usuario` a propósito: `Identidad` es lo
       * que viaja **firmado dentro del token**, y este dato no puede vivir ahí.
       * Un token se emite al entrar y vale una hora; si el estado de la clave
       * viajara dentro, cambiarla no surtiría efecto hasta que caducara, que es
       * justo el rato en el que el estudiante está intentando jugar.
       */
      claveTemporal?: boolean;
    }
  }
}

function leerToken(req: Request): string | null {
  const cabecera = req.headers.authorization;
  if (!cabecera) return null;
  const [esquema, token] = cabecera.split(" ");
  if (!token || esquema?.toLowerCase() !== "bearer") return null;
  return token;
}

/**
 * Exige un token de acceso válido y vigente.
 *
 * Además de comprobar la firma, se contrasta la versión de sesión contra la
 * base. Un JWT es válido hasta que caduca, y eso significa que sin esta
 * comprobación no habría forma de echar a nadie antes de tiempo: ni al cerrar
 * sesión en todos los dispositivos, ni al detectar una cuenta comprometida.
 */
export async function exigirSesion(
  req: Request, _res: Response, next: NextFunction,
): Promise<void> {
  const token = leerToken(req);
  if (!token) {
    next(noAutorizado("Falta el token de sesión"));
    return;
  }

  const identidad = verificarAcceso(token);
  if (!identidad) {
    next(noAutorizado("Tu sesión expiró. Vuelve a iniciar sesión."));
    return;
  }

  try {
    const usuario = await buscarPorId(identidad.id);
    if (!usuario) {
      // La cuenta se borró después de emitir el token.
      next(noAutorizado("Tu sesión ya no es válida."));
      return;
    }
    if (usuario.token_version !== identidad.ver) {
      next(noAutorizado("Tu sesión se cerró. Vuelve a iniciar sesión."));
      return;
    }
    // El rol se toma de la base, no del token: si a alguien se le cambia el rol,
    // el cambio surte efecto en la siguiente petición y no cuando caduque.
    req.usuario = { ...identidad, role: usuario.role, name: usuario.name };
    req.claveTemporal = usuario.must_change_password;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Cierra la aplicación mientras la clave siga siendo la temporal.
 *
 * Va después de `exigirSesion`, y solo sobre lo que es *usar la app* —analizar
 * una foto, anotar un intento—: entrar, consultar el catálogo y cambiar la
 * clave siguen abiertos, porque son exactamente los pasos que hay que dar para
 * salir de este estado.
 *
 * Existe porque sin él la obligación de cambiar la clave sería una sugerencia
 * de la interfaz: bastaría una app vieja, o un cliente escrito a mano, para
 * saltarse la pantalla y seguir con la clave que el docente repartió en voz
 * alta delante de toda la clase.
 *
 * El código es 403 y no 401: las credenciales están bien y la sesión es válida
 * —de hecho hace falta tenerla para poder cambiar la clave—, lo que pasa es que
 * esta cuenta todavía no puede hacer esto. Un 401 haría que el cliente cerrara
 * la sesión y devolviera al niño al ingreso, en bucle.
 */
export function exigirClaveDefinitiva(
  req: Request, _res: Response, next: NextFunction,
): void {
  if (req.claveTemporal) {
    next(prohibido(
      "Tienes que cambiar tu clave temporal antes de empezar a jugar.",
    ));
    return;
  }
  next();
}

export function exigirDocente(req: Request, _res: Response, next: NextFunction): void {
  if (req.usuario?.role !== "teacher") {
    next(prohibido("Solo el docente puede ver esta información"));
    return;
  }
  next();
}

export function soloEstudiante(req: Request, _res: Response, next: NextFunction): void {
  if (req.usuario?.role !== "student") {
    next(prohibido("Solo un estudiante puede registrar intentos"));
    return;
  }
  next();
}

/**
 * Deja pasar al docente y al propio estudiante. `parametro` es el nombre del
 * parámetro de ruta que lleva el id del estudiante (p. ej. `:id`).
 */
export function exigirPropioODocente(parametro = "id") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const usuario = req.usuario;
    if (!usuario) {
      next(noAutorizado());
      return;
    }
    // El identificador se valida antes que el rol: al docente se le dejaba
    // pasar sin mirarlo, y era justo por ahí por donde se colaba el `NaN`.
    const analisis = idDeRuta.safeParse(req.params[parametro]);
    if (!analisis.success) {
      next(new HttpError(422, MENSAJE_ID));
      return;
    }
    if (usuario.role === "teacher") {
      next();
      return;
    }
    if (analisis.data !== usuario.id) {
      next(prohibido("Solo puedes consultar tu propia información"));
      return;
    }
    next();
  };
}
