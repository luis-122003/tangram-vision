/**
 * predict.routes.ts — validación de la foto del Tangram armado.
 *
 * Este backend hace tres cosas y ninguna es visión por computador: comprueba
 * quién pregunta, comprueba que lo que sube es de verdad una foto, y busca en
 * MySQL la silueta de la figura objetivo. El análisis lo resuelve
 * `vision-service/`, que devuelve ya construido el JSON que la app espera.
 */
import { Router } from "express";
import { z } from "zod";
import { obtenerFigura } from "../db/figures.js";
import { analizar } from "../vision/client.js";
import { exigirSesion } from "../auth/middleware.js";
import { limitePredict } from "../security/headers.js";
import { validarImagen } from "../security/imagen.js";
import { noEncontrado } from "../http/errors.js";

export const rutasPredict = Router();

/**
 * Un slug es una clave del catálogo, no texto libre: se acota a lo que puede
 * ser un slug para que nada raro llegue siquiera a la consulta.
 */
const SLUG = z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/i, "Figura no válida");

const esquemaPredict = z.object({
  image_b64: z.string().min(1, "Falta la foto"),
  figure_id: SLUG,
  /**
   * Los clientes lo siguen enviando, pero se ignora: el estudiante es el del
   * token. Se acepta para no obligar a publicar la app móvil a la vez que el
   * servidor.
   */
  student_id: z.number().int().positive().optional(),
  /**
   * Recuadro que el estudiante vio en la pantalla, como [x, y, ancho, alto]
   * normalizados sobre la foto: el servicio recorta ahí antes de detectar, para
   * que la figura ocupe el fotograma aunque la foto se haya tomado de lejos.
   *
   * O vienen los cuatro números, o no viene nada. Antes se admitía una lista de
   * cero a cuatro y luego se afirmaba con un `as` que eran cuatro: el tipo
   * decía una cosa y el dato podía ser otra, y quien recibía la mentira era el
   * servicio de visión.
   *
   * El `.catch(null)` es lo que conserva la regla de siempre: un recuadro mal
   * formado no puede dejar al niño sin respuesta. En vez de rechazar la
   * petición con un 422, se descarta el recuadro y se analiza la foto completa,
   * que es exactamente lo que el servicio de visión hace cuando no hay
   * recuadro. Se pierde el encuadre; no se pierde el intento.
   */
  crop: z
    .tuple([
      z.number().min(-1).max(2),
      z.number().min(-1).max(2),
      z.number().min(-1).max(2),
      z.number().min(-1).max(2),
    ])
    .nullish()
    .catch(null),
});

rutasPredict.post("/predict", exigirSesion, limitePredict, async (req, res) => {
  const datos = esquemaPredict.parse(req.body);

  // Antes de nada: ¿esto es una foto? Se comprueba por los bytes, no por lo que
  // diga el cliente. Va primero para no gastar una consulta ni un segundo de
  // detector en algo que no lo es.
  const imagen = validarImagen(datos.image_b64);

  const figura = await obtenerFigura(datos.figure_id);
  if (!figura) throw noEncontrado(`Figura '${datos.figure_id}' no encontrada`);

  const resultado = await analizar({
    image_b64: imagen.base64,
    crop: datos.crop ?? null,
    figure: {
      slug: figura.slug,
      name: figura.name,
      silhouette: figura.silhouette,
    },
  });

  res.json(resultado);
});
