-- ---------------------------------------------------------------------------
-- Usuario de MySQL para la aplicación, con permisos mínimos.
--
-- Hasta ahora el backend se conectaba como `root`, que puede leer y borrar
-- cualquier base del servidor. Si alguna vez hubiera una inyección SQL o se
-- filtrara el `.env`, el alcance sería la máquina entera y no esta aplicación.
--
-- `tangram_app` solo puede hacer lo que la aplicación necesita, y solo sobre la
-- base `tangram_ia`:
--   · SELECT/INSERT/UPDATE/DELETE en sus tablas
--   · CREATE/ALTER/INDEX, porque el backend crea y migra el esquema al arrancar
--   · nada de DROP, GRANT, FILE ni acceso a otras bases
--
-- Además solo acepta conexiones desde la propia máquina (`localhost`): el
-- backend y MySQL corren en el mismo equipo, así que no hay motivo para que la
-- base escuche a nadie más.
--
-- CÓMO USARLO
--   1. Cambia 'PON_AQUI_UNA_CLAVE_LARGA' por una contraseña generada al azar:
--        node -e "console.log(require('crypto').randomBytes(18).toString('hex'))"
--   2. Ejecuta como root:
--        mysql -u root -p --port=3307 < backend/sql/crear-usuario.sql
--   3. Pon esa misma contraseña en backend/.env (DB_USER=tangram_app).
--   4. Reinicia el backend y comprueba /health: db_connected debe ser true.
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS `tangram_ia`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'tangram_app'@'localhost'
  IDENTIFIED BY 'PON_AQUI_UNA_CLAVE_LARGA';

ALTER USER 'tangram_app'@'localhost'
  IDENTIFIED BY 'PON_AQUI_UNA_CLAVE_LARGA';

-- Datos: lo que la aplicación usa a diario.
GRANT SELECT, INSERT, UPDATE, DELETE ON `tangram_ia`.* TO 'tangram_app'@'localhost';

-- Esquema: el backend crea las tablas y migra la de usuarios en el arranque.
-- No se concede DROP: ninguna operación normal de la aplicación borra tablas.
GRANT CREATE, ALTER, INDEX, REFERENCES ON `tangram_ia`.* TO 'tangram_app'@'localhost';

FLUSH PRIVILEGES;

-- Comprobación: debe listar solo permisos sobre `tangram_ia`.
SHOW GRANTS FOR 'tangram_app'@'localhost';

-- ---------------------------------------------------------------------------
-- RECOMENDADO ADEMÁS
--
-- 1) Que MySQL no escuche en la red. En my.ini / my.cnf:
--        [mysqld]
--        bind-address = 127.0.0.1
--    El teléfono habla con el backend (puerto 8000), nunca con la base.
--
-- 2) Si la contraseña de root apareció alguna vez en un documento o una
--    captura, cámbiala:
--        ALTER USER 'root'@'localhost' IDENTIFIED BY 'otra-clave-larga';
-- ---------------------------------------------------------------------------
