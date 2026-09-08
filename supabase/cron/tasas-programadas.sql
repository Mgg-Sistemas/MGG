-- ============================================================
-- MGG · Tareas programadas de TASAS (pg_cron + pg_net)
--
-- Corren EN LA BASE, no en el navegador: las tasas se refrescan aunque
-- nadie tenga el sistema abierto. El cron de Postgres trabaja en UTC y
-- Venezuela es UTC-4, de ahí el desfase de 4 horas en los horarios.
--
--   08:00 VE (12 UTC) · mgg-tasas-am              → BCV, Binance, COP, cripto, metales
--   12:00 VE (16 UTC) · mgg-tasa-binance-mediodia → solo Binance (es la que más se mueve)
--   16:00 VE (20 UTC) · mgg-tasas-pm              → BCV, Binance, COP, cripto, metales
--
-- Los tres jobs ya están creados en la base. Este archivo queda como
-- registro de qué hay programado y para poder recrear el del mediodía.
--
-- La clave de servicio NO se escribe acá: se reutiliza la cabecera del job
-- que ya existe, así el secreto nunca sale de la base ni entra al repo.
-- Volver a correrlo es inofensivo: cron.schedule reemplaza el job del mismo nombre.
-- ============================================================

DO $$
DECLARE hdr text; cmd text;
BEGIN
  SELECT (regexp_match(command, 'headers:=''(\{.*?\})''::jsonb'))[1]
    INTO hdr FROM cron.job WHERE jobname = 'mgg-tasas-am';
  IF hdr IS NULL OR hdr = '' THEN
    RAISE EXCEPTION 'No se pudo reutilizar la cabecera del job mgg-tasas-am';
  END IF;

  cmd := format(
    'select net.http_post(url:=%L, headers:=%L::jsonb, body:=''{}''::jsonb);',
    'https://itqejsffgueshmlodkjk.supabase.co/functions/v1/tasa-binance-p2p',
    hdr
  );

  PERFORM cron.schedule('mgg-tasa-binance-mediodia', '0 16 * * *', cmd);
END $$;

-- Verificación: Binance tiene que quedar con 3 corridas diarias.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM cron.job WHERE active AND command LIKE '%tasa-binance-p2p%';
  IF n <> 3 THEN RAISE EXCEPTION 'Esperaba 3 corridas diarias de Binance y hay %', n; END IF;
END $$;
