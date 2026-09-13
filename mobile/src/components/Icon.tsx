import Svg, { Path, Circle } from "react-native-svg";
import { C } from "../theme";

/**
 * Iconografía de la app: trazo grueso sobre rejilla de 24.
 *
 * Reemplaza a los emoji que hacían de iconos. Un emoji se dibuja distinto en
 * cada teléfono, no se puede recolorear y no acompaña al texto en tamaño; estos
 * sí, y son los mismos que aparecen en el lienzo de diseño.
 *
 * Ya estaban dibujados en el idioma que pide el estilo —remates a escuadra y
 * vértices en punta, sin una sola curva de empalme—, así que el rediseño no
 * tocó ni un solo trazado: solo engordó el grosor por defecto de 2 a 2,6 px.
 */
export type IconName =
  | "back" | "logout" | "camera" | "clock" | "check" | "bang"
  | "layers" | "bolt" | "refresh" | "gear" | "backspace" | "signal" | "kit";

const PATHS: Record<IconName, { d: string[]; width?: number; dots?: [number, number, number][] }> = {
  back:      { d: ["M15 5l-7 7 7 7"], width: 3 },
  logout:    { d: ["M14 4H5v16h9", "M12 12h9M17 8l4 4-4 4"] },
  camera:    { d: ["M3 7h4l2-3h6l2 3h4v13H3z"], dots: [[12, 13, 3.6]] },
  clock:     { d: ["M12 7v5.4l3.4 2"], dots: [[12, 12, 8.6]] },
  check:     { d: ["M4 12l5 5L20 6"], width: 3 },
  bang:      { d: ["M12 4v10"], width: 3, dots: [[12, 19, 0.6]] },
  layers:    { d: ["M12 3l9 5-9 5-9-5z", "M3 14l9 5 9-5"] },
  bolt:      { d: ["M13 2L4 14h7l-1 8 9-12h-7z"] },
  refresh:   { d: ["M20.5 12a8.5 8.5 0 1 1-2.4-6", "M20.5 3.5v5h-5"] },
  gear: {
    d: [
      "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" +
      "M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1",
    ],
    dots: [[12, 12, 3.2]],
  },
  backspace: { d: ["M9 5h12v14H9L2 12z", "M13 9.5l5 5M18 9.5l-5 5"] },
  signal:    { d: ["M4 12a8 8 0 0 1 16 0", "M7.5 15a4.6 4.6 0 0 1 9 0"], dots: [[12, 19, 1.4]] },
  // Caja de herramientas: el asa dice «esto se lleva encima», que es lo que
  // distingue los materiales de una pantalla de ayuda.
  kit:       { d: ["M3 9h18v11H3z", "M9 9V6h6v3", "M9.5 14h5"] },
};

export default function Icon({ name, size = 22, color = C.ink, strokeWidth }: {
  name: IconName; size?: number; color?: string; strokeWidth?: number;
}) {
  const spec = PATHS[name];
  // 2,6 en vez de 2: el trazo tiene que sostenerse al lado de filetes de 3 px.
  // No sube más porque los círculos pequeños del icono `gear` (r=3,2) y de
  // `signal` (r=1,4) se macizarían.
  const width = strokeWidth ?? spec.width ?? 2.6;
  const filled = name === "bang";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {spec.dots?.map(([cx, cy, r], i) => (
        <Circle
          key={i} cx={cx} cy={cy} r={r}
          fill={filled || r < 2 ? color : "none"}
          stroke={r < 2 ? "none" : color}
          strokeWidth={width}
        />
      ))}
      {spec.d.map((d, i) => (
        <Path
          key={i} d={d} fill="none" stroke={color}
          strokeWidth={width} strokeLinecap="square" strokeLinejoin="miter"
        />
      ))}
    </Svg>
  );
}
