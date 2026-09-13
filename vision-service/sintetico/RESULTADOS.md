# Detector por forma — resultados medidos

**Fecha:** 3 de septiembre de 2026, con una **actualización del 6 de septiembre**
que la supersede — ver sección 0.
**Datos:** las fotos reales de `figuras_armadas_unet`, con su máscara de silueta.
Las secciones 1 a 4 usan las **114** originales; la sección 0, del 6 de septiembre,
usa las **112** que quedan tras apartar dos con la máscara mal trazada
**Modelos:** `tangram_piezas_seg_best.pt` (una clase por color) frente a
`tangram_formas_v2.pt` (cinco clases geométricas, entrenado solo con imágenes
sintéticas, y **en producción desde el 6 de septiembre**)
**Reproducir:** `python evaluar_deteccion.py <dataset> --pesos <viejo> --comparar <nuevo> --splits train,val,test`
**Detalle por foto:** `comparacion_detectores.csv`

---

## 0. Actualización del 6 de septiembre — qué de esto sigue en pie

Las secciones 1 a 4 se escribieron el 3 de septiembre, con `tangram_formas.pt`
entrenado sobre un dataset que **tenía el romboide mal definido**. El 5 de
septiembre se regeneró el dataset y se reentrenó (`tangram_formas_v2.pt`, 6000
imágenes, 100 épocas, 2,41 h en 2×T4). Esto es lo que cambia.

### El bug del polígono está corregido

La nota del 4 de septiembre (sección 3) dice que en `PIEZAS_CANONICAS` el
romboide estaba definido con el mismo polígono que el cuadrado, y concluye que
mientras no se corrija, los números de inventario no miden lo que dicen medir.
**Ya está corregido, y verificado midiendo**, no leyendo: generando 200 figuras
con `composicion.componer()` y midiendo los lados de cada pieza etiquetada,

```
cuadrado   lados = [0.3536, 0.3536, 0.3536, 0.3536]   area 0.125
romboide   lados = [0.3536, 0.3536, 0.5000, 0.5000]   area 0.125
```

las 200 salen bien: el cuadrado con los cuatro lados iguales, el romboide con
lados en proporción 1:√2 y ángulos de 45/135. **Los números de inventario de
esta actualización sí miden lo que dicen medir.**

### Los resultados con el modelo reentrenado

Los tres se midieron **en la misma corrida, sobre las mismas 112 fotos y a 640 px**,
para que la comparación no dependa de cómo se lanzó cada uno.

| | anterior (color) | `formas_v2` en crudo | `formas_v2` + reparación |
|---|---:|---:|---:|
| IoU de silueta, media | 0,162 | 0,968 | **0,969** |
| IoU de silueta, mediana | 0,165 | 0,971 | **0,973** |
| IoU de silueta, peor foto | 0,000 | 0,904 | **0,904** |
| IoU ≥ 0,75 | 2/112 | 112/112 | **112/112** |
| Fichas detectadas (hay 7) | 1,09 | 8,62 | **7,09** |
| Exactamente 7 fichas | 1/112 | 1/112 | **103/112** |
| **Inventario exacto** | 0/112 | **0/112** | **98/112 (88 %)** |

Dos notas sobre la primera columna, porque son las que un jurado va a pedir. La
primera: en las secciones 1 a 4 el detector por color aparece con 0,096 de IoU
media, y aquí con 0,162. No es que haya mejorado —es el mismo archivo de pesos—,
es que aquella cifra salió de otra corrida y otro guion. La de esta tabla es la
buena para comparar, porque los tres números de la fila salieron del mismo bucle.
La segunda: ese modelo se entrenó a 960 px, así que se midió **también** a 960
por si 640 lo estaba perjudicando. A 960 sale **peor** (IoU media 0,113, mediana
0,064, 3/112 por encima de 0,75). La tabla se queda con su mejor resultado.

### La sobredetección seguía, pero por otra causa

Corregido el polígono, el modelo **sigue devolviendo 8,62 fichas donde hay 7**.
La causa ya no es la del 4 de septiembre. Se encontró dibujando las
predicciones sobre las fotos y mirándolas, y son dos fallos distintos:

1. **El romboide sale partido en dos.** El detector lo corta por su diagonal y
   devuelve dos triángulos pequeños, con confianza **alta** (0,85–0,95): no está
   dudando. Por eso la media de triángulos pequeños es 4,10 donde hay 2.
2. **El cuadrado sale por duplicado.** Sobre la misma ficha aparecen un `square`
   y un `parallelogram` con confianzas de 0,49 y 0,48 — una moneda al aire.

El contraste de confianzas es el dato que orienta: los triángulos se detectan a
0,87–0,98 y los cuadriláteros a 0,48–0,49. El modelo está seguro de todo lo que
tiene tres lados e inseguro de todo lo que tiene cuatro. En el propio conjunto
sintético eso ya se veía: `square` y `parallelogram` se quedan en 0,50 de mAP50
mientras los tres triángulos llegan a 0,97–0,99.

Es una brecha **sintético → real**: en `render.py` las fichas son polígonos de
color plano, y las de verdad tienen sombreado, bisel y brillo que insinúan una
diagonal donde no hay ninguna. Arreglar el render es la línea siguiente.

### La reparación geométrica

Mientras tanto, `tangram_validator.reparar_cuadrilateros()` lo corrige sin
reentrenar, con dos reglas:

1. Dos `TRIANGULO_PEQUENO` cuyo **casco convexo mide lo que suman los dos**
   comparten una arista entera, así que se funden en el cuadrilátero que forman.
   Solo se funde mientras sobren pequeños: si ya quedan los 2 del inventario se
   para, porque dos pequeños legítimos también pueden estar pegados.
2. Todo cuadrilátero se clasifica **midiendo sus ángulos interiores**, no por lo
   que diga la red: menos de 110° es cuadrado, si no romboide. Y si quedan dos
   con el mismo centroide, se descarta el de menor confianza.

Eso lleva el inventario de 0/112 a 98/112 sin tocar los pesos, y la silueta no
se resiente (0,968 → 0,969).

### Seis figuras nuevas en el catálogo

El catálogo que traía la aplicación (14 figuras) y las figuras que hay realmente
en las fotos **no eran las mismas**: un estudiante podía pedir "la casa" y el
dataset no tener ni una foto de una casa. El 6 de septiembre se cerró esa
distancia añadiendo al catálogo las figuras que sí se armaron.

Agrupando las 112 fotos por marca de tiempo salieron siete figuras distintas
(20, 19, 18, 18, 17, 10 y 10 fotos). Una de ellas —el triángulo grande— ya
estaba en el catálogo como `triangle`. Las otras seis se añadieron:

| figura | slug | fotos | vértices | IoU de cada foto contra la silueta media |
|---|---|---:|---:|---:|
| Cisne | `cisne` | 20 | 11 | 0,959 |
| Conejo sentado | `conejo_sentado` | 19 | 12 | 0,950 |
| Canguro | `canguro` | 18 | 16 | 0,961 |
| Cohete | `cohete` | 18 | 10 | 0,959 |
| Vela encendida | `vela` | 17 | 17 | 0,940 |
| Molino | `molino` | 10 | 25 | 0,916 |

La silueta de referencia **no es una foto elegida a dedo**: es el consenso del
grupo. Se alinean todas las máscaras del grupo por giro (barrido de 5° y afinado
de 1°, tres pasadas hasta que el promedio se estabiliza), se promedian, se corta
a 0,5 y se simplifica el contorno con `approxPolyDP` al 0,6 % del perímetro. La
última columna dice cuánto se parece cada foto individual a ese consenso: entre
0,92 y 0,96, o sea que la referencia representa bien a todo el grupo y no a una
foto concreta.

Los **nombres son provisionales**. La geometría sale del dataset; que a la
figura de 20 fotos se la llame "cisne" y no "pájaro" o "gallo" es una decisión
editorial, y cambiarla es editar `data/figures_seed.json`: nada más depende de
ella salvo lo que ve el estudiante.

Lo importante es que **no estropean la calibración**. Con 20 figuras, la mayor
confusión entre dos figuras distintas sigue siendo `house` contra `arrow`
(0,741); la peor de las nuevas es `conejo_sentado` contra `ferryboat` (0,738).
`MATCH_IOU=0,80` y `CLOSE_IOU=0,75` siguen por encima de ese techo.

### De extremo a extremo: ¿acierta la figura?

Hasta aquí todo lo medido era de **silueta**: cuánto se parece lo que el detector
ve a la máscara etiquetada. Falta la pregunta que de verdad hace el sistema
delante de un niño: *¿es esta la figura que le pedí?* Se midió el 6 de septiembre,
con la cadena entera y sin atajos —`YOLO → reparar_cuadrilateros → silueta_union
→ comparar_siluetas` contra el catálogo completo—, sobre las mismas 112 fotos.

El catálogo tiene **20 figuras**, de las cuales solo 7 aparecen en las fotos. Las
otras 13 actúan de distractoras: para acertar no basta con parecerse a la figura
correcta, hay que parecerse **más** a ella que a las otras diecinueve.

| | valor |
|---|---:|
| Silueta detectada vs máscara real | media 0,960 · mediana 0,975 · peor 0,363 |
| **Figura identificada bien (top-1 de 20)** | **111 / 112** |
| IoU con la figura correcta | media 0,931 · mediana 0,944 · peor 0,348 |
| Margen sobre la segunda mejor figura | media 0,272 |
| **Aprueba con `MATCH_IOU=0,80`** | **110 / 112** |

Las dos fotos que no llegan a 0,80 son **exactamente las dos peores detecciones**
(0,363 y 0,735 de silueta contra su propia máscara): `IMG_20260825_204316005`
—el cisne, que además es la única mal identificada, se le asigna `house`— y
`IMG_20260825_202754824` —el molino—. No falla el catálogo, falla el detector en
esas dos fotos, y el error se propaga.

Para separar las dos cosas se repitió la medida **sustituyendo la silueta
detectada por la máscara etiquetada a mano**, con deja-uno-fuera en la silueta de
referencia (se recalcula sin la foto que se está probando, para que no se mida
contra sí misma):

| | con la silueta detectada | con la máscara real |
|---|---:|---:|
| Figura identificada bien | 111 / 112 | **112 / 112** |
| IoU con la figura correcta, media | 0,931 | 0,942 |
| IoU con la figura correcta, peor | 0,348 | **0,830** |
| Aprueba con 0,80 | 110 / 112 | **112 / 112** |

Leído junto: **el catálogo no confunde ninguna de las siete figuras**, ni siquiera
la peor foto, y el techo de todo el sistema lo pone el detector. Es una conclusión
útil, porque dice dónde invertir: en el detector —el render sintético— y no en
los umbrales ni en la geometría.

Una advertencia sobre cómo se hizo, porque cambia lo que se puede afirmar: la
silueta de referencia de esas siete figuras **se sacó de estas mismas fotos**
(promediando las máscaras de cada grupo tras alinearlas por giro). En la columna
de la máscara real eso está compensado con el deja-uno-fuera; en la de la silueta
detectada, no. Así que 111/112 mide *reconocimiento sobre el mismo juego y las
mismas figuras*, no generalización a un Tangram nuevo. Eso sigue sin medirse.

### Auditoría: por qué el denominador pasó de 114 a 112

Al agrupar las 114 fotos por silueta —con `comparar_siluetas`, que es indiferente
al giro, la escala, la posición y el espejo— salieron **ocho** grupos: siete de
entre 10 y 20 fotos, y uno de **dos**. Esa asimetría fue la que hizo abrir esas
dos fotos, y en ellas las siete fichas están **sueltas** sobre el papel: no
forman ninguna figura. Encima su máscara está incompleta —omite el romboide, así
que etiqueta 6 piezas de 7—. Se tomaron con dos segundos de diferencia y
coinciden entre sí al 0,979: son dos disparos durante el montaje o el desmontaje
de una figura, que se colaron en el conjunto.

Las dos se apartaron a `figuras_armadas_unet/_excluidas/`, **no se borraron**,
con un `MOTIVO.txt` al lado. Un dato retirado y explicado se puede defender; uno
que desaparece, no. El conjunto queda en 112 fotos y siete figuras distintas.

Conviene tener a mano el efecto exacto, porque es la primera pregunta que sigue:

| | sobre 114 (hasta el 5 de sept.) | sobre 112 (desde el 6) |
|---|---:|---:|
| IoU de silueta, media | 0,965 | 0,969 |
| IoU de silueta, **peor foto** | 0,699 | **0,904** |
| IoU ≥ 0,75 | 113/114 | **112/112** |
| Exactamente 7 fichas | 103/114 | 103/112 |
| Inventario exacto | 98/114 (86 %) | 98/112 (88 %) |

Es decir: **la única foto que quedaba por debajo del umbral era una de las dos
mal etiquetadas**, y no porque el detector fallara, sino porque la máscara contra
la que se medía era incorrecta. Los aciertos absolutos (103 y 98) no se mueven:
las dos fotos apartadas ya contaban como fallo en ambas columnas.

### Lo que no cambia

La conclusión central de la sección 2 se mantiene y sale **reforzada**: la forma
generaliza y el color no. Las 112 fotos siguen siendo de un Tangram distinto del
que entrenó al modelo por color. Y sigue sin estar medido lo que dice esa misma
sección: que el sistema sepa **rechazar** un armado equivocado, porque las 112
fotos son de figuras correctas.

Las tablas de las secciones 1 y 3 quedan como registro del modelo anterior, con
su denominador original de 114. Los números vigentes son los de arriba.

---

## 1. El resultado

| | producción (color) | este módulo (forma) |
|---|---:|---:|
| IoU de silueta, media | 0,096 | **0,963** |
| IoU de silueta, mediana | 0,009 | 0,975 |
| Peor foto | 0,000 | 0,834 |
| Mejor foto | 0,892 | 0,991 |
| IoU ≥ 0,75 | 2/114 (2 %) | **114/114 (100 %)** |
| Fichas detectadas, media | 1,21 de 7 | 8,67 de 7 |

La diferencia es de **+0,867 de IoU**. No hay una sola foto en la que el modelo
nuevo baje del umbral de 0,75, y no hay una sola en la que el viejo lo alcance
salvo dos.

## 2. Qué demuestra esto exactamente, y qué no

**Lo que demuestra: que la forma generaliza y el color no.** Estas 114 fotos son
de un Tangram **distinto** del que se usó para entrenar el modelo de producción
—romboide azul, triángulos rosa y verde, donde él busca `parallelogram_cyan` y
`large_tri_orange`—. El modelo nuevo nunca vio ese juego, ni ningún otro: solo
imágenes generadas con color y material sorteados en cada muestra. Y aun así lo
reconoce casi perfectamente.

Eso es exactamente la hipótesis del módulo, y queda comprobada: **un detector
entrenado sobre geometría sirve para cualquier Tangram; uno entrenado sobre
color sirve para el suyo.**

**Lo que no demuestra: que el modelo nuevo sea mejor para el juego con el que sí
se entrenó el viejo.** Esa comparación no está hecha y no se puede deducir de
aquí. Sobre su propio juego, el modelo de producción funciona.

**Lo que tampoco demuestra: que el sistema distinga una figura bien armada de
una mal armada.** Las 114 fotos son de figuras **correctas**. Esta medida dice
cuánto se parece lo detectado a lo que hay, no si el sistema sabría rechazar un
armado equivocado. Para eso hacen falta fotos de figuras mal armadas, que no
existen en el dataset.

## 3. El problema que sí aparece: sobredetección

El modelo nuevo ve **8,67 fichas donde hay 7**. No es ruido disperso: son la
misma pieza detectada dos veces. Quitando las detecciones que se solapan más de
0,5 con otra mejor —el criterio de `descartar_duplicados()` del pipeline— la
media baja a 7,82, pero sigue sobrando.

| | crudo | tras quitar dobles |
|---|---:|---:|
| Detecciones, media | 8,67 | 7,82 |
| Exactamente 7 | 10/114 (9 %) | 15/114 (13 %) |
| Inventario exacto (2 grandes, 1 mediano, 2 pequeños, 1 cuadrado, 1 romboide) | — | **0/114 (0 %)** |

### Y no es ruido: confunde el cuadrado y el romboide con dos triángulos pequeños

Al desglosar por clase aparece un patrón demasiado limpio para ser azar:

| ficha | esperadas | detectadas (media) | diferencia |
|---|---:|---:|---:|
| triángulo grande | 2 | 2,17 | +0,17 |
| triángulo mediano | 1 | 1,11 | +0,11 |
| triángulo pequeño | 2 | **3,54** | **+1,54** |
| cuadrado | 1 | **0,51** | **−0,49** |
| romboide | 1 | **0,49** | **−0,51** |

Falta el cuadrado en 56 de 114 fotos y el romboide en 58, y sobran justo los
triángulos pequeños que los sustituyen.

> **Corrección del 4 de septiembre.** Aquí se atribuyó el fallo a la geometría
> del Tangram —el cuadrado y el romboide tienen el área de dos triángulos
> pequeños y se pueden teselar con ellos, así que dentro de una figura armada la
> lectura sería indistinguible—. Esa explicación es cierta como fenómeno, pero
> **no es la causa de estos números**. La causa real se encontró al construir la
> calibración por color: en `tangram_validator.PIEZAS_CANONICAS` el romboide
> está definido **con el mismo polígono que el cuadrado** —cuatro lados iguales y
> cuatro ángulos de 90°—, y `composicion.py` construye las fichas sintéticas a
> partir de ahí. Es decir: **el dataset de entrenamiento tenía dos cuadrados y
> ningún romboide.** El modelo no confunde el romboide: nunca vio uno.
>
> Por qué no saltó antes: la propia batería de comprobación del validador
> verifica las **áreas** de las siete fichas, y el cuadrado y el romboide miden
> exactamente lo mismo (2 unidades). La única propiedad que se estaba
> comprobando es justo la que no puede distinguirlos.
>
> Mientras el polígono no se corrija y el dataset no se regenere, los números de
> inventario de este informe no miden lo que dicen medir. Los de **silueta** sí:
> no dependen de la etiqueta de cada ficha.

Esto explica por qué el inventario nunca sale exacto y por qué la silueta sí: la
confusión **conserva el área y los píxeles**, solo cambia la etiqueta.

**Qué importa para el producto.** El validador responde «te falta una ficha» o
«te sobra una», y con este modelo ese mensaje sería equivocado casi siempre. Con
`REQUIRE_INVENTORY=0` un inventario mal contado no invalida la figura, así que la
nota seguiría bien; lo que fallaría es la explicación. Y esa explicación es media
razón de ser del sistema.

### La consecuencia de diseño: la guarda se mide por área, no por inventario

De aquí salió `tangram_validator.cobertura_detectada`. Como la confusión conserva
el área, sumar las áreas canónicas de lo detectado sí dice si se vio un Tangram
entero, aunque las etiquetas estén mal:

| cobertura de área (1,0 = las 7 fichas) | producción (color) | este módulo (forma) |
|---|---:|---:|
| media | 0,221 | 1,026 |
| mediana | 0,125 | 1,000 |
| **peor foto** | 0,000 | **0,875** |
| pasan el umbral de 0,80 | 5/114 | **114/114** |

Con el umbral en 0,80 el sistema califica las 114 fotos del detector por forma y
se niega a calificar 109 de las 114 del detector por color —que sobre este juego
de Tangram, efectivamente, no está viendo la figura—.

## 4. Por qué el resultado encaja con el experimento de silueta

El experimento de `pipeline_silueta` midió, sobre las máscaras de referencia, que
dos capturas de la **misma** figura nunca bajan de 0,832 de IoU y dos figuras
**distintas** nunca pasan de 0,625.

La peor máscara del modelo nuevo se parece a la real en **0,834**: justo por
encima de ese piso. Es decir, sus siluetas caen dentro del margen donde la
comparación geométrica sigue separando bien. Es un argumento a favor de que el
detector nuevo no rompería la validación —pero por poco, y con una sola foto
marcando el límite.

## 5. Qué haría falta para ponerlo en producción

1. **Reducir la sobredetección.** Endurecer la NMS entre clases o subir `conf`, y
   volver a medir el inventario. Es el único bloqueo real.
2. **Fotos de figuras mal armadas**, para medir si el sistema las rechaza. Sin
   eso no hay medida de discriminación, solo de cobertura.
3. **Probarlo extremo a extremo** por el servicio, no por este script: mismo
   `imgsz`, misma ruta de código, y recalibrar `MATCH_IOU` con
   `python tangram_validator.py --calibrar`.
4. **Medirlo sobre el juego del modelo viejo**, para saber si se gana en
   generalización sin perder en el caso conocido.
