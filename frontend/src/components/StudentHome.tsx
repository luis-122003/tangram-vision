import { useEffect, useState } from "react";
import { getStudentStats } from "../api/client";
import { BRUT, T } from "../theme/brut";
import CatalogueScreen from "./CatalogueScreen";
import type { Figure, StudentStats, User } from "../types";

/** Inicio del estudiante: su progreso y el catálogo de figuras. */
export default function StudentHome({ user, figures, figuresError, onSelectFigure }: {
  user: User; figures: Figure[]; figuresError: string; onSelectFigure: (fig: Figure) => void;
}) {
  const [stats, setStats] = useState<StudentStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStudentStats(user.id)
      .then(data => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => { cancelled = true; };
  }, [user.id]);

  const total    = stats?.total ?? 0;
  const passed   = stats?.passed ?? 0;
  const accuracy = stats ? `${Math.round(stats.accuracy * 100)}%` : "—";

  const aviso = {
    padding: "2rem", textAlign: "center" as const, fontSize: 14,
    fontWeight: 600, color: BRUT.ink,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div>
        <h2 style={{ ...T.display(34), margin: "0 0 8px" }}>
          ¡Hola, {user.name.split(" ")[0]}!
        </h2>
        <p style={{ ...T.body(), margin: 0 }}>¿Qué figura quieres armar hoy?</p>
      </div>

      {/* Cada cifra en su propia placa de color. Las tres son del mismo tipo de
          dato, así que comparten forma y se distinguen por el color. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[
          { label: "Figuras intentadas", value: total,    tono: BRUT.info },
          { label: "Completadas",        value: passed,   tono: BRUT.success },
          { label: "Precisión",          value: accuracy, tono: BRUT.warning },
        ].map(({ label, value, tono }) => (
          <div key={label} style={{
            padding: "1.25rem", textAlign: "center", ...BRUT.raised(5, tono),
          }}>
            <p style={{ ...T.stat(34), margin: 0 }}>{value}</p>
            <p style={{ ...T.eyebrow(BRUT.ink), margin: "6px 0 0", fontSize: 10 }}>
              {label}
            </p>
          </div>
        ))}
      </div>

      {figuresError ? (
        <div style={{ ...aviso, ...BRUT.raised(5, BRUT.danger) }}>
          No se pudo cargar el catálogo de figuras: {figuresError}
        </div>
      ) : figures.length === 0 ? (
        <div style={{ ...aviso, ...BRUT.inset() }}>
          Cargando figuras…
        </div>
      ) : (
        <CatalogueScreen figures={figures} onSelect={onSelectFigure} />
      )}
    </div>
  );
}
