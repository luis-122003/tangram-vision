/** Acceso al catálogo de figuras objetivo y a sus siluetas de referencia. */
import { consulta } from "./pool.js";
import type { Figura, Punto } from "../types.js";

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

// ─── Figuras añadidas desde el panel del docente ──────────────────────────────

/**
 * Slug a partir del nombre: minúsculas, sin acentos, palabras unidas por `_`.
 *
 * El slug es la clave con la que `sessions.figure_id` guarda cada intento, así
 * que se genera aquí una vez y no vuelve a cambiar aunque el nombre sí. Si el
 * nombre no deja ningún carácter útil («¿?»), se cae a `figura`.
 */
export function slugDe(nombre: string): string {
  const base = nombre
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "figura";
}

/**
 * Un slug que no esté ya en la tabla: el del nombre, o con `_2`, `_3`… detrás.
 *
 * Dos figuras pueden llamarse igual —«Gato» de un curso y «Gato» de otro—, pero
 * no compartir clave. Se consulta y no se confía en el índice único: aquí el
 * conflicto se resuelve eligiendo otro slug, no rechazando el alta.
 */
export async function slugLibre(nombre: string): Promise<string> {
  const base = slugDe(nombre);
  const filas = await consulta<{ slug: string }>(
    "SELECT slug FROM figures WHERE slug = ? OR slug LIKE ?", [base, `${base}\\_%`],
  );
  const usados = new Set(filas.map(f => f.slug));
  if (!usados.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidato = `${base}_${n}`;
    if (!usados.has(candidato)) return candidato;
  }
}

/**
 * Da de alta una figura y devuelve su fila.
 *
 * Nace activa y sin clase de YOLO (`yolo_class_id = NULL`): las figuras del
 * panel no dependen del detector, igual que las seis que se añadieron desde
 * fotos reales. El polígono llega ya normalizado por el servicio de visión.
 */
export async function crearFigura(datos: {
  slug: string; name: string; emoji: string; description: string;
  difficulty: Figura["difficulty"]; category: string; silhouette: Punto[];
}): Promise<Figura> {
  await consulta(
    `INSERT INTO figures
       (slug, name, emoji, description, difficulty, category, enabled, yolo_class_id, silhouette)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)`,
    [
      datos.slug, datos.name, datos.emoji, datos.description, datos.difficulty,
      datos.category, JSON.stringify(datos.silhouette),
    ],
  );
  const figura = await obtenerFigura(datos.slug);
  if (!figura) throw new Error(`La figura ${datos.slug} se insertó pero no se pudo leer`);
  return figura;
}

/**
 * Oculta o vuelve a mostrar una figura. Devuelve false si el slug no existe.
 *
 * Ocultar y no borrar, a propósito: los intentos guardados en `sessions`
 * apuntan a este slug, y borrar la figura dejaría el historial del curso con
 * filas que ya no se pueden nombrar (ver `sql/catalogo-solo-validadas.sql`).
 */
export async function cambiarEstadoFigura(slug: string, enabled: boolean): Promise<boolean> {
  const res = await consulta<any>(
    "UPDATE figures SET enabled = ? WHERE slug = ?", [enabled ? 1 : 0, slug],
  );
  return Number((res as unknown as { affectedRows?: number }).affectedRows ?? 0) > 0;
}
