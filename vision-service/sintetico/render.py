"""
render.py — convierte una figura compuesta en una foto verosímil.

Es la mitad visual del generador. Recibe las 7 fichas ya colocadas
(`composicion.componer`) y produce la imagen más las anotaciones de segmentación
que le corresponden, exactas por construcción: no se dibuja nada que no salga
del mismo polígono que se anota.

Todo lo que aquí se sortea al azar existe por una razón concreta
────────────────────────────────────────────────────────────────
El modelo que hay hoy en producción distingue las fichas **por su color**
(`large_tri_orange`, `small_tri_blue`…), y eso lo ata a un juego de Tangram
concreto: con fichas de madera, de otro color o de cartón, no sirve. Peor aún,
en el propio pipeline hay una función dedicada a fundir detecciones duplicadas
porque *un reflejo* basta para que la misma ficha salga con dos etiquetas
distintas. Cuando el color decide, un brillo cambia el diagnóstico.

De ahí que aquí el color sea deliberadamente **inestable**: cada muestra sortea
paleta, material, fondo, luz y sombras, y en una fracción de las muestras las
siete fichas comparten un mismo color, o la imagen va en gris. Al modelo se le
retira la posibilidad de apoyarse en el color, y la única señal que le queda
constante es la forma —que es justo lo que define a una ficha de Tangram—.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .composicion import CLASES, PIEZA_A_CLASE

#: Se dibuja al doble de resolución y se reduce al final. Es la forma barata de
#: tener bordes suavizados: `fillPoly` no sabe hacer antialiasing en polígonos
#: rellenos, y un borde de sierra es una pista falsa que el detector aprendería.
SUPERMUESTREO = 2

#: Superficies reales extraídas de fotos con `fondos.py`. Se llenan al arrancar
#: el generador y son, con diferencia, la parte menos sintética de la imagen:
#: mesas de verdad, con su veta, su barniz y las sombras de la lámpara del
#: comedor. Si la carpeta está vacía, todo sigue funcionando con los fondos
#: dibujados, solo que más lejos de una foto real.
_FONDOS_REALES: list[np.ndarray] = []

#: Con qué frecuencia se usa una superficie real habiendo alguna. No es 1,0 a
#: propósito: son ~114 mesas y repetirlas en cada muestra enseñaría al modelo
#: esas mesas concretas. Mezcladas con las procedurales, aportan realismo sin
#: convertirse en una pista.
PROB_FONDO_REAL = 0.55


def cargar_fondos_reales(carpeta: Path | str) -> int:
    """Carga las superficies reales en memoria. Devuelve cuántas encontró."""
    _FONDOS_REALES.clear()
    ruta = Path(carpeta)
    if not ruta.is_dir():
        return 0
    for archivo in sorted(ruta.glob("*.jpg")):
        img = cv2.imread(str(archivo))
        if img is not None:
            _FONDOS_REALES.append(img)
    return len(_FONDOS_REALES)


def _fondo_real(rng: np.random.Generator, alto: int, ancho: int) -> np.ndarray:
    """Un trozo de mesa real, recortado y volteado al azar."""
    base = _FONDOS_REALES[int(rng.integers(len(_FONDOS_REALES)))]
    h, w = base.shape[:2]
    # Un recorte de entre el 55 % y el 100 %: así una misma mesa da encuadres
    # distintos y no se repite el mismo nudo de la madera en la misma esquina.
    corte = int(min(h, w) * rng.uniform(0.55, 1.0))
    y0 = int(rng.integers(0, max(1, h - corte)))
    x0 = int(rng.integers(0, max(1, w - corte)))
    trozo = base[y0:y0 + corte, x0:x0 + corte]
    trozo = cv2.resize(trozo, (ancho, alto), interpolation=cv2.INTER_LINEAR)
    if rng.random() < 0.5:
        trozo = trozo[:, ::-1]
    if rng.random() < 0.5:
        trozo = trozo[::-1, :]
    return trozo.astype(np.float64) * rng.uniform(0.75, 1.2)


def _ruido(rng: np.random.Generator, alto: int, ancho: int, escala: int) -> np.ndarray:
    """Ruido suave en [0,1], para texturas y manchas de iluminación."""
    pequeno = rng.random((max(2, alto // escala), max(2, ancho // escala)))
    return cv2.resize(pequeno, (ancho, alto), interpolation=cv2.INTER_CUBIC)


def _color_aleatorio(rng: np.random.Generator, familia: str) -> np.ndarray:
    """Un color BGR según la familia de material que toque en esta muestra."""
    if familia == "gris":
        v = rng.integers(40, 215)
        return np.array([v, v, v], dtype=np.float64)
    if familia == "madera":
        # Tonos tierra: mucho rojo, menos verde, poco azul.
        return np.array([rng.integers(40, 110), rng.integers(90, 160),
                         rng.integers(130, 210)], dtype=np.float64)
    if familia == "pastel":
        base = rng.integers(150, 245, size=3)
        return base.astype(np.float64)
    # "vivo": saturado, como el acrílico del juego original
    hsv = np.uint8([[[rng.integers(0, 180), rng.integers(150, 256),
                      rng.integers(160, 256)]]])
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0, 0].astype(np.float64)


def estilo(rng: np.random.Generator) -> dict:
    """Sortea el aspecto de una muestra: material, fondo, luz, borde y sombra."""
    familia = rng.choice(["vivo", "madera", "pastel", "gris"], p=[0.4, 0.25, 0.2, 0.15])
    return {
        "familia": familia,
        # Que las 7 fichas compartan color es el caso más duro y el más
        # instructivo: solo el contorno separa una ficha de su vecina.
        "monocromo": bool(rng.random() < 0.22),
        "borde": bool(rng.random() < 0.65),
        "grosor_borde": int(rng.integers(1, 4)),
        "sombra": bool(rng.random() < 0.7),
        # Papel manda porque es lo que la app le pide al niño; el resto existe
        # para cuando no hace caso (ver `_fondo`).
        "superficie": str(rng.choice(["papel", "madera", "mesa"], p=[0.5, 0.25, 0.25])),
        "desenfoque": float(rng.uniform(0, 1.6)),
        "ruido": float(rng.uniform(0, 9)),
        "jpeg": int(rng.integers(45, 96)),
    }


def _fondo(rng: np.random.Generator, alto: int, ancho: int, est: dict) -> np.ndarray:
    """La superficie sobre la que está armado el Tangram.

    El reparto no es caprichoso: la app le pide al niño que arme **sobre una
    hoja blanca y con buena luz**, así que ese es el caso que más aparece. Pero
    la mitad de las veces nadie hace caso y la figura acaba sobre la mesa, así
    que hay también madera con veta y superficies con grano. Un dataset donde
    todos los fondos fueran papel enseñaría al detector que lo que no es blanco
    es ficha.
    """
    if _FONDOS_REALES and rng.random() < PROB_FONDO_REAL:
        return _fondo_real(rng, alto, ancho)

    superficie = est["superficie"]

    if superficie == "papel":
        base = float(rng.integers(200, 252))
        img = np.full((alto, ancho, 3), base) + rng.integers(-6, 7, size=3)
        # Grano finísimo: el papel no es una superficie plana perfecta, y sin
        # nada de textura la imagen se ve sintética a simple vista.
        img *= (0.985 + 0.03 * _ruido(rng, alto, ancho, 3))[..., None]
        return img

    if superficie == "madera":
        base = np.array([rng.integers(55, 105), rng.integers(95, 150),
                         rng.integers(135, 195)], dtype=np.float64)
        img = np.broadcast_to(base, (alto, ancho, 3)).copy()
        # Vetas: franjas paralelas en una dirección, no manchas. Es lo que
        # distingue una mesa de madera de un ruido cualquiera.
        ang = rng.uniform(0, np.pi)
        yy, xx = np.mgrid[0:alto, 0:ancho].astype(np.float64)
        proy = np.cos(ang) * xx + np.sin(ang) * yy
        veta = 0.9 + 0.1 * np.sin(proy / rng.uniform(3.0, 14.0))
        veta *= 0.93 + 0.14 * _ruido(rng, alto, ancho, 30)
        return img * veta[..., None]

    # "mesa": superficie lisa de cualquier color, con suciedad suave.
    base = float(rng.integers(40, 210))
    img = np.full((alto, ancho, 3), base) + rng.integers(-18, 19, size=3)
    img *= (0.9 + 0.2 * _ruido(rng, alto, ancho, int(rng.integers(25, 80))))[..., None]
    return img


def _iluminacion(rng: np.random.Generator, alto: int, ancho: int) -> np.ndarray:
    """Gradiente suave: una parte de la foto más iluminada que la otra."""
    yy, xx = np.mgrid[0:alto, 0:ancho].astype(np.float64)
    ang = rng.uniform(0, 2 * np.pi)
    rampa = (np.cos(ang) * xx / ancho + np.sin(ang) * yy / alto)
    fuerza = rng.uniform(0.05, 0.35)
    # `np.ptp(x)` y no `x.ptp()`: numpy 2 retiró el método del array.
    campo = 1.0 - fuerza / 2 + fuerza * (rampa - rampa.min()) / max(1e-9, float(np.ptp(rampa)))
    campo *= 0.9 + 0.2 * _ruido(rng, alto, ancho, 40)
    return campo[..., None]


def _perspectiva(rng: np.random.Generator, lado: int, fuerza: float) -> np.ndarray:
    """Homografía suave: la foto casi nunca se toma perpendicular a la mesa."""
    origen = np.float32([[0, 0], [lado, 0], [lado, lado], [0, lado]])
    d = fuerza * lado
    destino = origen + rng.uniform(-d, d, size=(4, 2)).astype(np.float32)
    return cv2.getPerspectiveTransform(origen, destino)


def _aplicar(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    homog = np.hstack([pts, np.ones((len(pts), 1))])
    proy = homog @ H.T
    return proy[:, :2] / proy[:, 2:3]


def render(figura: list[tuple[str, np.ndarray]], lado: int,
           rng: np.random.Generator) -> tuple[np.ndarray, list[tuple[int, np.ndarray]]]:
    """Dibuja la figura y devuelve `(imagen, [(clase, polígono normalizado)])`.

    Los polígonos que se devuelven son los mismos que se han pintado, pasados por
    la misma homografía: la anotación no puede desalinearse del dibujo porque no
    hay dos caminos, hay uno.
    """
    est = estilo(rng)
    S = lado * SUPERMUESTREO
    lienzo = _fondo(rng, S, S, est)

    # La figura ocupa una parte del encuadre y se descentra un poco, como una
    # foto de verdad. El margen impide que una ficha se salga: una anotación
    # cortada enseñaría al detector que media ficha es una ficha entera.
    ocupacion = rng.uniform(0.45, 0.82)
    margen = (1 - ocupacion) / 2
    desplazamiento = np.array([
        rng.uniform(-margen * 0.6, margen * 0.6),
        rng.uniform(-margen * 0.6, margen * 0.6),
    ])

    H = _perspectiva(rng, S, rng.uniform(0.0, 0.055))

    piezas: list[tuple[int, np.ndarray]] = []
    for nombre, poly in figura:
        p = (poly * ocupacion + margen + desplazamiento) * S
        piezas.append((CLASES.index(PIEZA_A_CLASE[nombre]), _aplicar(H, p)))

    # Sombra primero, para que caiga debajo de todas las fichas.
    if est["sombra"]:
        capa = np.zeros((S, S), dtype=np.float64)
        salto = rng.uniform(0.004, 0.02) * S
        direccion = rng.uniform(0, 2 * np.pi)
        offset = np.array([np.cos(direccion), np.sin(direccion)]) * salto
        for _, poly in piezas:
            cv2.fillPoly(capa, [np.round(poly + offset).astype(np.int32)], 1.0)
        capa = cv2.GaussianBlur(capa, (0, 0), max(1.0, salto * 0.8))
        lienzo *= (1.0 - rng.uniform(0.15, 0.45) * capa)[..., None]

    color_comun = _color_aleatorio(rng, est["familia"])
    color_borde = np.array([rng.integers(0, 60)] * 3, dtype=np.float64)
    for _, poly in piezas:
        color = color_comun if est["monocromo"] else _color_aleatorio(rng, est["familia"])
        entero = np.round(poly).astype(np.int32)
        cv2.fillPoly(lienzo, [entero], color.tolist())
        if est["borde"]:
            cv2.polylines(lienzo, [entero], True, color_borde.tolist(),
                          est["grosor_borde"] * SUPERMUESTREO, cv2.LINE_AA)

    if est["familia"] == "madera":
        # Vetas sobre las fichas: es lo que distingue la madera del acrílico, y
        # sin ellas «madera» sería solo un color marrón.
        #
        # Se aplican **solo dentro de las fichas**. Multiplicándolas sobre la
        # imagen entera, la veta del fondo parecía continuar a través de las
        # piezas y estas se veían translúcidas, como de celofán: un material que
        # no existe en ningún Tangram y que el modelo no debería aprender.
        dentro = np.zeros((S, S), dtype=np.uint8)
        for _, poly in piezas:
            cv2.fillPoly(dentro, [np.round(poly).astype(np.int32)], 1)
        vetas = 0.88 + 0.24 * _ruido(rng, S, S, int(rng.integers(3, 14)))
        lienzo *= np.where(dentro[..., None] > 0, vetas[..., None], 1.0)

    lienzo *= _iluminacion(rng, S, S)

    img = cv2.resize(lienzo, (lado, lado), interpolation=cv2.INTER_AREA)
    if est["desenfoque"] > 0.2:
        img = cv2.GaussianBlur(img, (0, 0), est["desenfoque"])
    if est["ruido"] > 0.5:
        img += rng.normal(0, est["ruido"], img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)

    # Compresión: las fotos llegan al servidor como JPEG, con sus artefactos.
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, est["jpeg"]])
    if ok:
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)

    anotaciones = [(c, poly / (lado * SUPERMUESTREO)) for c, poly in piezas]
    return img, anotaciones
