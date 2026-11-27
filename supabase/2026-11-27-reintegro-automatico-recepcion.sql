begin;

alter table public.compras_reintegros
  add column if not exists generado_por_recepcion boolean not null default false;
create unique index if not exists reintegro_recepcion_unico
  on public.compras_reintegros(orden_id) where generado_por_recepcion;

-- La recepción por PC y por teléfono escribe la misma OC. El reintegro forma
-- parte de esa escritura y queda disponible para Compras y Tesorería.
create or replace function public.compras_reintegro_al_recibir()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  indice bigint;
  faltante numeric;
  solicitado numeric;
  precio numeric;
  importe numeric := 0;
  detalle jsonb := '[]'::jsonb;
begin
  if coalesce(new.clase, 'producto') <> 'producto' then return null; end if;

  for item, indice in
    select x, n - 1 from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) with ordinality as t(x,n)
  loop
    -- Los históricos sin cantidad recibida explícita conservan su significado.
    if item->>'cantidad_recibida' is null then continue; end if;
    faltante := greatest(0, (item->>'cantidad')::numeric - (item->>'cantidad_recibida')::numeric);
    if faltante <= 0 then continue; end if;

    -- Respeta reintegros que Compras haya solicitado antes de la recepción.
    select coalesce(sum((d->>'cantidad')::numeric), 0) into solicitado
      from public.compras_reintegros r
      cross join lateral jsonb_array_elements(r.detalle) d
     where r.orden_id = new.id and (d->>'indice')::bigint = indice;
    faltante := greatest(0, faltante - solicitado);
    if faltante <= 0 then continue; end if;

    precio := coalesce(nullif(item->>'precio','')::numeric, 0);
    if coalesce(new.pago_en_divisa, false) and coalesce(nullif(item->>'precio_usd','')::numeric, 0) > 0 then
      precio := (item->>'precio_usd')::numeric;
    end if;
    importe := importe + faltante * precio;
    detalle := detalle || jsonb_build_array(jsonb_build_object(
      'indice', indice, 'sku', item->>'sku', 'nombre', item->>'nombre',
      'cantidad', faltante, 'precio_unitario', precio));
  end loop;

  -- Los renglones sin costo no generan una devolución de dinero.
  if round(importe, 2) <= 0 then return null; end if;
  insert into public.compras_reintegros(
    orden_id, detalle, monto, moneda, motivo, created_by, generado_por_recepcion
  ) values (
    new.id, detalle, round(importe, 2), coalesce(nullif(new.moneda,''), 'USD'),
    'Faltantes registrados al confirmar la recepción de ' || coalesce(new.oc_codigo,new.codigo)
      || coalesce(' · ' || nullif(trim(new.nota_recepcion),''),''),
    coalesce(new.recibida_por, auth.jwt()->>'email', 'sistema'), true
  ) on conflict (orden_id) where generado_por_recepcion do nothing;
  return null;
end $$;

revoke all on function public.compras_reintegro_al_recibir() from public;
drop trigger if exists trg_compras_reintegro_al_recibir on public.ordenes;
create trigger trg_compras_reintegro_al_recibir
  after update of items, recibida_en on public.ordenes
  for each row when (old.recibida_en is null and new.recibida_en is not null)
  execute function public.compras_reintegro_al_recibir();

commit;
