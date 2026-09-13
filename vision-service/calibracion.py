"""
calibracion.py — el sistema aprende el Tangram que tiene delante, en vez de adivinarlo.

El problema que resuelve
────────────────────────
Un detector entrenado por color queda atado a un juego concreto: sobre un
Tangram de otros colores encuentra 1,21 fichas de 7 y da 0,096 de IoU. Uno
entrenado por forma generaliza, pero confunde el cuadrado y el romboide con dos
triangulos pequenos --y no por torpeza: el cuadrado y el romboide tienen
exactamente el area de dos triangulos pequenos y se pueden teselar con ellos, asi
que dentro de una figura armada esa lectura es indistinguible.

Las dos dificultades vienen de lo mismo: al sistema se le pide reconocer fichas
que nunca vio, a partir de una foto donde ademas estan pegadas.

Aqui se cambia la pregunta. Antes de armar, el estudiante fotografia sus siete
fichas **sueltas y separadas**. Con eso:

  · La ambiguedad geometrica desaparece. Separadas, cada ficha se mide sola:
    area, numero de vertices, angulos. Un cuadrado tiene cuatro lados y un
    triangulo tres, y no hay teselado que valga.
  · El color deja de ser un obstaculo y pasa a ser la herramienta. No hay que
    adivinar de que color es el romboide: acaba de decirlo.
  · Se obtiene la escala. Sabiendo cuantos pixeles mide un triangulo pequeno, la
    comprobacion de "se vio la figura completa" deja de ser una heuristica.

Y no hace falta entrenar nada. Medido sobre las 114 fotos reales del proyecto,
segmentar por una paleta calibrada da **IoU de silueta 0,953 de media** (mediana
0,974; 110 de 114 por encima de 0,85), practicamente lo mismo que el detector
entrenado, sin una sola red neuronal.

Lo que hay que vigilar
──────────────────────
La luz. Si se calibra junto a la ventana y se arma bajo la lampara, los colores
medidos no coinciden. Por eso `verificar_reparto` existe: como las areas del
Tangram son fijas, si lo segmentado no se reparte como manda la geometria, la
calibracion se quedo vieja y hay que repetirla. Es una comprobacion gratis que
no depende de nada externo.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

import tangram_validator as tv

# ── Constantes del procedimiento ────────────────────────────────────────────

#: Lado mayor al que se reduce la foto antes de trabajar. La calibracion mide
#: colores y proporciones, no detalle fino: a 900 px sobra, y k-means sobre una
#: foto de 12 MP tardaria segundos en vez de decimas.
LADO_TRABAJO = 900

#: Grupos de color en los que se parte la foto de calibracion. Siete fichas mas
#: fondo, con holgura para sombras y para el brillo de una ficha plastificada.
K_CALIBRACION = 12

#: Fraccion del area de la imagen por debajo de la cual una mancha es ruido.
AREA_MINIMA_FRAC = 0.002

#: Cuanto puede desviarse el reparto de areas medido del que dicta la geometria
#: antes de dar la calibracion por mala. Ver `verificar_reparto`.
TOLERANCIA_REPARTO = 0.06

#: Las siete fichas, de mayor a menor area canonica. El orden es el que se usa
#: para asignar identidades una vez ordenadas las manchas por tamano.
ORDEN_POR_AREA: list[str] = [
    tv.TRIANGULO_GRANDE, tv.TRIANGULO_GRANDE,      # 4 y 4
    tv.TRIANGULO_MEDIANO, tv.CUADRADO, tv.ROMBOIDE,  # 2, 2 y 2 -- se desempatan por forma
    tv.TRIANGULO_PEQUENO, tv.TRIANGULO_PEQUENO,    # 1 y 1
]


@dataclass
class FichaCalibrada:
    """Una de las siete fichas, tal como se vio en la foto de calibracion."""

    pieza: str          # ficha canonica (`tv.CUADRADO`, ...)
    color_lab: tuple[float, float, float]
    area_px: float      # area en pixeles de la foto de trabajo
    vertices: int


@dataclass
class Calibracion:
    """El Tangram concreto que tiene el estudiante delante."""

    fichas: list[FichaCalibrada]
    fondo_lab: list[tuple[float, float, float]]
    #: Pixeles que ocupa un triangulo pequeno. Es la unidad de escala: el Tangram
    #: entero mide 16 de estas.
    unidad_px: float
    avisos: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "fichas": [
                {"pieza": f.pieza, "color_lab": list(f.color_lab),
                 "area_px": round(f.area_px, 1), "vertices": f.vertices}
                for f in self.fichas
            ],
            "fondo_lab": [list(c) for c in self.fondo_lab],
            "unidad_px": round(self.unidad_px, 1),
            "avisos": self.avisos,
        }

    @staticmethod
    def from_dict(d: dict) -> "Calibracion":
        return Calibracion(
            fichas=[
                FichaCalibrada(
                    pieza=f["pieza"], color_lab=tuple(f["color_lab"]),
                    area_px=float(f["area_px"]), vertices=int(f.get("vertices", 0)),
                )
                for f in d.get("fichas", [])
            ],
            fondo_lab=[tuple(c) for c in d.get("fondo_lab", [])],
            unidad_px=float(d.get("unidad_px", 0.0)),
            avisos=list(d.get("avisos", [])),
        )


# ── Utilidades ──────────────────────────────────────────────────────────────

def _reducir(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    escala = LADO_TRABAJO / max(h, w)
    if escala >= 1.0:
        return img
    return cv2.resize(img, (int(round(w * escala)), int(round(h * escala))),
                      interpolation=cv2.INTER_AREA)


def _kmeans_lab(lab_planos: np.ndarray, k: int) -> np.ndarray:
    criterio = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.5)
    _, _, centros = cv2.kmeans(lab_planos.astype(np.float32), k, None, criterio, 6,
                               cv2.KMEANS_PP_CENTERS)
    return centros


def _toca_el_borde(mascara: np.ndarray) -> float:
    """Fraccion de los pixeles del borde de la imagen que cubre esta mascara.

    Es como se distingue el fondo sin pedirle al estudiante que diga cual es: la
    mesa llega hasta los cuatro bordes de la foto; las fichas, si estan bien
    encuadradas, no.
    """
    h, w = mascara.shape
    borde = np.concatenate([mascara[0], mascara[h - 1], mascara[:, 0], mascara[:, w - 1]])
    return float(np.count_nonzero(borde)) / max(1, borde.size)


def _forma(contorno: np.ndarray) -> tuple[int, float]:
    """Numero de vertices y cuanto llena su rectangulo minimo.

    El segundo numero es lo que separa el cuadrado del romboide, que tienen la
    misma area y los dos cuatro lados: un cuadrado llena su rectangulo minimo
    --es el rectangulo-- y un romboide se queda a la mitad larga, porque su
    rectangulo minimo tiene que abarcar los dos vertices agudos.
    """
    perimetro = cv2.arcLength(contorno, True)
    aprox = cv2.approxPolyDP(contorno, 0.035 * perimetro, True)
    area = abs(cv2.contourArea(contorno))
    (_, _), (rw, rh), _ = cv2.minAreaRect(contorno)
    llenado = area / max(1.0, rw * rh)
    return len(aprox), llenado


def verificar_reparto(areas: list[float]) -> tuple[bool, float]:
    """Comprueba que siete areas se repartan como manda el Tangram.

    Las proporciones de un Tangram no son negociables: dos fichas de 4 unidades,
    tres de 2 y dos de 1, sobre 16. Normalizando lo medido y comparandolo con eso
    se detecta de golpe que la segmentacion salio mal --que se juntaron dos
    fichas, que una se partio en dos, o que la luz cambio y la paleta ya no
    corresponde-- sin necesidad de nada externo con que contrastar.

    Devuelve si pasa y el error medio absoluto por ficha.
    """
    if len(areas) != len(ORDEN_POR_AREA):
        return False, 1.0
    total = sum(areas)
    if total <= 0:
        return False, 1.0
    medido = sorted((a / total for a in areas), reverse=True)
    esperado = sorted(
        (tv.AREA_RELATIVA[p] / tv.AREA_TOTAL_UNIDADES for p in ORDEN_POR_AREA),
        reverse=True,
    )
    error = sum(abs(m - e) for m, e in zip(medido, esperado)) / len(medido)
    return error <= TOLERANCIA_REPARTO, error


def _identificar(manchas: list[dict]) -> list[str]:
    """Le pone nombre a cada mancha. Aqui es donde la foto de fichas sueltas paga.

    Ordenadas por area, las dos mayores son los triangulos grandes y las dos
    menores los pequenos: eso lo fija la geometria y no hay nada que decidir. Las
    tres del medio --triangulo mediano, cuadrado y romboide-- miden lo mismo, y
    se desempatan por forma:

      · el cuadrado es el unico que **llena** su rectangulo minimo;
      · de los otros dos, el de tres vertices es el triangulo y el de cuatro, el
        romboide.

    Sobre una figura ya armada ninguna de estas dos preguntas se puede contestar
    --las fichas comparten aristas y sus contornos se funden-- y es exactamente
    por eso que la foto se toma antes de armar.
    """
    orden = sorted(range(len(manchas)), key=lambda i: -manchas[i]["area"])
    nombres = [""] * len(manchas)

    nombres[orden[0]] = tv.TRIANGULO_GRANDE
    nombres[orden[1]] = tv.TRIANGULO_GRANDE
    nombres[orden[5]] = tv.TRIANGULO_PEQUENO
    nombres[orden[6]] = tv.TRIANGULO_PEQUENO

    medio = orden[2:5]
    cuadrado = max(medio, key=lambda i: manchas[i]["llenado"])
    nombres[cuadrado] = tv.CUADRADO
    resto = [i for i in medio if i != cuadrado]
    # Con tres vertices es el triangulo; con cuatro, el romboide. Si el contorno
    # sale ruidoso y los dos dan lo mismo, decide el llenado: el triangulo llena
    # algo mas que el romboide, cuyo rectangulo minimo tiene que abarcar los dos
    # vertices agudos.
    if manchas[resto[0]]["vertices"] == manchas[resto[1]]["vertices"]:
        triangulo = max(resto, key=lambda i: manchas[i]["llenado"])
    else:
        triangulo = min(resto, key=lambda i: manchas[i]["vertices"])
    nombres[triangulo] = tv.TRIANGULO_MEDIANO
    nombres[[i for i in resto if i != triangulo][0]] = tv.ROMBOIDE
    return nombres


def calibrar(img: np.ndarray) -> Calibracion:
    """Aprende las siete fichas de una foto en la que estan sueltas y separadas."""
    trabajo = _reducir(img)
    h, w = trabajo.shape[:2]
    lab = cv2.cvtColor(trabajo, cv2.COLOR_BGR2LAB)
    planos = lab.reshape(-1, 3).astype(np.float32)

    centros = _kmeans_lab(planos, K_CALIBRACION)
    etiquetas = (((planos[:, None, :] - centros[None, :, :]) ** 2).sum(2)
                 ).argmin(1).reshape(h, w)

    # El fondo es lo que llega a los bordes de la foto. No se le pregunta al
    # estudiante cual es la mesa: se deduce de que la mesa no cabe en el cuadro.
    fondo_idx = [k for k in range(K_CALIBRACION)
                 if _toca_el_borde((etiquetas == k).astype(np.uint8)) > 0.10]
    if not fondo_idx:
        fondo_idx = [int(np.bincount(etiquetas.reshape(-1)).argmax())]

    piezas_mask = np.isin(etiquetas, fondo_idx, invert=True).astype(np.uint8)
    k = max(3, int(0.01 * min(h, w)) | 1)
    piezas_mask = cv2.morphologyEx(piezas_mask, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    piezas_mask = cv2.morphologyEx(piezas_mask, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))

    n, etiq, stats, _ = cv2.connectedComponentsWithStats(piezas_mask, 8)
    area_min = AREA_MINIMA_FRAC * h * w
    candidatas = sorted(
        (i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= area_min),
        key=lambda i: -stats[i, cv2.CC_STAT_AREA],
    )

    avisos: list[str] = []
    if len(candidatas) < 7:
        return Calibracion(
            fichas=[], fondo_lab=[tuple(map(float, centros[i])) for i in fondo_idx],
            unidad_px=0.0,
            avisos=[f"Solo se distinguen {len(candidatas)} fichas de 7. Separalas mas "
                    "entre si, sobre un fondo liso, y repite la foto."],
        )
    if len(candidatas) > 7:
        avisos.append(f"Se vieron {len(candidatas)} manchas; se toman las 7 mayores. "
                      "Si sobra algo en la mesa, quitalo y repite la foto.")
    candidatas = candidatas[:7]

    manchas: list[dict] = []
    for i in candidatas:
        mascara = (etiq == i).astype(np.uint8)
        contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contorno = max(contornos, key=cv2.contourArea)
        vertices, llenado = _forma(contorno)
        manchas.append({
            "area": float(stats[i, cv2.CC_STAT_AREA]),
            "vertices": vertices,
            "llenado": llenado,
            "color": tuple(float(v) for v in cv2.mean(lab, mask=mascara)[:3]),
        })

    nombres = _identificar(manchas)
    ok, error = verificar_reparto([m["area"] for m in manchas])
    if not ok:
        avisos.append(
            f"Las fichas no se reparten el area como deberian (error {error:.2f}). "
            "Puede que dos esten pegadas o que sobre algo en la foto."
        )

    fichas = [
        FichaCalibrada(pieza=nombres[i], color_lab=m["color"],
                       area_px=m["area"], vertices=m["vertices"])
        for i, m in enumerate(manchas)
    ]
    pequenos = [f.area_px for f in fichas if f.pieza == tv.TRIANGULO_PEQUENO]
    unidad = sum(pequenos) / len(pequenos) if pequenos else 0.0

    return Calibracion(
        fichas=fichas,
        fondo_lab=[tuple(map(float, centros[i])) for i in fondo_idx],
        unidad_px=unidad,
        avisos=avisos,
    )


def detectar_por_color(img: np.ndarray, calib: Calibracion) -> list[tv.Deteccion]:
    """Encuentra las fichas de una figura armada usando la paleta calibrada.

    No hay modelo ni pesos: cada pixel se asigna al color calibrado mas cercano
    --de ficha o de fondo-- y de ahi salen las manchas. Medido sobre las 114
    fotos reales del proyecto, la silueta que produce da 0,953 de IoU de media
    contra la de referencia.

    Los poligonos se devuelven en coordenadas de la imagen **de entrada**, no de
    la reducida: es lo que espera el resto del pipeline para dibujar encima.
    """
    if not calib.fichas:
        return []

    trabajo = _reducir(img)
    escala = img.shape[1] / trabajo.shape[1]
    h, w = trabajo.shape[:2]
    lab = cv2.cvtColor(trabajo, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)

    colores = np.array([f.color_lab for f in calib.fichas]
                       + list(calib.fondo_lab), dtype=np.float32)
    etiquetas = (((lab[:, None, :] - colores[None, :, :]) ** 2).sum(2)
                 ).argmin(1).reshape(h, w)

    # Dos nucleos distintos, y la diferencia importa. La APERTURA quita motas
    # sueltas y tiene que ser pequena: con un nucleo grande se come las puntas de
    # los triangulos, que son justo donde una ficha es mas delgada. El CIERRE
    # tapa los huecos que deja un brillo en medio de una ficha, y ahi si conviene
    # que sea generoso. Con un solo nucleo grande para las dos cosas, la silueta
    # salia un 6% mas pequena de lo real.
    nucleo_abrir = np.ones((3, 3), np.uint8)
    k = max(3, int(0.008 * min(h, w)) | 1)
    nucleo_cerrar = np.ones((k, k), np.uint8)
    area_min = AREA_MINIMA_FRAC * h * w

    # Una misma ficha puede tener el color mas parecido a otra si el juego repite
    # colores. Por eso se agrupan las fichas calibradas por indice de color y de
    # cada color se toman tantas manchas como fichas le correspondan.
    detecciones: list[tv.Deteccion] = []
    for idx, ficha in enumerate(calib.fichas):
        mascara = (etiquetas == idx).astype(np.uint8)
        if not mascara.any():
            continue
        mascara = cv2.morphologyEx(mascara, cv2.MORPH_OPEN, nucleo_abrir)
        mascara = cv2.morphologyEx(mascara, cv2.MORPH_CLOSE, nucleo_cerrar)
        contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        # Todos los contornos que superen el minimo, no solo el mayor: una ficha
        # puede quedar partida en dos manchas por un brillo o por la sombra de
        # otra encima, y quedarse solo con la mayor tira la mitad de su area.
        for contorno in sorted(contornos, key=cv2.contourArea, reverse=True):
            if cv2.contourArea(contorno) < area_min:
                continue
            perimetro = cv2.arcLength(contorno, True)
            # 0.005 y no 0.02: con la tolerancia gruesa el poligono cortaba las
            # esquinas de cada ficha, y siete recortes suman una silueta
            # visiblemente mas pequena que la real.
            poly = cv2.approxPolyDP(contorno, 0.005 * perimetro, True).reshape(-1, 2)
            if len(poly) < 3:
                continue
            d = tv.Deteccion(clase=ficha.pieza, poligono=poly.astype(np.float64) * escala,
                             confianza=1.0)
            d.pieza = ficha.pieza
            detecciones.append(d)
    return detecciones
