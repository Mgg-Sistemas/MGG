-- ============================================================
-- MGG · Delivery · la OC con retiro CONFIRMADO por Compras llega al delivery
-- aunque se haya pagado antes del 03-11-2026 (10-11-2026)
--
-- Caso: SP-2026-0200 / OC-2026-0201 se pagó el 29-10 (antes del corte del
-- delivery) y no daba la opción de mandarla al delivery. Desde el 06-11 cada
-- OC pagada espera que Compras confirme el retiro: esa confirmación es la
-- puerta, así que el corte por fecha de pago ya no hace falta para ellas.
-- Regla nueva: pagada desde el 03-11  O  con retiro confirmado.
-- ============================================================
do $$
declare v_def text; v_viejo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_pedidos_listado';
  v_viejo := 'o.pagada_en >= timestamptz ''2026-11-03 00:00:00-04''';
  if position('or o.retiro_confirmado_en is not null) and' in v_def) = 0 then
    if position(v_viejo in v_def) = 0 then raise exception 'delivery_pedidos_listado: no se encontró el corte'; end if;
    execute replace(v_def, v_viejo,
      '(o.pagada_en >= timestamptz ''2026-11-03 00:00:00-04'' or o.retiro_confirmado_en is not null)');
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_tomar';
  v_viejo := 'coalesce(v_o.pagada_en, ''-infinity'') < timestamptz ''2026-11-03 00:00:00-04''';
  if position('and v_o.retiro_confirmado_en is null)' in v_def) = 0 then
    if position(v_viejo in v_def) = 0 then raise exception 'delivery_tomar: no se encontró el corte'; end if;
    execute replace(v_def, v_viejo,
      '(coalesce(v_o.pagada_en, ''-infinity'') < timestamptz ''2026-11-03 00:00:00-04'' and v_o.retiro_confirmado_en is null)');
  end if;
end $$;

select
  (select pg_get_functiondef(p.oid) like '%or o.retiro_confirmado_en is not null)%' from pg_proc p where p.proname = 'delivery_pedidos_listado') as listado,
  (select pg_get_functiondef(p.oid) like '%and v_o.retiro_confirmado_en is null)%' from pg_proc p where p.proname = 'delivery_tomar') as tomar;
