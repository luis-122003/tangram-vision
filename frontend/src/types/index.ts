// ─── Usuarios ──────────────────────────────────────────────────────────────────
export type Role = "student" | "teacher";

export interface User {
  id:    number;
  name:  string;
  email: string;
  role:  Role;
}

/**
 * Estudiante tal como lo lista el panel del docente (`GET /students`).
 *
 * Trae el progreso junto a los datos de la cuenta porque es lo que se mira a la
 * vez: el docente no abre esta pantalla para administrar usuarios, la abre para
 * saber quién ya entró y quién sigue sin estrenar su clave.
 */
export interface Student {
  id:    number;
  name:  string;
  email: string;
  /** Sigue con la clave temporal: todavía no ha activado su perfil. */
  must_change_password: boolean;
  created_at:   string;
  attempts:     number;
  passed:       number;
  last_attempt: string | null;
}

/**
 * Respuesta de un alta o de un reseteo de clave.
 *
 * `temporary_password` llega **una sola vez**, en esta respuesta. El servidor
 * solo guarda su hash, así que no hay ninguna otra forma de volver a verlo: si
 * se pierde, hay que generar otro. La interfaz tiene que enseñarlo de forma que
 * el docente pueda anotarlo antes de cerrar el aviso.
 */
export interface StudentCreated {
  /**
   * Puede llegar `null`: entre la escritura de la clave y la relectura de la
   * fila cabe que otro docente diera de baja a ese estudiante. Es raro, pero la
   * pantalla que muestra la clave no puede ser la que se caiga por ello: es la
   * única vez que ese valor existe fuera del hash.
   */
  student: Student | null;
  temporary_password: string;
  detail: string;
}

// ─── Figuras del catálogo ──────────────────────────────────────────────────────
export type Difficulty = "Fácil" | "Medio" | "Difícil";
export type Category   = "Animales" | "Objetos" | "Personas";

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

// ─── Predicción (/predict) ──────────────────────────────────────────────────────
export interface Segment {
  label:    string;
  coverage: number;
}

export interface PredictRequest {
  image_b64:  string;
  figure_id:  string;
  student_id: number;
}

/** Análisis del inventario de piezas detectado por YOLO. */
export interface PieceAnalysis {
  detected: Record<string, number>;
  total:    number;
  missing:  Record<string, number>;
  extra:    Record<string, number>;
  complete: boolean;
}

/**
 * Revisión punto por punto del armado, hecha por el validador geométrico del
 * backend (`tangram_validator.py`). Es lo que explica la calificación: además
 * del porcentaje, dice qué falla y por qué.
 */
export interface Checks {
  inventory:    { ok: boolean; counted: number; expected: number };
  overlap:      { ok: boolean; fraction: number };
  holes:        { ok: boolean; fraction: number; count: number };
  connectivity: { ok: boolean; components: number; loose: number };
  shape:        { ok: boolean; close: boolean; iou: number; angle: number; mirrored: boolean };
}

/**
 * Diagnóstico del encuadre de la foto (no del armado): qué parte del cuadro
 * ocupa la figura, si se sale y si el servidor recortó al cuadro que le mandó
 * la app. Se mide sobre los píxeles de la foto, no sobre lo detectado.
 */
export interface Framing {
  ok:            boolean;
  area_fraction: number;
  touches_edge:  boolean;
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
   * normaliza por área, así que se infla hasta el tamaño del modelo.
   *
   * Opcionales porque un backend anterior no los manda; ausentes se tratan como
   * detección suficiente, que es como se comportaba antes.
   */
  coverage?:       number;
  detection_ok?:   boolean;
  /** Acierto mínimo exigido por el servidor (configurable con MATCH_IOU). */
  match_threshold: number;
  pieces_used:     number;
  pieces:          PieceAnalysis;
  feedback:        string;
  segments:        Segment[];
  detected_polygon: [number, number][];
  target_polygon:   [number, number][];
  checks:           Checks;
  framing:          Framing;
  /** Diagnóstico completo del validador, pensado para el docente. */
  messages:         string[];
  suspicious_pieces: string[];
  warnings:         string[];
  processing_ms:   number;
  mock:            boolean;
}

// ─── Sesión / intento ──────────────────────────────────────────────────────────
export interface SessionRecord {
  userId:   number;
  figureId: string;
  time:     number;
  errors:   number;
  match:    boolean;
  iou:      number;
  ts:       string;
}

export interface SessionRow {
  id:            number;
  student_id:    number;
  student_name:  string;
  student_email: string;
  figure_id:     string;
  match_result:  0 | 1;
  iou_score:     number;
  time_seconds:  number;
  errors:        number;
  created_at:    string;
}

// ─── Estadísticas del estudiante ────────────────────────────────────────────────
export interface StudentStats {
  total:    number;
  passed:   number;
  avg_iou:  number;
  accuracy: number;
}
