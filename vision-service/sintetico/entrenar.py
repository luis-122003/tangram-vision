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


def _exigir_gpu(device: str) -> None:
    """Para en seco si se pidio GPU y no la hay.

    En Colab el entorno arranca en CPU por defecto y `nvidia-smi` no existe. Sin
    esta comprobacion Ultralytics cae a CPU sin decir nada y el entrenamiento,
    que en una T4 son ~2 h, pasa a ser de varios dias. Se descubre a la hora.
    """
    if str(device).lower() in {"cpu", "mps"}:
        return
    import torch
    if not torch.cuda.is_available():
        raise SystemExit(
            "Pediste --device %s pero PyTorch no ve ninguna GPU (torch.cuda no "
            "esta disponible).\n"
            "  · En Colab: Entorno de ejecucion -> Cambiar tipo de entorno -> GPU (T4).\n"
            "  · Si de verdad quieres CPU, pon --device cpu y baja el dataset a "
            "unos cientos de imagenes: 6000 x 100 epocas en 2 nucleos son dias."
            % device
        )


def _exigir_checkpoint_valido(ultimo: Path, datos: Path) -> None:
    """Comprueba que `last.pt` se pueda reanudar y sea de ESTE dataset.

    Ultralytics, ante un checkpoint sin estado de optimizador, avisa por consola
    y **empieza un entrenamiento nuevo**; y si se le llama sin `data`, ese
    entrenamiento nuevo usa su dataset por defecto, `coco8-seg`. El resultado es
    un best.pt entrenado sobre ocho fotos de personas y perros, con nombre de
    Tangram y todas las metricas en cero. Ya paso una vez: por eso esta funcion.
    """
    if not ultimo.exists():
        raise SystemExit(
            f"No hay checkpoint en {ultimo}.\n"
            "Quita --reanudar y empieza el entrenamiento desde el principio."
        )

    import torch
    ckpt = torch.load(ultimo, map_location="cpu", weights_only=False)

    if ckpt.get("epoch", -1) < 0 or ckpt.get("optimizer") is None:
        raise SystemExit(
            f"{ultimo} no es reanudable: no lleva estado de optimizador ni de "
            "epoca (es un checkpoint ya terminado, al que Ultralytics le quito el "
            "optimizador al cerrar).\n"
            "Si ese entrenamiento termino, usalo como esta. Si quieres uno nuevo, "
            "cambia --nombre. Lo que NO hay que hacer es reanudarlo: Ultralytics "
            "se pondria a entrenar desde cero sobre coco8-seg."
        )

    previo = (ckpt.get("train_args") or {}).get("data")
    if previo and Path(str(previo)).name != datos.name:
        raise SystemExit(
            f"{ultimo} se entreno con `{previo}`, no con `{datos}`.\n"
            "Reanudar mezclaria dos datasets distintos. Cambia --nombre para "
            "abrir una corrida limpia."
        )


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
    ap.add_argument("--patience", type=int, default=25,
                    help="epocas sin mejora antes de parar")
    ap.add_argument("--workers", type=int, default=8,
                    help="procesos de carga de datos; en Colab (2 vCPU) pon 2")
    ap.add_argument("--reanudar", action="store_true",
                    help="continua desde el last.pt de ESTA corrida, "
                         "comprobando antes que sea reanudable y sea del mismo dataset")
    args = ap.parse_args()

    from ultralytics import YOLO

    datos = Path(args.dataset).resolve() / "data.yaml"
    if not datos.exists():
        raise SystemExit(f"No encuentro {datos}. Genera antes el dataset.")

    _exigir_gpu(args.device)

    salida = Path(args.salida).resolve()
    ultimo = salida / args.nombre / "weights" / "last.pt"
    if args.reanudar:
        _exigir_checkpoint_valido(ultimo, datos)
        print(f"Reanudando desde {ultimo}")
        modelo = YOLO(str(ultimo))
    else:
        if ultimo.exists():
            raise SystemExit(
                f"Ya hay una corrida en {ultimo.parent}.\n"
                "  · para continuarla:   anade --reanudar\n"
                "  · para empezar otra:  cambia --nombre, o borra esa carpeta.\n"
                "Se para aqui a proposito: sobrescribirla en silencio es como se "
                "pierden entrenamientos de tres horas."
            )
        modelo = YOLO(args.modelo)

    modelo.train(
        data=str(datos),
        resume=args.reanudar,
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

        patience=args.patience,
        workers=args.workers,
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
