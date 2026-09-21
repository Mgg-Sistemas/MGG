/* ============================================================
   MGG · RRHH · RIF del personal y cédula sin repetir — 21/09/2026

   1. `rif` en la ficha del personal: se carga al crear y se puede corregir al
      editar, igual que la cédula.

   2. La cédula NO se puede repetir. La guarda va en la BASE, no solo en la
      pantalla: dos personas cargando a la vez desde dos computadoras pueden
      pasar la validación del front al mismo tiempo, y la base es el único
      lugar donde eso no se escapa.

      Se compara NORMALIZADA (solo los dígitos), porque «V-12.345.678»,
      «V12345678» y «12345678» son la misma persona escrita de tres maneras.
      Las fichas sin cédula no entran al índice: pueden ser varias.
   ============================================================ */
begin;

alter table public.personal
  add column if not exists rif text;

comment on column public.personal.rif is 'RIF del trabajador (V/E/J-XXXXXXXX-X)';
comment on column public.personal.cedula is 'Cédula de identidad · única entre el personal (se compara solo por los dígitos)';

/* Guarda: si ya hubiera cédulas repetidas, el índice no se crea y el script
   aborta avisando, en vez de fallar con un error críptico de Postgres. */
do $$
declare dup text;
begin
  select string_agg(x.ced || ' (' || x.veces || ' fichas)', ', ')
    into dup
    from (
      select regexp_replace(coalesce(cedula, ''), '[^0-9]', '', 'g') ced, count(*) veces
      from public.personal
      where coalesce(regexp_replace(coalesce(cedula, ''), '[^0-9]', '', 'g'), '') <> ''
      group by 1 having count(*) > 1
    ) x;
  if dup is not null then
    raise exception 'Hay cédulas repetidas en `personal`: %. Unificá esas fichas antes de aplicar el índice.', dup;
  end if;
end $$;

create unique index if not exists personal_cedula_unica_idx
  on public.personal ((regexp_replace(cedula, '[^0-9]', '', 'g')))
  where cedula is not null and regexp_replace(cedula, '[^0-9]', '', 'g') <> '';

commit;

select count(*) fichas,
       count(*) filter (where cedula is not null and cedula <> '') con_cedula,
       count(*) filter (where rif is not null and rif <> '') con_rif
from public.personal;
