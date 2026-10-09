/* Cocina (09-10-2026): una comida no puede descontar más de lo que hay.
   Solo las SALIDAS de consumo de cocina (ref_tipo = 'cocina', delta < 0). Los reversos
   (delta > 0), recepciones, ajustes, salidas manuales y traslados no entran acá.
   Por qué: COC-2026-0443 (06/10) pidió 700 de pimentón con 4,5 en Los Pinos; el
   front topeó en cero y la comida quedó con 700 anotados. El libro del mercado y el
   almacén se separaron en 695,5 de un solo golpe.
   Aplicado en producción como migración `cocina_guardia_consumo_sin_negativo`. */
create or replace function public.mgg_guardia_consumo_cocina()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_stock numeric;
  v_nombre text;
begin
  if coalesce(new.ref_tipo, '') <> 'cocina' or coalesce(new.delta, 0) >= 0 then
    return new;
  end if;
  select stock into v_stock
    from public.existencias
   where producto_id = new.producto_id and almacen = new.almacen
   limit 1;
  if coalesce(v_stock, 0) + new.delta < -0.005 then
    select nombre into v_nombre from public.productos where id = new.producto_id;
    raise exception 'Cocina: «%» no alcanza en %: hay % y la comida pide %. Corregí la cantidad o registrá primero la entrada. Si la pantalla es vieja, recargá.',
      coalesce(v_nombre, new.producto_id::text), coalesce(new.almacen, '—'),
      round(coalesce(v_stock, 0), 2), round(-new.delta, 2)
      using errcode = 'P0001';
  end if;
  return new;
end $$;

comment on function public.mgg_guardia_consumo_cocina() is
  'Cocina (09-10-2026): rechaza una salida de consumo de cocina (ref_tipo=cocina, delta<0) que dejaría la existencia del almacén en negativo. Reversos, recepciones, ajustes y traslados no se tocan.';

create or replace trigger trg_guardia_consumo_cocina
  before insert on public.movimientos
  for each row execute function public.mgg_guardia_consumo_cocina();
