#!/bin/bash
# Usuario de MySQL para el backend, con los mismos permisos mínimos que
# backend/sql/crear-usuario.sql: solo sobre `tangram_ia`, sin DROP ni GRANT.
#
# Lo ejecuta la imagen oficial de MySQL una sola vez, al crear el volumen de
# datos. Si se cambia DB_PASSWORD después, hay que cambiarla también dentro de
# MySQL (ver DESPLIEGUE.md), porque este script no vuelve a correr.
#
# El host es '%' y no 'localhost' porque el backend llega desde otro contenedor.
# No abre nada hacia fuera: MySQL no publica ningún puerto en docker-compose.yml,
# así que solo lo alcanzan los contenedores de la red interna.
set -euo pipefail

if [ -z "${TANGRAM_DB_PASSWORD:-}" ]; then
  echo "[!!] Falta TANGRAM_DB_PASSWORD: no se crea el usuario de la aplicación." >&2
  exit 1
fi

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`tangram_ia\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'tangram_app'@'%' IDENTIFIED BY '${TANGRAM_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`tangram_ia\`.* TO 'tangram_app'@'%';
GRANT CREATE, ALTER, INDEX, REFERENCES ON \`tangram_ia\`.* TO 'tangram_app'@'%';
FLUSH PRIVILEGES;
SQL

echo "[OK] Usuario tangram_app creado con permisos solo sobre tangram_ia."
