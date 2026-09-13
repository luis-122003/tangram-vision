import { BRUT, T } from "../theme/brut";
import CatalogueScreen from "./CatalogueScreen";
import type { Figure, User } from "../types";

/**
 * Inicio del estudiante: el catálogo de figuras, y nada más.
 *
 * Aquí había tres placas con sus cifras —figuras intentadas, completadas,
 * precisión—, y se quitaron a propósito: el progreso de las actividades es del
 * docente, que lo ve en su panel. Un niño de primaria con un porcentaje de
 * acierto en la pantalla de inicio no recibe información, recibe una nota, y
 * quien la puede interpretar no es él.
 *
 * La consecuencia es que esta pantalla ya no pide `GET /students/{id}/stats`,
 * que además ahora respondería 403: esa ruta pasó a ser solo del docente.
 */
export default function StudentHome({ user, figures, figuresError, onSelectFigure }: {
  user: User; figures: Figure[]; figuresError: string; onSelectFigure: (fig: Figure) => void;
}) {
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
