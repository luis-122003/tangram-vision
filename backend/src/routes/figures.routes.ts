/**
 * figures.routes.ts — catálogo de figuras objetivo y su administración.
 *
 * La lectura es de cualquier usuario con sesión: es lo que pinta el catálogo.
 * Lo demás —extraer la silueta de una foto, dar de alta una figura, ocultarla—
 * es del docente, y se comprueba contra la base en cada petición
 * (`exigirSesion` relee el rol), no contra lo que diga el token.
 *
 * Añadir una figura no toca el modelo. El detector reconoce **fichas**, no
 * figuras; lo que distingue una figura de otra es su polígono de referencia,
 * que aquí se saca de una foto con el mismo detector y se guarda en MySQL.
 * Las figuras del panel viven solo en la base, igual que los estudiantes:
 * `figures_seed.json` es la siembra de una instalación nueva y no se toca.
 */
import { Router } from "express";
import { z } from "zod";
import {
  cambiarEstadoFigura, crearFigura, listarFiguras, slugLibre,
} from "../db/figures.js";
import { exigirDocente, exigirSesion } from "../auth/middleware.js";
import { limitePredict } from "../security/headers.js";
import { validarImagen } from "../security/imagen.js";
import { extraerSilueta } from "../vision/client.js";
import { noEncontrado } from "../http/errors.js";

export const rutasFiguras = Router();

/**
 * `?all=true` incluye también las figuras desactivadas.
 *
 * De las 20 sembradas solo 7 están activas: son las que aparecen en las 112
 * fotos con las que se midió el sistema, y por tanto las únicas cuya
 * corrección tiene respaldo experimental. Las otras 13 siguen en la tabla
 * porque de ellas sale la calibración de los umbrales (`--calibrar`), pero no
 * se ofrecen al estudiante. Ver `backend/sql/catalogo-solo-validadas.sql`.
 * A esas se suman las que el docente añada desde su panel.
 */
rutasFiguras.get("/figures", exigirSesion, async (req, res) => {
  const todas = req.query.all === "true" || req.query.all === "1";
  res.json(await listarFiguras(!todas));
});

/**
 * Extrae de una foto la silueta de una figura nueva, sin guardar nada.
 *
 * Es el paso previo al alta: el docente sube la foto de la figura armada, ve
 * la silueta que salió y decide si sirve. Lleva el mismo límite que `/predict`
 * porque cuesta lo mismo —una pasada del detector— y aquí quien lo pide es un
 * docente pulsando un botón, que puede volver a pulsarlo.
 */
rutasFiguras.post(
  "/figures/silhouette",
  exigirSesion, exigirDocente, limitePredict,
  async (req, res) => {
    const { image_b64 } = z.object({ image_b64: z.string().min(1, "Falta la foto") }).parse(req.body);
    // Por los bytes, no por lo que diga el cliente, y antes de gastar un segundo
    // de detector en algo que no es una foto.
    const imagen = validarImagen(image_b64);
    res.json(await extraerSilueta(imagen.base64));
  },
);

/** Un punto del lienzo 0..1. El margen de tolerancia absorbe el redondeo. */
const punto = z.tuple([z.number().min(-0.01).max(1.01), z.number().min(-0.01).max(1.01)]);

/**
 * Alta de una figura. La silueta viene ya normalizada de `/figures/silhouette`;
 * aquí solo se comprueba que sea un polígono (tres puntos o más) dentro del
 * lienzo. El nombre y los demás campos son los que ve el estudiante.
 *
 * `emoji` es opcional porque no todo el mundo tiene a mano uno para «llave»,
 * y el catálogo no lo necesita para funcionar: la silueta es la imagen.
 */
const esquemaFigura = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  category: z.enum(["Animales", "Objetos", "Personas"]),
  difficulty: z.enum(["Fácil", "Medio", "Difícil"]),
  emoji: z.string().trim().max(16).optional(),
  description: z.string().trim().max(255).optional(),
  silhouette: z.array(punto).min(3, "La silueta necesita al menos 3 puntos").max(400),
});

rutasFiguras.post("/figures", exigirSesion, exigirDocente, async (req, res) => {
  const datos = esquemaFigura.parse(req.body);
  const figura = await crearFigura({
    slug: await slugLibre(datos.name),
    name: datos.name,
    emoji: datos.emoji || "🧩",
    description: datos.description || `${datos.name}, añadida desde el panel del docente`,
    difficulty: datos.difficulty,
    category: datos.category,
    silhouette: datos.silhouette,
  });
  res.status(201).json({ figure: figura });
});

/**
 * Oculta o vuelve a mostrar una figura. No hay DELETE a propósito: los intentos
 * guardados apuntan al slug, y borrar la figura dejaría el historial del curso
 * con filas que ya no se pueden nombrar.
 */
rutasFiguras.patch("/figures/:slug", exigirSesion, exigirDocente, async (req, res) => {
  const slug = z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/i, "Figura no válida").parse(req.params.slug);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  if (!(await cambiarEstadoFigura(slug, enabled))) throw noEncontrado("Esa figura no existe");
  res.json({ ok: true, slug, enabled });
});
