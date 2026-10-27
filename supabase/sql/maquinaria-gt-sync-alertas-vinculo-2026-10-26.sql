-- 26/10/2026 · Maquinaria · sincronización con Golden Touch (commit 8b5d5dbc)
--
-- Dos cambios de GT que necesitan base de datos, adaptados al esquema de MGG:
--
--   A) Respuestas a las alertas de mantenimiento (próximo / vencido): tabla
--      `maquinaria_alertas_respuestas` + frecuencia de servicio por defecto 250 h.
--   B) Vínculo automático Maquinaria → Combustible: todo equipo nuevo queda vinculado a sí
--      mismo y su nombre se crea en el catálogo de equipos de Combustible.
--
-- Diferencias con GT:
--   · En MGG no existen `puede()` ni `sin_acentos()`. La RLS usa `is_operativo()` (usuario
--     registrado y activo) e `is_admin()`, como `maquinaria_lavados`.
--   · El catálogo de equipos de Combustible en GT es `combustible_catalogos (tipo='equipo',
--     valor, activo, orden)`; en MGG es la tabla `combustible_vehiculos (nombre, estado
--     'activo'/'inactivo', descripcion, created_by, created_at, updated_at)`.
--   · Sin `sin_acentos()`, la comparación de nombres es `upper(btrim(...))`.
--
-- Idempotente: se puede volver a correr sin daño.
-- Se aplica con: node supabase/.temp/sqlrun.cjs supabase/sql/maquinaria-gt-sync-alertas-vinculo-2026-10-26.sql

-- ============================================================================
-- A) Respuestas a las alertas de mantenimiento
-- ============================================================================
-- Cuando un equipo tiene el servicio próximo o vencido (por horas o km), el usuario de
-- Maquinaria responde SI hará o NO hará el mantenimiento con un mensaje. La respuesta queda
-- guardada (se ve en la bitácora del equipo) y se puede enviar por WhatsApp con el formato
-- «ALERTA MANTENIMIENTO - RETRASADO / PRÓXIMO». Es un historial: nunca se edita ni se borra
-- desde la app (solo admin), igual que un evento.

create table if not exists public.maquinaria_alertas_respuestas (
  id              uuid primary key default gen_random_uuid(),
  equipo_id       uuid not null references public.maquinaria_equipos(id) on delete cascade,
  -- Nivel del aviso al momento de responder (misma regla que avisoServicio en flota.ts).
  nivel           text not null check (nivel in ('proximo', 'vencido')),
  -- Dimensión del aviso: horas (horómetro) o kilómetros (odómetro).
  unidad          text not null check (unidad in ('h', 'km')),
  -- Foto del contador al responder: lectura vigente, frecuencia del servicio y lo que
  -- restaba (negativo = ya pasado). Se guardan para que el historial no cambie si después
  -- se ajusta la frecuencia o se registra una lectura nueva.
  lectura         numeric,
  frecuencia      numeric,
  restante        numeric,
  decision        text not null check (decision in ('hara', 'no_hara')),
  mensaje         text not null,
  -- Texto exacto que se armó para WhatsApp (para reenviarlo tal cual desde la bitácora).
  texto_whatsapp  text,
  actor           text,
  actor_name      text,
  created_at      timestamptz not null default now()
);

comment on table public.maquinaria_alertas_respuestas is
  'Respuestas del usuario de Maquinaria a las alertas de mantenimiento próximo/vencido: si hará o no el servicio, con mensaje y texto WhatsApp. Historial (sin edición).';

create index if not exists maquinaria_alertas_respuestas_equipo_idx
  on public.maquinaria_alertas_respuestas (equipo_id, created_at desc);

-- RLS (patrón de maquinaria_lavados en MGG):
--   · lee cualquier usuario con sesión
--   · inserta un usuario registrado y activo (is_operativo)
--   · corrige / borra solo un administrador (es un historial)
alter table public.maquinaria_alertas_respuestas enable row level security;
revoke all on public.maquinaria_alertas_respuestas from anon;

drop policy if exists "maq_alertas_resp read auth" on public.maquinaria_alertas_respuestas;
create policy "maq_alertas_resp read auth" on public.maquinaria_alertas_respuestas
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists "maq_alertas_resp insert op" on public.maquinaria_alertas_respuestas;
create policy "maq_alertas_resp insert op" on public.maquinaria_alertas_respuestas
  for insert with check ((select is_operativo()));

drop policy if exists "maq_alertas_resp update admin" on public.maquinaria_alertas_respuestas;
create policy "maq_alertas_resp update admin" on public.maquinaria_alertas_respuestas
  for update using ((select is_admin())) with check ((select is_admin()));

drop policy if exists "maq_alertas_resp delete admin" on public.maquinaria_alertas_respuestas;
create policy "maq_alertas_resp delete admin" on public.maquinaria_alertas_respuestas
  for delete using ((select is_admin()));

-- Realtime: la vista de PC y la del teléfono ven la respuesta apenas se guarda.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'maquinaria_alertas_respuestas'
  ) then
    alter publication supabase_realtime add table public.maquinaria_alertas_respuestas;
  end if;
end $$;

-- Frecuencia de servicio por defecto: 250 h.
-- Regla de la empresa (26/10/2026): todo equipo recibe mantenimiento cada 250 horas de
-- trabajo y la alerta salta al superarlas. Los equipos activos que no tenían frecuencia
-- cargada quedan en 250 para que el aviso funcione desde ya; los que ya tenían un valor
-- propio (p. ej. 500) se respetan.
alter table public.maquinaria_equipos alter column mantenimiento_cada_hrs set default 250;

update public.maquinaria_equipos
set mantenimiento_cada_hrs = 250, updated_at = now()
where mantenimiento_cada_hrs is null and activo;

-- ============================================================================
-- B) Vínculo automático Maquinaria → Combustible
-- ============================================================================
-- El vínculo es por TEXTO: `maquinaria_equipos.combustible_equipo` = `combustible_vehiculos.nombre`.
--
-- 1. BEFORE INSERT: si `combustible_equipo` viene NULL o '', se pone igual a `equipo`.
--    Solo al CREAR: una ficha vieja que se edita sin vínculo no se vincula sola (eso lo
--    decide el botón «Vincular a sí mismo» del formulario).
-- 2. AFTER INSERT OR UPDATE OF combustible_equipo: si el nombre vinculado no está en
--    `combustible_vehiculos` (comparando sin mayúsculas ni espacios de sobra), se crea activo;
--    si está pero inactivo, se reactiva. SECURITY DEFINER porque quien registra una máquina
--    puede no tener permiso de escritura en Combustible.
-- 3. Backfill: los equipos activos sin vínculo pasan a apuntar a su propio nombre y ese
--    nombre se crea en el catálogo si faltaba.

-- Índice único por nombre (sin mayúsculas ni espacios de sobra) en el catálogo de equipos de
-- Combustible, para que dos altas a la vez con el mismo nombre no dupliquen la fila. Solo se
-- crea si hoy no hay nombres repetidos (si los hubiera, se avisa y se deja como está).
do $$
declare
  v_dup int;
begin
  select count(*) into v_dup from (
    select upper(btrim(nombre)) from public.combustible_vehiculos
    group by upper(btrim(nombre)) having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise notice 'combustible_vehiculos: % nombre(s) repetido(s); no se crea el índice único', v_dup;
  elsif not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'combustible_vehiculos_nombre_unico') then
    create unique index combustible_vehiculos_nombre_unico
      on public.combustible_vehiculos (upper(btrim(nombre)));
  end if;
end $$;

-- 1. Vínculo por defecto = el propio nombre
create or replace function public.maquinaria_vincular_combustible_auto()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.combustible_equipo is null or btrim(new.combustible_equipo) = '' then
    new.combustible_equipo := btrim(new.equipo);
  end if;
  return new;
end $$;

drop trigger if exists trg_maquinaria_vincular_combustible_auto on public.maquinaria_equipos;
create trigger trg_maquinaria_vincular_combustible_auto
  before insert on public.maquinaria_equipos
  for each row execute function public.maquinaria_vincular_combustible_auto();

-- 2. El nombre vinculado existe en combustible_vehiculos (activo)
create or replace function public.maquinaria_asegurar_catalogo_combustible()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v text := btrim(coalesce(new.combustible_equipo, ''));
  r record;
begin
  if v = '' then
    return new;
  end if;

  select id, estado into r
  from public.combustible_vehiculos
  where upper(btrim(nombre)) = upper(v)
  order by created_at
  limit 1;

  if found then
    -- Alguien lo está vinculando: tiene que volver a salir en los desplegables.
    if r.estado <> 'activo' then
      update public.combustible_vehiculos
      set estado = 'activo', updated_at = now()
      where id = r.id;
    end if;
    return new;
  end if;

  begin
    insert into public.combustible_vehiculos (nombre, estado, created_by)
    values (v, 'activo', 'maquinaria · vínculo automático');
  exception when unique_violation then
    -- Dos altas a la vez con el mismo nombre: el segundo se queda con el que ya entró.
    null;
  end;
  return new;
end $$;

revoke execute on function public.maquinaria_asegurar_catalogo_combustible() from public, anon;

drop trigger if exists trg_maquinaria_asegurar_catalogo_combustible on public.maquinaria_equipos;
create trigger trg_maquinaria_asegurar_catalogo_combustible
  after insert or update of combustible_equipo on public.maquinaria_equipos
  for each row execute function public.maquinaria_asegurar_catalogo_combustible();

-- 3. Backfill: equipos activos sin vínculo → vinculados a sí mismos (el trigger 2 crea o
--    reactiva la fila del catálogo al actualizar; el insert de abajo lo garantiza aunque el
--    trigger no hubiera corrido).
update public.maquinaria_equipos
set combustible_equipo = btrim(equipo), updated_at = now()
where activo
  and (combustible_equipo is null or btrim(combustible_equipo) = '');

insert into public.combustible_vehiculos (nombre, estado, created_by)
select distinct on (upper(btrim(m.combustible_equipo)))
       btrim(m.combustible_equipo), 'activo', 'maquinaria · vínculo automático'
from public.maquinaria_equipos m
where m.activo
  and btrim(coalesce(m.combustible_equipo, '')) <> ''
  and not exists (
    select 1 from public.combustible_vehiculos c
    where upper(btrim(c.nombre)) = upper(btrim(m.combustible_equipo))
  )
order by upper(btrim(m.combustible_equipo)), m.created_at;

-- ============================================================================
-- Verificación (una sola consulta; el runner devuelve el último resultado)
-- ============================================================================
select jsonb_build_object(
  'equipos', (
    select jsonb_build_object(
      'total', count(*),
      'activos', count(*) filter (where activo),
      'activos_sin_vinculo', count(*) filter (where activo and (combustible_equipo is null or btrim(combustible_equipo) = '')),
      'activos_sin_frecuencia', count(*) filter (where activo and mantenimiento_cada_hrs is null),
      'vinculados_con_fila_en_combustible', count(*) filter (where activo and exists (
        select 1 from public.combustible_vehiculos c
        where upper(btrim(c.nombre)) = upper(btrim(maquinaria_equipos.combustible_equipo))
      )),
      'vinculo_roto', count(*) filter (where activo and btrim(coalesce(combustible_equipo, '')) <> '' and not exists (
        select 1 from public.combustible_vehiculos c
        where upper(btrim(c.nombre)) = upper(btrim(maquinaria_equipos.combustible_equipo))
      ))
    ) from public.maquinaria_equipos
  ),
  'default_frecuencia', (
    select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'maquinaria_equipos' and column_name = 'mantenimiento_cada_hrs'
  ),
  'vehiculos_creados_por_vinculo', (
    select jsonb_agg(nombre order by nombre) from public.combustible_vehiculos
    where created_by = 'maquinaria · vínculo automático'
  ),
  'vehiculos_indice_unico', (
    select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'combustible_vehiculos_nombre_unico'
  ),
  'triggers_equipos', (
    select jsonb_agg(tgname order by tgname) from pg_trigger
    where tgrelid = 'public.maquinaria_equipos'::regclass and not tgisinternal
  ),
  'alertas_rls_habilitada', (
    select relrowsecurity from pg_class where oid = 'public.maquinaria_alertas_respuestas'::regclass
  ),
  'alertas_politicas', (
    select jsonb_agg(jsonb_build_object('nombre', policyname, 'cmd', cmd, 'using', qual, 'check', with_check) order by policyname)
    from pg_policies where schemaname = 'public' and tablename = 'maquinaria_alertas_respuestas'
  ),
  'alertas_realtime', (
    select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'maquinaria_alertas_respuestas'
  )
) as verificacion;
