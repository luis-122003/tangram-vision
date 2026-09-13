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
import { exigirClaveDefinitiva, exigirSesion } from "../auth/middleware.js";
import { limitePredict } from "../security/headers.js";
import { validarImagen } from "../security/imagen.js";
import { subirFoto } from "../storage/supabase.js";
import { noAutorizado, noEncontrado } from "../http/errors.js";

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

rutasPredict.post(
  "/predict",
  exigirSesion,
  // Con la clave temporal todavía puesta no se analiza nada: la cuenta aún no
  // es del estudiante, y un intento anotado a su nombre desde una clave que
  // repartió el docente no dice nada de lo que el niño sabe hacer.
  exigirClaveDefinitiva,
  limitePredict,
  async (req, res) => {
    const datos = esquemaPredict.parse(req.body);

    const usuario = req.usuario;
    if (!usuario) throw noAutorizado();

    // Antes de nada: ¿esto es una foto? Se comprueba por los bytes, no por lo que
    // diga el cliente. Va primero para no gastar una consulta ni un segundo de
    // detector en algo que no lo es.
    const imagen = validarImagen(datos.image_b64);

    const figura = await obtenerFigura(datos.figure_id);
    if (!figura) throw noEncontrado(`Figura '${datos.figure_id}' no encontrada`);

    /**
     * El análisis y la subida van **a la vez**, no una detrás de otra.
     *
     * Son independientes —el detector no necesita que la foto esté guardada, y
     * guardarla no necesita el resultado—, así que encadenarlas le sumaría al
     * niño el tiempo del almacén encima del del detector sin ganar nada.
     *
     * `subirFoto` no lanza nunca: si Supabase está caído o apagado devuelve
     * `null`, y el `Promise.all` no se rompe. Lo único que se pierde entonces es
     * la foto; el análisis sigue su curso, que es la regla de siempre.
     */
    const [resultado, imagenRuta] = await Promise.all([
      analizar({
        image_b64: imagen.base64,
        crop: datos.crop ?? null,
        figure: {
          slug: figura.slug,
          name: figura.name,
          silhouette: figura.silhouette,
        },
      }),
      subirFoto(usuario.id, imagen.datos, imagen.formato),
    ]);

    /**
     * La ruta vuelve al cliente para que la reenvíe al registrar el intento en
     * `/sessions`. Es el único camino: la foto se sube durante `/predict`,
     * cuando todavía no hay fila de `sessions` a la que atarla —y puede que no
     * llegue a haberla, si el niño no registra el intento—.
     *
     * Que viaje por el cliente obliga a no fiarse de lo que vuelva, y de eso se
     * encarga `rutaPerteneceA` en `/sessions`.
     */
    res.json({ ...resultado, image_path: imagenRuta });
  },
);
