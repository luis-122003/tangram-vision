"""
generar.py — construye el dataset sintético en formato YOLOv8-seg.

    python -m sintetico.generar --salida datasets/tangram_formas --train 6000 --val 800

Produce la estructura que espera Ultralytics:

    datasets/tangram_formas/
      data.yaml
      train/images/*.jpg   train/labels/*.txt
      val/images/*.jpg     val/labels/*.txt
      muestras.jpg              ← hoja de contacto para mirar con los ojos

Cada `.txt` lleva una línea por ficha:

    clase x1 y1 x2 y2 …        (coordenadas normalizadas 0..1)

Las clases son las **cinco geométricas** —sin color—, que es la taxonomía que
`tangram_validator.resolver_taxonomia` ya reconoce. Un modelo entrenado con esto
entra en el sistema cambiando el archivo de pesos, sin tocar el backend ni la
app.

Sobre el conjunto de validación
───────────────────────────────
El `val` que se genera aquí es sintético, igual que el `train`: sirve para ver
si el entrenamiento converge, **no** para saber si el modelo funciona en la
realidad. Un modelo puede acertar el 99 % de estas imágenes y fallar con una
foto de un Tangram de madera sobre una mesa. La única medida que responde a esa
pregunta es un conjunto de fotos reales anotadas a mano, y no puede salir de
aquí.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

# Permite ejecutarlo como `python -m sintetico.generar` y también sueltodesde
# la carpeta, sin que la importación relativa se rompa.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from sintetico.composicion import CLASES, componer
    from sintetico.render import cargar_fondos_reales, render
else:
    from .composicion import CLASES, componer
    from .render import cargar_fondos_reales, render


def _escribir_etiqueta(ruta: Path, anotaciones: list[tuple[int, np.ndarray]]) -> None:
    lineas = []
    for clase, poly in anotaciones:
        # YOLO rechaza el archivo entero si una coordenada se sale de [0,1]; el
        # recorte es de milésimas y solo aparece cuando la perspectiva empuja un
        # vértice justo contra el borde.
        p = np.clip(poly, 0.0, 1.0)
        coords = " ".join(f"{v:.6f}" for v in p.reshape(-1))
        lineas.append(f"{clase} {coords}")
    ruta.write_text("\n".join(lineas) + "\n", encoding="utf-8")


def _hoja_de_contacto(destino: Path, muestras: list[np.ndarray], lado: int = 220) -> None:
    """Un mosaico con las primeras muestras, para revisarlas de un vistazo.

    Existe porque un dataset sintético puede estar numéricamente perfecto y ser
    visualmente inservible —todo del mismo color, fichas flotando, fondos
    imposibles— y eso no lo detecta ninguna métrica: hay que mirarlo.
    """
    if not muestras:
        return
    n = min(len(muestras), 16)
    filas = int(np.ceil(n / 4))
    hoja = np.full((filas * lado, 4 * lado, 3), 255, dtype=np.uint8)
    for i in range(n):
        f, c = divmod(i, 4)
        hoja[f * lado:(f + 1) * lado, c * lado:(c + 1) * lado] = cv2.resize(
            muestras[i], (lado, lado), interpolation=cv2.INTER_AREA
        )
    cv2.imwrite(str(destino), hoja)


def _generar_particion(carpeta: Path, cuantas: int, lado: int,
                       rng: np.random.Generator, etiqueta: str) -> list[np.ndarray]:
    (carpeta / "images").mkdir(parents=True, exist_ok=True)
    (carpeta / "labels").mkdir(parents=True, exist_ok=True)

    primeras: list[np.ndarray] = []
    for i in range(cuantas):
        img, anotaciones = render(componer(rng), lado, rng)
        nombre = f"{etiqueta}_{i:06d}"
        cv2.imwrite(str(carpeta / "images" / f"{nombre}.jpg"), img,
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        _escribir_etiqueta(carpeta / "labels" / f"{nombre}.txt", anotaciones)
        if len(primeras) < 16:
            primeras.append(img)
        if (i + 1) % 200 == 0 or i + 1 == cuantas:
            print(f"\r  {etiqueta}: {i + 1}/{cuantas}", end="", flush=True)
    print()
    return primeras


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--salida", default="datasets/tangram_formas")
    ap.add_argument("--train", type=int, default=6000)
    ap.add_argument("--val", type=int, default=800)
    ap.add_argument("--lado", type=int, default=640,
                    help="lado de la imagen en píxeles (640 = el imgsz habitual)")
    ap.add_argument("--semilla", type=int, default=1234)
    ap.add_argument("--fondos", default=str(Path(__file__).parent / "fondos_reales"),
                    help="carpeta con superficies reales (ver sintetico/fondos.py)")
    args = ap.parse_args()

    raiz = Path(args.salida).resolve()
    raiz.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.semilla)

    # Superficies reales, si se extrajeron con `fondos.py`. Es lo que más acerca
    # las imágenes generadas a las que recibe el servicio: mesas de verdad en
    # lugar de texturas dibujadas.
    n_fondos = cargar_fondos_reales(args.fondos)
    if n_fondos:
        print(f"Usando {n_fondos} superficies reales de {args.fondos}")
    else:
        print("Sin superficies reales (solo fondos dibujados). Para añadirlas:")
        print("  python -m sintetico.fondos --dataset <dataset del U-Net>")

    print(f"Generando en {raiz}")
    muestras = _generar_particion(raiz / "train", args.train, args.lado, rng, "train")
    # Semilla distinta: si `val` saliera de la misma corriente que `train` las
    # figuras no se repetirían, pero sí compartirían el mismo sesgo de sorteo.
    _generar_particion(raiz / "val", args.val, args.lado,
                       np.random.default_rng(args.semilla + 99991), "val")

    nombres = "\n".join(f"  {i}: {c}" for i, c in enumerate(CLASES))
    # `path` va **absoluto**, y no como `.`, porque Ultralytics no lo resuelve
    # contra la carpeta del propio `data.yaml`: lo resuelve contra su directorio
    # de datasets configurado (`settings.json`), que suele apuntar a otro sitio.
    # Con `path: .` el entrenamiento aborta buscando `val/images` en una ruta que
    # no tiene nada que ver con el dataset. Por eso mismo el `data.yaml` se
    # reescribe cada vez que se genera: si la carpeta se mueve o se copia a otra
    # máquina —Colab, por ejemplo—, hay que volver a generarlo allí.
    (raiz / "data.yaml").write_text(
        "# Tangram — 7 fichas por imagen, 5 clases GEOMETRICAS (sin color).\n"
        "# Generado por vision-service/sintetico/generar.py\n"
        f"path: {raiz.as_posix()}\n"
        "train: train/images\n"
        "val: val/images\n"
        f"nc: {len(CLASES)}\n"
        f"names:\n{nombres}\n",
        encoding="utf-8",
    )
    _hoja_de_contacto(raiz / "muestras.jpg", muestras)

    print(f"\nListo: {args.train} de entrenamiento y {args.val} de validación.")
    print(f"Mira {raiz / 'muestras.jpg'} antes de entrenar nada.")
    print(f"Comprueba las anotaciones con:  python -m sintetico.verificar {raiz}")


if __name__ == "__main__":
    main()
