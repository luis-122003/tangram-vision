import { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Image,
  useWindowDimensions, BackHandler, Linking,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import Svg, { Path, Rect } from "react-native-svg";
import { predict, saveSession } from "../api/client";
import type { Figure, PredictResponse, User } from "../api/types";
import Silhouette from "../components/Silhouette";
import Comparison from "../components/Comparison";
import TangramPiece from "../components/TangramPiece";
import Icon from "../components/Icon";
import {
  Bar, Card, Eyebrow, IconButton, Note, PrimaryButton, SecondaryButton,
} from "../components/ui";
import {
  C, R, S, F, B, SAFE_TOP, SAFE_BOTTOM, PIECE_INVENTORY, pieceCount,
  TOTAL_PIECES, cardColor, display, shout, formatTime, pct, tabular,
  raised, flat, onFill,
} from "../theme";

/**
 * Acierto mínimo por defecto, solo por si una respuesta vieja no trae
 * `match_threshold`. El valor bueno es siempre el del servidor: allá se puede
 * cambiar por variable de entorno y aquí no habría forma de enterarse.
 */
const MATCH_IOU_FALLBACK = 0.75;

/**
 * Alturas de las dos barras que se dibujan sobre la cámara.
 *
 * Viven aquí, y no como números sueltos dentro de los estilos, porque
 * `marcoEncuadre()` las resta para calcular el cuadro y ese cuadro es la región
 * que se manda al servidor a recortar. Cuando el valor estaba escrito dos veces,
 * cambiar el estilo y olvidar la fórmula hacía que el backend analizara una
 * franja distinta de la que el niño vio, sin ningún error visible. Con una sola
 * definición, ese desajuste ya no se puede escribir.
 */
const CAM_TOP = 96;
const CAM_BOTTOM = 204;

/**
 * Margen que se deja alrededor del cuadro de encuadre, en fracción del ancho.
 * El cuadro tiene que ser lo más grande posible: una figura armada con las 7
 * fichas ocupa bastante mesa, y cuanto mayor sea el cuadro menos tiene que
 * alejarse el niño para que le quepa entera.
 *
 * Bajó de 0,055 a 0,025 por una razón que se ve en cuanto se hacen las cuentas:
 * el lado del cuadro lo limita **el ancho** de la pantalla, no el alto. En un
 * teléfono de 360 dp el margen se comía 40 dp de ancho y dejaba el cuadro en
 * 320, mientras que verticalmente sobraban 140 dp sin usar. Estrechar el margen
 * es lo único que agranda el cuadro por el lado que se desborda: 320 -> 342 dp,
 * un 14 % más de área. Por debajo de esto los brazos de las esquinas quedan
 * pegados al borde de la pantalla y el cuadro deja de leerse como un cuadro.
 */
const MARCO_MARGEN = 0.025;

/**
 * Cuánto se agranda el recorte respecto al cuadro dibujado, al pedirle al
 * servidor que recorte la foto.
 *
 * El preview de la cámara llena la pantalla recortando por los lados (`cover`),
 * y la foto guardada tiene la relación de aspecto del sensor, que no es la de la
 * pantalla. La correspondencia entre lo que se ve y lo que se guarda es, por
 * tanto, aproximada. Este colchón hace que el recorte peque de grande: es mejor
 * incluir un poco de mesa alrededor que cortarle una ficha a la figura.
 */
const RECORTE_COLCHON = 1.15;

/**
 * Lado mayor al que se encoge la foto antes de subirla.
 *
 * La cifra **no se puede bajar a ojo**, y por eso va con las cuentas hechas. El
 * servicio de visión reescala a `YOLO_IMGSZ` (960 px) lo que le llega, pero lo
 * que le llega no es la foto: es el recorte del cuadro de encuadre, que ocupa
 * dos tercios del ancho (ver `cuadroSobreLaFoto`). Con 2000 px de lado mayor, ese
 * recorte todavía ronda los 1000 px y el detector sigue reduciendo; con los 1280
 * que uno pondría por costumbre, el recorte se quedaría en ~630 px y YOLO tendría
 * que **ampliarlo** hasta 960. Sería regalar exactamente lo que este proyecto se
 * ha dedicado a ganar: píxeles por ficha en una figura fotografiada de lejos.
 *
 * Lo que sí ahorra es red. Una foto de 12 MP viaja en base64 —un tercio más que
 * el JPEG— por el wifi del aula; a 2000 px pesa del orden de tres veces menos, y
 * el niño espera menos con la misma respuesta del detector.
 */
const LADO_MAXIMO = 2000;

/** Lado y posición del cuadro de encuadre, en píxeles de pantalla. */
function marcoEncuadre(width: number, height: number) {
  const margen = Math.round(width * MARCO_MARGEN);
  // Franjas reservadas: las dos barras que se pintan sobre la cámara, con aire.
  const disponible = height - CAM_TOP - CAM_BOTTOM - margen * 2;
  const lado = Math.max(160, Math.min(width - margen * 2, disponible));
  return {
    lado,
    left: Math.round((width - lado) / 2),
    // Centrado en el hueco que queda entre las dos barras.
    top: Math.round(CAM_TOP + margen + Math.max(0, (disponible - lado) / 2)),
  };
}

/**
 * Traduce el cuadro de la pantalla a un rectángulo sobre la foto, normalizado
 * a 0..1, que es lo que espera `/predict`.
 *
 * El preview se dibuja en modo `cover`: la foto se escala hasta cubrir la
 * pantalla y se recorta lo que sobra, manteniendo el centro. Deshacer esa
 * transformación es lo que permite recortar en el servidor justo por donde el
 * niño vio el cuadro.
 */
function cuadroSobreLaFoto(
  marco: { lado: number; left: number; top: number },
  pantalla: { width: number; height: number },
  foto: { width: number; height: number },
): [number, number, number, number] | undefined {
  if (!foto.width || !foto.height) return undefined;

  // Si la foto llega en la orientación contraria a la pantalla (algunos sensores
  // devuelven el fotograma en horizontal y dejan la rotación en los metadatos),
  // esta cuenta no aplica y recortaría por el sitio equivocado. Sin recorte el
  // servidor analiza la foto entera: se pierde la ayuda, no la figura.
  if (foto.width > foto.height !== pantalla.width > pantalla.height) return undefined;

  const escala = Math.max(pantalla.width / foto.width, pantalla.height / foto.height);
  const ladoFoto = (marco.lado / escala) * RECORTE_COLCHON;

  // El centro del preview es el centro de la foto; el desplazamiento del marco
  // respecto al centro de la pantalla se traslada a la foto con la misma escala.
  const cxFoto = foto.width / 2 + (marco.left + marco.lado / 2 - pantalla.width / 2) / escala;
  const cyFoto = foto.height / 2 + (marco.top + marco.lado / 2 - pantalla.height / 2) / escala;

  const w = Math.min(1, ladoFoto / foto.width);
  const h = Math.min(1, ladoFoto / foto.height);
  const x = Math.min(1 - w, Math.max(0, cxFoto / foto.width - w / 2));
  const y = Math.min(1 - h, Math.max(0, cyFoto / foto.height - h / 2));
  return [x, y, w, h];
}

/**
 * Encoge la foto y devuelve su base64, junto con el tamaño que le quedó.
 *
 * Se hace en el teléfono y no en el servidor porque lo que se quiere ahorrar es
 * justo el viaje: la foto sube por el wifi del aula, y de todo el trayecto ese
 * es el tramo lento. Ver `LADO_MAXIMO` para por qué la cifra es 2000 y no menos.
 *
 * Una foto que ya venga por debajo del tope no se reescala; se recomprime igual,
 * que es lo que produce el base64.
 */
async function encogerFoto(uri: string, ancho: number, alto: number): Promise<{
  base64: string; width: number; height: number;
}> {
  const contexto = ImageManipulator.manipulate(uri);
  // Se fija el lado mayor y se deja el otro en automático: así se conserva la
  // proporción, que es lo que permite que el cuadro de encuadre siga cayendo
  // donde el niño lo vio.
  const escalado = Math.max(ancho, alto) > LADO_MAXIMO
    ? contexto.resize(ancho >= alto ? { width: LADO_MAXIMO } : { height: LADO_MAXIMO })
    : contexto;

  const imagen = await escalado.renderAsync();
  const salida = await imagen.saveAsync({
    base64: true, compress: 0.75, format: SaveFormat.JPEG,
  });
  if (!salida.base64) throw new Error("No se pudo preparar la foto");
  return { base64: salida.base64, width: salida.width, height: salida.height };
}

type Phase = "prepare" | "camera" | "analyzing" | "result";

/** Lo que se anota en `sessions` cuando termina un intento. */
type Registro = Parameters<typeof saveSession>[0];

export default function GameScreen({ user, figure, onExit }: {
  user: User; figure: Figure; onExit: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const capturing = useRef(false);
  const { width, height } = useWindowDimensions();

  const [phase,    setPhase]    = useState<Phase>("prepare");
  const [photo,    setPhoto]    = useState<string | null>(null);
  const [result,   setResult]   = useState<PredictResponse | null>(null);
  const [error,    setError]    = useState("");
  const [seconds,  setSeconds]  = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [errors,   setErrors]   = useState(0);
  const [guide,    setGuide]    = useState(true);
  const [torch,    setTorch]    = useState(false);
  /** El intento se resolvió pero no se pudo anotar en el servidor. */
  const [noGuardado, setNoGuardado] = useState(false);
  const [guardando,  setGuardando]  = useState(false);
  /** Lo último que quedó sin anotar, para poder reintentarlo tal cual. */
  const registroPendiente = useRef<Registro | null>(null);

  // El cronómetro mide el tiempo de armado, así que corre desde que se abre la
  // cámara y no mientras el estudiante todavía mira la figura objetivo.
  useEffect(() => {
    if (phase !== "camera") return;
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  async function takePhoto() {
    // El disparo tarda cientos de ms con el botón todavía en pantalla: sin este
    // cerrojo dos toques seguidos generan dos análisis y dos filas en sessions.
    if (!cameraRef.current || capturing.current) return;
    capturing.current = true;
    setError("");
    try {
      // La captura ya **no** pide `base64`. El de una foto de 12 MP es una
      // cadena de varios megas que se construye entera en memoria para acabar
      // tirándose: lo que se sube es la versión encogida, y su base64 sale del
      // manipulador. Sin `skipProcessing`, Android sí aplica `quality`.
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (!shot?.uri) throw new Error("No se pudo capturar la foto");
      setPhoto(shot.uri);
      setAttempts(a => a + 1);
      setPhase("analyzing");

      const foto = await encogerFoto(shot.uri, shot.width, shot.height);
      // El servidor recorta por donde el niño vio el cuadro, así la figura ocupa
      // el fotograma aunque la foto se tomara de lejos. Las medidas que se le
      // pasan son las de la foto **ya encogida**, que es la que va a recortar: el
      // cuadro es una fracción, pero pasarle las de antes sería confiar en que
      // el reescalado no cambió la proporción.
      const crop = cuadroSobreLaFoto(
        marcoEncuadre(width, height),
        { width, height },
        { width: foto.width, height: foto.height },
      );
      await analyze(foto.base64, crop);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al tomar la foto");
      setPhase("camera");
    } finally {
      capturing.current = false;
    }
  }

  async function analyze(base64: string, crop?: [number, number, number, number]) {
    try {
      const data = await predict(base64, figure.slug, user.id, crop);
      // `errors` se calcula antes de guardar: leerlo del estado dejaría fuera
      // el fallo de este mismo intento.
      const failed = data.match ? errors : errors + 1;
      setResult(data);
      setErrors(failed);
      setPhase("result");

      // El veredicto llega también por el tacto, antes de que dé tiempo a leer
      // nada. Para un niño de primaria que acaba de armar una figura, ese medio
      // segundo es la mitad del premio; y quien no vea bien la pantalla se
      // entera igual. Se traga el fallo: hay teléfonos sin motor de vibración,
      // y quedarse sin resultado por no poder vibrar sería absurdo.
      void Haptics.notificationAsync(
        data.match
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => { /* sin vibración se sigue igual */ });
      void guardarIntento({
        studentId: user.id, figureSlug: figure.slug, match: data.match,
        iou: data.iou_score, timeSeconds: seconds, errors: failed,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al analizar");
      setPhase("camera");
    }
  }

  /**
   * Anota el intento en el servidor.
   *
   * El fallo se **muestra**, y ahí está el cambio: antes iba a un `catch` vacío
   * con la excusa de que el resultado ya se le había enseñado al estudiante. Lo
   * que se perdía en silencio era el intento —el que cuenta para su progreso y
   * para lo que ve el docente—, y nadie se enteraba hasta mirar la base de
   * datos. Con la red del aula cayéndose a ratos, eso pasa.
   *
   * El registro se guarda tal cual para poder repetirlo: reconstruirlo al
   * reintentar leería un cronómetro que ya siguió corriendo.
   */
  async function guardarIntento(registro: Registro) {
    registroPendiente.current = registro;
    setGuardando(true);
    try {
      await saveSession(registro);
      registroPendiente.current = null;
      setNoGuardado(false);
    } catch {
      setNoGuardado(true);
    } finally {
      setGuardando(false);
    }
  }

  function reintentarGuardado() {
    const registro = registroPendiente.current;
    if (registro && !guardando) void guardarIntento(registro);
  }

  function retry() {
    setPhoto(null); setResult(null); setError(""); setNoGuardado(false); setPhase("camera");
  }

  function review() {
    setPhoto(null); setResult(null); setError(""); setNoGuardado(false); setPhase("prepare");
  }

  /**
   * Botón atrás de Android, fase por fase.
   *
   * Sin esto, el atrás de la cámara o del resultado lo atendía `App.tsx` y salía
   * **del intento entero** al catálogo: el cronómetro, la foto y el análisis se
   * perdían de un toque, en la pantalla donde más caro sale. Aquí retrocede una
   * fase, que es lo que el gesto significa en cualquier otra app.
   *
   * En `analyzing` se traga el gesto a propósito: la foto ya viaja hacia el
   * servidor y salir dejaría el análisis huérfano —y la sesión sin registrar—
   * cuando faltan un par de segundos para tener el resultado.
   *
   * En `prepare` devuelve `false` y deja pasar el gesto: ahí sí, salir de la
   * figura es lo que el estudiante quiere decir, y de eso ya se encarga
   * `App.tsx`. React Native llama a las suscripciones en orden inverso al de
   * registro, así que esta —montada después— se atiende primero.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "result")    { review();             return true; }
      if (phase === "camera")    { setPhase("prepare");  return true; }
      if (phase === "analyzing") {                       return true; }
      return false;
    });
    return () => sub.remove();
  }, [phase]);

  const color = cardColor(figure.id);

  // ── Preparar: la figura objetivo, en grande y sin competencia visual ────────
  if (phase === "prepare") {
    return (
      <ScrollView style={s.flex} contentContainerStyle={s.prepare}>
        <View style={s.topRow}>
          <IconButton name="back" onPress={onExit} label="Volver al catálogo" />
          <View style={s.flex}>
            <Eyebrow>{figure.category} · {figure.difficulty}</Eyebrow>
            <Text style={[display(26), s.topName]} numberOfLines={1}>{figure.name}</Text>
          </View>
        </View>

        {/* La figura objetivo, encajada en un nicho hundido: es el molde que el
            estudiante tiene que reproducir sobre la mesa. */}
        <Card style={s.gap} sunken depth={6} contentStyle={s.target}>
          <Silhouette
            figure={figure} size={Math.min(280, width - 90)}
            mode="knockout" color={color}
          />
        </Card>

        <Text style={s.description}>
          {figure.description}. Ármala con tus <Text style={s.strong}>7 fichas</Text>:
          no puede sobrar ni faltar ninguna.
        </Text>

        <Card style={s.gap} contentStyle={s.piecesCard}>
          <Eyebrow style={s.piecesTitle}>Las 7 fichas</Eyebrow>
          <View style={s.piecesRow}>
            {PIECE_INVENTORY.map(p => (
              <View key={p.kind} style={s.pieceCell}>
                <TangramPiece kind={p.kind} size={46} />
                <Text style={s.pieceCount}>×{p.count}</Text>
              </View>
            ))}
          </View>
        </Card>

        <View style={s.gap}>
          <Note>
            Ármala sobre una hoja blanca y con buena luz: así la cámara distingue
            mejor cada ficha. Déjale espacio alrededor para que quepa entera en el
            cuadro de la cámara.
          </Note>
        </View>

        <View style={s.gap}>
          <PrimaryButton
            label="Ya la armé · Tomar foto" icon="camera"
            onPress={() => setPhase("camera")}
          />
        </View>
      </ScrollView>
    );
  }

  // ── Permisos de cámara ──────────────────────────────────────────────────────
  if (!permission) {
    return <View style={s.center}><ActivityIndicator color={C.ink} size="large" /></View>;
  }
  if (!permission.granted) {
    // Android solo deja preguntar por el permiso un par de veces; después el
    // sistema descarta la petición sin enseñar nada. Con el botón de siempre, el
    // estudiante se quedaba encerrado pulsando «Permitir cámara» sin que pasara
    // absolutamente nada. Cuando ya no se puede preguntar, la única salida es
    // mandarlo a los ajustes de la app.
    const bloqueado = !permission.canAskAgain;
    return (
      <View style={s.center}>
        <Icon name="camera" size={54} />
        <Text style={[display(20), s.permTitle]}>Necesito usar la cámara</Text>
        <Text style={s.permText}>
          {bloqueado
            ? "Está bloqueada para esta app. Ábrela en los ajustes del teléfono, " +
              "en Permisos → Cámara, y vuelve."
            : "Es para tomarle una foto a tu Tangram armado y revisarlo."}
        </Text>
        <View style={s.permActions}>
          <PrimaryButton
            label={bloqueado ? "Abrir los ajustes" : "Permitir cámara"}
            onPress={bloqueado ? () => { void Linking.openSettings(); } : requestPermission}
          />
          <SecondaryButton label="Volver" icon="back" onPress={onExit} />
        </View>
      </View>
    );
  }

  // ── Cámara ──────────────────────────────────────────────────────────────────
  if (phase === "camera") {
    // Cuadro de encuadre cerrado: la figura entera tiene que caber aquí dentro,
    // y es también la zona que el servidor recorta antes de buscar las fichas.
    // Va cuadrado porque una figura de Tangram cabe en un cuadrado en cualquier
    // orientación, y así el mismo cuadro sirve para las 14 figuras.
    const marco = { ...marcoEncuadre(width, height) };
    const { lado, left, top } = marco;
    const bottom = top + lado;
    const right = left + lado;
    const arm = Math.round(lado * 0.18);
    const ghostSize = Math.round(lado * 0.74);

    return (
      <View style={s.dark}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} />

        <View style={s.guides} pointerEvents="none">
          {/* Fuera del cuadro se oscurece: deja claro de un vistazo dónde tiene
              que caber la figura, sin necesidad de leer el consejo. */}
          <View style={[s.mask, { left: 0, right: 0, top: 0, height: top }]} />
          <View style={[s.mask, { left: 0, right: 0, top: bottom, bottom: 0 }]} />
          <View style={[s.mask, { left: 0, width: left, top, height: lado }]} />
          <View style={[s.mask, { right: 0, width: width - right, top, height: lado }]} />

          <Svg style={StyleSheet.absoluteFill}>
            {/* Filete continuo del cuadro, con las esquinas remarcadas. */}
            <Rect
              x={left} y={top} width={lado} height={lado}
              fill="none" stroke={C.paper} strokeWidth={2} strokeOpacity={0.9}
            />
            <Path
              d={`M${left} ${top + arm}v-${arm}h${arm}`}
              fill="none" stroke={C.base} strokeWidth={5} strokeLinecap="square"
            />
            <Path
              d={`M${right - arm} ${top}h${arm}v${arm}`}
              fill="none" stroke={C.base} strokeWidth={5} strokeLinecap="square"
            />
            <Path
              d={`M${right} ${bottom - arm}v${arm}h-${arm}`}
              fill="none" stroke={C.base} strokeWidth={5} strokeLinecap="square"
            />
            <Path
              d={`M${left + arm} ${bottom}h-${arm}v-${arm}`}
              fill="none" stroke={C.base} strokeWidth={5} strokeLinecap="square"
            />
          </Svg>
          {guide && (
            <View style={[s.ghost, { top, height: lado }]}>
              <Silhouette figure={figure} size={ghostSize} mode="guide" color={C.card} />
            </View>
          )}
        </View>

        {/* Barra superior sobre la cámara */}
        <View style={s.camTop}>
          <TouchableOpacity
            onPress={onExit} style={s.camBack} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel="Volver al catálogo"
          >
            <Icon name="back" size={21} color={C.paper} />
          </TouchableOpacity>
          <View style={s.flex}>
            <Eyebrow color={C.ghost}>Armando</Eyebrow>
            <Text style={display(20, C.paper)} numberOfLines={1}>{figure.name}</Text>
          </View>
          <View style={s.timer}>
            <Icon name="clock" size={18} color={C.paper} />
            <Text style={[display(19, C.paper), tabular]}>{formatTime(seconds)}</Text>
          </View>
        </View>

        {error !== "" && (
          <View style={s.errorBar}><Text style={s.errorBarText}>{error}</Text></View>
        )}

        {/* Barra inferior: la altura deja libre la zona de gestos de Android */}
        <View style={s.camBottom}>
          <Text style={s.hint}>
            Que la figura <Text style={s.hintStrong}>completa</Text> quepa dentro
            del cuadro. No hace falta que lo llene
          </Text>
          <View style={s.camControls}>
            <TouchableOpacity
              onPress={() => setTorch(t => !t)}
              style={[s.camCtl, torch && s.camCtlOn]} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel="Linterna"
              accessibilityState={{ selected: torch }}
            >
              <Icon name="bolt" size={24} color={torch ? C.ink : C.paper} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={takePhoto} style={s.shutter} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel="Tomar la foto"
            >
              <Icon name="camera" size={30} color={C.card} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setGuide(g => !g)}
              style={[s.camCtl, guide && s.camCtlOn]} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel="Mostrar la silueta guía"
              accessibilityState={{ selected: guide }}
            >
              <Icon name="layers" size={24} color={guide ? C.ink : C.paper} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Analizando ──────────────────────────────────────────────────────────────
  if (phase === "analyzing") {
    return (
      <View style={s.center}>
        {photo && (
          <Card contentStyle={s.previewCard} clip>
            <Image source={{ uri: photo }} style={s.preview} />
          </Card>
        )}
        <ActivityIndicator color={C.ink} size="large" style={s.analyzeSpin} />
        <Text style={display(19)}>Estoy revisando tu figura</Text>
        <Text style={s.permText}>Comparando tus fichas con el modelo…</Text>
      </View>
    );
  }

  // ── Resultado ───────────────────────────────────────────────────────────────
  if (!result) return <View style={s.center}><ActivityIndicator color={C.ink} size="large" /></View>;

  const ok = result.match;
  const threshold = result.match_threshold ?? MATCH_IOU_FALLBACK;
  const missing = result.pieces?.missing ?? {};
  const extra = result.pieces?.extra ?? {};
  const missingCount = Object.values(missing).reduce((a, b) => a + b, 0);
  const missingNames = Object.entries(missing)
    .map(([kind, n]) => pieceCount(kind, n))
    .join(", ");

  // Revisión del validador geométrico: las cinco cosas que tiene que cumplir un
  // Tangram bien armado. Es lo que convierte el porcentaje en algo accionable,
  // así que se muestra siempre —también cuando está todo bien, porque ver las
  // cinco marcas en verde es parte del refuerzo—.
  const checks = result.checks;
  const checkRows = checks ? [
    {
      key: "inventory", ok: checks.inventory.ok, label: "Usaste las 7 fichas",
      detail: `${checks.inventory.counted} de ${checks.inventory.expected}`,
    },
    {
      key: "overlap", ok: checks.overlap.ok, label: "Ninguna ficha encima de otra",
      detail: checks.overlap.ok ? "Bien" : `${pct(checks.overlap.fraction)} montado`,
    },
    {
      key: "holes", ok: checks.holes.ok, label: "Sin espacios vacíos",
      detail: checks.holes.ok
        ? "Bien"
        : checks.holes.count === 1 ? "1 hueco" : `${checks.holes.count} huecos`,
    },
    {
      key: "connectivity", ok: checks.connectivity.ok, label: "Todas las fichas juntas",
      detail: checks.connectivity.ok
        ? "Bien"
        : checks.connectivity.loose === 1 ? "1 suelta" : `${checks.connectivity.loose} sueltas`,
    },
    {
      key: "shape", ok: checks.shape.ok, label: "Se parece al modelo",
      detail: pct(checks.shape.iou),
    },
  ] : [];

  // La figura calza, pero en espejo. Merece decirse aparte: el estudiante ve un
  // porcentaje alto y no entiende por qué no se la dan por buena.
  const mirrored = Boolean(checks?.shape.mirrored) && result.iou_score >= 0.6;

  // Problema de foto, no de armado: la figura no cabía en el cuadro o salió
  // demasiado pequeña. Cambia el veredicto y la acción principal, porque decirle
  // «acomoda las fichas» a quien las tenía bien puestas lo manda a deshacer un
  // trabajo correcto.
  const encuadreMal = !ok && result.framing != null && !result.framing.ok
    && result.pieces_used > 0;
  const encuadreTexto = result.framing?.touches_edge
    ? "Tu figura no cabía completa en el cuadro. Aléjate un poco y repite la foto."
    : "Tu figura salió muy pequeña para verla bien. Acércate un poco, sin que se salga del cuadro.";

  // Se dibujan las 7 fichas esperadas y se marcan como ausentes tantas de cada
  // tipo como diga `pieces.missing`.
  const slots: { kind: string; missing: boolean }[] = [];
  for (const p of PIECE_INVENTORY) {
    const gone = missing[p.kind] ?? 0;
    for (let i = 0; i < p.count; i++) slots.push({ kind: p.kind, missing: i >= p.count - gone });
  }

  // Un polígono necesita al menos 3 vértices; con menos no hay nada que pintar.
  const overlay =
    (result.detected_polygon?.length ?? 0) >= 3 &&
    (result.target_polygon?.length ?? 0) >= 3;

  const worst = result.segments.length
    ? result.segments.reduce((a, b) => (b.coverage < a.coverage ? b : a))
    : null;
  // Semáforo por franja: verde lo bien cubierto, amarillo lo regular, rojo lo
  // que hay que revisar. Los umbrales 0,85 y 0,6 no se tocan: están espejados
  // en los mensajes que redacta el backend. Y la cifra en porcentaje va siempre
  // al lado, porque el color no puede ser el único canal.
  const bandColor = (coverage: number) =>
    coverage >= 0.85 ? C.success : coverage >= 0.6 ? C.warning : C.danger;

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.resultScroll}>
      {/* Veredicto. Tres estados y tres colores: verde lo logrado, amarillo lo
          que está a medias, azul cuando el problema no es la figura sino la
          foto. Amarillo y no rojo para «casi la tienes»: un niño que armó mal
          una figura no ha cometido un error, está a mitad de camino.
          El icono y el titular dicen lo mismo, así que ni el color ni la
          palabra son imprescindibles por separado. */}
      <View style={s.verdictWrap}>
        {(() => {
          const tono = ok ? C.success : encuadreMal ? C.info : C.warning;
          return (
            <View style={[s.verdict, raised(6, tono), s.verdictLoud]}>
              <View style={s.verdictRow}>
                <View style={[s.verdictMark, flat(C.card, B.base)]}>
                  <Icon
                    name={ok ? "check" : encuadreMal ? "camera" : "bang"} size={24}
                    color={C.ink} strokeWidth={3.4}
                  />
                </View>
                {/* `flexShrink` explícito: en RN el texto no encoge dentro de una
                    fila y en pantallas estrechas se saldría del bloque. */}
                <Text style={[shout(30, onFill(tono)), s.verdictTitle]}>
                  {ok ? "LO LOGRASTE" : encuadreMal ? "REPITE LA FOTO" : "CASI LA TIENES"}
                </Text>
              </View>
              <Text style={s.verdictText}>{result.feedback}</Text>
              {result.mock && (
                <Text style={s.mock}>
                  Modo demostración: el servidor no tiene el detector cargado.
                </Text>
              )}
            </View>
          );
        })()}
      </View>

      <View style={s.resultBody}>
        {encuadreMal && (
          <Card sunken depth={4} contentStyle={s.framingCard}>
            <View style={s.framingHead}>
              <Icon name="camera" size={19} color={C.ink} />
              <Eyebrow>Es la foto, no tu figura</Eyebrow>
            </View>
            <Text style={s.framingText}>{encuadreTexto}</Text>
            <Text style={s.framingHint}>
              No muevas las fichas: puede que ya estuvieran bien.
            </Text>
          </Card>
        )}

        {/* Tu figura sobre el modelo. Si el servidor está en modo demostración
            no manda contornos, y entonces se muestran la foto y el modelo. */}
        {overlay ? (
          <Card contentStyle={s.compare}>
            <Eyebrow style={s.piecesTitle}>Tu figura sobre el modelo</Eyebrow>
            <View style={s.overlay}>
              <Comparison
                detected={result.detected_polygon}
                target={result.target_polygon}
                size={168}
                color={C.cobalto}
              />
            </View>
            <View style={s.legendRow}>
              <View style={s.legendItem}>
                <View style={s.swatchTarget} />
                <Text style={s.compareLabel}>El modelo</Text>
              </View>
              <View style={s.legendItem}>
                <View style={[s.swatchMine, { backgroundColor: C.cobalto }]} />
                <Text style={s.compareLabel}>Lo que armaste</Text>
              </View>
            </View>
          </Card>
        ) : (
          <Card contentStyle={s.compare}>
            <Eyebrow style={s.piecesTitle}>Tu foto y el modelo</Eyebrow>
            <View style={s.compareRow}>
              <View style={s.compareCell}>
                {photo
                  ? <Image source={{ uri: photo }} style={s.compareImg} />
                  : <View style={[s.compareImg, s.compareEmpty]} />}
                <Text style={s.compareLabel}>Lo que armaste</Text>
              </View>
              <View style={s.compareCell}>
                <View style={[s.compareImg, s.compareModel]}>
                  <Silhouette figure={figure} size={100} mode="outline" color={C.ink} />
                </View>
                <Text style={s.compareLabel}>El modelo</Text>
              </View>
            </View>
          </Card>
        )}

        {/* Métricas */}
        <Card style={s.gap} sunken depth={4} contentStyle={s.metrics}>
          <View style={s.metric}>
            <Eyebrow>Parecido</Eyebrow>
            <Text style={[display(28), s.metricValue, tabular]}>{pct(result.iou_score)}</Text>
            <Bar value={result.iou_score} mark={ok ? undefined : threshold} />
            {!ok && <Text style={s.metricHint}>La marca es lo mínimo que necesitas</Text>}
          </View>
          <View style={s.metricSide}>
            <Eyebrow>Tiempo</Eyebrow>
            <Text style={[display(28), s.metricValue, tabular]}>{formatTime(seconds)}</Text>
            {/* «primer» y «tercer» se apocopan delante del sustantivo. */}
            <Text style={s.metricHint}>
              {attempts === 1 || attempts === 3
                ? `${attempts}.er intento`
                : `${attempts}.º intento`}
            </Text>
          </View>
        </Card>

        {/* Revisión del validador: por qué está bien o mal, punto por punto */}
        {checkRows.length > 0 && (
          <Card style={s.gap} contentStyle={s.checksCard}>
            <Eyebrow style={s.piecesTitle}>Revisión de tu armado</Eyebrow>
            {checkRows.map(row => (
              // Verde lo superado, amarillo lo que falta. La marca va sin
              // sombra: son cinco filas seguidas, y cinco sombras en una lista
              // tan corta se leen como ruido. El icono y el detalle escrito
              // dicen cuál es cuál sin depender del color.
              <View key={row.key} style={s.checkRow}>
                <View style={[s.checkMark, flat(row.ok ? C.success : C.warning, 2)]}>
                  <Icon
                    name={row.ok ? "check" : "bang"} size={13}
                    color={C.ink} strokeWidth={3.6}
                  />
                </View>
                <Text style={s.checkLabel} numberOfLines={1}>{row.label}</Text>
                <Text style={[s.checkValue, !row.ok && s.checkValueOff]}>
                  {row.detail}
                </Text>
              </View>
            ))}
            {ok && !checks!.inventory.ok && (
              <Text style={s.checkHint}>
                A la cámara le faltaron fichas por ver, pero tu figura calzó con
                el modelo: cuenta como lograda.
              </Text>
            )}
            {mirrored && (
              <Text style={s.checkHint}>
                Tu figura está en espejo: quedó volteada respecto al modelo.
              </Text>
            )}
          </Card>
        )}

        {/* Fichas detectadas por el modelo */}
        <Card style={s.gap} contentStyle={s.piecesCard}>
          <View style={s.piecesHead}>
            <Eyebrow>Fichas detectadas</Eyebrow>
            {/* `pieces_used` es lo que contó YOLO: con fichas de más dirá
                "9 de 7", que es justo lo que hay que contarle al estudiante. */}
            <Text style={[display(15, C.ink), tabular]}>
              {result.pieces_used} de {TOTAL_PIECES}
            </Text>
          </View>
          <View style={s.piecesRow}>
            {slots.map((slot, i) => (
              <TangramPiece
                key={i} kind={slot.kind} size={34}
                missing={slot.missing}
              />
            ))}
          </View>
          {missingCount > 0 && (
            <View style={s.legend}>
              <View style={s.legendMark} />
              <Text style={s.legendText}>
                La punteada es la que la cámara no encontró: {missingNames}
              </Text>
            </View>
          )}
          {Object.keys(extra).length > 0 && (
            <View style={s.legend}>
              <Text style={s.legendText}>
                Hay fichas de más en la foto. Deja sobre la mesa solo las 7 del Tangram.
              </Text>
            </View>
          )}
        </Card>

        {/* Qué parte revisar: bandas de cobertura del backend. Señalar un tercio
            concreto solo ayuda si el resto de la figura ya calza; con un
            parecido bajo el problema no está en una banda, está en casi todas
            las fichas, y el mismo criterio usa el backend para el mensaje. */}
        {!ok && (checks ? checks.shape.close : true) && result.segments.length > 0 && (
          <Card style={s.gap} contentStyle={s.bandsCard}>
            <Eyebrow style={s.piecesTitle}>Qué parte revisar</Eyebrow>
            <View style={s.bandsRow}>
              <Silhouette
                figure={figure} size={140}
                bands={result.segments.map(seg => bandColor(seg.coverage))}
              />
              <View style={s.bandsList}>
                {result.segments.map(seg => (
                  <View key={seg.label} style={s.band}>
                    {/* El color va en la muestra, nunca en el texto: un amarillo
                        sobre el papel da 1,2:1 y no se lee. La peor banda se
                        destaca con negrita, que sí funciona sobre cualquier
                        fondo y para cualquier vista. */}
                    <View style={[s.bandSwatch, flat(bandColor(seg.coverage), 2)]} />
                    <Text style={[
                      s.bandLabel,
                      seg === worst && s.bandLabelWorst,
                    ]} numberOfLines={1}>
                      {seg.label.replace("Parte de ", "").replace("Parte del ", "")}
                    </Text>
                    <Text style={[display(17, C.ink), tabular]}>
                      {pct(seg.coverage)}
                    </Text>
                  </View>
                ))}
                {worst && (
                  <Text style={s.bandsHint}>
                    Acomoda la {worst.label.toLowerCase()} de tu figura.
                  </Text>
                )}
              </View>
            </View>
          </Card>
        )}

        {/* El intento no llegó al servidor. Va justo encima de las acciones, que
            es donde el estudiante decide seguir: enterarse después de haber
            pasado a la figura siguiente no sirve de nada. Amarillo y no rojo
            porque no hizo nada mal —lo que falló es la red—, y con el botón de
            reintentar al lado, que es lo único que hay que hacer. */}
        {noGuardado && (
          <Card style={s.gap} tone="warning" depth={4} contentStyle={s.saveCard}>
            <View style={s.framingHead}>
              <Icon name="bang" size={19} color={C.ink} strokeWidth={3.2} />
              <Eyebrow color={C.ink}>No se pudo guardar</Eyebrow>
            </View>
            <Text style={s.framingText}>
              Tu resultado se ve bien aquí, pero no llegó al servidor: este
              intento todavía no cuenta en tu progreso.
            </Text>
            <View style={s.saveAction}>
              <SecondaryButton
                label={guardando ? "Guardando…" : "Guardar otra vez"}
                icon="refresh" onPress={reintentarGuardado}
              />
            </View>
          </Card>
        )}

        {/* Acciones: una sola principal */}
        <View style={[s.gap, s.actions]}>
          {ok ? (
            <>
              <PrimaryButton label="Siguiente figura" onPress={onExit} />
              <SecondaryButton label="Armarla otra vez" icon="refresh" onPress={retry} />
            </>
          ) : (
            <>
              <PrimaryButton
                label={encuadreMal ? "Tomar la foto otra vez" : "Acomodar y repetir"}
                icon="camera" onPress={retry}
              />
              <SecondaryButton label="Ver el modelo otra vez" onPress={review} />
            </>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex:      { flex: 1, backgroundColor: C.base },
  dark:      { flex: 1, backgroundColor: C.dark_camera },
  gap:       { marginTop: S.xl },
  center:    { flex: 1, alignItems: "center", justifyContent: "center",
               padding: S.xl, backgroundColor: C.base },

  // Preparar
  prepare:   { paddingHorizontal: S.lg + 4, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM + 20 },
  topRow:    { flexDirection: "row", alignItems: "center", gap: S.md },
  topName:   { marginTop: 2 },
  target:    { height: 300, alignItems: "center", justifyContent: "center" },
  description:{ fontFamily: F.regular, fontSize: 16, lineHeight: 23,
                color: C.ink, marginTop: S.lg },
  strong:    { fontFamily: F.bold },

  piecesCard:{ padding: 16 },
  piecesTitle:{ marginBottom: S.md - 2 },
  piecesHead:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
               marginBottom: 10 },
  piecesRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  pieceCell: { alignItems: "center", gap: 5 },
  pieceCount:{ fontFamily: F.bold, fontSize: 11, color: C.muted },

  permTitle: { marginTop: S.md },
  permText:  { fontFamily: F.regular, fontSize: 14, color: C.muted,
               textAlign: "center", marginTop: 6, lineHeight: 20 },
  permActions:{ alignSelf: "stretch", marginTop: S.xl, gap: 10 },

  // Cámara
  guides:    { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  ghost:     { position: "absolute", left: 0, right: 0,
               alignItems: "center", justifyContent: "center" },
  mask:      { position: "absolute", backgroundColor: "rgba(0,0,0,0.62)" },
  // ── La cámara: la única excepción del sistema ────────────────────────────
  // Aquí manda la foto, y una sombra dura negra necesita un suelo de contraste
  // conocido para leerse: sobre la imagen que enfoque el teléfono, ningún color
  // de sombra es fiable. Así que sobre la cámara el sistema se **invierte**: el
  // papel hace de tinta, los filetes van en crema, y no hay sombras.
  //
  // Las alturas de las dos barras salen de `CAM_TOP` y `CAM_BOTTOM`, que es lo
  // mismo que resta `marcoEncuadre()` para calcular el cuadro de encuadre —y ese
  // cuadro es la región que se manda al servidor a recortar—. Antes el número
  // estaba escrito aquí y allá: cambiar uno y olvidar el otro dejaba al backend
  // analizando una franja distinta de la que vio el niño, sin error visible.
  // Ahora se pueden ajustar, pero solo desde su constante.
  camTop:    { position: "absolute", top: 0, left: 0, right: 0, height: CAM_TOP,
               backgroundColor: C.dark_camera, flexDirection: "row",
               alignItems: "flex-end", gap: S.md, paddingHorizontal: S.lg, paddingBottom: S.md },
  camBack:   { width: 44, height: 44, borderWidth: B.base, borderColor: C.paper,
               alignItems: "center", justifyContent: "center" },
  timer:     { flexDirection: "row", alignItems: "center", gap: 7 },
  // El error de red sí va en rojo, con tinta negra: es una barra opaca, así que
  // aquí el contraste sí es calculable y el color puede hacer su trabajo.
  errorBar:  { position: "absolute", top: 96, left: 0, right: 0,
               backgroundColor: C.danger, borderBottomWidth: B.base,
               borderBottomColor: C.ink, padding: 11 },
  errorBarText:{ fontFamily: F.bold, fontSize: 13, color: C.ink, textAlign: "center" },

  camBottom: { position: "absolute", left: 0, right: 0, bottom: 0, height: CAM_BOTTOM,
               backgroundColor: C.dark_camera, paddingHorizontal: S.lg + 4, paddingTop: 18 },
  hint:      { fontFamily: F.regular, fontSize: 14, lineHeight: 20,
               color: C.paper, textAlign: "center" },
  hintStrong:{ fontFamily: F.bold, color: C.warning },
  camControls:{ flexDirection: "row", alignItems: "center",
                justifyContent: "space-between", marginTop: 18 },
  camCtl:    { width: 56, height: 56, borderWidth: B.base, borderColor: C.paper,
               alignItems: "center", justifyContent: "center" },
  // Encendido: relleno amarillo con filete de tinta. Es el mismo amarillo que
  // significa «en curso» en el resto de la app.
  camCtlOn:  { backgroundColor: C.warning, borderColor: C.ink },
  // El disparador se apoya en la barra opaca de abajo, así que ahí sí hay suelo
  // conocido y puede llevar sombra dura. Pero de color, no negra: una sombra
  // negra sobre un fondo casi negro no se ve.
  shutter:   { width: 82, height: 82, backgroundColor: C.paper,
               borderWidth: B.loud, borderColor: C.ink,
               alignItems: "center", justifyContent: "center",
               boxShadow: `6px 6px 0px ${C.warning}` },

  // Analizando
  previewCard:{ padding: 0 },
  preview:   { width: 220, height: 165 },
  analyzeSpin:{ marginTop: S.xl, marginBottom: S.md },

  // Resultado
  resultScroll:{ paddingBottom: SAFE_BOTTOM + 20, backgroundColor: C.base },
  // El veredicto ya no es una banda a sangre: es una lámina, porque una sombra
  // pegada al borde de la pantalla se corta y deja de leerse como volumen.
  verdictWrap:{ paddingTop: SAFE_TOP, paddingHorizontal: S.lg + 4, paddingBottom: S.sm },
  verdict:   { paddingHorizontal: S.xl - 2, paddingVertical: 22 },
  /** El filete más gordo de la pantalla: es lo que la hace la pieza principal. */
  verdictLoud:{ borderWidth: B.loud },
  verdictRow:{ flexDirection: "row", alignItems: "center", gap: S.md },
  verdictTitle:{ flexShrink: 1 },
  verdictMark:{ width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  // Tinta negra, no gris: va sobre un relleno de color, y el gris de cuerpo se
  // queda por debajo del mínimo de contraste encima de un acento.
  verdictText:{ fontFamily: F.regular, fontSize: 15, lineHeight: 21, marginTop: 14,
                color: C.ink },
  mock:      { fontFamily: F.bold, fontSize: 12, marginTop: 8, color: C.ink },
  resultBody:{ paddingHorizontal: S.lg + 4, paddingTop: S.md },

  compare:   { padding: 16 },
  compareRow:{ flexDirection: "row", gap: S.md },
  compareCell:{ flex: 1 },
  // `R.clip` y no 0: con radio cero, filete y un bitmap hijo que llena la caja,
  // Android deja asomar un píxel de la imagen en las cuatro esquinas.
  compareImg:{ width: "100%", height: 120, borderRadius: R.clip, overflow: "hidden",
               borderWidth: B.hair, borderColor: C.ink,
               alignItems: "center", justifyContent: "center" },
  compareEmpty:{ backgroundColor: C.well },
  compareModel:{ backgroundColor: C.card },
  compareLabel:{ fontFamily: F.bold, fontSize: 12, color: C.ink, marginTop: 8 },

  overlay:   { alignItems: "center", paddingVertical: 6 },
  legendRow: { flexDirection: "row", gap: S.lg + 2, marginTop: S.md },
  legendItem:{ flexDirection: "row", alignItems: "center", gap: 7 },
  swatchTarget:{ width: 18, height: 12, backgroundColor: C.card,
                 borderWidth: 2, borderColor: C.ink, borderStyle: "dashed" },
  // Sólido, sin opacidad: en un estilo de colores planos, la transparencia se
  // lee como suciedad. La muestra coincide con el relleno de `Comparison`.
  swatchMine:{ width: 18, height: 12, backgroundColor: C.cobalto,
               borderWidth: 2, borderColor: C.ink },

  // Sin filete que las separe: las dos cifras se reparten el ancho y las separa
  // el aire, como en el resto de la app.
  metrics:   { flexDirection: "row", alignItems: "stretch", padding: 4 },
  metric:    { flex: 1, padding: 14 },
  metricSide:{ width: 118, padding: 14 },
  metricValue:{ marginTop: 4, marginBottom: 10 },
  metricHint:{ fontFamily: F.regular, fontSize: 12, color: C.muted, marginTop: 8 },

  legend:    { flexDirection: "row", alignItems: "center", gap: S.sm, marginTop: 14,
               paddingTop: 12 },
  legendMark:{ width: 16, height: 16, borderWidth: 2,
               borderColor: C.ink, borderStyle: "dashed" },
  // Frases explicativas, no rótulos: para primaria no bajan de 14.
  legendText:{ flex: 1, fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.ink },

  saveCard:  { padding: 16 },
  saveAction:{ marginTop: 14 },

  framingCard:{ padding: 16 },
  framingHead:{ flexDirection: "row", alignItems: "center", gap: S.sm, marginBottom: 9 },
  framingText:{ fontFamily: F.regular, fontSize: 15, lineHeight: 21, color: C.ink },
  framingHint:{ fontFamily: F.bold, fontSize: 13, lineHeight: 19, color: C.ink,
                marginTop: 7 },

  checksCard:{ padding: 16 },
  checkRow:  { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7 },
  checkMark: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  checkLabel:{ flex: 1, fontFamily: F.regular, fontSize: 14, color: C.ink },
  checkValue:{ fontFamily: F.bold, fontSize: 13, color: C.muted },
  checkValueOff:{ color: C.ink },
  checkHint: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.ink,
               paddingTop: 12, marginTop: 8 },

  bandsCard: { padding: 16 },
  bandsRow:  { flexDirection: "row", alignItems: "center", gap: S.lg },
  bandsList: { flex: 1, gap: 14 },
  band:      { flexDirection: "row", alignItems: "center", gap: 10 },
  bandSwatch:{ width: 14, height: 14 },
  bandLabel: { flex: 1, fontFamily: F.regular, fontSize: 13, color: C.ink,
               textTransform: "capitalize" },
  /** La peor banda se destaca con negrita, nunca con color de texto. */
  bandLabelWorst:{ fontFamily: F.bold },
  bandsHint: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.muted,
               paddingTop: 12 },

  actions:   { gap: 12 },
});
