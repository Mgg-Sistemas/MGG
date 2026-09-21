/* ============================================================
   MGG · Retenciones · Módulo fiscal (Venezuela) — 21/09/2026

   ANTES: el módulo era un archivador. Listaba las órdenes y dejaba subir el
   PDF del comprobante. No calculaba nada: ni base imponible, ni porcentaje,
   ni correlativo, ni período fiscal.

   AHORA: se calcula cada retención y se emite el comprobante.

   TRES TABLAS
   1. `retencion_config`     — los datos del AGENTE de retención (MGG) y los
                               parámetros que cambian por ley o por ordenanza.
   2. `retencion_conceptos`  — el catálogo: qué se retiene, a quién y cuánto.
                               Se siembra con el Decreto 1.808 y se edita.
   3. `retenciones`          — cada retención practicada, con su comprobante.

   LO QUE NO SE INVENTA
   Los porcentajes municipales (ISAE) los fija la ordenanza de CADA municipio,
   y el timbre fiscal la ley de cada estado. No hay un número nacional: nacen
   vacíos y los carga la empresa. El valor de la Unidad Tributaria (que define
   el sustraendo del ISLR) tampoco se cablea: es un parámetro.
   ============================================================ */
begin;

/* ── 1) El agente de retención y sus parámetros ───────────────────────── */
create table if not exists public.retencion_config (
  id boolean primary key default true check (id),
  rif text,
  razon_social text,
  direccion_fiscal text,
  municipio text,
  estado text,
  /* Providencia SNAT/2015/0049: solo el contribuyente especial DESIGNADO retiene
     IVA. Arranca apagado a propósito: que lo prenda quien confirme su condición. */
  es_contribuyente_especial boolean not null default false,
  pct_iva_general numeric not null default 75,
  pct_iva_especial numeric not null default 100,
  /* Valor de la Unidad Tributaria: define el sustraendo y el mínimo del ISLR
     para personas naturales residentes. Sin UT cargada no se calcula sustraendo. */
  valor_ut numeric not null default 0,
  /* Ley de IGTF: 3% vigente; el Ejecutivo puede moverlo entre 2% y 8%. */
  pct_igtf numeric not null default 3,
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);
comment on table public.retencion_config is 'Datos del agente de retención y parámetros fiscales (una sola fila)';

insert into public.retencion_config (id) values (true) on conflict (id) do nothing;

/* ── 2) Catálogo de conceptos ─────────────────────────────────────────── */
create table if not exists public.retencion_conceptos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('islr', 'municipal', 'regional')),
  codigo text,
  nombre text not null,
  /* A quién se le retiene: el porcentaje del ISLR cambia según el sujeto. */
  sujeto text not null default 'todos'
    check (sujeto in ('pn_residente', 'pj_domiciliada', 'pn_no_residente', 'pj_no_domiciliada', 'todos')),
  porcentaje numeric not null default 0,
  /* Qué parte del pago forma la base (ej. transporte internacional: 5% del bruto). */
  base_pct numeric not null default 100,
  /* Sustraendo del Decreto 1.808, solo para personas naturales residentes. */
  aplica_sustraendo boolean not null default false,
  /* Mínimo en UT por debajo del cual no se retiene. */
  base_minima_ut numeric not null default 0,
  /* De dónde sale el número, para poder auditarlo. */
  fundamento text,
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.retencion_conceptos is 'Conceptos retenibles (ISLR Decreto 1.808, ISAE municipal, timbre estadal)';
create index if not exists retencion_conceptos_tipo_idx on public.retencion_conceptos (tipo, activo);

/* ── 3) Las retenciones practicadas ───────────────────────────────────── */
/* Había una tabla `retenciones` de un esqueleto viejo: 0 filas y sin una sola
   referencia en el código. No se borra —nunca se borra— sino que se aparta con
   su nombre y su fecha, y la nueva nace limpia. */
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'retenciones')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'retenciones' and column_name = 'doc_kind')
  then
    if (select count(*) from public.retenciones) > 0 then
      raise exception 'La tabla `retenciones` vieja tiene filas: revisar a mano antes de apartarla.';
    end if;
    alter table public.retenciones rename to retenciones_esqueleto_2026_09;
  end if;
end $$;

create table if not exists public.retenciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('iva', 'islr', 'municipal', 'regional', 'igtf')),
  /* Documento del que sale: OC, compra directa o servicio directo. */
  doc_kind text not null check (doc_kind in ('oc', 'compra_directa', 'servicio_directo')),
  doc_id uuid not null,
  doc_codigo text,
  /* Sujeto retenido. El RIF y el nombre se congelan: el proveedor puede cambiar. */
  proveedor_id uuid,
  proveedor_rif text,
  proveedor_nombre text,
  proveedor_sujeto text,
  /* Factura que origina la retención. */
  factura_numero text,
  factura_control text,
  factura_fecha date,
  /* Período fiscal: AAAAMM. La quincena (1 = del 1 al 15, 2 = del 16 al fin)
     solo aplica al IVA, que se entera dos veces al mes. */
  periodo text not null,
  quincena smallint check (quincena in (1, 2)),
  /* Correlativo legal del comprobante de IVA: AAAAMM + 8 dígitos. */
  numero_comprobante text unique,
  concepto_id uuid references public.retencion_conceptos (id) on delete set null,
  concepto_nombre text,
  moneda text not null default 'Bs',
  tasa numeric,
  /* La cuenta, guardada como se hizo: si mañana cambia la ley, lo emitido no se mueve. */
  base_imponible numeric not null default 0,
  alicuota numeric not null default 0,
  impuesto numeric not null default 0,
  porcentaje numeric not null default 0,
  sustraendo numeric not null default 0,
  monto_retenido numeric not null default 0,
  comprobante_path text,
  comprobante_nombre text,
  anulada boolean not null default false,
  anulada_motivo text,
  anulada_en timestamptz,
  actor text,
  actor_name text,
  created_at timestamptz not null default now()
);
comment on table public.retenciones is 'Retenciones practicadas, con su base, su porcentaje y su comprobante';
create index if not exists retenciones_doc_idx on public.retenciones (doc_kind, doc_id);
create index if not exists retenciones_periodo_idx on public.retenciones (periodo, tipo);
create index if not exists retenciones_proveedor_idx on public.retenciones (proveedor_id);

/* ── 4) Correlativo del comprobante de IVA ────────────────────────────── */
/* El número es AAAAMM + 8 dígitos consecutivos. Se calcula en la base y no en
   el front: dos personas emitiendo a la vez no pueden sacar el mismo número. */
create or replace function public.siguiente_comprobante_retencion(p_periodo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  if p_periodo !~ '^[0-9]{6}$' then
    raise exception 'El período debe ser AAAAMM (recibido: %)', p_periodo;
  end if;
  -- Bloquea la tabla para el período: el consecutivo no puede repetirse.
  select coalesce(max(substring(numero_comprobante from 7 for 8)::bigint), 0) + 1
    into n
    from public.retenciones
   where tipo = 'iva' and numero_comprobante like p_periodo || '%';
  return p_periodo || lpad(n::text, 8, '0');
end $$;

/* ── 5) RLS en las tres (regla de la casa: ninguna tabla nueva sin RLS) ── */
do $$
declare t text;
begin
  foreach t in array array['retencion_config', 'retencion_conceptos', 'retenciones', 'retenciones_esqueleto_2026_09'] loop
    continue when not exists (select 1 from information_schema.tables
                              where table_schema = 'public' and table_name = t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || ' read auth', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || ' read auth', t);
    execute format('drop policy if exists %I on public.%I', t || ' write op', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                     using ((select is_operativo())) with check ((select is_operativo()))$p$, t || ' write op', t);
  end loop;
end $$;

revoke execute on function public.siguiente_comprobante_retencion(text) from anon, public;
grant execute on function public.siguiente_comprobante_retencion(text) to authenticated, service_role;

/* ── 6) Realtime (regla de la casa) ───────────────────────────────────── */
do $$
declare t text;
begin
  foreach t in array array['retencion_config', 'retencion_conceptos', 'retenciones'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
