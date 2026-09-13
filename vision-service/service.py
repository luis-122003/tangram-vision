"""
service.py — servicio de visión de Tangram IA.

Es la única parte del sistema que no está en Node.js, y lo es a propósito: aquí
viven el detector y `tangram_validator.py`, que es geometría calibrada con
`--autotest` y `--calibrar`. Reescribirla en otro lenguaje cambiaría los números
que sostienen la evaluación del proyecto sin aportar nada a cambio.

Pipeline (idéntico al del backend anterior):

  Foto del Tangram físico armado
    └─> YOLOv8s-seg : detecta y segmenta las 7 fichas (large_tri, medium_tri,
                      small_tri, square, parallelogram).
    └─> tangram_validator : con las fichas ya localizadas, decide por geometría
                      determinista si el armado es correcto —inventario de las 7
                      fichas, fichas montadas, huecos interiores, fichas sueltas,
                      coherencia de áreas— y compara la silueta contra la figura
                      objetivo con giro continuo y espejo.

Lo que cambió respecto de `main.py`: este servicio **no habla con MySQL**. La
figura objetivo (su nombre y su silueta de referencia) llega dentro de la
petición, porque quien la lee de la base de datos es ahora el backend Node. Así
no hay dos servicios con credenciales de base de datos ni dos copias de la capa
de acceso a datos que mantener sincronizadas.

Tampoco hay autenticación: este servicio es interno y no debe quedar expuesto a
Internet. Quien autentica al estudiante es el backend Node.

Si los pesos del detector no están, el servicio sigue respondiendo en modo
demostración (`"mock": true`) para poder desarrollar sin bloquear. Esas
respuestas van marcadas también en `warnings` y en `feedback`: son verosímiles
de más como para dejar el aviso solo en un campo al final del JSON.
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator
import base64
import binascii
import cv2
import numpy as np
import threading
import time
import random
import os
import sys
from dotenv import load_dotenv

import pipeline
import tangram_validator as tv

# ─── Configuración ──────────────────────────────────────────────────────────────
# Todo se resuelve contra la carpeta de este archivo y no contra el directorio
# actual. Lanzando `uvicorn service:app` desde la raíz del repo —que es como lo
# hace medio mundo— no se leía el .env ni se encontraban los pesos, y el
# servicio arrancaba en modo demostración sin que nada en la línea de comandos
# lo delatara: las respuestas seguían llegando, con cifras verosímiles.
BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")


def _ruta(valor: str) -> Path:
    """Una ruta del .env, anclada al servicio salvo que venga absoluta."""
    ruta = Path(valor.strip()).expanduser()
    return ruta if ruta.is_absolute() else BASE_DIR / ruta


def _numero(nombre: str, por_defecto: float, minimo: float, maximo: float,
            entero: bool = False) -> float:
    """Lee un número del .env y, si no lo es, dice exactamente qué tocar.

    Antes esto era `float(os.environ.get(...))` a pelo, y una coma decimal o un
    comentario pegado al valor tumbaban el servicio **al importarlo**, con un
    `ValueError: could not convert string to float` que no nombra ni la variable
    ni el archivo. Ese error hay que leerlo en la consola de otra persona, así
    que tiene que decir dónde está el fallo.
    """
    crudo = os.environ.get(nombre)
    crudo = por_defecto if crudo is None or not crudo.strip() else crudo.strip()
    try:
        valor = int(crudo) if entero else float(crudo)
    except (TypeError, ValueError):
        raise SystemExit(
            f"[!!] {nombre}='{crudo}' en {BASE_DIR / '.env'} no es un número"
            f"{' entero' if entero else ''} válido. Usa punto decimal, sin comillas"
            " ni comentarios en la misma línea."
        )
    if not minimo <= valor <= maximo:
        raise SystemExit(
            f"[!!] {nombre}={valor} en {BASE_DIR / '.env'} está fuera de rango "
            f"(se espera entre {minimo} y {maximo})."
        )
    return valor


YOLO_WEIGHTS = _ruta(os.environ.get("YOLO_WEIGHTS", "models/tangram_piezas_seg_best.pt"))
YOLO_CONF    = _numero("YOLO_CONF", 0.35, 0.0, 1.0)
# Resolución a la que YOLO reescala la foto. Las figuras armadas son grandes, así
# que el niño fotografía de lejos y cada ficha ocupa pocos píxeles: con los 640
# de fábrica se perdían. 960 recupera ese detalle a cambio de algo de tiempo.
YOLO_IMGSZ   = int(_numero("YOLO_IMGSZ", 960, 64, 4096, entero=True))

# Umbrales del validador. Se pueden mover sin tocar el código: el valor de
# fábrica sale de `tangram_validator --calibrar` sobre el catálogo de figuras.
#
# Viven aquí y no en el backend Node, ni viajan dentro de cada petición, por una
# razón concreta: `tangram_validator` los guarda en variables de módulo. Fijarlos
# por petición haría que dos fotos analizadas a la vez se pisaran los umbrales.
MATCH_IOU  = _numero("MATCH_IOU", tv.UMBRAL_IOU_CORRECTA, 0.0, 1.0)
CLOSE_IOU  = _numero("CLOSE_IOU", tv.UMBRAL_IOU_CASI, 0.0, 1.0)
REQUIRE_INVENTORY = os.environ.get("REQUIRE_INVENTORY", "1") not in ("0", "false", "False")

# El orden de los dos umbrales no es un detalle de estilo: CLOSE_IOU es el «vas
# bien, ajusta» y MATCH_IOU el «correcta». Al revés, la banda intermedia se
# vuelve inalcanzable y el JSON se contradice solo —`shape.ok` en true con
# `shape.close` en false—, sin que nada avise.
if MATCH_IOU < CLOSE_IOU:
    raise SystemExit(
        f"[!!] MATCH_IOU ({MATCH_IOU}) es menor que CLOSE_IOU ({CLOSE_IOU}) en "
        f"{BASE_DIR / '.env'}. MATCH_IOU es el acierto mínimo para aprobar y "
        "CLOSE_IOU el que activa el «vas bien»: el primero tiene que ser mayor "
        "o igual que el segundo."
    )

tv.UMBRAL_IOU_CORRECTA = MATCH_IOU
tv.UMBRAL_IOU_CASI     = CLOSE_IOU

# El U-Net/ResNet34 que antes producía la silueta. Apagado por defecto: no
# califica ni puede calificar —su salida es una máscara— y encenderlo cuesta
# TensorFlow, ~15 s de arranque y ~190 ms por foto. Se enciende para *medir*:
# con UNET_ENABLED=1 cada respuesta trae, en un bloque `unet` aparte, el IoU que
# habría dado su silueta frente al que da la unión de las máscaras de YOLO. Es
# lo que convierte «se retiró porque no aportaba» en un número comprobable.
UNET_ENABLED = os.environ.get("UNET_ENABLED", "0") not in ("0", "false", "False", "")

yolo_model = None
unet_cargado = False

# ultralytics guarda estado dentro del propio objeto del modelo entre llamadas,
# así que dos peticiones que lo usen a la vez se pisan. Hasta ahora no se notaba
# porque el `async def` de `/analyze` serializaba el servicio entero: la
# seguridad venía de un accidente, no de una decisión. Ahora que las peticiones
# corren de verdad en paralelo (ver el comentario del endpoint), el candado es lo
# que la sostiene. Solo cubre `predict`: la geometría posterior no toca el modelo
# y puede seguir repartiéndose entre hilos.
_candado_yolo = threading.Lock()


def _arrancar() -> None:
    """Carga los modelos. Se llama una vez, desde el `lifespan` de abajo."""
    global yolo_model, unet_cargado

    # La consola de Windows va en cp1252 y no sabe escribir las tildes de los
    # mensajes de abajo. Sin esto, un `print` puede reventar el arranque con
    # UnicodeEncodeError en la máquina de otra persona.
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    try:
        from ultralytics import YOLO
        # Se comprueba el archivo antes de pedirlo: si `YOLO_WEIGHTS` apunta a un
        # nombre que no existe, ultralytics intenta **descargar** un modelo de
        # fábrica con ese nombre y el error que devuelve habla de la red, no del
        # .env, que es donde está el fallo de verdad.
        if not YOLO_WEIGHTS.is_file():
            raise FileNotFoundError(f"no existe el archivo de pesos '{YOLO_WEIGHTS}'")
        yolo_model = YOLO(str(YOLO_WEIGHTS))
        clases = list((getattr(yolo_model, "names", {}) or {}).values())
        print(f"[OK] YOLOv8s-seg cargado · clases: {clases}")
        desconocidas = [c for c in clases if c not in pipeline.CLASES_CONOCIDAS]
        if desconocidas:
            print(f"[!] Clases que el validador no traduce: {desconocidas}")
    except Exception as e:
        # El modo demostración devuelve cifras verosímiles, y por eso es fácil
        # trabajar horas contra él sin notarlo. El aviso va enmarcado y dice qué
        # tocar: es la diferencia entre «el sistema no compara» y «el .env
        # apunta a un archivo que no está».
        print("=" * 72)
        print(f"[!!] MODO DEMOSTRACIÓN: el detector NO se cargó · {e}")
        print("     Las respuestas llevarán \"mock\": true y sus cifras son")
        print("     simuladas: no salen de la foto del estudiante.")
        print(f"     Revisa YOLO_WEIGHTS en vision-service/.env (ahora: {YOLO_WEIGHTS})")
        print("=" * 72)

    print(f"[OK] Validador geométrico listo · acierto ≥ {tv.UMBRAL_IOU_CORRECTA:.0%}"
          f" · inventario {'obligatorio' if REQUIRE_INVENTORY else 'informativo'}")
    # La comparación de siluetas no es un modelo: es geometría determinista. Se
    # dice en el arranque porque el U-Net que hacía este trabajo sigue en
    # `models/` y su presencia hace pensar que falta activarlo.
    print("[OK] Comparación de siluetas: geométrica (giro continuo + espejo), sin pesos")

    if UNET_ENABLED:
        # Se carga aquí y no en la primera foto: son ~15 s, y pagarlos con un
        # niño esperando delante de la cámara sería peor que pagarlos al
        # arrancar. Si falla, el servicio sigue: el U-Net no califica.
        try:
            import unet_silueta
            unet_silueta.cargar()
            unet_cargado = True
            print("[OK] U-Net/ResNet34 cargado · segunda opinión activa (bloque \"unet\")")
            print("     No califica: la nota sigue saliendo de la unión de máscaras de YOLO.")
        except Exception as e:
            print(f"[!] U-Net habilitado pero no se pudo cargar: {type(e).__name__}: {e}")


# ─── La aplicación ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Carga los modelos **antes** de aceptar la primera petición.

    Va en el `lifespan` y no en la primera foto porque los pesos del detector
    tardan unos segundos: pagarlos con un niño esperando delante de la cámara
    sería peor que pagarlos al arrancar. Y es también lo que hace que `/health`
    diga la verdad desde el primer momento —el script `dev.ps1` lo consulta nada
    más levantar los servicios—.
    """
    _arrancar()
    yield


app = FastAPI(title="Tangram IA · servicio de visión", lifespan=lifespan)


# ─── Esquemas ───────────────────────────────────────────────────────────────────
class FiguraObjetivo(BaseModel):
    """La figura contra la que se compara, tal como la guarda MySQL.

    Llega en la petición en vez de leerse de la base de datos: el backend Node es
    el dueño del catálogo. `silhouette` es el polígono de referencia normalizado
    (0..1) que se extrajo del dataset de entrenamiento.
    """
    slug:       str
    name:       str
    silhouette: list[list[float]]


class AnalyzeRequest(BaseModel):
    image_b64: str
    figure:    FiguraObjetivo
    # Recuadro que el estudiante vio en la pantalla, como [x, y, ancho, alto]
    # normalizados sobre la foto. La app lo calcula a partir del marco que dibuja
    # encima de la cámara; el servidor recorta ahí antes de detectar, para que la
    # figura ocupe el fotograma aunque la foto se haya tomado de lejos.
    crop:      list[float] | None = None


class AnalyzeResponse(BaseModel):
    figure_detected: str
    confidence:      float
    iou_score:       float
    match:           bool
    # Cuánto Tangram se alcanzó a ver, y si alcanzó para calificar. Tienen que
    # estar declarados aquí: `response_model` descarta cualquier clave que el
    # modelo no declare, así que sin estas dos líneas `construir_respuesta` los
    # calcula y FastAPI los tira, y el cliente nunca puede decir «no pude leer
    # la foto» —pinta las comprobaciones que salen «bien» por vacuidad—.
    # El valor por defecto es el de una detección completa, para que una
    # respuesta sin estos campos no se lea como foto ilegible.
    coverage:        float = 1.0
    detection_ok:    bool = True
    # Acierto mínimo exigido. Viaja en la respuesta para que la marca de la
    # barra en la app sea siempre la del servidor, aunque el umbral se cambie
    # por variable de entorno.
    match_threshold: float
    pieces_used:     int
    pieces:          dict
    feedback:        str
    segments:        list
    # Contorno que el estudiante armó y silueta objetivo, ambos normalizados a
    # 0..1 sobre el mismo lienzo: la app los superpone para mostrar dónde se
    # separó del modelo. `detected_polygon` va vacío si no hubo detección.
    detected_polygon: list[list[float]] = []
    target_polygon:   list[list[float]] = []
    # Revisión punto por punto del armado (fichas, montadas, huecos, sueltas,
    # forma). Es lo que hace explicable la calificación.
    checks:           dict = {}
    # Diagnóstico del encuadre: qué parte del cuadro ocupa la figura, si se sale
    # y si se recortó la foto. Es lo que permite decir «acércate» o «aléjate».
    framing:          dict = {}
    # Segunda opinión del U-Net, solo con UNET_ENABLED=1. No califica: es el IoU
    # que habría dado su silueta sobre la misma foto, para poder contrastarlo
    # con el de la unión de máscaras de YOLO. `{"available": false}` cuando el
    # modelo está apagado, que es el modo normal.
    unet:             dict = {}
    messages:         list[str] = []
    suspicious_pieces: list[str] = []
    warnings:         list[str] = []
    processing_ms:   int
    mock:            bool


# ─── Preprocesamiento ───────────────────────────────────────────────────────────
def decode_image(b64_str: str) -> np.ndarray | None:
    if "," in b64_str:
        b64_str = b64_str.split(",")[1]
    arr = np.frombuffer(base64.b64decode(b64_str), np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


# ─── Endpoint principal ─────────────────────────────────────────────────────────
@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    t0 = time.time()

    img = decode_image(req.image_b64)
    if img is None:
        raise HTTPException(status_code=422, detail="Imagen inválida")

    # `pipeline` espera la figura como el dict que devolvía MySQL, y solo usa de
    # él `name`, `slug` y `silhouette`: son exactamente los tres campos que
    # manda Node, así que no hace falta adaptar nada más.
    figure = req.figure.model_dump()

    es_mock = yolo_model is None
    avisos: list[str] = []
    encuadre: dict | None = None
    unet: dict | None = None

    if es_mock:
        # Sin detector no hay fichas que analizar: se simula un armado imperfecto
        # a partir de la propia silueta objetivo y se le hace recorrer el mismo
        # comparador que una foto real.
        resultado, silueta, objetivo = pipeline.validacion_simulada(figure)
        confianza = 0.72 + random.random() * 0.2
    else:
        def detectar(imagen):
            det = yolo_model.predict(source=imagen, conf=YOLO_CONF,
                                     imgsz=YOLO_IMGSZ, max_det=30, verbose=False)
            piezas, avs = pipeline.desde_yolo(det[0]) if det else ([], [])
            piezas = pipeline.descartar_duplicados(piezas)
            # `descartar_duplicados` quita las cajas que se pisan, pero no ve los
            # dos fallos que el detector comete con las fichas de cuatro lados:
            # parte el romboide por su diagonal en dos triangulos pequenos, y
            # cuando si acierta el cuadrilatero duda entre cuadrado y romboide
            # con confianzas de 0.48. Medido sobre las 114 fotos reales, esto
            # lleva el inventario correcto de 0 a 98 de 114.
            return tv.reparar_cuadrilateros(piezas), avs

        recorte, recortada, avisos = pipeline.recortar(img, req.crop)
        detecciones, avs = detectar(recorte)
        avisos += avs

        # Salvaguarda: si dentro del recuadro no se vio nada pero en la foto
        # completa sí, el recorte estaba mal (la app calcula el recuadro a partir
        # del encuadre de la pantalla, que no siempre coincide con el del sensor).
        # Antes de darle un «no vi tus fichas» a un niño que sí las armó, se
        # reintenta con la foto entera.
        if recortada and not detecciones:
            detecciones, avs = detectar(img)
            if detecciones:
                recorte, recortada = img, False
                avisos.append("Las fichas quedaron fuera del recuadro: se analizó la foto completa.")
            avisos += avs

        confianza = (sum(d.confianza for d in detecciones) / len(detecciones)
                     if detecciones else 0.0)
        try:
            resultado, silueta, objetivo = pipeline.validar(
                detecciones, figure, exigir_inventario=REQUIRE_INVENTORY
            )
        except Exception as e:                      # geometría degenerada, foto ilegible…
            raise HTTPException(status_code=500, detail=f"No se pudo validar la figura: {e}")
        encuadre = pipeline.analizar_encuadre(recorte, recortada)

        # Segunda opinión del U-Net sobre **la misma imagen que vio YOLO** —el
        # recorte si lo hubo—, porque si cada modelo mirara un encuadre distinto
        # la diferencia entre sus IoU no diría nada sobre los modelos.
        if unet_cargado:
            unet = pipeline.comparar_con_unet(recorte, objetivo, resultado.puntaje)

    return pipeline.construir_respuesta(
        resultado=resultado,
        silueta_alumno=silueta,
        silueta_objetivo=objetivo,
        figura=figure,
        confianza=confianza,
        es_mock=es_mock,
        avisos=avisos,
        tiempo_ms=int((time.time() - t0) * 1000),
        encuadre=encuadre,
        unet=unet,
    )


@app.get("/health")
async def health():
    return {
        "status":      "ok",
        "yolo_loaded": yolo_model is not None,
        # Cual archivo, no solo si hay alguno. En models/ conviven el detector
        # nuevo y el anterior, y los dos son yolov8s-seg: `models_loaded` dice
        # lo mismo para ambos y `yolo_loaded` sale True igual. Arrancar con el
        # que no es no produce ningun aviso, y sus cifras son verosimiles.
        "yolo_weights": YOLO_WEIGHTS.name if yolo_model is not None else None,
        # El validador es geometría pura: no tiene pesos que cargar y por eso
        # siempre está listo. Se informa igual para que la pantalla de ajustes
        # de la app móvil muestre las dos etapas del pipeline.
        "validator_ready":   True,
        "match_threshold":   tv.UMBRAL_IOU_CORRECTA,
        "require_inventory": REQUIRE_INVENTORY,
        # Los dos campos siguientes existen para responder de una vez a la
        # pregunta que se repite al mirar `models/`: allí hay un U-Net de 98 MB
        # y parece que el sistema debería estar usándolo. No es así, y su
        # ausencia no es una avería. La comparación de la figura armada contra
        # la silueta objetivo la hace `tangram_validator.comparar_siluetas`
        # —centroide, área, barrido continuo de giro y espejo—, sin pesos.
        # Un `models_loaded` con un solo elemento lo deja por escrito en cada
        # comprobación de estado, en vez de solo en un README que hay que abrir.
        "shape_matching": "geometric",
        "models_loaded":  (["yolov8s-seg"] if yolo_model is not None else [])
                          + (["unet-resnet34"] if unet_cargado else []),
        # El U-Net, cuando está encendido, no entra en `models_loaded` como si
        # calificara: aparece ahí porque está cargado, y este campo aclara para
        # qué. Su IoU viaja en el bloque `unet` de cada respuesta.
        "unet_enabled": UNET_ENABLED,
        "unet_loaded":  unet_cargado,
        "unet_role":    "second_opinion" if unet_cargado else None,
    }
