#!/usr/bin/env bash
# Actualiza producción desde Azure Cloud Shell, sin SSH.
#
#   bash actualizar-desde-cloudshell.sh                       # caddy, backend y visión
#   bash actualizar-desde-cloudshell.sh "caddy backend"       # solo la web y la API
#
# Para qué existe: Cloud Shell no es el servidor (su prompt es `usuario [ ~ ]$`
# y allí no está el repositorio), y por SSH hay que tener la llave registrada.
# `az vm run-command` corre la orden dentro de la VM con la sesión de Azure que
# Cloud Shell ya tiene abierta. Dentro, la orden es la de siempre:
# `deploy/actualizar.sh` como el usuario `tangram`, que es el dueño del repo
# (como root, git se niega a tocar un repositorio de otro usuario).
#
# Lo que hace actualizar.sh: copia de la base, `git merge --ff-only`,
# reconstruye los servicios pedidos y comprueba /api/health. No vuelve atrás
# solo: si algo falla, lo dice y deja la orden para hacerlo.
#
# Tarda unos minutos y no muestra nada hasta el final: run-command devuelve la
# salida entera cuando termina.
set -euo pipefail

RG="TANGRAM-RG"
VM="tangram-ia"
SERVICIOS="${1:-caddy backend vision}"

estado=$(az vm get-instance-view -g "$RG" -n "$VM" \
  --query "instanceView.statuses[?starts_with(code,'PowerState/')].code | [0]" -o tsv)
if [ "$estado" != "PowerState/running" ]; then
  echo "La VM está en «${estado#PowerState/}». Encendiéndola (1-2 minutos)…"
  az vm start -g "$RG" -n "$VM"
  # Docker levanta los contenedores solo al arrancar; se les da un margen
  # antes de reconstruir encima.
  sleep 45
fi

interno=$(mktemp)
trap 'rm -f "$interno"' EXIT
printf '%s\n' \
  "sudo -u tangram -H bash -lc \"cd /home/tangram/tangram-ia && bash deploy/actualizar.sh --solo '$SERVICIOS'\"" \
  > "$interno"

echo "Actualizando: $SERVICIOS. Espera la salida (unos minutos)…"
az vm run-command invoke -g "$RG" -n "$VM" --command-id RunShellScript \
  --scripts @"$interno" --query "value[0].message" -o tsv
