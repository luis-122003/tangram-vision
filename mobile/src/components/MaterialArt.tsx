import Svg, { G, Line, Polygon, Rect } from "react-native-svg";
import { C } from "../theme";

/**
 * Las ilustraciones de la pantalla de materiales.
 *
 * Son dibujos y no fotos por dos razones. Una es de sistema: el resto de la app
 * está construida con filete negro, relleno plano y sombra dura sin difuminar,
 * y una fotografía dentro de eso se lee como un cuerpo extraño. La otra es que
 * una foto muestra **una** mesa concreta, con su color y su luz, y lo que aquí
 * hay que comunicar es la propiedad —que sea lisa, que la luz sea pareja—, no
 * el ejemplo. Un dibujo enseña la regla; una foto invita a copiarla.
 *
 * El idioma gráfico es el mismo que el de `Icon`: solo rectas, remates a
 * escuadra y vértices en punta. Ninguna curva.
 */
export type MaterialArtKind = "superficie" | "luz" | "encuadre" | "manos";

const W = 120;
const H = 80;
const T = 2.5;

/** Trazo común a todas las formas: negro, en punta, sin empalmes redondeados. */
const trazo = { stroke: C.ink, strokeWidth: T, strokeLinejoin: "miter" as const };

/** Una mesa o una hoja: el plano liso sobre el que se arma. */
function Superficie() {
  return (
    <G>
      <Rect x={6} y={16} width={108} height={54} fill={C.card} {...trazo} />
      {/* Una figura a medio sugerir. Se recorta contra el fondo precisamente
          porque el fondo no tiene nada: es el punto del dibujo. */}
      <Polygon points="42,28 74,28 58,44" fill={C.cobalto} {...trazo} />
      <Polygon points="50,46 70,46 70,62 50,62" fill={C.ambar} {...trazo} />
    </G>
  );
}

/** Luz de frente y sombra corta, frente a la sombra larga que engaña al detector. */
function Luz() {
  return (
    <G>
      <Polygon points="48,4 72,4 80,18 40,18" fill={C.ambar} {...trazo} />
      <Line x1={44} y1={24} x2={38} y2={32} stroke={C.ink} strokeWidth={T} strokeLinecap="square" />
      <Line x1={60} y1={24} x2={60} y2={34} stroke={C.ink} strokeWidth={T} strokeLinecap="square" />
      <Line x1={76} y1={24} x2={82} y2={32} stroke={C.ink} strokeWidth={T} strokeLinecap="square" />
      <Rect x={6} y={62} width={108} height={12} fill={C.card} {...trazo} />
      {/* La sombra, dibujada como la del resto de la app: negra, sólida y
          desplazada. Corta, que es lo que se busca. */}
      <Rect x={54} y={48} width={22} height={14} fill={C.ink} />
      <Rect x={48} y={42} width={22} height={14} fill={C.verde} {...trazo} />
    </G>
  );
}

/** El teléfono encima de la figura, mirándola de frente y no de costado. */
function Encuadre() {
  return (
    <G>
      <Rect x={44} y={4} width={32} height={24} fill={C.card} {...trazo} />
      <Rect x={50} y={9} width={20} height={14} fill={C.info} stroke={C.ink} strokeWidth={2} />
      {/* Lo que ve la cámara: se abre hacia la figura y la deja entera dentro. */}
      <Line x1={50} y1={30} x2={38} y2={54} stroke={C.ink} strokeWidth={2} strokeDasharray="4 4" />
      <Line x1={70} y1={30} x2={82} y2={54} stroke={C.ink} strokeWidth={2} strokeDasharray="4 4" />
      <Rect x={6} y={56} width={108} height={18} fill={C.card} {...trazo} />
      <Polygon points="48,42 72,42 60,56" fill={C.rojo} {...trazo} />
    </G>
  );
}

/** La mano que sobra: tapa una ficha y el sistema la da por faltante. */
function Manos() {
  return (
    <G>
      <Rect x={6} y={16} width={108} height={54} fill={C.card} {...trazo} />
      <Polygon points="34,30 66,30 50,46" fill={C.cobalto} {...trazo} />
      {/* Mano en bloques, entrando por la derecha. */}
      <Rect x={86} y={34} width={24} height={22} fill={C.paper} {...trazo} />
      <Rect x={74} y={36} width={12} height={5} fill={C.paper} {...trazo} />
      <Rect x={74} y={43} width={12} height={5} fill={C.paper} {...trazo} />
      <Rect x={74} y={50} width={12} height={5} fill={C.paper} {...trazo} />
      {/* La tachadura. Va con filete negro debajo para que se lea también sin
          distinguir el rojo: lo que comunica es la diagonal, no el color. */}
      <Line x1={68} y1={24} x2={116} y2={64} stroke={C.ink} strokeWidth={8} strokeLinecap="square" />
      <Line x1={68} y1={24} x2={116} y2={64} stroke={C.danger} strokeWidth={4} strokeLinecap="square" />
    </G>
  );
}

const ESCENAS = {
  superficie: Superficie,
  luz:        Luz,
  encuadre:   Encuadre,
  manos:      Manos,
};

export default function MaterialArt({ kind, width = 120 }: {
  kind: MaterialArtKind;
  width?: number;
}) {
  const Escena = ESCENAS[kind];
  return (
    <Svg width={width} height={Math.round((width * H) / W)} viewBox={`0 0 ${W} ${H}`}>
      <Escena />
    </Svg>
  );
}
