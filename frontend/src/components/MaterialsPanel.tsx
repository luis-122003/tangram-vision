import { useEffect, useState } from "react";
import { BRUT, T } from "../theme/brut";

/**
 * Qué hace falta tener a mano antes de armar y fotografiar una figura.
 *
 * Es la misma pantalla que la app móvil, con los mismos textos y los mismos
 * dibujos: el docente la mira desde la PC y el estudiante desde el teléfono, y
 * si dijeran cosas distintas uno de los dos estaría siguiendo instrucciones
 * equivocadas.
 *
 * Cada punto sale de un modo de fallo real del sistema, y por eso cada tarjeta
 * dice **qué pasa si no** en vez de limitarse a mandar. Un consejo sin su
 * motivo se salta; uno que explica qué se rompe, se recuerda.
 *
 * Los dibujos son SVG y no fotos por dos razones: una fotografía dentro de un
 * estilo de filete negro y sombra dura se lee como un cuerpo extraño, y además
 * muestra **una** mesa concreta cuando lo que hay que comunicar es la propiedad
 * —que sea lisa, que la luz sea pareja—, no el ejemplo.
 */

/** Colores de las fichas físicas. Son los mismos valores que `theme` del móvil. */
const FICHA = {
  large_tri:     "#2F4DFF",
  medium_tri:    "#E86FD0",
  small_tri:     "#FA5238",
  square:        "#FFE01A",
  parallelogram: "#00CF92",
} as const;

const FORMA: Record<keyof typeof FICHA, string> = {
  large_tri:     "3,43 43,43 43,3",
  medium_tri:    "9,37 37,37 37,9",
  small_tri:     "13,33 33,33 33,13",
  square:        "23,9 37,23 23,37 9,23",
  parallelogram: "4,30 18,16 42,16 28,30",
};

const INVENTARIO: { kind: keyof typeof FICHA; count: number; label: string }[] = [
  { kind: "large_tri",     count: 2, label: "2 triángulos grandes" },
  { kind: "medium_tri",    count: 1, label: "1 triángulo mediano" },
  { kind: "small_tri",     count: 2, label: "2 triángulos pequeños" },
  { kind: "square",        count: 1, label: "1 cuadrado" },
  { kind: "parallelogram", count: 1, label: "1 romboide" },
];

type Escena = "superficie" | "luz" | "encuadre" | "manos";

const PUNTOS: { arte: Escena; titulo: string; texto: string; porque: string }[] = [
  {
    arte: "superficie",
    titulo: "Una superficie lisa y de un solo color",
    texto: "Una mesa despejada, o una hoja grande encima. Que no tenga dibujos, " +
           "vetas ni manteles de cuadros.",
    porque: "Sobre un fondo con figuras, la cámara no distingue dónde termina una ficha.",
  },
  {
    arte: "luz",
    titulo: "Luz pareja, sin sombras marcadas",
    texto: "Que la luz venga de arriba o de frente. Si la lámpara está muy de " +
           "costado, cada ficha proyecta una sombra larga.",
    porque: "Una sombra dura pegada a una ficha se ve como si fuera parte de ella.",
  },
  {
    arte: "encuadre",
    titulo: "La cámara arriba, mirando de frente",
    texto: "Sobre la figura, no de costado. La figura entera tiene que caber en " +
           "la foto, con un poco de margen alrededor.",
    porque: "De costado la figura se ve estirada y deja de parecerse a la del ejemplo.",
  },
  {
    arte: "manos",
    titulo: "Las manos fuera de la foto",
    texto: "Armar la figura, retirar las manos y recién entonces tomar la foto.",
    porque: "Un dedo encima tapa una ficha, y una ficha tapada cuenta como una que falta.",
  },
];

/** Trazo común: negro, en punta, sin empalmes redondeados. Igual que los iconos. */
const trazo = { stroke: BRUT.ink, strokeWidth: 2.5, strokeLinejoin: "miter" as const };

function Dibujo({ kind, width = 220 }: { kind: Escena; width?: number }) {
  return (
    <svg width={width} height={Math.round((width * 80) / 120)} viewBox="0 0 120 80" aria-hidden="true">
      {kind === "superficie" && (
        <>
          <rect x={6} y={16} width={108} height={54} fill={BRUT.card} {...trazo} />
          <polygon points="42,28 74,28 58,44" fill={FICHA.large_tri} {...trazo} />
          <polygon points="50,46 70,46 70,62 50,62" fill={FICHA.square} {...trazo} />
        </>
      )}
      {kind === "luz" && (
        <>
          <polygon points="48,4 72,4 80,18 40,18" fill={FICHA.square} {...trazo} />
          <line x1={44} y1={24} x2={38} y2={32} stroke={BRUT.ink} strokeWidth={2.5} strokeLinecap="square" />
          <line x1={60} y1={24} x2={60} y2={34} stroke={BRUT.ink} strokeWidth={2.5} strokeLinecap="square" />
          <line x1={76} y1={24} x2={82} y2={32} stroke={BRUT.ink} strokeWidth={2.5} strokeLinecap="square" />
          <rect x={6} y={62} width={108} height={12} fill={BRUT.card} {...trazo} />
          <rect x={54} y={48} width={22} height={14} fill={BRUT.ink} />
          <rect x={48} y={42} width={22} height={14} fill={FICHA.parallelogram} {...trazo} />
        </>
      )}
      {kind === "encuadre" && (
        <>
          <rect x={44} y={4} width={32} height={24} fill={BRUT.card} {...trazo} />
          <rect x={50} y={9} width={20} height={14} fill={BRUT.info} stroke={BRUT.ink} strokeWidth={2} />
          <line x1={50} y1={30} x2={38} y2={54} stroke={BRUT.ink} strokeWidth={2} strokeDasharray="4 4" />
          <line x1={70} y1={30} x2={82} y2={54} stroke={BRUT.ink} strokeWidth={2} strokeDasharray="4 4" />
          <rect x={6} y={56} width={108} height={18} fill={BRUT.card} {...trazo} />
          <polygon points="48,42 72,42 60,56" fill={FICHA.small_tri} {...trazo} />
        </>
      )}
      {kind === "manos" && (
        <>
          <rect x={6} y={16} width={108} height={54} fill={BRUT.card} {...trazo} />
          <polygon points="34,30 66,30 50,46" fill={FICHA.large_tri} {...trazo} />
          <rect x={86} y={34} width={24} height={22} fill={BRUT.paper} {...trazo} />
          <rect x={74} y={36} width={12} height={5} fill={BRUT.paper} {...trazo} />
          <rect x={74} y={43} width={12} height={5} fill={BRUT.paper} {...trazo} />
          <rect x={74} y={50} width={12} height={5} fill={BRUT.paper} {...trazo} />
          {/* La tachadura lleva un trazo negro debajo del rojo: lo que comunica
              es la diagonal, no el color, y así se lee sin distinguirlo. */}
          <line x1={68} y1={24} x2={116} y2={64} stroke={BRUT.ink} strokeWidth={8} strokeLinecap="square" />
          <line x1={68} y1={24} x2={116} y2={64} stroke={BRUT.danger} strokeWidth={4} strokeLinecap="square" />
        </>
      )}
    </svg>
  );
}

function Ficha({ kind }: { kind: keyof typeof FICHA }) {
  return (
    <span style={{ padding: 4, display: "inline-grid", ...BRUT.subtle(BRUT.card) }}>
      <svg width={34} height={34} viewBox="0 0 46 46" aria-hidden="true">
        <polygon points={FORMA[kind]} fill={FICHA[kind]} stroke={BRUT.ink}
                 strokeWidth={2} strokeLinejoin="miter" />
      </svg>
    </span>
  );
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <section style={{ ...BRUT.raised(5), padding: 20, display: "grid", gap: 10 }}>
      {children}
    </section>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  // Escape cierra. Sin esto, un diálogo a pantalla completa solo se puede
  // cerrar con el ratón, y el teclado se queda atrapado dentro.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onClose]);

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Materiales que hacen falta"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50, overflowY: "auto",
        background: "rgba(17,17,17,0.55)", padding: "2rem 1rem",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 720, margin: "0 auto", padding: 24,
          display: "grid", gap: 16, ...BRUT.raised(8, BRUT.paper),
        }}
      >
        <header style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ marginRight: "auto" }}>
            <div style={T.eyebrow()}>Antes de empezar</div>
            <h2 style={{ ...T.display(30), margin: "2px 0 0" }}>Materiales</h2>
          </div>
          <button onClick={onClose} autoFocus style={{ ...BRUT.button(false, BRUT.card), fontSize: 13 }}>
            Cerrar
          </button>
        </header>

        <p style={{ ...T.body(), margin: 0 }}>
          Con esto listo, la foto sale bien casi siempre.
        </p>

        {/* El inventario va primero y aparte: es lo único sin lo cual no se
            puede empezar. Los otros cuatro puntos mejoran la foto; este la
            hace posible. */}
        <Tarjeta>
          <div style={T.eyebrow()}>Lo imprescindible</div>
          <h3 style={{ ...T.title(20), margin: 0 }}>El Tangram completo</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0" }}>
            {INVENTARIO.flatMap(({ kind, count }) =>
              Array.from({ length: count }, (_, i) => <Ficha key={`${kind}-${i}`} kind={kind} />),
            )}
          </div>
          <p style={{ ...T.body(), margin: 0 }}>
            Son 7 fichas: {INVENTARIO.map(p => p.label).join(", ")}.
          </p>
          <p style={{
            ...T.body(BRUT.ink), margin: 0, padding: "10px 12px",
            ...BRUT.subtle(BRUT.warning),
          }}>
            <strong>Si falta una:</strong> la figura no se puede armar, y el sistema
            va a decir que está incompleta aunque todo lo demás esté bien puesto.
          </p>
        </Tarjeta>

        {PUNTOS.map(punto => (
          <Tarjeta key={punto.arte}>
            <div style={{
              display: "grid", placeItems: "center", padding: "12px 0",
              ...BRUT.inset(),
            }}>
              <Dibujo kind={punto.arte} />
            </div>
            <h3 style={{ ...T.title(20), margin: "4px 0 0" }}>{punto.titulo}</h3>
            <p style={{ ...T.body(), margin: 0 }}>{punto.texto}</p>
            <p style={{
              ...T.body(BRUT.ink), margin: 0, paddingLeft: 12,
              borderLeft: `4px solid ${BRUT.ink}`,
            }}>{punto.porque}</p>
          </Tarjeta>
        ))}
      </div>
    </div>
  );
}

/**
 * El acceso. `variant` decide cómo se ve, no qué hace: en la barra superior es
 * un botón como los demás; en el ingreso, un enlace discreto que se consulta
 * **sin cuenta** —es lo que mira el docente para saber qué repartir antes de
 * que ningún estudiante entre—.
 */
export default function MaterialsButton({ variant = "nav" }: { variant?: "nav" | "link" }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        style={variant === "nav"
          ? { fontSize: 12, padding: "8px 15px", cursor: "pointer",
              fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
              color: BRUT.ink, ...BRUT.raised(3, BRUT.card) }
          : { background: "none", border: "none", padding: "8px 0", cursor: "pointer",
              font: "inherit", fontWeight: 700, fontSize: 13, color: BRUT.ink,
              textDecoration: "underline", textUnderlineOffset: 3 }}
      >
        {variant === "nav" ? "Materiales" : "Qué necesito para empezar"}
      </button>
      {abierto && <Panel onClose={() => setAbierto(false)} />}
    </>
  );
}
