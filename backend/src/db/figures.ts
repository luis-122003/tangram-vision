/** Acceso al catálogo de figuras objetivo y a sus siluetas de referencia. */
import { consulta } from "./pool.js";
import type { Figura } from "../types.js";

/**
 * Normaliza una fila cruda de MySQL.
 *
 * `mysql2` ya devuelve las columnas JSON parseadas, a diferencia del conector
 * de Python; la comprobación de cadena se conserva por si el servidor está
 * configurado para devolverlas como texto. `enabled` es un TINYINT y se
 * convierte a booleano para que el JSON de salida sea el mismo que antes.
 */
function normalizar(fila: any): Figura {
  return {
    ...fila,
    silhouette:
      typeof fila.silhouette === "string" ? JSON.parse(fila.silhouette) : fila.silhouette,
    enabled: Boolean(fila.enabled),
  };
}

export async function listarFiguras(soloActivas = true): Promise<Figura[]> {
  // El orden por dificultad es el pedagógico (de fácil a difícil), no el
  // alfabético que daría un ORDER BY normal sobre el ENUM.
  //
  // `soloActivas` es un booleano del servidor, no un dato del cliente: no hay
  // nada del exterior que acabe concatenado en el texto de la consulta.
  const filas = await consulta<any>(
    `SELECT * FROM figures
     ${soloActivas ? "WHERE enabled = 1" : ""}
     ORDER BY FIELD(difficulty, 'Fácil', 'Medio', 'Difícil'), name`,
  );
  return filas.map(normalizar);
}

export async function obtenerFigura(slug: string): Promise<Figura | null> {
  const filas = await consulta<any>("SELECT * FROM figures WHERE slug = ? LIMIT 1", [slug]);
  return filas[0] ? normalizar(filas[0]) : null;
}
