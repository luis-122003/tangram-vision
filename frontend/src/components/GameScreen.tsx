import { useEffect, useState } from "react";
import { saveSession } from "../api/client";
import { BRUT, T } from "../theme/brut";
import { formatTime } from "../utils/format";
import AIValidation from "./AIValidation";
import CameraCapture from "./CameraCapture";
import Silhouette from "./Silhouette";
import type { Figure, PredictResponse, User } from "../types";

/** Contador de la cabecera: cifra grande sobre una placa de color. */
function Contador({ label, value, tono }: {
  label: string; value: string | number; tono: string;
}) {
  return (
    <div style={{
      padding: "9px 16px", textAlign: "center", minWidth: 80,
      ...BRUT.subtle(tono),
    }}>
      <p style={{ ...T.stat(20), margin: 0 }}>{value}</p>
      <p style={{ ...T.eyebrow(BRUT.ink), margin: 0, fontSize: 9 }}>{label}</p>
    </div>
  );
}

/** La partida: la silueta que hay que armar, la cámara y el resultado. */
export default function GameScreen({ user, figure, onExit }: {
  user: User; figure: Figure; onExit: () => void;
}) {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [seconds,  setSeconds]  = useState(0);
  const [errors,   setErrors]   = useState(0);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  function handleCapture(img: string) {
    setCapturedImage(img);
    setAttempts(a => a + 1);
  }

  function handleResult(result: PredictResponse) {
    if (!result.match) setErrors(e => e + 1);
    saveSession({
      userId: user.id, figureId: figure.slug, time: seconds,
      errors, match: result.match, iou: result.iou_score,
      ts: new Date().toISOString(),
    }).catch(err => console.error("No se pudo guardar la sesión:", err));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: "0 0 2rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button onClick={onExit} style={BRUT.button()}>← Volver</button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <Contador label="Tiempo"   value={formatTime(seconds)} tono={BRUT.info} />
          <Contador label="Fotos"    value={attempts}            tono={BRUT.card} />
          <Contador label="De nuevo" value={errors}              tono={errors > 0 ? BRUT.danger : BRUT.card} />
        </div>
      </div>

      {/* Encabezado de la figura. La silueta va en un hueco de la placa: es la
          referencia, no una acción, así que está metida y no apoyada. */}
      <div style={{
        padding: "1.6rem", display: "flex", alignItems: "center",
        gap: 24, flexWrap: "wrap", ...BRUT.raised(7),
      }}>
        <div style={{
          padding: 14, display: "grid", placeItems: "center", ...BRUT.inset(),
        }}>
          <Silhouette figure={figure} size={110} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <p style={{ ...T.display(28), margin: "0 0 8px" }}>
            ¡Arma un(a) {figure.name}!
          </p>
          <p style={{ ...T.body(BRUT.ink), margin: 0 }}>
            {figure.description}. Copia esta silueta con tus 7 fichas de Tangram
            y, cuando esté lista, tómale una foto.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        <div>
          <p style={{ ...T.eyebrow(BRUT.ink), margin: "0 0 12px" }}>Tu foto</p>
          <CameraCapture onCapture={handleCapture} />
        </div>

        <div>
          <p style={{ ...T.eyebrow(BRUT.ink), margin: "0 0 12px" }}>¿Qué dice la IA?</p>
          <AIValidation imageData={capturedImage} figure={figure} user={user} onResult={handleResult} />
        </div>
      </div>
    </div>
  );
}
