/* ============================================================
   MGG · Retenciones · El libro tiene DOS direcciones — 21/09/2026

   Lo que faltaba: una retención no siempre la practica la empresa. En la
   realidad de MGG pasa casi siempre al revés — es el CLIENTE el que retiene
   cuando nos paga. Y las dos cosas no significan lo mismo:

   · NOS LA PRACTICARON (recibida)  → es un ANTICIPO de impuesto a favor: se
     descuenta de lo que toca pagar en la declaración. Plata nuestra adelantada.
   · LA PRACTICAMOS (practicada)    → es plata de un tercero que la empresa
     retuvo y debe ENTERAR al fisco. Deuda, no activo.

   El IGTF no es ninguna de las dos: se paga y no se recupera. Es costo.

   Por eso el libro guarda ahora `direccion`, y `estado` para saber qué ya se
   declaró. Y como la contraparte puede ser un cliente (no solo un proveedor),
   las columnas `proveedor_*` pasan a llamarse `contraparte_*`.

   EL RENOMBRE ES GRATIS: la tabla está en cero. La guarda de abajo aborta si
   alguien cargó algo mientras tanto, para no perder una sola fila.
   ============================================================ */
begin;

do $$
declare n int;
begin
  select count(*) into n from public.retenciones;
  if n > 0 then
    raise exception 'La tabla retenciones ya tiene % filas: renombrar columnas exige migrar los datos primero.', n;
  end if;
end $$;

/* ── 1) La contraparte puede ser cliente o proveedor ──────────────────── */
alter table public.retenciones rename column proveedor_id      to contraparte_id;
alter table public.retenciones rename column proveedor_rif     to contraparte_rif;
alter table public.retenciones rename column proveedor_nombre  to contraparte_nombre;
alter table public.retenciones rename column proveedor_sujeto  to contraparte_sujeto;

/* ── 2) Dirección y estado ────────────────────────────────────────────── */
alter table public.retenciones
  add column if not exists direccion    text not null default 'recibida',
  add column if not exists estado       text not null default 'registrada',
  add column if not exists declarada_en timestamptz,
  add column if not exists declarada_por text,
  add column if not exists observacion  text;

alter table public.retenciones drop constraint if exists retenciones_direccion_check;
alter table public.retenciones add constraint retenciones_direccion_check
  check (direccion in ('recibida', 'practicada'));

alter table public.retenciones drop constraint if exists retenciones_estado_check;
alter table public.retenciones add constraint retenciones_estado_check
  check (estado in ('registrada', 'declarada'));

/* ── 3) El documento de origen puede ser una venta, o no existir ──────── */
alter table public.retenciones drop constraint if exists retenciones_doc_kind_check;
alter table public.retenciones add constraint retenciones_doc_kind_check
  check (doc_kind in ('oc', 'compra_directa', 'servicio_directo', 'venta', 'manual'));
alter table public.retenciones alter column doc_id drop not null;

/* ── 4) El correlativo único es SOLO el nuestro ───────────────────────────
   El número de un comprobante que nos entregan lo puso otra empresa: dos
   clientes distintos pueden mandar el mismo número sin que eso sea un error.
   Único de verdad es el que emite MGG.                                      */
alter table public.retenciones drop constraint if exists retenciones_numero_comprobante_key;
drop index if exists public.retenciones_numero_propio_idx;
create unique index retenciones_numero_propio_idx
  on public.retenciones (numero_comprobante)
  where direccion = 'practicada' and numero_comprobante is not null;

/* ── 5) Índices del libro ─────────────────────────────────────────────── */
create index if not exists retenciones_direccion_fecha_idx
  on public.retenciones (direccion, factura_fecha desc);
create index if not exists retenciones_periodo_idx
  on public.retenciones (periodo, tipo);

commit;

select direccion, estado, count(*) from public.retenciones group by 1, 2;
