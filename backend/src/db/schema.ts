/**
 * schema.ts — creación, migración y siembra de la base de datos.
 *
 * Igual que antes, todo ocurre solo en el primer arranque y sobre tablas
 * vacías. Lo que se añade ahora es una **migración de datos personales**: la
 * tabla `users` guardaba nombre y correo en claro, y pasa a guardarlos
 * cifrados, con un índice ciego del correo para que el login siga funcionando.
 *
 * La migración es automática, idempotente y conserva las filas existentes: se
 * detecta si aún hay columnas en claro, se cifran sus valores y se eliminan.
 * Una base ya migrada no vuelve a tocarse.
 */
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { conexionSinBaseDeDatos, pool } from "./pool.js";
import { RONDAS_BCRYPT } from "./users.js";
import { cifrar, indiceCiego } from "../security/crypto.js";
import type { Dificultad, Punto, Rol } from "../types.js";

/**
 * Cuentas de demostración. Su contraseña está aquí escrita a propósito: sirven
 * para probar el sistema en un portátil, no para usarlas de verdad. Quien las
 * siembra (`sembrarUsuarios`) se niega a hacerlo en producción.
 */
const USUARIOS_DEMO: ReadonlyArray<[string, string, string, Rol]> = [
  ["estudiante@tangram.edu", "1234", "Luis García", "student"],
  ["docente@tangram.edu", "1234", "Dra. Martínez", "teacher"],
];

interface FiguraSemilla {
  slug: string;
  name: string;
  emoji: string;
  description: string;
  difficulty: Dificultad;
  category: string;
  enabled: boolean | number;
  yolo_class_id?: number | null;
  silhouette: Punto[];
}

async function asegurarBaseDeDatos(): Promise<void> {
  const conn = await conexionSinBaseDeDatos();
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await conn.end();
  }
}

/** ¿Existe esa columna? Lo usa la migración para saber qué falta. */
async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const [filas] = await pool.query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [config.db.database, tabla, columna],
  );
  return filas.length > 0;
}

/**
 * Crea un índice si no está, y no hace nada si ya está.
 *
 * Hace falta porque `CREATE TABLE IF NOT EXISTS` es todo o nada: si la tabla ya
 * existía —y en cualquier instalación anterior a este cambio existía—, los
 * índices que se añadan después a esa declaración no se crean nunca. El índice
 * quedaba escrito en el código, se leía como si estuviera, y en la base real no
 * había ninguno: el historial de cada estudiante se resolvía recorriendo la
 * tabla entera.
 *
 * MySQL no admite `CREATE INDEX IF NOT EXISTS`, de ahí la consulta previa a
 * `information_schema` —el mismo patrón que `existeColumna`— en vez de lanzar
 * el `CREATE` y tragarse el error, que taparía también los errores de verdad.
 */
async function asegurarIndice(
  tabla: string, nombre: string, columnas: string,
): Promise<void> {
  const [filas] = await pool.query<any[]>(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [config.db.database, tabla, nombre],
  );
  if (filas.length > 0) return;

  // Ni el nombre ni las columnas vienen de fuera —son literales de este
  // archivo—, que es lo que permite interpolarlos: MySQL no admite marcadores
  // `?` para identificadores.
  await pool.query(`CREATE INDEX \`${nombre}\` ON \`${tabla}\` (${columnas})`);
  console.log(`[migración] índice ${nombre} creado sobre ${tabla}(${columnas})`);
}

async function crearTablas(): Promise<void> {
  // `email_hash` es el índice ciego: HMAC del correo, único, y por el que se
  // busca en el login. El correo y el nombre van cifrados en columnas TEXT
  // porque un cifrado en base64 no cabe en el VARCHAR original.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        email_hash    CHAR(64) NOT NULL UNIQUE,
        email_enc     TEXT NOT NULL,
        name_enc      TEXT NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role          ENUM('student','teacher') NOT NULL,
        token_version INT NOT NULL DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        student_id    INT NOT NULL,
        figure_id     VARCHAR(50) NOT NULL,
        match_result  TINYINT(1) NOT NULL,
        iou_score     FLOAT NOT NULL,
        time_seconds  INT NOT NULL DEFAULT 0,
        errors        INT NOT NULL DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sessions_student FOREIGN KEY (student_id)
            REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_sessions_student (student_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS figures (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        slug          VARCHAR(50) NOT NULL UNIQUE,
        name          VARCHAR(100) NOT NULL,
        emoji         VARCHAR(16) NOT NULL,
        description   VARCHAR(255) NOT NULL,
        difficulty    ENUM('Fácil','Medio','Difícil') NOT NULL,
        category      VARCHAR(50) NOT NULL,
        enabled       TINYINT(1) NOT NULL DEFAULT 1,
        yolo_class_id INT NULL,
        silhouette    JSON NOT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Registro de intentos de inicio de sesión. Sostiene el límite por IP y por
  // cuenta; `identifier` guarda la IP o el índice ciego del correo, nunca el
  // correo en claro.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_attempts (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        identifier  VARCHAR(64) NOT NULL,
        kind        ENUM('ip','account') NOT NULL,
        ok          TINYINT(1) NOT NULL DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_attempts (identifier, kind, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/**
 * Índices que tienen que existir aunque la tabla se creara antes de que se
 * declararan.
 *
 * `idx_sessions_student` sostiene las dos consultas que más se piden: el
 * historial de un estudiante y sus estadísticas, las dos con
 * `WHERE student_id = ? ORDER BY created_at DESC`. Sin él, cada vez que un niño
 * abre el catálogo MySQL recorre la tabla de intentos de todo el curso. Como
 * los índices secundarios de InnoDB llevan la clave primaria dentro, este
 * también cubre el desempate por `id` que ordena esas consultas.
 */
async function asegurarIndices(): Promise<void> {
  await asegurarIndice("sessions", "idx_sessions_student", "student_id, created_at");
}

/**
 * Migra una base creada por la versión anterior, que guardaba `email` y `name`
 * en claro.
 *
 * Se hace en una transacción: si algo falla a mitad, la tabla se queda como
 * estaba y no con la mitad de los usuarios cifrados y la otra mitad no.
 */
async function migrarDatosPersonales(): Promise<void> {
  if (!(await existeColumna("users", "email"))) return;   // ya migrada

  console.log("[migración] cifrando nombre y correo de los usuarios…");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (!(await existeColumna("users", "email_hash"))) {
      await conn.query(`ALTER TABLE users
        ADD COLUMN email_hash CHAR(64) NULL,
        ADD COLUMN email_enc  TEXT NULL,
        ADD COLUMN name_enc   TEXT NULL,
        ADD COLUMN token_version INT NOT NULL DEFAULT 0`);
    }

    const [filas] = await conn.query<any[]>("SELECT id, email, name FROM users");
    for (const u of filas) {
      await conn.query(
        "UPDATE users SET email_hash = ?, email_enc = ?, name_enc = ? WHERE id = ?",
        [indiceCiego(u.email), cifrar(u.email), cifrar(u.name), u.id],
      );
    }

    // Las columnas en claro se eliminan: dejarlas «por si acaso» anularía todo
    // el trabajo, porque el dato seguiría legible en la base.
    await conn.query(`ALTER TABLE users
      DROP COLUMN email,
      DROP COLUMN name,
      MODIFY email_hash CHAR(64) NOT NULL,
      MODIFY email_enc  TEXT NOT NULL,
      MODIFY name_enc   TEXT NOT NULL,
      ADD UNIQUE KEY uk_users_email_hash (email_hash)`);

    await conn.commit();
    console.log(`[migración] ${filas.length} usuarios cifrados`);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function contar(tabla: string): Promise<number> {
  const [filas] = await pool.query<any[]>(`SELECT COUNT(*) AS c FROM \`${tabla}\``);
  return Number(filas[0]?.c ?? 0);
}

/**
 * Siembra las cuentas de demostración, y **solo fuera de producción**.
 *
 * Estas dos cuentas existen para poder enseñar el sistema sin dar de alta a
 * nadie, y su contraseña es `1234` justamente porque son eso. Sembrarlas en
 * cualquier base vacía significaba que un despliegue real arrancaba con un
 * docente cuya clave está escrita en el repositorio; el resto del trabajo de
 * autenticación —tokens firmados, bloqueo por intentos, datos cifrados— no
 * protege de nada frente a eso.
 *
 * En producción no se siembra y se dice por consola, porque una base vacía sin
 * explicación se interpreta como que la migración falló.
 */
async function sembrarUsuarios(): Promise<void> {
  if ((await contar("users")) > 0) return;

  if (config.produccion) {
    console.warn(
      "[!] No se sembraron las cuentas de demostración: NODE_ENV=production.\n" +
      "    La tabla `users` está vacía y nadie puede entrar todavía. Crea la\n" +
      "    primera cuenta a mano y cámbiale la contraseña con POST /password.",
    );
    return;
  }

  for (const [email, clave, nombre, rol] of USUARIOS_DEMO) {
    const hash = await bcrypt.hash(clave, RONDAS_BCRYPT);
    await pool.query(
      `INSERT INTO users (email_hash, email_enc, name_enc, password_hash, role)
       VALUES (?, ?, ?, ?, ?)`,
      [indiceCiego(email), cifrar(email), cifrar(nombre), hash, rol],
    );
  }
  console.log("[OK] Usuarios demo creados en MySQL (clave '1234': cámbiala con POST /password)");
}

/**
 * Carga el catálogo de figuras objetivo desde figures_seed.json.
 *
 * Cada figura guarda su silueta de referencia como un polígono normalizado
 * (coordenadas 0..1, relación de aspecto preservada). Esas siluetas se
 * extrajeron del dataset de entrenamiento FigurasArmadas_YOLOv8 tomando, por
 * cada clase, el polígono medoide (el más representativo por IoU).
 */
async function sembrarFiguras(): Promise<void> {
  if ((await contar("figures")) > 0) return;

  let figuras: FiguraSemilla[];
  try {
    figuras = JSON.parse(await fs.readFile(config.figurasSeed, "utf-8"));
  } catch {
    console.warn(`[!] No se pudo leer ${config.figurasSeed}; catálogo de figuras vacío`);
    return;
  }

  for (const f of figuras) {
    await pool.query(
      `INSERT INTO figures
         (slug, name, emoji, description, difficulty, category, enabled,
          yolo_class_id, silhouette)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        f.slug, f.name, f.emoji, f.description, f.difficulty, f.category,
        Number(f.enabled), f.yolo_class_id ?? null, JSON.stringify(f.silhouette),
      ],
    );
  }
  console.log(`[OK] ${figuras.length} figuras cargadas en MySQL`);
}

/** Crea la base, migra lo que haga falta y siembra lo que esté vacío. */
export async function inicializarBaseDeDatos(): Promise<void> {
  await asegurarBaseDeDatos();
  await crearTablas();
  await asegurarIndices();
  await migrarDatosPersonales();
  await sembrarUsuarios();
  await sembrarFiguras();
  console.log(
    `[OK] MySQL conectado (${config.db.host}:${config.db.port}/${config.db.database}` +
    ` como '${config.db.user}')`,
  );
  if (config.db.user === "root") {
    console.warn(
      "[!] Estás conectando como root. Crea un usuario con permisos mínimos:\n" +
      "    mysql -u root -p < backend/sql/crear-usuario.sql",
    );
  }
}
