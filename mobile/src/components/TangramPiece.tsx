import Svg, { Polygon } from "react-native-svg";
import { C, PIECE_COLOR } from "../theme";

/**
 * Una de las 7 fichas físicas del Tangram, dibujada plana.
 *
 * Se usa para mostrarle al estudiante el inventario que debe tener sobre la
 * mesa y, tras la foto, cuáles encontró la cámara y cuál le falta. Los nombres
 * son las clases del modelo YOLO (`vision.PIECE_INVENTORY`).
 */
const SHAPES: Record<string, string> = {
  large_tri:     "3,43 43,43 43,3",
  medium_tri:    "9,37 37,37 37,9",
  small_tri:     "13,33 33,33 33,13",
  square:        "23,9 37,23 23,37 9,23",
  parallelogram: "4,30 18,16 42,16 28,30",
};

export default function TangramPiece({ kind, size = 46, color, missing }: {
  kind: string;
  size?: number;
  /** Fuerza un color (por ejemplo verde cuando todas quedaron bien). */
  color?: string;
  /** La ficha que la cámara no encontró: contorno punteado, sin relleno. */
  missing?: boolean;
}) {
  const points = SHAPES[kind] ?? SHAPES.small_tri;

  return (
    <Svg width={size} height={size} viewBox="0 0 46 46">
      {/* Cada ficha lleva su color y su contorno negro, pero lo que de verdad
          la distingue es la forma: es lo que la define geométricamente y lo que
          el niño tiene en la mano. El color es la pista añadida —y el contorno
          negro es lo que garantiza que dos fichas vecinas no se confundan
          aunque alguien no distinga sus colores. */}
      <Polygon
        points={points}
        fill={missing ? "none" : (color ?? PIECE_COLOR[kind] ?? C.cobalto)}
        stroke={C.ink}
        strokeWidth={missing ? 3 : 2}
        strokeDasharray={missing ? "5 4" : undefined}
        strokeLinejoin="miter"
      />
    </Svg>
  );
}
