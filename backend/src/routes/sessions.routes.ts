/**
 * sessions.routes.ts — intentos de los estudiantes y estadísticas.
 *
 * Aquí es donde más se nota el cambio de autenticación. Antes cualquiera podía
 * pedir `/sessions` y llevarse el historial completo del curso; ahora ese
 * listado es del docente, está paginado, y el estudiante tiene el suyo propio.
 */
import { Router } from "express";
import { z } from "zod";
import {
  estadisticasDeEstudiante,
  insertarSesion,
  sesionesDeEstudiante,
  todasLasSesiones,
} from "../db/sessions.js";
import {
  exigirClaveDefinitiva,
  exigirDocente,
  exigirPropioODocente,
  exigirSesion,
  idDeRuta,
  soloEstudiante,
} from "../auth/middleware.js";
import { rutaPerteneceA } from "../storage/supabase.js";
import { noAutorizado } from "../http/errors.js";
import { config } from "../config.js";

export const rutasSesiones = Router();

/**
 * Registro de un intento.
 *
 * Cada número lleva su rango. Sin ellos, un cliente manipulado podría anotar un
 * IoU de 50 o un tiempo negativo y falsear las estadísticas del curso, que es
 * justo lo que el docente va a mirar para evaluar.
 */
const esquemaSesion = z.object({
  /**
   * Lo mandan los clientes, pero el que se guarda es el del token: si se
   * confiara en el cuerpo, un estudiante podría anotar intentos a nombre de un
   * compañero.
   */
  student_id: z.number().int().positive().optional(),
  figure_id: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/i, "Figura no válida"),
  match: z.boolean(),
  iou_score: z.number().min(0).max(1),
  time_seconds: z.number().int().min(0).max(24 * 3600),
  errors: z.number().int().min(0).max(10_000),
  /** La app lo envía; la hora que vale es la que pone MySQL al insertar. */
  timestamp: z.string().max(40).optional(),
  /**
   * Ruta de la foto en el bucket, tal como la devolvió `/predict`.
   *
   * El formato se acota aquí —`{id}/{año-mes}/{uuid}.{ext}`— y la pertenencia se
   * comprueba abajo. Son dos cosas distintas: esto impide que llegue una ruta
   * con `../` o con caracteres raros; lo de abajo impide que llegue la ruta
   * legítima de otro estudiante.
   *
   * `.catch(null)` por la regla de siempre: una ruta mal formada hace que el
   * intento se guarde sin foto, no que se pierda el intento.
   */
  image_path: z
    .string()
    .max(255)
    .regex(/^\d+\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|bmp)$/i, "Ruta de foto no válida")
    .nullish()
    .catch(null),
});

/**
 * Paginación. No lleva tope aquí a propósito: un cliente que pida 500 filas
 * recibe las 100 del máximo, no un error. Quien recorta es `paginacion()` en
 * db/sessions.ts, y lo hace siempre, así que el servidor nunca devuelve de más
 * por mucho que se le pida. Rechazar en su lugar rompería una app publicada el
 * día que se bajara el máximo.
 */
const esquemaPagina = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

rutasSesiones.post(
  "/sessions",
  exigirSesion,
  exigirClaveDefinitiva,
  soloEstudiante,
  async (req, res) => {
    const datos = esquemaSesion.parse(req.body);
    const usuario = req.usuario;
    if (!usuario) throw noAutorizado();

    /**
     * La ruta de la foto llega del cliente, así que se comprueba que sea suya.
     *
     * Sin esto, un estudiante podría anotar en su intento la foto de un
     * compañero: no conoce la ruta exacta, pero el primer segmento es el id y el
     * resto se puede ir probando. El panel del docente se la enseñaría como
     * suya, que es precisamente la confusión que las fotos vienen a evitar.
     *
     * Una ruta ajena se descarta en silencio y el intento se guarda sin foto —no
     * se rechaza la petición—: si algún día la app manda algo raro, el niño no
     * se queda sin poder registrar lo que acaba de armar.
     */
    const imagenRuta =
      datos.image_path && rutaPerteneceA(datos.image_path, usuario.id)
        ? datos.image_path
        : null;

    if (datos.image_path && !imagenRuta) {
      console.warn(
        `[sessions] el estudiante ${usuario.id} mandó una ruta de foto que no es suya`,
      );
    }

    await insertarSesion({
      student_id: usuario.id,        // del token, nunca del cuerpo
      figure_id: datos.figure_id,
      match: datos.match,
      iou_score: datos.iou_score,
      time_seconds: datos.time_seconds,
      errors: datos.errors,
      image_path: imagenRuta,
    });
    res.json({ ok: true });
  },
);

/** Historial completo del curso: dashboard del docente. */
rutasSesiones.get("/sessions", exigirSesion, exigirDocente, async (req, res) => {
  const { limit, offset } = esquemaPagina.parse(req.query);
  res.json(await todasLasSesiones(limit, offset));
});

/**
 * Historial de un solo estudiante.
 *
 * Existe porque la app móvil necesita saber qué figuras ha resuelto el niño
 * para marcarlas en el catálogo, y hasta ahora lo conseguía descargando las
 * sesiones de todos los estudiantes y filtrando en el teléfono. Con el listado
 * completo reservado al docente, esa vía ya no está disponible —ni debería
 * haberlo estado—.
 */
rutasSesiones.get(
  "/students/:id/sessions",
  exigirSesion,
  exigirPropioODocente("id"),
  async (req, res) => {
    // `idDeRuta` en vez de `Number(...)`: con `/students/abc/sessions` aquello
    // mandaba un `NaN` a la consulta y el cliente recibía un 500. Ahora es un
    // 422, que es lo que de verdad ha pasado.
    const estudianteId = idDeRuta.parse(req.params.id);
    const { limit, offset } = esquemaPagina.parse(req.query);
    res.json(await sesionesDeEstudiante(estudianteId, limit, offset));
  },
);

/**
 * Estadísticas de rendimiento de un estudiante: intentos, acertados, precisión.
 *
 * Es del docente, y solo suyo. Antes la pedía el propio estudiante para pintarse
 * sus tres cifras en la pantalla de inicio, y esa pantalla ya no existe: el
 * progreso de las actividades se mira desde el panel del docente y desde ningún
 * otro sitio.
 *
 * La regla se cierra aquí y no solo quitando las tarjetas de la interfaz porque
 * son cosas distintas. Sin `exigirDocente`, el dato seguiría estando a un `curl`
 * con el token del niño: la pantalla habría desaparecido y la cifra no.
 *
 * `/students/:id/sessions`, justo arriba, sigue abierta al propio estudiante a
 * propósito: de ahí saca la app móvil **qué figuras ha resuelto** para marcarlas
 * en el catálogo, que es parte de jugar y no una medida de su desempeño.
 */
rutasSesiones.get(
  "/students/:id/stats",
  exigirSesion,
  exigirDocente,
  async (req, res) => {
    res.json(await estadisticasDeEstudiante(idDeRuta.parse(req.params.id)));
  },
);
