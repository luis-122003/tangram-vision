"""
unet_silueta.py — la silueta de la figura armada, segmentada por el U-Net.

Este módulo existe para poder **contrastar** dos formas de obtener la misma
silueta, no para sustituir una por la otra:

  A) unión de las máscaras que YOLOv8-seg ya devuelve  (`tv.silueta_union`)
  B) segmentación directa con el U-Net/ResNet34        (aquí)

La ruta A es la que califica al estudiante y no cambia. La B se calcula en
paralelo cuando `UNET_ENABLED=1` y viaja aparte en la respuesta, para que la
decisión de haber retirado el U-Net del pipeline sea un resultado medido sobre
las fotos del proyecto y no una afirmación. Apagado, este archivo no se importa
y el servicio no carga TensorFlow.

── El preprocesamiento ──────────────────────────────────────────────────────
No estaba documentado y no quedó el notebook de entrenamiento, pero el propio
modelo lo dice. Su primera capa es `bn_data`, una BatchNormalization aplicada a
la entrada, y sus estadísticos guardados son:

    moving_mean = [123.2, 115.5, 102.3]      std = [70.2, 68.2, 71.0]

Esas son las medias de ImageNet en **RGB** y en escala **0..255**. Es la firma
de `classification_models`/`segmentation_models` (qubvel): el backbone lleva la
normalización dentro, y por eso su `get_preprocessing('resnet34')` es la
identidad. De ahí la regla que sigue este módulo y que es fácil equivocar:

    la imagen entra en RGB, en 0..255, SIN dividir entre 255.

Dividir entre 255 no da un error —da una máscara casi vacía—, así que conviene
que quede escrito aquí y no en la memoria de nadie. Comprobado midiendo qué sale
de `bn_data` con cada escala:

    entrada 0..255  ->  media +0.546, desv 1.058   (normaliza bien)
    entrada 0..1    ->  media -1.273, desv 0.021   (la señal se colapsa)

── Lo que falta por comprobar ───────────────────────────────────────────────
Que el preprocesamiento sea el correcto no garantiza que el modelo acierte. El
U-Net se entrenó con fotos reales de Tangram de acrílico sobre una mesa, y sobre
una figura *sintética* —polígonos planos dibujados con OpenCV— devuelve una
máscara sin sentido. Eso no dice nada malo del modelo: es una imagen fuera de la
distribución con la que aprendió. Pero significa que su calidad real solo puede
medirse con fotos del proyecto:

    python unet_silueta.py foto.jpg        # guarda la máscara para mirarla
    python evaluar_siluetas.py fotos/      # el estudio sobre el lote completo
"""
from __future__ import annotations

import os

import cv2
import numpy as np

#: Pesos del U-Net. Solo se leen si el modelo está habilitado.
UNET_WEIGHTS = os.environ.get(
    "UNET_WEIGHTS", "models/unet_tangram_model_resnet34.keras"
)
#: Umbral sobre la sigmoide para binarizar la máscara.
UNET_THRESHOLD = float(os.environ.get("UNET_THRESHOLD", "0.5"))

#: Lado de la entrada del modelo. Fijo por arquitectura (256, 256, 3).
LADO = 256

_modelo = None


def cargar(ruta: str | None = None):
    """Carga el U-Net y lo deja en caché. Devuelve el modelo o lanza.

    TensorFlow se importa **aquí dentro** a propósito: son unos diez segundos y
    varios cientos de megabytes de proceso que no tiene por qué pagar quien
    ejecute el servicio con el U-Net apagado, que es el modo normal.
    """
    global _modelo
    if _modelo is not None:
        return _modelo

    ruta = ruta or UNET_WEIGHTS
    if not os.path.isfile(ruta):
        raise FileNotFoundError(
            f"no existe el archivo de pesos '{ruta}' "
            f"(ruta absoluta: {os.path.abspath(ruta)})"
        )

    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
    import keras                                    # noqa: PLC0415  (ver docstring)

    _modelo = keras.saving.load_model(ruta, compile=False)
    return _modelo


def disponible() -> bool:
    """¿Está el modelo ya cargado en memoria?"""
    return _modelo is not None


def mascara(img_bgr: np.ndarray, umbral: float | None = None) -> np.ndarray:
    """Máscara binaria de la figura, a la resolución del modelo (256×256)."""
    modelo = cargar()
    umbral = UNET_THRESHOLD if umbral is None else umbral

    # RGB y 0..255: la normalización la hace `bn_data` dentro del modelo.
    x = cv2.resize(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB), (LADO, LADO))
    x = x.astype(np.float32)

    pred = modelo.predict(x[None, ...], verbose=0)[0, :, :, 0]
    return (pred > umbral).astype(np.uint8)


def silueta_unet(img_bgr: np.ndarray, umbral: float | None = None) -> np.ndarray:
    """Contorno exterior de la figura armada, en píxeles de `img_bgr`.

    Devuelve un polígono (N, 2) en el mismo sistema de coordenadas que
    `tv.silueta_union`, para que ambas siluetas puedan entrar sin distinción en
    `tv.comparar_siluetas`.

    El reescalado a 256×256 deforma la figura si la foto no es cuadrada, pero al
    devolver el contorno se multiplica por (ancho/256, alto/256) y la
    deformación se deshace exactamente. Importa: `comparar_siluetas` normaliza
    posición y tamaño, no la anisotropía, así que una silueta estirada se
    compararía como una figura distinta.
    """
    alto, ancho = img_bgr.shape[:2]
    binaria = mascara(img_bgr, umbral)

    # Se cierran los poros de la máscara antes de buscar el contorno: un pixel
    # suelto en el borde parte el contorno exterior en dos y deja fuera media
    # figura. No se rellenan huecos interiores —eso lo mide el validador—, solo
    # se sella el ruido de la binarización.
    binaria = cv2.morphologyEx(binaria, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    contornos, _ = cv2.findContours(binaria, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos:
        raise ValueError("El U-Net no encontró ninguna figura en la foto")

    mayor = max(contornos, key=cv2.contourArea)
    if cv2.contourArea(mayor) < 16:
        raise ValueError("La máscara del U-Net es demasiado pequeña para ser una figura")

    # Un contorno en bruto trae cientos de vértices escalonados por el píxel.
    # Se simplifica con una tolerancia proporcional al perímetro: la silueta
    # queda igual para el IoU y el polígono cabe en la respuesta JSON.
    eps = 0.004 * cv2.arcLength(mayor, True)
    poly = cv2.approxPolyDP(mayor, eps, True).reshape(-1, 2).astype(np.float64)
    if len(poly) < 3:
        raise ValueError("El contorno del U-Net degeneró a menos de 3 vértices")

    return poly * np.array([ancho / LADO, alto / LADO])


# ─── Diagnóstico ────────────────────────────────────────────────────────────────
def _diagnostico(ruta_foto: str, salida: str | None = None) -> int:
    """Corre el U-Net sobre una foto y deja la máscara en un PNG para mirarla.

    Existe porque el único fallo que no se puede detectar leyendo el código es
    que el modelo no reconozca lo que ve. Sobre la imagen de salida se distingue
    en un vistazo entre «la máscara cubre la figura» y «la máscara es ruido», que
    es la diferencia entre un U-Net útil y uno que no generaliza a estas fotos.
    """
    img = cv2.imread(ruta_foto)
    if img is None:
        print(f"No se pudo leer la foto '{ruta_foto}'")
        return 1

    alto, ancho = img.shape[:2]
    print(f"foto: {ancho}x{alto}  ·  pesos: {UNET_WEIGHTS}")

    binaria = mascara(img)
    print(f"máscara: cubre el {binaria.mean():.1%} de la imagen")
    if binaria.mean() < 0.01:
        print("  [!] casi vacía: el modelo no encontró figura")
    elif binaria.mean() > 0.9:
        print("  [!] casi llena: el modelo marcó toda la foto como figura")

    try:
        poly = silueta_unet(img)
        print(f"contorno: {len(poly)} vértices  ·  "
              f"x [{poly[:, 0].min():.0f}, {poly[:, 0].max():.0f}]  "
              f"y [{poly[:, 1].min():.0f}, {poly[:, 1].max():.0f}]")
    except ValueError as e:
        poly = None
        print(f"contorno: no se pudo extraer ({e})")

    # La máscara ampliada a la foto y pintada encima: si el modelo funciona, el
    # tinte cae sobre las fichas y no sobre la mesa.
    grande = cv2.resize(binaria, (ancho, alto), interpolation=cv2.INTER_NEAREST)
    vista = img.copy()
    vista[grande > 0] = (0.45 * vista[grande > 0] + 0.55 * np.array([80, 240, 120])).astype(np.uint8)
    if poly is not None:
        cv2.polylines(vista, [poly.astype(np.int32)], True, (20, 20, 220), 3)

    salida = salida or os.path.splitext(ruta_foto)[0] + "_unet.png"
    cv2.imwrite(salida, np.hstack([img, vista]))
    print(f"\nGuardado: {salida}   (izquierda la foto, derecha la máscara encima)")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    # La consola de Windows va en cp1252 y no sabe escribir las tildes de abajo.
    for _flujo in (sys.stdout, sys.stderr):
        try:
            _flujo.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    ap = argparse.ArgumentParser(description="Diagnóstico del U-Net sobre una foto real.")
    ap.add_argument("foto", help="foto de un Tangram armado")
    ap.add_argument("-o", "--salida", help="PNG de salida (por defecto, junto a la foto)")
    raise SystemExit(_diagnostico(*vars(ap.parse_args()).values()))
