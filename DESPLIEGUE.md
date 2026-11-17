# Despliegue — Tangram IA en un servidor con dominio y HTTPS

Esto deja el sistema en Internet: `https://<tu-dominio>` sirve la web del
docente y del estudiante, y `https://<tu-dominio>/api` la API que usan la web y
la app móvil. El servicio de visión y MySQL quedan dentro del servidor, sin
ningún puerto abierto hacia fuera.

Para la demostración en un PC del aula no hace falta nada de esto: ver
`ENTREGA.md`.

```
Internet ──443──▶ caddy ──┬── /       → web estática
                          └── /api/*  → backend ──▶ vision (interno)
                                                └──▶ mysql  (interno)
```

Son cuatro contenedores (`docker-compose.yml`). Caddy pide y renueva solo el
certificado de Let's Encrypt.

**Dónde está hoy.** El sistema corre en una máquina virtual de Azure, en
`tangram-ia.northcentralus.cloudapp.azure.com`. Los capítulos 1 a 5 describen el
montaje en DigitalOcean, que fue donde se levantó la primera vez; el servidor de
Azure es el mismo `docker-compose.yml` sobre Ubuntu con Docker, así que todo lo
que viene después del paso 4 vale igual. Para **actualizar** lo que ya está
corriendo, salta a «Actualizar producción».

---

## 1. Cuentas (una sola vez)

1. **GitHub Student Pack.** En <https://education.github.com/pack>, verifica tu
   cuenta con el correo de la universidad o el carné. La aprobación puede tardar
   unos días.
2. **DigitalOcean.** Desde el Pack, reclama la oferta: son 200 USD de crédito
   durante un año. Al registrarte, entra **con GitHub** para que se aplique el
   crédito. Puede pedir una tarjeta o un pago de prueba con PayPal para validar
   la cuenta, y solo cobra lo que exceda el crédito.
3. **Dominio en Namecheap.** También desde el Pack: un dominio `.me` gratis por un
   año. Si aún no lo tienes, mira la alternativa temporal del paso 3.
4. **Gmail.** En la cuenta que enviará los códigos: *Cuenta de Google →
   Seguridad → Verificación en dos pasos* (actívala) → *Contraseñas de
   aplicaciones* → crea una llamada «Tangram». Guarda las 16 letras.
5. **Supabase** (las fotos de los intentos). En <https://supabase.com>, crea un
   proyecto nuevo y después:
   - **Storage → New bucket** `intentos`, **sin** marcar «Public bucket». Ponle
     un límite de 12 MB y los tipos `image/jpeg, image/png, image/webp, image/bmp`.
   - **Project Settings → API Keys**: copia la URL del proyecto y la clave
     **`sb_secret_…`**. La `sb_publishable_…` no sirve.
   - Un proyecto gratuito se **pausa tras una semana sin uso**. Si
     `/api/health` da `storage_connected: false`, entra al panel y reactívalo.

## 2. El servidor en DigitalOcean (Droplet)

Primero, una clave SSH en tu PC (PowerShell). Si ya tienes una, sáltalo:

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\tangram_do
Get-Content $HOME\.ssh\tangram_do.pub      # esto es lo que se pega en DigitalOcean
```

En el panel: **Create → Droplets**.

| Campo | Valor |
|---|---|
| Región | **New York** (NYC1 o NYC3) o **Atlanta**: las más cercanas a Colombia |
| Imagen | **Ubuntu 24.04 (LTS) x64** |
| Tamaño | **Basic → Regular → 4 GB / 2 CPU** (24 USD/mes). Con 2 GB, el detector y MySQL no caben juntos |
| Autenticación | **SSH Key → New SSH Key**: pega el contenido de `tangram_do.pub` |
| Hostname | `tangram-ia` |

Al crearlo aparece su **IP pública**. No cambia mientras el Droplet exista.

Después, **Networking → Firewalls → Create Firewall**: entrada solo **SSH (22),
HTTP (80) y HTTPS (443)**. Aplícalo al Droplet `tangram-ia`.

**El crédito.** 24 USD al mes sobre 200 USD alcanzan para unos 8 meses, dentro
del año que dura la oferta. Ojo: **un Droplet apagado sigue cobrando**. Solo
deja de cobrar si se destruye, así que no lo apagues pensando en ahorrar. En
*Billing → Billing Alerts* pon un aviso en 150 USD.

## 3. El dominio

En Namecheap: **Domain List → Manage → Advanced DNS**. Borra los registros que
traiga y crea:

| Tipo | Host | Valor |
|---|---|---|
| A | `@` | la IP del Droplet |
| A | `www` | la misma IP |

Tarda entre minutos y una hora. Para comprobarlo: `nslookup tu-dominio.me`
debe devolver la IP. **No sigas al paso 5 hasta que resuelva**: Caddy pide el
certificado al arrancar, y si el dominio todavía no apunta, Let's Encrypt
rechaza la petición y después aplica una espera.

**Mientras llega el dominio.** `sslip.io` convierte una IP en un nombre que
Let's Encrypt acepta, sin registrar nada. Con IP `203.0.113.7`, usa
`DOMINIO=203-0-113-7.sslip.io` en el `.env`. Cuando tengas el `.me`, cambia
`DOMINIO` y vuelve a ejecutar `docker compose up -d --build` (hay que
reconstruir: la web lleva la dirección de la API dentro).

## 4. Preparar el servidor

Desde tu PC (PowerShell):

```powershell
ssh -i $HOME\.ssh\tangram_do root@<IP>
```

Ya en el Droplet:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Firewall del sistema, además del de DigitalOcean
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# El código
git clone https://github.com/luis-122003/tangram-vision.git tangram-ia
cd tangram-ia
```

Los pesos del detector no están en git. Cópialos **desde tu PC**:

```powershell
scp -i $HOME\.ssh\tangram_do vision-service\models\tangram_formas_v2.pt root@<IP>:~/tangram-ia/vision-service/models/
```

## 5. Configurar y arrancar

En el Droplet, dentro de `tangram-ia`:

```bash
bash deploy/generar-secretos.sh     # crea .env, deploy/backend.env y deploy/vision.env
nano .env                           # DOMINIO=tu-dominio.me (o la IP con sslip.io) y ACME_EMAIL
nano deploy/backend.env             # SMTP_USER, SMTP_PASS, SMTP_FROM y SUPABASE_*
```

El script genera las claves de MySQL, de sesión y de cifrado, y no las imprime.
**Copia `ENCRYPTION_KEY` y `BLIND_INDEX_KEY` a un gestor de contraseñas**: si se
pierde el servidor sin ellas, los nombres y correos de los estudiantes no se
pueden descifrar ni desde una copia de la base.

```bash
docker compose up -d --build        # la primera vez tarda ~10 min (torch, ultralytics)
docker compose ps                   # los cuatro deben quedar «healthy» o «running»
docker compose logs backend         # [OK] MySQL, [OK] Visión, [OK] SMTP
```

## 6. El primer docente

En producción no hay cuentas de demostración. Crea la del docente:

```bash
docker compose exec backend node scripts/crear-docente.mjs docente@tudominio.me "Nombre Apellido"
```

Pide la clave dos veces, sin mostrarla. Los estudiantes los da de alta el
docente desde su panel, o se registran ellos desde la app con su correo.

## 7. Comprobar

1. `https://tu-dominio.me/api/health` debe dar:

   ```json
   "db_connected": true, "yolo_loaded": true, "yolo_weights": "tangram_formas_v2.pt",
   "storage_enabled": true, "storage_connected": true
   ```

   Si `yolo_weights` no es ese archivo, o `yolo_loaded` es `false`, el sistema
   califica en **modo demostración**: revisa el `scp` del paso 4.
2. `https://tu-dominio.me`: el candado del navegador sin avisos. Inicia sesión
   como docente y toma una foto: la cámara solo funciona porque hay HTTPS.
3. Registro desde la app con un correo tuyo: debe llegar el código.
4. Desde tu PC, comprueba que lo interno no se ve desde fuera. Las dos órdenes
   tienen que **fallar** por tiempo agotado:

   ```powershell
   Test-NetConnection <IP> -Port 8001
   Test-NetConnection <IP> -Port 3306
   ```

## 8. La app móvil

La dirección va fija dentro del APK: `expo.extra.apiUrl` de `mobile/app.json`
(`https://tu-dominio/api`). La app no deja cambiarla. Si el dominio cambia,
actualiza ese valor y vuelve a generar el APK (`mobile/README.md`). Funciona
desde cualquier red.

## Actualizar producción

Una actualización es siempre lo mismo: subir el cambio a GitHub desde el PC y
traerlo en el servidor. El servidor **no** sube nada ni edita archivos a mano.

**En tu PC**, con el cambio ya probado:

```powershell
git add -A ; git commit -m "Qué cambió" ; git push
```

**En el servidor**, por SSH:

```bash
ssh <usuario>@tangram-ia.northcentralus.cloudapp.azure.com
cd ~/tangram-ia
bash deploy/actualizar.sh
```

El script hace, en este orden y parándose si algo falla:

1. **Copia de la base** en `respaldos/respaldo-<fecha>.sql`. Va primero porque
   el backend aplica al arrancar los cambios de esquema que traiga la versión
   nueva, y eso no tiene marcha atrás. Con `--sin-copia` se salta.
2. **Trae el código** (`git merge --ff-only`). Si alguien editó archivos en el
   servidor, se detiene y los enseña en vez de pisarlos.
3. **Reconstruye las imágenes.** Hace falta incluso para un cambio de una línea
   en la web: la dirección de la API va *dentro* del paquete del frontend
   (`VITE_API_URL`), así que reiniciar el contenedor no bastaría.
4. **Espera** a que los cuatro contenedores queden en marcha.
5. **Comprueba `/api/health`** por el dominio real, resolviéndolo a la propia
   máquina para que el certificado cuadre, y avisa si `db_connected`,
   `yolo_loaded` o `storage_connected` vienen en `false`.

Si la comprobación final falla, imprime los últimos registros del backend y la
orden para volver al commit anterior. No vuelve atrás solo, a propósito: una
reconstrucción tarda varios minutos y no conviene que arranque sin nadie
delante.

| Caso | Orden |
|---|---|
| Actualización normal | `bash deploy/actualizar.sh` |
| Cambio que no toca el detector | `bash deploy/actualizar.sh --solo "caddy backend"` |
| Reconstruir sin que haya código nuevo | `bash deploy/actualizar.sh --forzar` |
| Si acabas de copiar la base a mano | `bash deploy/actualizar.sh --sin-copia` |

**Sobre `--solo`.** La imagen del servicio de visión arrastra torch y
ultralytics: reconstruirla son varios minutos con la CPU al tope, y en una
máquina pequeña deja al resto sin aire mientras dura. Un cambio que no toca
`vision-service/` no tiene por qué pagar eso. La web vive dentro de la imagen de
`caddy` y los scripts de `backend/scripts/` dentro de la de `backend`, así que
para casi todo lo demás basta `--solo "caddy backend"`. Si dudas, no la uses:
reconstruirlo todo siempre es lo correcto, solo que más lento.

**Lo que una actualización no toca**, y hay que hacer aparte si cambió: `.env`,
`deploy/backend.env` y `deploy/vision.env` (no se versionan), los pesos del
detector en `vision-service/models/` (no van en git) y la dirección dentro del
APK (`mobile/app.json`, ver el paso 8).

### Las cuentas, desde el servidor

En producción no se siembra ninguna cuenta, y el correo y el nombre están
cifrados: un `SELECT` a la tabla `users` solo devuelve bytes. Por eso estas
cuatro órdenes, que usan las mismas funciones que el backend:

```bash
docker compose exec backend node scripts/listar-cuentas.mjs
docker compose exec backend node scripts/crear-docente.mjs    <correo> "<nombre>"
docker compose exec backend node scripts/crear-estudiante.mjs <correo> "<nombre>"
docker compose exec backend node scripts/cambiar-clave.mjs    <correo>
```

Las tres últimas piden la clave por la terminal y no la muestran: un argumento
quedaría en el historial del shell y en la lista de procesos. Exigen lo mismo
que la aplicación —12 caracteres al docente, 4 al estudiante, y nada de `1234`
ni `0000`— y `cambiar-clave` además cierra las sesiones que esa cuenta tuviera
abiertas, que es la mitad que importa cuando se recupera una cuenta.

Llegan al servidor con el `git pull` del propio script; no hay que copiarlas.

---

## Operación

| Qué | Cómo |
|---|---|
| Actualizar el código | `bash deploy/actualizar.sh` (ver «Actualizar producción») |
| Ver los registros | `docker compose logs -f backend` (o `vision`, `caddy`) |
| Reiniciar todo | `docker compose restart` |
| Copia de la base | `docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" tangram_ia' > respaldo-$(date +%F).sql` |
| Restaurar la copia | `docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" tangram_ia' < respaldo.sql` |

La copia de la base sirve **junto con** `deploy/backend.env`: sin las mismas
`ENCRYPTION_KEY` y `BLIND_INDEX_KEY`, sus datos personales son ilegibles.

`DB_PASSWORD` solo se aplica al crear el volumen de MySQL. Para cambiarla
después, hay que cambiarla también dentro de MySQL:
`ALTER USER 'tangram_app'@'%' IDENTIFIED BY '…';`

**Nunca** pongas `NODE_ENV=development` en el servidor: siembra las cuentas
`docente@tangram.edu` y `estudiante@tangram.edu` con la clave escrita en
`backend/src/db/schema.ts`, que está en el repositorio y la conoce cualquiera.
En producción no se siembra nada: el primer docente se da de alta con
`node scripts/crear-docente.mjs <correo> "<nombre>"`.
