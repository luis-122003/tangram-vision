import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { BRUT, T } from "../theme/brut";

/**
 * Captura la foto del Tangram físico armado.
 *
 * Pide la cámara trasera del dispositivo y, si no la consigue —navegador sin
 * permiso, equipo sin cámara—, deja subir un archivo. Esa salida no es un
 * adorno: en un aula con equipos prestados es a menudo la única vía.
 *
 * El visor va enmarcado en un filete negro grueso y con su sombra sólida. El
 * `overflow: hidden` que recorta el vídeo no estorba: un elemento recorta a sus
 * hijos, no su propia sombra exterior —solo el desbordamiento de un ancestro
 * haría eso—, así que el marco puede recortar y proyectar a la vez.
 *
 * De paso arregla un defecto del sistema anterior: allí el visor iba hundido,
 * pero una sombra `inset` se pinta debajo del contenido, y el vídeo cubría todo
 * el área. Con la cámara encendida, ese relieve no se veía.
 */
/**
 * Proporción del visor. La usan **el estilo y la captura**, y por eso es una
 * constante y no un literal escrito dos veces: si las dos cifras se separan, la
 * foto deja de coincidir con lo que se vio y el fallo es invisible en el código.
 */
const ASPECTO = 4 / 3;

/**
 * Qué parte del fotograma se está viendo de verdad.
 *
 * El vídeo se pinta con `object-fit: cover`, que llena el marco recortando lo
 * que sobra por los lados o por arriba y abajo. Pero `drawImage(video, 0, 0)`
 * copia el fotograma **entero**, incluido lo que el marco había recortado: la
 * foto que se analizaba llevaba mesa, bordes y objetos que el usuario nunca vio
 * dentro del cuadro. Esto deshace ese recorte para copiar solo lo visible.
 */
function regionVisible(vw: number, vh: number) {
  if (vw / vh > ASPECTO) {          // el fotograma es más ancho: se recorta a los lados
    const w = vh * ASPECTO;
    return { sx: (vw - w) / 2, sy: 0, sw: w, sh: vh };
  }
  const h = vw / ASPECTO;           // más alto: se recorta arriba y abajo
  return { sx: 0, sy: (vh - h) / 2, sw: vw, sh: h };
}

export default function CameraCapture({ onCapture }: {
  onCapture: (imageBase64: string) => void;
}) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [cameraOn,    setCameraOn]    = useState(false);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Tu navegador no permite usar la cámara aquí. Sube una foto en su lugar.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraOn(true);
      } catch {
        setCameraError("No pudimos abrir tu cámara. Puedes subir una foto en su lugar.");
      }
    }
    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const { sx, sy, sw, sh } = regionVisible(video.videoWidth, video.videoHeight);
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    // Se copia solo el trozo que el marco dejaba ver, a tamaño real: lo que se
    // analiza pasa a ser exactamente lo que había dentro del cuadro.
    canvas.getContext("2d")?.drawImage(
      video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height,
    );
    onCapture(canvas.toDataURL("image/jpeg", 0.9));
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onCapture(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* La sombra vive aquí; el marco de dentro es el que clipa el vídeo. */}
      <div style={{ boxShadow: `6px 6px 0 ${BRUT.ink}` }}>
        <div style={{
          position: "relative", width: "100%", aspectRatio: `${ASPECTO}`,
          overflow: "hidden", background: BRUT.well,
          border: `${BRUT.border}px solid ${BRUT.ink}`,
        }}>
          <video
            ref={videoRef} playsInline muted
            style={{
              width: "100%", height: "100%", objectFit: "cover",
              display: cameraOn ? "block" : "none",
            }}
          />
          {!cameraOn && !cameraError && (
            <div style={{
              position: "absolute", inset: 0, display: "grid", placeItems: "center",
              ...T.eyebrow(BRUT.ink),
            }}>Abriendo cámara…</div>
          )}
          {cameraError && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              gap: 8, alignItems: "center", justifyContent: "center",
              background: BRUT.danger, color: BRUT.ink, fontSize: 13,
              fontWeight: 600, padding: "1.5rem", textAlign: "center",
            }}>
              {cameraError}
            </div>
          )}
        </div>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {cameraOn && (
          <button onClick={takePhoto} style={BRUT.button(false, BRUT.success)}>
            Tomar foto
          </button>
        )}
        <button onClick={() => fileInputRef.current?.click()} style={BRUT.button()}>
          Subir foto
        </button>
        <input
          ref={fileInputRef} type="file" accept="image/*" capture="environment"
          style={{ display: "none" }} onChange={handleFile}
        />
      </div>
    </div>
  );
}
