-- ============================================================
-- MGG · Tesorería · Cotejo del crédito CD-2026-0006 (15-10-2026) · APLICADO
--
-- La compra directa CD-2026-0006 (DISTRIBUIDORA EL TORETE J&M, C.A · carne para
-- la cocina de Los Pinos · 1.504,80 $ · a crédito, acordado en USDT) generó la
-- cuenta por pagar aa0c2027-… el 02-07-2026. El pago SÍ salió de caja el
-- 17-07-2026 (mov. 8b6e044c-…: salida de 1.504 USDT de la caja USDT, «PAGO CARNE
-- GALPÓN LOS PINOS DEL 30-6-26»), pero se cargó como GASTO suelto y no como
-- abono del crédito, por lo que la cuenta quedó «abierta» y Tesorería la seguía
-- mostrando como pendiente. Regla: no se mueve caja otra vez ni se borra nada;
-- se vincula el egreso existente como abono y la cuenta pasa a saldada.
-- Diferencia de 0,80 $ entre el crédito (1.504,80) y el pago (1.504): redondeo.
-- ============================================================
begin;
insert into cuentas_por_pagar_abonos (cuenta_id, monto, moneda, caja_id, cuenta, caja_mov_id, saldo_restante, nota, actor, actor_name, at)
values ('aa0c2027-2112-44c8-85ca-4c17ca101586', 1504.80, 'USD', '6690c234-47a4-4066-97b6-3070c7b647c6', 'general', '8b6e044c-1f12-4561-a7a4-966e9c0de77f', 0,
  'Cotejo 15-10-2026 (administración): el crédito CD-2026-0006 se pagó el 17-07-2026 con el egreso de 1.504 USDT «PAGO CARNE GALPÓN LOS PINOS DEL 30-6-26» cargado como gasto suelto; se vincula ese egreso sin mover caja. Diferencia 0,80 $ por redondeo del pago.',
  'admin@gmail.com', 'Administración', '2026-07-17 03:36:58.456389+00');
update cuentas_por_pagar
   set abonado = 1504.80, estado = 'saldada',
       caja_id = '6690c234-47a4-4066-97b6-3070c7b647c6', caja_mov_id = '8b6e044c-1f12-4561-a7a4-966e9c0de77f',
       updated_at = now()
 where id = 'aa0c2027-2112-44c8-85ca-4c17ca101586' and estado = 'abierta';
commit;
