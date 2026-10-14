-- ============================================================
-- MGG · Rendimiento (14-10-2026) · medido, no a ojo
-- 1) Realtime: 19 tablas estaban en la publicación sin que ninguna pantalla se
--    suscriba a ellas (tasa_cambio con 1.591 escrituras y config con 340 eran las
--    calientes). Cada escritura en ellas hacía trabajar al servidor de realtime
--    para nadie. Se sacan de la publicación; los datos no se tocan.
-- 2) Llaves foráneas sin índice en las tablas con más filas (advisor de Supabase):
--    los joins y los borrados en cascada recorrían la tabla completa.
-- Idempotente. No borra datos.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'tasa_cambio', 'config', 'retencion_conceptos', 'retencion_config', 'caja_lotes', 'combustible_movimientos',
    'producto_presentaciones_proveedor', 'salidas_choferes', 'salidas_vehiculos', 'abonos_credito',
    'cuentas_por_pagar_ingresos', 'acopio_catalogos', 'transferencias_casiterita_inter', 'retenciones_esqueleto_2026_09',
    'recepcion_cierres', 'acopio_hojas_excel', 'webauthn_credentials', 'acopio_destinos_traslado', 'facturas'
  ] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

create index if not exists idx_movimientos_proveedor on public.movimientos (proveedor_id);
create index if not exists idx_movimientos_caja_mineral_mov on public.movimientos_caja (mineral_mov_id);
create index if not exists idx_movimientos_caja_mineral_producto on public.movimientos_caja (mineral_producto_id);
create index if not exists idx_movimientos_caja_ref_caja on public.movimientos_caja (ref_caja_id);
create index if not exists idx_cocina_comidas_cocina on public.cocina_comidas (cocina_id);
create index if not exists idx_solicitudes_salida_caja_destino on public.solicitudes_salida (caja_destino_id);
create index if not exists idx_solicitudes_salida_caja on public.solicitudes_salida (caja_id);
create index if not exists idx_solicitudes_salida_cliente on public.solicitudes_salida (cliente_id);
create index if not exists idx_solicitudes_salida_producto on public.solicitudes_salida (producto_id);
create index if not exists idx_ordenes_credito_cxp on public.ordenes (credito_cxp_id);
create index if not exists idx_nomina_renglones_caja on public.nomina_renglones (caja_id);
create index if not exists idx_nomina_renglones_caja_mov on public.nomina_renglones (caja_mov_id);
create index if not exists idx_compras_directas_caja on public.compras_directas (caja_id);
create index if not exists idx_compras_directas_credito_cxp on public.compras_directas (credito_cxp_id);
create index if not exists idx_compras_directas_producto on public.compras_directas (producto_id);
create index if not exists idx_compras_directas_proveedor on public.compras_directas (proveedor_id);

-- Cotejo:
-- select count(*) from pg_publication_tables where pubname = 'supabase_realtime';  -- 148 → 129
