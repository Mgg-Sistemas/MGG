-- ============================================================
-- MGG · Delivery · mapa, rutas y proveedores ubicados (03-11-2026)
--
-- Pedido de la administradora (tipo Yummy / Ridery): ubicar a los
-- proveedores en el mapa, que el delivery al abrir el teléfono vea dónde
-- está y cuál es el proveedor más cercano entre las OC pagadas, que vea la
-- ruta al proveedor y de ahí al almacén, y que la PC vea a todos los
-- delivery con su ruta.
--
--  1) proveedores.lat / lng (+ quién y cuándo lo ubicó).
--  2) delivery_ubicaciones: cada delivery escribe SOLO su fila; leen su
--     dueño y quien supervisa (admin o Delivery «full»). Se quita la
--     política vieja `delivery_ubicaciones_write_operativo` (ALL para todo
--     usuario operativo: cualquiera podía leer y pisar la ubicación de otro).
--  2b) delivery_ubicaciones_hist: recorrido muestreado (~60 s) de cada pedido
--     en curso, para dibujar la ruta en «Pedidos por delivery». Lo llena un
--     trigger; leen el dueño y quien supervisa.
--  3) Coordenadas de los almacenes de entrega (LOS PINOS / MATANZA) en
--     config `delivery.destinos`, editables por quien supervisa.
--  4) RPC:
--       delivery_destinos()                         → jsonb con los destinos
--       delivery_destino_guardar(clave, lat, lng)   → admin / Delivery full
--       delivery_ubicar_proveedor(id, lat, lng)     → admin / Proveedores
--         escritura / Delivery full; el delivery con un pedido EN CURSO de
--         ese proveedor puede marcarlo si todavía no tenía ubicación.
--
-- Idempotente. No toca delivery_pedidos_listado: el front lee lat/lng de
-- `proveedores` (lectura abierta a todo usuario autenticado).
-- ============================================================

-- 1) Proveedor ubicado en el mapa.
alter table public.proveedores add column if not exists lat double precision;
alter table public.proveedores add column if not exists lng double precision;
alter table public.proveedores add column if not exists ubicado_en timestamptz;
alter table public.proveedores add column if not exists ubicado_por text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'proveedores_lat_lng_check') then
    alter table public.proveedores add constraint proveedores_lat_lng_check check (
      (lat is null and lng is null)
      or (lat is not null and lng is not null and lat between -90 and 90 and lng between -180 and 180)
    );
  end if;
end $$;

-- 2) Ubicación de los delivery: solo su dueño escribe; leen el dueño y quien supervisa.
alter table public.delivery_ubicaciones enable row level security;
revoke all on public.delivery_ubicaciones from anon;
drop policy if exists "delivery_ubicaciones_write_operativo" on public.delivery_ubicaciones;
drop policy if exists "delivery_ubicaciones read" on public.delivery_ubicaciones;
create policy "delivery_ubicaciones read" on public.delivery_ubicaciones for select to authenticated
  using (
    repartidor_id = (select auth.uid())
    or (select public.is_admin())
    or (select public.puede_modulo('delivery', 'full'))
  );
drop policy if exists "delivery_ubicaciones insert propia" on public.delivery_ubicaciones;
create policy "delivery_ubicaciones insert propia" on public.delivery_ubicaciones for insert to authenticated
  with check (repartidor_id = (select auth.uid()) and (select public.delivery_puede('escritura')));
drop policy if exists "delivery_ubicaciones update propia" on public.delivery_ubicaciones;
create policy "delivery_ubicaciones update propia" on public.delivery_ubicaciones for update to authenticated
  using (repartidor_id = (select auth.uid()))
  with check (repartidor_id = (select auth.uid()) and (select public.delivery_puede('escritura')));
-- Sin delete: la fila se pisa (delivery_ubicar hace upsert). Realtime ya estaba
-- (una fila por delivery: barato); el tiempo real respeta esta misma RLS.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'delivery_ubicaciones') then
    alter publication supabase_realtime add table public.delivery_ubicaciones;
  end if;
end $$;

-- 2b) Recorrido de cada pedido (pedido de la administradora, 03-11: en «Pedidos por
--     delivery» se abre el detalle con la ruta). Una muestra cada ~60 s (o al moverse
--     más de 150 m) mientras el delivery comparte su ubicación con un pedido en curso.
--     Lo llena un trigger sobre delivery_ubicaciones (no se toca delivery_ubicar).
create table if not exists public.delivery_ubicaciones_hist (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.delivery_pedidos(id) on delete cascade,
  repartidor_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  precision_m double precision,
  registrado_en timestamptz not null default now()
);
create index if not exists delivery_ubicaciones_hist_pedido_idx on public.delivery_ubicaciones_hist (pedido_id, registrado_en);
alter table public.delivery_ubicaciones_hist enable row level security;
revoke all on public.delivery_ubicaciones_hist from anon;
revoke insert, update, delete on public.delivery_ubicaciones_hist from authenticated;
drop policy if exists "delivery_ubicaciones_hist read" on public.delivery_ubicaciones_hist;
create policy "delivery_ubicaciones_hist read" on public.delivery_ubicaciones_hist for select to authenticated
  using (
    repartidor_id = (select auth.uid())
    or (select public.is_admin())
    or (select public.puede_modulo('delivery', 'full'))
  );
-- Sin insert/update/delete para usuarios: solo escribe el trigger. No va a realtime.

create or replace function public.delivery_ubicaciones_muestrear() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ult public.delivery_ubicaciones_hist;
begin
  if new.pedido_id is null then return new; end if;
  -- Solo mientras el pedido sigue en curso y es de este delivery.
  if not exists (select 1 from public.delivery_pedidos d
                  where d.id = new.pedido_id and d.repartidor_id = new.repartidor_id and d.estado in ('aceptado', 'en_ruta')) then
    return new;
  end if;
  select * into v_ult from public.delivery_ubicaciones_hist
   where pedido_id = new.pedido_id order by registrado_en desc limit 1;
  if v_ult.id is null
     or now() - v_ult.registrado_en >= interval '55 seconds'
     or (now() - v_ult.registrado_en >= interval '10 seconds'
         and 2 * 6371000 * asin(least(1, sqrt(
               power(sin(radians(new.lat - v_ult.lat) / 2), 2)
               + cos(radians(v_ult.lat)) * cos(radians(new.lat)) * power(sin(radians(new.lng - v_ult.lng) / 2), 2)))) > 150) then
    insert into public.delivery_ubicaciones_hist (pedido_id, repartidor_id, lat, lng, precision_m)
    values (new.pedido_id, new.repartidor_id, new.lat, new.lng, new.precision_m);
  end if;
  return new;
end $$;
revoke all on function public.delivery_ubicaciones_muestrear() from public, anon, authenticated;
drop trigger if exists trg_delivery_ubicaciones_muestrear on public.delivery_ubicaciones;
create trigger trg_delivery_ubicaciones_muestrear
  after insert or update of lat, lng, actualizado_en on public.delivery_ubicaciones
  for each row execute function public.delivery_ubicaciones_muestrear();

-- 3) Almacenes de entrega. Matanza = Zona Industrial Matanzas (aproximada);
--    Los Pinos sin coordenadas hasta que la administradora lo ubique.
insert into public.config (key, value, updated_by, updated_at)
values ('delivery.destinos', jsonb_build_object(
  'LOS PINOS', jsonb_build_object('lat', null, 'lng', null, 'aproximada', true),
  'MATANZA', jsonb_build_object('lat', 8.2905, 'lng', -62.8290, 'aproximada', true)
), 'sistema', now())
on conflict (key) do nothing;

create or replace function public.delivery_destinos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.delivery_puede('lectura') or public.puede_modulo('proveedores', 'lectura')) then
    raise exception 'No tienes permiso en Delivery.' using errcode = '42501';
  end if;
  return coalesce((select value from public.config where key = 'delivery.destinos'), '{}'::jsonb);
end $$;

create or replace function public.delivery_destino_guardar(
  p_clave text, p_lat double precision, p_lng double precision
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_val jsonb;
begin
  if not (public.is_admin() or public.puede_modulo('delivery', 'full')) then
    raise exception 'Solo quien supervisa Delivery puede ubicar los almacenes.' using errcode = '42501';
  end if;
  if p_clave not in ('LOS PINOS', 'MATANZA') then
    raise exception 'Almacén de entrega inválido: %.', p_clave using errcode = '23514';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Ubicación inválida.' using errcode = '23514';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  insert into public.config (key, value, updated_by, updated_at)
  values ('delivery.destinos', '{}'::jsonb, coalesce(v_email, 'sistema'), now())
  on conflict (key) do nothing;
  update public.config
     set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(p_clave,
           jsonb_build_object('lat', p_lat, 'lng', p_lng, 'aproximada', false, 'por', v_email, 'en', now())),
         updated_by = coalesce(v_email, 'sistema'), updated_at = now()
   where key = 'delivery.destinos'
  returning value into v_val;
  return v_val;
end $$;

create or replace function public.delivery_ubicar_proveedor(
  p_proveedor_id uuid, p_lat double precision, p_lng double precision
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_prov public.proveedores; v_pleno boolean;
begin
  v_pleno := public.is_admin() or public.puede_modulo('proveedores', 'escritura') or public.puede_modulo('delivery', 'full');
  select * into v_prov from public.proveedores where id = p_proveedor_id for update;
  if v_prov.id is null then raise exception 'No se encontró el proveedor.' using errcode = '23503'; end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Ubicación inválida.' using errcode = '23514';
  end if;
  if p_lat is not null and (abs(p_lat) > 90 or abs(p_lng) > 180) then
    raise exception 'Ubicación inválida.' using errcode = '23514';
  end if;
  if not v_pleno then
    -- El delivery solo puede marcar un proveedor SIN ubicación, de un pedido suyo en curso.
    if not public.delivery_puede('escritura') then
      raise exception 'No tienes permiso para ubicar proveedores.' using errcode = '42501';
    end if;
    if p_lat is null then
      raise exception 'Solo Proveedores o quien supervisa Delivery puede quitar la ubicación.' using errcode = '42501';
    end if;
    if v_prov.lat is not null then
      raise exception 'Ese proveedor ya está ubicado; para moverlo pídelo a Compras o a quien supervisa Delivery.' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.delivery_pedidos d join public.ordenes o on o.id = d.orden_id
       where d.repartidor_id = auth.uid() and d.tipo = 'oc' and d.estado in ('aceptado', 'en_ruta')
         and o.proveedor_id = p_proveedor_id
    ) then
      raise exception 'Solo puedes ubicar al proveedor de un pedido que tienes en curso.' using errcode = '42501';
    end if;
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  update public.proveedores set
    lat = p_lat, lng = p_lng,
    ubicado_en = case when p_lat is null then null else now() end,
    ubicado_por = case when p_lat is null then null else v_email end,
    updated_at = now()
  where id = p_proveedor_id;
end $$;

revoke all on function public.delivery_destinos() from public, anon;
revoke all on function public.delivery_destino_guardar(text, double precision, double precision) from public, anon;
revoke all on function public.delivery_ubicar_proveedor(uuid, double precision, double precision) from public, anon;
grant execute on function public.delivery_destinos() to authenticated;
grant execute on function public.delivery_destino_guardar(text, double precision, double precision) to authenticated;
grant execute on function public.delivery_ubicar_proveedor(uuid, double precision, double precision) to authenticated;

-- Verificación
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proveedores' and column_name in ('lat', 'lng', 'ubicado_en', 'ubicado_por')) as cols_proveedor,
  (select string_agg(policyname, ', ' order by policyname) from pg_policies where tablename = 'delivery_ubicaciones') as politicas_ubicaciones,
  (select relrowsecurity from pg_class where oid = 'public.delivery_ubicaciones'::regclass) as rls_ubicaciones,
  (select relrowsecurity from pg_class where oid = 'public.delivery_ubicaciones_hist'::regclass) as rls_hist,
  exists (select 1 from pg_trigger where tgname = 'trg_delivery_ubicaciones_muestrear') as trigger_hist,
  (select count(*) from pg_proc where proname in ('delivery_destinos', 'delivery_destino_guardar', 'delivery_ubicar_proveedor')) as rpcs,
  exists (select 1 from public.config where key = 'delivery.destinos') as cfg_destinos;
