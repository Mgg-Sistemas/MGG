-- ============================================================
-- MGG · La ficha del producto se recalcula SOLA desde sus existencias (09-11-2026)
--
-- Caso: el 08-11 la cocina de Los Pinos editó COC-2026-0629. Al volver a descontar,
-- el último víver (PLATANO) bajó la existencia de Los Pinos a 0 pero se cortó antes
-- de recalcular la ficha (productos.stock quedó en 5). Esos 5 salían como «Sin sede»
-- en «Valor del inventario». El recálculo lo hacía el navegador en un paso aparte
-- (recomputeProductoAgg); si se cortaba la señal, la ficha quedaba desfasada.
--
-- Ahora lo hace la base, en la MISMA transacción que cambia la existencia: no se
-- puede guardar una existencia sin que la ficha quede al día: stock = Σ existencias.
-- El PRECIO no se toca acá (lo sigue recalculando el front al mover): hay precios
-- fijados a mano (p. ej. casiterita 18,74) que no se deben pisar. Solo escribe si
-- cambió algo (no mueve updated_at ni dispara realtime de gusto).
-- ============================================================

create or replace function public.productos_agg_desde_existencias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_stock numeric;
begin
  if tg_op = 'DELETE' then
    v_ids := array[old.producto_id];
  elsif tg_op = 'UPDATE' and new.producto_id is distinct from old.producto_id then
    v_ids := array[old.producto_id, new.producto_id];
  else
    v_ids := array[new.producto_id];
  end if;

  foreach v_id in array v_ids loop
    continue when v_id is null;
    select coalesce(sum(coalesce(stock, 0)), 0) into v_stock
      from existencias where producto_id = v_id;

    update productos p
       set stock = v_stock
     where p.id = v_id
       and p.stock is distinct from v_stock;
  end loop;
  return null;
end;
$$;

revoke all on function public.productos_agg_desde_existencias() from public, anon, authenticated;

drop trigger if exists trg_productos_agg_desde_existencias on public.existencias;
create trigger trg_productos_agg_desde_existencias
  after insert or delete or update of stock, producto_id on public.existencias
  for each row execute function public.productos_agg_desde_existencias();
