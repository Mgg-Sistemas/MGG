-- ============================================================
-- MGG · Corrección de la recepción DUPLICADA de la OC-2026-0182 (SP-2026-0180-1)
-- (11-11-2026). La compra entró dos veces (CARLOS 10-11 08:37 y NAZARET
-- 10-11 09:17). Se revierte la segunda entrada con un AJUSTE por producto en
-- el almacén General (Matanzas): queda en el kardex con su motivo. La ficha
-- sigue a existencias por el trigger trg_productos_agg_desde_existencias.
-- Idempotente: no repite si ya existe el ajuste.
-- ============================================================
do $$
declare d record; v_ex numeric; n int := 0;
begin
  for d in
    select m.id, m.producto_id, m.delta, m.almacen, m.precio_unitario, m.costo_promedio, m.ref_id, m.ref_codigo
      from movimientos m join ordenes o on o.id::text = m.ref_id
     where o.oc_codigo = 'OC-2026-0182' and m.tipo = 'entrada' and m.ref_tipo = 'orden'
       and coalesce(m.actor_name, m.actor) = 'NAZARET'
  loop
    if exists (select 1 from movimientos x where x.ref_tipo = 'correccion' and x.ref_id = d.id::text) then continue; end if;
    select stock into v_ex from existencias where producto_id = d.producto_id and almacen = d.almacen for update;
    insert into movimientos(producto_id, tipo, delta, stock_antes, stock_despues, actor, actor_name,
      ref_tipo, ref_id, ref_codigo, almacen, precio_unitario, costo_promedio, detalle)
    values (d.producto_id, 'ajuste', -d.delta, coalesce(v_ex,0), coalesce(v_ex,0) - d.delta, 'sistema', 'CORRECCIÓN DUPLICADO',
      'correccion', d.id::text, d.ref_codigo, d.almacen, d.precio_unitario, d.costo_promedio,
      'Reverso de recepción DUPLICADA de la OC-2026-0182 (' || d.ref_codigo || '): la recibió NAZARET el 10-11 09:17 después de que CARLOS ya la había recibido a las 08:37. Se quita lo que entró de más.');
    update existencias set stock = coalesce(v_ex,0) - d.delta, updated_at = now()
     where producto_id = d.producto_id and almacen = d.almacen;
    n := n + 1;
  end loop;
  raise notice 'ajustes: %', n;
end $$;

select p.sku, p.stock ficha, (select sum(stock) from existencias e where e.producto_id = p.id) existencias
  from productos p where p.id::text in (select m.producto_id::text from movimientos m join ordenes o on o.id::text = m.ref_id where o.oc_codigo = 'OC-2026-0182')
 order by p.sku;
