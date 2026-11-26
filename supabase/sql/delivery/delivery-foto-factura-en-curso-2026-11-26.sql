-- ============================================================
-- MGG · Delivery · foto de la factura con el pedido EN CURSO (26/11/2026)
--
-- El celular ya tenia el grupo «Factura del proveedor» en el modal, pero no
-- aparecia mientras el pedido estaba aceptado/en_ruta porque:
--   1) delivery_fotos rechazaba p_tipo = 'factura';
--   2) no existia la RPC de lectura delivery_fotos_factura;
--   3) el trigger de sincronia no escuchaba fotos_factura.
--
-- Aditivo: solo CREATE OR REPLACE de funciones y del trigger. No se INSERTAN,
-- UPDATEAN ni BORRAN filas ni archivos. Las definiciones anteriores quedaron
-- respaldadas en C:\Users\Usuario\AppData\Local\Temp\opencode\def_*_20261126.*.
-- ============================================================

begin;

  alter table public.delivery_pedidos
    add column if not exists fotos_factura jsonb not null default '[]'::jsonb;

  comment on column public.delivery_pedidos.fotos_factura is
    'Fotos de la factura del proveedor, cargadas desde el celular con el pedido en curso o al editar uno entregado. [{path, filename}]';

  -- ----------------------------------------------------------
  -- 1) Pedido abierto: recibo, entrega y AHORA tambien factura
  -- ----------------------------------------------------------
  create or replace function public.delivery_fotos(
    p_pedido_id uuid, p_tipo text, p_fotos jsonb
  ) returns public.delivery_pedidos
  language plpgsql security definer set search_path = '' as $fn$
  declare
    v_d public.delivery_pedidos;
    f jsonb;
    v_email text;
  begin
    if not public.delivery_puede('escritura') then
      raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
    end if;
    if p_tipo not in ('recibo', 'entrega', 'factura') then
      raise exception 'Tipo de foto inválido.' using errcode = '23514';
    end if;
    if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) > 6 then
      raise exception 'Se pueden adjuntar hasta 6 fotos.' using errcode = '23514';
    end if;
    for f in select x from jsonb_array_elements(p_fotos) x loop
      if jsonb_typeof(f) <> 'object'
         or coalesce(f ->> 'path', '') not like p_pedido_id::text || '/' || p_tipo || '-%'
         or position('..' in coalesce(f ->> 'path', '')) > 0 then
        raise exception 'La foto % no corresponde a este pedido.', coalesce(f ->> 'path', '?') using errcode = '23514';
      end if;
    end loop;
    select * into v_d from public.delivery_pedidos where id = p_pedido_id for update;
    if v_d.id is null then
      raise exception 'No se encontró el pedido.' using errcode = '23503';
    end if;
    if v_d.estado not in ('aceptado', 'en_ruta') then
      raise exception 'Solo se pueden cargar fotos de un pedido en curso; si ya fue entregado usa la edición de fotos.' using errcode = 'P0001';
    end if;
    if v_d.repartidor_id <> auth.uid()
       and not (public.is_admin()
                or public.puede_modulo(
                     case when v_d.flota = 'carga_pesada' then 'carga_pesada' else 'delivery' end,
                     'full')) then
      raise exception 'Solo quien tomó el pedido puede subir sus fotos.' using errcode = '42501';
    end if;

    if p_tipo = 'factura' then
      select email into v_email from public.usuarios where id = auth.uid();
    end if;

    update public.delivery_pedidos set
      fotos_recibo = case when p_tipo = 'recibo' then p_fotos else fotos_recibo end,
      fotos_entrega = case when p_tipo = 'entrega' then p_fotos else fotos_entrega end,
      fotos_factura = case when p_tipo = 'factura' then p_fotos else fotos_factura end,
      historial = case when p_tipo = 'factura' then
        coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'at', now(), 'evento', 'fotos_factura', 'actor', coalesce(v_email, 'delivery'),
          'motivo', 'Foto de la factura cargada con el pedido en curso'))
        else historial end,
      updated_at = now()
    where id = p_pedido_id
    returning * into v_d;
    return v_d;
  end $fn$;

  revoke all on function public.delivery_fotos(uuid, text, jsonb) from public, anon;
  grant execute on function public.delivery_fotos(uuid, text, jsonb) to authenticated;

  -- ----------------------------------------------------------
  -- 2) Lectura de la factura que el front ya intentaba usar
  -- ----------------------------------------------------------
  create or replace function public.delivery_fotos_factura(p_pedido_ids uuid[])
  returns table (pedido_id uuid, fotos_factura jsonb)
  language plpgsql stable security definer set search_path = '' as $fn$
  begin
    if not (public.is_admin() or public.delivery_puede('lectura')) then
      raise exception 'No tienes permiso para ver estas fotos.' using errcode = '42501';
    end if;
    return query
      select d.id, coalesce(d.fotos_factura, '[]'::jsonb)
        from public.delivery_pedidos d
       where d.id = any(p_pedido_ids);
  end $fn$;

  revoke all on function public.delivery_fotos_factura(uuid[]) from public, anon;
  grant execute on function public.delivery_fotos_factura(uuid[]) to authenticated;

  -- ----------------------------------------------------------
  -- 3) Compras ve la factura del proveedor (antes solo veia el recibo)
  -- ----------------------------------------------------------
  create or replace function public.sync_fotos_delivery_a_orden(p_orden_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_nuevo jsonb;
  begin
    if p_orden_id is null then return; end if;

    select coalesce(jsonb_agg(f order by f ->> 'n'), '[]'::jsonb) into v_nuevo
    from (
      select jsonb_build_object(
               'path', v.x ->> 'path',
               'filename', coalesce(v.x ->> 'filename', 'foto.jpg'),
               'tipo', 'factura',
               'quien', v.repartidor_nombre,
               'pedido_id', v.pedido_id,
               'n', v.orden || v.creado || lpad(v.k::text, 3, '0')
             ) as f
      from (
        -- Factura del proveedor (grupo nuevo): fuente preferida.
        select d.id as pedido_id, d.repartidor_nombre, d.created_at::text as creado,
               e.x as x, e.k as k, '0' as orden
          from public.delivery_pedidos d,
               jsonb_array_elements(coalesce(d.fotos_factura, '[]'::jsonb)) with ordinality as e(x, k)
         where d.orden_id = p_orden_id
           and e.x ->> 'path' is not null
        union all
        -- Historico: antes la factura se subia como «foto al recibir».
        select d.id, d.repartidor_nombre, d.created_at::text,
               e.x, e.k, '1'
          from public.delivery_pedidos d,
               jsonb_array_elements(coalesce(d.fotos_recibo, '[]'::jsonb)) with ordinality as e(x, k)
         where d.orden_id = p_orden_id
           and e.x ->> 'path' is not null
           and jsonb_array_length(coalesce(d.fotos_factura, '[]'::jsonb)) = 0
      ) v
    ) s;

    update public.ordenes set facturas_delivery = v_nuevo
     where id = p_orden_id
       and facturas_delivery is distinct from v_nuevo;
  end $fn$;

  revoke all on function public.sync_fotos_delivery_a_orden(uuid) from public, anon;

  -- El trigger anterior no escuchaba fotos_factura: por eso Compras no veia
  -- la factura aunque el delivery ya la hubiera cargado.
  drop trigger if exists trg_fotos_delivery_a_orden on public.delivery_pedidos;
  create trigger trg_fotos_delivery_a_orden
    after insert or delete
       or update of fotos_recibo, fotos_factura, orden_id, repartidor_nombre
    on public.delivery_pedidos
    for each row execute function public.trg_fn_fotos_delivery_a_orden();

commit;

-- Verificación (solo lectura):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='delivery_pedidos'
--       and column_name='fotos_factura') as columna,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='delivery_fotos_factura') as rpc_lectura,
--   (select pg_get_triggerdef(t.oid) from pg_trigger t
--      join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
--     where n.nspname='public' and c.relname='delivery_pedidos'
--       and t.tgname='trg_fotos_delivery_a_orden' and not t.tgisinternal) as trigger;
