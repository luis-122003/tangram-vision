import { Platform, type ViewStyle } from "react-native";

/**
 * Sistema de diseño de la app del estudiante: neobrutalismo.
 *
 * Todo elemento es una placa: fondo de color plano, **filete negro** y una
 * **sombra sólida** desplazada abajo a la derecha. La sombra no se difumina en
 * ningún sitio, así que no simula luz: es una segunda silueta negra que hace
 * que la placa parezca recortada y apoyada sobre la página.
 *
 * De ahí salen las cuatro formas que se usan en toda la app:
 *
 *   `raised`  — placa apoyada. Tarjetas, botones en reposo, paneles.
 *   `inset`   — hueco practicado en la página. Campos, canales de barra.
 *               Un hueco no proyecta sombra, así que no la lleva.
 *   `pressed` — la placa se desplaza hasta aplastarse contra su propia sombra.
 *   `subtle`  — filete y sombra finos, para lo que se repite mucho.
 *
 * A diferencia del neumorfismo anterior, aquí **el color significa algo**:
 * verde es lo logrado, amarillo lo que está a medias, rojo lo que va mal. Aquel
 * sistema codificaba el estado solo por relieve —hundido quería decir
 * resuelto—, y eso hay que aprenderlo; un color no. La regla que sostiene la
 * paleta es que **la tinta es negra sobre todos los rellenos menos el azul**,
 * que por ser el más oscuro lleva tinta crema (ver `ON`).
 *
 * Sigue requiriendo React Native 0.76 o superior con la New Architecture, por
 * `boxShadow` — aunque ahora se le pide bastante menos que antes: una sombra
 * sin difuminado en vez de dos difuminadas, y ninguna `inset`.
 */

const PAPER = "#FCF6E8";
const CARD = "#FFFFFF";
const WELL = "#EFE7D6";
const INK = "#111111";

export const C = {
  /** Fondo de pantalla: un crema cálido, no un blanco clínico. */
  base:   PAPER,
  paper:  PAPER,
  /** Superficie de una placa apoyada. Antes era alias de `base`; ahora se
   *  distingue de verdad, y es lo que separa la lámina del fondo sin sombra. */
  card:   CARD,
  /** Superficie de un hueco practicado en la página. */
  well:   WELL,
  light:  CARD,
  /** Color de filetes y sombras. Antes era el gris de sombra del neumorfismo;
   *  ahora es el negro, así que las sombras escritas a mano en las pantallas
   *  siguen construyéndose con el token correcto. */
  dark:   INK,

  ink:    INK,
  /** Cuerpo de texto. Sube desde `#5A6472`: 9,2:1 sobre el papel. */
  muted:  "#4A423C",
  /**
   * Rótulos secundarios y placeholder. Sube desde `#A7B2C1`, que daba **1,5:1**
   * y era el token que hacía imposible cumplir WCAG AA en esta app. Ahora 5,7:1.
   * No hay un cuarto peso más claro: no existe un caso legítimo para texto que
   * no se pueda leer.
   */
  ghost:  "#6B6058",
  /** Separadores. En este estilo lo que divide es la línea negra. */
  line:   INK,
  rule:   INK,
  /** Nota al margen: amarillo pálido, para el consejo que no es un estado. */
  note:   "#FFF0B8",

  /**
   * Acentos semánticos. Claros y saturados para que la tinta negra se lea
   * encima: el peor da 6,80:1, por encima del 4,5:1 de WCAG AA.
   */
  success: "#7BF1A8",
  warning: "#FFD93D",
  danger:  "#FF6B6B",
  accent:  "#B197FC",
  info:    "#7DD3FC",

  /**
   * Las cinco fichas del Tangram.
   *
   * Los nombres siguen siendo los de las fichas **físicas** que el niño tiene
   * sobre la mesa. Dos de las cinco se desplazaron de matiz a propósito: el
   * verde es azulado y no verde hoja, y el ciruela es magenta y no morado.
   * La razón es medible: un verde amarillento colapsa contra el rojo en
   * deuteranopía, y un morado contra el azul. Así las cinco quedan además
   * escalonadas en luminancia (0,75 · 0,47 · 0,33 · 0,27 · 0,13), de modo que
   * siguen ordenadas y separadas en escala de grises.
   *
   * Y la señal que no depende del color: cada ficha se dibuja con su forma
   * geométrica y su contorno negro, y el rótulo escrito va siempre al lado.
   */
  rojo:     "#FA5238",  // bermellón
  ambar:    "#FFE01A",  // amarillo puro
  verde:    "#00CF92",  // verde azulado
  cobalto:  "#2F4DFF",  // azul eléctrico
  ciruela:  "#E86FD0",  // magenta

  /** Fondo de la vista de cámara. Sobre él el sistema se invierte: ver abajo. */
  dark_camera: "#141414",
};

/**
 * Tinta obligatoria para cada relleno. No es una sugerencia: `ink` sobre
 * `cobalto` da 3,26:1 y **no llega** al mínimo de 4,5:1, mientras que crema
 * sobre cobalto da 5,37:1. Es el único relleno que invierte la tinta, y es
 * justo el que invita a equivocarse.
 */
export const ON: Record<string, string> = {
  [C.paper]:   C.ink,   // 17,52:1
  [C.card]:    C.ink,   // 18,88:1
  [C.well]:    C.ink,   // 15,35:1
  [C.note]:    C.ink,
  [C.success]: C.ink,   // 13,48:1
  [C.warning]: C.ink,   // 13,71:1
  [C.danger]:  C.ink,   //  6,80:1
  [C.accent]:  C.ink,   //  7,82:1
  [C.info]:    C.ink,   // 11,33:1
  [C.ambar]:   C.ink,   // 14,32:1
  [C.verde]:   C.ink,   //  9,30:1
  [C.ciruela]: C.ink,   //  6,85:1
  [C.rojo]:    C.ink,   //  5,69:1
  [C.cobalto]: C.paper, //  5,37:1  ← el único con tinta clara
  [C.ink]:     C.paper,
};

/** Tinta que corresponde a un relleno, con el negro como valor por defecto. */
export function onFill(fill: string): string {
  return ON[fill] ?? C.ink;
}

/** Grosor del filete. El fino es para lo que se repite mucho. */
export const B = { hair: 2, base: 3, loud: 4 } as const;

/**
 * Sombra dura.
 *
 * El desenfoque se escribe **siempre explícito como `0px`**: el parser de React
 * Native es más estricto que el de CSS, y `"6px 6px #111111"` se descarta en
 * silencio en Android. Y se acota a 2..8 para que las llamadas heredadas del
 * sistema anterior —que pasaban profundidades de hasta 9— no produzcan una
 * sombra que se sale de la pantalla.
 */
const clampD = (d: number, lo = 2, hi = 8) => Math.max(lo, Math.min(hi, Math.round(d)));

export const hard = (d: number, color: string = INK) =>
  `${clampD(d)}px ${clampD(d)}px 0px ${color}`;

/**
 * Sin sombra.
 *
 * `boxShadow: "none"` **no es válido** en React Native, y omitir la clave no
 * sirve: en `style={[raised(4), pulsado && algo]}` la sombra de `raised`
 * sobrevive. Hay que sobreescribirla con una sombra de desplazamiento cero.
 */
export const NO_SHADOW = `0px 0px 0px ${INK}`;

/** Placa apoyada sobre la página. `d` es cuánto se desplaza su sombra. */
export function raised(d = 4, fill: string = CARD): ViewStyle {
  return {
    backgroundColor: fill,
    borderWidth: B.base,
    borderColor: INK,
    borderRadius: 0,
    boxShadow: hard(d),
  };
}

/**
 * Hueco practicado en la página. Un hueco no proyecta sombra, así que no la
 * lleva: lo que lo hunde es que su fondo es más oscuro que el de alrededor.
 *
 * `d` se ignora —queda por compatibilidad con las llamadas del sistema
 * anterior, que pasaban profundidad— y por eso va con guion bajo.
 */
export function inset(_d = 3, fill: string = WELL): ViewStyle {
  return {
    backgroundColor: fill,
    borderWidth: B.base,
    borderColor: INK,
    borderRadius: 0,
    boxShadow: NO_SHADOW,
  };
}

/**
 * La placa se desplaza hasta aplastarse contra su propia sombra. Es el gesto de
 * pulsar, y también cómo se marca un control activo: se quedó abajo.
 *
 * Las dos mitades son obligatorias juntas. `transform` mueve la vista **y su
 * sombra**, así que trasladar sin anular la sombra no produce medio gesto:
 * produce ninguno, porque la sombra viaja con el elemento.
 */
export function pressed(d = 4, fill: string = CARD): ViewStyle {
  const o = clampD(d);
  return {
    backgroundColor: fill,
    borderWidth: B.base,
    borderColor: INK,
    borderRadius: 0,
    boxShadow: NO_SHADOW,
    transform: [{ translateX: o }, { translateY: o }],
  };
}

/**
 * Filete y sombra finos. Para lo que se repite mucho en una misma pantalla: a
 * filete completo, veinte placas seguidas se leen como una reja. Y hay una
 * razón aritmética además de estética: un cuadrito de 10 px con filete de 3 es
 * más borde que relleno, y el color que debía comunicar desaparece.
 */
export function subtle(fill: string = CARD): ViewStyle {
  return {
    backgroundColor: fill,
    borderWidth: B.hair,
    borderColor: INK,
    borderRadius: 0,
    boxShadow: hard(2),
  };
}

/** Filete sin sombra. Filas densas y controles apagados. */
export function flat(fill: string = CARD, w: number = B.hair): ViewStyle {
  return {
    backgroundColor: fill,
    borderWidth: w,
    borderColor: INK,
    borderRadius: 0,
    boxShadow: NO_SHADOW,
  };
}

/**
 * Control deshabilitado: aplastado y apagado, nunca con el texto aclarado.
 * El sistema anterior lo señalaba con tinta `ghost` a 1,5:1 de contraste, que
 * es tanto como no mostrarlo.
 */
export function off(): ViewStyle {
  return flat(WELL, B.base);
}

/** Colores con los que se pintan las tarjetas del catálogo, en ciclo. */
export const CARD_COLORS = [C.cobalto, C.verde, C.rojo, C.ambar, C.ciruela];

export function cardColor(index: number): string {
  return CARD_COLORS[index % CARD_COLORS.length];
}

/** Valor asignado a cada tipo de ficha del Tangram (clases del modelo YOLO). */
export const PIECE_COLOR: Record<string, string> = {
  large_tri:     C.cobalto,
  medium_tri:    C.ciruela,
  small_tri:     C.rojo,
  square:        C.ambar,
  parallelogram: C.verde,
};

export const PIECE_LABEL: Record<string, string> = {
  large_tri:     "triángulo grande",
  medium_tri:    "triángulo mediano",
  small_tri:     "triángulo pequeño",
  square:        "cuadrado",
  parallelogram: "romboide",
};

/** En «triángulo pequeño» el plural cae en las dos palabras, no en la última. */
export const PIECE_LABEL_PLURAL: Record<string, string> = {
  large_tri:     "triángulos grandes",
  medium_tri:    "triángulos medianos",
  small_tri:     "triángulos pequeños",
  square:        "cuadrados",
  parallelogram: "romboides",
};

/** Nombre de una cantidad de fichas: «1 cuadrado», «2 triángulos pequeños». */
export function pieceCount(kind: string, n: number): string {
  const label = n > 1 ? PIECE_LABEL_PLURAL[kind] : PIECE_LABEL[kind];
  return `${n} ${label ?? kind}`;
}

/** Inventario de un Tangram completo (mismo orden que `pipeline.PIECE_INVENTORY`). */
export const PIECE_INVENTORY: { kind: string; count: number }[] = [
  { kind: "large_tri",     count: 2 },
  { kind: "medium_tri",    count: 1 },
  { kind: "small_tri",     count: 2 },
  { kind: "square",        count: 1 },
  { kind: "parallelogram", count: 1 },
];

export const TOTAL_PIECES = 7;

/**
 * Cuántos cuadritos se pintan llenos en el indicador de dificultad.
 *
 * Se conserva —y no se sustituye por el color— porque los cuadritos se
 * entienden sin saber leer y sin distinguir los colores. El color es la pista
 * añadida, no la que reemplaza.
 */
export const DIFFICULTY_LEVEL: Record<string, number> = {
  "Fácil": 1, "Medio": 2, "Difícil": 3,
};

/**
 * Color de cada dificultad. Verde lo fácil, amarillo lo intermedio, y ciruela
 * —no rojo— lo difícil: el rojo ya significa «algo va mal» en el resto de la
 * app, y elegir una figura difícil no es un error, es lo que se busca.
 */
export const DIFFICULTY_COLOR: Record<string, string> = {
  "Fácil": C.success, "Medio": C.warning, "Difícil": C.ciruela,
};

/**
 * Radios. Cero en todo: basta una esquina redondeada para que la pantalla se
 * lea como otro estilo. Las claves se conservan porque hay ~45 sitios que las
 * escriben, y con valor 0 siguen siendo correctos sin editarlos.
 */
export const R = {
  sm: 0, md: 0, lg: 0,
  /** @deprecated El brutalismo no tiene pastillas. Vale 0; no usar en código nuevo. */
  pill: 0,
  /**
   * La única excepción, y no es estética. Con radio 0, filete de 3 px y un
   * `<Image>` hijo que llena la caja, Android compone hijo y borde en capas
   * distintas y deja asomar un píxel del bitmap en las cuatro esquinas. Un
   * radio de 2 mete el recorte dentro del filete y la esquina queda limpia.
   * Solo para contenedores con `overflow: "hidden"` sobre un bitmap.
   */
  clip: 2,
};

/** Escala de espaciado. Todo el diseño se apoya en múltiplos de estos valores. */
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 44 };

/**
 * Alturas mínimas de los objetivos táctiles: 44 px para controles secundarios,
 * 58 px para la acción principal de cada pantalla.
 *
 * No cambian con el rediseño, y es deliberado: React Native es siempre
 * border-box, así que añadir un filete de 3 px a un control de 44 mantiene el
 * área táctil en 44 —el borde va dentro— y solo encoge el área de contenido.
 */
export const TAP = { min: 44, control: 46, primary: 58, secondary: 52 };

/**
 * Zona segura superior. Android pinta su barra de estado encima del layout, así
 * que ninguna pantalla arranca su contenido antes de esta marca.
 */
export const SAFE_TOP = 44;
/** Deja libre la barra de navegación de tres botones de Android (48 dp). */
export const SAFE_BOTTOM = 48;

/**
 * Tipografía: Archivo Black para titulares y cifras, Archivo para el cuerpo.
 * Si las fuentes no alcanzan a cargar, React Native usa la del sistema en vez
 * de romper el render.
 *
 * Regla que hay que respetar en todos los usos: **nunca se combina `fontWeight`
 * con `F.black` ni con `F.bold`**. El peso está en el nombre de la familia; al
 * pedir además un peso, el motor busca ese corte dentro de una familia que solo
 * trae uno y cae a la fuente del sistema.
 */
export const F = {
  black:    "ArchivoBlack_400Regular",
  regular:  "Archivo_400Regular",
  medium:   "Archivo_500Medium",
  semibold: "Archivo_600SemiBold",
  bold:     "Archivo_700Bold",
  mono:     Platform.OS === "ios" ? "Menlo" : "monospace",
};

/** Titular: Archivo Black ya es negra, no se le aplica `fontWeight`. */
export const display = (size: number, color: string = C.ink) => ({
  fontFamily: F.black,
  fontSize: size,
  color,
  letterSpacing: -size * 0.02,
});

/**
 * Titular en versalitas. Lleva menos tracking negativo que `display`: en
 * mayúsculas, el mismo valor pega las letras unas a otras.
 */
export const shout = (size: number, color: string = C.ink) => ({
  fontFamily: F.black,
  fontSize: size,
  color,
  letterSpacing: -size * 0.012,
  textTransform: "uppercase" as const,
});

/** Etiqueta de botón o de chip. */
export const label = (size = 16, color: string = C.ink) => ({
  fontFamily: F.black,
  fontSize: size,
  color,
  letterSpacing: 0.6,
  textTransform: "uppercase" as const,
});

/**
 * Rótulo en versalitas que encabeza cada bloque. Sube de 11 a 12 px: a 11, con
 * tracking de 1,3 y en mayúsculas, era el texto menos legible de la pantalla.
 */
export const eyebrow = (color: string = C.muted) => ({
  fontFamily: F.bold,
  fontSize: 12,
  letterSpacing: 1.4,
  textTransform: "uppercase" as const,
  color,
});

/** Cifras que cambian en pantalla (cronómetro, porcentajes): ancho fijo. */
export const tabular = { fontVariant: ["tabular-nums" as const] };

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
