/**
 * errors.ts — errores HTTP con el formato que ya esperan los clientes.
 *
 * El backend anterior era FastAPI, que responde los errores como
 * `{"detail": "..."}`. La web y la app móvil leen exactamente ese campo
 * (`frontend/src/api/client.ts` y `mobile/src/api/client.ts`), así que el
 * formato no es un detalle interno: es parte del contrato. Un manejador de
 * errores que devolviera `{"error": ...}` dejaría a los dos clientes mostrando
 * "Error del servidor" en lugar del motivo real, sin fallar en ninguna prueba.
 */
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const noAutorizado = (msg = "No autenticado") => new HttpError(401, msg);
export const prohibido = (msg = "No tienes permiso para ver esto") => new HttpError(403, msg);
export const noEncontrado = (msg: string) => new HttpError(404, msg);

/** Cuerpo con el que el `body-parser` de Express marca un JSON demasiado grande. */
function esCargaExcesiva(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type?: string }).type === "entity.too.large"
  );
}

export function manejadorDeErrores(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ detail: err.message });
    return;
  }

  // Validación del cuerpo. FastAPI usa 422 para esto y la app móvil ya sabe
  // desenvolver ese caso, así que se conserva el código.
  if (err instanceof ZodError) {
    const primero = err.issues[0];
    const donde = primero?.path.join(".");
    res.status(422).json({
      detail: primero
        ? `${donde ? `${donde}: ` : ""}${primero.message}`
        : "Cuerpo de la petición inválido",
    });
    return;
  }

  if (esCargaExcesiva(err)) {
    res.status(413).json({
      detail: "La foto es demasiado grande. Vuelve a tomarla con menos resolución.",
    });
    return;
  }

  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ detail: "El cuerpo de la petición no es JSON válido" });
    return;
  }

  // Cualquier otra cosa es un fallo nuestro: se registra entero en el servidor
  // y al cliente se le da un mensaje sobrio, sin filtrar trazas ni SQL.
  console.error("[error no controlado]", err);
  res.status(500).json({ detail: "Error interno del servidor" });
}
