/**
 * students.routes.ts — alta, edición y baja de estudiantes.
 *
 * Es el panel del docente, y todo lo que hay aquí está detrás de
 * `exigirDocente`: un estudiante que llamara a estas rutas recibe un 403. No es
 * una formalidad —son los datos personales de todo un curso de primaria— y por
 * eso el rol se comprueba contra la base en cada petición (`exigirSesion` lo
 * relee), no contra lo que diga el token.
 *
 * La clave temporal es la pieza que da sentido al conjunto. Al crear una
 * cuenta, el servidor genera cuatro dígitos, los guarda hasheados y los
 * devuelve **una sola vez**, en la respuesta de esa misma petición. No se
 * guardan en claro en ninguna parte, así que no hay forma de volver a
 * consultarlos: si el docente los pierde, el camino es regenerarlos. Eso es
 * deliberado. Una clave que se puede volver a mirar es una clave que sigue
 * disponible para cualquiera que entre al panel meses después.
 */
import { Router } from "express";
import { z } from "zod";
import {
  actualizarEstudiante,
  buscarEstudiante,
  cambiarClave,
  crearEstudiante,
  eliminarEstudiante,
  esCorreoDuplicado,
  listarEstudiantes,
  revocarSesiones,
} from "../db/users.js";
import { exigirDocente, exigirSesion, idDeRuta } from "../auth/middleware.js";
import { borrarFotosDe } from "../storage/supabase.js";
import { generarClaveTemporal } from "../security/clave-temporal.js";
import { HttpError, noEncontrado } from "../http/errors.js";

export const rutasEstudiantes = Router();

/**
 * Nombre y correo del estudiante.
 *
 * El tope del correo son 254 caracteres porque es el máximo que admite una
 * dirección de correo; el del nombre es holgado a propósito, que los apellidos
 * compuestos existen. El `trim` va dentro del esquema y no en el manejador para
 * que lo que se valide sea exactamente lo que se va a guardar: sin él, un
 * nombre de un solo espacio pasaba el `min(2)` y quedaba en blanco en la lista.
 */
const esquemaDatos = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Ese correo no tiene un formato válido")
    .max(254),
});

/**
 * El alta admite además una contraseña, y es opcional a propósito.
 *
 * El docente que da de alta a un curso entero no quiere inventarse treinta
 * claves: para eso está el generador de cuatro dígitos, que sigue siendo lo que
 * pasa si este campo no viene. Pero el que da de alta a **un** niño y se la va a
 * dictar ahí mismo sí quiere elegirla, y hasta ahora no podía.
 *
 * Los límites son los mismos que los de `POST /password` —mínimo 4, máximo
 * 200—, y no por simetría: son los que ya tiene que cumplir cualquier clave de
 * este sistema, así que aceptar aquí una de tres caracteres crearía una cuenta
 * cuya clave el propio servidor rechazaría en el siguiente cambio.
 */
const esquemaAlta = esquemaDatos.extend({
  password: z
    .string()
    .min(4, "La contraseña debe tener al menos 4 caracteres")
    .max(200)
    .optional(),
});

/**
 * En la edición los dos campos son opcionales, pero tiene que venir alguno.
 *
 * Sale de `esquemaDatos` y no de `esquemaAlta` para que `PATCH` no acepte
 * `password`: la clave se cambia por su propio camino —el estudiante con
 * `POST /password`, el docente con el reseteo—, y los dos revocan las sesiones
 * abiertas. Colarla aquí habría dado una tercera vía que no lo hace.
 */
const esquemaEdicion = esquemaDatos.partial().refine(
  datos => datos.name !== undefined || datos.email !== undefined,
  { message: "No hay nada que cambiar: envía un nombre o un correo" },
);

/** Traduce el correo repetido al 409 que le corresponde. */
function comoHttp(error: unknown): unknown {
  return esCorreoDuplicado(error)
    ? new HttpError(409, "Ya hay una cuenta con ese correo")
    : error;
}

/** Lista del curso, con el progreso de cada estudiante. */
rutasEstudiantes.get("/students", exigirSesion, exigirDocente, async (_req, res) => {
  res.json(await listarEstudiantes());
});

/**
 * Alta de un estudiante.
 *
 * La respuesta lleva `temporary_password`, y es la **única** vez que ese valor
 * sale del servidor. Quien construya la interfaz tiene que enseñarlo de forma
 * que el docente pueda copiarlo antes de cerrar el aviso.
 *
 * El campo conserva ese nombre aunque ahora la clave pueda venir elegida por el
 * docente —y entonces no sea temporal— porque es el que ya leen el panel web y
 * la app móvil publicados; renombrarlo rompería a los dos para describir mejor
 * un valor que en ambos casos significa lo mismo: la clave con la que ese niño
 * va a entrar la primera vez. Qué régimen tiene lo dice `student`, en su
 * `must_change_password`.
 */
rutasEstudiantes.post("/students", exigirSesion, exigirDocente, async (req, res) => {
  const { name, email, password } = esquemaAlta.parse(req.body);
  // Sin contraseña en el cuerpo, la genera el servidor y nace temporal.
  const laEligioElDocente = password !== undefined;
  const clave = password ?? generarClaveTemporal();

  let id: number;
  try {
    id = await crearEstudiante(name, email, clave, !laEligioElDocente);
  } catch (error) {
    throw comoHttp(error);
  }

  res.status(201).json({
    student: await buscarEstudiante(id),
    temporary_password: clave,
    detail: laEligioElDocente
      ? "Cuenta creada con la contraseña que escribiste. No se puede volver a " +
        "consultar: el servidor solo guarda su hash."
      : "Anota esta clave: no se puede volver a consultar. El estudiante tendrá " +
        "que cambiarla la primera vez que entre.",
  });
});

/** Cambia el nombre o el correo. La clave no se toca desde aquí. */
rutasEstudiantes.patch("/students/:id", exigirSesion, exigirDocente, async (req, res) => {
  const id = idDeRuta.parse(req.params.id);
  const cambios = esquemaEdicion.parse(req.body);

  let existe: boolean;
  try {
    existe = await actualizarEstudiante(id, { nombre: cambios.name, correo: cambios.email });
  } catch (error) {
    throw comoHttp(error);
  }
  if (!existe) throw noEncontrado("Ese estudiante no existe");

  res.json({ student: await buscarEstudiante(id) });
});

/**
 * Regenera la clave temporal de un estudiante.
 *
 * Es lo que se usa cuando un niño olvida la suya, y por eso hace dos cosas y no
 * una: pone la clave nueva marcada como temporal —el estudiante volverá a tener
 * que cambiarla— y **revoca sus sesiones**. Sin lo segundo, el teléfono donde
 * se quedó la sesión abierta seguiría dentro de la cuenta con la clave vieja, y
 * resetear la clave no habría servido para lo único que se pide: sacar de la
 * cuenta a quien no debería estar.
 */
rutasEstudiantes.post(
  "/students/:id/password/reset",
  exigirSesion,
  exigirDocente,
  async (req, res) => {
    const id = idDeRuta.parse(req.params.id);
    const estudiante = await buscarEstudiante(id);
    if (!estudiante) throw noEncontrado("Ese estudiante no existe");

    const claveTemporal = generarClaveTemporal();
    // Revocar va primero por lo que pasa si la segunda escritura falla: al
    // revés, la clave quedaría cambiada y su valor en claro se perdería con el
    // 500 —el servidor solo guarda el hash—, dejando al estudiante fuera de una
    // cuenta cuya clave no conoce ya nadie. En este orden, un fallo deja la
    // clave anterior en pie y al estudiante fuera de sus sesiones, que se
    // arregla volviendo a pulsar el botón.
    await revocarSesiones(id);
    await cambiarClave(id, claveTemporal, true);

    res.json({
      student: await buscarEstudiante(id),
      temporary_password: claveTemporal,
      detail:
        "Clave nueva generada. Anótala: no se puede volver a consultar. Si el " +
        "estudiante tenía la sesión abierta, se le cerró.",
    });
  },
);

/**
 * Baja de un estudiante.
 *
 * Se lleva por delante sus intentos (`sessions` está declarada con
 * `ON DELETE CASCADE`), así que la interfaz tiene que pedir confirmación: desde
 * aquí no hay vuelta atrás.
 *
 * Y se lleva también sus fotos. `ON DELETE CASCADE` solo alcanza a MySQL: sin
 * este paso, las fotos del niño seguirían en Supabase después de darlo de baja,
 * que es exactamente lo que no puede pasar con imágenes de menores.
 *
 * Las fotos van **primero**, y el orden se eligió por cuál es el peor final de
 * cada uno. Borrando la cuenta antes, si luego falla el almacén quedan fotos de
 * un niño que ya no existe en el sistema y a las que nadie volverá a apuntar:
 * son datos de un menor sin dueño ni rastro. Borrando las fotos antes, si luego
 * falla MySQL se pierden las imágenes de un estudiante que sigue de alta —una
 * pérdida real, pero visible y sin riesgo para él—. Entre perder evidencias y
 * dejar huérfanas las fotos de un menor, se pierde la evidencia.
 */
rutasEstudiantes.delete("/students/:id", exigirSesion, exigirDocente, async (req, res) => {
  const id = idDeRuta.parse(req.params.id);

  const fotos = await borrarFotosDe(id);

  if (!(await eliminarEstudiante(id))) throw noEncontrado("Ese estudiante no existe");
  res.json({ ok: true, fotos_borradas: fotos });
});
