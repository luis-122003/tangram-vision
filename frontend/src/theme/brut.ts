import type { CSSProperties } from "react";
import type { Difficulty } from "../types";

/**
 * brut.ts — sistema de diseño neobrutalista.
 *
 * Todo elemento de la interfaz es una placa: fondo plano, **filete negro** y
 * una **sombra sólida** desplazada abajo a la derecha. La sombra no se difumina
 * —no hay blur en ningún sitio— así que no simula luz: es una segunda silueta
 * negra que hace que la placa parezca recortada y apoyada sobre la página.
 *
 * De ahí salen las cuatro formas que se usan en toda la aplicación:
 *
 *   `raised`  — placa apoyada. Tarjetas, botones en reposo, paneles.
 *   `inset`   — hueco practicado en la página. Campos, canales de barra.
 *               Un hueco no proyecta sombra, así que no la lleva.
 *   `pressed` — la placa se desplaza hasta aplastarse contra su propia sombra.
 *               Es lo que hace un botón al pulsarse y un control activo.
 *   `subtle`  — filete y sombra más finos, para lo que se repite mucho.
 *
 * A diferencia del neumorfismo que había antes, aquí **sí hay color y significa
 * algo**: verde es lo logrado, amarillo lo que está en curso, rojo el error.
 * Esa era la limitación del estilo anterior —codificaba el estado solo por
 * relieve— y es lo que este recupera. La regla que sostiene la paleta es que
 * **la tinta siempre es negra**: los acentos son claros y saturados
 * precisamente para que el negro se lea encima de todos ellos.
 */

const PAPER = "#FCF6E8";
const CARD = "#FFFFFF";
const WELL = "#EFE7D6";
const INK = "#111111";

export const BRUT = {
  /** Fondo de la página: un crema cálido, no un blanco clínico. */
  paper: PAPER,
  /** Superficie de una placa apoyada sobre la página. */
  card: CARD,
  /** Superficie de un hueco practicado en la página. */
  well: WELL,

  /** Tinta, filetes y sombras. Un solo negro para las tres cosas. */
  ink: INK,
  /**
   * Texto secundario. Sube desde el `#8794A6` del sistema anterior, que sobre
   * su fondo daba 2,43:1 y no llegaba al mínimo de 4,5:1 que pide WCAG AA.
   * Este da 8,86:1 sobre `card`.
   *
   * Solo se usa sobre `paper`, `card` y `well`. Sobre un color de acento se
   * queda entre 3,0:1 y 3,7:1, así que ahí no vale: encima de un acento va
   * siempre `ink`.
   */
  muted: "#4A4A4A",
  /** Deshabilitado. No transporta información, así que puede ser más flojo. */
  ghost: "#8A8A8A",

  /**
   * Acentos. Claros y saturados, para que la tinta negra se lea encima: el
   * peor de los cinco da 6,80:1, que cumple AA de sobra.
   */
  success: "#7BF1A8",  // logrado, correcto, aprobado
  warning: "#FFD93D",  // pendiente, en curso
  danger: "#FF6B6B",   // error, incorrecto
  accent: "#B197FC",   // elemento activo
  info: "#7DD3FC",     // informativo

  /**
   * No hay escala de radios. El radio es 0 en todo, sin excepciones —basta una
   * esquina redondeada para que la pantalla se lea como otro estilo—, así que
   * los helpers lo fijan y ningún componente necesita pedirlo.
   *
   * Grosor del filete. El fino es para lo que se repite mucho.
   */
  border: 3,
  borderThin: 2,

  /**
   * Placa apoyada sobre la página. `d` es cuánto se desplaza su sombra.
   *
   * El fondo se pinta aquí, igual que hacía el sistema anterior: hay
   * componentes que dependen del helper para tener color de fondo.
   */
  raised(d = 6, background: string = CARD): CSSProperties {
    return {
      background,
      border: `${BRUT.border}px solid ${INK}`,
      borderRadius: 0,
      boxShadow: `${d}px ${d}px 0 ${INK}`,
    };
  },

  /**
   * Hueco practicado en la página. Un hueco no proyecta sombra, así que no la
   * lleva: lo que lo hunde es que su fondo es más oscuro que el de alrededor.
   *
   * El parámetro `d` se ignora —queda por compatibilidad con las llamadas del
   * sistema anterior, que pasaban profundidad— y por eso no aparece en el
   * cuerpo. Se acepta un fondo distinto para los huecos que van en color.
   */
  inset(_d = 5, background: string = WELL): CSSProperties {
    return {
      background,
      border: `${BRUT.border}px solid ${INK}`,
      borderRadius: 0,
      boxShadow: "none",
    };
  },

  /**
   * La placa se desplaza hasta aplastarse contra su propia sombra. Es el gesto
   * de pulsar, y también cómo se marca un control activo: se quedó abajo.
   *
   * Va siempre junto a `raised`, no en su lugar: aporta el desplazamiento y
   * anula la sombra, pero el fondo y el filete los pone el otro.
   */
  pressed(d = 3): CSSProperties {
    return {
      transform: `translate(${d}px, ${d}px)`,
      boxShadow: "none",
    };
  },

  /**
   * Filete y sombra más finos. Para lo que se repite mucho en una misma vista
   * —las filas de una tabla, las fichas de un inventario—: a filete completo,
   * veinte placas juntas se leen como una reja.
   */
  subtle(background: string = CARD): CSSProperties {
    return {
      background,
      border: `${BRUT.borderThin}px solid ${INK}`,
      borderRadius: 0,
      boxShadow: `3px 3px 0 ${INK}`,
    };
  },

  /**
   * Botón. En reposo es una placa; al pulsarlo se aplasta contra su sombra.
   *
   * La sombra se fija en 4px y no se deja parametrizar: la regla `:active` de
   * index.css desplaza el botón exactamente 4px, y si cada botón tuviera un
   * offset distinto, unos aterrizarían sobre su sombra y otros se quedarían
   * deslizados a medias. Es lo que permite que esa regla sea global.
   *
   * El padding baja de 13px a 11px porque `box-sizing: border-box` solo actúa
   * cuando hay alto explícito, y aquí no lo hay: el filete de 3px sumaría 6px
   * al alto exterior y rompería el ritmo de 44px del formulario y de la barra.
   */
  button(disabled?: boolean, background: string = CARD): CSSProperties {
    return {
      ...BRUT.raised(disabled ? 2 : 4, disabled ? WELL : background),
      padding: "11px 26px",
      color: disabled ? BRUT.ghost : INK,
      fontWeight: 800,
      fontSize: 15,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      cursor: disabled ? "default" : "pointer",
      transition: "transform 0.08s ease, box-shadow 0.08s ease",
    };
  },
} as const;

/**
 * Tipografía. La pila del sistema, empujada a sus pesos extremos: 900 para lo
 * que titula, 500 para lo que se lee de corrido. No se carga ninguna fuente
 * externa —la CSP de vite.config.ts fija `font-src 'self'`— y a cambio no hay
 * ni un archivo que descargar ni un salto de tipografía al arrancar.
 */
export const T = {
  /** Titular grande: la marca, el nombre de la figura. */
  display: (size = 34): CSSProperties => ({
    fontSize: size,
    fontWeight: 900,
    letterSpacing: -1.2,
    lineHeight: 1.05,
    color: BRUT.ink,
  }),

  /** Titular de sección. */
  title: (size = 23): CSSProperties => ({
    fontSize: size,
    fontWeight: 900,
    letterSpacing: -0.6,
    lineHeight: 1.15,
    color: BRUT.ink,
  }),

  /** Cifra que cambia en pantalla: ancho fijo, para que no baile. */
  stat: (size = 32): CSSProperties => ({
    fontSize: size,
    fontWeight: 900,
    letterSpacing: -0.8,
    color: BRUT.ink,
    fontVariantNumeric: "tabular-nums",
  }),

  /** Cuerpo de texto. */
  body: (color: string = BRUT.muted): CSSProperties => ({
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.5,
    color,
  }),

  /** Rótulo en versalitas que encabeza un bloque. */
  eyebrow: (color: string = BRUT.muted): CSSProperties => ({
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color,
  }),
} as const;

/**
 * La dificultad se lee por color, no por relieve: verde lo fácil, amarillo lo
 * intermedio, rojo lo difícil. Es el mismo semáforo que ya usan los estados de
 * la aplicación, y el nombre escrito sigue al lado.
 */
export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  "Fácil": BRUT.success,
  "Medio": BRUT.warning,
  "Difícil": BRUT.danger,
};
