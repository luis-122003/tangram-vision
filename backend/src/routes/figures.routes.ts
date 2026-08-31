/** Catálogo de figuras objetivo con sus siluetas de referencia. */
import { Router } from "express";
import { listarFiguras } from "../db/figures.js";
import { exigirSesion } from "../auth/middleware.js";

export const rutasFiguras = Router();

/**
 * `?all=true` incluye también las figuras desactivadas. De las 14 del dataset
 * solo 8 están activas por defecto: son aquellas cuya silueta de referencia
 * resultó claramente reconocible.
 */
rutasFiguras.get("/figures", exigirSesion, async (req, res) => {
  const todas = req.query.all === "true" || req.query.all === "1";
  res.json(await listarFiguras(!todas));
});
