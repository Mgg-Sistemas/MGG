-- ============================================================
-- MGG · Delivery · solo las compras pagadas desde el 03-11-2026 (02-11-2026)
--
-- Orden de la administradora: «en el módulo de delivery SOLO MUESTRA LAS
-- COMPRAS PAGADAS A PARTIR DEL 03/11». Las OC pagadas antes no quedan «por
-- tomar» (ni se pueden tomar). Lo que un delivery ya tomó sigue a su cargo.
-- El retiro en Los Pinos arranca el mismo día (SP revisadas desde el 03-11).
-- ============================================================
do $$
declare v_def text; v_viejo text;
begin
  -- 1) Listado: «por tomar» de OC solo si se pagó desde el 03-11.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_pedidos_listado';
  if position('pagada_en >= timestamptz ''2026-11-03 00:00:00-04''' in v_def) = 0 then
    v_viejo := '(v_on and o.estado = ''pagada'' and o.recibida_en is null and (v.id is null or v.estado = ''cancelado''))';
    if position(v_viejo in v_def) = 0 then raise exception 'delivery_pedidos_listado: no se encontró «por tomar» de OC'; end if;
    v_def := replace(v_def, v_viejo,
      '(v_on and o.estado = ''pagada'' and o.recibida_en is null and o.pagada_en >= timestamptz ''2026-11-03 00:00:00-04'' and (v.id is null or v.estado = ''cancelado''))');
    execute v_def;
  end if;

  -- 2) Tomar: la misma regla.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_tomar';
  if position('2026-11-03 00:00:00-04' in v_def) = 0 then
    v_viejo := 'if v_tipo = ''oc'' and (v_o.estado <> ''pagada'' or v_o.recibida_en is not null) then';
    if position(v_viejo in v_def) = 0 then raise exception 'delivery_tomar: no se encontró la validación de OC'; end if;
    execute replace(v_def, v_viejo,
      'if v_tipo = ''oc'' and (v_o.estado <> ''pagada'' or v_o.recibida_en is not null or coalesce(v_o.pagada_en, ''-infinity'') < timestamptz ''2026-11-03 00:00:00-04'') then');
  end if;
end $$;

-- 3) Retiro en Los Pinos: desde el 03-11.
create or replace function public.delivery_retiro_disponible(o public.ordenes) returns boolean
language sql stable set search_path = '' as $$
  select o.revisada_almacen_en is not null
     and o.revisada_almacen_en >= timestamptz '2026-11-03 00:00:00-04'
     and o.estado not in ('anulada', 'cancelada', 'rechazada', 'desistida_proveedor')
     and jsonb_array_length(public.delivery_items_retiro(o.items)) > 0;
$$;

select
  (select pg_get_functiondef(p.oid) like '%pagada_en >= timestamptz ''2026-11-03 00:00:00-04''%' from pg_proc p where p.proname = 'delivery_pedidos_listado') as listado,
  (select pg_get_functiondef(p.oid) like '%2026-11-03 00:00:00-04%' from pg_proc p where p.proname = 'delivery_tomar') as tomar,
  (select count(*) from public.ordenes o where o.estado = 'pagada' and o.recibida_en is null and o.pagada_en >= timestamptz '2026-11-03 00:00:00-04') as oc_desde_0311;
