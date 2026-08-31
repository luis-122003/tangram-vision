"""
tangram_validator.py
====================

Validacion de configuraciones de Tangram.

Responde dos preguntas sobre la foto de una figura armada por un estudiante:

  1. ¿Se usaron las 7 fichas del Tangram, cada una una sola vez?
  2. ¿La figura armada coincide con la figura objetivo que se le pidio armar?

El modulo NO entrena ni ejecuta redes neuronales: recibe las piezas ya
detectadas (por el modelo YOLOv8-seg del proyecto) y hace el resto con
geometria determinista. Eso lo vuelve explicable -- puede decir *que* pieza
falta o *cuanto* esta girada la figura -- y no necesita datos de entrenamiento.

Dependencias: numpy y opencv (opencv-python-headless). Nada mas.

Uso rapido
----------
    # Comprobacion interna, sin modelo ni fotos:
    python tangram_validator.py --autotest

    # Sobre una foto real:
    python tangram_validator.py --imagen foto.jpg --figura cat \
        --pesos models/tangram_piezas_seg_best.pt --figuras data/figures_seed.json

Desde Python:
    from tangram_validator import cargar_figuras, desde_ultralytics, validar_configuracion

    figuras = cargar_figuras("data/figures_seed.json")
    resultado = validar_configuracion(desde_ultralytics(yolo_result), figuras["cat"])
    print(resultado.resumen())
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import cv2
import numpy as np

# ============================================================================
# 1. Las 7 fichas del Tangram
# ============================================================================

TRIANGULO_GRANDE = "triangulo_grande"
TRIANGULO_MEDIANO = "triangulo_mediano"
TRIANGULO_PEQUENO = "triangulo_pequeno"
CUADRADO = "cuadrado"
ROMBOIDE = "romboide"

#: Cuantas fichas de cada tipo tiene un Tangram completo.
INVENTARIO_CANONICO: dict[str, int] = {
    TRIANGULO_GRANDE: 2,
    TRIANGULO_MEDIANO: 1,
    TRIANGULO_PEQUENO: 2,
    CUADRADO: 1,
    ROMBOIDE: 1,
}

#: Area de cada ficha en unidades de "triangulo pequeno".
#: El Tangram completo suma 16 unidades.
AREA_RELATIVA: dict[str, float] = {
    TRIANGULO_GRANDE: 4.0,
    TRIANGULO_MEDIANO: 2.0,
    TRIANGULO_PEQUENO: 1.0,
    CUADRADO: 2.0,
    ROMBOIDE: 2.0,
}

AREA_TOTAL_UNIDADES = sum(AREA_RELATIVA[p] * n for p, n in INVENTARIO_CANONICO.items())  # 16

#: Los identificadores de arriba van sin tildes porque son claves: viajan a
#: `pipeline.PIEZA_A_CLAVE` y romperlos desincronizaria la traduccion. Estos
#: nombres, en cambio, se le leen al estudiante dentro de los mensajes, asi que
#: aqui si se escriben como se escriben en espanol.
NOMBRE_BONITO: dict[str, str] = {
    TRIANGULO_GRANDE: "triángulo grande",
    TRIANGULO_MEDIANO: "triángulo mediano",
    TRIANGULO_PEQUENO: "triángulo pequeño",
    CUADRADO: "cuadrado",
    ROMBOIDE: "romboide",
}

# --- Taxonomias del detector -------------------------------------------------
# El proyecto tiene dos juegos de clases. Ambos se traducen a las 5 fichas
# canonicas de arriba, que es lo unico que importa para validar el inventario.

TAXONOMIA_7 = {  # dataset tangram_piezas_dataset (una clase por ficha fisica)
    "large_tri_orange": TRIANGULO_GRANDE,
    "large_tri_green": TRIANGULO_GRANDE,
    "medium_tri_red": TRIANGULO_MEDIANO,
    "small_tri_red": TRIANGULO_PEQUENO,
    "small_tri_blue": TRIANGULO_PEQUENO,
    "square_yellow": CUADRADO,
    "parallelogram_cyan": ROMBOIDE,
}

TAXONOMIA_5 = {  # taxonomia geometrica
    "large_tri": TRIANGULO_GRANDE,
    "medium_tri": TRIANGULO_MEDIANO,
    "small_tri": TRIANGULO_PEQUENO,
    "square": CUADRADO,
    "parallelogram": ROMBOIDE,
}


def resolver_taxonomia(nombres: Iterable[str]) -> dict[str, str]:
    """Elige automaticamente la taxonomia segun los nombres de clase presentes."""
    nombres = set(nombres)
    if nombres & set(TAXONOMIA_7):
        return TAXONOMIA_7
    if nombres & set(TAXONOMIA_5):
        return TAXONOMIA_5
    raise ValueError(
        f"No reconozco las clases {sorted(nombres)}. Amplia TAXONOMIA_5 / TAXONOMIA_7."
    )


# --- Geometria canonica (Tangram inscrito en el cuadrado unitario) -----------
# Sirve para pruebas y para dibujar la solucion. Coordenadas en [0,1]x[0,1].

def _p(*pts) -> np.ndarray:
    return np.asarray(pts, dtype=np.float64) / 4.0


PIEZAS_CANONICAS: list[tuple[str, np.ndarray]] = [
    (TRIANGULO_GRANDE, _p((0, 0), (4, 0), (2, 2))),
    (TRIANGULO_GRANDE, _p((0, 0), (2, 2), (0, 4))),
    (TRIANGULO_MEDIANO, _p((4, 2), (4, 4), (2, 4))),
    (TRIANGULO_PEQUENO, _p((0, 4), (2, 4), (1, 3))),
    (TRIANGULO_PEQUENO, _p((3, 1), (4, 0), (4, 2))),
    (CUADRADO, _p((1, 3), (2, 2), (3, 3), (2, 4))),
    (ROMBOIDE, _p((2, 2), (3, 1), (4, 2), (3, 3))),
]

# ============================================================================
# 2. Umbrales (calibrables)
# ============================================================================

UMBRAL_IOU_CORRECTA = 0.85   # >= esto: la figura se da por correcta
UMBRAL_IOU_CASI = 0.70       # entre casi y correcta: "vas bien, ajusta"
UMBRAL_SOLAPE = 0.05         # fraccion de area solapada tolerada entre fichas
UMBRAL_HUECO = 0.04          # fraccion de hueco interior tolerada
UMBRAL_AREA = 0.45           # desviacion relativa tolerada en el area de una ficha


def umbrales_efectivos() -> tuple[float, float]:
    """Los umbrales con los que califica el servicio, no los de fabrica.

    `service.py` arranca leyendo MATCH_IOU/CLOSE_IOU de vision-service/.env y los
    escribe encima de las dos constantes de arriba. Las herramientas de linea de
    comandos (--autotest, --calibrar) se ejecutan sin pasar por el servicio, asi
    que si leyeran las constantes estarian midiendo 0.85 mientras en el aula se
    califica con 0.75: justo el numero que la tesis usa para justificar el
    umbral seria el que no se usa. Se replica aqui el mismo mecanismo.

    El .env se busca junto a este archivo y no en el directorio actual, para que
    los umbrales sean los mismos se lance la herramienta desde donde se lance.
    python-dotenv es opcional a proposito: sin el, el modulo sigue necesitando
    solo numpy y opencv y se cae de vuelta a las variables de entorno ya puestas.
    """
    import os
    from pathlib import Path

    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parent / ".env")
    except ImportError:
        pass

    def leer(nombre: str, por_defecto: float) -> float:
        crudo = os.environ.get(nombre)
        if crudo is None or not crudo.strip():
            return por_defecto
        try:
            return float(crudo)
        except ValueError:
            print(f"[!] {nombre}='{crudo}' no es un numero; se usa {por_defecto}")
            return por_defecto

    return leer("MATCH_IOU", UMBRAL_IOU_CORRECTA), leer("CLOSE_IOU", UMBRAL_IOU_CASI)


def _aplicar_umbrales_efectivos() -> tuple[float, float]:
    """Deja las constantes del modulo en los valores con los que se califica.

    Se hace desde las herramientas de CLI y no al importar: el servicio ya se
    encarga de fijarlas, y un modulo que lee archivos del disco solo por ser
    importado seria una sorpresa desagradable para quien lo use desde un
    notebook.
    """
    global UMBRAL_IOU_CORRECTA, UMBRAL_IOU_CASI
    UMBRAL_IOU_CORRECTA, UMBRAL_IOU_CASI = umbrales_efectivos()
    return UMBRAL_IOU_CORRECTA, UMBRAL_IOU_CASI

# ============================================================================
# 3. Estructuras de datos
# ============================================================================


@dataclass
class Deteccion:
    """Una ficha detectada en la foto."""

    clase: str                 # nombre de clase del detector (p.ej. "square_yellow")
    poligono: np.ndarray       # (N,2) en pixeles de la imagen
    confianza: float = 1.0
    pieza: str = ""            # ficha canonica; se rellena sola

    def __post_init__(self) -> None:
        self.poligono = np.asarray(self.poligono, dtype=np.float64).reshape(-1, 2)

    @property
    def area(self) -> float:
        return abs(cv2.contourArea(self.poligono.astype(np.float32)))

    @property
    def centroide(self) -> np.ndarray:
        m = cv2.moments(self.poligono.astype(np.float32))
        if m["m00"] == 0:
            return self.poligono.mean(axis=0)
        return np.array([m["m10"] / m["m00"], m["m01"] / m["m00"]])


@dataclass
class ResultadoInventario:
    completo: bool
    conteo: dict[str, int]
    faltantes: dict[str, int]
    sobrantes: dict[str, int]
    total_detectadas: int


@dataclass
class ResultadoSolape:
    area_union: float
    area_suma: float
    fraccion_solapada: float
    hay_solape: bool


@dataclass
class ResultadoHuecos:
    fraccion_hueco: float
    hay_huecos: bool
    n_huecos: int


@dataclass
class ResultadoConectividad:
    n_componentes: int
    fraccion_cuerpo_principal: float
    hay_sueltas: bool


@dataclass
class Comparacion:
    iou: float
    angulo: float          # grados que hay que girar la figura del alumno
    reflejada: bool        # True si solo coincide al reflejarla (figura espejada)
    hu: float              # distancia de momentos de Hu (referencia secundaria)


@dataclass
class ResultadoValidacion:
    es_correcta: bool
    puntaje: float
    figura: str
    inventario: ResultadoInventario
    solape: ResultadoSolape
    huecos: ResultadoHuecos
    conectividad: ResultadoConectividad
    comparacion: Comparacion | None
    areas_sospechosas: list[str] = field(default_factory=list)
    mensajes: list[str] = field(default_factory=list)
    #: Contorno exterior de la figura armada, en pixeles de la imagen, tal como
    #: lo obtuvo `validar_configuracion` para poder comparar. Viaja de vuelta
    #: porque la API lo necesita para dibujarlo encima del modelo, y antes lo
    #: recalculaba: era la segunda de las dos veces que se hacia el mismo
    #: trabajo por foto. `None` cuando no se pudo formar (o en modo simulado,
    #: donde la silueta la pone quien simula).
    silueta: np.ndarray | None = None

    def resumen(self) -> str:
        cab = "CORRECTA" if self.es_correcta else "INCORRECTA"
        lineas = [f"[{cab}]  figura objetivo: {self.figura}   puntaje: {self.puntaje:.3f}"]
        lineas += [f"  - {m}" for m in self.mensajes]
        return "\n".join(lineas)

    def to_dict(self) -> dict:
        return {
            "es_correcta": self.es_correcta,
            "puntaje": round(self.puntaje, 4),
            "figura": self.figura,
            "inventario": {
                "completo": self.inventario.completo,
                "conteo": self.inventario.conteo,
                "faltantes": self.inventario.faltantes,
                "sobrantes": self.inventario.sobrantes,
                "total_detectadas": self.inventario.total_detectadas,
            },
            "solape": {
                "fraccion_solapada": round(self.solape.fraccion_solapada, 4),
                "hay_solape": self.solape.hay_solape,
            },
            "huecos": {
                "fraccion_hueco": round(self.huecos.fraccion_hueco, 4),
                "hay_huecos": self.huecos.hay_huecos,
                "n_huecos": self.huecos.n_huecos,
            },
            "conectividad": {
                "n_componentes": self.conectividad.n_componentes,
                "hay_sueltas": self.conectividad.hay_sueltas,
            },
            "comparacion": None if self.comparacion is None else {
                "iou": round(self.comparacion.iou, 4),
                "angulo": round(self.comparacion.angulo, 1),
                "reflejada": self.comparacion.reflejada,
                "hu": round(self.comparacion.hu, 4),
            },
            "areas_sospechosas": self.areas_sospechosas,
            "mensajes": self.mensajes,
        }


# ============================================================================
# 4. Comparacion de siluetas
# ============================================================================


def _normalizar(poly: np.ndarray) -> np.ndarray:
    """Centra en el centroide y escala para que el area encerrada valga 1.

    Asi la comparacion queda inmune a donde este la figura en la mesa y a que
    tan cerca se tomo la foto. Solo queda por resolver el giro.
    """
    poly = np.asarray(poly, dtype=np.float64).reshape(-1, 2)
    m = cv2.moments(poly.astype(np.float32))
    area = abs(m["m00"])
    if area < 1e-12:
        raise ValueError("Polígono degenerado (área cero)")
    c = np.array([m["m10"] / m["m00"], m["m01"] / m["m00"]])
    return (poly - c) / math.sqrt(area)


def _rasterizar(poly: np.ndarray, size: int, k: float) -> np.ndarray:
    pts = np.round(poly * k + size / 2.0).astype(np.int32)
    lienzo = np.zeros((size, size), dtype=np.uint8)
    cv2.fillPoly(lienzo, [pts], 1)
    return lienzo


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = int(np.count_nonzero(a & b))
    union = int(np.count_nonzero(a | b))
    return inter / union if union else 0.0


def _rotar(poly: np.ndarray, grados: float) -> np.ndarray:
    t = math.radians(grados)
    c, s = math.cos(t), math.sin(t)
    return poly @ np.array([[c, s], [-s, c]])


def comparar_siluetas(
    silueta_alumno: np.ndarray,
    silueta_objetivo: np.ndarray,
    permitir_reflexion: bool = True,
    size: int = 256,
) -> Comparacion:
    """Compara dos siluetas siendo indiferente a posicion, tamano y giro.

    Devuelve la IoU del mejor encaje. Busca el giro por barrido grueso (3 grados)
    y luego afina (0.25 grados), probando tambien la version reflejada.

    Se usa IoU y no solo momentos de Hu porque Hu resume la forma en 7 numeros y
    da puntajes parecidos a figuras que un nino distingue a simple vista; la IoU
    mide el solapamiento real y es directamente interpretable como "% de acierto".
    """
    A = _normalizar(silueta_alumno)
    B = _normalizar(silueta_objetivo)

    radio = max(np.linalg.norm(A, axis=1).max(), np.linalg.norm(B, axis=1).max())
    k = (size / 2.0 - 2.0) / radio
    mask_B = _rasterizar(B, size, k)

    mejor = (-1.0, 0.0, False)
    for reflejada in ((False, True) if permitir_reflexion else (False,)):
        base = A * np.array([-1.0, 1.0]) if reflejada else A
        for ang in np.arange(0.0, 360.0, 3.0):
            v = _iou(_rasterizar(_rotar(base, ang), size, k), mask_B)
            if v > mejor[0]:
                mejor = (v, float(ang), reflejada)

    # Afinado alrededor del mejor angulo
    v0, ang0, refl0 = mejor
    base = A * np.array([-1.0, 1.0]) if refl0 else A
    for ang in np.arange(ang0 - 3.0, ang0 + 3.0 + 1e-9, 0.25):
        v = _iou(_rasterizar(_rotar(base, ang), size, k), mask_B)
        if v > v0:
            v0, ang0 = v, float(ang)

    hu = float(
        cv2.matchShapes(
            silueta_alumno.astype(np.float32).reshape(-1, 1, 2),
            silueta_objetivo.astype(np.float32).reshape(-1, 1, 2),
            cv2.CONTOURS_MATCH_I1,
            0.0,
        )
    )
    return Comparacion(iou=v0, angulo=ang0 % 360.0, reflejada=refl0, hu=hu)


# ============================================================================
# 5. Silueta e inventario de la figura armada
# ============================================================================


def _lienzo(detecciones: Sequence[Deteccion], size: int) -> tuple[np.ndarray, float]:
    """Coloca todas las fichas en un lienzo comun. Devuelve (origen, escala)."""
    if not detecciones:
        raise ValueError("Sin detecciones")
    todos = np.vstack([d.poligono for d in detecciones])
    minimo = todos.min(axis=0)
    extension = float((todos.max(axis=0) - minimo).max())
    if extension <= 0:
        raise ValueError("las fichas detectadas no ocupan área en la foto")
    return minimo, (size - 8) / extension


#: Lo que devuelve `_mascaras`: (acumulado, origen, escala). Se pasa de mano en
#: mano entre los cuatro analisis para no rasterizar cinco veces lo mismo.
Mascaras = tuple[np.ndarray, np.ndarray, float]


def _mascaras(detecciones: Sequence[Deteccion], size: int) -> Mascaras:
    """Rasteriza las fichas. Devuelve (acumulado, origen, escala).

    'acumulado' cuenta cuantas fichas cubren cada pixel: 0 = fondo, 1 = una
    ficha, >=2 = fichas montadas.
    """
    minimo, k = _lienzo(detecciones, size)
    acumulado = np.zeros((size, size), dtype=np.uint16)
    for d in detecciones:
        capa = np.zeros((size, size), dtype=np.uint8)
        pts = np.round((d.poligono - minimo) * k + 4).astype(np.int32)
        cv2.fillPoly(capa, [pts], 1)
        acumulado += capa
    return acumulado, minimo, k


def _mascaras_o(detecciones: Sequence[Deteccion], size: int,
                mascaras: Mascaras | None) -> Mascaras:
    """Reusa el rasterizado que ya hizo quien llama, o lo calcula si no lo hay.

    Solape, huecos, conectividad y silueta necesitan exactamente el mismo
    rasterizado, y hasta ahora cada uno lo rehacia por su cuenta: cinco pasadas
    de `fillPoly` sobre 512x512 por cada foto. Se sigue permitiendo llamarlas
    sueltas —el autotest y `evaluar_siluetas.py` lo hacen— pero con la puerta
    abierta a compartir el trabajo. El tamano se comprueba porque una mascara
    rasterizada a otra escala daria fracciones de area silenciosamente distintas.
    """
    if mascaras is not None and mascaras[0].shape[0] == size:
        return mascaras
    return _mascaras(detecciones, size)


def silueta_union(detecciones: Sequence[Deteccion], size: int = 512,
                  mascaras: Mascaras | None = None) -> np.ndarray:
    """Une las fichas detectadas y devuelve el contorno exterior de la figura.

    Coordenadas en el mismo sistema que las detecciones (pixeles de la imagen).
    """
    acumulado, minimo, k = _mascaras_o(detecciones, size, mascaras)
    lienzo = (acumulado > 0).astype(np.uint8) * 255

    # Cierra las juntas finas entre fichas contiguas para que la union quede
    # como una sola pieza y no como 7 islas pegadas.
    lienzo = cv2.morphologyEx(lienzo, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    contornos, _ = cv2.findContours(lienzo, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos:
        raise ValueError("No se pudo formar la silueta")
    mayor = max(contornos, key=cv2.contourArea).reshape(-1, 2).astype(np.float64)
    return (mayor - 4) / k + minimo   # de vuelta a coordenadas de la imagen


def analizar_conectividad(detecciones: Sequence[Deteccion], size: int = 512,
                          mascaras: Mascaras | None = None) -> ResultadoConectividad:
    """¿Forman las fichas un solo cuerpo, o hay alguna suelta?

    Importa porque `silueta_union` se queda con el contorno del cuerpo principal:
    sin esta comprobacion, una ficha abandonada lejos del resto simplemente
    desapareceria del analisis y la figura podria darse por buena.
    """
    acumulado, _, _ = _mascaras_o(detecciones, size, mascaras)
    union = (acumulado > 0).astype(np.uint8)
    union = cv2.morphologyEx(union, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    n, _, stats, _ = cv2.connectedComponentsWithStats(union, connectivity=8)
    areas = sorted((stats[i, cv2.CC_STAT_AREA] for i in range(1, n)), reverse=True)
    if not areas:
        return ResultadoConectividad(0, 0.0, False)

    total = float(sum(areas))
    # Ignora motas irrelevantes (<1% del area) para no contar ruido de la mascara
    relevantes = [a for a in areas if a > total * 0.01]
    return ResultadoConectividad(
        n_componentes=len(relevantes),
        fraccion_cuerpo_principal=areas[0] / total,
        hay_sueltas=len(relevantes) > 1,
    )


def analizar_huecos(detecciones: Sequence[Deteccion], size: int = 512,
                    mascaras: Mascaras | None = None) -> ResultadoHuecos:
    """Busca huecos *dentro* de la figura armada.

    Esta comprobacion es imprescindible: si al alumno le falta una ficha en el
    interior, el contorno exterior no cambia y la comparacion de siluetas da
    100%. El hueco es la unica evidencia visual de la ficha ausente.
    """
    acumulado, _, _ = _mascaras_o(detecciones, size, mascaras)
    union = (acumulado > 0).astype(np.uint8)
    union = cv2.morphologyEx(union, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    contornos, _ = cv2.findContours(union, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos:
        return ResultadoHuecos(0.0, False, 0)
    solida = np.zeros_like(union)
    cv2.drawContours(solida, [max(contornos, key=cv2.contourArea)], -1, 1, thickness=cv2.FILLED)

    huecos = ((solida == 1) & (union == 0)).astype(np.uint8)
    area_solida = float(np.count_nonzero(solida))
    fraccion = float(np.count_nonzero(huecos)) / area_solida if area_solida else 0.0

    # Contamos solo los huecos con tamano relevante (ignora rendijas de 1 px)
    n, etiquetas, stats, _ = cv2.connectedComponentsWithStats(huecos, connectivity=8)
    minimos = area_solida * 0.01
    n_huecos = int(sum(1 for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > minimos))

    return ResultadoHuecos(
        fraccion_hueco=fraccion,
        hay_huecos=fraccion > UMBRAL_HUECO and n_huecos > 0,
        n_huecos=n_huecos,
    )


def validar_inventario(
    detecciones: Sequence[Deteccion], taxonomia: dict[str, str] | None = None
) -> ResultadoInventario:
    """¿Estan las 7 fichas del Tangram, cada una las veces que corresponde?"""
    if taxonomia is None:
        taxonomia = resolver_taxonomia(d.clase for d in detecciones)

    conteo = {p: 0 for p in INVENTARIO_CANONICO}
    for d in detecciones:
        pieza = taxonomia.get(d.clase)
        if pieza is None:
            raise ValueError(f"Clase desconocida: {d.clase}")
        d.pieza = pieza
        conteo[pieza] += 1

    faltantes = {p: n - conteo[p] for p, n in INVENTARIO_CANONICO.items() if conteo[p] < n}
    sobrantes = {p: conteo[p] - n for p, n in INVENTARIO_CANONICO.items() if conteo[p] > n}

    return ResultadoInventario(
        completo=not faltantes and not sobrantes,
        conteo=conteo,
        faltantes=faltantes,
        sobrantes=sobrantes,
        total_detectadas=len(detecciones),
    )


def analizar_solape(detecciones: Sequence[Deteccion], size: int = 512,
                    mascaras: Mascaras | None = None) -> ResultadoSolape:
    """Mide cuanta area se pisan las fichas entre si.

    En un Tangram bien armado las fichas se tocan pero no se montan. Un solape
    alto suele significar una ficha encima de otra... o una deteccion duplicada.
    """
    acumulado, _, _ = _mascaras_o(detecciones, size, mascaras)
    area_union = float(np.count_nonzero(acumulado))
    area_suma = float(acumulado.sum())
    fraccion = (area_suma - area_union) / area_suma if area_suma else 0.0
    return ResultadoSolape(
        area_union=area_union,
        area_suma=area_suma,
        fraccion_solapada=fraccion,
        hay_solape=fraccion > UMBRAL_SOLAPE,
    )


def revisar_areas(detecciones: Sequence[Deteccion]) -> list[str]:
    """Comprueba que el tamano de cada ficha encaje con su clase.

    Las proporciones del Tangram son fijas (grande:mediano:pequeno = 4:2:1), asi
    que el area total detectada da la escala y de ahi se deduce cuanto *deberia*
    medir cada ficha. Sirve para cazar el error tipico del detector: confundir el
    triangulo mediano con uno grande.

    La unidad de referencia es la *mediana* de lo que mide una unidad segun cada
    ficha, no el area total dividida entre las 16 unidades del Tangram entero.
    Dos motivos, y los dos importan:

      - con el area total, una foto donde el detector solo encontro tres fichas
        daria una unidad demasiado pequena y acusaria a las fichas presentes de
        estar mal clasificadas, cuando el problema es que faltan las otras;
      - la mediana no se deja arrastrar por la ficha que se quiere cazar. Si el
        mediano viene etiquetado como grande, su medida queda fuera del consenso
        de las demas en vez de correr la escala hacia ella.
    """
    if not detecciones:
        return []
    unidades = sorted(d.area / AREA_RELATIVA[d.pieza] for d in detecciones if d.pieza)
    if not unidades:
        return []
    medio = len(unidades) // 2
    unidad = (unidades[medio] if len(unidades) % 2
              else (unidades[medio - 1] + unidades[medio]) / 2.0)
    if unidad <= 0:
        return []

    sospechosas = []
    for d in detecciones:
        if not d.pieza:
            continue
        esperada = AREA_RELATIVA[d.pieza] * unidad
        desviacion = abs(d.area - esperada) / esperada
        if desviacion > UMBRAL_AREA:
            sospechosas.append(
                f"{NOMBRE_BONITO[d.pieza]} ({d.clase}): mide {d.area / unidad:.1f} unidades "
                f"pero un {NOMBRE_BONITO[d.pieza]} mide {AREA_RELATIVA[d.pieza]:.0f} "
                f"-- posible error de clasificación"
            )
    return sospechosas


# ============================================================================
# 6. Validacion completa
# ============================================================================


def construir_resultado(
    nombre: str,
    inventario: ResultadoInventario,
    solape: ResultadoSolape,
    huecos: ResultadoHuecos,
    conectividad: ResultadoConectividad,
    sospechosas: list[str],
    comparacion: Comparacion | None,
    exigir_inventario: bool = True,
    avisos: Sequence[str] = (),
) -> ResultadoValidacion:
    """Junta los cinco analisis en un veredicto y en mensajes para el estudiante.

    Vive aparte de `validar_configuracion` porque la API la reutiliza cuando no
    hay detector cargado (modo demostracion): asi el texto que lee el nino sale
    siempre del mismo sitio y no hay dos redacciones que se puedan desincronizar.
    """
    mensajes: list[str] = list(avisos)

    # --- 1. Inventario ------------------------------------------------------
    if inventario.completo:
        mensajes.append("Se usaron las 7 fichas del Tangram, cada una una sola vez.")
    else:
        for pieza, n in inventario.faltantes.items():
            mensajes.append(f"Falta {n} {NOMBRE_BONITO[pieza]}.")
        for pieza, n in inventario.sobrantes.items():
            mensajes.append(f"Hay {n} {NOMBRE_BONITO[pieza]} de más.")

    # --- 2. Solape ----------------------------------------------------------
    if solape.hay_solape:
        mensajes.append(
            f"Hay fichas montadas una sobre otra ({solape.fraccion_solapada:.0%} del área). "
            "En el Tangram las fichas se tocan pero no se pisan."
        )

    # --- 3. Huecos interiores ----------------------------------------------
    if huecos.hay_huecos:
        mensajes.append(
            f"Queda {'un hueco' if huecos.n_huecos == 1 else f'{huecos.n_huecos} huecos'} "
            f"sin cubrir dentro de la figura ({huecos.fraccion_hueco:.0%} del área). "
            "Las fichas deben quedar pegadas, sin espacios."
        )

    if conectividad.hay_sueltas:
        sueltas = conectividad.n_componentes - 1
        mensajes.append(
            f"Hay {sueltas} ficha{'s' if sueltas > 1 else ''} separada{'s' if sueltas > 1 else ''} "
            "del resto. Todas las fichas deben tocarse para formar una sola figura."
        )

    if sospechosas:
        mensajes.extend(sospechosas)

    # --- 4. Forma -----------------------------------------------------------
    puntaje = comparacion.iou if comparacion else 0.0

    if comparacion is not None:
        if puntaje >= UMBRAL_IOU_CORRECTA:
            mensajes.append(f"La figura coincide con «{nombre}» ({puntaje:.0%} de acierto).")
        elif puntaje >= UMBRAL_IOU_CASI:
            mensajes.append(
                f"Vas bien: se parece a «{nombre}» ({puntaje:.0%}), pero hay fichas "
                "un poco corridas. Revisa los bordes."
            )
        else:
            mensajes.append(
                f"La figura todavía no se parece a «{nombre}» (solo {puntaje:.0%})."
            )

        if comparacion.reflejada and puntaje >= UMBRAL_IOU_CASI:
            mensajes.append(
                "La figura está en espejo respecto al modelo. Si el romboide está "
                "volteado, dale la vuelta."
            )

    # --- Veredicto ----------------------------------------------------------
    es_correcta = (
        puntaje >= UMBRAL_IOU_CORRECTA
        and not solape.hay_solape
        and not huecos.hay_huecos
        and not conectividad.hay_sueltas
        and (inventario.completo or not exigir_inventario)
    )

    return ResultadoValidacion(
        es_correcta=es_correcta,
        puntaje=puntaje,
        figura=nombre,
        inventario=inventario,
        solape=solape,
        huecos=huecos,
        conectividad=conectividad,
        comparacion=comparacion,
        areas_sospechosas=sospechosas,
        mensajes=mensajes,
    )


def validar_configuracion(
    detecciones: Sequence[Deteccion],
    figura_objetivo: dict,
    taxonomia: dict[str, str] | None = None,
    permitir_reflexion: bool = True,
    exigir_inventario: bool = True,
) -> ResultadoValidacion:
    """Valida la figura armada por el estudiante contra la figura objetivo.

    figura_objetivo: entrada de figures_seed.json, con 'slug', 'name' y
    'silhouette' (poligono normalizado en [0,1]).
    """
    nombre = figura_objetivo.get("name", figura_objetivo.get("slug", "?"))

    inventario = validar_inventario(detecciones, taxonomia)

    avisos: list[str] = []
    comparacion = None
    silueta = None

    # Las fichas se rasterizan una sola vez: solape, huecos, conectividad y
    # silueta necesitan el mismo lienzo y antes cada uno lo rehacia, con lo que
    # una foto pagaba cinco rasterizados de 512x512 en vez de uno.
    #
    # Y va dentro del try porque aqui es donde revienta lo que antes acababa en
    # un 500: tres vertices iguales pasan el filtro `len(poly) < 3` del pipeline,
    # llegan hasta aqui y `_lienzo` no puede darles escala. Eso no es una averia
    # del servicio, es una foto que no se pudo medir, y como tal se cuenta.
    try:
        mascaras = _mascaras(detecciones, 512)
    except (ValueError, cv2.error) as exc:
        mascaras = None
        avisos.append(f"No se pudieron medir las fichas de la foto: {exc}")

    if mascaras is not None:
        solape = analizar_solape(detecciones, mascaras=mascaras)
        huecos = analizar_huecos(detecciones, mascaras=mascaras)
        conectividad = analizar_conectividad(detecciones, mascaras=mascaras)
    else:
        # Sin lienzo no hay nada que medir. Se devuelven los tres analisis en
        # blanco (y no "hay solape", que acusaria al estudiante de algo que
        # nadie comprobo); el aviso de arriba es el que explica lo que paso.
        solape = ResultadoSolape(area_union=0.0, area_suma=0.0,
                                 fraccion_solapada=0.0, hay_solape=False)
        huecos = ResultadoHuecos(fraccion_hueco=0.0, hay_huecos=False, n_huecos=0)
        conectividad = ResultadoConectividad(n_componentes=0,
                                             fraccion_cuerpo_principal=0.0,
                                             hay_sueltas=False)

    sospechosas = revisar_areas(detecciones)

    if mascaras is not None:
        try:
            silueta = silueta_union(detecciones, mascaras=mascaras)
            objetivo = np.asarray(figura_objetivo["silhouette"], dtype=np.float64)
            comparacion = comparar_siluetas(silueta, objetivo, permitir_reflexion)
        except (ValueError, KeyError, cv2.error) as exc:
            silueta = None
            avisos.append(f"No se pudo comparar la silueta: {exc}")

    resultado = construir_resultado(
        nombre, inventario, solape, huecos, conectividad, sospechosas,
        comparacion, exigir_inventario, avisos,
    )
    # La silueta viaja de vuelta para que la API no la vuelva a calcular: es el
    # mismo contorno con el que se acaba de medir la IoU.
    resultado.silueta = silueta
    return resultado


# ============================================================================
# 7. Entrada/salida
# ============================================================================


def cargar_figuras(path: str) -> dict[str, dict]:
    """Lee figures_seed.json y lo indexa por slug."""
    with open(path, "r", encoding="utf-8") as f:
        datos = json.load(f)
    return {f["slug"]: f for f in datos}


def desde_ultralytics(resultado, taxonomia: dict[str, str] | None = None) -> list[Deteccion]:
    """Convierte un Results de YOLOv8-seg en una lista de Deteccion.

        r = modelo.predict(imagen)[0]
        detecciones = desde_ultralytics(r)
    """
    if resultado.masks is None:
        raise ValueError(
            "El resultado no trae mascaras. Usa un modelo de segmentacion (-seg), "
            "no uno de solo deteccion."
        )
    nombres = resultado.names
    detecciones = []
    for poligono, caja in zip(resultado.masks.xy, resultado.boxes):
        clase = nombres[int(caja.cls.item())]
        detecciones.append(
            Deteccion(clase=clase, poligono=np.asarray(poligono),
                      confianza=float(caja.conf.item()))
        )
    if taxonomia is None and detecciones:
        taxonomia = resolver_taxonomia(d.clase for d in detecciones)
    for d in detecciones:
        d.pieza = taxonomia[d.clase]
    return detecciones


def quedarse_con_las_mejores(detecciones: Sequence[Deteccion]) -> list[Deteccion]:
    """Si el detector devolvio fichas de mas, conserva las mas confiables.

    Util cuando una misma ficha se detecta dos veces: nos quedamos con tantas
    de cada tipo como tiene un Tangram real, ordenando por confianza.
    """
    taxonomia = resolver_taxonomia(d.clase for d in detecciones)
    por_pieza: dict[str, list[Deteccion]] = {}
    for d in detecciones:
        if not d.pieza:
            d.pieza = taxonomia[d.clase]
        por_pieza.setdefault(d.pieza, []).append(d)
    salida = []
    for pieza, grupo in por_pieza.items():
        grupo.sort(key=lambda d: d.confianza, reverse=True)
        salida.extend(grupo[: INVENTARIO_CANONICO.get(pieza, len(grupo))])
    return salida


# ============================================================================
# 8. Puente para la API: dibujo superpuesto y retroalimentacion espacial
# ============================================================================
#
# El nucleo de arriba decide si la figura esta bien. Lo de aqui traduce ese
# analisis a lo que la app le ensena al estudiante: su contorno encima del
# modelo, y que parte de la figura le quedo peor.

ETIQUETAS_BANDAS = ("Parte de arriba", "Parte del medio", "Parte de abajo")


def _aplicar_alineacion(poly_normalizado: np.ndarray, comparacion: Comparacion) -> np.ndarray:
    """Deja la silueta del alumno en la orientacion con la que se midio la IoU."""
    base = (poly_normalizado * np.array([-1.0, 1.0])
            if comparacion.reflejada else poly_normalizado)
    return _rotar(base, comparacion.angulo)


def simplificar(poly: np.ndarray, max_puntos: int = 80) -> np.ndarray:
    """Reduce los vertices de un contorno conservando su forma.

    `silueta_union` sale de findContours y puede traer cientos de puntos; en la
    pantalla de un telefono no se distingue ninguno de ellos y todos viajan por
    la red en cada respuesta.
    """
    poly = np.asarray(poly, dtype=np.float64).reshape(-1, 2)
    if len(poly) <= 4:
        return poly
    contorno = poly.astype(np.float32).reshape(-1, 1, 2)
    tolerancia = 0.004 * cv2.arcLength(contorno, True)
    aprox = cv2.approxPolyDP(contorno, tolerancia, True).reshape(-1, 2).astype(np.float64)
    if len(aprox) < 3:
        aprox = poly
    if len(aprox) > max_puntos:
        aprox = aprox[:: int(math.ceil(len(aprox) / max_puntos))]
    return aprox


def siluetas_superpuestas(
    silueta_alumno: np.ndarray,
    silueta_objetivo: np.ndarray,
    comparacion: Comparacion,
    max_puntos: int = 80,
    margen: float = 0.04,
) -> tuple[list[list[float]], list[list[float]]]:
    """Devuelve (contorno del alumno, contorno objetivo) listos para superponer.

    Ambos salen normalizados a 0..1 con el *mismo* encuadre: la escala y el
    desplazamiento se calculan sobre la union de los dos, nunca por separado.
    Si cada uno se normalizara por su cuenta, los dos contornos calzarian
    siempre y el dibujo diria que la figura esta perfecta aunque la IoU fuera
    baja -- justo lo contrario de lo que el estudiante necesita ver.
    """
    A = _aplicar_alineacion(_normalizar(simplificar(silueta_alumno, max_puntos)), comparacion)
    B = _normalizar(np.asarray(silueta_objetivo, dtype=np.float64))

    todos = np.vstack([A, B])
    minimo = todos.min(axis=0)
    extension = todos.max(axis=0) - minimo
    escala = float(extension.max()) or 1.0

    util = 1.0 - 2.0 * margen
    # El eje corto se centra: el encuadre es comun, asi que el desfase entre
    # las dos siluetas se conserva tal cual.
    desfase = (1.0 - extension / escala * util) / 2.0

    def a_lienzo(p: np.ndarray) -> list[list[float]]:
        q = (p - minimo) / escala * util + desfase
        return [[round(float(x), 4), round(float(y), 4)] for x, y in q]

    return a_lienzo(A), a_lienzo(B)


def cobertura_por_bandas(
    silueta_alumno: np.ndarray,
    silueta_objetivo: np.ndarray,
    comparacion: Comparacion,
    bandas: int = 3,
    size: int = 256,
) -> list[dict]:
    """Que porcentaje de cada franja horizontal del modelo cubrio el estudiante.

    Un unico numero global ("62% de parecido") no le dice a un nino de primaria
    que hacer. Partir la figura en tres franjas si: "revisa la parte de arriba".

    Las franjas se reparten sobre la altura de la *figura*, no del lienzo: una
    figura ancha y baja dejaria vacios el tercio de arriba y el de abajo, y se
    le estaria senalando una zona donde el modelo no tiene nada.
    """
    etiquetas = list(ETIQUETAS_BANDAS[:bandas])
    try:
        A = _aplicar_alineacion(_normalizar(silueta_alumno), comparacion)
        B = _normalizar(np.asarray(silueta_objetivo, dtype=np.float64))
    except ValueError:
        return [{"label": e, "coverage": 0.0} for e in etiquetas]

    radio = max(np.linalg.norm(A, axis=1).max(), np.linalg.norm(B, axis=1).max())
    k = (size / 2.0 - 2.0) / radio
    mask_alumno = _rasterizar(A, size, k)
    mask_objetivo = _rasterizar(B, size, k)

    filas = np.nonzero(mask_objetivo.any(axis=1))[0]
    if len(filas) == 0:
        return [{"label": e, "coverage": 0.0} for e in etiquetas]
    arriba, abajo = int(filas.min()), int(filas.max()) + 1
    alto = abajo - arriba

    salida = []
    for i, etiqueta in enumerate(etiquetas):
        y0 = arriba + i * alto // bandas
        y1 = arriba + (i + 1) * alto // bandas
        objetivo = mask_objetivo[y0:y1]
        area = int(objetivo.sum())
        cubierto = int(np.logical_and(mask_alumno[y0:y1], objetivo).sum())
        salida.append({
            "label": etiqueta,
            "coverage": round(cubierto / area, 3) if area else 0.0,
        })
    return salida


# ============================================================================
# 9. Pruebas internas (no requieren modelo ni fotos)
# ============================================================================


def _transformar(poly: np.ndarray, angulo=0.0, escala=1.0, dx=0.0, dy=0.0) -> np.ndarray:
    return _rotar(poly, angulo) * escala + np.array([dx, dy])


def _piezas_como_detecciones(taxonomia_inversa: dict[str, str],
                             desplazar: dict[int, tuple[float, float]] | None = None,
                             quitar: set[int] | None = None,
                             angulo: float = 0.0,
                             escala: float = 1.0) -> list[Deteccion]:
    """Arma un Tangram sintetico (el cuadrado) como si lo hubiera visto el detector."""
    desplazar = desplazar or {}
    quitar = quitar or set()
    dets = []
    for i, (pieza, poly) in enumerate(PIEZAS_CANONICAS):
        if i in quitar:
            continue
        p = poly.copy()
        if i in desplazar:
            p = p + np.array(desplazar[i])
        p = _transformar(p, angulo=angulo, escala=escala)
        dets.append(Deteccion(clase=taxonomia_inversa[pieza], poligono=p * 1000.0))
    return dets


def autotest(path_figuras: str | None = None) -> bool:
    inv7 = {
        TRIANGULO_GRANDE: "large_tri_green",
        TRIANGULO_MEDIANO: "medium_tri_red",
        TRIANGULO_PEQUENO: "small_tri_blue",
        CUADRADO: "square_yellow",
        ROMBOIDE: "parallelogram_cyan",
    }
    fallos = []

    def check(nombre: str, condicion: bool, detalle: str = "") -> None:
        estado = "OK  " if condicion else "FALLA"
        print(f"  [{estado}] {nombre}{('  -> ' + detalle) if detalle else ''}")
        if not condicion:
            fallos.append(nombre)

    # Las pruebas se corren con los umbrales del .env, no con los de fabrica: si
    # se comprobara 0.85 mientras en el aula se califica con 0.75, un autotest en
    # verde no diria nada sobre lo que hace el servicio de verdad.
    correcta, casi = _aplicar_umbrales_efectivos()
    print(f"\n0) Umbrales en uso  ·  correcta >= {correcta:.2f}  ·  casi >= {casi:.2f}"
          f"  (de vision-service/.env; de fabrica 0.85 / 0.70)")

    print("\n1) Geometria canonica de las 7 fichas")
    areas = {}
    for pieza, poly in PIEZAS_CANONICAS:
        areas.setdefault(pieza, []).append(abs(cv2.contourArea(poly.astype(np.float32))))
    unidad = min(min(v) for v in areas.values())
    for pieza, vals in areas.items():
        ratio = np.mean(vals) / unidad
        check(f"area {NOMBRE_BONITO[pieza]} = {AREA_RELATIVA[pieza]:.0f} unidades",
              abs(ratio - AREA_RELATIVA[pieza]) < 0.02, f"medido {ratio:.2f}")
    total = sum(sum(v) for v in areas.values())
    check("las 7 fichas cubren el cuadrado unitario", abs(total - 1.0) < 1e-6,
          f"area total {total:.6f}")

    print("\n2) Inventario")
    dets = _piezas_como_detecciones(inv7)
    check("Tangram completo -> inventario completo", validar_inventario(dets).completo)
    inc = validar_inventario(_piezas_como_detecciones(inv7, quitar={5}))
    check("sin el cuadrado -> lo reporta como faltante",
          (not inc.completo) and inc.faltantes.get(CUADRADO) == 1, str(inc.faltantes))
    dobles = dets + [dets[3]]
    dup = validar_inventario(dobles)
    check("triangulo pequeno de mas -> lo reporta como sobrante",
          dup.sobrantes.get(TRIANGULO_PEQUENO) == 1, str(dup.sobrantes))

    print("\n3) Solape entre fichas")
    check("Tangram bien armado -> sin solape", not analizar_solape(dets).hay_solape,
          f"{analizar_solape(dets).fraccion_solapada:.3f}")
    montado = _piezas_como_detecciones(inv7, desplazar={0: (0.0, 0.20)})
    check("una ficha montada sobre otra -> lo detecta", analizar_solape(montado).hay_solape,
          f"{analizar_solape(montado).fraccion_solapada:.3f}")

    print("\n3b) Huecos interiores (la ficha que falta *dentro* de la figura)")
    check("Tangram completo -> sin huecos", not analizar_huecos(dets).hay_huecos,
          f"{analizar_huecos(dets).fraccion_hueco:.3f}")
    sin_cuadrado = _piezas_como_detecciones(inv7, quitar={5})
    h = analizar_huecos(sin_cuadrado)
    check("falta el cuadrado (pieza interior) -> aparece el hueco", h.hay_huecos,
          f"hueco={h.fraccion_hueco:.3f}, n={h.n_huecos}")

    print("\n3c) Conectividad (fichas separadas del cuerpo de la figura)")
    check("Tangram bien armado -> un solo cuerpo",
          not analizar_conectividad(dets).hay_sueltas,
          f"{analizar_conectividad(dets).n_componentes} componente(s)")
    apartada = _piezas_como_detecciones(inv7, desplazar={2: (0.35, 0.35)})
    con = analizar_conectividad(apartada)
    check("una ficha apartada -> la detecta como suelta", con.hay_sueltas,
          f"{con.n_componentes} componentes")

    print("\n3d) Coherencia de areas (cazar la ficha mal clasificada)")
    check("Tangram completo -> ninguna ficha sospechosa", not revisar_areas(dets),
          "; ".join(revisar_areas(dets)))
    # Solo tres fichas en la foto: la escala se reparte entre las presentes, asi
    # que ninguna puede salir acusada por el simple hecho de que falten otras.
    parciales = _piezas_como_detecciones(inv7, quitar={1, 2, 4, 6})
    validar_inventario(parciales)
    check("faltan fichas -> las presentes no se acusan sin motivo",
          not revisar_areas(parciales), "; ".join(revisar_areas(parciales)))
    # Un mediano etiquetado como grande: el area lo delata.
    confundido = _piezas_como_detecciones(inv7)
    validar_inventario(confundido)
    confundido[2].pieza = TRIANGULO_GRANDE
    confundido[2].clase = inv7[TRIANGULO_GRANDE]
    check("un mediano etiquetado como grande -> lo marca",
          any("grande" in s for s in revisar_areas(confundido)),
          "; ".join(revisar_areas(confundido))[:90])

    print("\n4) Comparacion de siluetas (invariancia a giro, escala y posicion)")
    cuadrado = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
    silueta = silueta_union(dets)
    c = comparar_siluetas(silueta, cuadrado)
    check("Tangram armado como cuadrado -> coincide con el cuadrado", c.iou > 0.97,
          f"IoU={c.iou:.3f}")

    dets_g = _piezas_como_detecciones(inv7, angulo=37.0, escala=2.4)
    c2 = comparar_siluetas(silueta_union(dets_g), cuadrado)
    check("mismo armado girado 37 grados y al doble de tamano", c2.iou > 0.97,
          f"IoU={c2.iou:.3f}, angulo recuperado {c2.angulo:.1f}")

    print("\n5) Figuras reales de figures_seed.json")
    if path_figuras:
        figuras = cargar_figuras(path_figuras)
        casa = np.asarray(figuras["house"]["silhouette"], dtype=np.float64)
        casa_mov = _transformar(casa, angulo=53.0, escala=3.1, dx=17.0, dy=-4.0)
        c3 = comparar_siluetas(casa_mov, casa)
        check("Casa contra si misma movida/girada/escalada", c3.iou > 0.97,
              f"IoU={c3.iou:.3f}")

        slugs = [s for s in figuras if s != "house"]
        peores = [(s, comparar_siluetas(np.asarray(figuras[s]["silhouette"]), casa).iou)
                  for s in slugs]
        peor = max(peores, key=lambda t: t[1])
        check("Casa contra las otras 13 figuras -> ninguna la supera",
              peor[1] < UMBRAL_IOU_CORRECTA,
              f"la mas parecida es '{peor[0]}' con IoU={peor[1]:.3f}")
    else:
        print("  (omitido: pasa --figuras data/figures_seed.json para incluirlo)")

    print("\n6) Validacion completa")
    if path_figuras:
        figuras = cargar_figuras(path_figuras)
        objetivo = {"slug": "square", "name": "Cuadrado", "silhouette": cuadrado.tolist()}

        r_ok = validar_configuracion(dets, objetivo)
        check("figura bien armada -> CORRECTA", r_ok.es_correcta, f"puntaje {r_ok.puntaje:.3f}")

        r_falta = validar_configuracion(_piezas_como_detecciones(inv7, quitar={5}), objetivo)
        check("falta una ficha -> INCORRECTA", not r_falta.es_correcta,
              f"puntaje {r_falta.puntaje:.3f}")

        r_mal = validar_configuracion(dets, figuras["cat"])
        check("figura de cuadrado contra objetivo 'Gato' -> INCORRECTA",
              not r_mal.es_correcta, f"puntaje {r_mal.puntaje:.3f}")

        print("\n  Ejemplo de salida para el estudiante:")
        for linea in r_falta.resumen().splitlines():
            print("   ", linea)

    print("\n7) Puente para la app (contornos superpuestos y bandas)")

    def _iou_dibujo(a, b, lado=256):
        """IoU de dos contornos ya normalizados a 0..1, tal como los ve la app."""
        ma, mb = np.zeros((lado, lado), np.uint8), np.zeros((lado, lado), np.uint8)
        cv2.fillPoly(ma, [np.round(np.asarray(a) * (lado - 1)).astype(np.int32)], 1)
        cv2.fillPoly(mb, [np.round(np.asarray(b) * (lado - 1)).astype(np.int32)], 1)
        return _iou(ma, mb)

    silueta = silueta_union(dets)
    cuadrado = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
    comp = comparar_siluetas(silueta, cuadrado)
    mio, modelo = siluetas_superpuestas(silueta, cuadrado, comp)
    dentro = all(-0.001 <= v <= 1.001 for p in mio + modelo for v in p)
    check("los dos contornos salen dentro del lienzo 0..1", dentro)
    check("pocos vertices para dibujar en el telefono", 3 <= len(mio) <= 80,
          f"{len(mio)} vertices")

    # El encuadre es comun a los dos contornos: el dibujo tiene que contar la
    # misma historia que la IoU, no calzar siempre por haberse normalizado cada
    # uno por su cuenta.
    calce_bueno = _iou_dibujo(mio, modelo)
    check("armado correcto -> el dibujo lo muestra encima del modelo",
          abs(calce_bueno - comp.iou) < 0.05, f"dibujo {calce_bueno:.3f} vs IoU {comp.iou:.3f}")

    if path_figuras:
        gato = np.asarray(figuras["cat"]["silhouette"], dtype=np.float64)
        comp_gato = comparar_siluetas(silueta, gato)
        m2, o2 = siluetas_superpuestas(silueta, gato, comp_gato)
        calce_malo = _iou_dibujo(m2, o2)
        check("armado que no coincide -> el dibujo tambien se separa",
              abs(calce_malo - comp_gato.iou) < 0.05 and calce_malo < calce_bueno,
              f"dibujo {calce_malo:.3f} vs IoU {comp_gato.iou:.3f}")

    identidad = Comparacion(iou=1.0, angulo=0.0, reflejada=False, hu=0.0)
    llenas = cobertura_por_bandas(cuadrado, cuadrado, identidad)
    check("figura entera -> las 3 bandas cubiertas",
          all(b["coverage"] > 0.97 for b in llenas),
          ", ".join(f"{b['coverage']:.2f}" for b in llenas))

    # Un cuadrado al que le falta el cuadrante de arriba a la izquierda: la
    # banda de arriba tiene que quedar peor que la de abajo.
    con_muesca = np.array([[0.5, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.5], [0.5, 0.5]])
    parcial = cobertura_por_bandas(con_muesca, cuadrado, identidad)
    check("le falta un trozo de arriba -> es la banda peor calificada",
          parcial[0]["coverage"] == min(b["coverage"] for b in parcial)
          and parcial[0]["coverage"] < parcial[2]["coverage"],
          ", ".join(f"{b['label'].split()[-1]}={b['coverage']:.2f}" for b in parcial))

    print()
    if fallos:
        print(f"RESULTADO: {len(fallos)} prueba(s) fallaron: {fallos}")
        return False
    print("RESULTADO: todas las pruebas pasaron.")
    return True


def calibrar(path_figuras: str) -> dict:
    """Mide si los umbrales estan bien puestos, usando el catalogo de figuras.

    Produce dos numeros que conviene citar en la tesis:
      - la mayor IoU entre dos figuras *distintas* (falsos positivos), y
      - la menor IoU de una figura consigo misma girada/escalada (falsos negativos).
    El umbral de aceptacion debe caer entre ambos.

    Los umbrales que se juzgan son los del .env, los mismos con los que califica
    el servicio. Antes se leian las constantes del modulo, con lo que la
    herramienta que justifica el umbral en la tesis estaba avalando un 0.85 que
    en el aula nadie usa.
    """
    correcta, casi = _aplicar_umbrales_efectivos()

    figuras = cargar_figuras(path_figuras)
    slugs = list(figuras)
    sil = {s: np.asarray(figuras[s]["silhouette"], dtype=np.float64) for s in slugs}

    print("Separabilidad del catalogo (IoU tras alinear giro, escala y posicion)")
    print(f"{'figura':18s}{'consigo':>9s}   {'se confunde con':18s}{'IoU':>7s}")
    propio_min, ajeno_max = 1.0, 0.0
    peor_par = ("", "")
    #: Todos los pares de figuras distintas, para poder contar cuantos quedan
    #: por encima de un umbral. Indexado por par sin orden: la IoU de a contra b
    #: y la de b contra a son la misma medida y no deben contarse dos veces.
    confusiones: dict[frozenset, float] = {}
    for a in slugs:
        propio = comparar_siluetas(_transformar(sil[a], 53.0, 3.1, 17.0, -4.0), sil[a]).iou
        otros = {b: comparar_siluetas(sil[b], sil[a]).iou for b in slugs if b != a}
        b = max(otros, key=otros.get)
        print(f"{a:18s}{propio:9.3f}   {b:18s}{otros[b]:7.3f}")
        for c, v in otros.items():
            par = frozenset((a, c))
            confusiones[par] = max(confusiones.get(par, 0.0), v)
        propio_min = min(propio_min, propio)
        if otros[b] > ajeno_max:
            ajeno_max, peor_par = otros[b], (a, b)

    print(f"\nPeor coincidencia de una figura consigo misma : {propio_min:.3f}")
    print(f"Mayor confusion entre figuras distintas       : {ajeno_max:.3f}"
          f"   ({peor_par[1]} vs {peor_par[0]})")
    print(f"Margen disponible para el umbral              : {propio_min - ajeno_max:.3f}")

    # El veredicto se da sobre los dos umbrales, no solo sobre el de aprobar. Un
    # CLOSE_IOU por debajo de la confusion maxima no reprueba a nadie, pero le
    # dice "vas bien" a un nino que armo otra figura del catalogo, que para el
    # es la misma mentira.
    print(f"\nMATCH_IOU efectivo (aprobar)   = {correcta:.2f}")
    if correcta <= ajeno_max:
        print(f"  [!!] REVISALO: esta por debajo de la confusion maxima ({ajeno_max:.3f}). "
              f"Con este umbral, armar '{peor_par[1]}' aprueba como '{peor_par[0]}'.")
    elif correcta >= propio_min:
        print(f"  [!!] REVISALO: esta por encima del peor acierto de una figura consigo "
              f"misma ({propio_min:.3f}). Un armado correcto puede reprobar.")
    else:
        print(f"  dentro del margen ({ajeno_max:.3f} < {correcta:.2f} < {propio_min:.3f})")

    print(f"CLOSE_IOU efectivo (\"vas bien\") = {casi:.2f}")
    encima = sorted(((v, sorted(p)) for p, v in confusiones.items() if v >= casi),
                    reverse=True)
    if casi <= ajeno_max:
        print(f"  [!!] REVISALO: esta por debajo de la confusion maxima ({ajeno_max:.3f}). "
              f"{len(encima)} par(es) de figuras distintas del catalogo se felicitan "
              f"mutuamente:")
        for v, (x, y) in encima:
            print(f"       {x:18s} vs {y:18s} IoU={v:.3f}")
    else:
        print(f"  por encima de la confusion maxima ({ajeno_max:.3f}): "
              f"ninguna figura del catalogo se confunde con otra.")

    print("\nSensibilidad: que pasa al correr una ficha del Tangram armado como cuadrado")
    print("(el Tangram es una diseccion exacta: mover una ficha siempre abre un hueco,")
    print(" la separa del cuerpo o la monta sobre otra -- por eso no basta con la IoU)")
    inv7 = {TRIANGULO_GRANDE: "large_tri_green", TRIANGULO_MEDIANO: "medium_tri_red",
            TRIANGULO_PEQUENO: "small_tri_blue", CUADRADO: "square_yellow",
            ROMBOIDE: "parallelogram_cyan"}
    cuadrado = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
    objetivo = {"slug": "square", "name": "Cuadrado", "silhouette": cuadrado.tolist()}
    print(f"\n{'desplazamiento':>15s}{'IoU':>7s}{'hueco':>8s}{'solape':>8s}{'sueltas':>9s}   veredicto")
    for delta in (0.0, 0.01, 0.02, 0.05, 0.10, 0.25):
        r = validar_configuracion(
            _piezas_como_detecciones(inv7, desplazar={2: (delta, delta)}), objetivo)
        print(f"{delta:>14.0%}{r.puntaje:7.3f}{r.huecos.fraccion_hueco:8.2%}"
              f"{r.solape.fraccion_solapada:8.2%}{r.conectividad.n_componentes - 1:9d}"
              f"   {'CORRECTA' if r.es_correcta else 'incorrecta'}")

    return {"propio_min": propio_min, "ajeno_max": ajeno_max}


# ============================================================================
# 10. CLI
# ============================================================================


def _main() -> int:
    ap = argparse.ArgumentParser(description="Validador de configuraciones de Tangram")
    ap.add_argument("--autotest", action="store_true", help="ejecuta las pruebas internas")
    ap.add_argument("--calibrar", action="store_true",
                    help="mide la separabilidad del catalogo y revisa los umbrales")
    ap.add_argument("--imagen", help="foto de la figura armada")
    ap.add_argument("--figura", help="slug de la figura objetivo (p.ej. cat)")
    ap.add_argument("--pesos", default="models/tangram_piezas_seg_best.pt",
                    help="pesos YOLOv8-seg")
    ap.add_argument("--figuras", default="data/figures_seed.json")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--json", action="store_true", help="salida en JSON")
    args = ap.parse_args()

    if args.autotest:
        import os
        path = args.figuras if os.path.exists(args.figuras) else None
        return 0 if autotest(path) else 1

    if args.calibrar:
        calibrar(args.figuras)
        return 0

    if not (args.imagen and args.figura):
        ap.error("indica --imagen y --figura, o usa --autotest")

    from ultralytics import YOLO   # import perezoso: el modulo no lo necesita

    figuras = cargar_figuras(args.figuras)
    if args.figura not in figuras:
        ap.error(f"figura desconocida. Disponibles: {sorted(figuras)}")

    resultado_yolo = YOLO(args.pesos).predict(args.imagen, conf=args.conf, verbose=False)[0]
    detecciones = desde_ultralytics(resultado_yolo)
    detecciones = quedarse_con_las_mejores(detecciones)

    salida = validar_configuracion(detecciones, figuras[args.figura])
    print(json.dumps(salida.to_dict(), ensure_ascii=False, indent=2) if args.json
          else salida.resumen())
    return 0 if salida.es_correcta else 2


if __name__ == "__main__":
    raise SystemExit(_main())
