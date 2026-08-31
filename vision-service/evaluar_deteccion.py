"""
evaluar_deteccion.py — ¿qué tal detecta el modelo sobre fotos REALES?

    python evaluar_deteccion.py figuras_armadas_unet --pesos models/tangram_piezas_seg_best.pt
    python evaluar_deteccion.py figuras_armadas_unet --pesos a.pt --comparar b.pt

Es la medida que le faltaba al proyecto. Hasta ahora el detector no tenía ningún
número sobre fotos que no fueran las suyas de entrenamiento: se sabía que
«funciona», pero no cuánto ni con qué se equivoca.

Cómo se mide, y por qué así
───────────────────────────
El dataset del U-Net (`figuras_armadas_unet`) trae, por cada foto real, una
máscara binaria con la **unión de las 7 fichas**. Esa máscara es verdad de
referencia hecha a mano, y sirve para juzgar al detector aunque él trabaje ficha
a ficha: se unen las máscaras que devuelve y se compara con ella por IoU.

Se miden dos cosas distintas, y conviene no confundirlas:

  · **IoU de silueta** — cuánto se parece lo detectado a la figura real. Es lo
    que acaba determinando la nota del estudiante, porque la comparación contra
    la figura objetivo se hace sobre esta silueta.
  · **Fichas encontradas** — cuántas de las 7 ve. Un modelo puede dar buen IoU
    detectando 5 fichas grandes y perdiéndose dos pequeñas: la silueta queda casi
    igual, pero el inventario, los huecos y el diagnóstico se vienen abajo.

Un detalle sobre el dataset: sus máscaras se generaron **por color**
(`modo_etiquetado: "color"`), así que la verdad de referencia hereda ese sesgo.
Para juzgar a un modelo que precisamente se quiere independizar del color, sigue
valiendo —la máscara marca dónde están las fichas, no de qué color son—, pero
conviene saberlo antes de presentar la cifra como si fuera neutral.
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

import cv2
import numpy as np

import tangram_validator as tv


def _silueta_detectada(resultado, forma: tuple[int, int],
                       umbral_conf: float) -> tuple[np.ndarray, int, dict[str, int]]:
    """Une las máscaras de las fichas detectadas en una sola silueta binaria."""
    alto, ancho = forma
    lienzo = np.zeros((alto, ancho), dtype=np.uint8)

    masks = getattr(resultado, "masks", None)
    boxes = getattr(resultado, "boxes", None)
    if masks is None or masks.xy is None or boxes is None or len(boxes) == 0:
        return lienzo, 0, {}

    nombres = dict(getattr(resultado, "names", {}) or {})
    try:
        taxonomia = tv.resolver_taxonomia(nombres.values())
    except ValueError:
        taxonomia = {}

    piezas: dict[str, int] = {}
    contadas = 0
    for poligono, caja in zip(masks.xy, boxes):
        if float(caja.conf.item()) < umbral_conf:
            continue
        poly = np.asarray(poligono, dtype=np.float64).reshape(-1, 2)
        if len(poly) < 3:
            continue
        clase = nombres.get(int(caja.cls.item()), "")
        pieza = taxonomia.get(clase, clase)
        piezas[pieza] = piezas.get(pieza, 0) + 1
        contadas += 1
        cv2.fillPoly(lienzo, [np.round(poly).astype(np.int32)], 1)
    return lienzo, contadas, piezas


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.count_nonzero(a | b)
    return 0.0 if union == 0 else np.count_nonzero(a & b) / union


def evaluar(raiz: Path, pesos: Path, splits: list[str],
            imgsz: int, conf: float) -> dict:
    from ultralytics import YOLO

    modelo = YOLO(str(pesos))
    ious: list[float] = []
    fichas: list[int] = []
    completas = 0
    por_imagen: list[tuple[str, float, int]] = []

    for split in splits:
        carpeta = raiz / split
        if not (carpeta / "images").exists():
            continue
        for ruta in sorted((carpeta / "images").glob("*.jpg")):
            mascara_real = cv2.imread(str(carpeta / "masks" / f"{ruta.stem}.png"),
                                      cv2.IMREAD_GRAYSCALE)
            if mascara_real is None:
                continue
            img = cv2.imread(str(ruta))
            if img is None:
                continue

            resultado = modelo.predict(source=img, imgsz=imgsz, conf=conf,
                                       max_det=30, verbose=False)[0]
            detectada, n, _ = _silueta_detectada(resultado, img.shape[:2], conf)

            verdad = (mascara_real > 127).astype(np.uint8)
            if verdad.shape != detectada.shape:
                verdad = cv2.resize(verdad, (detectada.shape[1], detectada.shape[0]),
                                    interpolation=cv2.INTER_NEAREST)

            iou = _iou(detectada.astype(bool), verdad.astype(bool))
            ious.append(iou)
            fichas.append(n)
            completas += int(n == 7)
            por_imagen.append((f"{split}/{ruta.stem}", iou, n))

    return {
        "n": len(ious),
        "iou_medio": statistics.fmean(ious) if ious else 0.0,
        "iou_mediana": statistics.median(ious) if ious else 0.0,
        "iou_peor": min(ious) if ious else 0.0,
        "iou_mejor": max(ious) if ious else 0.0,
        "sobre_75": sum(1 for v in ious if v >= 0.75),
        "fichas_medias": statistics.fmean(fichas) if fichas else 0.0,
        "con_las_7": completas,
        "por_imagen": por_imagen,
    }


def _informe(titulo: str, r: dict) -> None:
    n = max(1, r["n"])
    print(f"\n── {titulo} ──  {r['n']} fotos")
    print(f"   IoU de silueta   media {r['iou_medio']:.3f}   mediana {r['iou_mediana']:.3f}"
          f"   peor {r['iou_peor']:.3f}   mejor {r['iou_mejor']:.3f}")
    print(f"   IoU >= 0,75      {r['sobre_75']}/{r['n']}  ({100 * r['sobre_75'] / n:.0f} %)")
    print(f"   fichas vistas    {r['fichas_medias']:.2f} de 7 de media")
    print(f"   las 7 completas  {r['con_las_7']}/{r['n']}  ({100 * r['con_las_7'] / n:.0f} %)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dataset", help="carpeta con train/val/test e images+masks")
    ap.add_argument("--pesos", required=True)
    ap.add_argument("--comparar", help="segundos pesos, para ponerlos al lado")
    ap.add_argument("--splits", default="test",
                    help="cuáles evaluar: 'test', 'val,test' o 'train,val,test'")
    ap.add_argument("--imgsz", type=int, default=960, help="el mismo YOLO_IMGSZ del servicio")
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--csv", help="guarda el detalle por imagen")
    args = ap.parse_args()

    raiz = Path(args.dataset).resolve()
    splits = [s.strip() for s in args.splits.split(",") if s.strip()]

    primero = evaluar(raiz, Path(args.pesos), splits, args.imgsz, args.conf)
    _informe(Path(args.pesos).name, primero)

    segundo = None
    if args.comparar:
        segundo = evaluar(raiz, Path(args.comparar), splits, args.imgsz, args.conf)
        _informe(Path(args.comparar).name, segundo)
        d = segundo["iou_medio"] - primero["iou_medio"]
        df = segundo["fichas_medias"] - primero["fichas_medias"]
        print(f"\n   diferencia: IoU {d:+.3f}   fichas {df:+.2f}")

    if args.csv:
        filas = ["imagen,iou,fichas"]
        filas += [f"{n},{v:.4f},{k}" for n, v, k in primero["por_imagen"]]
        Path(args.csv).write_text("\n".join(filas) + "\n", encoding="utf-8")
        print(f"\nDetalle por imagen en {args.csv}")

    print("\nRecuerda: estas fotos son de UN juego de Tangram. Un IoU alto aquí")
    print("no dice nada sobre otro juego de otro color o material; para eso hace")
    print("falta fotografiar uno distinto y volver a pasar esta misma medida.")


if __name__ == "__main__":
    main()
