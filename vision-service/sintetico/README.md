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

Usa **`Colab_entrenar_drive.ipynb`**, que ya trae todo el circuito montado sobre
Drive. Solo hay que subir dos archivos a la raíz de tu MyDrive:

| archivo | qué es | se regenera con |
|---|---|---|
| `tangram_sintetico.zip` | este módulo + el validador + el modelo viejo | ver abajo |
| `figuras_armadas_unet.zip` | las fotos reales para medir (114, de las que se usan 112) | ya lo tienes |

El dataset **no se sube**: el generador pesa unos kilobytes y las 6000 imágenes se
fabrican allí.

Para rehacer el zip después de tocar el código:

```python
python - <<'EOF'
import zipfile, pathlib
R = 'tangram_sintetico'
with zipfile.ZipFile('tangram_sintetico.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(f'{R}/sintetico/__init__.py', '')
    for o, d in [('evaluar_deteccion.py', f'{R}/evaluar_deteccion.py'),
                 ('tangram_validator.py', f'{R}/tangram_validator.py'),
                 ('models/tangram_piezas_seg_best.pt', f'{R}/models/tangram_piezas_seg_best.pt')]:
        z.write(o, d)
    for p in list(pathlib.Path('sintetico').glob('*.py')) + \
             [pathlib.Path('sintetico/README.md')] + \
             list(pathlib.Path('sintetico/fondos_reales').glob('*.jpg')):
        z.write(p, f'{R}/{p}')
EOF
```

**Comprueba que el entorno tenga GPU antes de nada** (Entorno de ejecución →
Cambiar tipo de entorno → GPU). En CPU el entrenamiento pasa de 2-3 horas a varios
días, y Colab no avisa: arranca en CPU por defecto. La primera celda del notebook
para en seco si no la encuentra, precisamente porque esto ya costó una corrida
entera.

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

El dataset `figuras_armadas_unet` son **112 fotos reales** de figuras armadas con
la máscara de su silueta (eran 114; el 6 de septiembre se apartaron dos con la
máscara mal trazada, ver `_excluidas/MOTIVO.txt`). Sirve para dos cosas aquí:

**Como conjunto de test.** Los dos modelos, medidos **en la misma corrida, sobre
las mismas 112 fotos y a 640 px** el 6 de septiembre de 2026:

| | anterior, por color | este módulo, por forma | + `reparar_cuadrilateros` |
|---|---:|---:|---:|
| IoU de silueta (media) | 0,162 | 0,968 | **0,969** |
| IoU de silueta (peor foto) | 0,000 | 0,904 | **0,904** |
| IoU ≥ 0,75 | 2 de 112 (2 %) | 112 de 112 | **112 de 112 (100 %)** |
| Fichas detectadas | 1,09 de 7 | 8,62 de 7 | **7,09 de 7** |
| Fotos con las 7 | 1 de 112 | 1 de 112 | **103 de 112** |
| Inventario exacto | 0 de 112 | 0 de 112 | **98 de 112 (88 %)** |

El motivo del derrumbe de la primera columna se ve mirando las fotos: son de un
Tangram de **otros colores** —romboide azul, triángulos rosa y verde— y el modelo
busca `parallelogram_cyan`, `large_tri_orange`. Lo único que reconoce a veces es
el cuadrado, que en ambos juegos es amarillo. Es la demostración empírica de que
el detector por color no generaliza, y la razón de ser de este módulo.

La hipótesis del módulo queda comprobada: el modelo nuevo nunca vio ese Tangram
—ni ningún otro, solo imágenes generadas— y lo reconoce casi perfectamente.

Pero **sobredetecta**: en crudo ve 8,62 fichas donde hay 7, y el inventario no
sale exacto en ninguna foto. La silueta sale bien igual porque los duplicados se
pisan, pero el mensaje que se le da al estudiante sobre qué ficha falta o sobra
sería equivocado. Eso lo corrige `tangram_validator.reparar_cuadrilateros` por
geometría, sin reentrenar: es la tercera columna.

**Y el sistema completo acierta la figura.** Con la cadena entera —detector,
reparación, silueta y comparación contra el catálogo de 20 figuras— sobre las
mismas 112 fotos: **111 de 112** identificadas bien y **110 de 112** aprobadas con
`MATCH_IOU=0,80`. Las dos que se quedan cortas son las dos peores detecciones.

El análisis completo, con lo que el resultado **no** demuestra, está en
[RESULTADOS.md](RESULTADOS.md); el detalle por foto, en
`comparacion_detectores.csv`.

```bash
python evaluar_deteccion.py <dataset_unet> \
    --pesos models/tangram_piezas_seg_best.pt \
    --comparar models/tangram_formas_v2.pt \
    --splits train,val,test --csv comparacion_detectores.csv
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

**Las guardas de `entrenar.py`.** `_exigir_gpu()` para si se pidió GPU y no la
hay; `_exigir_checkpoint_valido()` se niega a reanudar un `last.pt` sin estado de
optimizador o entrenado con otro `data.yaml`; y entrenar sobre una carpeta que ya
existe exige `--reanudar` explícito. Las tres salen de la misma corrida perdida: un
`resume=True` sobre un checkpoint ya cerrado hizo que Ultralytics empezara de cero
y, sin `data`, cayera a su dataset por defecto —`coco8-seg`—, así que entrenó 100
épocas sobre ocho fotos de personas y perros bajo el nombre `tangram_formas`.
Fallar en silencio con nombre correcto es el peor modo de fallo que hay.

**`hsv_h=0.5` en `entrenar.py`.** Rota el matiz de cada imagen por todo el
círculo cromático en cada época. Es lo que impide que el modelo vuelva a
apoyarse en el color aunque las etiquetas sean geométricas. Bajarlo revierte el
propósito entero de este módulo.
