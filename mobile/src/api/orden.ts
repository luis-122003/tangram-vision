import type { Figure } from "./types";

/**
 * El orden en que se recorren las figuras.
 *
 * Existe porque «siguiente figura» tiene que significar algo. El catálogo se
 * puede filtrar por categoría y se pinta en una rejilla de dos columnas, así
 * que «la de al lado» depende de cómo esté mirando la pantalla el niño; el
 * orden de progresión no puede depender de eso.
 *
 * La progresión es por dificultad —Fácil, Medio, Difícil— y dentro de cada
 * nivel por el `id` del catálogo, que es el orden en que se sembraron las
 * figuras. Es la decisión pedagógica del sistema: quien termina una figura
 * fácil pasa a otra fácil, y solo sube de nivel cuando se acaban las de su
 * nivel.
 *
 * Vive aquí, junto a los tipos de la API, y no dentro de una pantalla: lo usan
 * el catálogo (para saber qué viene después de lo que el niño acaba de tocar) y
 * la raíz de la app (para encadenar una figura con la siguiente). Con dos
 * copias, el botón «siguiente» y el catálogo acabarían contando órdenes
 * distintos.
 */
const RANGO: Record<string, number> = { "Fácil": 0, "Medio": 1, "Difícil": 2 };

/**
 * Una dificultad que no esté en la tabla va al final y no al principio.
 *
 * Es el caso de una figura añadida al catálogo con una etiqueta nueva: dejarla
 * la primera la pondría delante de las fáciles, que es justo lo contrario de lo
 * que se quiere mientras nadie decida dónde encaja.
 */
function rango(dificultad: string): number {
  return RANGO[dificultad] ?? 99;
}

/** El catálogo ordenado por progresión. No modifica el array que recibe. */
export function ordenarPorProgresion(figuras: Figure[]): Figure[] {
  return [...figuras].sort(
    (a, b) => rango(a.difficulty) - rango(b.difficulty) || a.id - b.id,
  );
}

/**
 * Qué figura viene después de esta. `null` si es la última del catálogo.
 *
 * Devolver `null` en la última es deliberado: quien llama tiene que ofrecer
 * volver al catálogo en vez de dar la vuelta y mandar al niño otra vez a la
 * primera figura, que se lee como si la app se hubiera perdido.
 */
export function siguienteFigura(figuras: Figure[], actual: Figure): Figure | null {
  const orden = ordenarPorProgresion(figuras);
  const i = orden.findIndex(f => f.slug === actual.slug);
  if (i === -1) return null;
  return orden[i + 1] ?? null;
}
