# Tangram IA

Sistema inteligente basado en visión computacional para la validación en tiempo
real de configuraciones Tangram físicas, con aplicación en el fortalecimiento
del pensamiento lógico-espacial en estudiantes de básica primaria.

Basado en el anteproyecto de grado *"Desarrollo de un sistema inteligente
basado en visión computacional para la validación en tiempo real de
configuraciones Tangram..."* (Universidad de San Buenaventura, Cali).

## Cómo funciona

La app le muestra al estudiante la **silueta objetivo**; él la arma con su
Tangram físico (7 fichas reales) y le toma una foto. El backend la procesa en
dos etapas:

1. **YOLOv8s-seg** — detecta y segmenta las 7 fichas individuales. Es el único
   modelo del pipeline. Los pesos actuales usan una clase por ficha física,
   distinguida por color (`large_tri_orange`, `large_tri_green`,
   `medium_tri_red`, `small_tri_red`, `small_tri_blue`, `square_yellow`,
   `parallelogram_cyan`); el validador también entiende la taxonomía
   geométrica de 5 clases y traduce entre ambas.
2. **`tangram_validator.py`** — con las fichas ya localizadas, decide por
   geometría determinista si el armado es correcto. Responde cinco preguntas,
   y cada una es una razón concreta que se le puede dar al estudiante:

   | Comprobación | Qué detecta |
   |--------------|-------------|
   | Inventario   | falta o sobra alguna de las 7 fichas |
   | Solape       | fichas montadas una sobre otra |
   | Huecos       | espacios sin cubrir *dentro* de la figura |
   | Conectividad | fichas separadas del cuerpo de la figura |
   | Forma        | parecido de la silueta con la figura objetivo |

La comparación de siluetas normaliza posición y escala (centroide y área) y
busca el giro por barrido continuo —no solo los cuatro múltiplos de 90°—,
probando también la versión reflejada. Así no importa desde qué lado de la mesa
tomó la foto el niño, y el sistema puede decirle además *cuánto* está girada su
figura o que la armó en espejo.

**Por qué la geometría y no una segunda red.** Antes de la silueta se
encargaba un U-Net/ResNet34 (280 MB de pesos, TensorFlow, un segundo modelo que
entrenar). Su única salida era una máscara, y una máscara no puede explicar
*por qué* está mal un armado: no sabe que falta el cuadrado ni que hay dos
fichas montadas. Peor aún, si al niño le falta una ficha del interior el
contorno exterior no cambia y el IoU da 100 %. El validador ve ese hueco. La
silueta que producía el U-Net sale igual de bien de la unión de las máscaras
que YOLO ya devuelve, así que el backend se quedó con un solo modelo, arranca
en segundos y responde en medio segundo. Ese medio segundo es casi todo el
detector: medido sobre el equipo de desarrollo (CPU, sin GPU), YOLO tarda unos
500 ms por foto y el validador geométrico ~50 ms. La primera foto después de
arrancar cuesta más —unos 2,4 s— porque el modelo se calienta con ella.

Los pesos del U-Net siguen en `vision-service/models/` como respaldo del
entrenamiento, y verlos ahí hace pensar que falta un modelo por activar. **No
falta**: ningún archivo del proyecto los importa. Para no tener que fiarse de
esta frase, `/health` lo dice en cada comprobación:

```jsonc
{ "shape_matching": "geometric", "models_loaded": ["yolov8s-seg"] }
```

Un solo modelo cargado, y la comparación marcada como geométrica. Si
`models_loaded` sale vacío, lo que falla es el detector —no el comparador— y el
servicio está respondiendo en modo demostración.

### El U-Net como segunda opinión (`UNET_ENABLED=1`)

Que el U-Net se retirara por buenas razones no quiere decir que la decisión esté
medida. Con `UNET_ENABLED=1` el servicio carga también el U-Net y cada respuesta
trae un bloque `unet` con el IoU que habría dado **su** silueta sobre la misma
foto, junto al que da la unión de las máscaras de YOLO:

```jsonc
"iou_score": 0.87,                     // oficial: unión de máscaras YOLO
"unet": { "available": true, "iou": 0.83, "delta": -0.04, "ms": 190 }
```

No califica y ningún cliente lo pinta: `delta` es la cifra que hay que promediar
sobre un lote para poder afirmar con datos si el segundo modelo aportaba algo.
Para el estudio completo:

```bash
python evaluar_siluetas.py fotos/ --csv resultados.csv
```

Las fotos van en subcarpetas con el slug de la figura (`fotos/house/*.jpg`). La
tabla da media, dispersión y tiempo de cada vía, y sobre todo el **acuerdo**: en
qué porcentaje de fotos las dos habrían dado el mismo veredicto al estudiante.
Dos vías que califican igual son intercambiables, y entonces gana la barata.

Apagado por defecto, y apagado no cuesta nada: `unet_silueta.py` importa
TensorFlow dentro de la función, así que el servicio normal arranca en 0,7 s sin
tocarlo. Encendido cuesta ~15 s de arranque y ~190 ms por foto (CPU: TensorFlow
no usa GPU en Windows nativo).

**El preprocesamiento, que no estaba documentado.** No quedó el notebook de
entrenamiento, pero el modelo lo dice: su primera capa `bn_data` tiene guardados
`moving_mean = [123.2, 115.5, 102.3]` y `std ≈ 70`, las medias de ImageNet en
RGB y escala 0..255. Es la firma de `segmentation_models`/`classification_models`
(qubvel), cuyo backbone normaliza dentro. Comprobado midiendo su salida:

| Entrada | Tras `bn_data` | |
|---|---|---|
| 0..255 RGB crudo | media +0,55 · desv 1,06 | normaliza bien |
| 0..1 | media −1,27 · desv 0,02 | la señal se colapsa |

Así que la imagen entra **en RGB, 0..255, sin dividir entre 255**. Dividir no da
error: da una máscara casi vacía, que es peor.

**Lo que sigue sin comprobarse.** Sobre una figura *sintética* —polígonos planos
dibujados con OpenCV— el U-Net devuelve ruido. No dice nada malo del modelo: es
una imagen fuera de la distribución con la que aprendió. Pero su calidad real
solo puede medirse con fotos del proyecto, y para eso está el diagnóstico:

```bash
python unet_silueta.py foto.jpg     # deja un PNG con la máscara encima de la foto
```

Si el tinte cae sobre las fichas, el modelo funciona; si se dispersa por la mesa,
no reconoce lo que ve y el estudio comparativo no tendría sentido.

El resultado (coincidencia, IoU, fichas detectadas, revisión punto por punto y
retroalimentación) se muestra de inmediato y se guarda en MySQL para que el
docente haga seguimiento del progreso (tiempo de resolución, aciertos, IoU), en
línea con los objetivos de evaluación del anteproyecto.

Los umbrales del validador son calibrables y se pueden justificar con datos:

```bash
cd vision-service
python tangram_validator.py --autotest   # 30 pruebas internas
python tangram_validator.py --calibrar   # separabilidad del catálogo
```

`--calibrar` mide la mayor confusión entre figuras distintas y la peor
coincidencia de una figura consigo misma girada y escalada: el umbral de
aceptación debe caer entre esos dos números.

### El encuadre de la foto

Una figura armada con las 7 fichas ocupa bastante mesa, así que el estudiante
tiene que alejar el teléfono y la figura acaba siendo una parte pequeña del
fotograma. Como el detector reescala la imagen entera, esas fichas le llegan con
muy pocos píxeles. Por eso la app dibuja un **cuadro cerrado** sobre la cámara y
manda su posición en `crop` (`[x, y, ancho, alto]` normalizados): el servidor
recorta ahí antes de detectar, y la figura recupera tamaño sin pedirle al niño
que se acerque. Con la figura al 12 % de la foto, recortar sube la fracción útil
de 0.07 a 0.24.

Dos salvaguardas, porque el preview de la cámara y la foto del sensor no tienen
la misma relación de aspecto: la app no manda `crop` si la foto llega en otra
orientación, y el servidor reintenta con la foto completa si dentro del recuadro
no encuentra ninguna ficha (lo avisa en `warnings`).

La respuesta trae además `framing`, que se mide **sobre los píxeles de la foto y
no sobre lo detectado** —justamente porque hace falta cuando el detector falla—:
las fichas son de acrílico saturado sobre hoja clara, así que la figura es la
zona con color. De ahí salen los dos consejos que entiende un niño: *«acércate,
salió muy pequeña»* y *«aléjate, no cabe entera en el cuadro»*.

`/predict` devuelve además `detected_polygon` y `target_polygon`: el contorno
que armó el estudiante y la silueta objetivo, normalizados sobre el mismo
lienzo y con el contorno ya girado a la orientación con la que se calculó el
IoU. **Los dos clientes** los superponen tal cual —`frontend/src/components/
Comparison.tsx` y `mobile/src/components/Comparison.tsx`, el mismo dibujo—, así
que el niño ve **dónde** se separó del modelo en vez de solo un porcentaje.
Junto a él va `checks` como lista de revisión: las cinco comprobaciones del
validador con su marca, que es lo que convierte el porcentaje en algo que el
estudiante puede corregir.

### Catálogo de figuras objetivo

Las figuras viven en la tabla `figures` de MySQL. Cada una guarda su silueta
de referencia como un polígono normalizado (0..1). Esas siluetas se extrajeron
del dataset de entrenamiento *FigurasArmadas_YOLOv8* (14 clases) tomando, por
cada clase, el **polígono medoide** — el contorno más representativo según IoU
frente a todos los demás ejemplos de esa clase.

Se cargan las 14 figuras, pero solo 8 quedan activas por defecto (`enabled`),
que son aquellas cuya silueta de referencia resultó claramente reconocible:
Casa, Flecha, Pez, Triángulo, Gato, Interrogación, Persona y Pájaro. Para
activar el resto basta con actualizar la columna:

```sql
UPDATE figures SET enabled = 1 WHERE slug = 'rabbit';
```

## Arquitectura

El sistema son **dos procesos**, y el reparto no es accidental:

- **`backend/` (Node.js)** atiende a la web y a la app móvil: autentica, sirve el
  catálogo de figuras, guarda los intentos y calcula el progreso. Es todo lo que
  no es visión por computador.
- **`vision-service/` (Python)** analiza las fotos: detector YOLOv8-seg y
  validador geométrico. Está aparte porque el validador es geometría calibrada,
  con sus propias pruebas (`--autotest`) y su estudio de umbrales
  (`--calibrar`); traducirlo a otro lenguaje habría cambiado los resultados del
  sistema sin mejorar nada.

El servicio de visión **no habla con MySQL**: Node lee la figura objetivo y le
manda la silueta junto con la foto. Así hay una sola capa de acceso a datos y un
solo sitio con credenciales.

```
  App móvil ─┐
             ├─► backend/ (Node.js :8000) ──► MySQL
  Web ───────┘         │
                       └──► vision-service/ (Python :8001) ──► YOLOv8-seg + validador
```

## Estructura del proyecto

```
tangram-ia/
├── frontend/               ← React + TypeScript (Vite)
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts       ← llamadas al backend (auth, predict, sesiones)
│   │   │   └── session.ts      ← token JWT y cierre de sesión
│   │   ├── components/         ← una pantalla por archivo (login, catálogo,
│   │   │                         cámara, partida, dashboard docente)
│   │   ├── hooks/usePredict.ts
│   │   ├── theme/brut.ts       ← sistema de diseño (neobrutalismo)
│   │   └── types/index.ts
│   └── .env.example
│
├── backend/                ← Node.js + Express + TypeScript + MySQL
│   ├── src/
│   │   ├── server.ts         ← arranque, CORS, límites de cuerpo
│   │   ├── config.ts         ← configuración leída del entorno
│   │   ├── routes/           ← auth, figures, predict, sessions, health
│   │   ├── auth/             ← firma y verificación del JWT, permisos por rol
│   │   ├── db/               ← pool MySQL, esquema y siembra, consultas
│   │   ├── vision/client.ts  ← cliente del servicio de visión
│   │   └── http/errors.ts    ← errores con el formato {detail} que leen las apps
│   ├── package.json
│   └── .env.example
│
├── vision-service/         ← Python: YOLOv8-seg + validador geométrico
│   ├── service.py           ← API interna (POST /analyze, GET /health)
│   ├── tangram_validator.py ← validador: inventario, solape, huecos, sueltas y
│   │                          comparación de siluetas (con --autotest y --calibrar)
│   ├── pipeline.py          ← puente detector → validador → respuesta
│   ├── data/
│   │   └── figures_seed.json ← catálogo + siluetas objetivo (semilla de MySQL)
│   ├── models/               ← pesos entrenados (ver models/README.txt)
│   ├── requirements.txt
│   └── .env.example
│
├── mobile/                 ← App Android del estudiante (React Native + Expo)
│   ├── src/screens/          ← ingreso, catálogo, figura, cámara y resultado
│   ├── src/theme/            ← sistema de diseño (neobrutalismo)
│   ├── src/components/       ← primitivas de UI, iconos SVG, siluetas y fichas
│   ├── src/api/client.ts     ← consume el mismo backend Node
│   └── README.md             ← cómo probarla y generar el APK
│
└── notebooks/               ← entrenamiento del detector (YOLO)
```

## Interfaz

Los dos clientes comparten un mismo lenguaje visual: **neobrutalismo**. Cada
elemento es una placa: fondo de color plano, filete negro y una sombra sólida
desplazada abajo a la derecha. La sombra no se difumina en ningún sitio, así que
no simula luz: es una segunda silueta negra que hace que la placa parezca
recortada y apoyada sobre la página. De ahí salen las cuatro formas que se usan
en todas las pantallas:

| Forma     | Qué es                            | Dónde                                       |
|-----------|-----------------------------------|---------------------------------------------|
| `raised`  | placa apoyada                     | tarjetas, botones en reposo, paneles        |
| `inset`   | hueco en la página, sin sombra    | campos, canales de barra, nichos            |
| `pressed` | se aplasta contra su propia sombra| un botón al pulsarse, un control activo     |
| `subtle`  | filete y sombra finos             | lo que se repite mucho: filas, inventarios  |

Y aquí **el color significa algo**: verde es lo logrado, amarillo lo que está a
medias, rojo lo que va mal, azul lo informativo. La regla que sostiene la paleta
es que **la tinta es negra sobre todos los rellenos menos el azul**, que por ser
el más oscuro lleva tinta crema; los acentos son claros y saturados precisamente
para que el negro se lea encima de todos ellos.

Tres cosas que conviene tener presentes:

- **El color nunca va solo.** Cada estado lleva relleno, icono y palabra escrita
  —«¡Lo lograste!», «Correcto», el visto o la admiración—, así que ninguno de los
  tres canales es imprescindible por separado.
- **Lo que garantiza el contraste es el filete negro, no el relleno.** Un bloque
  verde sobre el papel apenas contrasta con él; su filete da 17,5:1. Por eso
  ningún elemento con relleno de color existe sin filete.
- **La vista de cámara del móvil es la excepción.** Ahí manda la foto, y una
  sombra dura necesita un suelo de contraste conocido para leerse. Sobre la
  cámara el sistema se invierte: el papel hace de tinta, los filetes van en
  crema y no hay sombras. El disparador es el único control que sí la lleva
  —se apoya en la barra opaca de abajo— y en color, no en negro.

Los tokens están en `frontend/src/theme/brut.ts` y `mobile/src/theme/index.ts`.
En el móvil el estilo se apoya en `boxShadow`, que **exige la New Architecture**
de React Native (≥ 0.76; el proyecto va con 0.86) — aunque ahora se le pide
bastante menos que al diseño anterior: una sombra sin difuminar en vez de dos
difuminadas, y ninguna `inset`.

## App móvil (Android)

La versión para estudiantes también existe como app nativa Android en
`mobile/` (React Native + Expo). Usa la cámara del teléfono y consume el mismo
backend. El docente sigue usando la web. Instrucciones completas para probarla
y generar el APK: `mobile/README.md`.

## Setup rápido

### 0. Requisitos
- Node.js 18+, Python 3.10+
- MySQL Server corriendo localmente (la app crea la BD y las tablas solas)
- Navegador con acceso a cámara (requiere `localhost` o HTTPS)

Hay **tres cosas que arrancar**: el servicio de visión, el backend y el
frontend, en ese orden. Una vez instalado todo, `.\dev.ps1` los levanta juntos
y comprueba que respondan.

### 1. Servicio de visión (Python)
```bash
cd vision-service
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env            # ajusta YOLO_WEIGHTS al archivo real de models/

python -m uvicorn service:app --reload --port 8001
```

> Si el archivo de pesos no está o `YOLO_WEIGHTS` apunta a un nombre que no
> existe, el servicio igual arranca pero responde en modo demostración
> (`"mock": true`): parte de la propia silueta objetivo, la deforma un poco y la
> hace pasar por el mismo comparador, para que los números y los dibujos de la
> app sean coherentes entre sí. Conviene comprobarlo en `/health`: si
> `yolo_loaded` es `false`, no se está usando el detector.

**Versión del detector.** Los pesos se guardaron con `ultralytics 8.4.79`, por
eso `requirements.txt` exige esa versión como mínimo. Con versiones anteriores
los pesos no cargan.

### 2. Backend (Node.js)

Primero, el usuario de MySQL. El backend **no debe conectarse como `root`**: si
alguna vez se filtrara el `.env`, el alcance sería el servidor entero y no esta
aplicación. El script deja un usuario que solo puede tocar `tangram_ia`:

```bash
# Cambia la clave de ejemplo dentro del archivo antes de ejecutarlo.
mysql -u root -p < backend/sql/crear-usuario.sql
```

```bash
cd backend
npm install

cp .env.example .env
# Edita .env: credenciales de MySQL y los CUATRO secretos, que son obligatorios
# —el servidor no arranca sin ellos—. Los de sesión:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Los de cifrado de datos personales:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run dev
```
Al arrancar crea la base de datos, las tablas `users` / `sessions` / `figures`
y siembra el catálogo de figuras y dos usuarios demo:
- Estudiante: `estudiante@tangram.edu` / `1234`
- Docente: `docente@tangram.edu` / `1234`

Esas dos cuentas se siembran **solo fuera de producción**, y su clave se puede
cambiar desde la propia aplicación (`POST /password`), que además cierra las
sesiones abiertas en los demás dispositivos.

Backend: http://localhost:8000 · Estado: http://localhost:8000/health

Para comprobar que las piezas sueltas siguen bien —sin necesidad de MySQL ni
del servidor levantado—:

```bash
npm test          # pruebas unitarias del backend
```

### 3. Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Frontend: http://localhost:5173

## Autenticación y seguridad

`POST /token` devuelve dos **JWT firmados**: uno de acceso (1 h), que viaja en
cada petición, y uno de refresco (12 h), que solo sirve para renovar el primero.
Los clientes los guardan y renuevan solos, así que el estudiante no vuelve a
teclear su clave a media actividad. `POST /logout` invalida **todas** las
sesiones abiertas de esa persona.

Los permisos siguen la realidad del aula: el listado completo de intentos es del
docente, y cada estudiante solo alcanza lo suyo. Un estudiante que pida
`/sessions` recibe un 403. En `/predict` y `/sessions` el estudiante se toma del
token, nunca del cuerpo.

El nombre y el correo de los estudiantes —son menores— se guardan **cifrados**
con AES-256-GCM, con un índice ciego para poder buscarlos en el login. Las
contraseñas van con bcrypt, y el inicio de sesión está limitado por IP y por
cuenta con bloqueo creciente, sin captcha: quien entra es un niño de primaria.

**Todo lo anterior está documentado y razonado en [SEGURIDAD.md](SEGURIDAD.md)**,
incluidas las decisiones que se tomaron en contra del manual por el contexto del
aula y lo que queda pendiente. Para comprobar que sigue en pie:

```bash
cd backend && npm run probar-seguridad   # 40 comprobaciones sobre el servidor vivo
```

## Variables de entorno

**frontend/.env**
```
VITE_API_URL=http://localhost:8000
```

**backend/.env** — base de datos, sesiones y dirección del servicio de visión

Aquí van solo las variables que hay que entender para arrancar; la plantilla
completa y comentada es `backend/.env.example`, y es la que conviene copiar.
**Los cuatro secretos son obligatorios: sin cualquiera de ellos el servidor no
arranca**, porque un valor por defecto compartido equivaldría a no tener ni
autenticación ni cifrado.

```
PORT=8000
NODE_ENV=development

# NO uses root: el proyecto trae el script que crea un usuario con permisos
# solo sobre esta base (ver «Setup rápido»).
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=tangram_app
DB_PASSWORD=
DB_NAME=tangram_ia

# Dos secretos DISTINTOS: si se filtra el de acceso, no debe servir para
# fabricar tokens de refresco. Cada uno, 32 bytes o más:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=
REFRESH_SECRET=
# El de acceso viaja en cada petición, así que dura poco; el de refresco es el
# que sostiene la jornada sin volver a pedirle la clave al estudiante.
JWT_EXPIRES_IN=1h
REFRESH_EXPIRES_IN=12h

# Cifrado de los datos personales de los estudiantes (son menores): el nombre y
# el correo van con AES-256-GCM, y el correo lleva además un índice ciego para
# poder buscarlo en el login. 32 bytes cada una:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Si se pierden, los datos cifrados son irrecuperables.
ENCRYPTION_KEY=
BLIND_INDEX_KEY=

VISION_URL=http://127.0.0.1:8001
# Debe quedar por debajo del tope del cliente (45 s en la app móvil), o el
# teléfono se rinde antes y el niño ve un error de red en vez del mensaje real.
VISION_TIMEOUT_MS=40000

# La foto viaja en base64, que abulta un tercio más que el JPEG.
MAX_IMAGE_MB=12
```

**vision-service/.env** — detector y umbrales del validador
```
YOLO_WEIGHTS=models/tangram_piezas_seg_best.pt
YOLO_CONF=0.35
# Resolución a la que el detector reescala la foto. Las figuras armadas son
# grandes, el niño fotografía de lejos y cada ficha queda con pocos píxeles:
# con los 640 de fábrica se perdían.
YOLO_IMGSZ=960

# Acierto mínimo para dar la figura por correcta (0..1)
MATCH_IOU=0.75
# A partir de aquí se le dice al estudiante "vas bien, ajusta"
CLOSE_IOU=0.70
# Si es 0, faltar o sobrar fichas se informa pero no invalida la figura
REQUIRE_INVENTORY=0
```

Los umbrales viven en el servicio de visión y no viajan en cada petición:
`tangram_validator` los guarda en variables de módulo, así que fijarlos por
petición haría que dos fotos analizadas a la vez se pisaran los umbrales.

El valor de fábrica del validador es `MATCH_IOU=0.85`, que es lo que aguanta el
catálogo sin confundir una figura con otra (ver `--calibrar`). En el despliegue
se usa **0.75** y el inventario queda **informativo** por una razón práctica: en
fotos reales el detector no recorta las fichas con precisión de píxel y a veces
pierde alguna por una sombra, y no se le puede reprobar al estudiante un armado
correcto por un fallo de la cámara. La revisión igual se le muestra: cuando la
figura se aprueba con una comprobación en falso, la app la marca en ámbar y
explica que no cuenta en contra.

## Endpoints

| Método | Ruta                       | Acceso            | Descripción                                    |
|--------|----------------------------|-------------------|------------------------------------------------|
| POST   | `/token`                   | público           | Login (bcrypt) → token de acceso y de refresco |
| POST   | `/token/refresh`           | público           | Renueva el token de acceso                     |
| POST   | `/logout`                  | autenticado       | Cierra la sesión en todos los dispositivos     |
| GET    | `/health`                  | público           | MySQL, detector, umbral y cómo se compara      |
| GET    | `/figures`                 | autenticado       | Catálogo de figuras activas con sus siluetas   |
| GET    | `/figures?all=true`        | autenticado       | Incluye también las figuras desactivadas       |
| POST   | `/predict`                 | autenticado       | Valida una foto contra la figura objetivo      |
| POST   | `/sessions`                | **estudiante**    | Registra el intento (el alumno sale del token) |
| GET    | `/sessions`                | **docente**       | Historial de todo el curso, paginado           |
| GET    | `/students/{id}/sessions`  | propio o docente  | Historial de un solo estudiante, paginado      |
| GET    | `/students/{id}/stats`     | propio o docente  | Total, aprobados, IoU promedio y accuracy      |
| GET    | `/health/metrics`          | **docente**       | Consultas a la base: totales, lentas, errores  |

Los listados devuelven `{ rows, total, limit, offset }` y nunca más de 100 filas,
por mucho que se pidan.

`/health` queda sin autenticar a propósito: la pantalla de ajustes de la app
móvil la usa para comprobar la dirección del servidor *antes* de iniciar sesión.
Protegerla convertiría «la IP está mal» en «credenciales incorrectas», que es
justo el diagnóstico que esa pantalla existe para distinguir.

En `/predict` y `/sessions` el estudiante se toma **del token**, no del cuerpo:
si se confiara en el cuerpo, se podrían anotar intentos a nombre de un compañero.

### El servicio de visión

Es interno y no debe quedar expuesto a Internet: no autentica a nadie.

| Método | Ruta       | Descripción                                                       |
|--------|------------|-------------------------------------------------------------------|
| POST   | `/analyze` | `{image_b64, crop, figure:{slug,name,silhouette}}` → el JSON de `/predict` |
| GET    | `/health`  | Si el detector cargó y con qué umbral trabaja                      |

### Respuesta de `/predict`

Además de `iou_score`, `match` y `feedback`, trae la revisión del validador:

```jsonc
{
  "match": false,            // la silueta calza, pero hay fichas montadas
  "iou_score": 0.82,
  "match_threshold": 0.75,
  "checks": {
    "inventory":    { "ok": true,  "counted": 7, "expected": 7 },
    "overlap":      { "ok": false, "fraction": 0.16 },
    "holes":        { "ok": true,  "fraction": 0.0, "count": 0 },
    "connectivity": { "ok": true,  "components": 1, "loose": 0 },
    "shape":        { "ok": true,  "close": true, "iou": 0.82,
                      "angle": 37.0, "mirrored": false }
  },
  "messages": ["Hay fichas montadas una sobre otra (16% del area). ..."]
}
```

La app pinta `checks` como una lista de revisión y `messages` queda para el
docente: es el diagnóstico completo, en el mismo orden en que lo razonó el
validador. Este ejemplo muestra por qué la revisión importa: el parecido supera
el umbral, y sin embargo la figura no pasa porque dos fichas están montadas —un
porcentaje solo no habría podido decir eso—.
