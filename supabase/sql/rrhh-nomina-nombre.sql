-- ════════════════════════════════════════════════════════════════
-- RRHH · La nómina lleva un nombre
--
-- El `codigo` (NOM-2026-0001) lo pone la base y garantiza que no se repita,
-- pero no dice nada: quien busca la quincena de septiembre no se acuerda del
-- número. El `nombre` lo escribe quien la carga y es para reconocerla.
--
-- Queda NULLABLE a propósito: las nóminas que ya existían no tienen uno, y
-- la pantalla cae al código cuando falta. Obligarlo habría que hacerlo con
-- un backfill inventado, y un nombre inventado por el sistema es peor que
-- no tener nombre.
-- ════════════════════════════════════════════════════════════════

alter table public.nomina_periodos add column if not exists nombre text;

comment on column public.nomina_periodos.nombre is
  'Nombre que le pone quien la carga ("Quincena 1 de septiembre"). El codigo (NOM-2026-0001) lo pone la base y no se repite; el nombre es para reconocerla de un vistazo.';

-- Verificación
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'nomina_periodos' and column_name = 'nombre';
