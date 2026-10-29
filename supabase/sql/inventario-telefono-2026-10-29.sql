-- ============================================================
-- MGG · Inventario y Almacenes · Vista de teléfono (29-10-2026)
-- Traída de Golden Touch (Depósito Mina) y adaptada a VARIOS almacenes.
--
-- · Salidas desde el teléfono, con «¿retorna?» y hasta 4 fotos. Lo que
--   retorna queda «por retornar» y vuelve al inventario (todo o por partes).
-- · El stock lo mueve la app con registrarMovimiento (como todo MGG); acá
--   viven el registro de la salida, su correlativo y sus retornos.
-- · Guardia: las salidas y traslados del teléfono respetan la regla de la
--   administradora (30-09-2026) — comida y limpieza de Los Pinos y
--   La Esperanza NO salen ni se trasladan por ahí (salen por consumo desde
--   Alimentación). No toca la guardia original de Salidas.
-- ============================================================

create table if not exists public.inventario_salidas_telefono (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  almacen text not null,
  producto_id uuid not null references public.productos(id),
  producto_nombre text not null,
  unidad text,
  cantidad numeric not null check (cantidad > 0),
  motivo text not null,
  autorizado_por text not null,
  retorna boolean not null default false,
  retornado numeric not null default 0,
  retornos jsonb not null default '[]'::jsonb,
  fotos jsonb not null default '[]'::jsonb,
  movimiento_id uuid,
  estado text not null default 'sin_retorno' check (estado in ('sin_retorno', 'por_retornar', 'retornada')),
  actor text,
  actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inventario_salidas_telefono_estado_idx on public.inventario_salidas_telefono (estado, almacen);

alter table public.inventario_salidas_telefono enable row level security;
revoke all on public.inventario_salidas_telefono from anon;
drop policy if exists "inv_tel_salidas read" on public.inventario_salidas_telefono;
create policy "inv_tel_salidas read" on public.inventario_salidas_telefono for select to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('inventario', 'lectura')) or (select public.puede_modulo('inventario', 'escritura')));
-- Sin políticas de insert/update/delete: solo se escribe por las funciones de abajo.

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'inventario_salidas_telefono') then
    alter publication supabase_realtime add table public.inventario_salidas_telefono;
  end if;
end $$;

create or replace function public.inv_tel_puede_escribir() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.puede_modulo('inventario', 'escritura');
$$;

-- El N° de la salida ANTES de mover el stock (el kardex lo lleva como referencia).
create or replace function public.inv_tel_reservar_codigo() returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.inv_tel_puede_escribir() then
    raise exception 'No tienes permiso de escritura en Inventario.' using errcode = '42501';
  end if;
  return 'SAT-' || lpad(public.next_correlativo('salida-almacen-telefono')::text, 4, '0');
end $$;

-- Guarda la salida (el movimiento de stock ya se hizo con ese id/código).
create or replace function public.inv_tel_registrar_salida(p jsonb) returns public.inventario_salidas_telefono
language plpgsql security definer set search_path = '' as $$
declare
  v_prod public.productos;
  v_cant numeric := round(coalesce((p->>'cantidad')::numeric, 0), 4);
  v_motivo text := btrim(coalesce(p->>'motivo', ''));
  v_aut text := btrim(coalesce(p->>'autorizado_por', ''));
  v_retorna boolean := coalesce((p->>'retorna')::boolean, false);
  v_fila public.inventario_salidas_telefono;
begin
  if not public.inv_tel_puede_escribir() then
    raise exception 'No tienes permiso de escritura en Inventario.' using errcode = '42501';
  end if;
  select * into v_prod from public.productos where id = (p->>'producto_id')::uuid;
  if v_prod.id is null then raise exception 'No se encontró el material.' using errcode = '23503'; end if;
  if v_cant <= 0 then raise exception 'Escribe cuánto sale.' using errcode = '23514'; end if;
  if char_length(v_motivo) < 3 then raise exception 'Escribe el motivo de la salida.' using errcode = '23514'; end if;
  if v_aut = '' then raise exception 'Indica quién autorizó la salida.' using errcode = '23514'; end if;
  if coalesce(btrim(p->>'almacen'), '') = '' then raise exception 'Falta el almacén.' using errcode = '23514'; end if;

  insert into public.inventario_salidas_telefono (id, codigo, almacen, producto_id, producto_nombre, unidad, cantidad,
    motivo, autorizado_por, retorna, estado, movimiento_id, actor, actor_name)
  values (coalesce((p->>'id')::uuid, gen_random_uuid()), p->>'codigo', btrim(p->>'almacen'), v_prod.id, v_prod.nombre,
    v_prod.unidad, v_cant, v_motivo, v_aut, v_retorna, case when v_retorna then 'por_retornar' else 'sin_retorno' end,
    nullif(p->>'movimiento_id', '')::uuid,
    coalesce(nullif(auth.jwt()->>'email', ''), p->>'actor'), nullif(btrim(coalesce(p->>'actor_name', '')), ''))
  returning * into v_fila;
  return v_fila;
end $$;

-- Anota un retorno (el movimiento de entrada lo hace la app justo después).
create or replace function public.inv_tel_retornar(p_id uuid, p_cantidad numeric, p_nota text default null, p_actor_name text default null)
returns public.inventario_salidas_telefono
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.inventario_salidas_telefono;
  v_cant numeric := round(coalesce(p_cantidad, 0), 4);
  v_pend numeric;
begin
  if not public.inv_tel_puede_escribir() then
    raise exception 'No tienes permiso de escritura en Inventario.' using errcode = '42501';
  end if;
  select * into v_s from public.inventario_salidas_telefono where id = p_id for update;
  if v_s.id is null then raise exception 'No se encontró la salida.' using errcode = '23503'; end if;
  if not v_s.retorna then raise exception 'Esa salida no retorna.' using errcode = '23514'; end if;
  v_pend := v_s.cantidad - v_s.retornado;
  if v_pend <= 0 then raise exception 'Esa salida ya retornó completa.' using errcode = '23514'; end if;
  if v_cant <= 0 then raise exception 'Escribe cuánto retorna.' using errcode = '23514'; end if;
  if v_cant > v_pend then
    raise exception 'Solo faltan % por retornar.', rtrim(rtrim(v_pend::text, '0'), '.') using errcode = '23514';
  end if;
  update public.inventario_salidas_telefono
     set retornado = retornado + v_cant,
         estado = case when retornado + v_cant >= cantidad then 'retornada' else 'por_retornar' end,
         retornos = retornos || jsonb_build_array(jsonb_build_object(
           'at', now(), 'cantidad', v_cant, 'nota', nullif(btrim(coalesce(p_nota, '')), ''),
           'actor', nullif(auth.jwt()->>'email', ''), 'actor_name', nullif(btrim(coalesce(p_actor_name, '')), ''))),
         updated_at = now()
   where id = p_id
  returning * into v_s;
  return v_s;
end $$;

-- Deshace un retorno anotado cuando el movimiento de entrada no se pudo hacer.
create or replace function public.inv_tel_deshacer_retorno(p_id uuid, p_cantidad numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.inv_tel_puede_escribir() then
    raise exception 'No tienes permiso de escritura en Inventario.' using errcode = '42501';
  end if;
  update public.inventario_salidas_telefono
     set retornado = greatest(retornado - round(coalesce(p_cantidad, 0), 4), 0),
         estado = case when retorna then 'por_retornar' else estado end,
         retornos = case when jsonb_array_length(retornos) > 0 then retornos - (jsonb_array_length(retornos) - 1) else retornos end,
         updated_at = now()
   where id = p_id;
end $$;

-- Las fotos (hasta 4) ya subidas al bucket.
create or replace function public.inv_tel_fotos(p_id uuid, p_fotos jsonb) returns public.inventario_salidas_telefono
language plpgsql security definer set search_path = '' as $$
declare v_s public.inventario_salidas_telefono;
begin
  if not public.inv_tel_puede_escribir() then
    raise exception 'No tienes permiso de escritura en Inventario.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) > 4 then
    raise exception 'Se pueden adjuntar hasta 4 fotos.' using errcode = '23514';
  end if;
  update public.inventario_salidas_telefono set fotos = p_fotos, updated_at = now() where id = p_id returning * into v_s;
  return v_s;
end $$;

revoke all on function public.inv_tel_puede_escribir() from public, anon;
revoke all on function public.inv_tel_reservar_codigo() from public, anon;
revoke all on function public.inv_tel_registrar_salida(jsonb) from public, anon;
revoke all on function public.inv_tel_retornar(uuid, numeric, text, text) from public, anon;
revoke all on function public.inv_tel_deshacer_retorno(uuid, numeric) from public, anon;
revoke all on function public.inv_tel_fotos(uuid, jsonb) from public, anon;
grant execute on function public.inv_tel_puede_escribir() to authenticated;
grant execute on function public.inv_tel_reservar_codigo() to authenticated;
grant execute on function public.inv_tel_registrar_salida(jsonb) to authenticated;
grant execute on function public.inv_tel_retornar(uuid, numeric, text, text) to authenticated;
grant execute on function public.inv_tel_deshacer_retorno(uuid, numeric) to authenticated;
grant execute on function public.inv_tel_fotos(uuid, jsonb) to authenticated;

-- Guardia del teléfono: la MISMA regla de la administradora (30-09-2026) que
-- mgg_guardia_comida_a_cocina aplica a Salidas, para las salidas y traslados
-- que salen de esta pantalla (ref_tipo salida_telefono / traslado_telefono).
create or replace function public.mgg_guardia_telefono_comida() returns trigger
language plpgsql set search_path = 'public' as $$
declare v_cat text; v_sede text;
begin
  if new.ref_tipo not in ('salida_telefono', 'traslado_telefono') or coalesce(new.delta, 0) >= 0 then
    return new;
  end if;
  select sede into v_sede from public.almacenes where nombre = new.almacen limit 1;
  if upper(coalesce(v_sede, '')) like '%MATANZA%' then return new; end if;
  select categoria into v_cat from public.productos where id = new.producto_id;
  if not public.mgg_es_categoria_cocina(v_cat) then return new; end if;
  raise exception 'Lo de Alimentación (comida y limpieza) de Los Pinos y La Esperanza no sale ni se traslada desde aquí: sale por consumo desde Alimentación.'
    using errcode = 'P0001';
end $$;

drop trigger if exists trg_guardia_telefono_comida on public.movimientos;
create trigger trg_guardia_telefono_comida before insert on public.movimientos
  for each row execute function public.mgg_guardia_telefono_comida();

-- Bucket privado de fotos de las salidas.
insert into storage.buckets (id, name, public) values ('inventario-salidas', 'inventario-salidas', false)
on conflict (id) do nothing;
drop policy if exists "inventario-salidas read" on storage.objects;
create policy "inventario-salidas read" on storage.objects for select to authenticated
  using (bucket_id = 'inventario-salidas');
drop policy if exists "inventario-salidas write" on storage.objects;
create policy "inventario-salidas write" on storage.objects for insert to authenticated
  with check (bucket_id = 'inventario-salidas' and (select public.inv_tel_puede_escribir()));

select
  (select relrowsecurity from pg_class where oid = 'public.inventario_salidas_telefono'::regclass) as rls,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'inventario_salidas_telefono') as realtime,
  exists (select 1 from storage.buckets where id = 'inventario-salidas') as bucket,
  exists (select 1 from pg_trigger where tgname = 'trg_guardia_telefono_comida') as guardia;
