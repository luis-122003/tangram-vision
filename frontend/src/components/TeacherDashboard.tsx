import { useEffect, useState } from "react";
import { getSessions } from "../api/client";
import { BRUT, T } from "../theme/brut";
import { formatTime } from "../utils/format";
import type { Figure, SessionRow } from "../types";

/**
 * Vista del docente: el registro de intentos de todo el curso.
 *
 * Este listado está reservado al rol `teacher` en el backend. Un estudiante que
 * pidiera `/sessions` recibiría un 403, que es justamente el punto: los datos de
 * un niño no tienen por qué estar al alcance de sus compañeros.
 *
 * La tabla usa filetes de verdad. El sistema anterior no tenía bordes, así que
 * simulaba las filas aplicando una sombra a cada `<td>` —el navegador no pinta
 * `box-shadow` sobre un `<tr>`—; con `border-collapse: collapse` ese apaño
 * desaparece y dos celdas vecinas comparten una sola línea.
 *
 * Es la pantalla más densa de la aplicación, y por eso la única donde el color
 * se reserva a la columna que lo necesita: filas en blanco con filete fino, y
 * verde o rojo solo en el resultado.
 */
export default function TeacherDashboard({ figures }: { figures: Figure[] }) {
  const [attempts, setAttempts] = useState<SessionRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");

  // El backend pagina este listado, así que `total` es el del curso entero y
  // `attempts` solo la página que se está mostrando.
  const [totalCurso, setTotalCurso] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getSessions()
      .then(pagina => {
        if (cancelled) return;
        setAttempts(pagina.rows);
        setTotalCurso(pagina.total);
      })
      .catch(err => { if (!cancelled) setError(err.message ?? "Error cargando sesiones"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const total  = attempts.length;
  const passed = attempts.filter(a => a.match_result).length;
  const avgIoU = total ? (attempts.reduce((s, a) => s + a.iou_score, 0) / total).toFixed(2) : "—";

  const aviso = {
    padding: "2.5rem", textAlign: "center" as const, fontSize: 14,
    fontWeight: 600, color: BRUT.ink,
  };

  if (loading) return <div style={{ ...aviso, ...BRUT.inset() }}>Cargando registro de intentos…</div>;
  if (error) return (
    <div style={{ ...aviso, ...BRUT.raised(5, BRUT.danger) }}>
      No se pudo conectar con el backend: {error}
    </div>
  );

  const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

  // Filete fino en las celdas: a 3px, veinte filas se leen como una reja.
  const celda: React.CSSProperties = {
    padding: "12px 15px",
    borderBottom: `${BRUT.borderThin}px solid ${BRUT.ink}`,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "Intentos totales", value: totalCurso, tono: BRUT.card },
          { label: "Aprobados",        value: passed,     tono: BRUT.success },
          { label: "Tasa de éxito",    value: total ? `${Math.round(passed / total * 100)}%` : "—", tono: BRUT.info },
          { label: "IoU promedio",     value: avgIoU,     tono: BRUT.card },
        ].map(({ label, value, tono }) => (
          <div key={label} style={{ padding: "1.1rem 1.3rem", ...BRUT.raised(4, tono) }}>
            <p style={{ ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 6px" }}>{label}</p>
            <p style={{ ...T.stat(28), margin: 0 }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ padding: "1.4rem", ...BRUT.raised(6) }}>
        <p style={{ ...T.title(18), margin: "0 0 16px", textTransform: "uppercase" }}>
          Registro de intentos
          {totalCurso > total && (
            <span style={{
              fontWeight: 500, fontSize: 12, color: BRUT.muted,
              marginLeft: 10, letterSpacing: 0, textTransform: "none",
            }}>
              mostrando {total} de {totalCurso}
            </span>
          )}
        </p>

        {total === 0 ? (
          <p style={{ padding: "2rem", textAlign: "center", color: BRUT.muted, fontSize: 14, margin: 0 }}>
            Aún no hay intentos registrados.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, minWidth: 680 }}>
              <thead>
                {/* Cabecera en negativo: es la fila que no son datos. */}
                <tr style={{ background: BRUT.ink }}>
                  {["Estudiante", "Figura", "Resultado", "IoU", "Tiempo", "Errores", "Fecha"].map(h => (
                    <th key={h} style={{
                      ...T.eyebrow(BRUT.paper), fontSize: 10,
                      padding: "11px 15px", textAlign: "left",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => {
                  const fig = figures.find(f => f.slug === a.figure_id);
                  return (
                    <tr key={a.id}>
                      <td style={{ ...celda, color: BRUT.ink, fontWeight: 800 }}>
                        {a.student_name || "—"}
                      </td>
                      <td style={{ ...celda, color: BRUT.ink, fontWeight: 500 }}>
                        {fig?.name || a.figure_id}
                      </td>
                      <td style={celda}>
                        {/* Verde o rojo, con la palabra escrita al lado: el
                            color no es el único canal. */}
                        <span style={{
                          display: "inline-block", ...T.eyebrow(BRUT.ink), fontSize: 10,
                          padding: "4px 11px",
                          background: a.match_result ? BRUT.success : BRUT.danger,
                          border: `${BRUT.borderThin}px solid ${BRUT.ink}`,
                        }}>{a.match_result ? "Correcto" : "Incorrecto"}</span>
                      </td>
                      <td style={{ ...celda, ...T.stat(14), letterSpacing: 0 }}>
                        {(a.iou_score * 100).toFixed(0)}%
                      </td>
                      <td style={{ ...celda, ...T.stat(14), letterSpacing: 0, fontWeight: 600 }}>
                        {formatTime(a.time_seconds)}
                      </td>
                      <td style={{ ...celda, ...T.stat(14), letterSpacing: 0, fontWeight: 600 }}>
                        {a.errors}
                      </td>
                      <td style={{ ...celda, color: BRUT.muted, fontSize: 12, fontWeight: 500 }}>
                        {new Date(a.created_at).toLocaleString("es-CO")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ padding: "1.2rem 1.4rem", ...BRUT.inset() }}>
        <p style={{ ...T.eyebrow(BRUT.ink), margin: "0 0 10px" }}>
          Conexión al backend
        </p>
        <p style={{
          margin: 0, fontSize: 12, color: BRUT.ink, fontWeight: 600,
          fontFamily: "var(--font-mono)", lineHeight: 1.9,
        }}>
          POST {API}/predict<br/>
          GET  {API}/sessions<br/>
          GET  {API}/students/&#123;id&#125;/stats
        </p>
        <p style={{ margin: "12px 0 0", fontSize: 11, fontWeight: 500, color: BRUT.muted }}>
          Node.js · Express · MySQL · YOLOv8s-seg · validador geométrico
        </p>
      </div>
    </div>
  );
}
