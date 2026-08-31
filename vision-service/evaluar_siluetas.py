"""
evaluar_siluetas.py — ¿aportaba algo el U-Net? Medido sobre fotos reales.

El proyecto retiró el U-Net/ResNet34 y pasó a sacar la silueta de la unión de
las máscaras que YOLOv8-seg ya devuelve. Ese cambio se justificó por argumentos
—un modelo menos, sin TensorFlow, y una máscara no explica *por qué* está mal un
armado— pero no con números sobre las fotos del proyecto. Este script produce
esos números.

Para cada foto calcula el mismo IoU contra la misma silueta objetivo por las dos
vías, y las contrasta:

    A) unión de las máscaras de YOLOv8-seg   (la que califica hoy)
    B) segmentación directa con el U-Net     (la que se retiró)

Uso
───
Las fotos van en subcarpetas con el slug de la figura que se estaba armando:

    fotos/
      house/   IMG_001.jpg  IMG_002.jpg …
      cat/     IMG_010.jpg …

    python evaluar_siluetas.py fotos/
    python evaluar_siluetas.py fotos/ --csv resultados.csv

Lo que hay que mirar
────────────────────
`delta` es IoU(U-Net) − IoU(YOLO) por foto. Su media dice cuál de las dos
siluetas se acercó más a la figura objetivo; el *acuerdo* dice con qué
frecuencia las dos habrían dado el mismo veredicto al estudiante, que es lo que
de verdad importa: dos vías que califican igual son intercambiables, y entonces
la más barata gana.
"""
from __future__ import annotations

import argparse
import csv
import os
import statistics
import sys
import time

import cv2
import numpy as np

import pipeline
import tangram_validator as tv

EXTENSIONES = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def fotos_de(carpeta: str) -> list[tuple[str, str]]:
    """Devuelve [(slug, ruta)] recorriendo las subcarpetas por slug."""
    encontradas: list[tuple[str, str]] = []
    for slug in sorted(os.listdir(carpeta)):
        sub = os.path.join(carpeta, slug)
        if not os.path.isdir(sub):
            continue
        for nombre in sorted(os.listdir(sub)):
            if nombre.lower().endswith(EXTENSIONES):
                encontradas.append((slug, os.path.join(sub, nombre)))
    return encontradas


def main() -> int:
    # La consola de Windows va en cp1252 y no sabe escribir «─», «Δ» ni las
    # tildes de esta ayuda: sin esto, `--help` termina en UnicodeEncodeError.
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("carpeta", help="carpeta con subcarpetas nombradas por slug de figura")
    ap.add_argument("--figuras", default="data/figures_seed.json",
                    help="catálogo con las siluetas objetivo")
    ap.add_argument("--pesos", default=os.environ.get("YOLO_WEIGHTS", "models/tangram_piezas_seg_best.pt"))
    ap.add_argument("--conf", type=float, default=float(os.environ.get("YOLO_CONF", "0.35")))
    ap.add_argument("--imgsz", type=int, default=int(os.environ.get("YOLO_IMGSZ", "960")))
    ap.add_argument("--csv", help="guarda el detalle por foto en este archivo")
    args = ap.parse_args()

    if not os.path.isdir(args.carpeta):
        print(f"No existe la carpeta '{args.carpeta}'", file=sys.stderr)
        return 1

    figuras = tv.cargar_figuras(args.figuras)
    imagenes = fotos_de(args.carpeta)
    if not imagenes:
        print(f"No se encontró ninguna foto en '{args.carpeta}'.", file=sys.stderr)
        print("Se esperan subcarpetas nombradas por slug: fotos/house/*.jpg", file=sys.stderr)
        return 1

    desconocidos = {s for s, _ in imagenes} - set(figuras)
    if desconocidos:
        print(f"Slugs que no están en el catálogo y se omitirán: {sorted(desconocidos)}")
        imagenes = [(s, r) for s, r in imagenes if s not in desconocidos]

    print(f"Cargando modelos… ({len(imagenes)} fotos, {len({s for s, _ in imagenes})} figuras)")
    from ultralytics import YOLO
    yolo = YOLO(args.pesos)
    import unet_silueta
    unet_silueta.cargar()
    print("Listo.\n")

    filas: list[dict] = []
    for i, (slug, ruta) in enumerate(imagenes, 1):
        img = cv2.imread(ruta)
        if img is None:
            print(f"  [!] no se pudo leer {ruta}")
            continue
        objetivo = np.asarray(figuras[slug]["silhouette"], dtype=np.float64)
        fila = {"slug": slug, "foto": os.path.basename(ruta),
                "iou_yolo": None, "iou_unet": None, "delta": None,
                "ms_yolo": 0, "ms_unet": 0, "piezas": 0, "error": ""}

        # --- Vía A: unión de las máscaras del detector -----------------------
        t0 = time.time()
        try:
            det = yolo.predict(source=img, conf=args.conf, imgsz=args.imgsz,
                               max_det=30, verbose=False)
            piezas, _ = pipeline.desde_yolo(det[0]) if det else ([], [])
            piezas = pipeline.descartar_duplicados(piezas)
            fila["piezas"] = len(piezas)
            if piezas:
                fila["iou_yolo"] = tv.comparar_siluetas(
                    tv.silueta_union(piezas), objetivo).iou
        except Exception as e:
            fila["error"] += f"yolo:{type(e).__name__} "
        fila["ms_yolo"] = int((time.time() - t0) * 1000)

        # --- Vía B: segmentación con el U-Net -------------------------------
        t0 = time.time()
        try:
            fila["iou_unet"] = tv.comparar_siluetas(
                unet_silueta.silueta_unet(img), objetivo).iou
        except Exception as e:
            fila["error"] += f"unet:{type(e).__name__} "
        fila["ms_unet"] = int((time.time() - t0) * 1000)

        if fila["iou_yolo"] is not None and fila["iou_unet"] is not None:
            fila["delta"] = fila["iou_unet"] - fila["iou_yolo"]

        filas.append(fila)
        marca = "" if not fila["error"] else f"  <- {fila['error'].strip()}"
        print(f"  [{i:>3}/{len(imagenes)}] {slug:<14} "
              f"YOLO={_num(fila['iou_yolo'])}  U-Net={_num(fila['iou_unet'])}"
              f"  Δ={_num(fila['delta'], signo=True)}{marca}")

    resumir(filas)

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(filas[0].keys()))
            w.writeheader()
            w.writerows(filas)
        print(f"\nDetalle por foto guardado en {args.csv}")
    return 0


def _num(v: float | None, signo: bool = False) -> str:
    if v is None:
        return "  —  "
    return f"{v:+.3f}" if signo else f"{v:.3f}"


def resumir(filas: list[dict]) -> None:
    """La tabla que va a la memoria: medias, dispersión y acuerdo."""
    ambos = [f for f in filas if f["delta"] is not None]

    print()
    print("=" * 68)
    print(f"  {len(filas)} fotos · {len(ambos)} con las dos vías · umbral de aprobación "
          f"{tv.UMBRAL_IOU_CORRECTA:.2f}")
    print("=" * 68)

    solo_yolo = sum(1 for f in filas if f["iou_yolo"] is not None and f["iou_unet"] is None)
    solo_unet = sum(1 for f in filas if f["iou_unet"] is not None and f["iou_yolo"] is None)
    ninguna   = sum(1 for f in filas if f["iou_yolo"] is None and f["iou_unet"] is None)
    if solo_yolo or solo_unet or ninguna:
        print(f"  Solo YOLO dio silueta: {solo_yolo} · solo U-Net: {solo_unet} · "
              f"ninguna de las dos: {ninguna}")
        print("  (una vía que no devuelve silueta deja al estudiante sin nota: cuenta)")
        print()

    if not ambos:
        print("  Ninguna foto pudo medirse por las dos vías: no hay nada que comparar.")
        return

    y  = [f["iou_yolo"] for f in ambos]
    u  = [f["iou_unet"] for f in ambos]
    d  = [f["delta"] for f in ambos]
    ty = [f["ms_yolo"] for f in ambos]
    tu = [f["ms_unet"] for f in ambos]

    def linea(nombre, vals, ms):
        desv = statistics.stdev(vals) if len(vals) > 1 else 0.0
        print(f"  {nombre:<22} media {statistics.mean(vals):.3f}   "
              f"desv {desv:.3f}   mediana {statistics.median(vals):.3f}   "
              f"{statistics.mean(ms):.0f} ms")

    print("  IoU contra la silueta objetivo")
    linea("union mascaras YOLO", y, ty)
    linea("U-Net/ResNet34", u, tu)
    print()

    media_d = statistics.mean(d)
    mejor = "el U-Net" if media_d > 0 else "la union de mascaras"
    print(f"  Delta medio (U-Net - YOLO): {media_d:+.4f}   -> se acerca mas {mejor}")
    print(f"  El U-Net gana en {sum(1 for v in d if v > 0)} de {len(d)} fotos")

    # Lo decisivo: ¿habrían calificado igual? Dos vías que dan el mismo
    # veredicto son intercambiables, y entonces gana la que cuesta menos.
    umbral = tv.UMBRAL_IOU_CORRECTA
    acuerdo = sum(1 for f in ambos
                  if (f["iou_yolo"] >= umbral) == (f["iou_unet"] >= umbral))
    print(f"  Mismo veredicto en {acuerdo} de {len(ambos)} fotos "
          f"({acuerdo / len(ambos):.0%} de acuerdo)")
    print("=" * 68)


if __name__ == "__main__":
    raise SystemExit(main())
