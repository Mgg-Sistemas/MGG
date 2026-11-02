-- ============================================================
-- MGG · Delivery · aceptar = EN CAMINO, «No disponible» con motivo (02-11-2026)
--
-- Regla de la administradora: en el pedido por tomar el delivery ve el
-- comprobante de pago y dos botones: ACEPTAR o NO DISPONIBLE.
--  · Aceptar lo deja directo «en camino» (en_ruta) y ya NO le aparece a
--    ningún otro delivery (solo al que lo aceptó y a quien supervisa).
--  · No disponible pide motivo (sale el WhatsApp) y el pedido sigue libre.
-- Se edita la definición VIVA del listado y de tomar (incluye el retiro en
-- Los Pinos de delivery-retiro-almacen-2026-11-02.sql).
-- ============================================================
do $$
declare v_def text; v_viejo text; v_nuevo text;
begin
  -- 1) Listado: lo tomado (en curso o cerrado) lo ve solo su delivery o quien supervisa.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_pedidos_listado';
  v_viejo := '(v.repartidor_id = v_uid or v_super or public.delivery_puede(''lectura''))';
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 2 then
    raise exception 'delivery_pedidos_listado: se esperaban 2 condiciones de en curso';
  end if;
  v_def := replace(v_def, v_viejo, '(v.repartidor_id = v_uid or v_super)');
  v_viejo := 'or (p_incluir_cerrados and v.id is not null and v.estado in (''entregado'', ''cancelado''))';
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 2 then
    raise exception 'delivery_pedidos_listado: se esperaban 2 condiciones de cerrados';
  end if;
  v_def := replace(v_def, v_viejo, 'or (p_incluir_cerrados and v.id is not null and v.estado in (''entregado'', ''cancelado'') and (v.repartidor_id = v_uid or v_super))');
  execute v_def;

  -- 2) Tomar: nace «en camino».
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_tomar';
  v_viejo := 'insert into public.delivery_pedidos (orden_id, tipo, repartidor_id, repartidor_email, repartidor_nombre, historial)
  values (p_orden_id, v_tipo, auth.uid(), v_email, v_nombre,
    jsonb_build_array(jsonb_build_object(''at'', now(), ''evento'', ''aceptado'', ''actor'', v_email,
      ''tipo'', v_tipo)))';
  v_nuevo := 'insert into public.delivery_pedidos (orden_id, tipo, estado, en_ruta_en, repartidor_id, repartidor_email, repartidor_nombre, historial)
  values (p_orden_id, v_tipo, ''en_ruta'', now(), auth.uid(), v_email, v_nombre,
    jsonb_build_array(jsonb_build_object(''at'', now(), ''evento'', ''aceptado'', ''actor'', v_email, ''tipo'', v_tipo),
                      jsonb_build_object(''at'', now(), ''evento'', ''en_ruta'', ''actor'', v_email)))';
  if position(v_viejo in v_def) = 0 then raise exception 'delivery_tomar: no se encontró el insert esperado'; end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;

-- 3) No disponible: el delivery no puede con el pedido por tomar. Queda registrado
--    (cancelado con su motivo, a nombre de quien lo marcó) y el pedido sigue libre.
create or replace function public.delivery_no_disponible(
  p_orden_id uuid, p_tipo text default 'oc', p_motivo text default null, p_detalle text default null
) returns public.delivery_pedidos
language plpgsql security definer set search_path = '' as $$
declare v_o public.ordenes; v_ya public.delivery_pedidos; v_fila public.delivery_pedidos; v_email text;
  v_tipo text := coalesce(nullif(btrim(p_tipo), ''), 'oc');
begin
  if not public.delivery_puede('escritura') then
    raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
  end if;
  if v_tipo not in ('oc', 'retiro_almacen') then raise exception 'Tipo de pedido inválido.' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Indica el motivo por el que no está disponible.' using errcode = '23514';
  end if;
  select * into v_o from public.ordenes where id = p_orden_id;
  if v_o.id is null then raise exception 'No se encontró la orden.' using errcode = '23503'; end if;
  select * into v_ya from public.delivery_pedidos where orden_id = p_orden_id and tipo = v_tipo and estado <> 'cancelado' limit 1;
  if v_ya.id is not null then
    raise exception 'Este pedido ya lo tomó %.', coalesce(v_ya.repartidor_nombre, v_ya.repartidor_email, 'otro delivery') using errcode = 'P0001';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  insert into public.delivery_pedidos (orden_id, tipo, estado, repartidor_id, repartidor_email, repartidor_nombre,
    cancelado_en, motivo_cancel, detalle_cancel, historial)
  values (p_orden_id, v_tipo, 'cancelado', auth.uid(), v_email, public.delivery_nombre_usuario(v_email),
    now(), btrim(p_motivo), nullif(btrim(coalesce(p_detalle, '')), ''),
    jsonb_build_array(jsonb_build_object('at', now(), 'evento', 'no_disponible', 'actor', v_email, 'motivo', btrim(p_motivo))))
  returning * into v_fila;
  return v_fila;
end $$;
revoke all on function public.delivery_no_disponible(uuid, text, text, text) from public, anon;
grant execute on function public.delivery_no_disponible(uuid, text, text, text) to authenticated;

select
  (select pg_get_functiondef(p.oid) like '%(v.repartidor_id = v_uid or v_super)%' from pg_proc p where p.proname = 'delivery_pedidos_listado') as solo_suyo,
  (select pg_get_functiondef(p.oid) like '%''en_ruta'', now()%' from pg_proc p where p.proname = 'delivery_tomar') as nace_en_camino,
  (select count(*) from pg_proc where proname = 'delivery_no_disponible') as no_disponible;
