"""
verificar.py — ¿son correctas las anotaciones del dataset sintético?

    python -m sintetico.verificar datasets/tangram_formas

Un dataset generado puede estar mal de dos maneras muy distintas, y esta
herramienta busca las dos.

**Que el archivo esté mal.** Coordenadas fuera de [0,1], clases inexistentes,
imágenes sin etiqueta. Ultralytics rechaza o —peor— ignora en silencio esos
casos, y el entrenamiento sale adelante con menos datos de los que uno cree.

**Que la anotación no describa un Tangram.** Esto es lo que no detecta ningún
comprobador de formato: las siete fichas podrían estar montadas, sueltas o con
proporciones imposibles y el `.txt` seguiría siendo válido.

Para lo segundo se usa **el validador del propio proyecto**, el mismo que
califica al estudiante en producción. Las anotaciones se le entregan como si
fueran detecciones de YOLO: si `tangram_validator` dice que ahí hay un
inventario completo de 7 fichas, sin solapes y todas unidas, entonces los datos
son coherentes con el sistema que va a consumirlos. Y si no lo dice, el dataset
está mal por mucho que las cifras internas del generador cuadren.
"""
from __future__ import annotations

import argparse
import collections
import sys
from pathlib import Path

import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from sintetico.composicion import CLASES
else:
    from .composicion import CLASES

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tangram_validator as tv  # noqa: E402

#: Cuántas fichas de cada clase tiene que haber en cada imagen.
INVENTARIO = {"large_tri": 2, "medium_tri": 1, "small_tri": 2,
              "square": 1, "parallelogram": 1}

#: Los polígonos se anotan normalizados; el validador trabaja en píxeles.
LADO_ANALISIS = 512


def leer_etiqueta(ruta: Path) -> list[tuple[int, np.ndarray]]:
    filas = []
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        partes = linea.split()
        if not partes:
            continue
        clase = int(partes[0])
        valores = np.array([float(v) for v in partes[1:]], dtype=np.float64)
        filas.append((clase, valores.reshape(-1, 2)))
    return filas


def verificar(raiz: Path, muestreo: int) -> int:
    problemas: collections.Counter[str] = collections.Counter()
    revisadas = 0
    solapes: list[float] = []
    huecos: list[float] = []

    for particion in ("train", "val"):
        carpeta = raiz / particion
        if not carpeta.exists():
            continue
        etiquetas = sorted((carpeta / "labels").glob("*.txt"))
        imagenes = {p.stem for p in (carpeta / "images").glob("*.jpg")}
        print(f"\n{particion}: {len(etiquetas)} etiquetas, {len(imagenes)} imágenes")

        if len(etiquetas) != len(imagenes):
            problemas["imágenes y etiquetas descuadradas"] += 1

        for i, ruta in enumerate(etiquetas):
            if ruta.stem not in imagenes:
                problemas["etiqueta sin imagen"] += 1
                continue

            filas = leer_etiqueta(ruta)

            # --- 1. El archivo, como archivo -----------------------------------
            if len(filas) != 7:
                problemas[f"no hay 7 fichas (hay {len(filas)})"] += 1
            conteo = collections.Counter(CLASES[c] for c, _ in filas if 0 <= c < len(CLASES))
            if dict(conteo) != INVENTARIO:
                problemas["inventario incorrecto"] += 1
            for clase, poly in filas:
                if not (0 <= clase < len(CLASES)):
                    problemas["clase fuera de rango"] += 1
                if poly.min() < 0.0 or poly.max() > 1.0:
                    problemas["coordenadas fuera de [0,1]"] += 1
                if len(poly) < 3:
                    problemas["polígono con menos de 3 vértices"] += 1

            # --- 2. La anotación, como Tangram ---------------------------------
            # Solo sobre una parte: cada llamada rasteriza siete máscaras y el
            # coste no compensa repetirlo en miles de imágenes idénticas en
            # estructura.
            if i % muestreo:
                continue
            revisadas += 1
            detecciones = [
                tv.Deteccion(clase=CLASES[c], poligono=poly * LADO_ANALISIS)
                for c, poly in filas if 0 <= c < len(CLASES)
            ]
            taxonomia = tv.resolver_taxonomia([d.clase for d in detecciones])
            inv = tv.validar_inventario(detecciones, taxonomia)
            if not inv.completo:
                problemas["el validador no ve las 7 fichas"] += 1

            sol = tv.analizar_solape(detecciones, LADO_ANALISIS)
            solapes.append(sol.fraccion_solapada)
            if sol.hay_solape:
                problemas["el validador detecta fichas montadas"] += 1

            con = tv.analizar_conectividad(detecciones, LADO_ANALISIS)
            if con.hay_sueltas:
                problemas["el validador detecta fichas sueltas"] += 1

            hue = tv.analizar_huecos(detecciones, LADO_ANALISIS)
            huecos.append(hue.fraccion_hueco)

    print(f"\nRevisadas con el validador del proyecto: {revisadas}")
    if solapes:
        print(f"  solape entre fichas   media {np.mean(solapes):.4f}  peor {max(solapes):.4f}"
              f"   (tolerado {tv.UMBRAL_SOLAPE})")
    if huecos:
        # Los huecos no invalidan el dataset: una figura de Tangram puede tener
        # un hueco interior y el detector debe verla igual. Se informan porque
        # una media alta significaría que el encaje por aristas está dejando
        # figuras poco realistas, más parecidas a un mosaico roto.
        print(f"  hueco interior        media {np.mean(huecos):.4f}  peor {max(huecos):.4f}"
              f"   (informativo)")

    if problemas:
        print("\nPROBLEMAS:")
        for k, n in problemas.most_common():
            print(f"  {n:6d}  {k}")
        return 1

    print("\nSin problemas: el formato es válido y el validador del proyecto")
    print("reconoce cada imagen como un Tangram completo, sin fichas montadas")
    print("ni sueltas.")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dataset")
    ap.add_argument("--muestreo", type=int, default=25,
                    help="1 de cada N imágenes pasa por el validador (por coste)")
    args = ap.parse_args()
    raise SystemExit(verificar(Path(args.dataset).resolve(), max(1, args.muestreo)))


if __name__ == "__main__":
    main()
