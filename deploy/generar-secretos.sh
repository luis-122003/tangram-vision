#!/usr/bin/env bash
# Prepara la configuración del servidor a partir de las plantillas y genera los
# secretos que falten.
#
#   bash deploy/generar-secretos.sh
#
# Es seguro repetirlo: nunca sobrescribe un archivo ni un valor que ya exista.
# Eso importa sobre todo con ENCRYPTION_KEY y BLIND_INDEX_KEY: cambiarlas con la
# base ya llena deja ilegibles los nombres y correos de los estudiantes.
set -euo pipefail
cd "$(dirname "$0")/.."

copiar() {   # copiar <plantilla> <destino>
  if [ -f "$2" ]; then
    echo "[=] $2 ya existe; no se toca."
  else
    cp "$1" "$2"
    chmod 600 "$2"
    echo "[+] $2 creado desde $1"
  fi
}

# rellenar <archivo> <VARIABLE> <bytes>: solo si está vacía.
rellenar() {
  if grep -qE "^$2=$" "$1"; then
    sed -i "s|^$2=$|$2=$(openssl rand -hex "$3")|" "$1"
    echo "    $2 generado"
  fi
}

copiar deploy/compose.env.example .env
copiar deploy/backend.env.example deploy/backend.env
copiar deploy/vision.env.example  deploy/vision.env

rellenar .env MYSQL_ROOT_PASSWORD 24
rellenar .env DB_PASSWORD 24
rellenar deploy/backend.env JWT_SECRET 48
rellenar deploy/backend.env REFRESH_SECRET 48
rellenar deploy/backend.env ENCRYPTION_KEY 32
rellenar deploy/backend.env BLIND_INDEX_KEY 32

cat <<'FIN'

Falta lo que solo puedes poner tú:
  .env                 DOMINIO y ACME_EMAIL
  deploy/backend.env   SMTP_USER, SMTP_PASS, SMTP_FROM (Gmail)
                       SUPABASE_URL, SUPABASE_SERVICE_KEY
Y los pesos del detector en vision-service/models/tangram_formas_v2.pt

Guarda una copia de ENCRYPTION_KEY y BLIND_INDEX_KEY fuera del servidor
(un gestor de contraseñas): sin ellas, los datos cifrados no se recuperan.
FIN
