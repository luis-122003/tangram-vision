"""
entrenar.py — entrena el detector de fichas por forma, no por color.

    python -m sintetico.entrenar --dataset datasets/tangram_formas --epocas 80

Funciona igual en Colab que en local; lo único que cambia es `--device`.

La aumentación es el corazón de esto, no un ajuste fino
────────────────────────────────────────────────────────
El detector que hay hoy en producción tiene una clase por **color** de ficha, y
por eso está atado a un juego de Tangram concreto. Aquí las clases son
geométricas, pero eso por sí solo no impide que el modelo vuelva a apoyarse en
el color: si en los datos el triángulo grande fuese siempre naranja, aprendería
«naranja» igual, aunque la etiqueta diga `large_tri`.

Lo que lo impide es `hsv_h=0.5`: el matiz de cada imagen se rota al azar por
todo el círculo cromático en cada época. Una ficha que era naranja aparece verde
en la siguiente pasada, con la misma etiqueta. El color deja de predecir nada y
la única señal que queda es la forma. Es el ajuste que no hay que tocar.

Los giros van a 180° y los espejos activados porque una figura de Tangram no
tiene orientación privilegiada —el niño fotografía desde donde está sentado— y
el propio validador compara siluetas probando giro continuo y reflexión.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True, help="carpeta con data.yaml")
    ap.add_argument("--modelo", default="yolov8s-seg.pt",
                    help="pesos de partida; 's' es el tamaño que usa el proyecto")
    ap.add_argument("--epocas", type=int, default=80)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default="0",
                    help="'0' para GPU, 'cpu' para procesador")
    ap.add_argument("--salida", default="entrenamientos")
    ap.add_argument("--nombre", default="tangram_formas")
    args = ap.parse_args()

    from ultralytics import YOLO

    datos = Path(args.dataset).resolve() / "data.yaml"
    if not datos.exists():
        raise SystemExit(f"No encuentro {datos}. Genera antes el dataset.")

    modelo = YOLO(args.modelo)
    modelo.train(
        data=str(datos),
        epochs=args.epocas,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=args.salida,
        name=args.nombre,
        exist_ok=True,

        # ── Lo que quita el color de la ecuación ──────────────────────────────
        hsv_h=0.5,   # matiz completamente aleatorio: ver la explicación de arriba
        hsv_s=0.9,   # de saturado a casi gris
        hsv_v=0.5,   # de sombra a sobreexpuesto

        # ── Lo que refleja cómo se fotografía un Tangram ──────────────────────
        degrees=180.0,   # cualquier orientación sobre la mesa
        fliplr=0.5,
        flipud=0.5,      # el romboide tiene quiralidad, pero el validador ya
                         # compara probando también la figura reflejada
        scale=0.5,       # más cerca o más lejos
        translate=0.15,
        perspective=0.0005,
        erasing=0.3,     # trozos tapados: una mano, una sombra dura

        # `mosaic` pega cuatro fotos en una y corta figuras por la mitad. Ayuda
        # al detector, pero en dosis altas llenaría el entrenamiento de fichas
        # partidas, que es justo lo que no queremos que aprenda a llamar ficha.
        mosaic=0.3,
        close_mosaic=10,  # las últimas 10 épocas, sin mosaico: imágenes enteras

        patience=25,
        plots=True,
        verbose=True,
    )

    pesos = Path(args.salida) / args.nombre / "weights" / "best.pt"
    print(f"\nPesos: {pesos}")
    print("Para ponerlos en el sistema:")
    print("  1. cópialos a vision-service/models/")
    print("  2. apunta YOLO_WEIGHTS a ese archivo en vision-service/.env")
    print("  3. reinicia el servicio y comprueba /health: models_loaded no puede salir vacío")
    print("\nEl validador detecta solo la taxonomía de 5 clases, así que no hay")
    print("nada más que tocar. Pero antes mídelo con fotos REALES: este modelo")
    print("ha visto imágenes generadas, y que acierte en ellas no dice nada")
    print("sobre lo que hará con un Tangram sobre una mesa.")


if __name__ == "__main__":
    main()
