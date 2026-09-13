/**
 * sessions.ts — intentos de los estudiantes y sus estadísticas.
 *
 * El nombre y el correo del estudiante están cifrados en `users`, así que el
 * dashboard del docente no puede traerlos con un JOIN y ya está: se descifran
 * al salir, fila por fila. Se usa `descifrarSeguro` para que una fila ilegible
 * no tumbe el listado entero.
 */
import { consulta } from "./pool.js";
import { descifrarSeguro } from "../security/crypto.js";
import { urlsFirmadas } from "../storage/supabase.js";
import { config } from "../config.js";
import type { Sesion, SesionConEstudiante } from "../types.js";

export interface NuevaSesion {
  student_id: number;
  figure_id: string;
  match: boolean;
  iou_score: number;
  time_seconds: number;
  errors: number;
  /** Ruta de la foto en el bucket. `null` si no se guardó ninguna. */
  image_path?: string | null;
}

export async function insertarSesion(registro: NuevaSesion): Promise<void> {
  await consulta(
    `INSERT INTO sessions
       (student_id, figure_id, match_result, iou_score, time_seconds, errors, image_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      registro.student_id,
      registro.figure_id,
      registro.match ? 1 : 0,
      registro.iou_score,
      registro.time_seconds,
      registro.errors,
      registro.image_path ?? null,
    ],
  );
}

/** Página de resultados: lo que se devuelve y cuánto queda. */
export interface Pagina<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Normaliza los parámetros de paginación que llegan de fuera.
 *
 * El tope no es negociable desde el cliente: `limit` se recorta al máximo
 * configurado. Sin eso, un `?limit=1000000` obliga al servidor a descifrar el
 * curso entero y a mandarlo por la red.
 */
function paginacion(limit?: number, offset?: number) {
  const max = config.limites.filasPorPagina;
  return {
    limit: Math.min(Math.max(1, Math.trunc(limit ?? max)), max),
    offset: Math.max(0, Math.trunc(offset ?? 0)),
  };
}

/** Todas las sesiones del curso, paginadas. Es la vista del docente. */
export async function todasLasSesiones(
  limit?: number, offset?: number,
): Promise<Pagina<SesionConEstudiante>> {
  const p = paginacion(limit, offset);

  const [conteo] = await consulta<{ c: number }>("SELECT COUNT(*) AS c FROM sessions");
  // El desempate por `id` no es cosmético. `created_at` es un TIMESTAMP de
  // precisión 0, es decir, al segundo: varios intentos del mismo grupo caen en
  // el mismo valor y, sin segundo criterio, MySQL puede devolverlos en un orden
  // distinto en cada consulta. Con paginación eso significa que una fila
  // aparezca en la página 1 y otra vez en la 2, o que no salga en ninguna. El
  // `id` es autoincremental, así que ordena exactamente igual que el tiempo.
  const filas = await consulta<any>(
    `SELECT s.*, u.name_enc, u.email_enc
     FROM sessions s
     JOIN users u ON u.id = s.student_id
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT ? OFFSET ?`,
    [p.limit, p.offset],
  );

  // Una sola llamada al almacén para toda la página, no una por fila. Si el
  // almacén está apagado o falla, el mapa vuelve vacío y cada intento sale con
  // `image_url: null`: el docente ve el listado completo, sin las fotos.
  const firmadas = await urlsFirmadas(
    filas.map(f => f.image_path).filter((r): r is string => Boolean(r)),
  );

  const rows = filas.map(({ name_enc, email_enc, ...sesion }) => ({
    ...sesion,
    student_name: descifrarSeguro(name_enc) ?? "—",
    student_email: descifrarSeguro(email_enc) ?? "—",
    image_url: sesion.image_path ? firmadas.get(sesion.image_path) ?? null : null,
  })) as SesionConEstudiante[];

  return { rows, total: Number(conteo?.c ?? 0), limit: p.limit, offset: p.offset };
}

export async function sesionesDeEstudiante(
  studentId: number, limit?: number, offset?: number,
): Promise<Pagina<Sesion>> {
  const p = paginacion(limit, offset);

  const [conteo] = await consulta<{ c: number }>(
    "SELECT COUNT(*) AS c FROM sessions WHERE student_id = ?", [studentId],
  );
  // Mismo desempate por `id` que en el listado del docente, y por el mismo
  // motivo: dos intentos del mismo segundo no tienen orden garantizado entre
  // sí, y la app móvil lee este listado paginado para saber qué figuras ha
  // resuelto el niño.
  const rows = await consulta<Sesion>(
    `SELECT * FROM sessions WHERE student_id = ?
     ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [studentId, p.limit, p.offset],
  );

  return { rows, total: Number(conteo?.c ?? 0), limit: p.limit, offset: p.offset };
}

export interface Estadisticas {
  total: number;
  passed: number;
  avg_iou: number;
  accuracy: number;
}

/** Redondeo a un número fijo de decimales, como el `round()` de la versión Python. */
function redondear(valor: number, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round(valor * f) / f;
}

/**
 * Total, aprobados, IoU promedio y acierto de un estudiante.
 *
 * El cálculo lo hace MySQL en vez de traerse todas las filas para recorrerlas
 * aquí: es una sola consulta y no crece con el historial del estudiante.
 */
export async function estadisticasDeEstudiante(studentId: number): Promise<Estadisticas> {
  const filas = await consulta<any>(
    `SELECT COUNT(*)              AS total,
            SUM(match_result = 1) AS passed,
            AVG(iou_score)        AS avg_iou
     FROM sessions WHERE student_id = ?`,
    [studentId],
  );

  const total = Number(filas[0]?.total ?? 0);
  if (total === 0) return { total: 0, passed: 0, avg_iou: 0, accuracy: 0 };

  const passed = Number(filas[0]?.passed ?? 0);
  return {
    total,
    passed,
    avg_iou: redondear(Number(filas[0]?.avg_iou ?? 0), 3),
    accuracy: redondear(passed / total, 3),
  };
}
