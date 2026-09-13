import { useEffect } from "react";
import { usePredict } from "../hooks/usePredict";
import Comparison from "./Comparison";
import { BRUT, T } from "../theme/brut";
import { pct } from "../utils/format";
import type { Checks, Figure, PredictResponse, User } from "../types";

/**
 * Barra de avance: un canal con filete negro y dentro una barra de color plano.
 *
 * El relleno lleva su propio filete a la derecha, así que se ve dónde termina
 * aunque el canal esté casi lleno. La cifra en porcentaje va siempre al lado:
 * la barra sugiere, el número informa.
 */
function Bar({ value, height = 14, tono = BRUT.accent }: {
  value: number; height?: number; tono?: string;
}) {
  const ancho = Math.max(0, Math.min(1, value));
  return (
    <div style={{
      height, background: BRUT.well,
      border: `${BRUT.borderThin}px solid ${BRUT.ink}`,
      overflow: "hidden",
    }}>
      <div style={{
        height: "100%", width: `${ancho * 100}%`,
        background: tono,
        borderRight: ancho > 0 && ancho < 1 ? `${BRUT.borderThin}px solid ${BRUT.ink}` : "none",
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

/**
 * Marca de una comprobación: visto si se cumplió, admiración si no.
 *
 * El color no va solo. Cada fila lleva relleno, símbolo y el dato escrito al
 * lado, así que ninguno de los tres canales es imprescindible por separado —es
 * la misma regla que sostiene la paleta en el resto de la aplicación—.
 */
function Mark({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 22, height: 22, flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: ok ? BRUT.success : BRUT.warning,
        border: `${BRUT.borderThin}px solid ${BRUT.ink}`,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
           stroke={BRUT.ink} strokeWidth={2.4} strokeLinecap="round">
        {ok
          ? <path d="M2 6.4 L4.8 9.2 L10 3.2" strokeLinejoin="round" />
          : <><path d="M6 2.4 V6.9" /><path d="M6 9.4 V9.5" /></>}
      </svg>
    </span>
  );
}

/**
 * Las cinco comprobaciones del validador, traducidas a frases de primaria.
 *
 * El orden y la redacción son los mismos que usa la app móvil: los dos clientes
 * leen la misma respuesta de `/predict`, así que decir cosas distintas de los
 * mismos números confundiría al docente que mire las dos pantallas.
 */
function filasDeRevision(c: Checks) {
  return [
    {
      key: "inventory", ok: c.inventory.ok, label: "Usaste las 7 fichas",
      detail: `${c.inventory.counted} de ${c.inventory.expected}`,
    },
    {
      key: "overlap", ok: c.overlap.ok, label: "Ninguna ficha encima de otra",
      detail: c.overlap.ok ? "Bien" : `${pct(c.overlap.fraction)} montado`,
    },
    {
      key: "holes", ok: c.holes.ok, label: "Sin espacios vacíos",
      detail: c.holes.ok ? "Bien" : c.holes.count === 1 ? "1 hueco" : `${c.holes.count} huecos`,
    },
    {
      key: "connectivity", ok: c.connectivity.ok, label: "Todas las fichas juntas",
      detail: c.connectivity.ok
        ? "Bien"
        : c.connectivity.loose === 1 ? "1 suelta" : `${c.connectivity.loose} sueltas`,
    },
    {
      key: "shape", ok: c.shape.ok, label: "Se parece al modelo",
      detail: pct(c.shape.iou),
    },
  ];
}

/**
 * Panel de resultado: manda la foto al backend y muestra lo que dice.
 *
 * El backend responde con mucho más que un porcentaje —el contorno que armó el
 * estudiante junto al de la figura objetivo, la revisión punto por punto del
 * armado y un diagnóstico del encuadre de la foto— y hasta ahora esta pantalla
 * solo pintaba la cifra. Un porcentaje dice *cuánto* falló; el contorno
 * superpuesto y la revisión dicen **dónde** y **por qué**, que es lo único
 * accionable para un niño de primaria.
 *
 * El veredicto se comunica por color y por la frase: verde cuando la figura está
 * lograda, amarillo cuando falta poco, azul cuando el problema no es el armado
 * sino la foto.
 */
export default function AIValidation({ imageData, figure, user, onResult }: {
  imageData: string | null;
  figure: Figure;
  user: User;
  onResult: (result: PredictResponse) => void;
}) {
  const { status, result, errorMsg, run, reset } = usePredict();

  // Cuando el estudiante toma o sube una foto nueva, se envía sola.
  useEffect(() => {
    if (!imageData) return;
    let cancelled = false;
    (async () => {
      const data = await run(imageData, figure.slug, user.id);
      if (data && !cancelled) onResult(data);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageData]);

  const panel = {
    padding: "2rem", textAlign: "center" as const,
    color: BRUT.ink, fontSize: 14, fontWeight: 600,
  };

  if (status === "error") return (
    <div style={{ ...panel, ...BRUT.raised(6, BRUT.danger) }}>
      <p style={{ ...T.title(17), margin: "0 0 12px", textTransform: "uppercase" }}>
        No pudimos conectarnos con el servidor
      </p>
      <p style={{ margin: "0 0 18px", fontSize: 13, fontWeight: 500 }}>{errorMsg}</p>
      <button onClick={reset} style={BRUT.button()}>Reintentar</button>
    </div>
  );

  if (status === "idle") return (
    <div style={{ ...panel, ...BRUT.inset() }}>
      Toma o sube una foto de tu Tangram armado y te diré qué tan parecido quedó
      a la figura.
    </div>
  );

  if (status === "loading") return (
    <div style={{ ...panel, ...BRUT.raised(6) }}>
      <p style={{ ...T.title(17), margin: "0 0 18px", textTransform: "uppercase" }}>
        Estoy revisando tu figura…
      </p>
      <div style={{
        height: 16, background: BRUT.well,
        border: `${BRUT.borderThin}px solid ${BRUT.ink}`, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", background: BRUT.accent,
          borderRight: `${BRUT.borderThin}px solid ${BRUT.ink}`,
          animation: "progress 2s ease-in-out forwards", width: "0%",
        }} />
      </div>
      <style>{`@keyframes progress { from { width:0% } to { width:90% } }`}</style>
    </div>
  );

  if (!result) return null;

  const ok = result.match;
  // El detector no vio Tangram suficiente como para juzgar nada. No es lo mismo
  // que una figura mal armada, y confundirlos es lo que hacía esta pantalla:
  // con 2 fichas de 7 detectadas mostraba «Ninguna ficha encima de otra: Bien»,
  // «Sin espacios vacíos: Bien» y un 68% de parecido. Ninguna de esas tres cosas
  // se había comprobado.
  const fotoIlegible = result.detection_ok === false;
  const vistoPct = `${Math.round((result.coverage ?? 0) * 100)}%`;

  const checks = result.checks;
  const filas = checks && !fotoIlegible ? filasDeRevision(checks) : [];

  // Un polígono necesita al menos 3 vértices; con menos no hay nada que pintar.
  // Se queda vacío cuando el detector no vio ninguna ficha, y entonces la
  // superposición no se muestra en vez de dibujar una figura degenerada.
  const haySuperposicion =
    (result.detected_polygon?.length ?? 0) >= 3 &&
    (result.target_polygon?.length ?? 0) >= 3;

  // Problema de foto, no de armado: la figura no cabía en el cuadro o salió
  // demasiado pequeña. Cambia el veredicto, porque decirle «acomoda las fichas»
  // a quien las tenía bien puestas lo manda a deshacer un trabajo correcto.
  const encuadreMal = !ok && result.framing != null && !result.framing.ok
    && result.pieces_used > 0;
  const encuadreTexto = result.framing?.touches_edge
    ? "Tu figura no cabía completa en el cuadro. Aléjate un poco y repite la foto."
    : "Tu figura salió muy pequeña para verla bien. Acércate un poco, sin que se salga del cuadro.";

  // La figura calza, pero en espejo. Merece decirse aparte: el estudiante ve un
  // porcentaje alto y no entiende por qué no se la dan por buena.
  const enEspejo = Boolean(checks?.shape.mirrored) && result.iou_score >= 0.6;

  // Los dos son «la foto no sirve», no «tu figura está mal», y comparten
  // tratamiento: azul, y la acción es repetir la toma.
  const problemaDeFoto = encuadreMal || fotoIlegible;

  const tono = ok ? BRUT.success : problemaDeFoto ? BRUT.info : BRUT.warning;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Veredicto. Tres estados y tres colores: verde lo logrado, amarillo lo
          que está a medias, azul cuando el problema no es la figura sino la
          foto. Amarillo y no rojo para «casi lo tienes»: un niño que armó mal
          una figura no ha cometido un error, está a mitad de camino. */}
      <div style={{ padding: "1.5rem", textAlign: "center", ...BRUT.raised(7, tono) }}>
        <p style={{ ...T.display(26), margin: 0 }}>
          {ok ? "¡Lo lograste!" : problemaDeFoto ? "Repite la foto" : "¡Casi lo tienes!"}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 600, color: BRUT.ink }}>
          Figura objetivo: {result.figure_detected} · {result.pieces_used} de 7 fichas detectadas
        </p>
      </div>

      {/* El modo demostración no es un detalle de pie de página: significa que
          ninguna de las cifras de abajo salió de la foto del estudiante, sino de
          deformar la propia silueta objetivo. Antes se avisaba en 9 px dentro
          del veredicto, donde es fácil dar por buenos números que no lo son. */}
      {result.mock && (
        <div style={{ padding: "12px 16px", ...BRUT.subtle(BRUT.info) }}>
          <p style={{ ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 4px" }}>
            Modo demostración
          </p>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: BRUT.ink }}>
            El servidor no tiene el detector cargado, así que estos resultados
            son simulados. Revisa <code>YOLO_WEIGHTS</code> en{" "}
            <code>vision-service/.env</code>.
          </p>
        </div>
      )}

      <p style={{
        ...T.body(BRUT.ink), margin: 0, textAlign: "center", padding: "0 0.5rem",
      }}>{result.feedback}</p>

      {/* Va antes que cualquier corrección del armado: todo lo que venga después
          se midió sobre una foto que no sirve. */}
      {fotoIlegible && (
        <div style={{ padding: "16px 18px", ...BRUT.inset() }}>
          <p style={{ ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 8px" }}>
            No pude ver tus fichas
          </p>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: BRUT.ink }}>
            Del Tangram solo se reconoció el {vistoPct}. Con tan poco no se puede
            revisar la figura: no se sabe si está bien o mal armada.
          </p>
          <p style={{ margin: "7px 0 0", fontSize: 13, fontWeight: 700, color: BRUT.ink }}>
            No muevas las fichas. Revisa la luz, que el fondo sea liso y que no
            queden manos en la toma, y repite la foto.
          </p>
        </div>
      )}

      {encuadreMal && !fotoIlegible && (
        <div style={{ padding: "16px 18px", ...BRUT.inset() }}>
          <p style={{ ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 8px" }}>
            Es la foto, no tu figura
          </p>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: BRUT.ink }}>
            {encuadreTexto}
          </p>
          <p style={{ margin: "7px 0 0", fontSize: 13, fontWeight: 700, color: BRUT.ink }}>
            No muevas las fichas: puede que ya estuvieran bien.
          </p>
        </div>
      )}

      {/* Tu figura sobre el modelo. Es el dibujo que hace explicable el
          porcentaje: el contorno viene ya girado a la orientación con la que el
          backend calculó el IoU, así que lo que se ve es literalmente lo que se
          comparó. */}
      {haySuperposicion && (
        <div style={{ padding: "16px 18px", ...BRUT.subtle() }}>
          <p style={{ ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 12px" }}>
            Tu figura sobre el modelo
          </p>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Comparison
              detected={result.detected_polygon}
              target={result.target_polygon}
              size={180}
            />
          </div>
          <div style={{
            display: "flex", justifyContent: "center", gap: 20, marginTop: 12,
            flexWrap: "wrap",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{
                width: 18, height: 12, background: BRUT.card,
                border: `${BRUT.borderThin}px dashed ${BRUT.ink}`,
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: BRUT.ink }}>El modelo</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{
                width: 18, height: 12, background: BRUT.info,
                border: `${BRUT.borderThin}px solid ${BRUT.ink}`,
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: BRUT.ink }}>Lo que armaste</span>
            </span>
          </div>
          {enEspejo && (
            <p style={{
              margin: "12px 0 0", fontSize: 13, fontWeight: 600, color: BRUT.ink,
              padding: "10px 12px", ...BRUT.subtle(BRUT.warning),
            }}>
              Tu figura está en espejo respecto al modelo. Si el romboide está
              volteado, dale la vuelta.
            </p>
          )}
        </div>
      )}

      {/* Inventario de fichas: verde si están las 7, amarillo si faltan. */}
      <div style={{
        padding: "12px 18px", textAlign: "center", fontSize: 13,
        fontWeight: 700, color: BRUT.ink,
        ...BRUT.subtle(result.pieces.complete ? BRUT.success : BRUT.warning),
      }}>
        {result.pieces.complete
          ? "¡Usaste las 7 fichas correctas!"
          : `Fichas encontradas: ${result.pieces.total} de 7`}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { label: "Seguridad de las fichas", value: result.confidence, tono: BRUT.info },
          { label: "Parecido con el modelo",  value: result.iou_score,  tono: BRUT.accent },
        ].map(({ label, value, tono }) => (
          <div key={label} style={{ padding: "14px 16px", ...BRUT.subtle() }}>
            <p style={{ ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 10px" }}>{label}</p>
            <Bar value={value} tono={tono} />
            <p style={{ ...T.stat(18), margin: "8px 0 0" }}>{pct(value)}</p>
          </div>
        ))}
      </div>

      {/* Revisión del validador geométrico: las cinco cosas que tiene que
          cumplir un Tangram bien armado. Se muestra siempre —también cuando está
          todo bien, porque ver las cinco marcas en verde es parte del refuerzo—.
          Es lo que convierte el porcentaje en algo que el niño puede corregir. */}
      {filas.length > 0 && (
        <div style={{ padding: "16px 18px", ...BRUT.subtle() }}>
          <p style={{ ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 12px" }}>
            Revisión de tu armado
          </p>
          {filas.map(fila => (
            <div key={fila.key} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "7px 0",
            }}>
              <Mark ok={fila.ok} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: BRUT.ink }}>
                {fila.label}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: BRUT.muted }}>
                {fila.detail}
              </span>
            </div>
          ))}
          {/* Con el inventario en informativo (REQUIRE_INVENTORY=0) una figura
              puede aprobarse con esta marca en falso. Sin esta línea, la lista
              se contradice con el veredicto. */}
          {ok && checks && !checks.inventory.ok && (
            <p style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 600, color: BRUT.ink }}>
              A la cámara le faltaron fichas por ver, pero tu figura calzó con el
              modelo: cuenta como lograda.
            </p>
          )}
        </div>
      )}

      {/* Qué parte revisar. Señalar un tercio concreto solo ayuda si el resto de
          la figura ya calza: con un parecido bajo el problema no está en una
          banda, está en casi todas las fichas. Es el mismo criterio con el que
          el backend redacta su mensaje. */}
      {(checks ? checks.shape.close : true) && result.segments.length > 0 && (
        <div style={{ padding: "16px 18px", ...BRUT.subtle() }}>
          <p style={{ ...T.eyebrow(BRUT.ink), fontSize: 10, margin: "0 0 12px" }}>
            Partes bien logradas
          </p>
          {result.segments.map(seg => (
            <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: BRUT.ink, minWidth: 96 }}>
                {seg.label}
              </span>
              <div style={{ flex: 1 }}>
                <Bar value={seg.coverage} height={12}
                     tono={seg.coverage >= 0.85 ? BRUT.success
                           : seg.coverage >= 0.6 ? BRUT.warning : BRUT.danger} />
              </div>
              <span style={{
                ...T.stat(13), minWidth: 36, textAlign: "right", letterSpacing: 0,
              }}>{pct(seg.coverage)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
