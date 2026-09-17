import { useEffect, useState } from "react";
import { getFigures } from "../api/client";
import { ROLES } from "../constants";
import { BRUT, T } from "../theme/brut";
import GameScreen from "./GameScreen";
import Logo from "./Logo";
import MaterialsButton from "./MaterialsPanel";
import StudentHome from "./StudentHome";
import StudentsAdmin from "./StudentsAdmin";
import FiguresAdmin from "./FiguresAdmin";
import TeacherDashboard from "./TeacherDashboard";
import type { Figure, User } from "../types";

/**
 * Navegación general: barra superior y la pantalla que toca según el rol.
 *
 * La barra se separa del contenido con un filete negro grueso, no con un
 * degradado: en este estilo lo que divide es la línea.
 */
export default function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  /**
   * El rol se resuelve una vez y decide **qué se pinta**, no solo qué botones
   * hay. Antes las pestañas del docente se le ocultaban al estudiante y el
   * `main` renderizaba la vista que dijera `view`, sin volver a mirar quién era:
   * bastaba con que ese estado llegara a "dashboard" por cualquier vía para que
   * el panel del curso se montara en la pantalla de un niño. Esconder la puerta
   * no es cerrarla; esto la cierra.
   *
   * Lo de verdad importante sigue estando en el servidor —`/sessions` y
   * `/students` responden 403 a un estudiante—, así que esto no es la barrera,
   * es no pedir datos que no van a llegar.
   */
  const esDocente = user.role === ROLES.TEACHER;

  const [view,      setView]      = useState<"home" | "game" | "dashboard" | "students" | "figures">(
    esDocente ? "dashboard" : "home",
  );
  const [activeFig, setActiveFig] = useState<Figure | null>(null);
  const [figures,      setFigures]      = useState<Figure[]>([]);
  const [figuresError, setFiguresError] = useState("");

  // El catálogo de figuras objetivo (con sus siluetas) vive en MySQL. Se
  // vuelve a pedir cuando el docente añade u oculta una figura desde su
  // pestaña (`recarga`): las demás pestañas —el registro de intentos, que
  // nombra las figuras por su slug— tienen que verla sin recargar la página.
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getFigures()
      .then(data => { if (!cancelled) setFigures(data); })
      .catch(err => { if (!cancelled) setFiguresError(err.message ?? "Error de conexión"); });
    return () => { cancelled = true; };
  }, [recarga]);

  // El docente tiene tres vistas y no una: el registro de intentos responde
  // «cómo va el curso», la gestión de estudiantes «quién está en el curso» y
  // la de figuras «qué se arma en el curso». Son preguntas distintas y
  // mezclarlas en una sola tabla dejaba el alta de cuentas —y ahora la de
  // figuras— sin ningún sitio donde vivir.
  const tabs = esDocente
    ? [
        { id: "dashboard" as const, label: "Intentos" },
        { id: "students"  as const, label: "Estudiantes" },
        { id: "figures"   as const, label: "Figuras" },
      ]
    : [{ id: "home" as const, label: "Mis figuras" }];

  function handleSelectFigure(fig: Figure) {
    setActiveFig(fig);
    setView("game");
  }

  const iniciales = user.name.split(" ").map(n => n[0]).join("").slice(0, 2);

  return (
    <div style={{ minHeight: "100vh", background: BRUT.paper }}>
      <nav style={{
        background: BRUT.card,
        borderBottom: `${BRUT.border}px solid ${BRUT.ink}`,
        padding: "0 1.75rem", display: "flex", alignItems: "center", height: 68,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginRight: "auto" }}>
          <div style={{
            width: 38, height: 38, display: "grid", placeItems: "center",
            ...BRUT.raised(3, BRUT.paper),
          }}>
            <Logo size={18} />
          </div>
          <span style={{ ...T.title(16), letterSpacing: -0.3, textTransform: "uppercase" }}>
            Tangram IA
          </span>
          {esDocente && (
            <span style={{
              ...T.eyebrow(BRUT.ink), fontSize: 10, padding: "5px 11px",
              ...BRUT.subtle(BRUT.info),
            }}>DOCENTE</span>
          )}
        </div>

        {/* La pestaña activa se queda en color y aplastada contra su sombra,
            como una tecla que no ha vuelto a subir. */}
        <div style={{ display: "flex", gap: 10, marginRight: 18 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              padding: "9px 17px", fontSize: 13, cursor: "pointer",
              fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
              color: BRUT.ink,
              ...BRUT.raised(4, view === t.id ? BRUT.accent : BRUT.card),
              ...(view === t.id ? BRUT.pressed(4) : null),
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Alcanzable desde cualquier vista, también con una figura abierta:
              es cuando la foto ya salió mal y hay que saber por qué. */}
          <MaterialsButton variant="nav" />
          <div style={{
            width: 38, height: 38, display: "grid", placeItems: "center",
            fontSize: 13, fontWeight: 900, color: BRUT.ink,
            ...BRUT.raised(3, BRUT.warning),
          }}>{iniciales}</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: BRUT.ink }}>{user.name}</span>
          <button onClick={onLogout} style={{
            fontSize: 12, padding: "8px 15px", cursor: "pointer",
            fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
            color: BRUT.ink, ...BRUT.raised(3, BRUT.card),
          }}>Salir</button>
        </div>
      </nav>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1.75rem" }}>
        {view === "home"      && <StudentHome user={user} figures={figures}
                                              figuresError={figuresError}
                                              onSelectFigure={handleSelectFigure} />}
        {view === "game"      && activeFig && <GameScreen user={user} figure={activeFig} onExit={() => setView("home")} />}
        {view === "dashboard" && esDocente && <TeacherDashboard figures={figures} />}
        {view === "students"  && esDocente && <StudentsAdmin />}
        {view === "figures"   && esDocente && <FiguresAdmin onChanged={() => setRecarga(n => n + 1)} />}
      </main>
    </div>
  );
}
