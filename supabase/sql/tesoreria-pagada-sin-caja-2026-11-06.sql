-- MGG · Tesorería · OC pagada SIN descontar de caja (06-11-2026)
-- Se marca pagada con un motivo (p. ej. la pagó otra empresa / un tercero / ya estaba pagada
-- fuera del sistema). No crea movimiento de caja; sigue el flujo de siempre (delivery, recepción).
alter table public.ordenes add column if not exists pago_sin_caja_motivo text;
comment on column public.ordenes.pago_sin_caja_motivo is
  'Si no es null, la OC se marcó pagada sin descontar saldo de ninguna caja (06-11-2026); el motivo lo escribe Tesorería.';
