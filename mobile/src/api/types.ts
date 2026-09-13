export type Role = "student" | "teacher";
export type Difficulty = "Fácil" | "Medio" | "Difícil";

export interface User {
  id:    number;
  name:  string;
  email: string;
  role:  Role;
  /**
   * La cuenta sigue con la clave temporal que le entregó el docente.
   *
   * Mientras valga `true`, el servidor rechaza `/predict` y `/sessions` con un
   * 403: la app no puede jugar aunque se salte la pantalla. Por eso aquí es
   * opcional —un backend anterior no lo manda, y ausente significa «no hace
   * falta cambiarla»—, pero no es solo una ayuda visual: es el aviso de que
   * todo lo demás va a fallar hasta que se cambie.
   */
  must_change_password?: boolean;
}

/** Figura objetivo del catálogo (tabla `figures` en MySQL). */
export interface Figure {
  id:            number;
  slug:          string;
  name:          string;
  emoji:         string;
  description:   string;
  difficulty:    Difficulty;
  category:      string;
  enabled:       boolean;
  yolo_class_id: number | null;
  /** Polígono de la silueta de referencia, normalizado a 0..1. */
  silhouette:    [number, number][];
}

export interface Segment {
  label:    string;
  coverage: number;
}

/** Inventario de fichas detectado por YOLO. */
export interface PieceAnalysis {
  detected: Record<string, number>;
  total:    number;
  missing:  Record<string, number>;
  extra:    Record<string, number>;
  complete: boolean;
}

/**
 * Revisión punto por punto que hace el validador geométrico del backend
 * (`tangram_validator.py`). Es lo que vuelve explicable la calificación: además
 * de un porcentaje, dice qué falla en el armado y por qué.
 */
export interface Checks {
  /** ¿Están las 7 fichas, cada una las veces que corresponde? */
  inventory:    { ok: boolean; counted: number; expected: number };
  /** Fichas montadas una sobre otra: en el Tangram se tocan, pero no se pisan. */
  overlap:      { ok: boolean; fraction: number };
  /**
   * Huecos dentro de la figura. Es la comprobación que una silueta sola no
   * puede dar: si falta una ficha interior el contorno exterior no cambia.
   */
  holes:        { ok: boolean; fraction: number; count: number };
  /** Fichas separadas del cuerpo principal de la figura. */
  connectivity: { ok: boolean; components: number; loose: number };
  /** Parecido de la silueta, con el giro y el espejo que mejor calzaron. */
  shape:        { ok: boolean; close: boolean; iou: number; angle: number; mirrored: boolean };
}

export interface Framing {
  ok:            boolean;
  /** Fracción del cuadro que ocupa la figura (0..1). */
  area_fraction: number;
  /** La figura toca el borde: no cabe entera. */
  touches_edge:  boolean;
  /** El servidor recortó la foto al cuadro que envió la app. */
  cropped:       boolean;
}

export interface PredictResponse {
  figure_detected: string;
  confidence:      number;
  iou_score:       number;
  match:           boolean;
  /**
   * Qué fracción de un Tangram entero alcanzó a ver el detector (1 = las siete
   * fichas) y si alcanzó para calificar.
   *
   * Con `detection_ok` en false **el resto del diagnóstico no se comprobó**:
   * `checks` sale «bien» por vacuidad —dos fichas sueltas nunca se pisan entre
   * sí— y el parecido se calcula sobre una silueta incompleta que el backend
   * normaliza por área, así que se infla hasta el tamaño del modelo. Pintar esas
   * comprobaciones sería afirmar algo que nadie midió.
   *
   * Opcionales porque un backend anterior no los manda; ausentes se tratan como
   * detección suficiente, que es como se comportaba antes.
   */
  coverage?:       number;
  detection_ok?:   boolean;
  /**
   * Acierto mínimo que exige el servidor. Llega en la respuesta para que la
   * marca de la barra sea siempre la del backend, aunque allá se cambie el
   * umbral por variable de entorno.
   */
  match_threshold: number;
  pieces_used:     number;
  pieces:          PieceAnalysis;
  feedback:        string;
  segments:        Segment[];
  /**
   * Contorno que armó el estudiante y silueta objetivo, normalizados a 0..1
   * sobre el mismo lienzo canónico del backend: se superponen tal cual, sin
   * volver a escalarlos ni centrarlos. `detected_polygon` llega vacío si el
   * servidor está en modo demostración o no detectó nada.
   */
  detected_polygon: [number, number][];
  target_polygon:   [number, number][];
  /** Revisión punto por punto del armado. */
  checks:           Checks;
  /**
   * Diagnóstico del encuadre de la foto, no del armado: qué parte del cuadro
   * ocupó la figura, si se salía y si el servidor pudo recortar. Es lo que
   * permite decirle al estudiante «acércate» o «aléjate» en vez de dejarlo
   * moviendo fichas que quizá estaban bien.
   */
  framing:          Framing;
  /** Diagnóstico completo del validador, pensado para el docente. */
  messages:         string[];
  /** Fichas cuyo tamaño no cuadra con su clase (posible error del detector). */
  suspicious_pieces: string[];
  /** Avisos del servidor sobre la foto o el modelo, no sobre el armado. */
  warnings:         string[];
  processing_ms:   number;
  mock:            boolean;
  /**
   * Ruta de la foto guardada en el almacén, para devolverla al registrar el
   * intento en `/sessions`. La app no la lee ni la construye: la pasa tal cual.
   *
   * Opcional porque un backend anterior no la manda, y `null` cuando el almacén
   * está apagado o no pudo guardar la foto. En los dos casos el intento se
   * registra igual, sin imagen.
   */
  image_path?:     string | null;
}

export interface StudentStats {
  total:    number;
  passed:   number;
  avg_iou:  number;
  accuracy: number;
}

/** Fila de la tabla `sessions`: un intento de un estudiante sobre una figura. */
export interface Session {
  id:           number;
  student_id:   number;
  figure_id:    string;
  match_result: number;
  iou_score:    number;
  time_seconds: number;
  errors:       number;
  created_at:   string;
}
