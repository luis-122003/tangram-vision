-- ---------------------------------------------------------------------------
-- Deja en la aplicación solo las 7 figuras sobre las que el sistema está
-- medido, y apaga las otras 13.
--
-- POR QUÉ
-- Las 112 fotos con las que se midió el sistema contienen 7 figuras:
-- triángulo, cisne, conejo sentado, canguro, cohete, vela y molino. Las otras
-- 13 entradas del catálogo nunca se armaron ni se fotografiaron, así que la
-- aplicación las ofrecía sin ningún respaldo experimental: un estudiante podía
-- elegir "Casa" y recibir una corrección que nadie ha validado.
--
-- APAGAR, NO BORRAR
-- Se ponen en `enabled = 0`, que es justo para lo que existe esa columna:
-- `GET /figures` devuelve solo las activas, así que desaparecen del catálogo
-- del navegador y de la app móvil. Pero siguen en la tabla, y eso importa por
-- dos razones:
--   · `tangram_validator.py --calibrar` mide la separabilidad sobre las 20 y
--     de ahí salen MATCH_IOU=0,80 y CLOSE_IOU=0,75. El tope de 0,741 es
--     `house` contra `arrow`: si se borran, esa calibración deja de ser
--     reproducible.
--   · volver atrás es un UPDATE, no una restauración.
--
-- CÓMO USARLO
--   mysql -u tangram_app -p -h 127.0.0.1 -P 3307 tangram_ia < backend/sql/catalogo-solo-validadas.sql
--
-- Hay que ejecutarlo: editar `figures_seed.json` no basta. El sembrado de
-- `schema.ts` inserta las figuras que faltan pero NO toca las que ya están
-- (`ON DUPLICATE KEY UPDATE id = id`), a propósito, para no pisar cambios
-- hechos desde la base. En una instalación nueva el JSON ya siembra estas 7
-- activas y no hace falta este archivo.
-- ---------------------------------------------------------------------------

UPDATE figures
   SET enabled = 0
 WHERE slug IN ('house', 'arrow', 'fish', 'cat', 'question', 'people',
                'bird', 'boat', 'tree', 'rabbit', 'schooner', 'ferryboat',
                'norfolk_wherry');

-- Comprobación: tiene que devolver 7 filas, y ninguna de la lista de arriba.
SELECT slug, name, difficulty
  FROM figures
 WHERE enabled = 1
 ORDER BY FIELD(difficulty, 'Fácil', 'Medio', 'Difícil'), name;


-- ---------------------------------------------------------------------------
-- VOLVER ATRÁS (deja las 14 activas que había antes del 8 de septiembre)
--
-- UPDATE figures
--    SET enabled = 1
--  WHERE slug IN ('house', 'arrow', 'fish', 'cat', 'question', 'people', 'bird');
--
-- y revertir `vision-service/data/figures_seed.json` a
-- `figures_seed.json.bak-20260908`.
-- ---------------------------------------------------------------------------
