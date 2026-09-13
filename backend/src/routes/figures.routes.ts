/** Catálogo de figuras objetivo con sus siluetas de referencia. */
import { Router } from "express";
import { listarFiguras } from "../db/figures.js";
import { exigirSesion } from "../auth/middleware.js";

export const rutasFiguras = Router();

/**
 * `?all=true` incluye también las figuras desactivadas.
 *
 * De las 20 del catálogo solo 7 están activas: triángulo, cisne, conejo
 * sentado, canguro, cohete, vela y molino. Son las que aparecen en las 112
 * fotos con las que se midió el sistema, y por tanto las únicas cuya
 * corrección tiene respaldo experimental. Las otras 13 siguen en la tabla
 * porque de ellas sale la calibración de los umbrales (`--calibrar`), pero no
 * se ofrecen al estudiante. Ver `backend/sql/catalogo-solo-validadas.sql`.
 */
rutasFiguras.get("/figures", exigirSesion, async (req, res) => {
  const todas = req.query.all === "true" || req.query.all === "1";
  res.json(await listarFiguras(!todas));
});
