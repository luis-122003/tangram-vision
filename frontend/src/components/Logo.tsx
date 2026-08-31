import { BRUT } from "../theme/brut";

/**
 * La marca: tres piezas de tangram encajadas en un cuadrado.
 *
 * Los tres polígonos van en colores de ficha distintos y con filete negro, que
 * es la misma lógica que el resto de la interfaz. Antes se distinguían por
 * opacidad porque el estilo no admitía color; ahora no hace falta el truco.
 */
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <polygon points="2,2 28,2 15,15" fill={BRUT.warning}
               stroke={BRUT.ink} strokeWidth="2" strokeLinejoin="miter" />
      <polygon points="2,2 15,15 2,28" fill={BRUT.danger}
               stroke={BRUT.ink} strokeWidth="2" strokeLinejoin="miter" />
      <polygon points="15,15 28,2 28,28" fill={BRUT.info}
               stroke={BRUT.ink} strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}
