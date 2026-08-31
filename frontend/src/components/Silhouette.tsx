import { BRUT, T } from "../theme/brut";
import type { Figure } from "../types";

/**
 * Dibuja el polígono de referencia que llega de MySQL. Es la figura que el
 * estudiante debe reproducir con sus 7 fichas físicas.
 *
 * La silueta se dibuja como una placa recortada: relleno plano, contorno negro
 * grueso y una sombra sólida desplazada. La sombra es literalmente **el mismo
 * polígono repetido en negro y desplazado**, dibujado antes que el principal.
 *
 * Se hace así y no con un filtro SVG por tres razones: el filtro se aplica al
 * elemento ya contorneado, así que la sombra saldría engordada por el trazo; el
 * pipeline de filtros rasteriza un bitmap por elemento, y en el catálogo hay
 * muchas siluetas a la vez; y de este modo la técnica es idéntica a la de la
 * app móvil. Además desaparece el id único por figura que el filtro obligaba a
 * inventar para que dos siluetas no se pisaran en la misma página.
 *
 * `filled` decide si la figura es la placa que hay que armar o solo el molde
 * vacío que la espera.
 */
export default function Silhouette({ figure, size = 120, filled = true }: {
  figure: Figure; size?: number; filled?: boolean;
}) {
  const pts = figure.silhouette;
  if (!pts || pts.length < 3) {
    return (
      <div style={{
        width: size, height: size, display: "grid", placeItems: "center",
        ...BRUT.raised(4, BRUT.warning),
        ...T.display(size * 0.26),
      }}>{figure.name.slice(0, 2)}</div>
    );
  }

  // El polígono viene normalizado a 0..1 con la relación de aspecto preservada,
  // así que se centra dentro de un viewBox cuadrado.
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const w = Math.max(...xs), h = Math.max(...ys);
  const dx = (1 - w) / 2, dy = (1 - h) / 2;
  const d = pts.map(([x, y]) => `${(x + dx).toFixed(4)},${(y + dy).toFixed(4)}`).join(" ");

  const trazo = 0.026;
  const sombra = 0.042;

  return (
    <svg viewBox="-0.09 -0.09 1.18 1.18" width={size} height={size} aria-label={figure.name}>
      {filled && (
        <polygon points={d} fill={BRUT.ink}
                 transform={`translate(${sombra}, ${sombra})`} />
      )}
      <polygon
        points={d}
        fill={filled ? BRUT.warning : "none"}
        stroke={BRUT.ink}
        strokeWidth={trazo}
        strokeDasharray={filled ? undefined : "0.055 0.04"}
        strokeLinejoin="miter"
      />
    </svg>
  );
}
