# Detector de fichas por forma — dataset sintético

Entrena un YOLOv8-seg que reconozca las 7 fichas del Tangram **por su forma**, no
por su color, para que el sistema funcione con cualquier juego: acrílico, madera,
cartón o papel.

## El problema que resuelve

El detector en producción tiene una clase por color de ficha —`large_tri_orange`,
`small_tri_blue`, `square_yellow`…—, así que está atado al juego concreto con el
que se entrenó. La evidencia de lo frágil que es eso está en el propio pipeline:
`descartar_duplicados()` existe porque *un reflejo* basta para que la misma ficha
salga detectada dos veces con dos etiquetas distintas.

Y no se puede reentrenar con lo que hay. De los datasets del proyecto, el de
piezas tiene **91 imágenes con una sola ficha suelta cada una**, anotadas como
cajas y no como polígonos; el de figuras armadas anota el contorno de la figura
entera, no sus piezas. Para detectar 7 fichas dentro de una figura hace falta un
dataset que no existe. Este lo fabrica.

## Por qué sintético

Las 7 fichas del Tangram tienen geometría **exacta y conocida**, y ya está en el
proyecto (`tangram_validator.PIEZAS_CANONICAS`). De ahí salen tres cosas que un
dataset fotografiado no da:

- **Anotaciones perfectas**, sin anotar a mano ni un polígono.
- **Volumen**: miles de figuras distintas.
- **Color y material aleatorios en cada muestra**, que es lo que fuerza al modelo
  a mirar la forma.

## Uso

```bash
# 1. generar (unos 20 min para 6000 imágenes)
python -m sintetico.generar --salida datasets/tangram_formas --train 6000 --val 800

# 2. comprobar que las anotaciones son correctas
python -m sintetico.verificar datasets/tangram_formas

# 3. mirar muestras.jpg con los ojos  ← no te lo saltes

# 4. entrenar
python -m sintetico.entrenar --dataset datasets/tangram_formas --epocas 80
```

### En Google Colab

El generador pesa unos kilobytes, así que **no subas imágenes**: sube el código y
genera el dataset allí.

```python
!pip install ultralytics
# sube sintetico/ y tangram_validator.py, respetando que sintetico/ cuelgue
# de la misma carpeta que tangram_validator.py
!python -m sintetico.generar --salida /content/ds --train 6000 --val 800
!python -m sintetico.verificar /content/ds
!python -m sintetico.entrenar --dataset /content/ds --epocas 80 --device 0
```

El `data.yaml` guarda una ruta **absoluta**, así que hay que generarlo en la
máquina donde se entrena (Ultralytics no resuelve `path: .` contra la carpeta del
yaml, sino contra su propio directorio de datasets).

## Cómo entra el modelo en el sistema

Las clases son las cinco geométricas (`large_tri`, `medium_tri`, `small_tri`,
`square`, `parallelogram`), que es la `TAXONOMIA_5` que
`tangram_validator.resolver_taxonomia()` **ya reconoce**. Así que basta con:

1. copiar `best.pt` a `vision-service/models/`,
2. apuntar `YOLO_WEIGHTS` a ese archivo en `vision-service/.env`,
3. reiniciar y confirmar en `/health` que `models_loaded` no viene vacío.

Ni el backend ni la app se tocan.

## Lo que este dataset NO demuestra

El conjunto de validación es sintético igual que el de entrenamiento: sirve para
ver si el entrenamiento converge, **no** para saber si el modelo funciona sobre
una mesa. Un modelo puede acertar el 99 % aquí y fallar con la primera foto real.

La única forma de responder a eso es un conjunto de test con **fotos reales
anotadas a mano**, y conviene que incluya un Tangram distinto del que se usó para
el modelo actual —de madera, por ejemplo—. Ese conjunto no puede salir de aquí, y
sin él no hay ninguna medida de generalización que presentar.

## Qué hay en cada archivo

| Archivo | Qué hace |
|---|---|
| `composicion.py` | coloca las 7 fichas encajadas por aristas, sin solaparse |
| `render.py` | las dibuja con color, material, fondo, luz y sombra al azar |
| `fondos.py` | extrae **mesas reales** de las fotos del dataset del U-Net |
| `generar.py` | escribe el dataset en formato YOLOv8-seg |
| `verificar.py` | comprueba el formato **y** pasa las anotaciones por el validador del proyecto |
| `entrenar.py` | entrena con la aumentación de color agresiva que quita el color de la ecuación |

Y fuera de este módulo, `../evaluar_deteccion.py` mide cualquier modelo contra
fotos reales.

## La línea base, medida

El dataset `figuras_armadas_unet` son 114 fotos reales de figuras armadas con la
máscara de su silueta. Sirve para dos cosas aquí:

**Como conjunto de test.** El modelo en producción, medido contra esas 114 fotos:

| | `tangram_piezas_seg_best.pt` |
|---|---|
| IoU de silueta (media) | **0,096** |
| IoU ≥ 0,75 | 2 de 114 (2 %) |
| Fichas detectadas | **1,21** de 7 |
| Fotos con las 7 | 2 de 114 (2 %) |

El motivo se ve mirando las fotos: son de un Tangram de **otros colores** —romboide
azul, triángulos rosa y verde— y el modelo busca `parallelogram_cyan`,
`large_tri_orange`. Lo único que reconoce a veces es el cuadrado, que en ambos
juegos es amarillo. Es la demostración empírica de que el detector actual no
generaliza, y la razón de ser de este módulo.

Cuando el modelo nuevo esté entrenado, se compara contra esa misma tabla:

```bash
python evaluar_deteccion.py <dataset_unet> \
    --pesos models/tangram_piezas_seg_best.pt \
    --comparar entrenamientos/tangram_formas/weights/best.pt \
    --splits train,val,test
```

**Como fuente de superficies reales.** `fondos.py` borra la figura de cada foto
con inpainting y deja la mesa: 114 superficies auténticas, con su veta y las
sombras de la luz de la habitación, que el generador usa en el 55 % de las
muestras. Es la parte menos sintética de las imágenes generadas.

```bash
python -m sintetico.fondos --dataset <dataset_unet>
```

## Dos decisiones que conviene no deshacer

**`SOLIDEZ_MINIMA` en `composicion.py`.** Descarta figuras donde las fichas se
tocan de refilón. Sin ese filtro salían constelaciones de piezas apenas rozándose,
y lo que el detector tiene que aprender es a separar fichas que comparten aristas
enteras —el caso difícil, y el único que ocurre de verdad—.

**`hsv_h=0.5` en `entrenar.py`.** Rota el matiz de cada imagen por todo el
círculo cromático en cada época. Es lo que impide que el modelo vuelva a
apoyarse en el color aunque las etiquetas sean geométricas. Bajarlo revierte el
propósito entero de este módulo.
