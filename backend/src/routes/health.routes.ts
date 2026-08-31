/**
 * health.routes.ts — estado del sistema completo.
 *
 * Queda **sin autenticar** a propósito: la pantalla de ajustes de la app móvil
 * la usa para comprobar la dirección del servidor antes de que el estudiante
 * inicie sesión. Protegerla convertiría "la IP está mal" en "credenciales
 * incorrectas", que es justo el diagnóstico que esa pantalla existe para
 * distinguir.
 *
 * Por eso mismo no dice nada que no deba: ni versiones, ni rutas, ni nombres de
 * base de datos. Solo si cada pieza responde. Las métricas de consultas van
 * aparte, en `/health/metrics`, y esas sí son del docente.
 */
import { Router } from "express";
import { baseDeDatosViva, metricas } from "../db/pool.js";
import { estado } from "../vision/client.js";
import { exigirDocente, exigirSesion } from "../auth/middleware.js";

export const rutasSalud = Router();

/**
 * Caché de la última respuesta, con su marca de tiempo.
 *
 * `/health` es la única ruta pública y la más barata de pedir desde fuera, pero
 * no de servir: cada llamada abre una conexión a MySQL y hace una petición al
 * servicio de visión. Sin caché, un bucle contra esta URL arrastra a los dos
 * servicios de detrás, y ni siquiera hace falta mala fe —basta una pantalla de
 * diagnóstico que sondee sola—.
 *
 * Cinco segundos, y no más: la pantalla de ajustes de la app móvil usa esta
 * ruta para que el estudiante compruebe la dirección del servidor, y si al
 * arrancar el servicio de visión la respuesta siguiera diciendo «caído» durante
 * medio minuto, el diagnóstico engañaría en vez de ayudar. Es tiempo suficiente
 * para absorber una ráfaga y lo bastante corto para que «vuelve a probar» siga
 * significando algo.
 */
const CACHE_MS = 5000;
let cacheSalud: { en: number; cuerpo: Record<string, unknown> } | null = null;

rutasSalud.get("/health", async (_req, res) => {
  const ahora = Date.now();
  if (cacheSalud && ahora - cacheSalud.en < CACHE_MS) {
    res.json(cacheSalud.cuerpo);
    return;
  }

  const [db_connected, vision] = await Promise.all([baseDeDatosViva(), estado()]);

  const cuerpo = {
    status: "ok",
    yolo_loaded: vision.yolo_loaded,
    // El validador es geometría pura: no tiene pesos que cargar. Se informa
    // igual para que la app muestre las dos etapas del pipeline.
    validator_ready: vision.validator_ready,
    db_connected,
    match_threshold: vision.match_threshold,
    /** Permite distinguir "el detector está caído" de "MySQL lo está". */
    vision_connected: vision.validator_ready,
    /**
     * Cómo se compara la figura armada con la de ejemplo, y qué modelos hay
     * cargados de verdad. No es adorno: sin esto, la única forma de saber que
     * la comparación no usa pesos era leer el código del servicio de visión.
     */
    shape_matching: vision.shape_matching ?? null,
    models_loaded: vision.models_loaded ?? [],
  };

  cacheSalud = { en: ahora, cuerpo };
  res.json(cuerpo);
});

/**
 * Métricas de la base de datos, para vigilar cómo se está usando.
 *
 * Es información de operación —cuántas consultas van, cuántas se están yendo de
 * tiempo, cuántas fallan—, así que se reserva al docente. Un pico de consultas
 * lentas o de errores suele ser el primer síntoma de un índice que falta o de
 * alguien barriendo la API.
 */
rutasSalud.get("/health/metrics", exigirSesion, exigirDocente, (_req, res) => {
  const { consultas, lentas, errores, msTotal } = metricas;
  res.json({
    consultas,
    lentas,
    errores,
    ms_promedio: consultas > 0 ? Math.round(msTotal / consultas) : 0,
    uptime_s: Math.round(process.uptime()),
    memoria_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});
