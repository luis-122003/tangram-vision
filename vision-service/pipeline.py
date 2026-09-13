"""
pipeline.py — puente entre el detector, el validador geométrico y la API.

Reemplaza al antiguo `vision.py`. El cambio de fondo es de arquitectura:

  ANTES   YOLOv8-seg (piezas)  +  U-Net/ResNet34 (silueta)
          → IoU de la máscara del U-Net contra la silueta objetivo, tolerando
            solo 4 giros de 90° y el espejo.

  AHORA   YOLOv8-seg (piezas)  →  tangram_validator (geometría determinista)
          → inventario de las 7 fichas, solape, huecos interiores, fichas
            sueltas, coherencia de áreas y comparación de siluetas con giro
            continuo.

El U-Net desaparece: su única salida era la silueta de la figura, y esa silueta
sale mejor de la unión de las máscaras de las piezas que ya detecta YOLO —sin
280 MB de pesos, sin TensorFlow y sin un segundo modelo que entrenar—. Lo que el
U-Net no podía dar de ninguna manera es *por qué* está mal un armado: una máscara
no sabe que falta el cuadrado ni que hay dos fichas montadas. Eso lo aporta el
validador, y es lo que el estudiante necesita leer.

Aquí solo queda la traducción entre ambos mundos: las clases del detector, el
vocabulario que ya usa la app y el JSON de `/analyze`.
"""
from __future__ import annotations

import random

import cv2
import numpy as np

import tangram_validator as tv

# ─── Vocabulario ────────────────────────────────────────────────────────────────
# El validador nombra las fichas en español (`triangulo_grande`); la app y la
# base de datos usan las clases del modelo YOLO (`large_tri`). La traducción vive
# solo aquí para no tocar ninguno de los dos lados.
PIEZA_A_CLAVE: dict[str, str] = {
    tv.TRIANGULO_GRANDE:  "large_tri",
    tv.TRIANGULO_MEDIANO: "medium_tri",
    tv.TRIANGULO_PEQUENO: "small_tri",
    tv.CUADRADO:          "square",
    tv.ROMBOIDE:          "parallelogram",
}

PIECE_INVENTORY: dict[str, int] = {
    PIEZA_A_CLAVE[p]: n for p, n in tv.INVENTARIO_CANONICO.items()
}
TOTAL_PIECES = sum(PIECE_INVENTORY.values())      # 7

PIECE_LABEL_ES: dict[str, str] = {
    "large_tri":     "triángulo grande",
    "medium_tri":    "triángulo mediano",
    "small_tri":     "triángulo pequeño",
    "square":        "cuadrado",
    "parallelogram": "romboide",
}

#: En «triángulo pequeño» el plural cae en las dos palabras, no en la última.
PIECE_LABEL_ES_PLURAL: dict[str, str] = {
    "large_tri":     "triángulos grandes",
    "medium_tri":    "triángulos medianos",
    "small_tri":     "triángulos pequeños",
    "square":        "cuadrados",
    "parallelogram": "romboides",
}

#: Clases que el validador sabe traducir, en cualquiera de sus dos taxonomías.
CLASES_CONOCIDAS = set(tv.TAXONOMIA_5) | set(tv.TAXONOMIA_7)


# ─── Detecciones ────────────────────────────────────────────────────────────────
def desde_yolo(resultado, umbral_confianza: float = 0.0) -> tuple[list[tv.Deteccion], list[str]]:
    """Convierte la salida de YOLOv8-seg en detecciones del validador.

    Devuelve también los avisos que haya que contarle al docente (clases que el
    validador no conoce, o un modelo sin máscaras). No lanza: una foto mala tiene
    que acabar en una respuesta que explique el problema, no en un error 500.
    """
    avisos: list[str] = []
    masks = getattr(resultado, "masks", None)
    boxes = getattr(resultado, "boxes", None)

    if masks is None or masks.xy is None or boxes is None or len(boxes) == 0:
        if masks is None and boxes is not None and len(boxes):
            avisos.append(
                "El modelo cargado no devuelve máscaras: se necesita YOLOv8-seg "
                "(segmentación), no uno de solo detección."
            )
        return [], avisos

    nombres = dict(getattr(resultado, "names", {}) or {})
    detecciones: list[tv.Deteccion] = []
    desconocidas: set[str] = set()

    for poligono, caja in zip(masks.xy, boxes):
        confianza = float(caja.conf.item())
        if confianza < umbral_confianza:
            continue
        clase = nombres.get(int(caja.cls.item()), str(int(caja.cls.item())))
        if clase not in CLASES_CONOCIDAS:
            desconocidas.add(clase)
            continue
        poly = np.asarray(poligono, dtype=np.float64).reshape(-1, 2)
        if len(poly) < 3:
            continue
        detecciones.append(tv.Deteccion(clase=clase, poligono=poly, confianza=confianza))

    if desconocidas:
        avisos.append(
            "El detector devolvió clases que el validador no reconoce y se "
            f"ignoraron: {', '.join(sorted(desconocidas))}."
        )
    return detecciones, avisos


def descartar_duplicados(detecciones: list[tv.Deteccion], umbral: float = 0.6) -> list[tv.Deteccion]:
    """Funde las detecciones que caen sobre la misma ficha física.

    No es lo mismo que `quedarse_con_las_mejores` del validador: aquella recorta
    el inventario a 7 y con ello escondería una ficha de más que sí está sobre la
    mesa. Aquí solo se quita el ruido del detector —dos cajas sobre la misma
    ficha—, medido por cuánto se pisan; dos fichas iguales pero separadas siguen
    contando como dos, que es justo lo que hay que decirle al estudiante.

    Se funden también detecciones de **clases distintas**, y esa es la parte que
    no es evidente: el modelo del proyecto tiene una clase por color
    (`large_tri_orange`, `large_tri_green`, `small_tri_red`, `small_tri_blue`…),
    así que una misma ficha física con un reflejo encima puede salir dos veces
    con dos etiquetas. Mientras solo se fundían las de la misma clase, esas dos
    cajas sobrevivían las dos y un Tangram perfecto se reprobaba con un 20% de
    solape y un «Hay fichas de más en la foto» por una ficha que sobre la mesa
    solo existe una vez. Como la lista va ordenada por confianza, la que se
    conserva es siempre la detección más confiable de las dos.
    """
    if len(detecciones) < 2:
        return list(detecciones)

    ordenadas = sorted(detecciones, key=lambda d: d.confianza, reverse=True)
    conservadas: list[tv.Deteccion] = []
    for cand in ordenadas:
        area_cand = cand.area
        if area_cand <= 0:
            continue
        repetida = False
        for guardada in conservadas:
            inter, _ = cv2.intersectConvexConvex(
                cv2.convexHull(guardada.poligono.astype(np.float32)),
                cv2.convexHull(cand.poligono.astype(np.float32)),
            )
            if inter / min(area_cand, guardada.area or area_cand) > umbral:
                repetida = True
                break
        if not repetida:
            conservadas.append(cand)
    return conservadas


# ─── Encuadre de la foto ────────────────────────────────────────────────────────
#: Fracción del recuadro que debe ocupar la figura para que las fichas se vean.
#: Por debajo de esto el detector trabaja con fichas de pocos píxeles y empieza a
#: perderlas: es el caso de la foto tomada demasiado lejos.
AREA_MINIMA_FIGURA = 0.10

#: Margen del borde: si la figura lo toca, es que no cabe entera en el recuadro.
MARGEN_BORDE = 0.015


def recortar(img: np.ndarray, crop: list[float] | None) -> tuple[np.ndarray, bool, list[str]]:
    """Recorta la foto al recuadro que el estudiante vio en la pantalla.

    Las figuras armadas son grandes, así que el niño tiene que alejar el teléfono
    y la figura acaba ocupando una parte pequeña del encuadre. Como YOLO reescala
    la imagen entera a `imgsz`, esas fichas llegan al detector con muy pocos
    píxeles. Recortando al recuadro, la figura vuelve a ocupar casi todo el
    fotograma y las fichas recuperan tamaño sin pedirle al niño que se acerque.

    `crop` viene de la app como [x, y, ancho, alto] normalizados a 0..1 sobre la
    foto. Devuelve (imagen, se_recorto, avisos).
    """
    if not crop:
        return img, False, []
    if len(crop) != 4:
        return img, False, ["El recuadro recibido no tiene 4 valores; se usó la foto completa."]

    h, w = img.shape[:2]
    x0 = int(round(max(0.0, min(1.0, crop[0])) * w))
    y0 = int(round(max(0.0, min(1.0, crop[1])) * h))
    x1 = int(round(max(0.0, min(1.0, crop[0] + crop[2])) * w))
    y1 = int(round(max(0.0, min(1.0, crop[1] + crop[3])) * h))

    # Un recorte diminuto casi siempre significa que el cálculo de la app se
    # equivocó; es mejor perder el recorte que perder la figura.
    if x1 - x0 < w * 0.2 or y1 - y0 < h * 0.2:
        return img, False, ["El recuadro recibido era demasiado pequeño; se usó la foto completa."]
    return img[y0:y1, x0:x1], True, []


def analizar_encuadre(img: np.ndarray, recortada: bool) -> dict:
    """¿Cabe la figura en el cuadro y se ve lo bastante grande?

    Se mide sobre los píxeles de la foto, **no** sobre lo que detectó el modelo,
    y la razón es justamente que hace falta cuando el detector falla: si se
    midiera con las fichas detectadas, una foto bien encuadrada de la que el
    modelo solo reconoce dos fichas parecería «tomada de lejos», y el estudiante
    recibiría un consejo equivocado sobre algo que hizo bien.

    Las fichas del Tangram son de acrílico saturado y se arman sobre una hoja
    clara, así que la figura es la zona con color de la imagen. Es el mismo
    criterio con el que se etiquetó el dataset de piezas del proyecto (S > 60,
    V > 25), que ahí se verificó contra las 91 fotos reales.

    Sin zona de color no se opina: se devuelve `ok` y área 0, y del problema se
    encarga el resto del análisis.
    """
    base = {"ok": True, "area_fraction": 0.0, "touches_edge": False, "cropped": recortada}
    if img is None or img.size == 0:
        return base
    alto, ancho = img.shape[:2]
    if alto < 8 or ancho < 8:
        return base

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    color = ((hsv[:, :, 1] > 60) & (hsv[:, :, 2] > 25)).astype(np.uint8)
    color = cv2.morphologyEx(color, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    total = float(alto * ancho)
    n, _, stats, _ = cv2.connectedComponentsWithStats(color, connectivity=8)
    # Se descartan las motas: un reflejo o una raya del mantel no son una ficha.
    manchas = [stats[i] for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > total * 0.002]
    if not manchas:
        return base

    area = sum(int(m[cv2.CC_STAT_AREA]) for m in manchas) / total
    x0 = min(int(m[cv2.CC_STAT_LEFT]) for m in manchas)
    y0 = min(int(m[cv2.CC_STAT_TOP]) for m in manchas)
    x1 = max(int(m[cv2.CC_STAT_LEFT] + m[cv2.CC_STAT_WIDTH]) for m in manchas)
    y1 = max(int(m[cv2.CC_STAT_TOP] + m[cv2.CC_STAT_HEIGHT]) for m in manchas)

    toca = bool(x0 <= ancho * MARGEN_BORDE or y0 <= alto * MARGEN_BORDE
                or x1 >= ancho * (1.0 - MARGEN_BORDE)
                or y1 >= alto * (1.0 - MARGEN_BORDE))
    return {
        "ok":            area >= AREA_MINIMA_FIGURA and not toca,
        "area_fraction": round(float(area), 4),
        "touches_edge":  toca,
        "cropped":       recortada,
    }


def _sin_fichas(figura: dict) -> tv.ResultadoValidacion:
    """Resultado para una foto en la que el detector no encontró nada.

    El validador da por hecho que hay al menos una ficha (una lista vacía no
    tiene silueta, ni área, ni componentes). Ese caso se resuelve aquí y no allí,
    porque no es un armado mal hecho sino una foto que no se pudo leer.
    """
    conteo = {p: 0 for p in tv.INVENTARIO_CANONICO}
    inventario = tv.ResultadoInventario(
        completo=False, conteo=conteo, faltantes=dict(tv.INVENTARIO_CANONICO),
        sobrantes={}, total_detectadas=0,
    )
    return tv.construir_resultado(
        figura.get("name", figura.get("slug", "?")),
        inventario,
        tv.ResultadoSolape(area_union=0.0, area_suma=0.0, fraccion_solapada=0.0, hay_solape=False),
        tv.ResultadoHuecos(fraccion_hueco=0.0, hay_huecos=False, n_huecos=0),
        tv.ResultadoConectividad(n_componentes=0, fraccion_cuerpo_principal=0.0, hay_sueltas=False),
        [],
        None,
        avisos=["No se detectó ninguna ficha en la foto."],
        cobertura=0.0,
    )


def validar(
    detecciones: list[tv.Deteccion],
    figura: dict,
    exigir_inventario: bool = True,
) -> tuple[tv.ResultadoValidacion, np.ndarray | None, np.ndarray]:
    """Valida un armado real. Devuelve (resultado, silueta del alumno, objetivo)."""
    objetivo = np.asarray(figura["silhouette"], dtype=np.float64)
    if not detecciones:
        return _sin_fichas(figura), None, objetivo

    resultado = tv.validar_configuracion(
        detecciones, figura, exigir_inventario=exigir_inventario
    )
    # La silueta no se vuelve a calcular: es la misma que `validar_configuracion`
    # acaba de unir para medir la IoU, y unirla otra vez costaba un segundo
    # rasterizado de las 7 máscaras por cada foto. Viene en `None` cuando no se
    # pudo formar, y el motivo ya viaja explicado en `resultado.mensajes`.
    return resultado, resultado.silueta, objetivo


# ─── Modo demostración ──────────────────────────────────────────────────────────
# Una respuesta simulada trae `match: true`, un IoU alto, una confianza plausible
# y `framing.ok: true` sobre una foto que nadie miró. El único indicio era el
# campo `mock`, que hay que ir a buscar al final del JSON, y el aviso enmarcado
# del arranque, que solo se ve en la consola del servidor: nadie que mire la
# pantalla de la app —ni quien esté probando la API con curl— tiene por qué
# darse cuenta de que el detector no está cargado. Estos dos textos ponen el
# aviso donde sí se lee: en la lista de avisos y en la frase que ve el
# estudiante.
AVISO_MOCK = (
    "MODO DEMOSTRACIÓN: el detector no está cargado. Esta respuesta no sale de "
    "tu foto; sus cifras están simuladas y no califican nada. Revisa "
    "YOLO_WEIGHTS en vision-service/.env."
)
PREFIJO_MOCK = "MODO DEMOSTRACIÓN: esta respuesta no sale de tu foto. "


def _perturbar(poly: np.ndarray, ruido: float) -> np.ndarray:
    """Deforma un poco una silueta, como un armado hecho a mano."""
    escala = np.abs(poly.max(axis=0) - poly.min(axis=0)).max() or 1.0
    temblor = np.array([[random.uniform(-ruido, ruido) * escala for _ in range(2)]
                        for _ in range(len(poly))])
    girado = tv._rotar(poly - poly.mean(axis=0), random.uniform(-25.0, 25.0))
    return girado * random.uniform(0.9, 1.1) + temblor


def validacion_simulada(figura: dict) -> tuple[tv.ResultadoValidacion, np.ndarray, np.ndarray]:
    """Resultado de mentira para cuando el detector no está cargado.

    Se parte de la propia silueta objetivo, se deforma y se la hace pasar por el
    mismo comparador que usaría una foto real. Así la demostración es coherente
    consigo misma —el porcentaje, las bandas y el dibujo hablan de la misma
    figura— en vez de enseñar números al azar.

    Esa coherencia es justo lo que la hace peligrosa, así que la respuesta no se
    marca solo con `mock: true`: `construir_respuesta` le añade `AVISO_MOCK` a
    los avisos y `PREFIJO_MOCK` a la frase del estudiante.
    """
    objetivo = np.asarray(figura["silhouette"], dtype=np.float64)
    silueta = _perturbar(objetivo, ruido=random.uniform(0.005, 0.09))
    comparacion = tv.comparar_siluetas(silueta, objetivo)

    conteo = {p: n for p, n in tv.INVENTARIO_CANONICO.items()}
    inventario = tv.ResultadoInventario(
        completo=True, conteo=conteo, faltantes={}, sobrantes={},
        total_detectadas=TOTAL_PIECES,
    )
    resultado = tv.construir_resultado(
        figura.get("name", figura.get("slug", "?")),
        inventario,
        tv.ResultadoSolape(area_union=1.0, area_suma=1.0, fraccion_solapada=0.0, hay_solape=False),
        tv.ResultadoHuecos(fraccion_hueco=0.0, hay_huecos=False, n_huecos=0),
        tv.ResultadoConectividad(n_componentes=1, fraccion_cuerpo_principal=1.0, hay_sueltas=False),
        [],
        comparacion,
    )
    return resultado, silueta, objetivo


# ─── Retroalimentación ──────────────────────────────────────────────────────────
def _lista_fichas(cuenta: dict[str, int]) -> str:
    partes = []
    for pieza, n in cuenta.items():
        clave = PIEZA_A_CLAVE[pieza]
        nombre = PIECE_LABEL_ES_PLURAL[clave] if n > 1 else PIECE_LABEL_ES[clave]
        partes.append(f"{n} {nombre}")
    return ", ".join(partes)


def feedback(resultado: tv.ResultadoValidacion, segmentos: list[dict],
             sin_detecciones: bool = False, encuadre: dict | None = None) -> str:
    """Una sola frase, en el lenguaje de un niño de primaria.

    El validador produce el diagnóstico completo (`resultado.mensajes`), pero una
    lista de seis observaciones no se lee a los ocho años. Aquí se elige el
    problema más importante y se dice qué hacer con él; el resto viaja en
    `checks` y la app lo muestra como una lista de revisión.
    """
    if sin_detecciones:
        return ("No alcancé a ver tus fichas. Toma la foto desde arriba, con buena "
                "luz y con la figura completa dentro del cuadro.")

    if resultado.es_correcta:
        return "¡Excelente! Tu figura quedó igual que la del modelo."

    # El encuadre va antes que cualquier otra cosa: si la figura no cabe en el
    # cuadro o salió diminuta, todo lo que venga después se midió sobre una foto
    # que no sirve, y pedirle al niño que mueva fichas seria mandarlo a corregir
    # algo que quizá está bien.
    if encuadre is not None:
        if encuadre["touches_edge"]:
            return ("Tu figura no cabe completa en el cuadro. Aléjate un poco y "
                    "vuelve a tomar la foto con toda la figura dentro.")
        if encuadre["area_fraction"] and encuadre["area_fraction"] < AREA_MINIMA_FIGURA:
            return ("Tu figura salió muy pequeña para verla bien. Acércate un "
                    "poco, sin que se salga del cuadro, y tómala otra vez.")

    inv = resultado.inventario
    if inv.faltantes:
        return (f"Te falta colocar: {_lista_fichas(inv.faltantes)}. "
                "Revisa que uses las 7 fichas.")
    if inv.sobrantes:
        return ("Hay fichas de más en la foto. Deja sobre la mesa solo las 7 "
                "fichas del Tangram.")
    if resultado.conectividad.hay_sueltas:
        return ("Tienes fichas separadas del resto. Júntalas todas para que "
                "formen una sola figura.")
    if resultado.solape.hay_solape:
        return ("Hay fichas montadas una encima de otra. En el Tangram las "
                "fichas se tocan, pero no se pisan.")
    if resultado.huecos.hay_huecos:
        return ("Quedaron espacios vacíos dentro de tu figura. Junta bien las "
                "fichas hasta que no se vea la mesa entre ellas.")

    if resultado.puntaje < 0.3:
        return ("Tu figura se ve muy distinta a la del modelo. Míralo otra vez "
                "con calma e inténtalo de nuevo.")
    if resultado.comparacion is not None and resultado.comparacion.reflejada:
        return ("Tu figura está al revés, como en un espejo. Voltea el romboide "
                "y acomoda las fichas hacia el otro lado.")
    # Señalar una banda concreta ("revisa la parte de arriba") solo tiene sentido
    # cuando el resto de la figura ya calza. Con un parecido bajo el problema no
    # está en un tercio: está en cómo se repartieron casi todas las fichas.
    if resultado.puntaje < tv.UMBRAL_IOU_CASI:
        return ("Tu figura se parece un poco, pero varias fichas quedaron en otro "
                "lugar. Compárala con el modelo y vuelve a acomodarlas.")

    peor = min(segmentos, key=lambda s: s["coverage"]) if segmentos else None
    if peor and peor["coverage"] < 0.9:
        return f"Vas muy bien, pero revisa la {peor['label'].lower()} de tu figura."
    return "¡Casi! Acomoda un poquito las fichas para que el contorno calce mejor."


# ─── Respuesta de /analyze ──────────────────────────────────────────────────────
def _inventario_para_app(inv: tv.ResultadoInventario) -> dict:
    return {
        "detected": {PIEZA_A_CLAVE[p]: n for p, n in inv.conteo.items() if n},
        "total":    inv.total_detectadas,
        "missing":  {PIEZA_A_CLAVE[p]: n for p, n in inv.faltantes.items()},
        "extra":    {PIEZA_A_CLAVE[p]: n for p, n in inv.sobrantes.items()},
        "complete": inv.completo,
    }


def comparar_con_unet(
    img: np.ndarray,
    silueta_objetivo: np.ndarray,
    iou_oficial: float,
) -> dict:
    """Segunda opinión sobre la misma foto, con el U-Net en vez de YOLO.

    No califica: la nota del estudiante sale siempre de la unión de las máscaras
    del detector. Esto contesta una pregunta distinta —¿cuál de las dos formas de
    obtener la silueta se acerca más a la figura objetivo?— y por eso viaja en un
    bloque aparte de `checks`, sin tocar nada de lo que pintan los clientes.

    Nunca lanza: que el U-Net falle no puede dejar sin respuesta a un niño que ya
    armó su figura. El motivo del fallo viaja en `error`.
    """
    import time

    import unet_silueta

    t0 = time.time()
    bloque = {"available": False, "iou": None, "angle": 0.0, "mirrored": False,
              "delta": None, "ms": 0, "error": None}
    try:
        silueta = unet_silueta.silueta_unet(img)
        comparacion = tv.comparar_siluetas(silueta, silueta_objetivo)
        bloque.update(
            available=True,
            iou=round(float(comparacion.iou), 4),
            angle=round(float(comparacion.angulo), 1),
            mirrored=bool(comparacion.reflejada),
            # Positivo: el U-Net encontró más parecido que la unión de máscaras.
            # Es la cifra que hay que promediar sobre un lote de fotos para
            # decidir si el segundo modelo aportaba algo.
            delta=round(float(comparacion.iou) - float(iou_oficial), 4),
        )
    except Exception as e:                          # incluye fallos de TensorFlow
        bloque["error"] = f"{type(e).__name__}: {e}"

    bloque["ms"] = int((time.time() - t0) * 1000)
    return bloque


def construir_respuesta(
    resultado: tv.ResultadoValidacion,
    silueta_alumno: np.ndarray | None,
    silueta_objetivo: np.ndarray,
    figura: dict,
    confianza: float,
    es_mock: bool,
    avisos: list[str],
    tiempo_ms: int,
    encuadre: dict | None = None,
    unet: dict | None = None,
) -> dict:
    """Arma el JSON que consume la app móvil."""
    comparacion = resultado.comparacion
    contorno_alumno: list[list[float]] = []
    contorno_objetivo: list[list[float]] = []
    segmentos: list[dict] = []

    if comparacion is not None and silueta_alumno is not None:
        # Cada dibujo va en su propio `try` porque son dos cálculos
        # independientes: el contorno superpuesto y la cobertura por bandas.
        # Compartiendo uno solo, un fallo al medir las bandas borraba los
        # contornos que ya se habían obtenido bien, y el estudiante se quedaba
        # sin ver su figura encima del modelo por un problema que no era suyo.
        try:
            contorno_alumno, contorno_objetivo = tv.siluetas_superpuestas(
                silueta_alumno, silueta_objetivo, comparacion
            )
        except (ValueError, cv2.error):
            contorno_alumno, contorno_objetivo = [], []
        try:
            segmentos = tv.cobertura_por_bandas(
                silueta_alumno, silueta_objetivo, comparacion
            )
        except (ValueError, cv2.error):
            segmentos = []

    if not segmentos:
        segmentos = [{"label": etiqueta, "coverage": 0.0}
                     for etiqueta in tv.ETIQUETAS_BANDAS]

    sin_detecciones = resultado.inventario.total_detectadas == 0
    piezas = _inventario_para_app(resultado.inventario)

    texto = feedback(resultado, segmentos, sin_detecciones, encuadre)
    if es_mock:
        # El aviso se pone delante de todo lo demás: es lo primero que hay que
        # saber sobre esta respuesta, y va en los dos sitios que se leen de
        # verdad (la lista de avisos y la frase del estudiante).
        avisos = [AVISO_MOCK] + list(avisos)
        texto = PREFIJO_MOCK + texto

    return {
        "figure_detected": figura.get("name", figura.get("slug", "?")),
        "confidence":      round(float(confianza), 3),
        "iou_score":       round(float(resultado.puntaje), 3),
        "match":           bool(resultado.es_correcta),
        # Cuánto Tangram se alcanzó a ver, y si alcanzó para calificar. Con
        # `detection_ok` en false, el resto del diagnóstico no se comprobó:
        # el cliente tiene que decir que la foto no se pudo leer, no dar por
        # buenas las comprobaciones que salen «bien» por vacuidad.
        "coverage":        round(float(resultado.cobertura), 3),
        "detection_ok":    bool(resultado.deteccion_suficiente),
        "match_threshold": tv.UMBRAL_IOU_CORRECTA,
        "pieces_used":     piezas["total"],
        "pieces":          piezas,
        "feedback":        texto,
        "segments":        segmentos,
        "detected_polygon": contorno_alumno,
        "target_polygon":  contorno_objetivo,
        # Lo que el U-Net no podía decir: qué falla exactamente en el armado.
        # La app lo pinta como una lista de revisión, marca por marca.
        "checks": {
            "inventory": {
                "ok":      resultado.inventario.completo,
                "counted": piezas["total"],
                "expected": TOTAL_PIECES,
            },
            "overlap": {
                "ok":       not resultado.solape.hay_solape,
                "fraction": round(resultado.solape.fraccion_solapada, 4),
            },
            "holes": {
                "ok":       not resultado.huecos.hay_huecos,
                "fraction": round(resultado.huecos.fraccion_hueco, 4),
                "count":    resultado.huecos.n_huecos,
            },
            "connectivity": {
                "ok":         not resultado.conectividad.hay_sueltas,
                "components": resultado.conectividad.n_componentes,
                "loose":      max(0, resultado.conectividad.n_componentes - 1),
            },
            "shape": {
                "ok":       resultado.puntaje >= tv.UMBRAL_IOU_CORRECTA,
                "close":    resultado.puntaje >= tv.UMBRAL_IOU_CASI,
                "iou":      round(float(resultado.puntaje), 4),
                "angle":    round(comparacion.angulo, 1) if comparacion else 0.0,
                "mirrored": bool(comparacion.reflejada) if comparacion else False,
            },
        },
        # El encuadre no es un fallo del armado —el niño puede haberlo hecho
        # perfecto y haber tomado la foto de lejos—, así que va aparte de
        # `checks` y la app lo muestra como un consejo sobre la foto.
        "framing": encuadre if encuadre is not None else {
            "ok": True, "area_fraction": 0.0, "touches_edge": False, "cropped": False,
        },
        # Segunda opinión del U-Net sobre la misma foto, cuando está habilitado.
        # Va fuera de `checks` a propósito: no participa en la calificación y
        # ningún cliente lo pinta. Existe para poder medir, sobre las fotos del
        # proyecto, si el modelo que se retiró aportaba algo que la unión de las
        # máscaras de YOLO no diera ya.
        "unet": unet if unet is not None else {"available": False},
        # Diagnóstico completo del validador: la app lo deja para el docente,
        # pero es lo que hace explicable la calificación.
        "messages":          resultado.mensajes,
        "suspicious_pieces": resultado.areas_sospechosas,
        "warnings":          avisos,
        "processing_ms":     tiempo_ms,
        "mock":              es_mock,
    }
