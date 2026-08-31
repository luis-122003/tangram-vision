/**
 * pool.ts — conexión a MySQL y vigilancia de lo que se le pide.
 *
 * Se usa un pool y no conexiones sueltas porque `/predict` puede tener varias
 * fotos en vuelo a la vez y cada una consulta el catálogo.
 *
 * Todas las consultas pasan por `consulta()`, que mide cuánto tardan y registra
 * las lentas y las que fallan. No es telemetría de adorno: una consulta que se
 * dispara suele ser el primer síntoma de un índice que falta o de alguien
 * barriendo la API, y sin registro no hay forma de enterarse hasta que el aula
 * entera se queda esperando.
 */
import mysql from "mysql2/promise";
import { config } from "../config.js";

/**
 * `charset` explícito: la columna `difficulty` es un ENUM con acentos
 * ('Fácil','Medio','Difícil') y el catálogo se ordena con
 * `ORDER BY FIELD(difficulty, 'Fácil', …)`. Con la codificación por defecto del
 * servidor esa comparación puede no casar ninguna fila y el orden saldría
 * silenciosamente mal.
 */
const OPCIONES_COMUNES = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  charset: "utf8mb4",
  /**
   * Nunca se permiten varias sentencias en una misma llamada. Es la diferencia
   * entre que una inyección, si alguna vez la hubiera, pueda leer una tabla o
   * pueda además borrarla.
   */
  multipleStatements: false,
} as const;

export const pool = mysql.createPool({
  ...OPCIONES_COMUNES,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  /** Cola acotada: sin tope, una avalancha de peticiones acaba en memoria. */
  queueLimit: 100,
  connectTimeout: 10_000,
  dateStrings: false,
});

/** Contadores del proceso, expuestos en `/health` para ver el estado de un vistazo. */
export const metricas = {
  consultas: 0,
  lentas: 0,
  errores: 0,
  /** Milisegundos acumulados; con `consultas` da el promedio. */
  msTotal: 0,
};

/** Recorta la consulta para el registro: ni cuerpos enteros ni datos personales. */
function resumen(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Ejecuta una consulta con parámetros y la vigila.
 *
 * Los parámetros **nunca** se interpolan en el texto de la consulta: van
 * siempre como marcadores `?`, que es lo que hace imposible una inyección SQL.
 * Tampoco se registran, porque contienen correos y hashes.
 */
export async function consulta<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const t0 = Date.now();
  try {
    const [filas] = await pool.query(sql, params);
    const ms = Date.now() - t0;
    metricas.consultas++;
    metricas.msTotal += ms;
    if (ms >= config.db.consultaLentaMs) {
      metricas.lentas++;
      console.warn(`[db] consulta lenta (${ms} ms): ${resumen(sql)}`);
    }
    return filas as T[];
  } catch (error) {
    metricas.errores++;
    // Se registra la consulta, no los parámetros: en ellos viajan los datos
    // personales, y un registro no es sitio para ellos.
    console.error(`[db] error en: ${resumen(sql)}`, error);
    throw error;
  }
}

/**
 * Conexión sin base de datos seleccionada, para poder crearla la primera vez.
 * Quien la abre debe cerrarla.
 */
export function conexionSinBaseDeDatos(): Promise<mysql.Connection> {
  return mysql.createConnection(OPCIONES_COMUNES);
}

/** ¿Responde MySQL? Lo usa `/health`. */
export async function baseDeDatosViva(): Promise<boolean> {
  try {
    const conn = await pool.getConnection();
    conn.release();
    return true;
  } catch {
    return false;
  }
}
