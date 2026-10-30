-- ============================================================
-- MGG · Delivery (30-10-2026)
--
-- La OC que Compras cotizó, Tesorería pagó (estado `pagada`), Retenciones retuvo
-- (si la OC lo espera: ordenes.retencion_momento) y todavía no
-- se recibió, pasa a Delivery: un motorizado la TOMA (solo uno: la base no
-- deja que otro la tome), la marca EN RUTA y la ENTREGA en el almacén, con
-- fotos al recibirla del proveedor y al entregarla. Si no puede buscarla, la
-- CANCELA con motivo y la OC vuelve a quedar disponible para otro.
-- Los motorizados comparten su ubicación; la PC la ve en el mapa.
-- ============================================================

create table if not exists public.delivery_pedidos (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes(id),
  estado text not null default 'aceptado' check (estado in ('aceptado', 'en_ruta', 'entregado', 'cancelado')),
  repartidor_id uuid not null,
  repartidor_email text,
  repartidor_nombre text,
  aceptado_en timestamptz not null default now(),
  en_ruta_en timestamptz,
  entregado_en timestamptz,
  cancelado_en timestamptz,
  motivo_cancel text,
  detalle_cancel text,
  almacen_entrega text,
  nota_entrega text,
  fotos_recibo jsonb not null default '[]'::jsonb,
  fotos_entrega jsonb not null default '[]'::jsonb,
  historial jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- UNA sola toma viva por OC: si un delivery ya la tomó, nadie más puede.
create unique index if not exists delivery_pedidos_una_viva on public.delivery_pedidos (orden_id) where estado <> 'cancelado';
create index if not exists delivery_pedidos_repartidor_idx on public.delivery_pedidos (repartidor_id, estado);

create table if not exists public.delivery_ubicaciones (
  repartidor_id uuid primary key,
  repartidor_email text,
  repartidor_nombre text,
  lat double precision not null,
  lng double precision not null,
  precision_m double precision,
  velocidad double precision,
  rumbo double precision,
  pedido_id uuid references public.delivery_pedidos(id) on delete set null,
  actualizado_en timestamptz not null default now()
);

-- INTERRUPTOR: el módulo existe pero NO recibe OC hasta que la administradora
-- lo conecte (config compras.delivery = {"activo": true}).
insert into public.config (key, value, updated_by, updated_at)
values ('compras.delivery', '{"activo": false}'::jsonb, 'sistema', now())
on conflict (key) do nothing;

create or replace function public.delivery_conectado() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value->>'activo')::boolean from public.config where key = 'compras.delivery'), false);
$$;
revoke all on function public.delivery_conectado() from public, anon;
grant execute on function public.delivery_conectado() to authenticated;

alter table public.delivery_pedidos enable row level security;
alter table public.delivery_ubicaciones enable row level security;
revoke all on public.delivery_pedidos from anon;
revoke all on public.delivery_ubicaciones from anon;

create or replace function public.delivery_puede(p_nivel text default 'lectura') returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.puede_modulo('delivery', p_nivel) or public.puede_modulo('delivery', 'escritura');
$$;

drop policy if exists "delivery_pedidos read" on public.delivery_pedidos;
create policy "delivery_pedidos read" on public.delivery_pedidos for select to authenticated
  using ((select public.delivery_puede('lectura')) or (select public.puede_modulo('pedidos', 'lectura')));
-- Sin insert/update directos: todo pasa por las funciones de abajo.

drop policy if exists "delivery_ubicaciones read" on public.delivery_ubicaciones;
create policy "delivery_ubicaciones read" on public.delivery_ubicaciones for select to authenticated
  using ((select public.delivery_puede('lectura')));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'delivery_pedidos') then
    alter publication supabase_realtime add table public.delivery_pedidos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'delivery_ubicaciones') then
    alter publication supabase_realtime add table public.delivery_ubicaciones;
  end if;
end $$;

-- Nombre visible de un usuario (nombre + apellido, o el correo).
create or replace function public.delivery_nombre_usuario(p_email text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')), ''), p_email)
  from public.usuarios u where lower(u.email) = lower(p_email) limit 1;
$$;

-- Los pedidos que ve un delivery: las OC pagadas sin recibir que nadie tomó,
-- más las suyas (y, para quien supervisa, todas las tomadas).
create or replace function public.delivery_pedidos_listado(p_incluir_cerrados boolean default false)
returns table (
  orden_id uuid, oc_codigo text, codigo text, total numeric, moneda text, urgente boolean, pagada_en timestamptz,
  items jsonb, notas text, motivo text, finalidad text, almacen_destino text,
  proveedor_id uuid, proveedor_nombre text, proveedor_telefono text, proveedor_direccion text, proveedor_contacto text,
  analista_email text, analista_nombre text, analista_telefono text,
  pedido_id uuid, estado text, repartidor_id uuid, repartidor_nombre text, aceptado_en timestamptz, en_ruta_en timestamptz,
  entregado_en timestamptz, cancelado_en timestamptz, motivo_cancel text, detalle_cancel text, almacen_entrega text,
  nota_entrega text, fotos_recibo jsonb, fotos_entrega jsonb, historial jsonb, es_mio boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_super boolean;
begin
  if not public.delivery_puede('lectura') then
    raise exception 'No tienes permiso en Delivery.' using errcode = '42501';
  end if;
  v_super := public.is_admin() or public.puede_modulo('delivery', 'full');
  return query
  with vivos as (
    select distinct on (d.orden_id) d.* from public.delivery_pedidos d
    order by d.orden_id, (d.estado <> 'cancelado') desc, d.created_at desc
  )
  select o.id, o.oc_codigo, o.codigo, o.total, coalesce(o.moneda, 'USD'), coalesce(o.urgente, false), o.pagada_en,
         o.items, o.notas, o.motivo, o.finalidad, o.almacen_destino,
         p.id, p.razon_social, p.telefono, p.direccion, p.contacto,
         coalesce(o.oc_creada_por, o.aprobada_por),
         public.delivery_nombre_usuario(coalesce(o.oc_creada_por, o.aprobada_por)),
         (select u.telefono from public.usuarios u where lower(u.email) = lower(coalesce(o.oc_creada_por, o.aprobada_por)) limit 1),
         v.id, coalesce(v.estado, 'por_tomar'), v.repartidor_id, v.repartidor_nombre, v.aceptado_en, v.en_ruta_en,
         v.entregado_en, v.cancelado_en, v.motivo_cancel, v.detalle_cancel, v.almacen_entrega, v.nota_entrega,
         coalesce(v.fotos_recibo, '[]'::jsonb), coalesce(v.fotos_entrega, '[]'::jsonb), coalesce(v.historial, '[]'::jsonb),
         (v.repartidor_id = v_uid)
  from public.ordenes o
  left join public.proveedores p on p.id = o.proveedor_id
  left join vivos v on v.orden_id = o.id
  where coalesce(o.clase, 'producto') <> 'servicio'
    and o.oc_codigo is not null
    and (
      -- disponible: pagada, sin recibir, y sin toma viva
      (public.delivery_conectado() and o.estado = 'pagada' and o.recibida_en is null and (o.retencion_momento is null or o.retencion_hecha_en is not null) and (v.id is null or v.estado = 'cancelado'))
      -- en curso: la toma viva (del delivery, o todas para quien supervisa)
      or (v.id is not null and v.estado in ('aceptado', 'en_ruta') and (v.repartidor_id = v_uid or v_super or public.delivery_puede('lectura')))
      -- cerrados (histórico)
      or (p_incluir_cerrados and v.id is not null and v.estado in ('entregado', 'cancelado'))
    )
  order by coalesce(o.urgente, false) desc, o.pagada_en asc nulls last;
end $$;

-- TOMAR un pedido: solo si está pagado, sin recibir y nadie lo tiene.
create or replace function public.delivery_tomar(p_orden_id uuid) returns public.delivery_pedidos
language plpgsql security definer set search_path = '' as $$
declare v_o public.ordenes; v_ya public.delivery_pedidos; v_fila public.delivery_pedidos; v_email text; v_nombre text;
begin
  if not public.delivery_puede('escritura') then
    raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
  end if;
  if not public.delivery_conectado() then
    raise exception 'Delivery todavía no está conectado a Compras.' using errcode = 'P0001';
  end if;
  select * into v_o from public.ordenes where id = p_orden_id for update;
  if v_o.id is null then raise exception 'No se encontró la orden.' using errcode = '23503'; end if;
  if v_o.estado <> 'pagada' or v_o.recibida_en is not null or not (v_o.retencion_momento is null or v_o.retencion_hecha_en is not null) then
    raise exception 'La orden % ya no está disponible para delivery (estado: %).', coalesce(v_o.oc_codigo, v_o.codigo), v_o.estado using errcode = 'P0001';
  end if;
  select * into v_ya from public.delivery_pedidos where orden_id = p_orden_id and estado <> 'cancelado' limit 1;
  if v_ya.id is not null then
    raise exception 'Este pedido ya lo tomó %.', coalesce(v_ya.repartidor_nombre, v_ya.repartidor_email, 'otro delivery') using errcode = 'P0001';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  v_nombre := public.delivery_nombre_usuario(v_email);
  insert into public.delivery_pedidos (orden_id, repartidor_id, repartidor_email, repartidor_nombre, historial)
  values (p_orden_id, auth.uid(), v_email, v_nombre,
    jsonb_build_array(jsonb_build_object('at', now(), 'evento', 'aceptado', 'actor', v_email)))
  returning * into v_fila;
  return v_fila;
exception when unique_violation then
  raise exception 'Este pedido ya lo tomó otro delivery.' using errcode = 'P0001';
end $$;

-- Avanzar: en_ruta → entregado, o cancelar (con motivo). Solo el que lo tomó
-- (o quien supervisa con full / admin).
create or replace function public.delivery_avanzar(
  p_pedido_id uuid, p_estado text, p_motivo text default null, p_detalle text default null,
  p_almacen text default null, p_nota text default null
) returns public.delivery_pedidos
language plpgsql security definer set search_path = '' as $$
declare v_d public.delivery_pedidos; v_email text; v_ok boolean;
begin
  if not public.delivery_puede('escritura') then
    raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
  end if;
  select * into v_d from public.delivery_pedidos where id = p_pedido_id for update;
  if v_d.id is null then raise exception 'No se encontró el pedido.' using errcode = '23503'; end if;
  if v_d.repartidor_id <> auth.uid() and not (public.is_admin() or public.puede_modulo('delivery', 'full')) then
    raise exception 'Este pedido lo tiene %: solo él puede moverlo.', coalesce(v_d.repartidor_nombre, v_d.repartidor_email) using errcode = '42501';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  v_ok := (v_d.estado = 'aceptado' and p_estado in ('en_ruta', 'cancelado'))
       or (v_d.estado = 'en_ruta' and p_estado in ('entregado', 'cancelado'));
  if not v_ok then
    raise exception 'No se puede pasar de % a %.', v_d.estado, p_estado using errcode = 'P0001';
  end if;
  if p_estado = 'cancelado' and char_length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Indica el motivo por el que no se puede buscar el pedido.' using errcode = '23514';
  end if;
  update public.delivery_pedidos set
    estado = p_estado,
    en_ruta_en = case when p_estado = 'en_ruta' then now() else en_ruta_en end,
    entregado_en = case when p_estado = 'entregado' then now() else entregado_en end,
    cancelado_en = case when p_estado = 'cancelado' then now() else cancelado_en end,
    motivo_cancel = case when p_estado = 'cancelado' then btrim(p_motivo) else motivo_cancel end,
    detalle_cancel = case when p_estado = 'cancelado' then nullif(btrim(coalesce(p_detalle, '')), '') else detalle_cancel end,
    almacen_entrega = case when p_estado = 'entregado' then nullif(btrim(coalesce(p_almacen, '')), '') else almacen_entrega end,
    nota_entrega = case when p_estado = 'entregado' then nullif(btrim(coalesce(p_nota, '')), '') else nota_entrega end,
    historial = historial || jsonb_build_array(jsonb_build_object('at', now(), 'evento', p_estado, 'actor', v_email,
      'motivo', nullif(btrim(coalesce(p_motivo, '')), ''))),
    updated_at = now()
  where id = p_pedido_id
  returning * into v_d;
  return v_d;
end $$;

-- Fotos ya subidas al bucket: al recibir del proveedor (recibo) o al entregar (entrega).
create or replace function public.delivery_fotos(p_pedido_id uuid, p_tipo text, p_fotos jsonb) returns public.delivery_pedidos
language plpgsql security definer set search_path = '' as $$
declare v_d public.delivery_pedidos;
begin
  if not public.delivery_puede('escritura') then
    raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
  end if;
  if p_tipo not in ('recibo', 'entrega') then raise exception 'Tipo de foto inválido.' using errcode = '23514'; end if;
  if jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) > 6 then
    raise exception 'Se pueden adjuntar hasta 6 fotos.' using errcode = '23514';
  end if;
  select * into v_d from public.delivery_pedidos where id = p_pedido_id for update;
  if v_d.id is null then raise exception 'No se encontró el pedido.' using errcode = '23503'; end if;
  if v_d.repartidor_id <> auth.uid() and not (public.is_admin() or public.puede_modulo('delivery', 'full')) then
    raise exception 'Solo el delivery que tomó el pedido puede subir sus fotos.' using errcode = '42501';
  end if;
  update public.delivery_pedidos set
    fotos_recibo = case when p_tipo = 'recibo' then p_fotos else fotos_recibo end,
    fotos_entrega = case when p_tipo = 'entrega' then p_fotos else fotos_entrega end,
    updated_at = now()
  where id = p_pedido_id returning * into v_d;
  return v_d;
end $$;

-- El motorizado comparte su ubicación (una fila por motorizado, se pisa).
create or replace function public.delivery_ubicar(
  p_lat double precision, p_lng double precision, p_precision double precision default null,
  p_velocidad double precision default null, p_rumbo double precision default null, p_pedido_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if not public.delivery_puede('escritura') then
    raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Ubicación inválida.' using errcode = '23514';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  insert into public.delivery_ubicaciones (repartidor_id, repartidor_email, repartidor_nombre, lat, lng, precision_m, velocidad, rumbo, pedido_id, actualizado_en)
  values (auth.uid(), v_email, public.delivery_nombre_usuario(v_email), p_lat, p_lng, p_precision, p_velocidad, p_rumbo, p_pedido_id, now())
  on conflict (repartidor_id) do update set
    lat = excluded.lat, lng = excluded.lng, precision_m = excluded.precision_m, velocidad = excluded.velocidad,
    rumbo = excluded.rumbo, pedido_id = excluded.pedido_id, repartidor_nombre = excluded.repartidor_nombre,
    repartidor_email = excluded.repartidor_email, actualizado_en = now();
end $$;

revoke all on function public.delivery_puede(text) from public, anon;
revoke all on function public.delivery_nombre_usuario(text) from public, anon;
revoke all on function public.delivery_pedidos_listado(boolean) from public, anon;
revoke all on function public.delivery_tomar(uuid) from public, anon;
revoke all on function public.delivery_avanzar(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.delivery_fotos(uuid, text, jsonb) from public, anon;
revoke all on function public.delivery_ubicar(double precision, double precision, double precision, double precision, double precision, uuid) from public, anon;
grant execute on function public.delivery_puede(text) to authenticated;
grant execute on function public.delivery_nombre_usuario(text) to authenticated;
grant execute on function public.delivery_pedidos_listado(boolean) to authenticated;
grant execute on function public.delivery_tomar(uuid) to authenticated;
grant execute on function public.delivery_avanzar(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.delivery_fotos(uuid, text, jsonb) to authenticated;
grant execute on function public.delivery_ubicar(double precision, double precision, double precision, double precision, double precision, uuid) to authenticated;

-- Bucket privado de fotos (recibo del proveedor y entrega en almacén).
insert into storage.buckets (id, name, public) values ('delivery-fotos', 'delivery-fotos', false)
on conflict (id) do nothing;
drop policy if exists "delivery-fotos read" on storage.objects;
create policy "delivery-fotos read" on storage.objects for select to authenticated
  using (bucket_id = 'delivery-fotos' and ((select public.delivery_puede('lectura')) or (select public.puede_modulo('pedidos', 'lectura'))));
drop policy if exists "delivery-fotos write" on storage.objects;
create policy "delivery-fotos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-fotos' and (select public.delivery_puede('escritura')));

select
  (select count(*) from pg_class where relname in ('delivery_pedidos', 'delivery_ubicaciones') and relrowsecurity) as rls,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('delivery_pedidos', 'delivery_ubicaciones')) as realtime,
  exists (select 1 from storage.buckets where id = 'delivery-fotos') as bucket;
