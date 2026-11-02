-- ============================================================
-- MGG · Delivery · la OC ya recibida no le sale al delivery (02-11-2026)
--
-- Regla de la administradora: si Compras ya pagó y RECIBIÓ la orden, al
-- delivery ya no le debe salir. «Por tomar» ya lo exigía (recibida_en null);
-- ahora tampoco se muestra en curso (aceptada / en camino) una OC que
-- Compras recibió por su lado. El retiro en Los Pinos no cambia.
-- (Cuando el delivery la entrega, la recibe él mismo en inventario: front.)
-- ============================================================
do $$
declare v_def text; v_viejo text; v_pos int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_pedidos_listado';
  -- La PRIMERA aparición es la rama de las OC (la segunda es la del retiro).
  v_viejo := 'or (v.id is not null and v.estado in (''aceptado'', ''en_ruta'') and (v.repartidor_id = v_uid or v_super))';
  v_pos := position(v_viejo in v_def);
  if v_pos = 0 then raise exception 'delivery_pedidos_listado: no se encontró la rama en curso'; end if;
  if position('o.recibida_en is null and (v.repartidor_id = v_uid or v_super)' in v_def) > 0 then
    raise notice 'ya aplicado';
    return;
  end if;
  v_def := substr(v_def, 1, v_pos - 1)
        || 'or (v.id is not null and v.estado in (''aceptado'', ''en_ruta'') and o.recibida_en is null and (v.repartidor_id = v_uid or v_super))'
        || substr(v_def, v_pos + length(v_viejo));
  execute v_def;
end $$;

select pg_get_functiondef(p.oid) like '%o.recibida_en is null and (v.repartidor_id = v_uid or v_super)%' as oc_recibida_oculta
from pg_proc p where p.proname = 'delivery_pedidos_listado';
