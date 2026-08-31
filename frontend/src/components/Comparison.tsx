import { BRUT } from "../theme/brut";

/**
 * La figura que armó el estudiante superpuesta al modelo.
 *
 * Los dos polígonos llegan de `/predict` ya normalizados a 0..1 sobre el mismo
 * lienzo, y el detectado viene **girado a la orientación con la que el backend
 * calculó el IoU**. Aquí no se recentra ni se reescala nada: se dibujan tal cual
 * para que lo que ve el niño sea exactamente lo que comparó el servidor.
 *
 * Es el mismo dibujo que ya hacía la app móvil (`mobile/src/components/
 * Comparison.tsx`), y a propósito: los dos clientes leen la misma respuesta, así
 * que enseñar dos cosas distintas de los mismos números sería un error. Sin él,
 * la web mostraba un porcentaje y el niño no podía saber *dónde* se separó.
 *
 * Lo armado va sólido y el modelo **encima**, como contorno punteado. Ese orden
 * evita la transparencia: en un estilo de colores planos, dos rellenos mezclados
 * se leen como suciedad, y aun así se sigue viendo cuánto sobra y cuánto falta.
 */
export default function Comparison({
  detected, target, size = 168, color = BRUT.info,
}: {
  detected: [number, number][];
  target:   [number, number][];
  size?:    number;
  color?:   string;
}) {
  const points = (pts: [number, number][]) =>
    pts.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    // El lienzo se agranda un 6 % sobre el 0..1 de los polígonos: el filete se
    // dibuja centrado en el borde, así que sin ese margen la mitad de exterior
    // quedaría recortada contra el canto del SVG.
    <svg
      viewBox="-0.03 -0.03 1.06 1.06" width={size} height={size}
      role="img"
      aria-label="Tu figura, en color, superpuesta al contorno punteado del modelo"
    >
      <polygon
        points={points(detected)} fill={color}
        stroke={BRUT.ink} strokeWidth={0.02} strokeLinejoin="miter"
      />
      <polygon
        points={points(target)} fill="none"
        stroke={BRUT.ink} strokeWidth={0.024}
        strokeDasharray="0.045 0.038" strokeLinejoin="miter"
      />
    </svg>
  );
}
