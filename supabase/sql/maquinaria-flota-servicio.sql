-- ============================================================
-- MGG · Control de Maquinaria y Vehículos · Flota y Servicio (13-10-2026)
-- Traído de Golden Touch y adaptado a MGG. NO borra nada: solo agrega
-- columnas, tablas, una vista, funciones, triggers y políticas.
--
-- Adaptaciones respecto a GT:
--  · Permisos: MGG no tiene puede('maquinaria'); el acceso por módulo vive en
--    el front. En la base manda is_operativo() (usuario registrado) e is_admin().
--  · Combustible: los movimientos de tanque guardan fecha (timestamptz),
--    horometro_final y kilometraje_final; el tipo de surtido es 'consumo'.
--  · Los documentos del equipo siguen en maquinaria_documentos con slot/filename/
--    mime (bucket equipos-docs): no se tocan.
--  · La solicitud de pedido de los repuestos la arma la app (crearOrden de MGG),
--    no un RPC: no hay maquinaria_pedir_compra_orden.
--  · Códigos OS-AAAA-NNNN con la tabla correlativos (nueva).
-- Idempotente: se puede correr más de una vez.
-- ============================================================

-- ───────── 1. Columnas nuevas del equipo (las viejas se conservan) ─────────
alter table public.maquinaria_equipos
  add column if not exists mantenimiento_cada_km numeric,
  add column if not exists mantenimiento_base_hrs numeric,
  add column if not exists mantenimiento_base_km numeric,
  add column if not exists estado_operativo text,
  add column if not exists estado_nota text,
  add column if not exists estado_desde timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maquinaria_equipos_estado_operativo_chk') then
    alter table public.maquinaria_equipos add constraint maquinaria_equipos_estado_operativo_chk
      check (estado_operativo is null or estado_operativo in ('operativa','averiada','parada','taller','repuestos','espera','retirada'));
  end if;
end $$;

-- El km objetivo de aviso de antes (alerta_km, absoluto) pasa a ser el intervalo por km
-- cuando el equipo no tenía uno: con base nula, el próximo servicio toca en el siguiente
-- múltiplo, que para el primer ciclo es el mismo objetivo. Nada se borra.
update public.maquinaria_equipos
   set mantenimiento_cada_km = alerta_km
 where mantenimiento_cada_km is null and alerta_km is not null and alerta_km > 0;

-- ───────── 2. Correlativos (códigos OS-AAAA-NNNN) ─────────
create table if not exists public.correlativos (
  clave text primary key,
  valor integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.correlativos enable row level security;
revoke all on public.correlativos from anon;
drop policy if exists "correlativos read auth" on public.correlativos;
create policy "correlativos read auth" on public.correlativos for select using ((select auth.role()) = 'authenticated');
drop policy if exists "correlativos write op" on public.correlativos;
create policy "correlativos write op" on public.correlativos for all using ((select public.is_operativo())) with check ((select public.is_operativo()));

create or replace function public.next_correlativo(p_clave text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v int;
begin
  insert into public.correlativos (clave, valor) values (p_clave, 1)
  on conflict (clave) do update set valor = public.correlativos.valor + 1, updated_at = now()
  returning valor into v;
  return v;
end $$;

-- ───────── 3. Tablas nuevas ─────────
create table if not exists public.maquinaria_ordenes_servicio (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  equipo_id uuid not null references public.maquinaria_equipos(id) on delete cascade,
  tipo text not null,
  urgencia text not null default 'normal' check (urgencia in ('normal','alta','urgente')),
  intervenciones text[] not null default '{}',
  trabajos text[] not null default '{}',
  origen text not null default 'interno' check (origen in ('interno','externo')),
  responsable text,
  descripcion text,
  estado text not null default 'abierta' check (estado in ('abierta','repuestos','en_proceso','realizada','anulada')),
  repuestos jsonb not null default '[]'::jsonb,
  horometro numeric,
  kilometraje numeric,
  solicitud_salida_id uuid references public.solicitudes_salida(id) on delete set null,
  orden_compra_id uuid references public.ordenes(id) on delete set null,
  estado_equipo_previo text,
  nota_cierre text,
  compras_notificada_at timestamptz,
  created_by text,
  actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  cerrada_at timestamptz
);
create index if not exists idx_maq_os_equipo on public.maquinaria_ordenes_servicio (equipo_id, created_at desc);
create index if not exists idx_maq_os_salida on public.maquinaria_ordenes_servicio (solicitud_salida_id);
create index if not exists idx_maq_os_compra on public.maquinaria_ordenes_servicio (orden_compra_id);

create table if not exists public.maquinaria_estado_eventos (
  id uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.maquinaria_equipos(id) on delete cascade,
  estado_anterior text,
  estado text not null check (estado in ('operativa','averiada','parada','taller','repuestos','espera','retirada')),
  motivo text,
  material text,
  nota text,
  orden_servicio_id uuid references public.maquinaria_ordenes_servicio(id) on delete set null,
  actor text,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_maq_estado_eventos_equipo on public.maquinaria_estado_eventos (equipo_id, created_at desc);
create index if not exists idx_maq_estado_eventos_os on public.maquinaria_estado_eventos (orden_servicio_id);

create table if not exists public.maquinaria_os_fotos (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.maquinaria_ordenes_servicio(id) on delete cascade,
  path text not null unique,
  nombre text not null default 'foto.jpg' check (length(btrim(nombre)) > 0),
  orden smallint not null check (orden >= 1 and orden <= 4),
  content_type text,
  tamano integer,
  subido_por text,
  subido_por_nombre text,
  created_at timestamptz not null default now(),
  constraint maquinaria_os_fotos_orden_unico unique (orden_id, orden),
  constraint maquinaria_os_fotos_path_carpeta check (split_part(path, '/', 1) = orden_id::text)
);
create index if not exists maquinaria_os_fotos_orden_idx on public.maquinaria_os_fotos (orden_id);

create table if not exists public.maquinaria_lavados (
  id uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.maquinaria_equipos(id) on delete cascade,
  fecha timestamptz not null default now(),
  tipo text not null check (length(btrim(tipo)) >= 3),
  responsable text,
  horometro numeric,
  kilometraje numeric,
  nota text,
  actor text,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_maq_lavados_equipo on public.maquinaria_lavados (equipo_id, fecha desc);

create table if not exists public.maquinaria_lecturas (
  id uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.maquinaria_equipos(id) on delete cascade,
  fecha timestamptz not null default now(),
  horometro numeric check (horometro is null or horometro >= 0),
  kilometraje numeric check (kilometraje is null or kilometraje >= 0),
  nota text,
  es_correccion boolean not null default false,
  motivo_correccion text,
  actor text,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint maquinaria_lecturas_algo check (horometro is not null or kilometraje is not null),
  constraint maquinaria_lecturas_correccion_motivo check (not es_correccion or length(btrim(coalesce(motivo_correccion,''))) >= 3)
);
create index if not exists idx_maq_lecturas_equipo on public.maquinaria_lecturas (equipo_id, fecha desc);

-- ───────── 4. RLS (MGG: por usuario registrado; el acceso por módulo vive en el front) ─────────
alter table public.maquinaria_ordenes_servicio enable row level security;
alter table public.maquinaria_estado_eventos enable row level security;
alter table public.maquinaria_os_fotos enable row level security;
alter table public.maquinaria_lavados enable row level security;
alter table public.maquinaria_lecturas enable row level security;
revoke all on public.maquinaria_ordenes_servicio from anon;
revoke all on public.maquinaria_estado_eventos from anon;
revoke all on public.maquinaria_os_fotos from anon;
revoke all on public.maquinaria_lavados from anon;
revoke all on public.maquinaria_lecturas from anon;

drop policy if exists "maq_os read auth" on public.maquinaria_ordenes_servicio;
create policy "maq_os read auth" on public.maquinaria_ordenes_servicio for select using ((select auth.role()) = 'authenticated');
drop policy if exists "maq_os write op" on public.maquinaria_ordenes_servicio;
create policy "maq_os write op" on public.maquinaria_ordenes_servicio for all using ((select public.is_operativo())) with check ((select public.is_operativo()));

drop policy if exists "maq_estado_ev read auth" on public.maquinaria_estado_eventos;
create policy "maq_estado_ev read auth" on public.maquinaria_estado_eventos for select using ((select auth.role()) = 'authenticated');
drop policy if exists "maq_estado_ev write op" on public.maquinaria_estado_eventos;
create policy "maq_estado_ev write op" on public.maquinaria_estado_eventos for all using ((select public.is_operativo())) with check ((select public.is_operativo()));

drop policy if exists "maq_os_fotos read auth" on public.maquinaria_os_fotos;
create policy "maq_os_fotos read auth" on public.maquinaria_os_fotos for select using ((select auth.role()) = 'authenticated');
drop policy if exists "maq_os_fotos write op" on public.maquinaria_os_fotos;
create policy "maq_os_fotos write op" on public.maquinaria_os_fotos for all using ((select public.is_operativo())) with check ((select public.is_operativo()));

drop policy if exists "maq_lavados read auth" on public.maquinaria_lavados;
create policy "maq_lavados read auth" on public.maquinaria_lavados for select using ((select auth.role()) = 'authenticated');
drop policy if exists "maq_lavados write op" on public.maquinaria_lavados;
create policy "maq_lavados write op" on public.maquinaria_lavados for all using ((select public.is_operativo())) with check ((select public.is_operativo()));

-- Las lecturas se registran y editan por RPC (validan contra la vigente); a mano solo el admin. Borrar: cualquier operativo (el trigger cuida las correcciones).
drop policy if exists "maq_lecturas read auth" on public.maquinaria_lecturas;
create policy "maq_lecturas read auth" on public.maquinaria_lecturas for select using ((select auth.role()) = 'authenticated');
drop policy if exists "maq_lecturas write admin" on public.maquinaria_lecturas;
create policy "maq_lecturas write admin" on public.maquinaria_lecturas for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "maq_lecturas borrar op" on public.maquinaria_lecturas;
create policy "maq_lecturas borrar op" on public.maquinaria_lecturas for delete using ((select public.is_operativo()));

-- ───────── 5. Bucket de fotos de las órdenes (privado, 2 MB, solo imágenes) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maquinaria-os-fotos', 'maquinaria-os-fotos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "maquinaria-os-fotos read op" on storage.objects;
create policy "maquinaria-os-fotos read op" on storage.objects for select using (bucket_id = 'maquinaria-os-fotos' and (select public.is_operativo()));
drop policy if exists "maquinaria-os-fotos write op" on storage.objects;
create policy "maquinaria-os-fotos write op" on storage.objects for insert with check (bucket_id = 'maquinaria-os-fotos' and (select public.is_operativo()));
drop policy if exists "maquinaria-os-fotos update op" on storage.objects;
create policy "maquinaria-os-fotos update op" on storage.objects for update using (bucket_id = 'maquinaria-os-fotos' and (select public.is_operativo())) with check (bucket_id = 'maquinaria-os-fotos' and (select public.is_operativo()));
drop policy if exists "maquinaria-os-fotos delete op" on storage.objects;
create policy "maquinaria-os-fotos delete op" on storage.objects for delete using (bucket_id = 'maquinaria-os-fotos' and (select public.is_operativo()));

-- ───────── 6. Realtime ─────────
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='maquinaria_ordenes_servicio') then
    alter publication supabase_realtime add table public.maquinaria_ordenes_servicio; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='maquinaria_estado_eventos') then
    alter publication supabase_realtime add table public.maquinaria_estado_eventos; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='maquinaria_os_fotos') then
    alter publication supabase_realtime add table public.maquinaria_os_fotos; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='maquinaria_lavados') then
    alter publication supabase_realtime add table public.maquinaria_lavados; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='maquinaria_lecturas') then
    alter publication supabase_realtime add table public.maquinaria_lecturas; end if;
end $$;

-- ───────── 7. Vista: el contador unificado (Combustible + Maquinaria + bitácora) ─────────
create or replace view public.maquinaria_lecturas_unificadas as
  select l.equipo_id,
         nullif(btrim(e.combustible_equipo), '') as equipo_comb,
         'maquinaria'::text as origen,
         l.id::text as referencia,
         l.fecha,
         l.horometro,
         l.kilometraje,
         l.es_correccion,
         coalesce(l.actor_name, l.actor) as actor
    from public.maquinaria_lecturas l
    join public.maquinaria_equipos e on e.id = l.equipo_id
  union all
  select e.id as equipo_id,
         btrim(m.equipo) as equipo_comb,
         'combustible'::text as origen,
         m.id::text as referencia,
         coalesce(m.fecha, m.created_at) as fecha,
         m.horometro_final as horometro,
         m.kilometraje_final as kilometraje,
         false as es_correccion,
         coalesce(m.actor_name, m.actor) as actor
    from public.combustible_tanque_movimientos m
    left join public.maquinaria_equipos e on nullif(btrim(e.combustible_equipo), '') = btrim(m.equipo)
   where coalesce(btrim(m.equipo), '') <> '' and (m.horometro_final is not null or m.kilometraje_final is not null)
  union all
  select b.equipo_id,
         nullif(btrim(e.combustible_equipo), '') as equipo_comb,
         'bitacora'::text as origen,
         b.id::text as referencia,
         ((b.fecha::timestamp + (b.created_at at time zone 'America/Caracas')::time) at time zone 'America/Caracas') as fecha,
         b.horometro,
         b.kilometraje,
         false as es_correccion,
         coalesce(b.actor_name, b.created_by) as actor
    from public.maquinaria_mantenimientos b
    join public.maquinaria_equipos e on e.id = b.equipo_id
   where b.horometro is not null or b.kilometraje is not null;
revoke all on public.maquinaria_lecturas_unificadas from anon;
grant select on public.maquinaria_lecturas_unificadas to authenticated;

-- ───────── 8. Funciones ─────────
create or replace function public.maquinaria_estado_efectivo(p_estado text, p_status text, p_activo boolean)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when coalesce(p_activo, true) = false then 'retirada'
    when p_estado is not null then p_estado
    when upper(coalesce(p_status,'')) = 'MANTENIMIENTO' then 'taller'
    when upper(coalesce(p_status,'')) = 'FUERA DE SERVICIO' then 'averiada'
    when upper(coalesce(p_status,'')) = 'INACTIVO' then 'retirada'
    else 'operativa' end;
$$;

create or replace function public.maquinaria_status_de_estado(p_estado text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_estado
    when 'averiada' then 'FUERA DE SERVICIO'
    when 'parada' then 'FUERA DE SERVICIO'
    when 'taller' then 'MANTENIMIENTO'
    when 'repuestos' then 'MANTENIMIENTO'
    when 'retirada' then 'INACTIVO'
    else 'ACTIVO' end;
$$;

-- Si alguien cambia el status clásico a mano (ficha) sin tocar el estado operativo, manda el status.
create or replace function public.maquinaria_status_manda()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.estado_operativo is not null
     and new.status is distinct from old.status
     and new.estado_operativo is not distinct from old.estado_operativo
     and upper(coalesce(new.status,'')) is distinct from public.maquinaria_status_de_estado(new.estado_operativo) then
    new.estado_operativo := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_maquinaria_status_manda on public.maquinaria_equipos;
create trigger trg_maquinaria_status_manda before update on public.maquinaria_equipos for each row execute function public.maquinaria_status_manda();

create or replace function public.maquinaria_set_estado_interno(p_equipo_id uuid, p_estado text, p_motivo text, p_material text, p_nota text, p_orden uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_prev text; v_email text; v_nombre text;
begin
  if p_estado not in ('operativa','averiada','parada','taller','repuestos','espera','retirada') then
    raise exception 'Estado no válido: %', p_estado using errcode = '22023';
  end if;
  select public.maquinaria_estado_efectivo(estado_operativo, status, activo) into v_prev
    from public.maquinaria_equipos where id = p_equipo_id for update;
  if not found then raise exception 'El equipo no existe.' using errcode = 'P0002'; end if;
  select email, nombre into v_email, v_nombre from public.usuarios where id = auth.uid();
  update public.maquinaria_equipos
     set estado_operativo = p_estado,
         estado_nota = nullif(btrim(coalesce(p_motivo,'')), ''),
         estado_desde = now(),
         status = public.maquinaria_status_de_estado(p_estado),
         activo = (p_estado <> 'retirada'),
         updated_at = now()
   where id = p_equipo_id;
  insert into public.maquinaria_estado_eventos(equipo_id, estado_anterior, estado, motivo, material, nota, orden_servicio_id, actor, actor_name)
  values (p_equipo_id, v_prev, p_estado, nullif(btrim(coalesce(p_motivo,'')),''), nullif(btrim(coalesce(p_material,'')),''),
          nullif(btrim(coalesce(p_nota,'')),''), p_orden, coalesce(v_email, 'sistema'), v_nombre);
  return v_prev;
end $$;

create or replace function public.maquinaria_cambiar_estado(p_equipo_id uuid, p_estado text, p_motivo text default null, p_material text default null, p_nota text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_operativo() then
    raise exception 'No tienes permiso para cambiar el estado de los equipos.' using errcode = '42501';
  end if;
  if p_estado in ('averiada','parada','espera','retirada') and length(btrim(coalesce(p_motivo,''))) < 3 then
    raise exception 'Escribe el motivo (al menos 3 letras).' using errcode = '23514';
  end if;
  perform public.maquinaria_set_estado_interno(p_equipo_id, p_estado, p_motivo, p_material, p_nota, null);
  return p_estado;
end $$;

create or replace function public.maquinaria_editar_evento_estado(p_id uuid, p_motivo text, p_material text, p_nota text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare ev record; v_ult uuid;
begin
  if not public.is_operativo() then
    raise exception 'No tienes permiso para editar cambios de estado.' using errcode = '42501';
  end if;
  select * into ev from public.maquinaria_estado_eventos where id = p_id for update;
  if not found then raise exception 'El cambio de estado no existe (puede que lo hayan borrado).' using errcode = 'P0002'; end if;
  if ev.estado in ('averiada','parada','espera','retirada') and length(btrim(coalesce(p_motivo,''))) < 3 then
    raise exception 'Escribe el motivo (al menos 3 letras).' using errcode = '23514';
  end if;
  update public.maquinaria_estado_eventos
     set motivo = nullif(btrim(coalesce(p_motivo,'')),''),
         material = nullif(btrim(coalesce(p_material,'')),''),
         nota = nullif(btrim(coalesce(p_nota,'')),'')
   where id = p_id;
  select id into v_ult from public.maquinaria_estado_eventos where equipo_id = ev.equipo_id order by created_at desc, id desc limit 1;
  if v_ult = p_id then
    update public.maquinaria_equipos set estado_nota = nullif(btrim(coalesce(p_motivo,'')),''), updated_at = now() where id = ev.equipo_id;
  end if;
end $$;

-- Al borrar el cambio vigente, el equipo vuelve al estado anterior.
create or replace function public.maquinaria_evento_al_borrar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_codigo text; v_volver text; prev record; v_hay_prev boolean;
begin
  if not exists (select 1 from public.maquinaria_equipos where id = old.equipo_id) then
    return old;
  end if;
  if old.orden_servicio_id is not null then
    select codigo into v_codigo from public.maquinaria_ordenes_servicio where id = old.orden_servicio_id;
    if v_codigo is not null then
      raise exception 'Este cambio lo registró la orden %: edítala, anúlala o bórrala desde la orden.', v_codigo using errcode = '23514';
    end if;
  end if;
  if exists (select 1 from public.maquinaria_estado_eventos
              where equipo_id = old.equipo_id and (created_at > old.created_at or (created_at = old.created_at and id > old.id))) then
    return old;
  end if;
  v_volver := coalesce(nullif(old.estado_anterior,''), 'operativa');
  if v_volver not in ('operativa','averiada','parada','taller','repuestos','espera','retirada') then v_volver := 'operativa'; end if;
  select * into prev from public.maquinaria_estado_eventos
   where equipo_id = old.equipo_id order by created_at desc, id desc limit 1;
  v_hay_prev := found;
  update public.maquinaria_equipos
     set estado_operativo = v_volver,
         estado_nota = case when v_hay_prev and prev.estado = v_volver then prev.motivo else null end,
         estado_desde = case when v_hay_prev and prev.estado = v_volver then prev.created_at else now() end,
         status = public.maquinaria_status_de_estado(v_volver),
         activo = (v_volver <> 'retirada'),
         updated_at = now()
   where id = old.equipo_id;
  return old;
end $$;
drop trigger if exists trg_maquinaria_evento_al_borrar on public.maquinaria_estado_eventos;
create trigger trg_maquinaria_evento_al_borrar after delete on public.maquinaria_estado_eventos for each row execute function public.maquinaria_evento_al_borrar();

-- Órdenes de servicio
create or replace function public.maquinaria_crear_orden_servicio(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_equipo uuid := nullif(p->>'equipo_id','')::uuid;
  v_prev text; v_email text; v_nombre text;
  v_codigo text; v_id uuid; v_estado text; v_rep jsonb := '[]'::jsonb;
  it jsonb; v_cant numeric; v_stock numeric; v_desde numeric; v_comprar numeric; v_prod uuid;
  v_nombre_prod text; v_unidad text; v_almacen text; v_hay_compra boolean := false;
begin
  if not public.is_operativo() then
    raise exception 'No tienes permiso para crear órdenes de servicio.' using errcode = '42501';
  end if;
  if v_equipo is null then raise exception 'Indica el equipo.' using errcode = '23502'; end if;
  if coalesce(btrim(p->>'tipo'),'') = '' then raise exception 'Elige el tipo de servicio.' using errcode = '23502'; end if;

  select public.maquinaria_estado_efectivo(estado_operativo, status, activo) into v_prev
    from public.maquinaria_equipos where id = v_equipo;
  if not found then raise exception 'El equipo no existe.' using errcode = 'P0002'; end if;
  if v_prev = 'retirada' then raise exception 'El equipo está retirado: reactívalo antes de abrirle un servicio.' using errcode = '23514'; end if;

  for it in select * from jsonb_array_elements(coalesce(p->'repuestos','[]'::jsonb)) loop
    v_cant := greatest(0, coalesce(nullif(it->>'cantidad','')::numeric, 0));
    if v_cant <= 0 then continue; end if;
    v_prod := nullif(it->>'producto_id','')::uuid;
    v_stock := 0; v_nombre_prod := nullif(btrim(it->>'nombre'),''); v_unidad := nullif(btrim(it->>'unidad'),''); v_almacen := null;
    if v_prod is not null then
      select greatest(0, coalesce(stock,0)), nombre, unidad, almacen into v_stock, v_nombre_prod, v_unidad, v_almacen
        from public.productos where id = v_prod;
      if not found then v_prod := null; v_stock := 0; v_nombre_prod := nullif(btrim(it->>'nombre'),''); end if;
    end if;
    if v_nombre_prod is null then raise exception 'Cada repuesto necesita un nombre.' using errcode = '23502'; end if;
    v_desde := least(v_cant, v_stock);
    v_comprar := v_cant - v_desde;
    if v_comprar > 0 then v_hay_compra := true; end if;
    v_rep := v_rep || jsonb_build_array(jsonb_build_object(
      'producto_id', v_prod, 'nombre', v_nombre_prod, 'unidad', coalesce(v_unidad,'und'), 'almacen', v_almacen,
      'cantidad', v_cant, 'stock_al_crear', v_stock, 'desde_inventario', v_desde, 'a_comprar', v_comprar,
      'origen', case when v_comprar = 0 then 'stock' when v_desde > 0 then 'parcial' else 'compra' end));
  end loop;

  v_estado := case when v_hay_compra then 'repuestos' else 'abierta' end;
  v_codigo := 'OS-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' ||
              lpad(public.next_correlativo('os-' || to_char(now() at time zone 'America/Caracas', 'YYYY'))::text, 4, '0');
  select email, nombre into v_email, v_nombre from public.usuarios where id = auth.uid();

  insert into public.maquinaria_ordenes_servicio(codigo, equipo_id, tipo, urgencia, intervenciones, trabajos, origen, responsable,
    descripcion, estado, repuestos, horometro, kilometraje, estado_equipo_previo, created_by, actor_name)
  values (v_codigo, v_equipo, btrim(p->>'tipo'), coalesce(nullif(p->>'urgencia',''),'normal'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'intervenciones','[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'trabajos','[]'::jsonb))), '{}'),
    coalesce(nullif(p->>'origen',''),'interno'), nullif(btrim(coalesce(p->>'responsable','')),''),
    nullif(btrim(coalesce(p->>'descripcion','')),''), v_estado, v_rep,
    nullif(p->>'horometro','')::numeric, nullif(p->>'kilometraje','')::numeric, v_prev,
    coalesce(v_email,'sistema'), v_nombre)
  returning id into v_id;

  perform public.maquinaria_set_estado_interno(v_equipo, case when v_hay_compra then 'repuestos' else 'taller' end,
    v_codigo || coalesce(' · ' || nullif(btrim(coalesce(p->>'descripcion','')),''), ''), null, null, v_id);

  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'estado', v_estado, 'repuestos', v_rep);
end $$;

create or replace function public.maquinaria_avanzar_orden_servicio(p_id uuid, p_estado text, p_nota text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare o record; v_otras int; v_equipo_estado text;
begin
  if not public.is_operativo() then
    raise exception 'No tienes permiso para avanzar órdenes de servicio.' using errcode = '42501';
  end if;
  select * into o from public.maquinaria_ordenes_servicio where id = p_id for update;
  if not found then raise exception 'La orden no existe.' using errcode = 'P0002'; end if;
  if not ((o.estado = 'abierta' and p_estado in ('en_proceso','realizada','anulada'))
       or (o.estado = 'repuestos' and p_estado in ('en_proceso','anulada'))
       or (o.estado = 'en_proceso' and p_estado in ('realizada','anulada'))) then
    raise exception 'La orden % está «%» y no puede pasar a «%».', o.codigo, o.estado, p_estado using errcode = '23514';
  end if;
  if p_estado = 'anulada' and length(btrim(coalesce(p_nota,''))) < 3 then
    raise exception 'Escribe por qué se anula la orden.' using errcode = '23514';
  end if;
  update public.maquinaria_ordenes_servicio
     set estado = p_estado,
         nota_cierre = case when p_estado in ('realizada','anulada') then nullif(btrim(coalesce(p_nota,'')),'') else nota_cierre end,
         cerrada_at = case when p_estado in ('realizada','anulada') then now() else cerrada_at end
   where id = p_id;
  select count(*) into v_otras from public.maquinaria_ordenes_servicio
   where equipo_id = o.equipo_id and id <> p_id and estado in ('abierta','repuestos','en_proceso');
  if p_estado = 'en_proceso' then
    v_equipo_estado := 'taller';
  elsif v_otras > 0 then
    v_equipo_estado := null;
  elsif p_estado = 'realizada' then
    v_equipo_estado := 'operativa';
  else
    v_equipo_estado := case when o.estado_equipo_previo in ('averiada','parada','espera') then o.estado_equipo_previo else 'operativa' end;
  end if;
  if v_equipo_estado is not null then
    perform public.maquinaria_set_estado_interno(o.equipo_id, v_equipo_estado,
      o.codigo || ' · ' || case p_estado when 'en_proceso' then 'trabajo iniciado' when 'realizada' then 'servicio realizado' else 'orden anulada' end,
      null, p_nota, p_id);
  end if;
  return p_estado;
end $$;

create or replace function public.maquinaria_editar_orden_servicio(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  o record; v_rep jsonb; v_estado text; v_hay_compra boolean := false;
  it jsonb; v_cant numeric; v_stock numeric; v_desde numeric; v_comprar numeric; v_prod uuid;
  v_nombre_prod text; v_unidad text; v_almacen text; v_actual text;
  v_nuevas_antes text[]; v_nuevas_ahora text[]; v_notificar boolean := false;
begin
  if not public.is_operativo() then
    raise exception 'No tienes permiso para editar órdenes de servicio.' using errcode = '42501';
  end if;
  select * into o from public.maquinaria_ordenes_servicio where id = p_id for update;
  if not found then raise exception 'La orden no existe (puede que la hayan borrado).' using errcode = 'P0002'; end if;
  if coalesce(btrim(p->>'tipo'),'') = '' then raise exception 'Elige el tipo de servicio.' using errcode = '23502'; end if;

  v_rep := o.repuestos; v_estado := o.estado;
  if jsonb_typeof(p->'repuestos') = 'array' then
    if o.estado not in ('abierta','repuestos') then
      raise exception 'La orden % está «%»: sus repuestos ya no se pueden cambiar.', o.codigo, o.estado using errcode = '23514';
    end if;
    if o.solicitud_salida_id is not null or o.orden_compra_id is not null then
      raise exception 'La orden % ya tiene su salida o su pedido: cambia los repuestos allí (Salidas / Pedidos).', o.codigo using errcode = '23514';
    end if;
    v_rep := '[]'::jsonb;
    for it in select * from jsonb_array_elements(p->'repuestos') loop
      v_cant := greatest(0, coalesce(nullif(it->>'cantidad','')::numeric, 0));
      if v_cant <= 0 then continue; end if;
      v_prod := nullif(it->>'producto_id','')::uuid;
      v_stock := 0; v_nombre_prod := nullif(btrim(it->>'nombre'),''); v_unidad := nullif(btrim(it->>'unidad'),''); v_almacen := null;
      if v_prod is not null then
        select greatest(0, coalesce(stock,0)), nombre, unidad, almacen into v_stock, v_nombre_prod, v_unidad, v_almacen
          from public.productos where id = v_prod;
        if not found then v_prod := null; v_stock := 0; v_nombre_prod := nullif(btrim(it->>'nombre'),''); end if;
      end if;
      if v_nombre_prod is null then raise exception 'Cada repuesto necesita un nombre.' using errcode = '23502'; end if;
      v_desde := least(v_cant, v_stock);
      v_comprar := v_cant - v_desde;
      if v_comprar > 0 then v_hay_compra := true; end if;
      v_rep := v_rep || jsonb_build_array(jsonb_build_object(
        'producto_id', v_prod, 'nombre', v_nombre_prod, 'unidad', coalesce(v_unidad,'und'), 'almacen', v_almacen,
        'cantidad', v_cant, 'stock_al_crear', v_stock, 'desde_inventario', v_desde, 'a_comprar', v_comprar,
        'origen', case when v_comprar = 0 then 'stock' when v_desde > 0 then 'parcial' else 'compra' end));
    end loop;
    v_estado := case when v_hay_compra then 'repuestos' else 'abierta' end;
    select coalesce(array_agg(x->>'nombre' order by x->>'nombre'), '{}') into v_nuevas_antes
      from jsonb_array_elements(o.repuestos) x where nullif(x->>'producto_id','') is null;
    select coalesce(array_agg(x->>'nombre' order by x->>'nombre'), '{}') into v_nuevas_ahora
      from jsonb_array_elements(v_rep) x where nullif(x->>'producto_id','') is null;
    v_notificar := v_nuevas_ahora is distinct from v_nuevas_antes and cardinality(v_nuevas_ahora) > 0;
  end if;

  update public.maquinaria_ordenes_servicio
     set tipo = btrim(p->>'tipo'),
         urgencia = coalesce(nullif(p->>'urgencia',''), urgencia),
         intervenciones = case when jsonb_typeof(p->'intervenciones') = 'array'
                               then array(select jsonb_array_elements_text(p->'intervenciones')) else intervenciones end,
         trabajos = case when jsonb_typeof(p->'trabajos') = 'array'
                         then array(select jsonb_array_elements_text(p->'trabajos')) else trabajos end,
         origen = coalesce(nullif(p->>'origen',''), origen),
         responsable = nullif(btrim(coalesce(p->>'responsable','')),''),
         descripcion = nullif(btrim(coalesce(p->>'descripcion','')),''),
         horometro = case when p ? 'horometro' then nullif(p->>'horometro','')::numeric else horometro end,
         kilometraje = case when p ? 'kilometraje' then nullif(p->>'kilometraje','')::numeric else kilometraje end,
         nota_cierre = case when estado in ('realizada','anulada') and p ? 'nota_cierre'
                            then nullif(btrim(coalesce(p->>'nota_cierre','')),'') else nota_cierre end,
         repuestos = v_rep,
         estado = v_estado,
         compras_notificada_at = case when v_notificar then null else compras_notificada_at end
   where id = p_id;

  if v_estado <> o.estado then
    select public.maquinaria_estado_efectivo(estado_operativo, status, activo) into v_actual
      from public.maquinaria_equipos where id = o.equipo_id;
    if v_actual in ('taller','repuestos') then
      perform public.maquinaria_set_estado_interno(o.equipo_id, case when v_estado = 'repuestos' then 'repuestos' else 'taller' end,
        o.codigo || ' · repuestos editados', null, null, p_id);
    end if;
  end if;

  return jsonb_build_object('id', p_id, 'codigo', o.codigo, 'estado', v_estado, 'repuestos', v_rep, 'notificar', v_notificar);
end $$;

create or replace function public.maquinaria_vincular_orden_servicio(p_id uuid, p_salida uuid default null, p_compra uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_operativo() then raise exception 'No tienes permiso.' using errcode = '42501'; end if;
  update public.maquinaria_ordenes_servicio
     set solicitud_salida_id = coalesce(solicitud_salida_id, p_salida),
         orden_compra_id = coalesce(orden_compra_id, p_compra)
   where id = p_id;
end $$;

create or replace function public.maquinaria_reemplazar_pieza_orden(p_id uuid, p_indice integer, p_producto_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare o record; it jsonb; p record; v_cant numeric; v_desde numeric; v_comprar numeric; v_rep jsonb; v_quedan numeric;
begin
  if not public.is_operativo() then raise exception 'No tienes permiso.' using errcode = '42501'; end if;
  select * into o from public.maquinaria_ordenes_servicio where id = p_id for update;
  if not found then raise exception 'La orden no existe.' using errcode = 'P0002'; end if;
  if o.estado not in ('abierta','repuestos','en_proceso') then
    raise exception 'La orden % ya está cerrada.', o.codigo using errcode = '23514';
  end if;
  if o.orden_compra_id is not null then
    raise exception 'La orden % ya tiene su solicitud de pedido: cambia la pieza allí, en Pedidos.', o.codigo using errcode = '23514';
  end if;
  it := o.repuestos -> p_indice;
  if it is null then raise exception 'Ese repuesto no está en la orden.' using errcode = 'P0002'; end if;
  if nullif(it->>'producto_id','') is not null then
    raise exception 'Ese repuesto ya es un producto del inventario.' using errcode = '23514';
  end if;
  select id, nombre, unidad, almacen, greatest(0, coalesce(stock,0)) stock into p
    from public.productos where id = p_producto_id and estado = 'activo';
  if not found then raise exception 'El producto no existe o está inactivo.' using errcode = 'P0002'; end if;
  v_cant := greatest(0, coalesce((it->>'cantidad')::numeric, 0));
  v_desde := case when o.solicitud_salida_id is null then least(v_cant, p.stock) else 0 end;
  v_comprar := v_cant - v_desde;
  v_rep := jsonb_set(o.repuestos, array[p_indice::text], jsonb_build_object(
    'producto_id', p.id, 'nombre', p.nombre, 'unidad', coalesce(p.unidad,'und'), 'almacen', p.almacen,
    'cantidad', v_cant, 'stock_al_crear', p.stock, 'desde_inventario', v_desde, 'a_comprar', v_comprar,
    'origen', case when v_comprar = 0 then 'stock' when v_desde > 0 then 'parcial' else 'compra' end,
    'pieza_nueva', it->>'nombre'));
  select coalesce(sum((r->>'a_comprar')::numeric), 0) into v_quedan from jsonb_array_elements(v_rep) r;
  update public.maquinaria_ordenes_servicio
     set repuestos = v_rep,
         estado = case when estado = 'repuestos' and v_quedan = 0 then 'abierta' else estado end
   where id = p_id;
  if o.estado = 'repuestos' and v_quedan = 0 then
    perform public.maquinaria_set_estado_interno(o.equipo_id, 'taller', o.codigo || ' · ya no espera repuestos', null, null, p_id);
  end if;
  return v_rep -> p_indice;
end $$;

-- Aviso al administrador de las piezas que no están en el inventario (la app las da de alta al pedir la compra).
create or replace function public.maquinaria_notificar_compras_piezas(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare o record; v_equipo text; v_lista text; v_n int;
begin
  if not public.is_operativo() then raise exception 'No tienes permiso.' using errcode = '42501'; end if;
  select * into o from public.maquinaria_ordenes_servicio where id = p_id for update;
  if not found then raise exception 'La orden no existe.' using errcode = 'P0002'; end if;
  select string_agg(trim(both from concat_ws(' ', r->>'cantidad', r->>'unidad', r->>'nombre')), '; '), count(*)
    into v_lista, v_n
    from jsonb_array_elements(o.repuestos) r
   where coalesce(r->>'producto_id','') = '';
  if coalesce(v_n, 0) = 0 then return false; end if;
  select equipo into v_equipo from public.maquinaria_equipos where id = o.equipo_id;
  if not exists (select 1 from public.notificaciones where dedup_key = 'maq-os-piezas-' || o.id and read = false) then
    insert into public.notificaciones(destino, kind, title, message, link, dedup_key)
    values ('admin', 'warning',
      '🔩 Piezas para dar de alta · ' || o.codigo,
      o.codigo || ' · ' || coalesce(v_equipo, 'equipo') || ': ' || v_n || ' pieza(s) que no están en el inventario — ' || v_lista || '. Se dan de alta al pedir la compra desde la orden.',
      '#/app/maquinaria/equipo/' || o.equipo_id || '?tab=servicios',
      'maq-os-piezas-' || o.id);
  end if;
  update public.maquinaria_ordenes_servicio set compras_notificada_at = now() where id = p_id;
  return true;
end $$;

create or replace function public.maquinaria_marcar_compras_notificada(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_operativo() then raise exception 'No tienes permiso.' using errcode = '42501'; end if;
  update public.maquinaria_ordenes_servicio set compras_notificada_at = now() where id = p_id;
end $$;

-- Al borrar una orden: libera el correlativo si era la última, y devuelve el equipo a su estado.
create or replace function public.maquinaria_os_al_borrar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_otras int; v_actual text; v_volver text; v_motivo text; v_anio text;
begin
  v_anio := split_part(old.codigo, '-', 2);
  if old.codigo ~ '^OS-\d{4}-\d+$' then
    update public.correlativos
       set valor = coalesce((select max(substring(codigo from '(\d+)$')::int)
                               from public.maquinaria_ordenes_servicio
                              where id <> old.id and codigo ~ ('^OS-' || v_anio || '-\d+$')), 0)
     where clave = 'os-' || v_anio;
  end if;
  if not exists (select 1 from public.maquinaria_equipos where id = old.equipo_id) then
    return old;
  end if;
  if old.estado = 'realizada' and not public.is_admin() then
    raise exception 'La orden % ya tiene el servicio realizado (traza completa): solo un administrador puede borrarla.', old.codigo using errcode = '42501';
  end if;
  if old.estado in ('abierta','repuestos','en_proceso') then
    select count(*) into v_otras from public.maquinaria_ordenes_servicio
     where equipo_id = old.equipo_id and id <> old.id and estado in ('abierta','repuestos','en_proceso');
    select public.maquinaria_estado_efectivo(estado_operativo, status, activo) into v_actual
      from public.maquinaria_equipos where id = old.equipo_id;
    if v_otras = 0 and v_actual in ('taller','repuestos') then
      v_volver := case when old.estado_equipo_previo in ('averiada','parada','espera') then old.estado_equipo_previo else 'operativa' end;
      if v_volver <> 'operativa' then
        select motivo into v_motivo from public.maquinaria_estado_eventos
         where equipo_id = old.equipo_id and estado = v_volver and created_at <= old.created_at
         order by created_at desc limit 1;
      end if;
      perform public.maquinaria_set_estado_interno(old.equipo_id, v_volver,
        coalesce(v_motivo, old.codigo || ' · orden eliminada'), null, 'Orden ' || old.codigo || ' eliminada', null);
    end if;
  end if;
  return old;
end $$;
drop trigger if exists trg_maquinaria_os_al_borrar on public.maquinaria_ordenes_servicio;
create trigger trg_maquinaria_os_al_borrar before delete on public.maquinaria_ordenes_servicio for each row execute function public.maquinaria_os_al_borrar();
drop trigger if exists trg_maquinaria_os_updated_at on public.maquinaria_ordenes_servicio;
create trigger trg_maquinaria_os_updated_at before update on public.maquinaria_ordenes_servicio for each row execute function public.set_updated_at();

-- Cuando Pedidos recibe la compra, la orden que esperaba repuestos pasa sola a «en proceso».
create or replace function public.maquinaria_os_compra_recibida()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare o record;
begin
  if new.estado::text in ('recibida','finalizada') and old.estado is distinct from new.estado then
    begin
      for o in select id, codigo, equipo_id from public.maquinaria_ordenes_servicio
                where orden_compra_id = new.id and estado = 'repuestos' for update loop
        update public.maquinaria_ordenes_servicio set estado = 'en_proceso' where id = o.id;
        perform public.maquinaria_set_estado_interno(o.equipo_id, 'taller',
          o.codigo || ' · repuestos recibidos (' || coalesce(new.oc_codigo, new.codigo, 'compra') || ')', null, null, o.id);
      end loop;
    exception when others then
      raise warning 'maquinaria_os_compra_recibida: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_maquinaria_os_compra_recibida on public.ordenes;
create trigger trg_maquinaria_os_compra_recibida after update of estado on public.ordenes for each row execute function public.maquinaria_os_compra_recibida();

-- Fotos de la orden: tope de 4 y puesto libre.
create or replace function public.maquinaria_os_fotos_tope()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_n int; v_libre int;
begin
  perform pg_advisory_xact_lock(hashtextextended('maquinaria_os_fotos:' || new.orden_id::text, 0));
  select count(*) into v_n from public.maquinaria_os_fotos where orden_id = new.orden_id;
  if v_n >= 4 then
    raise exception 'La orden ya tiene 4 fotos: quita una para agregar otra.' using errcode = 'P0001';
  end if;
  if new.orden is null then
    select min(g) into v_libre from generate_series(1, 4) g
     where not exists (select 1 from public.maquinaria_os_fotos f where f.orden_id = new.orden_id and f.orden = g);
    new.orden := v_libre;
  end if;
  return new;
end $$;
drop trigger if exists trg_maquinaria_os_fotos_tope on public.maquinaria_os_fotos;
create trigger trg_maquinaria_os_fotos_tope before insert on public.maquinaria_os_fotos for each row execute function public.maquinaria_os_fotos_tope();
-- La app no manda `orden`: el trigger pone el primer puesto libre. La columna admite null antes del trigger.
alter table public.maquinaria_os_fotos alter column orden drop not null;

-- Lecturas (contador en dos vías con Combustible)
create or replace function public.maquinaria_lecturas_vigentes()
returns table(equipo_id uuid, horometro numeric, horometro_fecha timestamptz, horometro_origen text, kilometraje numeric, km_fecha timestamptz, km_origen text)
language sql stable set search_path to 'public' as $$
  with u as (select * from public.maquinaria_lecturas_unificadas where equipo_id is not null),
  ch as (select equipo_id, max(fecha) corte from u where es_correccion and horometro is not null group by 1),
  ck as (select equipo_id, max(fecha) corte from u where es_correccion and kilometraje is not null group by 1),
  h as (
    select distinct on (u.equipo_id) u.equipo_id, u.horometro, u.fecha, u.origen
      from u left join ch on ch.equipo_id = u.equipo_id
     where u.horometro is not null and u.fecha >= coalesce(ch.corte, '-infinity'::timestamptz)
     order by u.equipo_id, u.horometro desc, u.fecha desc),
  k as (
    select distinct on (u.equipo_id) u.equipo_id, u.kilometraje, u.fecha, u.origen
      from u left join ck on ck.equipo_id = u.equipo_id
     where u.kilometraje is not null and u.fecha >= coalesce(ck.corte, '-infinity'::timestamptz)
     order by u.equipo_id, u.kilometraje desc, u.fecha desc)
  select coalesce(h.equipo_id, k.equipo_id), h.horometro, h.fecha, h.origen, k.kilometraje, k.fecha, k.origen
    from h full join k on k.equipo_id = h.equipo_id;
$$;

create or replace function public.maquinaria_registrar_lectura(p_equipo_id uuid, p_horometro numeric, p_kilometraje numeric, p_fecha timestamptz default null, p_nota text default null, p_correccion boolean default false, p_motivo text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v record; v_email text; v_nombre text; v_id uuid;
begin
  if not public.is_operativo() then
    raise exception 'No tienes permiso para registrar lecturas.' using errcode = '42501';
  end if;
  if p_horometro is null and p_kilometraje is null then
    raise exception 'Indica el horómetro o el kilometraje.' using errcode = '23502';
  end if;
  if not exists (select 1 from public.maquinaria_equipos where id = p_equipo_id) then
    raise exception 'El equipo no existe.' using errcode = 'P0002';
  end if;
  if coalesce(p_fecha, now()) > now() + interval '5 minutes' then
    raise exception 'La fecha de la lectura no puede ser futura.' using errcode = '23514';
  end if;
  if coalesce(p_correccion, false) then
    if not public.is_admin() then
      raise exception 'Solo un administrador puede corregir una lectura hacia abajo.' using errcode = '42501';
    end if;
    if length(btrim(coalesce(p_motivo, ''))) < 3 then
      raise exception 'Escribe el motivo de la corrección.' using errcode = '23514';
    end if;
  else
    select * into v from public.maquinaria_lecturas_vigentes() x where x.equipo_id = p_equipo_id;
    if p_horometro is not null and v.horometro is not null and p_horometro < v.horometro then
      raise exception 'El horómetro (%) no puede ser menor que el vigente (% h, de %). Si hubo un cambio de horómetro, pide a un administrador una corrección.',
        p_horometro, v.horometro, v.horometro_origen using errcode = '23514';
    end if;
    if p_kilometraje is not null and v.kilometraje is not null and p_kilometraje < v.kilometraje then
      raise exception 'El kilometraje (%) no puede ser menor que el vigente (% km, de %). Si hubo un cambio de odómetro, pide a un administrador una corrección.',
        p_kilometraje, v.kilometraje, v.km_origen using errcode = '23514';
    end if;
  end if;
  select email, nombre into v_email, v_nombre from public.usuarios where id = auth.uid();
  insert into public.maquinaria_lecturas(equipo_id, fecha, horometro, kilometraje, nota, es_correccion, motivo_correccion, actor, actor_name)
  values (p_equipo_id, coalesce(p_fecha, now()), p_horometro, p_kilometraje, nullif(btrim(coalesce(p_nota,'')),''),
          coalesce(p_correccion, false), nullif(btrim(coalesce(p_motivo,'')),''), coalesce(v_email,'sistema'), v_nombre)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.maquinaria_editar_lectura(p_id uuid, p_horometro numeric, p_kilometraje numeric, p_fecha timestamptz, p_nota text, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  l record; v_ref text := p_id::text; v_fecha timestamptz := coalesce(p_fecha, now());
  v_corte_a timestamptz; v_corte_d timestamptz; v_antes numeric; v_despues numeric;
begin
  if not public.is_operativo() then
    raise exception 'No tienes permiso para editar lecturas.' using errcode = '42501';
  end if;
  select * into l from public.maquinaria_lecturas where id = p_id for update;
  if not found then raise exception 'La lectura no existe (puede que la hayan borrado).' using errcode = 'P0002'; end if;
  if l.es_correccion and not public.is_admin() then
    raise exception 'Esta lectura es una corrección: solo un administrador puede cambiarla.' using errcode = '42501';
  end if;
  if p_horometro is null and p_kilometraje is null then
    raise exception 'Indica el horómetro o el kilometraje.' using errcode = '23502';
  end if;
  if v_fecha > now() + interval '5 minutes' then
    raise exception 'La fecha de la lectura no puede ser futura.' using errcode = '23514';
  end if;
  if l.es_correccion and length(btrim(coalesce(nullif(btrim(coalesce(p_motivo,'')),''), l.motivo_correccion, ''))) < 3 then
    raise exception 'Escribe el motivo de la corrección.' using errcode = '23514';
  end if;
  if not public.is_admin() then
    if p_horometro is not null then
      select max(fecha) into v_corte_a from public.maquinaria_lecturas_unificadas
       where equipo_id = l.equipo_id and es_correccion and horometro is not null and fecha <= v_fecha and not (origen = 'maquinaria' and referencia = v_ref);
      select min(fecha) into v_corte_d from public.maquinaria_lecturas_unificadas
       where equipo_id = l.equipo_id and es_correccion and horometro is not null and fecha > v_fecha and not (origen = 'maquinaria' and referencia = v_ref);
      select max(horometro) into v_antes from public.maquinaria_lecturas_unificadas
       where equipo_id = l.equipo_id and horometro is not null and fecha <= v_fecha and fecha >= coalesce(v_corte_a, '-infinity')
         and not (origen = 'maquinaria' and referencia = v_ref);
      select min(horometro) into v_despues from public.maquinaria_lecturas_unificadas
       where equipo_id = l.equipo_id and horometro is not null and fecha > v_fecha and fecha < coalesce(v_corte_d, 'infinity')
         and not (origen = 'maquinaria' and referencia = v_ref);
      if (v_antes is not null and p_horometro < v_antes) or (v_despues is not null and p_horometro > v_despues) then
        raise exception 'El horómetro (%) tiene que quedar entre la lectura anterior (% h) y la siguiente (% h). Si hubo un cambio de horómetro, pide a un administrador una corrección.',
          p_horometro, coalesce(v_antes::text, '—'), coalesce(v_despues::text, '—') using errcode = '23514';
      end if;
    end if;
    if p_kilometraje is not null then
      select max(fecha) into v_corte_a from public.maquinaria_lecturas_unificadas
       where equipo_id = l.equipo_id and es_correccion and kilometraje is not null and fecha <= v_fecha and not (origen = 'maquinaria' and referencia = v_ref);
      select min(fecha) into v_corte_d from public.maquinaria_lecturas_unificadas
       where equipo_id = l.equipo_id and es_correccion and kilometraje is not null and fecha > v_fecha and not (origen = 'maquinaria' and referencia = v_ref);
      select max(kilometraje) into v_antes from public.maquinaria_lecturas_unificadas
       where equipo_id = l.equipo_id and kilometraje is not null and fecha <= v_fecha and fecha >= coalesce(v_corte_a, '-infinity')
         and not (origen = 'maquinaria' and referencia = v_ref);
      select min(kilometraje) into v_despues from public.maquinaria_lecturas_unificadas
       where equipo_id = l.equipo_id and kilometraje is not null and fecha > v_fecha and fecha < coalesce(v_corte_d, 'infinity')
         and not (origen = 'maquinaria' and referencia = v_ref);
      if (v_antes is not null and p_kilometraje < v_antes) or (v_despues is not null and p_kilometraje > v_despues) then
        raise exception 'El kilometraje (%) tiene que quedar entre la lectura anterior (% km) y la siguiente (% km). Si hubo un cambio de odómetro, pide a un administrador una corrección.',
          p_kilometraje, coalesce(v_antes::text, '—'), coalesce(v_despues::text, '—') using errcode = '23514';
      end if;
    end if;
  end if;
  update public.maquinaria_lecturas
     set horometro = p_horometro, kilometraje = p_kilometraje, fecha = v_fecha,
         nota = nullif(btrim(coalesce(p_nota,'')),''),
         motivo_correccion = case when es_correccion then coalesce(nullif(btrim(coalesce(p_motivo,'')),''), motivo_correccion) else motivo_correccion end
   where id = p_id;
end $$;

create or replace function public.maquinaria_lectura_al_borrar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.es_correccion and not public.is_admin()
     and exists (select 1 from public.maquinaria_equipos where id = old.equipo_id) then
    raise exception 'Esta lectura es una corrección: solo un administrador puede borrarla.' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists trg_maquinaria_lectura_al_borrar on public.maquinaria_lecturas;
create trigger trg_maquinaria_lectura_al_borrar before delete on public.maquinaria_lecturas for each row execute function public.maquinaria_lectura_al_borrar();

-- Reiniciar el contador de mantenimiento (botón «Mantt. hecho»): la base queda en la lectura vigente.
create or replace function public.reiniciar_mantenimiento_equipo(p_equipo_id uuid, p_horas numeric, p_km numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_operativo() then
    raise exception 'No autorizado para reiniciar el mantenimiento de equipos.' using errcode = '42501';
  end if;
  update public.maquinaria_equipos
     set mantenimiento_base_hrs = coalesce(p_horas, mantenimiento_base_hrs),
         mantenimiento_base_km  = coalesce(p_km,   mantenimiento_base_km),
         updated_at = now()
   where id = p_equipo_id;
end $$;

-- Renombrar un nombre de documento en el catálogo renombra los documentos que lo usan.
create or replace function public.maquinaria_doc_nombre_renombrado()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.tipo = 'documento' and old.tipo = 'documento' and new.valor is distinct from old.valor then
    update public.maquinaria_documentos set nombre = new.valor where nombre = old.valor;
  end if;
  return new;
end $$;
drop trigger if exists trg_maq_doc_nombre_renombrado on public.maquinaria_catalogos;
create trigger trg_maq_doc_nombre_renombrado after update of valor on public.maquinaria_catalogos for each row execute function public.maquinaria_doc_nombre_renombrado();

-- Permisos de ejecución: solo usuarios autenticados.
revoke execute on function public.next_correlativo(text) from anon, public;
grant execute on function public.next_correlativo(text) to authenticated;
revoke execute on function public.maquinaria_cambiar_estado(uuid, text, text, text, text) from anon, public;
grant execute on function public.maquinaria_cambiar_estado(uuid, text, text, text, text) to authenticated;
revoke execute on function public.maquinaria_editar_evento_estado(uuid, text, text, text) from anon, public;
grant execute on function public.maquinaria_editar_evento_estado(uuid, text, text, text) to authenticated;
revoke execute on function public.maquinaria_crear_orden_servicio(jsonb) from anon, public;
grant execute on function public.maquinaria_crear_orden_servicio(jsonb) to authenticated;
revoke execute on function public.maquinaria_avanzar_orden_servicio(uuid, text, text) from anon, public;
grant execute on function public.maquinaria_avanzar_orden_servicio(uuid, text, text) to authenticated;
revoke execute on function public.maquinaria_editar_orden_servicio(uuid, jsonb) from anon, public;
grant execute on function public.maquinaria_editar_orden_servicio(uuid, jsonb) to authenticated;
revoke execute on function public.maquinaria_vincular_orden_servicio(uuid, uuid, uuid) from anon, public;
grant execute on function public.maquinaria_vincular_orden_servicio(uuid, uuid, uuid) to authenticated;
revoke execute on function public.maquinaria_reemplazar_pieza_orden(uuid, integer, uuid) from anon, public;
grant execute on function public.maquinaria_reemplazar_pieza_orden(uuid, integer, uuid) to authenticated;
revoke execute on function public.maquinaria_notificar_compras_piezas(uuid) from anon, public;
grant execute on function public.maquinaria_notificar_compras_piezas(uuid) to authenticated;
revoke execute on function public.maquinaria_marcar_compras_notificada(uuid) from anon, public;
grant execute on function public.maquinaria_marcar_compras_notificada(uuid) to authenticated;
revoke execute on function public.maquinaria_lecturas_vigentes() from anon, public;
grant execute on function public.maquinaria_lecturas_vigentes() to authenticated;
revoke execute on function public.maquinaria_registrar_lectura(uuid, numeric, numeric, timestamptz, text, boolean, text) from anon, public;
grant execute on function public.maquinaria_registrar_lectura(uuid, numeric, numeric, timestamptz, text, boolean, text) to authenticated;
revoke execute on function public.maquinaria_editar_lectura(uuid, numeric, numeric, timestamptz, text, text) from anon, public;
grant execute on function public.maquinaria_editar_lectura(uuid, numeric, numeric, timestamptz, text, text) to authenticated;
revoke execute on function public.reiniciar_mantenimiento_equipo(uuid, numeric, numeric) from anon, public;
grant execute on function public.reiniciar_mantenimiento_equipo(uuid, numeric, numeric) to authenticated;
