-- ============================================================
-- Módulo: administracion
-- Archivo: 2026-11-17-administracion-modulo-completo-ddl.sql
-- Estado: LISTO PARA APLICAR EN PRODUCCIÓN
-- Propósito: DDL maestro y consolidado para aprovisionar el módulo de Administración
--            completo en una sola ejecución 100% idempotente: tablas base (empresas,
--            gastos fijos, movimientos, documentos, categorías), centros de acopio,
--            profesionales, carpetas, gestiones, envíos a tesorería, responsabilidades,
--            avisos, checklist de centros, bucket de storage admin-docs, políticas RLS,
--            índices y publicaciones Realtime.
-- ============================================================

-- 1. EMPRESAS (admin_empresas)
create table if not exists public.admin_empresas (
  id uuid primary key default gen_random_uuid(),
  clave text unique not null,
  nombre text not null,
  rif text,
  moneda text default 'USD' check (moneda in ('USD', 'Bs')),
  logo_path text,
  activa boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_empresas_orden on public.admin_empresas(orden, clave);

-- Seed de empresa principal MGG:
insert into public.admin_empresas (clave, nombre, rif, moneda, activa, orden)
values ('MGG', 'Mineral Group Guayana C.A.', 'J-50221930-7', 'USD', true, 1)
on conflict (clave) do update set
  nombre = excluded.nombre,
  rif = excluded.rif,
  moneda = excluded.moneda,
  activa = excluded.activa,
  orden = excluded.orden;

-- 2. CENTROS DE ACOPIO (admin_centros_acopio)
create table if not exists public.admin_centros_acopio (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text not null,
  nombre text not null,
  orden int not null default 0,
  activo boolean not null default true,
  responsable_principal text,
  fase_predeterminada text,
  descripcion text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_centros_empresa on public.admin_centros_acopio(empresa_clave);

alter table public.admin_centros_acopio add column if not exists responsable_principal text;
alter table public.admin_centros_acopio add column if not exists fase_predeterminada text;
alter table public.admin_centros_acopio add column if not exists descripcion text;

-- 3. PROFESIONALES (admin_profesionales - asesores legales, contables, etc.)
create table if not exists public.admin_profesionales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  profesion text,
  contacto text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_profesionales_activo on public.admin_profesionales(activo);

-- 4. CARPETAS DE DOCUMENTOS (admin_carpetas)
create table if not exists public.admin_carpetas (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text,
  nombre text not null,
  parent_id uuid references public.admin_carpetas(id) on delete set null,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_carpetas_empresa on public.admin_carpetas(empresa_clave);
create index if not exists idx_admin_carpetas_parent on public.admin_carpetas(parent_id);

-- 5. CATEGORÍAS DE GASTOS / DOCUMENTOS (admin_categorias)
create table if not exists public.admin_categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int not null default 0,
  activa boolean not null default true,
  codigo_cuenta text,
  codigo_contable text,
  created_at timestamptz not null default now()
);

alter table public.admin_categorias add column if not exists codigo_cuenta text;
alter table public.admin_categorias add column if not exists codigo_contable text;

-- Seed inicial de categorías básicas
insert into public.admin_categorias (nombre, orden, activa) values
  ('Servicios públicos', 1, true),
  ('Alquileres', 2, true),
  ('Honorarios profesionales', 3, true),
  ('Parafiscales', 4, true),
  ('Impuestos y tasas', 5, true),
  ('Seguros', 6, true),
  ('Mantenimiento', 7, true),
  ('Financieros', 8, true),
  ('Otros', 9, true)
on conflict (nombre) do nothing;

-- 6. GASTOS FIJOS (admin_gastos_fijos)
create table if not exists public.admin_gastos_fijos (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text not null,
  concepto text not null,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  proveedor_nombre text,
  categoria_gasto_id uuid,
  monto numeric(14,2) not null default 0,
  moneda text not null default 'USD' check (moneda in ('USD', 'Bs')),
  tasa_ref numeric(14,4),
  periodicidad text not null default 'mensual',
  dia_vencimiento int check (dia_vencimiento between 1 and 31),
  vigente_desde date not null default current_date,
  estado text not null default 'activo' check (estado in ('activo', 'suspendido')),
  centro_acopio_id uuid references public.admin_centros_acopio(id) on delete set null,
  responsable text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_gastos_empresa on public.admin_gastos_fijos(empresa_clave);

alter table public.admin_gastos_fijos add column if not exists centro_acopio_id uuid references public.admin_centros_acopio(id) on delete set null;
alter table public.admin_gastos_fijos add column if not exists responsable text;

-- 7. MOVIMIENTOS DE GASTOS FIJOS (admin_gasto_fijo_movimientos)
create table if not exists public.admin_gasto_fijo_movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text not null,
  gasto_fijo_id uuid references public.admin_gastos_fijos(id) on delete set null,
  concepto text not null,
  proveedor_nombre text,
  categoria_gasto_id uuid,
  periodo text not null,
  fecha date not null default current_date,
  monto numeric(14,2) not null default 0,
  moneda text not null default 'USD' check (moneda in ('USD', 'Bs')),
  tasa_ref numeric(14,4),
  estado_pago text not null default 'pendiente',
  origen text not null default 'manual',
  servicio_directo_id uuid references public.servicios_directos(id) on delete set null,
  prioridad text,
  aviso_dias int,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_mov_empresa_periodo on public.admin_gasto_fijo_movimientos(empresa_clave, periodo);

alter table public.admin_gasto_fijo_movimientos add column if not exists servicio_directo_id uuid references public.servicios_directos(id) on delete set null;
alter table public.admin_gasto_fijo_movimientos add column if not exists prioridad text;
alter table public.admin_gasto_fijo_movimientos add column if not exists aviso_dias int;

-- 8. DOCUMENTOS Y PERMISOS DE EMPRESAS (admin_empresa_documentos)
create table if not exists public.admin_empresa_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text not null,
  tipo text not null,
  nombre text not null,
  path text not null,
  content_type text,
  tamano bigint,
  carpeta text default 'otros',
  centro_acopio_id uuid references public.admin_centros_acopio(id) on delete set null,
  responsable text,
  fecha_emision date,
  fecha_vencimiento date,
  status_vencimiento text default 'vigente',
  socio_nombre text,
  entidad_emisora text,
  numero_registro text,
  nota_tramite text,
  historial jsonb default '[]'::jsonb,
  costo_gestion numeric(14,2),
  moneda_costo text,
  gestion_id uuid,
  aviso_dias int default 15,
  subcarpeta_id uuid references public.admin_carpetas(id) on delete set null,
  badge_texto text,
  prioridad text,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_admin_docs_empresa on public.admin_empresa_documentos(empresa_clave);
create index if not exists idx_admin_docs_carpeta on public.admin_empresa_documentos(carpeta);
create index if not exists idx_admin_docs_vencimiento on public.admin_empresa_documentos(fecha_vencimiento);

-- Eliminar restricciones restrictivas de tipo que provocan fallos con tipos parafiscales/mineros
alter table public.admin_empresa_documentos drop constraint if exists admin_empresa_documentos_tipo_check;

-- Asegurar columnas aditivas si la tabla ya existía
alter table public.admin_empresa_documentos add column if not exists carpeta text default 'otros';
alter table public.admin_empresa_documentos add column if not exists centro_acopio_id uuid references public.admin_centros_acopio(id) on delete set null;
alter table public.admin_empresa_documentos add column if not exists responsable text;
alter table public.admin_empresa_documentos add column if not exists fecha_emision date;
alter table public.admin_empresa_documentos add column if not exists fecha_vencimiento date;
alter table public.admin_empresa_documentos add column if not exists status_vencimiento text default 'vigente';
alter table public.admin_empresa_documentos add column if not exists socio_nombre text;
alter table public.admin_empresa_documentos add column if not exists entidad_emisora text;
alter table public.admin_empresa_documentos add column if not exists numero_registro text;
alter table public.admin_empresa_documentos add column if not exists nota_tramite text;
alter table public.admin_empresa_documentos add column if not exists historial jsonb default '[]'::jsonb;
alter table public.admin_empresa_documentos add column if not exists costo_gestion numeric(14,2);
alter table public.admin_empresa_documentos add column if not exists moneda_costo text;
alter table public.admin_empresa_documentos add column if not exists gestion_id uuid;
alter table public.admin_empresa_documentos add column if not exists aviso_dias int default 15;
alter table public.admin_empresa_documentos add column if not exists subcarpeta_id uuid references public.admin_carpetas(id) on delete set null;
alter table public.admin_empresa_documentos add column if not exists badge_texto text;
alter table public.admin_empresa_documentos add column if not exists prioridad text;
alter table public.admin_empresa_documentos add column if not exists updated_at timestamptz default now();

-- 9. GESTIONES Y HONORARIOS (admin_gestiones)
create table if not exists public.admin_gestiones (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text not null,
  profesional_id uuid references public.admin_profesionales(id) on delete set null,
  categoria_id uuid,
  centro_acopio_id uuid,
  documento_id uuid,
  concepto text not null,
  costo_total numeric(14,2) not null default 0,
  moneda text not null default 'USD' check (moneda in ('USD', 'Bs')),
  tasa_ref numeric(14,4),
  fecha date not null default current_date,
  fecha_pactada date,
  estado text not null default 'abierta',
  nota_acuerdo text,
  prioridad text,
  aviso_dias int,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_gestiones_empresa on public.admin_gestiones(empresa_clave);
create index if not exists idx_admin_gestiones_profesional on public.admin_gestiones(profesional_id);

alter table public.admin_gestiones add column if not exists categoria_id uuid;
alter table public.admin_gestiones add column if not exists centro_acopio_id uuid;
alter table public.admin_gestiones add column if not exists documento_id uuid;
alter table public.admin_gestiones add column if not exists costo_total numeric(14,2) not null default 0;
alter table public.admin_gestiones add column if not exists tasa_ref numeric(14,4);
alter table public.admin_gestiones add column if not exists fecha date not null default current_date;
alter table public.admin_gestiones add column if not exists fecha_pactada date;
alter table public.admin_gestiones add column if not exists nota_acuerdo text;
alter table public.admin_gestiones add column if not exists prioridad text;
alter table public.admin_gestiones add column if not exists aviso_dias int;

-- 10. ENVÍOS A TESORERÍA DESDE HONORARIOS (admin_envios_tesoreria)
create table if not exists public.admin_envios_tesoreria (
  id uuid primary key default gen_random_uuid(),
  gestion_id uuid not null references public.admin_gestiones(id) on delete cascade,
  empresa_clave text not null,
  monto numeric(14,2) not null default 0,
  moneda text not null default 'USD' check (moneda in ('USD', 'Bs')),
  fecha_envio timestamptz not null default now(),
  estado text not null default 'enviado',
  servicio_directo_id uuid references public.servicios_directos(id) on delete set null,
  enviado_por text,
  pagado_en timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_envios_gestion on public.admin_envios_tesoreria(gestion_id);
create index if not exists idx_admin_envios_servicio on public.admin_envios_tesoreria(servicio_directo_id);

alter table public.admin_envios_tesoreria add column if not exists estado text not null default 'enviado';
alter table public.admin_envios_tesoreria add column if not exists servicio_directo_id uuid references public.servicios_directos(id) on delete set null;
alter table public.admin_envios_tesoreria add column if not exists enviado_por text;
alter table public.admin_envios_tesoreria add column if not exists pagado_en timestamptz;

-- 11. RESPONSABILIDADES ASIGNADAS (admin_responsabilidades)
create table if not exists public.admin_responsabilidades (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text not null,
  usuario_email text not null,
  objetivo_tipo text not null,
  objetivo_id text not null,
  created_at timestamptz not null default now(),
  unique (usuario_email, objetivo_tipo, objetivo_id)
);

create index if not exists idx_admin_resp_email on public.admin_responsabilidades(usuario_email);
create index if not exists idx_admin_resp_objetivo on public.admin_responsabilidades(objetivo_tipo, objetivo_id);

-- 12. AVISOS DE ADMINISTRACIÓN (admin_avisos)
create table if not exists public.admin_avisos (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text not null,
  tipo text not null,
  origen text not null,
  origen_id text not null,
  responsable_email text,
  fecha date,
  texto text not null,
  leido boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_avisos_empresa on public.admin_avisos(empresa_clave);
create index if not exists idx_admin_avisos_resp on public.admin_avisos(responsable_email, leido);

-- 13. DOCUMENTOS REQUERIDOS POR CENTRO (admin_centro_requeridos)
create table if not exists public.admin_centro_requeridos (
  id uuid primary key default gen_random_uuid(),
  empresa_clave text not null,
  centro_id text not null,
  tipo_documento text not null,
  created_at timestamptz not null default now(),
  unique (centro_id, tipo_documento)
);

create index if not exists idx_admin_centro_req_centro on public.admin_centro_requeridos(centro_id);

-- 14. BUCKET DE DOCUMENTOS (admin-docs)
insert into storage.buckets (id, name, public)
values ('admin-docs', 'admin-docs', true)
on conflict (id) do nothing;

do $$
begin
  drop policy if exists "admin_docs_storage_select" on storage.objects;
  create policy "admin_docs_storage_select" on storage.objects
    for select using (bucket_id = 'admin-docs' and auth.role() = 'authenticated');

  drop policy if exists "admin_docs_storage_insert" on storage.objects;
  create policy "admin_docs_storage_insert" on storage.objects
    for insert with check (bucket_id = 'admin-docs' and auth.role() = 'authenticated');

  drop policy if exists "admin_docs_storage_update" on storage.objects;
  create policy "admin_docs_storage_update" on storage.objects
    for update using (bucket_id = 'admin-docs' and auth.role() = 'authenticated');

  drop policy if exists "admin_docs_storage_delete" on storage.objects;
  create policy "admin_docs_storage_delete" on storage.objects
    for delete using (bucket_id = 'admin-docs' and auth.role() = 'authenticated');
exception when others then null;
end $$;

-- ============================================================
-- SEGURIDAD: ROW LEVEL SECURITY (RLS) & POLICIES
-- ============================================================

alter table public.admin_empresas enable row level security;
alter table public.admin_centros_acopio enable row level security;
alter table public.admin_profesionales enable row level security;
alter table public.admin_carpetas enable row level security;
alter table public.admin_categorias enable row level security;
alter table public.admin_gastos_fijos enable row level security;
alter table public.admin_gasto_fijo_movimientos enable row level security;
alter table public.admin_empresa_documentos enable row level security;
alter table public.admin_gestiones enable row level security;
alter table public.admin_envios_tesoreria enable row level security;
alter table public.admin_responsabilidades enable row level security;
alter table public.admin_avisos enable row level security;
alter table public.admin_centro_requeridos enable row level security;

do $$
declare
  t text;
  tablas text[] := array[
    'admin_empresas', 'admin_centros_acopio', 'admin_profesionales',
    'admin_carpetas', 'admin_categorias', 'admin_gastos_fijos',
    'admin_gasto_fijo_movimientos', 'admin_empresa_documentos',
    'admin_gestiones', 'admin_envios_tesoreria', 'admin_responsabilidades',
    'admin_avisos', 'admin_centro_requeridos'
  ];
begin
  foreach t in array tablas loop
    execute format('drop policy if exists %I on public.%I', t || '_auth_read', t);
    execute format('create policy %I on public.%I for select using (auth.role() = ''authenticated'')', t || '_auth_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_auth_write', t);
    execute format('create policy %I on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t || '_auth_write', t);
  end loop;
end $$;

-- Permisos directos de postgres roles
grant all on all tables in schema public to authenticated, service_role;

-- ============================================================
-- REALTIME
-- ============================================================
do $$
begin
  alter publication supabase_realtime add table public.admin_empresas;
  alter publication supabase_realtime add table public.admin_gastos_fijos;
  alter publication supabase_realtime add table public.admin_empresa_documentos;
  alter publication supabase_realtime add table public.admin_avisos;
exception when others then null;
end $$;
