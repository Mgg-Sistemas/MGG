-- ============================================================
-- MGG · Retenciones · Facturas externas y vista de teléfono (29-10-2026)
--
-- Permite que personas fuera de la oficina (rol 'facturas') carguen facturas
-- de compras externas desde la vista de teléfono, señalando la empresa
-- correspondiente (MGG, Golden Touch, MineriaTs / MTO, etc.), adjuntando
-- hasta 4 fotos y 1 o 2 PDF.
--
-- En oficina, el personal de retenciones / impuestos escucha una notificación
-- con sonido distintivo al recibir o cambiar estatus de cada factura, pudiendo
-- compartir el resumen por WhatsApp y gestionar retenciones de otras empresas
-- de forma totalmente aislada sin afectar a Mineral Group Guayana.
--
-- 100% alineado con el esquema multi-empresa y buzón de Golden Touch (GT).
-- Idempotente.
-- ============================================================

-- 1. Catálogo editable de empresas receptoras con ficha fiscal completa (1:1 con GT)
create table if not exists public.retencion_empresas_receptoras (
  id                         text primary key,
  clave                      text not null unique,
  nombre                     text not null,
  nombre_corto               text,
  rif                        text not null,
  color_badge                text not null default '#64748b',
  activo                     boolean not null default true,
  orden                      int not null default 10,
  
  -- Domicilio e información fiscal (para Retención / Impuestos)
  email                      text,
  telefono                   text,
  direccion_fiscal           text,
  municipio                  text,
  estado                     text,
  licencia_municipal         text,

  -- Régimen y condición de agente
  es_agente_iva              boolean not null default true,
  es_contribuyente_especial  boolean not null default false,
  retiene_islr               boolean not null default true,
  retiene_municipal          boolean not null default false,
  pct_iva_general            numeric(5,2) not null default 75,
  imprimir_original_y_copia  boolean not null default true,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- Semilla inicial de empresas
insert into public.retencion_empresas_receptoras (
  id, clave, nombre, nombre_corto, rif, color_badge, orden,
  municipio, estado, es_agente_iva, es_contribuyente_especial, retiene_islr
)
values
  ('empresa-mgg', 'mgg', 'Mineral Group Guayana C.A.', 'MGG', 'J-50221930-7', '#2563eb', 1, 'Caroní', 'Bolívar', true, true, true),
  ('empresa-golden-touch', 'golden_touch', 'Golden Touch 1127 C.A.', 'Golden Touch', 'J-50129993-5', '#eab308', 2, 'Caroní', 'Bolívar', true, true, true),
  ('empresa-mineria-ts', 'mineria_ts', 'Minería TS C.A.', 'Minería TS / MTO', 'J-41234567-8', '#d97706', 3, 'El Callao', 'Bolívar', true, false, true)
on conflict (id) do update set
  nombre = excluded.nombre,
  nombre_corto = excluded.nombre_corto,
  color_badge = excluded.color_badge;

-- 2. Buzón de facturas externas
create table if not exists public.retencion_facturas_externas (
  id                uuid primary key default gen_random_uuid(),
  empresa           text not null default 'MGG',
  proveedor_nombre  text not null check (length(btrim(proveedor_nombre)) >= 2),
  proveedor_rif     text not null,
  numero_factura    text not null check (length(btrim(numero_factura)) >= 1),
  numero_control    text,
  fecha_factura     date not null default current_date,
  tipo_documento    text not null default 'factura' check (tipo_documento in ('factura', 'nota_debito', 'nota_credito')),
  moneda            text not null default 'USD' check (moneda in ('USD', 'Bs')),
  tasa_cambio       numeric,
  monto_total       numeric not null check (monto_total >= 0),
  base_imponible    numeric not null default 0 check (base_imponible >= 0),
  iva_monto         numeric default 0,
  observacion       text,
  estado            text not null default 'recibida' check (estado in ('recibida', 'en_revision', 'procesada', 'retenida', 'rechazada', 'anulada')),
  archivos          jsonb not null default '[]'::jsonb,
  actor             text,
  actor_name        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Índices de consulta rápida
create index if not exists idx_ret_facturas_ext_empresa on public.retencion_facturas_externas (empresa);
create index if not exists idx_ret_facturas_ext_estado on public.retencion_facturas_externas (estado);
create index if not exists idx_ret_facturas_ext_fecha on public.retencion_facturas_externas (fecha_factura desc);
create index if not exists idx_ret_facturas_ext_prov on public.retencion_facturas_externas (proveedor_rif);

-- Trigger de updated_at
create or replace function public.trg_ret_facturas_ext_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_ret_facturas_ext_updated_at on public.retencion_facturas_externas;
create trigger trg_ret_facturas_ext_updated_at
  before update on public.retencion_facturas_externas
  for each row execute function public.trg_ret_facturas_ext_updated_at();

-- RLS y permisos
alter table public.retencion_empresas_receptoras enable row level security;
alter table public.retencion_facturas_externas enable row level security;
revoke all on public.retencion_empresas_receptoras from anon;
revoke all on public.retencion_facturas_externas from anon;

drop policy if exists "ret_empresas_rec_read" on public.retencion_empresas_receptoras;
create policy "ret_empresas_rec_read" on public.retencion_empresas_receptoras
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists "ret_empresas_rec_write" on public.retencion_empresas_receptoras;
create policy "ret_empresas_rec_write" on public.retencion_empresas_receptoras
  for all using ((select public.puede_modulo('retenciones', 'escritura')))
  with check ((select public.puede_modulo('retenciones', 'escritura')));

grant select, insert, update, delete on public.retencion_empresas_receptoras to authenticated;

drop policy if exists "ret_facturas_ext_read" on public.retencion_facturas_externas;
create policy "ret_facturas_ext_read" on public.retencion_facturas_externas
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists "ret_facturas_ext_write" on public.retencion_facturas_externas;
create policy "ret_facturas_ext_write" on public.retencion_facturas_externas
  for all using ((select public.puede_modulo('retenciones', 'escritura')))
  with check ((select public.puede_modulo('retenciones', 'escritura')));

grant select, insert, update, delete on public.retencion_facturas_externas to authenticated;

-- Realtime
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'retencion_facturas_externas') then
    alter publication supabase_realtime add table public.retencion_facturas_externas;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'retencion_empresas_receptoras') then
    alter publication supabase_realtime add table public.retencion_empresas_receptoras;
  end if;
end $$;

-- Semilla del rol 'facturas' (solo teléfono) si no existe
insert into public.custom_roles (key, label, descripcion, color, sistema, solo_telefono, created_by)
values (
  'facturas',
  'Facturas',
  'Personal de campo o compras que carga y envía facturas externas desde el celular',
  '#f59e0b',
  true,
  true,
  'sistema · vista teléfono retenciones'
) on conflict (key) do update set
  solo_telefono = true,
  descripcion = excluded.descripcion;

-- Permisos del rol 'facturas' en la matriz (retenciones lectura/escritura)
insert into public.roles_permisos (role, permisos, vistas_telefono, updated_by)
values (
  'facturas',
  jsonb_build_object(
    'retenciones', jsonb_build_object('lectura', true, 'escritura', true, 'full', false),
    'dashboard',   jsonb_build_object('lectura', true, 'escritura', false, 'full', false)
  ),
  '["retenciones"]'::jsonb,
  'sistema · vista teléfono facturas'
) on conflict (role) do update set
  vistas_telefono = case
    when not (roles_permisos.vistas_telefono @> '["retenciones"]'::jsonb)
    then roles_permisos.vistas_telefono || '["retenciones"]'::jsonb
    else roles_permisos.vistas_telefono
  end;
