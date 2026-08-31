import Svg, { Polygon, Rect, G, Defs, ClipPath } from "react-native-svg";
import { View, Text } from "react-native";
import type { Figure } from "../api/types";
import { C, F } from "../theme";

/**
 * Silueta objetivo que llega de MySQL: la figura que el estudiante debe
 * reproducir con sus 7 fichas físicas.
 *
 * Tres modos, según dónde se use:
 *  - `knockout`  la silueta se recorta sobre un bloque de color, con su
 *                contorno negro (catálogo y pantalla de la figura);
 *  - `outline`   solo el contorno, en tinta;
 *  - `guide`     contorno punteado claro, para superponerlo a la cámara.
 *
 * El recorte del `knockout` ya no va en color papel. Antes sí, y era un fallo
 * de contraste: crema sobre el bloque ámbar da 1,2:1, o sea invisible. Ahora el
 * color por defecto es la tinta, y quien lo llame puede pedir la que
 * corresponda a su bloque con `onFill()`. El contorno negro está siempre, y es
 * lo que separa la silueta del bloque en cualquier combinación.
 */
type Mode = "knockout" | "outline" | "guide";

/** Centra el polígono normalizado dentro del cuadrado 0..1, como hace el backend. */
function toPoints(pts: [number, number][]): string {
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const dx = (1 - Math.max(...xs)) / 2;
  const dy = (1 - Math.max(...ys)) / 2;
  return pts.map(([x, y]) => `${(x + dx).toFixed(4)},${(y + dy).toFixed(4)}`).join(" ");
}

export default function Silhouette({
  figure, size = 120, mode = "knockout", color = C.ink, bands,
}: {
  figure: Figure;
  size?: number;
  mode?: Mode;
  /** Color del recorte (modo `knockout`) o del trazo (modos de contorno). */
  color?: string;
  /**
   * Cobertura por bandas horizontales (`segments` de /predict). Pinta la
   * silueta en tres franjas de color para señalar qué parte revisar.
   */
  bands?: string[];
}) {
  const pts = figure.silhouette;
  if (!pts || pts.length < 3) {
    // Sin polígono en la base de datos no hay nada que dibujar: se cae al
    // nombre de la figura antes que a un cuadro vacío.
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: F.black, fontSize: size * 0.16, color }}>{figure.name}</Text>
      </View>
    );
  }

  const points = toPoints(pts);
  const clipId = `sil-${figure.slug}`;

  if (bands && bands.length > 0) {
    // Las franjas se reparten sobre la altura de la figura, no del lienzo, igual
    // que `segment_coverage` en el backend: si no, en una figura ancha y baja
    // los cortes caerían fuera de la silueta y señalarían la zona equivocada.
    const ys = points.split(" ").map(p => Number(p.split(",")[1]));
    const top = Math.min(...ys);
    const h = (Math.max(...ys) - top) / bands.length;
    return (
      <Svg viewBox="-0.04 -0.04 1.08 1.08" width={size} height={size}>
        <Defs>
          <ClipPath id={clipId}>
            <Polygon points={points} />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#${clipId})`}>
          {bands.map((c, i) => (
            <Rect key={i} x={-0.1} y={top + i * h} width={1.2} height={h} fill={c} />
          ))}
        </G>
        <Polygon points={points} fill="none" stroke={C.ink} strokeWidth={0.024} strokeLinejoin="miter" />
      </Svg>
    );
  }

  const guide = mode === "guide";
  const knockout = mode === "knockout";
  return (
    <Svg viewBox="-0.05 -0.05 1.10 1.10" width={size} height={size}>
      <Polygon
        points={points}
        fill={knockout ? color : "none"}
        // El contorno es negro incluso en `knockout`: es lo que despega la
        // silueta del bloque de color sin depender del contraste entre los dos.
        stroke={knockout ? C.ink : color}
        strokeWidth={guide ? 0.026 : 0.024}
        strokeDasharray={guide ? "0.05 0.038" : undefined}
        strokeLinejoin="miter"
      />
    </Svg>
  );
}
