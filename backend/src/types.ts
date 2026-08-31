/** Tipos del dominio, alineados con las tablas de MySQL. */

export type Rol = "student" | "teacher";

export type Dificultad = "Fácil" | "Medio" | "Difícil";

/**
 * Fila cruda de `users`, tal como está en la base: el nombre y el correo van
 * cifrados y no se pueden leer sin pasar por `security/crypto`.
 */
export interface UsuarioFila {
  id: number;
  email_hash: string;
  email_enc: string;
  name_enc: string;
  password_hash: string;
  role: Rol;
  /**
   * Se incrementa al cerrar sesión en todos los dispositivos o al cambiar la
   * contraseña. Un token emitido con una versión anterior deja de valer, que es
   * lo que permite revocar sin mantener una lista de tokens vivos.
   */
  token_version: number;
  created_at: Date;
}

/** Usuario ya descifrado, que es con lo que trabaja el resto del backend. */
export interface Usuario {
  id: number;
  email: string;
  name: string;
  role: Rol;
  password_hash: string;
  token_version: number;
}

/** Punto de una silueta, normalizado a 0..1 sobre el lienzo de la figura. */
export type Punto = [number, number];

export interface Figura {
  id: number;
  slug: string;
  name: string;
  emoji: string;
  description: string;
  difficulty: Dificultad;
  category: string;
  enabled: boolean;
  yolo_class_id: number | null;
  /**
   * Polígono de referencia de la figura. Se extrajo del dataset de
   * entrenamiento tomando, por cada clase, el contorno medoide (el más
   * representativo por IoU frente a los demás ejemplos).
   */
  silhouette: Punto[];
  created_at: Date;
}

export interface Sesion {
  id: number;
  student_id: number;
  figure_id: string;
  match_result: number;
  iou_score: number;
  time_seconds: number;
  errors: number;
  created_at: Date;
}

/** Fila del dashboard docente: la sesión con los datos del estudiante. */
export interface SesionConEstudiante extends Sesion {
  student_name: string;
  student_email: string;
}
