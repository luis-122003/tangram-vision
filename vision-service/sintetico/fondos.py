"""
fondos.py — extrae superficies reales de las fotos del dataset del U-Net.

    python -m sintetico.fondos --dataset figuras_armadas_unet --salida sintetico/fondos_reales

Las texturas que dibuja `render.py` son procedurales, y aunque bastan para que el
modelo no dé por hecho que el fondo es liso, no son mesas de verdad: no tienen
las sombras duras de la lámpara del comedor, ni el brillo del barniz, ni la junta
entre dos tablas.

Las fotos del dataset del U-Net sí las tienen, y traen la máscara de la figura,
así que se puede **borrar el Tangram y quedarse con la mesa**. El resultado son
superficies reales sobre las que apoyar figuras sintéticas: es lo que acerca las
imágenes generadas a las que va a recibir el servicio de verdad.

Se borra con `cv2.inpaint`, que rellena el hueco propagando lo que hay alrededor.
Sobre una veta de madera funciona bien; lo que deja son manchas suaves, no
fichas fantasma, y el modelo nunca ve estos fondos sin algo dibujado encima.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def extraer(raiz: Path, salida: Path, lado: int, margen: int) -> int:
    salida.mkdir(parents=True, exist_ok=True)
    n = 0
    for split in ("train", "val", "test"):
        carpeta = raiz / split
        if not (carpeta / "images").exists():
            continue
        for ruta in sorted((carpeta / "images").glob("*.jpg")):
            mascara = cv2.imread(str(carpeta / "masks" / f"{ruta.stem}.png"),
                                 cv2.IMREAD_GRAYSCALE)
            img = cv2.imread(str(ruta))
            if mascara is None or img is None:
                continue
            if mascara.shape != img.shape[:2]:
                mascara = cv2.resize(mascara, (img.shape[1], img.shape[0]),
                                     interpolation=cv2.INTER_NEAREST)

            # Se dilata antes de borrar: el borde de la figura arrastra sombra y
            # reflejos, y sin margen quedaría un halo con el contorno del Tangram
            # —justo la forma que no queremos que aparezca en un fondo—.
            hueco = cv2.dilate((mascara > 127).astype(np.uint8),
                               np.ones((margen, margen), np.uint8))
            limpio = cv2.inpaint(img, hueco, 12, cv2.INPAINT_TELEA)

            # Cuadrado y del tamaño con el que se genera, para no reescalar en
            # cada muestra.
            alto, ancho = limpio.shape[:2]
            corte = min(alto, ancho)
            y0 = (alto - corte) // 2
            x0 = (ancho - corte) // 2
            recorte = limpio[y0:y0 + corte, x0:x0 + corte]
            cv2.imwrite(str(salida / f"{ruta.stem}.jpg"),
                        cv2.resize(recorte, (lado, lado), interpolation=cv2.INTER_AREA),
                        [cv2.IMWRITE_JPEG_QUALITY, 92])
            n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True, help="carpeta con train/val/test (images+masks)")
    ap.add_argument("--salida", default=str(Path(__file__).parent / "fondos_reales"))
    ap.add_argument("--lado", type=int, default=1280)
    ap.add_argument("--margen", type=int, default=25,
                    help="píxeles de dilatación de la máscara antes de borrar")
    args = ap.parse_args()

    n = extraer(Path(args.dataset).resolve(), Path(args.salida).resolve(),
                args.lado, args.margen)
    print(f"{n} superficies extraídas en {args.salida}")
    print("El generador las usará automáticamente si están en sintetico/fondos_reales.")


if __name__ == "__main__":
    main()
