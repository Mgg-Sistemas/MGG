-- ============================================================
-- MGG · Maquinaria · 16-10-2026 (órdenes de la administradora) · APLICADO
--  1. Encuadre de la foto del equipo: «cubrir» (recorta para llenar la portada) o
--     «completa» (se ve entera). Se guarda por foto.
--  2. Más documentos por equipo: de 4 a 12 espacios (el check del slot).
--  3. Grupo · Servicio de Mantenimiento con alta en línea: pasa a catálogo
--     (maquinaria_catalogos tipo 'grupo_mantenimiento'), sembrado con los 3 de siempre.
-- Idempotente.
-- ============================================================

-- 1. Encuadre por foto
alter table public.maquinaria_fotos add column if not exists encuadre text not null default 'cubrir';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maquinaria_fotos_encuadre_chk') then
    alter table public.maquinaria_fotos add constraint maquinaria_fotos_encuadre_chk check (encuadre in ('cubrir', 'completa'));
  end if;
end $$;
comment on column public.maquinaria_fotos.encuadre is 'cubrir = recorta para llenar la portada; completa = se ve entera (16-10-2026).';

-- 2. Hasta 12 documentos por equipo
alter table public.maquinaria_documentos drop constraint if exists maquinaria_documentos_slot_check;
alter table public.maquinaria_documentos add constraint maquinaria_documentos_slot_check check (slot >= 1 and slot <= 12);

-- 3. Grupos de mantenimiento en catálogo
alter table public.maquinaria_catalogos drop constraint if exists maquinaria_catalogos_tipo_check;
alter table public.maquinaria_catalogos add constraint maquinaria_catalogos_tipo_check
  check (tipo in ('tipo_maquinaria', 'propietario', 'status', 'documento', 'grupo_mantenimiento'));
insert into public.maquinaria_catalogos (tipo, valor, activo, orden)
select 'grupo_mantenimiento', g.valor, true, g.orden
  from (values ('FLOTA PESADA', 0), ('VEHÍCULOS DE CARGA', 1), ('PLANTAS ELÉCTRICAS', 2)) as g(valor, orden)
 where not exists (select 1 from public.maquinaria_catalogos c where c.tipo = 'grupo_mantenimiento' and upper(c.valor) = g.valor);
-- Y cualquier grupo que ya tenga un equipo y no esté en el catálogo.
insert into public.maquinaria_catalogos (tipo, valor, activo, orden)
select distinct 'grupo_mantenimiento', e.grupo_mantenimiento, true, 9
  from public.maquinaria_equipos e
 where coalesce(btrim(e.grupo_mantenimiento), '') <> ''
   and not exists (select 1 from public.maquinaria_catalogos c where c.tipo = 'grupo_mantenimiento' and upper(c.valor) = upper(e.grupo_mantenimiento));
