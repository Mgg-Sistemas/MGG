-- ============================================================
-- MGG · Inventario · el motivo de un movimiento manual
-- Aplicado en producción el 2026-09-09.
--
-- Una entrada, una salida, un consumo o un ajuste cargados a mano son los
-- únicos movimientos que cambian el stock SIN un documento detrás. La regla
-- vive en tres capas: el formulario (MovimientoForm), el repositorio
-- (registrarMovimiento) y esta restricción, que es la que no se puede saltar.
--
-- NOT VALID a propósito: los 411 movimientos históricos sin motivo se
-- conservan tal cual. No se inventa historia; la regla rige de acá en adelante.
-- ============================================================

begin;

-- Respaldo en la base de la regla «un movimiento manual necesita motivo».
-- NOT VALID a propósito: los 410 movimientos viejos sin motivo se conservan tal
-- cual (no se inventa historia); la regla rige de acá en adelante.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'movimientos_manual_con_motivo') then
    raise exception 'La restricción movimientos_manual_con_motivo ya existe.';
  end if;
end $$;

alter table movimientos
  add constraint movimientos_manual_con_motivo
  check (
    coalesce(ref_tipo, 'manual') <> 'manual'
    or tipo not in ('entrada', 'salida', 'ajuste', 'consumo')
    or (length(btrim(coalesce(detalle, ''))) >= 5 and btrim(coalesce(detalle, '')) ~ '[[:alpha:]]')
  ) not valid;

-- Comprobación: la restricción quedó y sigue siendo NOT VALID (no tocó lo viejo).
do $$
declare v boolean;
begin
  select convalidated into v from pg_constraint where conname = 'movimientos_manual_con_motivo';
  if v is null then raise exception 'No se creó la restricción.'; end if;
  if v then raise exception 'Quedó validada: habría tocado los movimientos históricos.'; end if;
end $$;

commit;
