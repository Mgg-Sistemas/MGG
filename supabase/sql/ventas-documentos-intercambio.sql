/* Ventas (18-09-2026): nota de entrega, IVA/IGTF con casilla, pago con material
   (intercambio), edición después de emitir y trazabilidad.
   La tabla estaba vacía al aplicarlo: no hay datos que migrar. */
alter table public.ventas
  add column if not exists tipo_documento text not null default 'factura',
  add column if not exists aplica_iva boolean not null default false,
  add column if not exists aplica_igtf boolean not null default false,
  add column if not exists igtf_pct numeric not null default 0,
  add column if not exists igtf_monto numeric not null default 0,
  add column if not exists pago_material jsonb not null default '[]'::jsonb,
  add column if not exists valor_material numeric not null default 0,
  add column if not exists cobrado_caja numeric not null default 0,
  add column if not exists historial jsonb not null default '[]'::jsonb,
  add column if not exists anulada_en timestamptz,
  add column if not exists anulada_por text,
  add column if not exists motivo_anulacion text;

do $$ begin
  alter table public.ventas add constraint ventas_tipo_documento_chk
    check (tipo_documento in ('factura','nota_entrega'));
exception when duplicate_object then null; end $$;

alter table public.ventas drop constraint if exists ventas_condicion_pago_chk;
alter table public.ventas add constraint ventas_condicion_pago_chk
  check (condicion_pago is null or condicion_pago in ('contado','credito','intercambio'));

-- Un correlativo (FAC-… / NE-…) no se repite.
create unique index if not exists ux_ventas_numero on public.ventas(numero);
