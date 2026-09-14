"""
generar-portada.py — dibuja la portada y los iconos de la app.

Las imágenes se generan con código, y no se pegan como archivos sueltos, por una
razón práctica: los colores de las fichas están definidos en `src/theme/index.ts`
(`PIECE_COLOR`), y si allí se cambia uno, una imagen dibujada a mano queda
desincronizada sin que nada lo avise. Aquí los colores van en una sola tabla que
se compara con la del tema, y volver a generarlas es un comando.

Qué dibuja: las **siete fichas sueltas**, como recién sacadas de la caja. No una
figura ya armada. Es lo primero que ve el niño al abrir la app, y una figura
resuelta en la portada le enseña la solución antes de que empiece; las fichas
sueltas dicen «esto lo armas tú».

Estilo: el mismo del resto de la app —relleno plano, contorno negro grueso, sin
degradados ni sombras—, sobre el crema `#FCF6E8` que ya usa `app.json` como
fondo del arranque.

Uso:
    python scripts/generar-portada.py            # genera todo
    python scripts/generar-portada.py --revisar  # solo comprueba la paleta
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
ASSETS = RAIZ / "assets"
TEMA = RAIZ / "src" / "theme" / "index.ts"
FUENTE = RAIZ / "node_modules" / "@expo-google-fonts" / "archivo-black" / "400Regular" / "ArchivoBlack_400Regular.ttf"

# ─── Paleta ───────────────────────────────────────────────────────────────────
# Copiada de src/theme/index.ts. `revisar_paleta()` comprueba que siga igual, que
# es lo que evita que esto se quede atrás sin avisar.
PAPEL = "#FCF6E8"
TINTA = "#111111"

COLOR_FICHA = {
    "large_tri":     "#2F4DFF",  # cobalto
    "medium_tri":    "#E86FD0",  # ciruela
    "small_tri":     "#FA5238",  # rojo
    "square":        "#FFE01A",  # ámbar
    "parallelogram": "#00CF92",  # verde
}

# ─── Geometría del Tangram ────────────────────────────────────────────────────
# Las siete fichas de un Tangram de lado 4, cada una en coordenadas propias con
# el origen en su esquina. Las proporciones son las reales —no aproximadas—:
# el triángulo grande tiene catetos 2√2, el mediano 2 y el pequeño √2, el
# cuadrado lado √2, y el romboide lados √2 y 2. Sumadas dan exactamente 16, el
# área del cuadrado original.
R2 = math.sqrt(2)

FICHAS = {
    "large_tri":     [(0, 0), (2 * R2, 0), (0, 2 * R2)],
    "medium_tri":    [(0, 0), (2, 0), (0, 2)],
    "small_tri":     [(0, 0), (R2, 0), (0, R2)],
    "square":        [(0, 0), (R2, 0), (R2, R2), (0, R2)],
    "parallelogram": [(0, 0), (1, 1), (1, 3), (0, 2)],
}


def centrar(puntos: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Lleva el centroide del polígono al origen, para poder rotarlo en su sitio."""
    cx = sum(p[0] for p in puntos) / len(puntos)
    cy = sum(p[1] for p in puntos) / len(puntos)
    return [(x - cx, y - cy) for x, y in puntos]


def colocar(
    nombre: str, x: float, y: float, giro: float, escala: float,
) -> list[tuple[float, float]]:
    """Una ficha rotada `giro` grados y puesta en (x, y)."""
    rad = math.radians(giro)
    cos, sin = math.cos(rad), math.sin(rad)
    return [
        (x + (px * cos - py * sin) * escala, y + (px * sin + py * cos) * escala)
        for px, py in centrar(FICHAS[nombre])
    ]


# ─── Composiciones ────────────────────────────────────────────────────────────
# Cada entrada: (ficha, x, y, giro). Las coordenadas van en un lienzo de 0..100
# para poder reusar la misma composición a cualquier tamaño.
#
# La disposición está pensada, no es aleatoria: las fichas no se tocan entre sí
# —así se lee cada forma por separado, que es lo que el niño tiene que aprender a
# distinguir—, los dos triángulos grandes quedan en diagonales opuestas para que
# el conjunto no se desequilibre, y ninguna se apoya en la horizontal exacta,
# para que parezcan sueltas sobre una mesa y no un diagrama.
MARCA = [
    ("large_tri",     27, 24,  -12),
    ("medium_tri",    74, 24,   44),
    ("small_tri",     55, 45,  192),
    ("parallelogram", 24, 63,   -8),
    ("square",        70, 53,   22),
    ("large_tri",     73, 84,  168),
    ("small_tri",     41, 83,   14),
]

# El icono usa **la misma marca**, no una versión reducida.
#
# El primer intento la simplificaba a tres fichas, dando por hecho que siete
# serían ruido a 48 px. Era el diagnóstico equivocado: lo que no se leía no era
# la cantidad de piezas sino que estuvieran **dispersas**, cada una rodeada de
# fondo. Agrupadas se leen como una sola mancha con forma, que es exactamente lo
# que tiene que hacer un icono a ese tamaño.
#
# Así que aquí solo cambia el encuadre: la misma composición, más cerca y sin
# rótulo. Y tiene la ventaja de que icono y portada son reconociblemente lo
# mismo, en vez de dos dibujos que hay que aprender por separado.
ICONO = MARCA

# Cuánto se agranda cada ficha en cada uso. Van aquí, y no escritas dentro de
# cada llamada, porque la comprobación de holguras tiene que medir **con la misma
# escala** con la que se dibuja: separadas, se tocaban en el icono mientras la
# comprobación daba por buena la portada.
ESCALA_PORTADA = 1.72
ESCALA_ICONO = 1.95


def dibujar(
    composicion, lado: int, fondo: str | None, margen: float = 8.0,
    grosor: float = 2.2, escala_ficha: float = 1.0, supermuestreo: int = 4,
    alto_util: float = 1.0,
) -> Image.Image:
    """
    Dibuja una composición.

    Se dibuja a `supermuestreo`× y se reduce al final: PIL no suaviza los bordes
    de un polígono, y sin esto las diagonales —que en un Tangram son casi todas—
    salen escalonadas. Reducir con LANCZOS las deja limpias.

    `alto_util` reserva la franja de abajo para el rótulo: con 0,8 las fichas se
    reparten en el 80 % de arriba en vez de repartirse por todo el cuadro y
    quedar la mitad detrás del texto.
    """
    S = lado * supermuestreo
    im = Image.new("RGBA", (S, S), fondo if fondo else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    util = S * (100 - 2 * margen) / 100
    desfase = S * margen / 100
    k = util / 100
    ky = k * alto_util

    def a_lienzo(p):
        return (desfase + p[0] * k, desfase + p[1] * ky)

    ancho = max(1, int(grosor * supermuestreo * lado / 512))

    for ficha, x, y, giro in composicion:
        # El 5.2 convierte las unidades del Tangram (lado 4) a las del lienzo
        # (0..100) dejando aire entre fichas.
        puntos = colocar(ficha, x, y, giro, 5.2 * escala_ficha)
        # El centro de la ficha se sitúa con la escala vertical —que es la que
        # `alto_util` comprime—, pero la ficha se dibuja alrededor de él con la
        # horizontal. Así el conjunto se agrupa sin achatar las piezas: un
        # triángulo del Tangram es isósceles rectángulo, y estirado deja de
        # serlo, que es justo la forma que el niño tiene que reconocer.
        cx = desfase + x * k
        cy = desfase + y * ky
        d.polygon(
            [(cx + (px - x) * k, cy + (py - y) * k) for px, py in puntos],
            fill=COLOR_FICHA[ficha], outline=TINTA, width=ancho,
        )

    return im.resize((lado, lado), Image.LANCZOS)


def con_rotulo(im: Image.Image, altura_texto: float = 0.098) -> Image.Image:
    """
    El nombre debajo de las fichas, a dos tonos: «TANGRAM» en tinta e «IA» en
    color, que es lo que separa de un vistazo el juego de lo que lo corrige.

    El acento es el **cobalto**, no el lila de `C.accent`. El lila da 2,2:1 sobre
    el papel crema —ilegible, y ni siquiera llega al 3:1 que WCAG permite a los
    titulares—, porque en el tema es un color de *relleno*, pensado para llevar
    tinta negra encima y no para ser tinta él mismo. El cobalto da 5,41:1 y ya
    está en la paleta: es el color del triángulo grande.
    """
    if not FUENTE.exists():
        print(f"  [!] No está {FUENTE.name}: la portada sale sin rótulo.")
        return im

    lado = im.size[0]
    fuente = ImageFont.truetype(str(FUENTE), int(lado * altura_texto))
    d = ImageDraw.Draw(im)

    partes = [("TANGRAM", TINTA), ("IA", COLOR_FICHA["large_tri"])]
    anchos = [d.textlength(t, font=fuente) for t, _ in partes]
    # Un pelo de aire entre las dos palabras: sin él, la «M» y la «I» de Archivo
    # Black se tocan y se leen como una sola letra.
    hueco = lado * 0.018
    total = sum(anchos) + hueco

    _, arriba, _, _ = d.textbbox((0, 0), "TANGRAMIA", font=fuente)
    x = (lado - total) / 2
    y = lado * 0.884 - arriba

    for (texto, color), ancho in zip(partes, anchos):
        d.text((x, y), texto, font=fuente, fill=color)
        x += ancho + hueco

    return im


def revisar_solapes(composicion, escala_ficha: float, nombre: str) -> bool:
    """
    ¿Hay fichas que se toquen o se pisen?

    Se mide rasterizando, no con aritmética. Calcular la separación «a ojo» desde
    las coordenadas no funciona con triángulos: el centroide no está en el centro
    de su caja —queda a un tercio de la base—, así que el vértice sobresale mucho
    más de lo que sugiere la distancia entre centros. Dibujarlas y contar píxeles
    compartidos no se equivoca.

    Importa porque dos fichas que se rozan se leen como una sola forma rara, y la
    marca deja de decir «siete piezas sueltas» para decir «un borrón».

    No basta con que no se solapen: se exige una **holgura** mínima entre fichas.
    Dos piezas separadas por un pelo se leen igual de pegadas que dos
    superpuestas, y a 48 px, peor.
    """
    RES = 600
    HOLGURA = 2.2                      # en unidades de 0..100
    radio = max(1, int(HOLGURA * RES / 100 / 2))

    mascaras: list[tuple[str, Image.Image]] = []
    for i, (ficha, x, y, giro) in enumerate(composicion):
        m = Image.new("L", (RES, RES), 0)
        pts = [(px * RES / 100, py * RES / 100)
               for px, py in colocar(ficha, x, y, giro, 5.2 * escala_ficha)]
        ImageDraw.Draw(m).polygon(pts, fill=255)
        # Engordar la ficha media holgura por cada lado: si dos engordadas se
        # tocan, las de verdad están más cerca de `HOLGURA`.
        m = m.filter(ImageFilter.MaxFilter(radio * 2 + 1))
        mascaras.append((f"{ficha}#{i}", m))

    ok = True
    for i, (n1, m1) in enumerate(mascaras):
        for n2, m2 in mascaras[i + 1:]:
            if ImageChops.multiply(m1, m2).getbbox() is not None:
                print(f"  [JUNTAS] {n1} y {n2} — menos de {HOLGURA} de separación")
                ok = False

    print(f"  {nombre}: fichas bien separadas" if ok else f"  {nombre}: REVISAR")
    return ok


def revisar_paleta() -> bool:
    """
    Comprueba que los colores de aquí sigan siendo los de `src/theme/index.ts`.

    Existe porque el fallo que previene es silencioso: si alguien cambia el
    cobalto en el tema, la app entera cambia y la portada se queda con el color
    viejo, sin que ninguna compilación se queje.
    """
    if not TEMA.exists():
        print(f"  [!] No se encontró {TEMA}")
        return False

    fuente = TEMA.read_text(encoding="utf-8")
    nombres = dict(re.findall(r"^\s*(\w+):\s*\"(#[0-9A-Fa-f]{6})\",", fuente, re.M))
    mapeo = dict(re.findall(r"^\s*(\w+):\s*C\.(\w+),", fuente, re.M))

    ok = True
    for ficha, esperado in COLOR_FICHA.items():
        token = mapeo.get(ficha)
        real = nombres.get(token or "", "")
        if real.upper() != esperado.upper():
            print(f"  [DESFASE] {ficha}: aquí {esperado}, el tema dice {real or '?'}")
            ok = False
    print("  La paleta coincide con src/theme/index.ts" if ok else "  REVISAR la paleta")
    return ok


def main() -> int:
    if not ASSETS.exists():
        print(f"No existe {ASSETS}")
        return 1

    print("Comprobando la paleta contra el tema:")
    if not revisar_paleta():
        print("\nAbortado: corrige la paleta antes de generar nada.")
        return 1

    print("\nComprobando que las fichas no se toquen:")
    limpio = revisar_solapes(MARCA, ESCALA_PORTADA, "portada")
    limpio &= revisar_solapes(ICONO, ESCALA_ICONO, "icono")

    if "--revisar" in sys.argv:
        return 0 if limpio else 1
    if not limpio:
        print("\n[!] Hay fichas superpuestas. Se generan igual, pero revísalas.")

    print("\nGenerando:")

    # 1. Portada del arranque. Fondo transparente: `app.json` ya pinta el crema
    #    detrás (`splash.backgroundColor`), y así no hay dos cremas que puedan
    #    discrepar si alguien cambia uno de los dos.
    portada = dibujar(
        MARCA, 1024, None, margen=11, grosor=2.4,
        escala_ficha=ESCALA_PORTADA, alto_util=0.82,
    )
    portada = con_rotulo(portada)
    portada.save(ASSETS / "splash-icon.png")
    print("  assets/splash-icon.png            1024x1024  portada del arranque")

    # 2. Icono del cajón de aplicaciones. Va con fondo opaco y sin transparencia:
    #    iOS no la admite y la recorta en negro.
    icono = dibujar(ICONO, 1024, PAPEL, margen=5, grosor=2.8, escala_ficha=ESCALA_ICONO)
    icono.convert("RGB").save(ASSETS / "icon.png")
    print("  assets/icon.png                   1024x1024  icono de la app")

    # 3. Icono adaptativo de Android. El sistema lo recorta en círculo, cuadrado
    #    o pastilla según el lanzador, y solo garantiza el 66 % central: de ahí
    #    el margen del 26 %, bastante mayor que el del icono normal.
    dibujar(ICONO, 512, None, margen=20, grosor=2.8, escala_ficha=ESCALA_ICONO) \
        .save(ASSETS / "android-icon-foreground.png")
    print("  assets/android-icon-foreground.png 512x512   Android, capa de arriba")

    Image.new("RGBA", (512, 512), PAPEL).save(ASSETS / "android-icon-background.png")
    print("  assets/android-icon-background.png 512x512   Android, capa de abajo")

    # 4. Icono monocromo (Android 13+, iconos temáticos). El sistema lo tiñe con
    #    el color del fondo de pantalla y **solo lee el canal alfa**: los colores
    #    se pierden, así que se dibuja la silueta en negro plano. Con los rellenos
    #    de colores saldría una mancha sólida sin las formas.
    silueta = dibujar(
        ICONO, 432, None, margen=20, grosor=0.1, escala_ficha=ESCALA_ICONO,
    )
    plano = Image.new("RGBA", silueta.size, (0, 0, 0, 0))
    plano.paste((17, 17, 17, 255), (0, 0), silueta.split()[3])
    plano.save(ASSETS / "android-icon-monochrome.png")
    print("  assets/android-icon-monochrome.png 432x432   Android, icono temático")

    print("\nListo. Para verlas en el teléfono hay que reconstruir el APK:")
    print("  .\\construir-apk.ps1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
