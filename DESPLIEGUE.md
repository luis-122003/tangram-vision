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

En **Ajustes** de la app, escribe `https://tu-dominio.me/api`. Funciona desde
cualquier red, sin estar en la misma WiFi que el servidor. Para que el APK la
traiga ya puesta, añádela a `expo.extra.apiUrls` de `mobile/app.json` y vuelve
a generarlo (`mobile/README.md`).

## Operación

| Qué | Cómo |
|---|---|
| Actualizar el código | `git pull && docker compose up -d --build` |
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
`docente@tangram.edu` y `estudiante@tangram.edu` con clave `1234`.
