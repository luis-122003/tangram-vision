import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { createFigure, extractSilhouette, getFigures, setFigureEnabled } from "../api/client";
import { BRUT, T } from "../theme/brut";
import Silhouette from "./Silhouette";
import type { Category, Difficulty, Figure, SilhouetteResult } from "../types";

/**
 * Gestión de figuras: dar de alta una figura nueva desde una foto y ocultar o
 * mostrar las que ya hay.
 *
 * Lo que hace posible esta pantalla es que **el modelo no cambia**: el detector
 * reconoce fichas, no figuras, y lo que distingue una figura de otra es su
 * polígono de referencia. Así que añadir una figura es sacar ese polígono de
 * una foto —con el mismo detector que califica a los niños— y guardarlo.
 *
 * De ahí el orden de la pantalla: primero los pasos, porque la calidad de la
 * figura que se guarda es exactamente la calidad de la foto que se sube;
 * luego la foto; luego la **silueta sintética** que salió de ella, que es la
 * imagen que verá el estudiante en el catálogo y que hay que mirar antes de
 * guardar; y solo al final el botón. Guardar se bloquea si la cámara no vio
 * las siete fichas: una referencia sacada de seis es una figura contra la que
 * ningún niño podrá acertar.
 */

const CATEGORIAS: Category[]  = ["Objetos", "Animales", "Personas"];
const DIFICULTADES: Difficulty[] = ["Fácil", "Medio", "Difícil"];

/** Lado mayor al que se encoge la foto antes de subirla, igual que en la app. */
const LADO_MAXIMO = 2000;

const PASOS = [
  ["Arma la figura con las 7 fichas", "Todas sobre la mesa, sin que sobre ni falte ninguna, y sin montar una encima de otra."],
  ["Fondo liso y buena luz", "Una hoja blanca o la mesa despejada. Luz pareja, sin sombras fuertes ni manos en la foto."],
  ["Foto desde arriba, completa", "La figura entera dentro del cuadro y en la orientación en que quieres que se vea en el catálogo."],
  ["Sube la foto y revisa la silueta", "Debe verse la figura limpia y «7 de 7 fichas». Si falta una o sobra fondo, repite la foto."],
  ["Ponle nombre y guarda", "Aparece de inmediato en la app de los estudiantes. Pruébala armándola y tomándole una foto."],
];

/** Gira un polígono 0..1 un cuarto de vuelta en el sentido del reloj y lo renormaliza. */
function girar90(pts: [number, number][]): [number, number][] {
  const girados = pts.map(([x, y]) => [1 - y, x] as [number, number]);
  const xs = girados.map(p => p[0]), ys = girados.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const escala = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  return girados.map(([x, y]) => [
    Number(((x - minX) / escala).toFixed(4)), Number(((y - minY) / escala).toFixed(4)),
  ]);
}

/**
 * Lee el archivo y lo encoge a `LADO_MAXIMO` en un canvas antes de convertirlo
 * a base64. Una foto de 12 MP viaja en base64 —un tercio más que el JPEG— y el
 * detector la va a reescalar igual; encogerla aquí ahorra red sin perder nada.
 */
function leerFotoReducida(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen")); };
    img.src = url;
  });
}

export default function FiguresAdmin({ onChanged }: {
  /** Avisa al Shell para que recargue el catálogo que usan las demás pestañas. */
  onChanged: () => void;
}) {
  const [figuras,  setFiguras]  = useState<Figure[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");

  // Alta
  const [nombre,     setNombre]     = useState("");
  const [categoria,  setCategoria]  = useState<Category>("Objetos");
  const [dificultad, setDificultad] = useState<Difficulty>("Medio");
  const [emoji,      setEmoji]      = useState("");
  const [foto,       setFoto]       = useState<string | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [resultado,  setResultado]  = useState<SilhouetteResult | null>(null);
  /** La silueta que se va a guardar: la extraída, con los giros que le dio el docente. */
  const [silueta,    setSilueta]    = useState<[number, number][] | null>(null);
  const [guardando,  setGuardando]  = useState(false);
  const [guardada,   setGuardada]   = useState<Figure | null>(null);
  const [ocupado,    setOcupado]    = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function cargar() {
    setError("");
    try {
      setFiguras(await getFigures(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el catálogo");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setGuardada(null);
    setResultado(null);
    setSilueta(null);
    setAnalizando(true);
    try {
      const b64 = await leerFotoReducida(file);
      setFoto(b64);
      const r = await extractSilhouette(b64);
      setResultado(r);
      setSilueta(r.silhouette.length >= 3 ? r.silhouette : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo analizar la foto");
    } finally {
      setAnalizando(false);
    }
  }

  const fichasVistas = resultado?.pieces_used ?? 0;
  const siluetaSirve = !!resultado && !!silueta && resultado.detection_ok && resultado.pieces.complete;
  const puedeGuardar = nombre.trim().length >= 2 && siluetaSirve && !guardando;

  /** Por qué no se puede guardar todavía, en una frase que diga qué hacer. */
  function motivoBloqueo(): string | null {
    if (!resultado) return null;
    if (!silueta) return "No se pudo formar la silueta con esta foto. Repítela con más luz y la figura completa.";
    if (!resultado.detection_ok) return `La cámara vio muy poco de la figura (${fichasVistas} de 7 fichas). Repite la foto: fondo liso, sin manos, figura completa.`;
    if (Object.keys(resultado.pieces.extra).length > 0) return `Hay fichas de más en la foto (${fichasVistas} vistas). Deja sobre la mesa solo las 7 del Tangram y repite.`;
    if (!resultado.pieces.complete) return `Faltan fichas por ver (${fichasVistas} de 7). Una referencia incompleta no sirve: repite la foto.`;
    if (nombre.trim().length < 2) return "Ponle un nombre a la figura.";
    return null;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar || !silueta) return;
    setGuardando(true);
    setError("");
    try {
      const { figure } = await createFigure({
        name: nombre.trim(), category: categoria, difficulty: dificultad,
        emoji: emoji.trim() || undefined, silhouette: silueta,
      });
      setGuardada(figure);
      setNombre(""); setEmoji(""); setFoto(null); setResultado(null); setSilueta(null);
      await cargar();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la figura");
    } finally {
      setGuardando(false);
    }
  }

  async function alternar(f: Figure) {
    if (ocupado) return;
    setOcupado(f.slug);
    setError("");
    try {
      await setFigureEnabled(f.slug, !f.enabled);
      await cargar();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la figura");
    } finally {
      setOcupado(null);
    }
  }

  const campo: CSSProperties = {
    padding: "10px 12px", fontSize: 14, fontWeight: 600, color: BRUT.ink,
    width: "100%", boxSizing: "border-box", ...BRUT.inset(),
  };
  const etiqueta: CSSProperties = { ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 6px" };
  const celda: CSSProperties = {
    padding: "10px 14px", borderBottom: `${BRUT.borderThin}px solid ${BRUT.ink}`,
    fontSize: 13, color: BRUT.ink, verticalAlign: "middle",
  };
  const botonFila: CSSProperties = {
    padding: "7px 12px", fontSize: 11, cursor: "pointer",
    fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
    color: BRUT.ink, ...BRUT.subtle(BRUT.card),
  };

  // Figura provisional para dibujar la silueta con el mismo componente del catálogo.
  const previa: Figure | null = silueta ? {
    id: 0, slug: "nueva", name: nombre || "Figura nueva", emoji: emoji || "🧩",
    description: "", difficulty: dificultad, category: categoria, enabled: true,
    yolo_class_id: null, silhouette: silueta,
  } : null;

  const bloqueo = motivoBloqueo();
  const activas = figuras.filter(f => f.enabled).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* ── Cómo hacerlo bien ─────────────────────────────────────────────── */}
      <div style={{ padding: "1.4rem", ...BRUT.raised(6, BRUT.info) }}>
        <p style={{ ...T.title(18), margin: "0 0 6px", textTransform: "uppercase" }}>
          Agregar una figura nueva
        </p>
        <p style={{ ...T.body(BRUT.ink), margin: "0 0 16px", fontSize: 13 }}>
          No hay que entrenar nada: el sistema reconoce las fichas, y lo que hace
          distinta a cada figura es su silueta. Esa silueta sale de una foto de la
          figura ya armada, así que la calidad de la figura es la calidad de la foto.
        </p>
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid",
                     gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          {PASOS.map(([titulo, detalle], i) => (
            <li key={titulo} style={{ padding: "12px 14px", ...BRUT.raised(3, BRUT.paper) }}>
              <p style={{ ...T.stat(20), margin: "0 0 4px" }}>{i + 1}</p>
              <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 800, color: BRUT.ink }}>{titulo}</p>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: BRUT.muted, lineHeight: 1.45 }}>{detalle}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Guardada ──────────────────────────────────────────────────────── */}
      {guardada && (
        <div style={{ padding: "1rem 1.3rem", display: "flex", alignItems: "center", gap: 16,
                      ...BRUT.raised(4, BRUT.success) }}>
          <Silhouette figure={guardada} size={64} />
          <div>
            <p style={{ ...T.eyebrow(BRUT.ink), margin: "0 0 4px" }}>Figura guardada</p>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: BRUT.ink }}>
              «{guardada.name}» ya aparece en el catálogo de la app y de la web.
              Pídele a un estudiante que la arme y le tome la foto para comprobarla.
            </p>
          </div>
        </div>
      )}

      {/* ── Formulario ────────────────────────────────────────────────────── */}
      <form onSubmit={guardar} style={{ padding: "1.4rem", ...BRUT.raised(6) }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
          {/* Columna izquierda: datos y foto */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <p style={etiqueta}>Nombre de la figura</p>
              <input
                value={nombre} onChange={e => setNombre(e.target.value)}
                placeholder="Por ejemplo: Tortuga" style={campo} maxLength={100}
                aria-label="Nombre de la figura"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.6fr", gap: 10 }}>
              <div>
                <p style={etiqueta}>Categoría</p>
                <select value={categoria} onChange={e => setCategoria(e.target.value as Category)}
                        style={campo} aria-label="Categoría">
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <p style={etiqueta}>Dificultad</p>
                <select value={dificultad} onChange={e => setDificultad(e.target.value as Difficulty)}
                        style={campo} aria-label="Dificultad">
                  {DIFICULTADES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <p style={etiqueta}>Emoji</p>
                <input value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🧩"
                       style={campo} maxLength={16} aria-label="Emoji (opcional)" />
              </div>
            </div>

            <div>
              <p style={etiqueta}>Foto de la figura armada</p>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <button type="button" onClick={() => fileInputRef.current?.click()}
                        disabled={analizando} style={BRUT.button(analizando, BRUT.accent)}>
                  {analizando ? "Analizando…" : foto ? "Subir otra foto" : "Subir foto"}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
                       style={{ display: "none" }} onChange={e => void handleFile(e)} />
                {foto && (
                  <img src={foto} alt="Foto de la figura armada"
                       style={{ width: 96, height: 96, objectFit: "cover",
                                border: `${BRUT.borderThin}px solid ${BRUT.ink}` }} />
                )}
              </div>
            </div>
          </div>

          {/* Columna derecha: la silueta sintética */}
          <div style={{ padding: "14px 16px", ...BRUT.inset(), display: "flex",
                        flexDirection: "column", alignItems: "center", gap: 10, minHeight: 260 }}>
            <p style={{ ...etiqueta, alignSelf: "flex-start" }}>Silueta que verá el estudiante</p>
            {previa ? (
              <>
                <Silhouette figure={previa} size={190} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={botonFila}
                          onClick={() => setSilueta(s => s && girar90(girar90(girar90(s))))}>
                    ⟲ Girar
                  </button>
                  <button type="button" style={botonFila}
                          onClick={() => setSilueta(s => s && girar90(s))}>
                    Girar ⟳
                  </button>
                </div>
              </>
            ) : (
              <p style={{ margin: "auto 0", fontSize: 13, color: BRUT.muted, fontWeight: 600, textAlign: "center" }}>
                {analizando ? "Buscando las fichas en la foto…" : "Sube una foto y aquí aparece la silueta."}
              </p>
            )}
            {resultado && (
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: BRUT.ink, textAlign: "center" }}>
                La cámara vio {fichasVistas} de 7 fichas
                {resultado.pieces.complete ? " · completa" : ""}
                {resultado.warnings.length > 0 && (
                  <span style={{ display: "block", fontWeight: 500, color: BRUT.muted, marginTop: 4 }}>
                    {resultado.warnings.join(" ")}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18 }}>
          <button type="submit" disabled={!puedeGuardar}
                  style={BRUT.button(!puedeGuardar, BRUT.success)}>
            {guardando ? "Guardando…" : "Guardar figura"}
          </button>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600,
                      color: bloqueo ? BRUT.ink : BRUT.muted }}>
            {bloqueo ?? (resultado
              ? "Todo en orden: la silueta está completa."
              : "Se habilita cuando la foto dé una silueta con las 7 fichas.")}
          </p>
        </div>
      </form>

      {error !== "" && (
        <div style={{ padding: "1rem 1.3rem", ...BRUT.raised(4, BRUT.danger) }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: BRUT.ink }}>{error}</p>
        </div>
      )}

      {/* ── Catálogo ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "1.4rem", ...BRUT.raised(6) }}>
        <p style={{ ...T.title(18), margin: "0 0 16px", textTransform: "uppercase" }}>
          Catálogo
          <span style={{ fontWeight: 500, fontSize: 12, color: BRUT.muted,
                         marginLeft: 10, letterSpacing: 0, textTransform: "none" }}>
            {activas} visibles de {figuras.length}
          </span>
        </p>
        {loading ? (
          <p style={{ padding: "2rem", textAlign: "center", color: BRUT.muted, fontSize: 14, margin: 0 }}>Cargando…</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, minWidth: 640, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: BRUT.ink }}>
                  {["", "Figura", "Categoría", "Dificultad", "Estado", ""].map((h, i) => (
                    <th key={i} style={{ ...T.eyebrow(BRUT.paper), fontSize: 10, padding: "11px 14px", textAlign: "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {figuras.map(f => (
                  <tr key={f.slug} style={{ opacity: f.enabled ? 1 : 0.6 }}>
                    <td style={{ ...celda, width: 56 }}><Silhouette figure={f} size={44} /></td>
                    <td style={{ ...celda, fontWeight: 800 }}>
                      {f.emoji} {f.name}
                      <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: BRUT.muted }}>{f.slug}</span>
                    </td>
                    <td style={celda}>{f.category}</td>
                    <td style={celda}>{f.difficulty}</td>
                    <td style={celda}>
                      <span style={{ display: "inline-block", ...T.eyebrow(BRUT.ink), fontSize: 10,
                                     padding: "4px 10px", background: f.enabled ? BRUT.success : BRUT.well,
                                     border: `${BRUT.borderThin}px solid ${BRUT.ink}` }}>
                        {f.enabled ? "Visible" : "Oculta"}
                      </span>
                    </td>
                    <td style={{ ...celda, whiteSpace: "nowrap", textAlign: "right" }}>
                      <button style={botonFila} disabled={ocupado === f.slug} onClick={() => void alternar(f)}>
                        {f.enabled ? "Ocultar" : "Mostrar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
