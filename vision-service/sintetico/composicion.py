"""
composicion.py — coloca las 7 fichas del Tangram en figuras plausibles.

Es la mitad geométrica del generador sintético. Su trabajo es producir, sin
ninguna imagen de por medio, las **posiciones y giros de las 7 fichas** de una
figura armada: siete polígonos que se tocan por sus aristas y no se pisan, que
es exactamente la situación que el detector tiene delante cuando un niño le hace
una foto a su Tangram.

Por qué encajar por aristas y no esparcir las fichas al azar
────────────────────────────────────────────────────────────
Un montón de piezas separadas no le enseña nada al detector: lo difícil de una
figura armada es justo que las fichas **se tocan**, comparten aristas y sus
contornos se confunden entre sí. Colocarlas encajadas reproduce esa dificultad.

No hace falta que la figura resultante sea un gato o una casa. Lo que aprende el
detector es a separar siete piezas en contacto, y para eso una configuración
arbitraria vale igual que una del catálogo —y hay infinitas, que es lo que se
necesita para que no memorice—.

La geometría sale de `tangram_validator.PIEZAS_CANONICAS`
──────────────────────────────────────────────────────────
No se redefine aquí, y no es por ahorrar: si el generador usara un Tangram con
proporciones ligeramente distintas de las del validador, el modelo aprendería
fichas cuyas áreas relativas el validador rechazaría después por incoherentes
(`UMBRAL_AREA`). Los datos y el juez tienen que hablar de las mismas piezas.

Todas las fichas del Tangram son **convexas**, y de eso se aprovechan tanto la
comprobación de solape (`cv2.intersectConvexConvex`) como el encaje por aristas.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

# El validador vive en la carpeta de arriba y es la fuente de la geometría.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tangram_validator as tv  # noqa: E402

#: Nombre canónico de cada ficha -> índice de clase para YOLO.
#:
#: Es la **taxonomía de 5 clases sin color** (`tv.TAXONOMIA_5`), que es el punto
#: de todo esto: un detector que nombre las fichas por su forma y no por su
#: color funciona con cualquier juego de Tangram. `resolver_taxonomia` del
#: validador ya la reconoce, así que un modelo entrenado con estas clases entra
#: en el sistema sin tocar una línea del backend ni de la app.
CLASES: list[str] = ["large_tri", "medium_tri", "small_tri", "square", "parallelogram"]

#: De la constante interna del validador al nombre de clase del detector.
PIEZA_A_CLASE: dict[str, str] = {
    tv.TRIANGULO_GRANDE: "large_tri",
    tv.TRIANGULO_MEDIANO: "medium_tri",
    tv.TRIANGULO_PEQUENO: "small_tri",
    tv.CUADRADO: "square",
    tv.ROMBOIDE: "parallelogram",
}

#: Cuánto se toleran dos fichas pisándose, en fracción del área de la menor.
#: No es cero porque el encaje se calcula en coma flotante y dos aristas que
#: comparten línea se cruzan por milésimas.
TOLERANCIA_SOLAPE = 0.02

#: Área de las fichas dividida por el área de su casco convexo. Mide lo compacta
#: que es la figura: 1,0 sería un Tangram cerrado sin un hueco, y valores bajos
#: son fichas desparramadas que se tocan de refilón. El mínimo descarta esas
#: figuras, porque no se parecen a lo que un niño arma sobre la mesa y le
#: ahorrarían al detector justo el caso difícil —fichas pegadas por aristas
#: enteras, con el contorno de una continuando en el de la vecina—.
SOLIDEZ_MINIMA = 0.62


def _area_con_signo(poly: np.ndarray) -> float:
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _antihorario(poly: np.ndarray) -> np.ndarray:
    """Orienta el polígono en sentido antihorario.

    El encaje por aristas depende de ello: cuando dos polígonos antihorarios
    comparten una arista recorrida en sentidos opuestos, quedan por fuerza a
    lados contrarios de esa línea. Es lo que hace que la ficha nueva se apoye
    contra la figura en vez de montarse encima.
    """
    return poly if _area_con_signo(poly) > 0 else poly[::-1].copy()


def piezas_base() -> list[tuple[str, np.ndarray]]:
    """Las 7 fichas canónicas, cada una centrada en su propio origen.

    Se centran para que girarlas sea girar sobre sí mismas y no describir un
    arco alrededor del origen del cuadrado del que salieron.
    """
    piezas = []
    for nombre, poly in tv.PIEZAS_CANONICAS:
        p = _antihorario(np.asarray(poly, dtype=np.float64))
        piezas.append((nombre, p - p.mean(axis=0)))
    return piezas


def _rotar(poly: np.ndarray, angulo: float) -> np.ndarray:
    c, s = np.cos(angulo), np.sin(angulo)
    return poly @ np.array([[c, s], [-s, c]], dtype=np.float64)


def _recortar(poly: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray | None:
    """Se queda con la parte de `poly` que cae a la izquierda de la recta a→b.

    Un paso del algoritmo de Sutherland-Hodgman. Recortando un polígono contra
    todas las aristas de otro **convexo** —y las 7 fichas del Tangram lo son—,
    lo que queda es exactamente la intersección de los dos.
    """
    salida: list[np.ndarray] = []
    borde = b - a
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        lado_p = borde[0] * (p[1] - a[1]) - borde[1] * (p[0] - a[0])
        lado_q = borde[0] * (q[1] - a[1]) - borde[1] * (q[0] - a[0])
        if lado_p >= 0:
            salida.append(p)
        if (lado_p > 0) != (lado_q > 0):
            t = lado_p / (lado_p - lado_q)
            salida.append(p + t * (q - p))
    return np.asarray(salida) if len(salida) >= 3 else None


def _solape(a: np.ndarray, b: np.ndarray) -> float:
    """Área compartida por dos fichas, en fracción del área de la menor.

    Se calcula por recorte de polígonos y **no** con `cv2.intersectConvexConvex`,
    aunque el resto del proyecto la use. Aquella devolvía aquí áreas imposibles
    —hasta cuatro veces el polígono entero— para fichas encajadas por una arista,
    que es precisamente el caso que este módulo produce en cada colocación. Una
    comprobación de solape que se equivoca deja pasar figuras con dos fichas
    montadas, y esas acabarían en el dataset como verdad de referencia.
    """
    recorte: np.ndarray | None = a
    m = len(b)
    for i in range(m):
        recorte = _recortar(recorte, b[i], b[(i + 1) % m])
        if recorte is None:
            return 0.0
    menor = min(abs(_area_con_signo(a)), abs(_area_con_signo(b)))
    return 0.0 if menor <= 0 else abs(_area_con_signo(recorte)) / menor


def _area_casco(puntos: np.ndarray) -> float:
    """Área del casco convexo: lo que ocuparía la figura si fuera maciza."""
    casco = cv2.convexHull(puntos.astype(np.float32)).reshape(-1, 2)
    return abs(_area_con_signo(casco.astype(np.float64)))


def _solidez(colocadas: list[tuple[str, np.ndarray]]) -> float:
    """Cuánto del casco convexo llenan de verdad las fichas. Ver `SOLIDEZ_MINIMA`."""
    suma = sum(abs(_area_con_signo(p)) for _, p in colocadas)
    casco = _area_casco(np.vstack([p for _, p in colocadas]))
    return 0.0 if casco <= 0 else suma / casco


def _encajar(nueva: np.ndarray, i_nueva: int,
             destino: np.ndarray, i_destino: int,
             deslizamiento: float) -> np.ndarray:
    """Pega la arista `i_nueva` de una ficha contra la arista `i_destino` de otra.

    La arista de la ficha nueva se recorre **al revés** que la de destino: es lo
    que las deja pegadas por fuera en vez de superpuestas (ver `_antihorario`).
    `deslizamiento` corre la ficha a lo largo de la arista, para que dos fichas
    no queden siempre alineadas por el mismo vértice.
    """
    A = destino[i_destino]
    B = destino[(i_destino + 1) % len(destino)]
    C = nueva[i_nueva]
    D = nueva[(i_nueva + 1) % len(nueva)]

    u = B - A
    largo_u = float(np.hypot(*u))
    v = D - C
    largo_v = float(np.hypot(*v))
    if largo_u < 1e-9 or largo_v < 1e-9:
        return nueva

    # Se gira la ficha para que su arista apunte en sentido contrario a la de
    # destino, y se lleva su vértice C sobre la arista de destino.
    angulo = np.arctan2(-u[1], -u[0]) - np.arctan2(v[1], v[0])
    girada = _rotar(nueva - C, angulo)

    corrimiento = min(deslizamiento, max(0.0, largo_u - largo_v))
    apoyo = B - (u / largo_u) * corrimiento
    return girada + apoyo


def componer(rng: np.random.Generator, intentos_por_pieza: int = 220) -> list[tuple[str, np.ndarray]]:
    """Una figura completa: las 7 fichas encajadas, sin solaparse.

    Devuelve la lista en el orden en que se colocaron, con los polígonos ya
    normalizados dentro del cuadrado [0,1] y con la relación de aspecto intacta
    —deformarla cambiaría las áreas relativas de las fichas, que es justo lo que
    el validador usa para detectar detecciones absurdas—.

    Si una ficha no encuentra hueco después de `intentos_por_pieza` pruebas, se
    reinicia la figura entera. Es más simple que retroceder pieza a pieza y, en
    la práctica, ocurre poco: hay siete fichas y muchas aristas libres.
    """
    for _ in range(60):
        piezas = piezas_base()
        # Se barajan los **índices**, no la lista. `rng.shuffle` sobre una lista
        # de tuplas `(nombre, polígono)` la convierte antes en un array de
        # objetos y acaba mezclando los elementos dentro de cada par: salían
        # figuras donde el «romboide» tenía forma de cuadrado. El error era
        # además silencioso, porque ambas fichas miden 2 unidades y el inventario
        # y las áreas seguían cuadrando; solo se veía en que dos fichas se
        # montaban una encima de otra.
        piezas = [piezas[i] for i in rng.permutation(len(piezas))]

        nombre0, poly0 = piezas[0]
        colocadas: list[tuple[str, np.ndarray]] = [
            (nombre0, _rotar(poly0, rng.uniform(0, 2 * np.pi)))
        ]

        completa = True
        for nombre, poly in piezas[1:]:
            # No vale el primer hueco que aparezca: se juntan varios encajes
            # posibles y se elige **el más compacto**.
            #
            # Aceptando el primero, las fichas acababan tocándose de refilón —por
            # un vértice o por medio centímetro de arista— y la figura salía
            # desparramada, como una constelación. Una figura de Tangram armada
            # es un cuerpo sólido, y lo que tiene que aprender el detector es
            # precisamente a separar fichas que comparten aristas enteras. Un
            # dataset de piezas apenas rozándose le enseña el problema fácil.
            candidatos: list[np.ndarray] = []
            for _ in range(intentos_por_pieza):
                # Se parte de un giro cualquiera para que la arista elegida no
                # sea siempre la misma del polígono original.
                candidata = _rotar(poly, rng.uniform(0, 2 * np.pi))
                objetivo = colocadas[rng.integers(len(colocadas))][1]
                prueba = _encajar(
                    candidata, int(rng.integers(len(candidata))),
                    objetivo, int(rng.integers(len(objetivo))),
                    float(rng.uniform(0.0, 0.25)),
                )
                if all(_solape(prueba, otra) <= TOLERANCIA_SOLAPE
                       for _, otra in colocadas):
                    candidatos.append(prueba)
                    if len(candidatos) >= 14:
                        break
            if not candidatos:
                completa = False
                break
            puntos = np.vstack([p for _, p in colocadas])
            colocadas.append((nombre, min(
                candidatos, key=lambda pr: _area_casco(np.vstack([puntos, pr]))
            )))

        if completa and _solidez(colocadas) >= SOLIDEZ_MINIMA:
            return _normalizar(colocadas)

    raise RuntimeError("No se pudo componer una figura; revisa TOLERANCIA_SOLAPE.")


def _normalizar(colocadas: list[tuple[str, np.ndarray]]) -> list[tuple[str, np.ndarray]]:
    """Lleva la figura al cuadrado [0,1] sin deformarla."""
    todos = np.vstack([p for _, p in colocadas])
    minimo = todos.min(axis=0)
    extension = float((todos.max(axis=0) - minimo).max())
    if extension <= 0:
        raise RuntimeError("Figura degenerada")
    centrado = (1.0 - (todos.max(axis=0) - minimo) / extension) / 2.0
    return [(n, (p - minimo) / extension + centrado) for n, p in colocadas]
