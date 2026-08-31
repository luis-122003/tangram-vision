import { BRUT, DIFFICULTY_COLOR } from "../theme/brut";
import type { Difficulty } from "../types";

/** Segundos a `m:ss`, para los cronómetros y la tabla del docente. */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Color con que se marca cada dificultad: verde lo fácil, amarillo lo
 * intermedio, rojo lo difícil.
 *
 * Sustituye al `diffDepth` del sistema anterior, que devolvía profundidad de
 * relieve porque aquel estilo no tenía colores que asignar. El nombre escrito
 * («Fácil», «Medio», «Difícil») sigue al lado del distintivo, que es lo que de
 * verdad lo comunica a quien no distinga los colores.
 */
export function diffColor(d: Difficulty): string {
  return DIFFICULTY_COLOR[d] ?? BRUT.card;
}

/** Fracción 0..1 como porcentaje entero. */
export function pct(n: number): string { return `${Math.round(n * 100)}%`; }
