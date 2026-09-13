# Entrega — Tangram IA

Guía corta para el día de la entrega: qué se entrega, cómo se arranca y qué
hacer si algo falla delante del jurado. El detalle técnico está en `README.md`;
esto es el guion.

---

## 1. Qué se entrega

| Pieza | Dónde | Nota |
|---|---|---|
| Código fuente | este repositorio | backend, frontend, mobile, vision-service |
| App Android | `mobile/tangram-ia-1.0.0.apk` | se instala sin Play Store |
| Modelo detector | `vision-service/models/tangram_formas_v2.pt` | no va en git (pesa 23 MB) |
| Documentación | `README.md`, `SEGURIDAD.md`, `mobile/README.md` | |

Los pesos y el APK están en `.gitignore` a propósito. Si la entrega es un ZIP
en vez de un repositorio, hay que **añadirlos a mano**: sin el `.pt` el sistema
arranca en modo demostración y devuelve cifras inventadas.

Los tres `.env` tampoco se versionan. Cada uno tiene su `.env.example` al lado.

---

## 2. Antes de arrancar

1. **MySQL corriendo** en el puerto `3307` con la base `tangram_ia`.
2. Los tres archivos de configuración existen:
   `vision-service\.env`, `backend\.env`, `frontend\.env`.
3. El entorno de Python existe: `vision-service\venv\Scripts\python.exe`.

`dev.ps1` comprueba los puntos 2 y 3 antes de abrir ninguna ventana, y avisa si
`YOLO_WEIGHTS` apunta a un archivo que no existe. El punto 1 no lo comprueba:
si MySQL está apagado, el backend levanta igual y falla al iniciar sesión.

**Las fotos de los intentos (opcional).** Si `backend\.env` trae las variables
`SUPABASE_*`, cada foto que manda el estudiante queda guardada y el docente la ve
junto al intento en su panel. Sin ellas el sistema funciona igual, analizando la
foto y descartándola: la única diferencia es que la columna «Foto» sale con una
raya. Nunca impide jugar —si el almacén está caído, el intento se registra sin
imagen—. Para configurarlo por primera vez, ver «Las fotos de los intentos» en el
`README.md`; el bucket tiene que ser **privado**, porque son fotos de menores.

---

## 3. Arranque

Doble clic en **`Iniciar Tangram IA.bat`**. Abre tres ventanas, en este orden:

| Proceso | Puerto | |
|---|---|---|
| Servicio de visión (Python) | 8001 | va primero: cargar el detector tarda unos segundos |
| Backend (Node) | 8000 | compila y sirve desde `dist/` |
| Frontend (Vite) | 5173 | |

Al terminar imprime la comprobación. **Los dos renglones que hay que mirar:**

```
  MySQL conectado : True
  Deteccion fichas: YOLOv8s-seg cargado
  Pesos cargados  : tangram_formas_v2.pt
```

La tercera línea importa tanto como las otras dos. En `models/` conviven el
detector actual y el anterior, y arrancar con el que no es sale **todo en
verde**: `yolo_loaded` da `true` igual y el aviso de modo demostración no
aparece. El nombre del archivo es lo único que los distingue.

Si sale `NO CARGADO`, aparece un recuadro rojo de MODO DEMOSTRACIÓN: el sistema
responde con cifras simuladas que salen de deformar la propia silueta objetivo,
no de la foto. **No se puede presentar así.** Se arregla revisando
`YOLO_WEIGHTS` en `vision-service\.env`.

---

## 4. Checklist, diez minutos antes

- [ ] MySQL arriba, y hay al menos un estudiante creado para iniciar sesión.
- [ ] `Iniciar Tangram IA.bat` da `MySQL conectado: True`, `YOLOv8s-seg cargado`
      y `Pesos cargados: tangram_formas_v2.pt`.
- [ ] Abrir `http://localhost:5173`, iniciar sesión, **tomar una foto de prueba**.
      La primera foto después de arrancar tarda unos 2,4 s porque el modelo se
      calienta con ella; las siguientes, medio segundo. Esa foto se gasta ahora,
      no delante del jurado.
- [ ] Si vas a enseñar las fotos en el panel del docente: abrir
      `http://localhost:8000/health` y comprobar que dice
      `"storage_enabled": true` **y** `"storage_connected": true`. Con el primero
      en `false` faltan las credenciales; con el segundo en `false` el almacén no
      responde. En los dos casos el sistema funciona, pero la columna «Foto» sale
      vacía, y eso delante del jurado parece un error aunque no lo sea.
- [ ] Tangram físico sobre una superficie lisa y **de color contrastado** con las
      fichas, sin sombras duras encima.
- [ ] Si se muestra la app móvil:
      - [ ] celular y PC en la **misma red WiFi**;
      - [ ] en Ajustes de la app, la IP de la PC (`ipconfig` → IPv4), no `localhost`:
            `http://192.168.x.x:8000`;
      - [ ] el Firewall de Windows tiene que dejar pasar los puertos 8000 y 8001.
            La primera vez que un celular se conecta, Windows muestra un aviso —si
            se descarta, la app no vuelve a conectarse y no dice por qué.
- [ ] Dos o tres fotos ya tomadas de figuras correctas, guardadas en el
      escritorio, por si la cámara o la luz fallan en el momento.

---

## 5. Si falla en vivo

| Síntoma | Causa más probable | Qué hacer |
|---|---|---|
| La app dice "error de red" al instante | backend apagado o IP equivocada | mirar la ventana del backend; comprobar la IP en Ajustes |
| Spinner eterno al iniciar sesión | IP de otra máquina de la red | corregir la IP; el tope de login son 12 s |
| Todo responde pero califica raro | modo demostración | revisar el recuadro rojo del arranque |
| Login falla y el resto va | MySQL caído, o sesión vieja | reiniciar MySQL; volver a entrar |
| Las ventanas se cierran solas al arrancar | ya había procesos en esos puertos | está funcionando; abrir `http://localhost:5173` |
| El panel del docente no muestra las fotos | el almacén no está configurado, o no responde | mirar `storage_enabled` y `storage_connected` en `/health`. **No pares la demostración por esto**: el sistema califica igual, solo faltan las imágenes |

Nota: si al abrir la app aparece que la sesión caducó, hay que **volver a
iniciar sesión** y ya. No es un fallo del sistema.

---

## 6. Estado honesto de lo medido

Lo que sí está medido, y se puede defender con números:

- **Validación geométrica de la silueta** (etapas de limpieza, normalización,
  alineación y comparación IoU), sobre las 114 máscaras reales del dataset
  (esa medición es del 1 de septiembre, anterior al descarte de las dos fotos):
  AUC 1.000, margen de decisión +0.207, cero pares mal clasificados. La
  alineación por rotación es indispensable: sin ella el AUC cae a 0.737.
  Detalle en `../pipeline_silueta/informe_resultados.md`.
- **Tiempo de respuesta**: ~500 ms el detector, ~50 ms el validador, en CPU.
- **Detección de fichas por forma.** `tangram_formas_v2.pt`, en producción desde
  el 6 de septiembre de 2026. Los dos modelos se midieron **en la misma corrida,
  sobre las mismas 112 fotos y a la misma resolución (640 px)**, para que la
  comparación no dependa de cómo se lanzó cada uno:

  | | anterior (por color) | actual, en crudo | actual + reparación |
  |---|---:|---:|---:|
  | IoU de silueta, media | 0,162 | 0,968 | **0,969** |
  | IoU de silueta, peor foto | 0,000 | 0,904 | **0,904** |
  | fotos con IoU ≥ 0,75 | 2 / 112 | 112 / 112 | **112 / 112** |
  | fichas detectadas (hay 7) | 1,09 | 8,62 | **7,09** |
  | fotos con exactamente 7 | 1 / 112 | 1 / 112 | **103 / 112** |
  | inventario exacto | 0 / 112 | 0 / 112 | **98 / 112** |

  Son 112 y no 114 porque el 6 de septiembre se apartaron dos fotos cuya máscara
  estaba mal trazada (`figuras_armadas_unet/_excluidas/MOTIVO.txt`). El modelo
  anterior se midió también a 960 px, que era su resolución de entrenamiento, y
  ahí sale **peor** (IoU 0,113): la tabla usa su mejor resultado.

  El salto son dos cosas distintas y conviene no mezclarlas al contarlo.
  Entrenar **por forma** en vez de por color es lo que quita la dependencia de
  un juego concreto y lo que sube la silueta de 0,162 a 0,968. Pero el detector
  nuevo, en crudo, devuelve **8,62 fichas de 7** y el inventario no cuadra en
  ninguna foto: parte el romboide por su diagonal en dos triángulos pequeños y
  duda entre cuadrado y romboide con confianzas de 0,48. Eso lo corrige
  `tangram_validator.reparar_cuadrilateros`, por geometría y sin reentrenar, y
  es lo que lleva el inventario de 0 a 98 de 112.
- **El sistema completo acierta la figura.** Es la medida que faltaba, y se hizo
  el 6 de septiembre con la cadena entera —detector, reparación geométrica,
  silueta y comparación contra el catálogo de **20 figuras**— sobre las 112 fotos.
  Solo 7 de esas 20 figuras aparecen en las fotos; las otras 13 son distractoras.

  | | resultado |
  |---|---:|
  | Figura identificada bien (la mejor de 20) | **111 / 112** |
  | Aprueba con `MATCH_IOU=0,80` | **110 / 112** |
  | IoU con la figura correcta | media 0,931 · peor 0,348 |
  | Margen sobre la segunda mejor figura | media 0,272 |

  Las dos fotos que se quedan cortas son **las dos peores detecciones**, no un
  fallo del catálogo: repitiendo la medida con la máscara etiquetada a mano en
  vez de la detectada —y recalculando la silueta de referencia sin la foto que se
  prueba— sale **112/112 identificadas y 112/112 aprobadas**. El techo lo pone el
  detector, no la geometría ni los umbrales.

  Con una advertencia que conviene decir antes de que la pregunten: la silueta de
  referencia de esas siete figuras se sacó de estas mismas fotos, así que 111/112
  mide **reconocimiento sobre el mismo juego y las mismas figuras**, no
  generalización a un Tangram nuevo.

- **Umbrales del validador**, con `python tangram_validator.py --calibrar`:
  `MATCH_IOU=0.80` y `CLOSE_IOU=0.75`. Los dos por encima de 0,741, que es la
  mayor IoU entre dos figuras **distintas** del catálogo. El catálogo pasó de 14
  a 20 figuras el 6 de septiembre —se añadieron las seis que se armaron de verdad
  en las fotos— y ese techo **no se movió**: sigue siendo `house` contra `arrow`.
  La peor de las seis nuevas es `conejo_sentado` contra `ferryboat`, 0,738.

Lo que **no** está medido, y conviene no afirmar:

- **Un segundo juego de Tangram.** Las 112 fotos son de un solo juego físico.
  El detector actual ya no mira el color —esa era justo la limitación del
  anterior— así que hay motivo para esperar que generalice, pero eso es una
  expectativa, no una medida. Haría falta fotografiar otro juego y repetir.
- **El aula.** No hay ni un dato de uso con estudiantes.
- **Las 14 fotos** en las que el inventario sigue sin cuadrar. Son casos donde
  el detector no ve una ficha, y ningún post-proceso puede inventarla.
- **El catálogo tiene figuras confundibles entre sí**, y eso no lo arregla
  ningún modelo: `house` contra `arrow` da 0,741 de IoU tras alinear giro,
  escala y posición. Seis parejas pasan de 0,70. Es un límite del catálogo y
  acota lo que el sistema puede prometer por bueno que sea el detector.
- Que las cifras sintéticas **no se pueden presentar como resultado del
  sistema**: sobre el dataset generado el mAP50-95 de máscara es 0,776, pero
  con un mAP50 de 0,796 casi igual al mAP50-95 —una diferencia de 0,012 cuando
  en datos reales suele ser de 0,15 a 0,30—. Esa brecha tan estrecha delata que
  la tarea, sobre imágenes generadas, es más fácil de lo que es sobre fotos.
  El número que vale es el de la tabla de arriba.
