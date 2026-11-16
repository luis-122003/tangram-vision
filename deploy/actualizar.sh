#!/usr/bin/env bash
# actualizar.sh — pone en producción la versión que ya está en GitHub.
#
#   ssh <usuario>@tangram-ia.northcentralus.cloudapp.azure.com
#   cd ~/tangram-ia && bash deploy/actualizar.sh
#
# En orden: copia de la base, trae el código, reconstruye, levanta y comprueba
# que la API responde. Si algo falla antes de levantar, se detiene sin haber
# tocado los contenedores que están sirviendo.
#
# Lo que NO hace, a propósito:
#   - No vuelve atrás solo. Si la comprobación final falla, imprime la orden
#     exacta para volver al commit anterior y la deja en manos de quien mira:
#     una reconstrucción tarda minutos y no conviene que arranque sola mientras
#     nadie está delante.
#   - No toca deploy/backend.env, deploy/vision.env ni .env. Ahí están los
#     secretos del servidor, no se versionan y una actualización no los cambia.
#   - No toca vision-service/models/: los pesos del detector no van en git.
#
# Opciones:
#   --sin-copia    salta la copia de la base (más rápido; úsalo solo si acabas
#                  de hacer una a mano)
#   --forzar       reconstruye aunque GitHub no traiga nada nuevo
set -euo pipefail
cd "$(dirname "$0")/.."

SIN_COPIA=0
FORZAR=0
for arg in "$@"; do
  case "$arg" in
    --sin-copia) SIN_COPIA=1 ;;
    --forzar)    FORZAR=1 ;;
    *) echo "Opción desconocida: $arg (usa --sin-copia o --forzar)"; exit 1 ;;
  esac
done

# `docker compose` (v2, el plugin) y `docker-compose` (v1) conviven según cómo
# se instalara Docker. Se resuelve una vez y se usa igual en todo el script.
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "[!] No encuentro docker compose. ¿Es este el servidor?"; exit 1
fi

[ -f docker-compose.yml ] || { echo "[!] No estoy en la raíz del repositorio."; exit 1; }
[ -f .env ] || { echo "[!] Falta .env. Ejecuta antes: bash deploy/generar-secretos.sh"; exit 1; }
[ -f deploy/backend.env ] || { echo "[!] Falta deploy/backend.env."; exit 1; }

# DOMINIO se usa para la comprobación final. Se lee del .env sin exportar el
# resto del archivo, que lleva las claves de MySQL.
DOMINIO="$(grep -E '^DOMINIO=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
[ -n "$DOMINIO" ] || { echo "[!] .env no define DOMINIO."; exit 1; }

echo "═══ Actualizando https://$DOMINIO ═══"
echo

# ── 1. La copia de la base ───────────────────────────────────────────────────
# Va antes de cualquier otra cosa: el arranque del backend aplica los cambios
# de esquema que traiga la versión nueva, y eso no tiene marcha atrás.
if [ "$SIN_COPIA" = "0" ]; then
  mkdir -p respaldos
  COPIA="respaldos/respaldo-$(date +%F-%H%M).sql"
  echo "[1/5] Copia de la base en $COPIA …"
  if $DC exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction tangram_ia' > "$COPIA"; then
    chmod 600 "$COPIA"
    echo "      $(du -h "$COPIA" | cut -f1). Recuerda: sin la ENCRYPTION_KEY de"
    echo "      deploy/backend.env, los nombres y correos de esta copia son ilegibles."
  else
    rm -f "$COPIA"
    echo "[!] No se pudo copiar la base. ¿Está MySQL levantado ($DC ps)?"
    exit 1
  fi
else
  echo "[1/5] Copia de la base: omitida (--sin-copia)."
fi
echo

# ── 2. El código ─────────────────────────────────────────────────────────────
ANTES="$(git rev-parse HEAD)"
echo "[2/5] Trayendo el código. Ahora mismo: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"

# Un archivo modificado a mano en el servidor haría fallar el pull a la mitad.
# Mejor verlo aquí que con la mitad del código cambiado.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[!] Hay cambios sin guardar en el servidor:"
  git status --short
  echo "    Deshazlos con 'git checkout -- <archivo>' o guárdalos antes de seguir."
  exit 1
fi

git fetch --quiet origin
RAMA="$(git rev-parse --abbrev-ref HEAD)"
DESPUES="$(git rev-parse "origin/$RAMA")"

if [ "$ANTES" = "$DESPUES" ] && [ "$FORZAR" = "0" ]; then
  echo "      Ya está en la última versión de origin/$RAMA. Nada que hacer."
  echo "      (Si aun así quieres reconstruir: bash deploy/actualizar.sh --forzar)"
  exit 0
fi

git merge --ff-only "origin/$RAMA"
echo "      Ahora: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"
echo

# ── 3. Reconstruir ───────────────────────────────────────────────────────────
# La web lleva dentro la dirección de la API (VITE_API_URL), así que un cambio
# del frontend solo llega reconstruyendo la imagen de caddy; no basta reiniciar.
echo "[3/5] Reconstruyendo las imágenes (puede tardar varios minutos) …"
$DC up -d --build
echo

# ── 4. Esperar a que levanten ────────────────────────────────────────────────
echo "[4/5] Esperando a que los contenedores queden sanos …"
for i in $(seq 1 60); do
  CAIDOS="$($DC ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -v ' running' || true)"
  [ -z "$CAIDOS" ] && break
  sleep 5
done
$DC ps
echo

# ── 5. Comprobar que responde de verdad ──────────────────────────────────────
# Se pide por el nombre del dominio pero resolviéndolo a la propia máquina:
# así el certificado cuadra y no depende de que la red deje salir y volver.
echo "[5/5] Comprobando https://$DOMINIO/api/health …"
SALUD=""
for i in $(seq 1 24); do
  SALUD="$(curl -fsS --max-time 10 --resolve "$DOMINIO:443:127.0.0.1" \
             "https://$DOMINIO/api/health" 2>/dev/null || true)"
  [ -n "$SALUD" ] && break
  sleep 5
done

if [ -z "$SALUD" ]; then
  echo "[!] La API no responde después de dos minutos."
  echo
  $DC logs --tail 40 backend || true
  echo
  echo "    Para volver a la versión anterior:"
  echo "      git reset --hard $ANTES && $DC up -d --build"
  [ "$SIN_COPIA" = "0" ] && echo "    La base está copiada en $COPIA."
  exit 1
fi

echo "$SALUD"
echo

# Un 'false' aquí no tumba el despliegue, pero cambia lo que el sistema hace:
# sin los pesos, califica en modo demostración; sin Supabase, no guarda fotos.
for clave in db_connected yolo_loaded storage_connected; do
  case "$SALUD" in
    *"\"$clave\":true"*)  echo "      [OK] $clave" ;;
    *"\"$clave\":false"*) echo "      [!]  $clave está en false — revísalo." ;;
  esac
done

# Las imágenes que quedan sueltas tras varias reconstrucciones llenan el disco
# de una máquina pequeña, y un disco lleno tira MySQL.
docker image prune -f >/dev/null 2>&1 || true

echo
echo "═══ Listo. $(git rev-parse --short HEAD) en producción. ═══"
echo
echo "Si esta actualización trae cuentas nuevas o claves que cambiar:"
echo "  $DC exec backend node scripts/listar-cuentas.mjs"
echo "  $DC exec backend node scripts/crear-docente.mjs   <correo> \"<nombre>\""
echo "  $DC exec backend node scripts/crear-estudiante.mjs <correo> \"<nombre>\""
echo "  $DC exec backend node scripts/cambiar-clave.mjs    <correo>"
