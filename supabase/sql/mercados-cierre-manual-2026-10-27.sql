-- ============================================================
-- Cocina · Mercado: cierre MANUAL, sin ciclo de 21 días (27-10-2026)
--
-- Pedido de la administradora: el mercado arranca en una fecha de inicio y
-- termina cuando alguien lo cierra; la fecha de cierre es su fecha fin. Mientras
-- está abierto `fecha_fin` queda en NULL (antes: inicio + 20 días, y el libro se
-- detenía ahí aunque el mercado siguiera abierto: Los Pinos #3 y Resguardo #3 se
-- quedaron "congelados" el 19-10 con comidas cargadas hasta el 27-10).
-- ============================================================
alter table public.mercados_cocina alter column fecha_fin drop not null;
comment on column public.mercados_cocina.fecha_fin is 'Fecha de CIERRE del mercado (null mientras está abierto). Desde 27-10-2026 el cierre es manual, sin plazo de 21 días.';

-- Los mercados abiertos se dejan en null DESPUÉS de desplegar el front que lo
-- entiende (el front viejo arma `new Date(`${fecha_fin}T23:59:59`)` y con null rompe):
--   update public.mercados_cocina set fecha_fin = null where estado = 'abierto';
select column_name, is_nullable from information_schema.columns where table_name='mercados_cocina' and column_name='fecha_fin';
