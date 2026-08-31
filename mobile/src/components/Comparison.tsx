import Svg, { Polygon } from "react-native-svg";
import { C } from "../theme";

/**
 * La figura que armó el estudiante superpuesta al modelo.
 *
 * Los dos polígonos llegan de `/predict` ya normalizados a 0..1 sobre el mismo
 * lienzo, y el detectado viene girado a la orientación con la que el backend
 * calculó el IoU. Aquí no se recentra ni se reescala nada: se dibujan tal cual
 * para que lo que ve el niño sea exactamente lo que comparó el servidor.
 */
export default function Comparison({ detected, target, size = 160, color = C.cobalto }: {
  detected: [number, number][];
  target: [number, number][];
  size?: number;
  color?: string;
}) {
  const points = (pts: [number, number][]) =>
    pts.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <Svg viewBox="-0.03 -0.03 1.06 1.06" width={size} height={size}>
      {/* Se invierte el orden respecto al diseño anterior, y con eso desaparece
          la transparencia. Antes el modelo iba debajo y lo armado encima al 62 %
          de opacidad, que en un estilo de colores planos se lee como suciedad.
          Ahora lo armado va sólido y el modelo se dibuja **encima** como
          contorno punteado: se sigue viendo cuánto sobra y cuánto falta, sin
          mezclar un solo color. */}
      <Polygon
        points={points(detected)}
        fill={color}
        stroke={C.ink}
        strokeWidth={0.02}
        strokeLinejoin="miter"
      />
      <Polygon
        points={points(target)}
        fill="none"
        stroke={C.ink}
        strokeWidth={0.024}
        strokeDasharray="0.045 0.038"
        strokeLinejoin="miter"
      />
    </Svg>
  );
}
