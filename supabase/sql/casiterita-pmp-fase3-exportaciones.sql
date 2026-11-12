-- ============================================================
-- MGG · Los Pinos · Casiterita — FASE 3: Lotes y exportaciones  (12-11-2026)
-- Requiere la fase 1 (supabase/sql/casiterita-pmp-fase1-libro.sql).
--
-- · casiterita_exportaciones: el embarque (número único que pone la base).
-- · casiterita_lotes: cada contenedor (código MGG-NNNN que pone la base), con su
--   ley SGS e informe, precintos, muestras, merma y estado (en galpón / despachado).
--   Armar un lote escribe en el libro la salida del lote (+ muestras y merma):
--   de MGG sale la misma proporción que del galpón, al PMP vigente.
-- · casiterita_fundicion_coladas: qué coladas cubre cada salida a fundición
--   (una salida puede cubrir varias coladas; una colada se cubre una sola vez).
--
-- Todo se escribe por funciones del servidor (no hay políticas de escritura):
-- validan permiso (Inventario escritura + Los Pinos), saldo y estado.
-- Los datos de arranque (exportaciones y lotes del Excel) son internos y van en
-- la semilla privada de docs/ (git-ignored).
-- Idempotente.
-- ============================================================

create table if not exists public.casiterita_exportaciones (
  id          uuid primary key default gen_random_uuid(),
  numero      int not null unique check (numero > 0),
  fecha       date not null default current_date,
  comprador   text,
  destino     text,
  nota        text,
  historico   boolean not null default false,
  actor       uuid default auth.uid(),
  actor_name  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.casiterita_lotes (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,
  exportacion_id   uuid not null references public.casiterita_exportaciones(id),
  fecha            date not null,
  kg               numeric(14,3) not null check (kg > 0),
  muestras_kg      numeric(12,3) not null default 0 check (muestras_kg >= 0),
  merma_kg         numeric(12,3) not null default 0 check (merma_kg >= 0),
  ley_sgs          numeric(7,3) check (ley_sgs is null or (ley_sgs > 0 and ley_sgs <= 100)),
  informe_sgs_path text,
  precintos        text,
  motivo           text,
  estado           text not null default 'galpon' check (estado in ('galpon','despachado')),
  despachado_en    date,
  despachado_por_name text,
  -- Lotes anteriores a la apertura del libro: su kg MGG y costo vienen del Excel.
  historico        boolean not null default false,
  kg_mgg_hist      numeric(18,6),
  costo_hist       numeric(18,4),
  actor            uuid default auth.uid(),
  actor_name       text,
  created_at       timestamptz not null default now()
);
create index if not exists casiterita_lotes_expo_idx on public.casiterita_lotes (exportacion_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'casiterita_libro_lote_fk') then
    alter table public.casiterita_libro
      add constraint casiterita_libro_lote_fk foreign key (lote_id) references public.casiterita_lotes(id);
  end if;
end $$;

create table if not exists public.casiterita_fundicion_coladas (
  colada_id  uuid primary key references public.produccion_colada(id) on delete cascade,
  libro_id   uuid not null references public.casiterita_libro(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists casiterita_fundicion_coladas_libro_idx on public.casiterita_fundicion_coladas (libro_id);

-- ── Ayudas ──
create or replace function public.casiterita_nombre_actor()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(concat_ws(' ', nombre, apellido)), ''), email) from public.usuarios where id = auth.uid();
$$;

create or replace function public.casiterita_saldo_global()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case
           when tipo in ('apertura','entrada') then kg_global
           when tipo = 'recuperacion' then kg
           else -kg end), 0)
    from public.casiterita_libro;
$$;

-- ── Armar un lote (y, si hace falta, la exportación) ──
create or replace function public.casiterita_armar_lote(
  p_exportacion_id uuid,
  p_fecha date,
  p_kg numeric,
  p_muestras numeric default 0,
  p_merma numeric default 0,
  p_ley numeric default null,
  p_precintos text default null,
  p_motivo text default null,
  p_informe_path text default null,
  p_comprador text default null,
  p_destino text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_expo uuid;
  v_num int;
  v_lote uuid;
  v_cod text;
  v_sig int;
  v_nombre text := public.casiterita_nombre_actor();
  v_global numeric;
  v_mu numeric := coalesce(p_muestras, 0);
  v_me numeric := coalesce(p_merma, 0);
begin
  if not public.casiterita_puede_escribir() then
    raise exception 'No tienes permiso para armar lotes de Los Pinos.';
  end if;
  if p_fecha is null then raise exception 'Indica la fecha del lote.'; end if;
  if coalesce(p_kg, 0) <= 0 then raise exception 'Indica los kg del lote.'; end if;
  if v_mu < 0 or v_me < 0 then raise exception 'Muestras y merma no pueden ser negativas.'; end if;
  if p_ley is not null and (p_ley <= 0 or p_ley > 100) then raise exception 'La ley SGS va entre 0 y 100 %%.'; end if;
  if p_kg <> 28000 and coalesce(trim(p_motivo), '') = '' then
    raise exception 'El lote no es de 28.000 kg: indica el motivo.';
  end if;
  if p_informe_path is not null and p_informe_path not like 'lotes/%' then
    raise exception 'Ruta de informe SGS no válida.';
  end if;

  -- Un lote a la vez (numeración y saldo consistentes).
  perform pg_advisory_xact_lock(hashtext('casiterita_lotes'));

  v_global := public.casiterita_saldo_global();
  if p_kg + v_mu + v_me > v_global + 0.001 then
    raise exception 'No hay tanto en el galpón: el saldo global es % kg.', round(v_global, 2);
  end if;

  if p_exportacion_id is null then
    select coalesce(max(numero), 0) + 1 into v_num from public.casiterita_exportaciones;
    insert into public.casiterita_exportaciones (numero, fecha, comprador, destino, actor_name)
      values (v_num, p_fecha, nullif(trim(p_comprador), ''), nullif(trim(p_destino), ''), v_nombre)
      returning id into v_expo;
  else
    select id, numero into v_expo, v_num from public.casiterita_exportaciones where id = p_exportacion_id;
    if v_expo is null then raise exception 'La exportación no existe.'; end if;
  end if;

  select coalesce(max((substring(codigo from '^MGG-(\d+)$'))::int), 0) + 1 into v_sig
    from public.casiterita_lotes where codigo ~ '^MGG-\d+$';
  v_cod := 'MGG-' || lpad(v_sig::text, 4, '0');

  insert into public.casiterita_lotes (codigo, exportacion_id, fecha, kg, muestras_kg, merma_kg, ley_sgs, informe_sgs_path, precintos, motivo, actor_name)
    values (v_cod, v_expo, p_fecha, p_kg, v_mu, v_me, p_ley, p_informe_path, nullif(trim(p_precintos), ''), nullif(trim(p_motivo), ''), v_nombre)
    returning id into v_lote;

  perform set_config('mgg.casiterita_desde_lote', 'si', true);
  insert into public.casiterita_libro (fecha, tipo, descripcion, kg, lote_id)
    values (p_fecha, 'exportacion', format('Lote %s · Exportación #%s', v_cod, v_num), p_kg, v_lote);
  if v_mu > 0 then
    insert into public.casiterita_libro (fecha, tipo, descripcion, kg, lote_id)
      values (p_fecha, 'muestra', format('Muestras lote %s', v_cod), v_mu, v_lote);
  end if;
  if v_me > 0 then
    insert into public.casiterita_libro (fecha, tipo, descripcion, kg, lote_id)
      values (p_fecha, 'merma', format('Merma lote %s', v_cod), v_me, v_lote);
  end if;
  perform set_config('mgg.casiterita_desde_lote', '', true);
  return v_lote;
end $$;

-- ── Despachar (sale del galpón) ──
create or replace function public.casiterita_despachar_lote(p_lote uuid, p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if not public.casiterita_puede_escribir() then raise exception 'No tienes permiso para despachar lotes.'; end if;
  select estado into v_estado from public.casiterita_lotes where id = p_lote for update;
  if v_estado is null then raise exception 'El lote no existe.'; end if;
  if v_estado <> 'galpon' then raise exception 'El lote ya fue despachado.'; end if;
  update public.casiterita_lotes
     set estado = 'despachado', despachado_en = coalesce(p_fecha, current_date), despachado_por_name = public.casiterita_nombre_actor()
   where id = p_lote;
end $$;

-- ── Deshacer un lote armado por error (solo en galpón) ──
create or replace function public.casiterita_deshacer_lote(p_lote uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_l public.casiterita_lotes%rowtype;
begin
  if not public.casiterita_puede_escribir() then raise exception 'No tienes permiso para deshacer lotes.'; end if;
  select * into v_l from public.casiterita_lotes where id = p_lote for update;
  if v_l.id is null then raise exception 'El lote no existe.'; end if;
  if v_l.estado <> 'galpon' then raise exception 'Un lote despachado no se deshace.'; end if;
  if v_l.historico then raise exception 'Un lote del Excel no se deshace.'; end if;
  if exists (select 1 from public.casiterita_libro where lote_id = p_lote and origen = 'excel') then
    raise exception 'Un lote del Excel no se deshace.';
  end if;
  perform set_config('mgg.casiterita_desde_lote', 'si', true);
  delete from public.casiterita_libro where lote_id = p_lote;
  perform set_config('mgg.casiterita_desde_lote', '', true);
  delete from public.casiterita_lotes where id = p_lote;
  delete from public.casiterita_exportaciones e
   where e.id = v_l.exportacion_id and not e.historico
     and not exists (select 1 from public.casiterita_lotes l where l.exportacion_id = e.id);
  return v_l.informe_sgs_path; -- la app borra el archivo
end $$;

-- ── Ley SGS, informe y precintos (en cualquier estado) ──
create or replace function public.casiterita_sgs_lote(p_lote uuid, p_ley numeric, p_informe_path text, p_precintos text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.casiterita_puede_escribir() then raise exception 'No tienes permiso para editar lotes.'; end if;
  if p_ley is not null and (p_ley <= 0 or p_ley > 100) then raise exception 'La ley SGS va entre 0 y 100 %%.'; end if;
  if p_informe_path is not null and p_informe_path not like 'lotes/%' then raise exception 'Ruta de informe SGS no válida.'; end if;
  update public.casiterita_lotes
     set ley_sgs = p_ley, informe_sgs_path = p_informe_path, precintos = nullif(trim(p_precintos), '')
   where id = p_lote;
  if not found then raise exception 'El lote no existe.'; end if;
end $$;

-- ── Salida a fundición que cubre una o varias coladas ──
create or replace function public.casiterita_fundicion_coladas(p_coladas uuid[], p_fecha date, p_kg numeric, p_descripcion text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n int;
begin
  if not public.casiterita_puede_escribir() then raise exception 'No tienes permiso para cargar fundición.'; end if;
  if p_coladas is null or cardinality(p_coladas) = 0 then raise exception 'Elige al menos una colada.'; end if;
  if coalesce(p_kg, 0) <= 0 then raise exception 'Indica los kg que salieron a fundición.'; end if;
  if p_fecha is null then raise exception 'Indica la fecha.'; end if;
  select count(*) into v_n from public.produccion_colada where id = any(p_coladas);
  if v_n <> cardinality(p_coladas) then raise exception 'Alguna colada no existe.'; end if;
  if exists (select 1 from public.casiterita_fundicion_coladas where colada_id = any(p_coladas)) then
    raise exception 'Alguna de esas coladas ya está en el libro.';
  end if;
  perform pg_advisory_xact_lock(hashtext('casiterita_lotes'));
  if p_kg > public.casiterita_saldo_global() + 0.001 then
    raise exception 'No hay tanto en el galpón: el saldo global es % kg.', round(public.casiterita_saldo_global(), 2);
  end if;
  insert into public.casiterita_libro (fecha, tipo, descripcion, kg)
    values (p_fecha, 'fundicion', coalesce(nullif(trim(p_descripcion), ''), 'Material para fundición'), p_kg)
    returning id into v_id;
  insert into public.casiterita_fundicion_coladas (colada_id, libro_id)
    select unnest(p_coladas), v_id;
  return v_id;
end $$;

revoke all on function public.casiterita_armar_lote(uuid, date, numeric, numeric, numeric, numeric, text, text, text, text, text) from public, anon;
revoke all on function public.casiterita_despachar_lote(uuid, date) from public, anon;
revoke all on function public.casiterita_deshacer_lote(uuid) from public, anon;
revoke all on function public.casiterita_sgs_lote(uuid, numeric, text, text) from public, anon;
revoke all on function public.casiterita_fundicion_coladas(uuid[], date, numeric, text) from public, anon;
revoke all on function public.casiterita_saldo_global() from public, anon;
revoke all on function public.casiterita_nombre_actor() from public, anon;
grant execute on function public.casiterita_armar_lote(uuid, date, numeric, numeric, numeric, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.casiterita_despachar_lote(uuid, date) to authenticated;
grant execute on function public.casiterita_deshacer_lote(uuid) to authenticated;
grant execute on function public.casiterita_sgs_lote(uuid, numeric, text, text) to authenticated;
grant execute on function public.casiterita_fundicion_coladas(uuid[], date, numeric, text) to authenticated;
-- casiterita_saldo_global y casiterita_nombre_actor son internas (las usan las funciones de arriba): sin EXECUTE para la app.
revoke execute on function public.casiterita_saldo_global() from authenticated;

-- ── Seguridad: solo lectura directa; se escribe por las funciones de arriba ──
alter table public.casiterita_exportaciones enable row level security;
alter table public.casiterita_lotes enable row level security;
alter table public.casiterita_fundicion_coladas enable row level security;

drop policy if exists "casi expo read" on public.casiterita_exportaciones;
create policy "casi expo read" on public.casiterita_exportaciones for select
  using ((select public.puede_modulo('inventario', 'lectura')));
drop policy if exists "casi lotes read" on public.casiterita_lotes;
create policy "casi lotes read" on public.casiterita_lotes for select
  using ((select public.puede_modulo('inventario', 'lectura')));
drop policy if exists "casi fund coladas read" on public.casiterita_fundicion_coladas;
create policy "casi fund coladas read" on public.casiterita_fundicion_coladas for select
  using ((select public.puede_modulo('inventario', 'lectura')));

grant select on public.casiterita_exportaciones, public.casiterita_lotes, public.casiterita_fundicion_coladas to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.casiterita_exportaciones; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.casiterita_lotes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.casiterita_fundicion_coladas; exception when duplicate_object then null; end;
end $$;

-- ── Informes SGS (PDF o foto), privados ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('casiterita-sgs', 'casiterita-sgs', false, 15728640, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "casiterita-sgs read" on storage.objects;
create policy "casiterita-sgs read" on storage.objects for select
  using (bucket_id = 'casiterita-sgs' and (select public.puede_modulo('inventario', 'lectura')));
drop policy if exists "casiterita-sgs insert" on storage.objects;
create policy "casiterita-sgs insert" on storage.objects for insert
  with check (bucket_id = 'casiterita-sgs' and name like 'lotes/%' and (select public.casiterita_puede_escribir()));
drop policy if exists "casiterita-sgs delete" on storage.objects;
create policy "casiterita-sgs delete" on storage.objects for delete
  using (bucket_id = 'casiterita-sgs' and (select public.casiterita_puede_escribir()));
