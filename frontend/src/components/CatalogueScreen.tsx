import { useState } from "react";
import { BRUT, T } from "../theme/brut";
import { diffColor } from "../utils/format";
import Silhouette from "./Silhouette";
import type { Figure } from "../types";

/**
 * Rejilla de figuras objetivo, filtrable por categoría.
 *
 * El filtro activo se pone en color y se aplasta contra su sombra, como una
 * tecla que se quedó abajo. Al pasar por encima de una tarjeta, esta se levanta
 * —se desplaza hacia arriba y su sombra crece—, que es el gesto contrario al de
 * pulsar y por tanto se lee como «esto se puede tocar».
 */
export default function CatalogueScreen({ figures, onSelect }: {
  figures: Figure[]; onSelect: (fig: Figure) => void;
}) {
  const [filter, setFilter] = useState("Todos");
  const [hover, setHover] = useState<number | null>(null);
  const categories = ["Todos", ...Array.from(new Set(figures.map(f => f.category)))];

  const visible = filter === "Todos" ? figures : figures.filter(f => f.category === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {categories.map(c => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            style={{
              padding: "10px 20px", fontSize: 13, cursor: "pointer",
              fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase",
              color: BRUT.ink,
              ...BRUT.raised(4, filter === c ? BRUT.accent : BRUT.card),
              ...(filter === c ? BRUT.pressed(4) : null),
            }}
          >{c}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 24 }}>
        {visible.map(fig => (
          <div
            key={fig.id}
            onClick={() => onSelect(fig)}
            onMouseEnter={() => setHover(fig.id)}
            onMouseLeave={() => setHover(null)}
            style={{
              padding: "1.15rem",
              cursor: "pointer",
              transition: "transform 0.12s ease, box-shadow 0.12s ease",
              ...BRUT.raised(6),
              ...(hover === fig.id ? {
                transform: "translate(-2px, -2px)",
                boxShadow: `9px 9px 0 ${BRUT.ink}`,
              } : null),
            }}
          >
            <div style={{
              display: "grid", placeItems: "center", padding: 10, marginBottom: 13,
              ...BRUT.inset(),
            }}>
              <Silhouette figure={fig} size={92} />
            </div>
            <p style={{ ...T.title(16), margin: "0 0 5px", textTransform: "uppercase" }}>
              {fig.name}
            </p>
            <p style={{ ...T.body(), margin: "0 0 12px", fontSize: 12, lineHeight: 1.4 }}>
              {fig.description}
            </p>
            {/* La dificultad va en color de semáforo, y el nombre escrito al
                lado es lo que la nombra para quien no lo distinga. */}
            <span style={{
              display: "inline-block", ...T.eyebrow(BRUT.ink), fontSize: 10,
              padding: "5px 12px",
              ...BRUT.subtle(diffColor(fig.difficulty)),
            }}>{fig.difficulty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
