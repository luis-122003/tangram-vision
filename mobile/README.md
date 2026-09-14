# Tangram IA — App móvil (Android)

App para el **estudiante**, hecha con React Native + Expo. Se conecta al mismo
backend Node.js que la versión web: el catálogo de figuras y sus siluetas
objetivo vienen de MySQL, y la validación la hace el servidor, que a su vez pasa
la foto al servicio de visión: YOLOv8s-seg detecta las 7 fichas y
`tangram_validator.py` revisa el armado por geometría
(inventario, fichas montadas, huecos, fichas sueltas y parecido de la silueta).

El docente sigue usando la versión web (`../frontend`).

## Pantallas

0. **Servidor** — atajos por red, búsqueda automática del backend y prueba de
   conexión (la dirección también se puede escribir a mano)
   (`/health`: base de datos, detector de fichas y umbral de aprobación). Con la
   sesión abierta ofrece además **cambiar la clave**; desde el ingreso no, que es
   donde no hay ninguna cuenta a la que cambiársela.
1. **Ingreso** — el teléfono recuerda al último estudiante y solo le pide una
   clave de cuatro dígitos en un teclado propio de teclas grandes. Por debajo no
   cambia nada: la tarjeta guarda el correo y el PIN viaja como contraseña, así
   que `POST /token` sigue recibiendo username + password. Al docente se le
   rechaza aquí: esta app es del estudiante, y el servidor no le acepta intentos
   (`POST /sessions` responde 403).
2. **Catálogo** — figuras de `/figures` con su silueta recortada sobre un bloque
   de color, filtros por categoría, estadísticas de `/students/{id}/stats` y una
   marca en las figuras ya logradas (se deducen de `/students/{id}/sessions`).
   Vuelve a pedir sus datos cada vez que se sale de una figura, que es lo que
   pone al día el sello y el contador del intento recién hecho.

   > **Pendiente.** `/students/{id}/stats` pasó a ser **solo del docente**: el
   > progreso de las actividades se mira desde su panel y desde ningún otro
   > sitio. La web del estudiante ya perdió sus cifras; aquí la llamada sigue
   > hecha y ahora responde 403. No rompe nada —va envuelta en un `.catch()` y
   > el catálogo se queda sin ese contador—, pero las tres cifras y la pantalla
   > **Mis intentos** hay que retirarlas cuando se lleve el cambio al teléfono.
   > La marca de las figuras logradas **sí se queda**: sale de
   > `/students/{id}/sessions`, que sigue abierta al propio estudiante porque es
   > parte de jugar y no una medida de su desempeño.
2b. **Mis intentos** — los últimos 20 de `/students/{id}/sessions`: qué figura,
   si se logró, cuánto se pareció y cuánto tardó. Las tres cifras del catálogo
   son una cuenta; esto es el recuerdo.
2c. **Mi clave** — cambiarla en tres pasos (la de ahora, la nueva, la nueva otra
   vez) contra `POST /password`. Al terminar el servidor revoca todas las
   sesiones, así que se vuelve al ingreso. Existe porque las cuentas se siembran
   con `1234` y hasta ahora no había forma de cambiarlo desde el teléfono.
3. **La figura** — el objetivo en grande antes de armar, con el inventario de
   las 7 fichas y el consejo de luz.
4. **Cámara** — marco de encuadre, silueta objetivo superpuesta (apagable),
   linterna y cronómetro.
5. **Resultado** — veredicto (que llega también por vibración, antes de que dé
   tiempo a leer), parecido contra el umbral (`match_threshold`), el contorno
   armado superpuesto al modelo, la **revisión punto por punto** que hace el
   validador del backend (`checks`: las 7 fichas, ninguna montada, sin huecos,
   todas juntas y parecido), las 7 fichas con la que la cámara no encontró
   marcada en punteado (`pieces.missing`) y, cuando la figura ya se parece pero
   no pasó, qué banda de la silueta revisar (`segments`). Si el intento no llegó
   a anotarse en el servidor se dice, con su botón de reintentar: antes ese fallo
   iba a un `catch` vacío y el intento se perdía sin que nadie se enterara.

El **botón atrás** retrocede una fase (resultado → figura → catálogo) en vez de
abandonar el intento, y durante el análisis no hace nada: la foto ya va camino
del servidor.

## Diseño

Neobrutalismo: cada elemento es una placa con fondo de color plano, **filete
negro** y una **sombra sólida** desplazada. Ninguna sombra se difumina, así que
no simula luz: es una segunda silueta negra que hace que la placa parezca
recortada y apoyada sobre la página. Radio cero en todo. Los tokens y los
helpers (`raised`, `inset`, `pressed`, `subtle`, `flat`) viven en
`src/theme/index.ts`, y las primitivas (`Card`, `PrimaryButton`, `Chip`,
`Difficulty`, `Note`, `Bar`) en `src/components/ui.tsx`.

- **Requiere la New Architecture** (RN ≥ 0.76; aquí RN 0.86 con Expo 57), por
  `boxShadow`, que no existe en la arquitectura antigua. Dos detalles de su
  parser que hay que respetar: el desenfoque va **siempre explícito como `0px`**
  (`"6px 6px #111"` se descarta en silencio en Android), y `boxShadow: "none"`
  **no es válido** — para anularla se sobreescribe con desplazamiento cero, que
  es lo que hace la constante `NO_SHADOW`.
- **El color significa algo**: verde lo logrado, amarillo lo que está a medias,
  rojo lo que va mal, azul lo informativo. La regla que sostiene la paleta es que
  la tinta es negra sobre todos los rellenos menos el azul, que lleva tinta
  crema; la tabla `ON` lo fija y `onFill()` lo resuelve, para que ningún sitio de
  uso pueda equivocarse.
- **El color nunca va solo**: cada estado lleva además icono y palabra escrita.
  Y lo que garantiza el contraste es el filete negro, no el relleno — un bloque
  verde apenas contrasta con el papel; su filete da 17,5:1.
- **Las cinco fichas del Tangram** conservan sus nombres de color porque nombran
  la ficha *física*. Dos se desplazaron de matiz a propósito —el verde es
  azulado, el ciruela es magenta—: un verde amarillento colapsa contra el rojo en
  deuteranopía y un morado contra el azul. Aun así, lo que de verdad distingue
  una ficha es su forma, y su contorno negro es lo que impide confundir dos
  vecinas.
- **Los botones se aplastan contra su propia sombra al pulsarlos**, como una
  tecla real: son `Pressable` y no `TouchableOpacity`. Ojo al editarlos:
  `transform` mueve la vista **junto con su sombra**, así que trasladar sin
  anular la sombra no da medio gesto, da ninguno. `pressed()` hace las dos cosas.
- **La vista de cámara es la excepción**: ahí manda la foto, y una sombra dura
  necesita un suelo de contraste conocido. Sobre la cámara el sistema se
  invierte —el papel hace de tinta, los filetes van en crema y no hay sombras—.
  El disparador es el único control que sí la lleva, porque se apoya en la barra
  opaca de abajo, y la lleva en color: una sombra negra sobre un fondo casi negro
  no se vería.
- **El cuadro de encuadre y el recorte del servidor son lo mismo**, y por eso
  las alturas de las dos barras viven en una sola constante cada una —`CAM_TOP`
  y `CAM_BOTTOM`, arriba de `GameScreen`—. Antes el número estaba escrito dos
  veces, en el estilo y en la fórmula de `marcoEncuadre()`: cambiar uno y
  olvidar el otro dejaba al backend analizando una franja distinta de la que vio
  el niño, sin ningún error visible. Ahora se pueden ajustar, pero solo desde su
  constante.
- **El tamaño del cuadro lo limita el ancho de la pantalla, no el alto.** El
  cuadro es cuadrado —una figura de Tangram cabe en un cuadrado en cualquier
  orientación, y así el mismo sirve para las 14—, así que su lado nunca pasa de
  `ancho − 2·margen` mientras verticalmente suele sobrar espacio. Si hay que
  agrandarlo, la única palanca que actúa por el lado que se desborda es
  `MARCO_MARGEN` (0,025): con 0,055 el cuadro ocupaba el 89 % del ancho, ahora
  el 95 %. Por debajo de 0,02 los brazos de las esquinas quedan pegados al borde
  y deja de leerse como un cuadro.
- **El recorte que se manda al servidor es un 15 % mayor que el cuadro
  dibujado** (`RECORTE_COLCHON`). El preview va en `cover` y la foto tiene la
  relación de aspecto del sensor, así que la correspondencia es aproximada: más
  vale incluir algo de mesa de sobra que cortarle una ficha a la figura. En la
  práctica, una figura que asome un poco del cuadro se sigue analizando entera.

- **Tipografía**: Archivo Black para titulares y cifras, Archivo para el cuerpo,
  vía `@expo-google-fonts`. Cada peso se importa por su subruta
  (`@expo-google-fonts/archivo/400Regular`) porque Metro no hace tree-shaking:
  importar desde la raíz del paquete metería los 18 pesos (2,4 MB) en el APK.
- **Iconografía**: SVG propio en `src/components/Icon.tsx`, trazo de 2–3 px
  sobre rejilla de 24. No se usan emoji: cambian de forma en cada teléfono y no
  se pueden recolorear.
- **Zonas seguras**: Android pinta su barra de estado y su barra de gestos
  encima del layout, así que cada pantalla reserva `SAFE_TOP` arriba y la barra
  de la cámara deja libre la franja inferior.

---

## Paso 1 — Configurar la IP del backend

En el teléfono, `localhost` es el propio teléfono, **no tu PC**. Hay que usar
la IP de tu computador en la red WiFi. Averígualа en Windows con `ipconfig`
(campo **Dirección IPv4** del adaptador Wi-Fi, algo como `192.168.1.10`).

**Casi nunca hay que tocar nada, y nunca hay que recompilar.** La app se sabe
de memoria las direcciones donde ya encontró el backend —las de `app.json` más
las que se hayan escrito a mano alguna vez, guardadas en el teléfono— y **al
arrancar las prueba todas**: usa la última que funcionó y, si esa no contesta,
sondea las demás en paralelo y se queda con la que responda `/health`. Llegar al
aula con la IP de casa guardada ya no pide nada: se abre la app y entra.

Cuando hace falta intervenir, todo está en **Servidor** (abajo en la pantalla de
ingreso, o el engranaje dentro de la app):

- **Mis redes** — un toque en «Universidad», «Casa» o cualquier dirección
  guardada: la pone y la prueba de una vez. Es lo que se usa si se cambió de red
  con la app ya abierta.
- **Buscar el servidor en la red** — repite el sondeo del arranque a mano.
- **Escribirla a mano** — solo cuando la IP es nueva. Al guardarla queda en
  «Mis redes» y la app la volverá a probar sola de ahí en adelante, sin
  recompilar.

Las direcciones horneadas en el APK están en `app.json`, y es el único sitio del
proyecto donde aparece una IP:

```json
"extra": {
  "apiUrls": [
    { "etiqueta": "Aula",  "url": "http://192.168.1.10:8000" },
    { "etiqueta": "Casa",  "url": "http://192.168.0.20:8000" }
  ]
}
```

**Viene vacía a propósito.** Una IP solo sirve en la red donde se escribió, y
este repositorio es público: publicar las direcciones de un aula concreta no
ayuda a nadie de fuera y describe esa red a cualquiera. Pon las tuyas antes de
generar el APK.

Añadir una red al APK es añadir una entrada a esa lista; nada más en el código
depende de ella. Las direcciones se limpian al leerlas (espacios de más, barra
final, `http://` ausente), así que un `"http:// 192.168.1.10:8000"` mal
teclado no rompe la app.

> Esto es clave el día de la sustentación: si la red de la universidad bloquea
> la comunicación entre dispositivos, conecta el portátil al **hotspot del
> celular**, saca la IP nueva con `ipconfig` y escríbela en Ajustes; queda
> guardada y a partir de ahí la app la reconoce sola.

## Paso 2 — Arrancar los servicios escuchando en la red

Son dos procesos. El servicio de visión puede quedarse en local (solo lo llama
el backend), pero el backend sí tiene que aceptar conexiones desde el teléfono:

```
# terminal 1, desde ../vision-service con el venv activado
python -m uvicorn service:app --port 8001

# terminal 2, desde ../backend
npm run dev        # Express escucha en todas las interfaces por defecto
```

Si Windows muestra una alerta del firewall, permite el acceso en **redes privadas**.

Comprueba desde el navegador del teléfono que abra:
`http://TU_IP:8000/health`

## Paso 3 — Probar la app (rápido, sin compilar)

```
cd mobile
npm install
npx expo start
```

Instala **Expo Go** desde Play Store, escanea el QR y la app abre al instante.
Ideal para desarrollo, porque recarga sola al guardar cambios.

> El teléfono y la PC deben estar en el **mismo WiFi**.

## Paso 4 — Generar el APK instalable

Hay dos caminos: en la nube (sin instalar nada, pero con cola de espera) o
localmente (requiere Android Studio, pero compila en minutos).

### Opción A — Local con Android Studio (recomendado si vas a iterar)

1. Instala **Android Studio** (incluye el JDK y el SDK de Android).
2. Genera el proyecto nativo y compila:

```
cd mobile
npx expo prebuild --platform android
cd android
.\gradlew.bat assembleRelease
```

3. El APK queda en:
   `android\app\build\outputs\apk\release\app-release.apk`

No necesitas crear una keystore: la plantilla firma el release con la keystore
de depuración, lo cual sirve perfectamente para instalar por USB o compartir el
archivo. (Solo haría falta una keystore propia para publicar en Play Store.)

La carpeta `android/` es generada y está en `.gitignore`; puedes borrarla y
volver a crearla con `expo prebuild` cuando quieras.

### Opción B — En la nube con EAS Build

Para tener la app instalada de verdad (sin Expo Go), se usa EAS Build, que
compila en la nube de Expo (gratis, no necesitas Android Studio):

```
npm install -g eas-cli
eas login                       # crea una cuenta gratis en expo.dev
eas build:configure
eas build -p android --profile preview
```

Al terminar te da un enlace para descargar el `.apk`. Pásalo al teléfono y
ábrelo; Android pedirá permitir "instalar apps de origen desconocido".

El perfil `preview` genera APK directo. Créalo en `eas.json` si no existe:

```json
{
  "build": {
    "preview": {
      "android": { "buildType": "apk" }
    }
  }
}
```

---

## Notas

- **Cámara**: la app usa `expo-camera` con permiso nativo, así que no tiene la
  restricción de HTTPS que sí afecta a los navegadores. Funciona con HTTP
  en red local (`usesCleartextTraffic` está habilitado en `app.json`).
- **Si cambias de red WiFi** cambia la IP de tu PC, pero no hay que recompilar
  ni normalmente tocar nada: la app sondea al arrancar las direcciones que
  conoce y adopta la que conteste (`buscarServidor` en `src/api/client.ts`, y la
  lista en `src/api/config.ts`). Si el ingreso falla por red, vuelve a buscar y
  reintenta una vez antes de dar el error.
- **HTTP en claro**: Android 9+ bloquea el tráfico sin cifrar por defecto. El
  plugin `expo-build-properties` lo habilita (`usesCleartextTraffic`), que es
  lo que permite hablar con el backend por `http://` en la red local.
- **Permisos**: la app solo pide cámara e internet (y vibración, que Android no
  considera peligroso). Los demás que Expo agrega por defecto (micrófono,
  almacenamiento) están bloqueados en `app.json`. Si el estudiante deniega la
  cámara **en firme**, Android deja de mostrar el diálogo: la pantalla lo
  detecta (`canAskAgain`) y lleva a los ajustes del sistema, porque el botón de
  pedir permiso ya no haría nada.
- **La foto se encoge antes de subirla** a 2000 px de lado mayor
  (`LADO_MAXIMO`), y la captura ya no pide `base64` —lo produce el manipulador
  sobre la versión pequeña, en vez de construir una cadena de varios megas para
  tirarla—. La cifra tiene cuentas detrás: el servidor recorta el cuadro de
  encuadre (dos tercios del ancho) y el detector reescala eso a `YOLO_IMGSZ`
  (960). A 2000 px el recorte sigue rondando los 1000 y el detector reduce; con
  1280 se quedaría en ~630 y tendría que **ampliar**, que es justo lo que este
  proyecto se dedicó a evitar. No bajarla sin rehacer las cuentas.
- **Usuario de prueba**: `estudiante@tangram.edu` / `1234`. Cámbiala desde
  Ajustes → Mi clave antes de usar la app con estudiantes de verdad.

## Lo que falta para publicarla

Nada de esto hace falta para el aula ni para la sustentación, pero sí para
distribuirla de verdad:

- **Keystore propia.** Hoy el `release` se firma con `debug.keystore` (ver
  `android/app/build.gradle`). Sirve para instalar por USB o pasar el APK; no
  para Play Store, y no permite actualizar una app ya publicada.
- **`versionCode`** sigue en 1, y **`minifyEnabled`** está desactivado.
- **`extra.eas.projectId`** no está en `app.json`: `eas build` pide un `eas init`
  antes.
- **Sin tests, sin linter y sin CI.** La red de seguridad de hoy es
  `npx tsc --noEmit`, que sí conviene correr antes de cada APK.
- **Los tokens viven en `AsyncStorage`**, no en `expo-secure-store`. En Android
  ese almacenamiento es privado de la app salvo en un teléfono rooteado, y la
  decisión está razonada en `../SEGURIDAD.md`.
- **iOS** no está probado: hay configuración en `app.json`, pero no hay build.
