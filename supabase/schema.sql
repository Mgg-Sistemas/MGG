-- =============================================================
-- MGG-Inventario · Schema completo (FASE 0: portado del demo)
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query
-- Idempotente: puedes correrlo varias veces sin romper datos.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ENUMs
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'analista', 'supervisor', 'obrero', 'jefe', 'contabilidad', 'gerencia');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_generico') then
    create type estado_generico as enum ('activo', 'inactivo');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_orden') then
    create type estado_orden as enum ('pendiente', 'aprobada', 'rechazada', 'recibida', 'cancelada', 'desistida_proveedor', 'reasignada');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_factura') then
    create type estado_factura as enum ('pendiente', 'pagada', 'anulada');
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_movimiento') then
    create type tipo_movimiento as enum ('creacion', 'entrada', 'salida', 'consumo', 'transferencia', 'ajuste');
  end if;

  if not exists (select 1 from pg_type where typname = 'notif_kind') then
    create type notif_kind as enum ('info', 'success', 'warning', 'error');
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────
-- 2. usuarios (1:1 con auth.users)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.usuarios (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  nombre       text not null,
  role         user_role not null default 'obrero',
  telefono     text,
  departamento text,
  estado       estado_generico not null default 'activo',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

-- Trigger: al registrar usuario en auth, crear fila en public.usuarios
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, email, nombre, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'obrero')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sesiones de usuario (supervisión de actividad): cada conexión registra inicio,
-- último latido (heartbeat) y cierre. "Conectado ahora" = ended_at null y last_seen
-- reciente. Lo alimenta el front (AppShell: start/heartbeat/end). RLS: lectura para
-- cualquier autenticado (supervisión); escritura SOLO de la propia fila (auth.uid()).
create table if not exists public.user_sessions (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid references public.usuarios(id) on delete cascade,
  email        text,
  nombre       text,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at     timestamptz,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_user_sessions_usuario on public.user_sessions(usuario_id, started_at desc);
create index if not exists idx_user_sessions_lastseen on public.user_sessions(last_seen_at desc);
alter table public.user_sessions enable row level security;
create policy "user_sessions read auth"     on public.user_sessions for select using (auth.role() = 'authenticated');
create policy "user_sessions insert propio" on public.user_sessions for insert with check (auth.uid() = usuario_id);
create policy "user_sessions update propio" on public.user_sessions for update using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- ─────────────────────────────────────────────────────────────
-- 3. proveedores
-- ─────────────────────────────────────────────────────────────
create table if not exists public.proveedores (
  id            uuid primary key default gen_random_uuid(),
  rif           text not null unique,
  razon_social  text not null,
  contacto      text,
  telefono      text,
  email         text,
  direccion     text,
  categorias    text[] not null default '{}',
  origen        text not null default 'nacional' check (origen in ('nacional','internacional')),
  estado        estado_generico not null default 'activo',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- 4. productos
-- ─────────────────────────────────────────────────────────────
create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  sku          text not null unique,
  nombre       text not null,
  categoria    text not null,
  unidad       text not null,
  stock        numeric not null default 0,
  stock_min    numeric not null default 0,
  precio       numeric not null default 0,
  almacen      text not null default 'General',
  estado       estado_generico not null default 'activo',
  restock_pct  numeric,
  -- Empaque sugerido para el conversor de bultos (ej. "Caja" + 24 unidades por
  -- bulto). Es solo un default editable en cada ingreso; el stock vive en unidades.
  presentacion      text,
  unidades_empaque  numeric,
  -- FASE 1: tipo de inventario (inicial / proceso / final)
  tipo         text check (tipo in ('inicial', 'proceso', 'final')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create index if not exists idx_productos_categoria on public.productos(categoria);
create index if not exists idx_productos_almacen   on public.productos(almacen);
create index if not exists idx_productos_estado    on public.productos(estado);

-- ─────────────────────────────────────────────────────────────
-- 5. movimientos (kardex)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.movimientos (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid not null references public.productos(id) on delete cascade,
  tipo          tipo_movimiento not null,
  delta         numeric not null,
  stock_antes   numeric not null,
  stock_despues numeric not null,
  actor         text not null,
  actor_name    text,
  ref_tipo      text,
  ref_id        text,
  ref_codigo    text,
  proveedor_id  uuid references public.proveedores(id) on delete set null,
  detalle       text,
  at            timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_mov_producto on public.movimientos(producto_id, at desc);
create index if not exists idx_mov_at       on public.movimientos(at desc);

-- ─────────────────────────────────────────────────────────────
-- 5.1 almacenes (depósitos físicos). productos.almacen referencia nombre (texto).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.almacenes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  ubicacion   text,
  -- Sede física a la que pertenece (Matanzas, Los Pinos…). Agrupa la vista.
  sede        text,
  -- Subalmacén: un almacén dentro de otro. null = almacén principal.
  parent_id   uuid references public.almacenes(id) on delete set null,
  estado      estado_generico not null default 'activo',
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz
);
create index if not exists idx_almacenes_parent on public.almacenes(parent_id);

-- Renombrar un almacén PROPAGANDO el nombre a todas las tablas que lo referencian
-- por texto (el nombre es la "llave" del stock). Atómico: evita orfanar existencias.
create or replace function public.rename_almacen(p_id uuid, p_nuevo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_old text;
begin
  select nombre into v_old from public.almacenes where id = p_id;
  if v_old is null then raise exception 'Almacén no encontrado'; end if;
  p_nuevo := btrim(p_nuevo);
  if p_nuevo = '' then raise exception 'El nombre del almacén no puede estar vacío'; end if;
  if p_nuevo = v_old then return; end if;
  if exists (select 1 from public.almacenes where nombre = p_nuevo and id <> p_id) then
    raise exception 'Ya existe un almacén con ese nombre';
  end if;
  update public.almacenes               set nombre = p_nuevo, updated_at = now() where id = p_id;
  update public.productos               set almacen = p_nuevo            where almacen = v_old;
  update public.existencias             set almacen = p_nuevo            where almacen = v_old;
  update public.movimientos             set almacen = p_nuevo            where almacen = v_old;
  update public.ordenes                 set almacen_destino = p_nuevo    where almacen_destino = v_old;
  update public.produccion              set almacen_destino = p_nuevo    where almacen_destino = v_old;
  update public.produccion_materiales   set almacen = p_nuevo            where almacen = v_old;
  update public.compras_directas        set almacen = p_nuevo            where almacen = v_old;
  update public.combustible_solicitudes set almacen = p_nuevo            where almacen = v_old;
  update public.solicitudes_salida      set almacen_origen = p_nuevo     where almacen_origen = v_old;
  update public.solicitudes_salida      set almacen_destino = p_nuevo    where almacen_destino = v_old;
  update public.cuentas_por_cobrar_abonos set almacen = p_nuevo          where almacen = v_old;
  update public.acopio_aliado_cierres   set almacen = p_nuevo            where almacen = v_old;
end $$;
grant execute on function public.rename_almacen(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5.2 existencias: stock y costo (PMP) por (producto, almacen).
--     productos.stock / productos.precio quedan como agregados
--     (total y promedio global) mantenidos desde aquí.
--     movimientos.almacen indica en qué almacén ocurrió el movimiento.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.existencias (
  producto_id     uuid not null references public.productos(id) on delete cascade,
  almacen         text not null,
  stock           numeric not null default 0,
  costo_promedio  numeric not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (producto_id, almacen)
);
create index if not exists idx_existencias_almacen on public.existencias(almacen);

alter table public.movimientos add column if not exists almacen text;

-- Campos de producto para producción: precio de venta, marca de receta (insumo)
-- y marca de "producible" (producto terminado del catálogo de producción).
alter table public.productos add column if not exists precio_venta   numeric;
alter table public.productos add column if not exists es_receta      boolean not null default false;
alter table public.productos add column if not exists es_producible  boolean not null default false;
-- Detalle del producto (identificación física, todo opcional): se ve al abrir el detalle.
alter table public.productos add column if not exists nombre_busqueda  text;  -- alias/nombre corto para buscar (ej. CLORO)
alter table public.productos add column if not exists marca            text;
alter table public.productos add column if not exists modelo           text;
alter table public.productos add column if not exists fabricante       text;
alter table public.productos add column if not exists color            text;
alter table public.productos add column if not exists serial           text;  -- número de serie
alter table public.productos add column if not exists numero           text;  -- N° (parte/activo)
alter table public.productos add column if not exists codigo           text;  -- código interno / de barras
alter table public.productos add column if not exists ubicacion_fisica text;  -- estante / ubicación física
alter table public.productos add column if not exists descripcion      text;  -- descripción libre
-- Los productos con receta de fundición ya son insumos de producción.
update public.productos set es_receta = true where receta_fundicion is not null and es_receta = false;

-- ─────────────────────────────────────────────────────────────
-- 5.3 producción: órdenes de producción + materiales consumidos.
--   Costo de Producción (CP) = costo_material (CTM) + mano_obra + costos_indirectos.
--   costo_unitario = CP / cantidad → entra como costo (PMP) del producto terminado.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.produccion (
  id                uuid primary key default gen_random_uuid(),
  producto_id       uuid references public.productos(id) on delete set null,
  producto_nombre   text not null,
  cantidad          numeric not null,
  almacen_destino   text not null,
  estado            text not null default 'produccion' check (estado in ('produccion','finalizado')),
  costo_material    numeric not null default 0,
  mano_obra         numeric not null default 0,
  costos_indirectos numeric not null default 0,
  costo_unitario    numeric not null default 0,
  precio_venta      numeric,
  ganancia          numeric,
  receta_num        integer,
  horno             text,
  inicio_at         timestamptz not null default now(),
  fin_at            timestamptz,
  created_by        text,
  created_at        timestamptz not null default now()
);
alter table public.produccion add column if not exists horno text;
create index if not exists idx_prod_estado on public.produccion(estado, created_at desc);
create index if not exists idx_prod_producto on public.produccion(producto_id, created_at desc);

-- 5.4 hornos: catálogo de hornos (se administran como las categorías:
--     alta, renombrado e inhabilitación con motivo). produccion.horno guarda
--     el NOMBRE del horno usado (texto), por simetría con almacen.
create table if not exists public.hornos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  estado      estado_generico not null default 'activo',
  motivo_inhabilitacion text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz
);

create table if not exists public.produccion_materiales (
  id              uuid primary key default gen_random_uuid(),
  produccion_id   uuid not null references public.produccion(id) on delete cascade,
  producto_id     uuid references public.productos(id) on delete set null,
  material_nombre text not null,
  almacen         text not null,
  cantidad        numeric not null,
  costo_unitario  numeric not null default 0,
  subtotal        numeric not null default 0
);
create index if not exists idx_prodmat_prod on public.produccion_materiales(produccion_id);

-- ─────────────────────────────────────────────────────────────
-- 5.5 Tesorería (módulo Salidas / Traslados · Dinero)
--   cajas: cuentas de dinero con saldo, en USD o Bs.
--   movimientos_caja: libro de cada caja (mantiene el saldo) y documento de
--   la salida de dinero con su conciliación contra una recepción de mineral.
--   movimientos.destino: a quién va dirigida una salida/traslado de material.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.cajas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  moneda      text not null check (moneda in ('USD','Bs','USDT','COP')),
  saldo       numeric not null default 0,
  estado      estado_generico not null default 'activo',
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz,
  unique (nombre, moneda)
);
-- Centros de acopio (destino de traslado, saldo propio) y enlace inter-sistema.
alter table public.cajas add column if not exists tipo text;            -- null | 'centro_acopio'
alter table public.cajas add column if not exists externo boolean not null default false; -- vive en otra Supabase
alter table public.cajas add column if not exists empresa_codigo text;  -- identificador acordado entre sistemas (ej. 'paramana')

create table if not exists public.movimientos_caja (
  id            uuid primary key default gen_random_uuid(),
  caja_id       uuid not null references public.cajas(id) on delete cascade,
  tipo          text not null check (tipo in ('ingreso','salida','traslado_salida','traslado_entrada','ajuste')),
  monto         numeric not null,
  moneda        text not null,
  saldo_antes   numeric not null default 0,
  saldo_despues numeric not null default 0,
  motivo        text,
  destino       text,
  ref_caja_id   uuid references public.cajas(id) on delete set null,
  -- Conciliación con recepción de mineral (solo tipo='salida').
  estado_mineral          text check (estado_mineral in ('pendiente','conciliada')),
  mineral_producto_id     uuid references public.productos(id) on delete set null,
  mineral_producto_nombre text,
  mineral_cantidad        numeric,
  mineral_unidad          text,
  mineral_costo_unit      numeric,
  mineral_descripcion     text,
  mineral_mov_id          uuid references public.movimientos(id) on delete set null,
  conciliada_at           timestamptz,
  actor         text not null,
  actor_name    text,
  at            timestamptz not null default now()
);
create index if not exists idx_movcaja_caja on public.movimientos_caja(caja_id, at desc);
create index if not exists idx_movcaja_at on public.movimientos_caja(at desc);
create index if not exists idx_movcaja_pendiente on public.movimientos_caja(estado_mineral) where estado_mineral = 'pendiente';

-- ============================================================
-- Transferencias inter-sistema (puente entre dos Supabase independientes).
-- Cuando Tesorería traslada dinero a un centro de acopio EXTERNO (cajas.externo),
-- se crea una fila 'saliente' y se empuja al otro sistema vía Edge Function
-- (enviar-transferencia → recibir-transferencia). El destino la guarda como
-- 'entrante / por_confirmar' y, al confirmar el operador, acredita su caja y
-- devuelve el ACK (confirmar-transferencia) que pasa la saliente a 'recibida'.
-- transf_id es el id GLOBAL compartido (idempotencia: no se cuenta dos veces).
-- ============================================================
create table if not exists public.transferencias_inter (
  id            uuid primary key default gen_random_uuid(),
  transf_id     uuid not null unique,
  direccion     text not null check (direccion in ('saliente','entrante')),
  estado        text not null default 'enviada'
                  check (estado in ('enviada','por_confirmar','recibida','rechazada','error')),
  empresa_origen   text not null,
  empresa_destino  text not null,
  caja_id       uuid references public.cajas(id) on delete set null,
  caja_nombre   text,
  legs          jsonb not null default '[]'::jsonb,   -- [{cuenta,moneda,monto,tasa_bs}]
  resumen       text,
  motivo        text,
  callback_base text,                                  -- functions url del origen (para el ACK)
  mensaje_error text,
  actor         text,
  actor_name    text,
  created_at    timestamptz not null default now(),
  confirmada_at timestamptz
);
create index if not exists idx_transf_inter_dir_estado on public.transferencias_inter(direccion, estado);
alter table public.transferencias_inter enable row level security;
create policy "transf read auth"  on public.transferencias_inter for select using (auth.role()='authenticated');
create policy "transf write auth" on public.transferencias_inter for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

-- ============================================================
-- Puente inter-sistema · COMBUSTIBLE (litros). Mismo patrón que el de dinero
-- pero el recurso son litros de combustible: el otro sistema traslada litros y
-- este los recibe y, al confirmar, los acredita a un TANQUE de MGG (que se
-- refleja en el inventario). Reusa las mismas Edge Functions con recurso='combustible'.
-- transf_id es el id GLOBAL compartido (idempotencia).
-- ============================================================
create table if not exists public.transferencias_combustible_inter (
  id                 uuid primary key default gen_random_uuid(),
  transf_id          uuid not null unique,
  direccion          text not null check (direccion in ('saliente','entrante')),
  estado             text not null default 'enviada'
                       check (estado in ('enviada','por_confirmar','recibida','rechazada','error')),
  empresa_origen     text not null,
  empresa_destino    text not null,
  combustible_nombre text not null,                  -- nombre del combustible (ids distintos por sistema)
  litros             numeric not null check (litros > 0),
  costo_litro        numeric,                         -- costo/litro informado por el origen (opcional)
  tanque_id          uuid references public.combustible_tanques(id) on delete set null,  -- tanque MGG que recibe
  tanque_nombre      text,
  resumen            text,
  motivo             text,
  callback_base      text,                            -- functions url del origen (para el ACK)
  mensaje_error      text,
  actor              text,
  actor_name         text,
  created_at         timestamptz not null default now(),
  confirmada_at      timestamptz
);
create index if not exists idx_transf_comb_dir_estado on public.transferencias_combustible_inter(direccion, estado);
alter table public.transferencias_combustible_inter enable row level security;
create policy "transf comb read auth"  on public.transferencias_combustible_inter for select using (auth.role()='authenticated');
create policy "transf comb write auth" on public.transferencias_combustible_inter for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

-- Realtime: el sistema es multiusuario; lo que registra un usuario se refleja en
-- los demás. Se publica el conjunto operativo (idempotente).
do $$
declare t text;
begin
  foreach t in array array['movimientos_caja','caja_saldos','cajas','transferencias_inter','transferencias_combustible_inter','ordenes','productos','movimientos','combustibles','combustible_solicitudes','combustible_tanques','combustible_vehiculos','combustible_planta_movimientos','combustible_autorizados','combustible_ubicaciones','combustible_tanque_movimientos','compras_directas','personal','anticipos_prestamos','nomina_periodos','nomina_renglones','rrhh_eventos','almacenes','tesoreria_contrapartes','cuentas_por_pagar','cuentas_por_pagar_abonos']
  loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- A quién va dirigida una salida/traslado de material.
alter table public.movimientos add column if not exists destino text;
-- Fecha en que se entregó la salida/traslado de material al destino.
alter table public.movimientos add column if not exists fecha_entrega date;
-- Texto de la nota de entrega (se imprime en el PDF del traslado).
alter table public.movimientos add column if not exists nota_entrega text;
-- Marca que la salida/traslado se queda dentro de la empresa (se ve en la trazabilidad).
alter table public.movimientos add column if not exists consumo_interno boolean not null default false;
-- Quién solicitó la salida/traslado (se muestra en el historial como "Realizado por").
alter table public.movimientos add column if not exists solicitante text;

-- ─────────────────────────────────────────────────────────────
-- 5b. compras_directas — compras sin proveedor (EN PROCESO → FINALIZADA).
--   Al finalizar, el material entra al inventario como ENTRADA (al costo
--   = gasto / cantidad) y se adjunta el PDF en el bucket 'compras-directas'.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.compras_directas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text,                       -- correlativo CD-YYYY-#### (Compra Directa)
  producto_id     uuid references public.productos(id) on delete set null,
  producto_nombre text not null,
  producto_sku    text,
  almacen         text not null,
  cantidad        numeric not null check (cantidad > 0),
  -- en_proceso → por_pagar (analista monta) → por_recibir (Tesorería paga, sin tocar
  -- inventario) → finalizada (el almacenista recibe y elige el almacén/subalmacén).
  estado          text not null default 'en_proceso' check (estado in ('en_proceso','abierta','por_pagar','por_recibir','finalizada')),
  gasto           numeric,
  adjunto_path    text,
  adjunto_nombre  text,
  mov_id          uuid,
  actor           text,
  actor_name      text,
  created_at      timestamptz not null default now(),
  finalizada_at   timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists idx_compra_directa_estado on public.compras_directas(estado, created_at desc);
-- Proveedor de la compra directa (opcional; si es nuevo, se da de alta en `proveedores`).
alter table public.compras_directas add column if not exists proveedor_id uuid references public.proveedores(id) on delete set null;
alter table public.compras_directas add column if not exists proveedor_nombre text;
-- Facturas (varias, PDF o imagen): [{path, filename, at}]. adjunto_path/nombre siguen apuntando a la primera (compatibilidad).
alter table public.compras_directas add column if not exists facturas jsonb not null default '[]'::jsonb;
-- Flujo nuevo: el analista MONTA (factura + montos) -> por_pagar (aparece en Tesorería);
-- Tesorería paga -> finalizada. Etiquetas de gasto persistidas + quién pagó.
alter table public.compras_directas add column if not exists gasto_categoria    text;
alter table public.compras_directas add column if not exists gasto_subcategoria text;
alter table public.compras_directas add column if not exists pagada_por         text;
-- Recepción por el almacenista: al pagar queda 'por_recibir'; el almacenista le da
-- entrada al inventario eligiendo el almacén/subalmacén → 'finalizada'.
alter table public.compras_directas add column if not exists recibida_por       text;
alter table public.compras_directas add column if not exists recibida_at        timestamptz;
-- Moneda (Bs/$), IVA (16% cuando es Bs; se suma al total) y retención de IVA
-- (% aplicado sobre el IVA + monto retenido). La retención vincula la compra
-- directa al módulo de Retenciones (aparece en la misma lista que las OC).
alter table public.compras_directas add column if not exists moneda text not null default 'USD';
alter table public.compras_directas add column if not exists iva numeric not null default 0;
-- Descuento (en % o en monto, sincronizados): baja el total (base = subtotal − descuento; total = base + IVA).
alter table public.compras_directas add column if not exists descuento_pct   numeric not null default 0;
alter table public.compras_directas add column if not exists descuento_monto numeric not null default 0;
alter table public.compras_directas add column if not exists retencion_pct   numeric not null default 0;
alter table public.compras_directas add column if not exists retencion_monto numeric not null default 0;
-- Finalización de la retención (espejo de ordenes; sólo comprobante de IVA para compra directa).
alter table public.compras_directas add column if not exists retencion_iva_path       text;
alter table public.compras_directas add column if not exists retencion_iva_nombre     text;
alter table public.compras_directas add column if not exists retencion_finalizada     boolean not null default false;
alter table public.compras_directas add column if not exists retencion_finalizada_por text;
alter table public.compras_directas add column if not exists retencion_finalizada_en  timestamptz;
-- RLS: lectura para autenticados, escritura para operativo (admin/analista/obrero).
-- Bucket privado 'compras-directas' (storage) con políticas para autenticados.
-- (Ver migración aplicada; políticas: compra_directa read/write + cd_obj_* en storage.objects.)

-- SERVICIO DIRECTO: igual que la compra directa pero COMO SERVICIO (sin inventario).
-- Renglones de servicio (categoría · tipo · equipo de maquinaria); al finalizar se
-- carga la FACTURA + monto y la caja (egreso en Tesorería). Queda casado al equipo
-- (aparece en Control de Mantenimiento / bitácora). Adjunto en el bucket 'compras-directas' (prefijo sd/).
create table if not exists public.servicios_directos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text,                       -- correlativo SD-YYYY-####
  descripcion      text not null,
  proveedor_id     uuid references public.proveedores(id) on delete set null,
  proveedor_nombre text,
  equipo_id        uuid references public.maquinaria_equipos(id) on delete set null,
  equipo_nombre    text,
  cantidad         numeric not null default 1,
  items            jsonb not null default '[]'::jsonb,  -- [{servicio_categoria, servicio_tipo, equipo_id, equipo_nombre, descripcion, cantidad, gasto}]
  estado           text not null default 'en_proceso' check (estado in ('en_proceso','por_pagar','finalizada')),
  gasto            numeric,
  caja_id          uuid references public.cajas(id) on delete set null,
  caja_mov_id      uuid,
  adjunto_path     text, adjunto_nombre text,
  solicitante      text, solicitante_persona text,
  actor            text, actor_name text,
  created_at       timestamptz not null default now(),
  finalizada_at    timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists idx_serv_directo_estado on public.servicios_directos(estado);
create index if not exists idx_serv_directo_equipo on public.servicios_directos(equipo_id);
-- Facturas (varias, PDF o imagen): [{path, filename, at}]. adjunto_path/nombre = la primera (compatibilidad).
alter table public.servicios_directos add column if not exists facturas jsonb not null default '[]'::jsonb;
-- Flujo nuevo: el analista MONTA (factura + montos) -> por_pagar; Tesorería paga -> finalizada.
alter table public.servicios_directos add column if not exists gasto_categoria    text;
alter table public.servicios_directos add column if not exists gasto_subcategoria text;
alter table public.servicios_directos add column if not exists pagada_por         text;
alter table public.servicios_directos enable row level security;
create policy "serv_directo read auth" on public.servicios_directos for select using (auth.role()='authenticated');
create policy "serv_directo write op" on public.servicios_directos for all using (public.is_operativo()) with check (public.is_operativo());

-- ─────────────────────────────────────────────────────────────
-- 5c. combustible — inventario por tipo (litros + costo PMP por litro)
--   y solicitudes de salida (por_aprobar → aprobada → finalizada).
--   El ingreso suma litros al instante; finalizar descuenta litros.
--   RLS: lectura auth, escritura is_operativo(). (Ver migración aplicada.)
-- ─────────────────────────────────────────────────────────────
-- Sedes del módulo Combustible (tarjetas de la pantalla inicial). `clave` es el
-- valor estable guardado en combustibles.sede/tanques.sede; nombre/titulo son
-- editables (renombrar la tarjeta sin tocar los datos).
create table if not exists public.combustible_sedes (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  nombre text not null,
  titulo text not null,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.combustible_sedes enable row level security;
create policy "comb_sedes read auth" on public.combustible_sedes for select using (auth.role()='authenticated');
create policy "comb_sedes write op"  on public.combustible_sedes for all using (public.is_operativo()) with check (public.is_operativo());
insert into public.combustible_sedes (clave, nombre, titulo, orden) values
  ('LOS PINOS','LOS PINOS','COMBUSTIBLE LOS PINOS',1),
  ('MATANZAS','MGG','COMBUSTIBLE MGG - MATANZAS',2)
on conflict (clave) do nothing;

create table if not exists public.combustibles (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  sede        text,            -- sede duena del combustible (LOS PINOS, MATANZAS…)
  litros      numeric not null default 0,
  costo_litro numeric not null default 0,
  estado      estado_generico not null default 'activo',
  -- Producto del inventario al que está vinculado (traza Inventario → Combustible).
  producto_id uuid references public.productos(id),
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now()
);
-- Un combustible por (sede, nombre): cada sede tiene su propio DIESEL/GASOLINA.
create unique index if not exists uq_combustibles_sede_nombre on public.combustibles(sede, lower(nombre));
create table if not exists public.combustible_movimientos (
  id               uuid primary key default gen_random_uuid(),
  combustible_id   uuid not null references public.combustibles(id) on delete cascade,
  tipo             text not null check (tipo in ('ingreso','salida','ajuste')),
  litros           numeric not null,
  costo_litro      numeric,
  litros_antes     numeric not null default 0,
  litros_despues   numeric not null default 0,
  ref_solicitud_id uuid,
  detalle          text,
  actor            text,
  actor_name       text,
  at               timestamptz not null default now()
);
create table if not exists public.combustible_solicitudes (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null,
  combustible_id     uuid references public.combustibles(id) on delete set null,
  combustible_nombre text not null,
  solicitante        text not null,
  destino            text not null,
  almacen            text,  -- almacén del inventario de donde sale el combustible
  litros             numeric not null check (litros > 0),
  litros_reales      numeric,   -- litros realmente surtidos al finalizar (puede diferir de lo solicitado)
  -- Telemetría capturada al surtir (mismas reglas de encadenado que un mov. de tanque):
  horometro_inicial  numeric, horometro_final numeric,
  contador_ini       numeric, contador_fin    numeric,
  tanque_mov_id      uuid,     -- mov. de tanque (consumo) generado al finalizar
  estado             text not null default 'por_aprobar' check (estado in ('por_aprobar','aprobada','finalizada','cancelada')),
  motivo             text,
  historial          jsonb not null default '[]'::jsonb,
  aprobada_por       text, aprobada_en   timestamptz,
  finalizada_por     text, finalizada_en timestamptz,
  mov_id             uuid,
  actor              text, actor_name text,
  created_at         timestamptz not null default now()
);

-- Tanques: depósitos físicos de combustible con capacidad, ubicación y litros propios.
create table if not exists public.combustible_tanques (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null,
  combustible_id   uuid references public.combustibles(id) on delete set null,
  capacidad_litros numeric not null check (capacidad_litros > 0),
  litros           numeric not null default 0 check (litros >= 0),
  ubicacion        text,
  sede             text,           -- sede duena del tanque (LOS PINOS, MATANZAS…)
  estado           text not null default 'activo' check (estado in ('activo','inactivo')),
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);
alter table public.combustible_tanques enable row level security;
create policy "tanques read auth"      on public.combustible_tanques for select using (auth.role()='authenticated');
create policy "tanques write operativo" on public.combustible_tanques for all using (public.is_operativo()) with check (public.is_operativo());

-- Tanque: tasa editable, nota de cubicación y geometría para calcular litros según
-- el nivel medido con varilla. Forma 'cilindro' (Ø + largo) o 'rectangular' (largo
-- en longitud_cm + ancho + altura). litros = V(nivel) según la forma.
alter table public.combustible_tanques add column if not exists tasa        numeric default 0.50;
alter table public.combustible_tanques add column if not exists cubicacion  text;
alter table public.combustible_tanques add column if not exists forma       text default 'cilindro';
alter table public.combustible_tanques add column if not exists diametro_cm numeric;
alter table public.combustible_tanques add column if not exists longitud_cm numeric;
alter table public.combustible_tanques add column if not exists ancho_cm    numeric;
alter table public.combustible_tanques add column if not exists altura_cm   numeric;

-- La solicitud de combustible puede salir de un TANQUE registrado (además del
-- almacén de inventario): al finalizar descuenta del tanque y del inventario.
alter table public.combustible_solicitudes add column if not exists tanque_id     uuid references public.combustible_tanques(id) on delete set null;
alter table public.combustible_solicitudes add column if not exists tanque_nombre text;

-- Vehículos / máquinas: a dónde se destina la salida de combustible. Se registran
-- desde la vista de Combustible y aparecen como lista en la solicitud de salida.
create table if not exists public.combustible_vehiculos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text,
  estado      text not null default 'activo' check (estado in ('activo','inactivo')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
alter table public.combustible_vehiculos enable row level security;
create policy "vehiculos read auth"      on public.combustible_vehiculos for select using (auth.role()='authenticated');
create policy "vehiculos write operativo" on public.combustible_vehiculos for all using (public.is_operativo()) with check (public.is_operativo());

-- Planta Eléctrica: movimientos de consumo por horómetro, atados a un tanque.
-- HRS = horómetro_final − horómetro_inicial · litros = HRS × litros_por_hora (12 por defecto).
-- Al registrar descuenta del tanque (y del inventario si el tanque tiene combustible).
create table if not exists public.combustible_planta_movimientos (
  id                uuid primary key default gen_random_uuid(),
  planta            text,
  tanque_id         uuid references public.combustible_tanques(id) on delete set null,
  tanque_nombre     text,
  fecha             timestamptz not null default now(),
  horometro_inicial numeric not null,
  horometro_final   numeric not null,
  horas             numeric not null,
  litros_por_hora   numeric not null default 12,
  tasa              numeric,
  litros_consumidos numeric not null,
  litros_acumulados numeric,
  nota              text,
  actor             text, actor_name text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_planta_mov_tanque on public.combustible_planta_movimientos(tanque_id);
alter table public.combustible_planta_movimientos enable row level security;
create policy "planta read auth"      on public.combustible_planta_movimientos for select using (auth.role()='authenticated');
create policy "planta write operativo" on public.combustible_planta_movimientos for all using (public.is_operativo()) with check (public.is_operativo());

-- Catálogos del módulo Combustible (gestionados desde el botón "Catálogo"):
--   · autorizados  → quién autoriza un movimiento de tanque
--   · ubicaciones  → destino de un movimiento de tanque
-- (los equipos/máquinas viven en combustible_vehiculos). Soportan deshabilitar.
create table if not exists public.combustible_autorizados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  estado text not null default 'activo' check (estado in ('activo','inactivo')),
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz
);
alter table public.combustible_autorizados enable row level security;
create policy "comb_autorizados read auth" on public.combustible_autorizados for select using (auth.role()='authenticated');
create policy "comb_autorizados write op"  on public.combustible_autorizados for all using (public.is_operativo()) with check (public.is_operativo());

create table if not exists public.combustible_ubicaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  estado text not null default 'activo' check (estado in ('activo','inactivo')),
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz
);
alter table public.combustible_ubicaciones enable row level security;
create policy "comb_ubicaciones read auth" on public.combustible_ubicaciones for select using (auth.role()='authenticated');
create policy "comb_ubicaciones write op"  on public.combustible_ubicaciones for all using (public.is_operativo()) with check (public.is_operativo());

-- Catálogos de Pedidos (gestionables desde el botón "📒 Categorías"):
--   scope='clasificacion'        → clasificación del pedido (Producción, Bienes…)
--   scope='unidad_solicitante'   → unidad/área que solicita (se alimenta sola al crear OP)
--   scope='servicio_categoria'   → categorías de servicio (recarga de gas, mantenimiento…)
--   scope='servicio_tipo'        → tipos/servicios específicos (lista extensible)
create table if not exists public.catalogos_pedido (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('clasificacion','unidad_solicitante','servicio_categoria','servicio_tipo')),
  nombre text not null,
  categoria text,                 -- (servicio_tipo) categoría a la que pertenece, opcional
  estado text not null default 'activo' check (estado in ('activo','inactivo')),
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz
);
create unique index if not exists uq_catalogos_pedido_scope_nombre on public.catalogos_pedido(scope, lower(nombre));
create index if not exists idx_catalogos_pedido_scope on public.catalogos_pedido(scope, estado);
alter table public.catalogos_pedido enable row level security;
create policy "cat_pedido read auth" on public.catalogos_pedido for select using (auth.role()='authenticated');
create policy "cat_pedido write op"  on public.catalogos_pedido for all using (public.is_operativo()) with check (public.is_operativo());
insert into public.catalogos_pedido (scope, nombre)
select 'clasificacion', v from (values ('Producción'),('Bienes'),('Servicios'),('Papelería')) as t(v)
where not exists (select 1 from public.catalogos_pedido c where c.scope='clasificacion' and lower(c.nombre)=lower(t.v));
-- Categorías de servicio por defecto.
insert into public.catalogos_pedido (scope, nombre)
select 'servicio_categoria', v from (values
  ('RECARGA DE GAS'),('RECARGA DE OXÍGENO'),('MANTENIMIENTO DE MAQUINARIA'),('RECARGA DE EXTINTORES')
) as t(v)
where not exists (select 1 from public.catalogos_pedido c where c.scope='servicio_categoria' and lower(c.nombre)=lower(t.v));

-- Movimientos de tanque (botón "Registrar Movimiento"). El tipo define el signo:
--   ingreso / retorno → suman litros al tanque · consumo / merma → restan.
-- Si el tanque tiene combustible asignado, se refleja también en el inventario.
create table if not exists public.combustible_tanque_movimientos (
  id uuid primary key default gen_random_uuid(),
  tanque_id uuid references public.combustible_tanques(id) on delete set null,
  tanque_nombre text,
  tipo text not null check (tipo in ('ingreso','consumo','retorno','merma')),
  fecha timestamptz not null default now(),
  litros numeric not null check (litros > 0),
  litros_antes numeric, litros_despues numeric,
  horometro_inicial numeric, horometro_final numeric,  -- por equipo: el HF pasa a ser el HI del próximo movimiento del mismo equipo
  kilometraje_final numeric,  -- lectura de odómetro (km) del equipo en este movimiento (vehículos)
  contador_global_ini numeric, contador_global_fin numeric,  -- totalizador del surtidor (por tanque): el fin pasa a ser el ini del próximo movimiento del tanque
  equipo text,            -- vehículo/máquina (combustible_vehiculos)
  autorizado_por text,    -- combustible_autorizados
  destino text,           -- combustible_ubicaciones
  observacion text,
  combustible_id uuid references public.combustibles(id) on delete set null,
  costo_litro numeric,
  actor text, actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_comb_tanque_mov_tanque on public.combustible_tanque_movimientos(tanque_id, fecha desc);
alter table public.combustible_tanque_movimientos enable row level security;
create policy "comb_tanque_mov read auth" on public.combustible_tanque_movimientos for select using (auth.role()='authenticated');
create policy "comb_tanque_mov write op"  on public.combustible_tanque_movimientos for all using (public.is_operativo()) with check (public.is_operativo());

-- Control de Alimentación (Cocina): consumo de víveres por comida.
-- Toma precios/stock del inventario; al registrar descuenta el stock (salida en kardex).
create table if not exists public.cocina_comidas (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null,                 -- COC-AAAA-NNNN
  tipo_comida  text not null check (tipo_comida in ('desayuno','almuerzo','cena')),
  platos       numeric not null default 0 check (platos >= 0),
  -- [{producto_id, sku, nombre, unidad, cantidad, precio, subtotal, almacen}]
  items        jsonb not null default '[]'::jsonb,
  valor_total  numeric not null default 0,
  nota         text,
  actor        text, actor_name text,
  at           timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_cocina_at   on public.cocina_comidas(at desc);
create index if not exists idx_cocina_tipo on public.cocina_comidas(tipo_comida);
alter table public.cocina_comidas enable row level security;
create policy "cocina read auth"      on public.cocina_comidas for select using (auth.role()='authenticated');
create policy "cocina write operativo" on public.cocina_comidas for all using (public.is_operativo()) with check (public.is_operativo());

-- Cocinas: cada cocina se vincula a un almacén/subalmacén (de ahí toma sus víveres y
-- descuenta su stock). Se pueden crear más cocinas vinculadas a otros almacenes.
create table if not exists public.cocinas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  almacen_id uuid references public.almacenes(id) on delete set null,
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text
);
alter table public.cocinas enable row level security;
create policy "cocinas read auth" on public.cocinas for select using (auth.role()='authenticated');
create policy "cocinas write op"  on public.cocinas for all using (public.is_operativo()) with check (public.is_operativo());
-- La comida queda marcada con la cocina en la que se preparó (null = legado).
alter table public.cocina_comidas add column if not exists cocina_id uuid references public.cocinas(id) on delete set null;

-- Alerta "a restablecer el mercado": la cocina avisa que hay que reponer víveres; la
-- alerta aparece como tarjeta en Pedidos/Compras para que el analista monte el MERCADO.
create table if not exists public.alertas_mercado (
  id           uuid primary key default gen_random_uuid(),
  estado       text not null default 'pendiente' check (estado in ('pendiente','atendida')),
  nota         text,
  creada_por   text,
  creada_en    timestamptz not null default now(),
  atendida_por text,
  atendida_en  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_alertas_mercado_estado on public.alertas_mercado(estado, creada_en desc);
alter table public.alertas_mercado enable row level security;
create policy "alertas_mercado read auth"      on public.alertas_mercado for select using (auth.role()='authenticated');
create policy "alertas_mercado write operativo" on public.alertas_mercado for all using (public.is_operativo()) with check (public.is_operativo());

-- Solicitudes de salida/traslado (material y dinero) con flujo de aprobación.
-- El obrero crea (por_aprobar); admin/analista aprueba y ejecuta (gate en el front).
-- Al ejecutar se realiza el movimiento real (movimientos / movimientos_caja) y se guarda mov_id.
create table if not exists public.solicitudes_salida (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,                  -- SAL-AAAA-NNNN / TRA-AAAA-NNNN
  scope           text not null check (scope in ('salida','traslado')),
  tipo            text not null check (tipo in ('material','dinero')),
  estado          text not null default 'por_aprobar' check (estado in ('por_aprobar','aprobada','ejecutada','cancelada')),
  -- material (cabecera = primer ítem / resumen; el detalle multi-producto va en `items`)
  producto_id     uuid references public.productos(id) on delete set null,
  producto_nombre text, almacen_origen text, almacen_destino text,
  cantidad        numeric check (cantidad is null or cantidad > 0),
  precio_unit     numeric, fecha_entrega date, nota_entrega text,
  -- Detalle multi-producto: [{producto_id, producto_nombre, cantidad, precio_unit, unidad, almacen, observacion}]
  -- (como en una OC con varias líneas). Si es null/1 ítem, se usa la cabecera de arriba.
  items           jsonb,
  -- dinero
  caja_id         uuid references public.cajas(id) on delete set null,
  caja_destino_id uuid references public.cajas(id) on delete set null,
  monto           numeric check (monto is null or monto > 0), moneda text, cuenta text,
  -- comunes
  solicitante     text not null, destino text, motivo text,
  historial       jsonb not null default '[]'::jsonb,
  aprobada_por    text, aprobada_en   timestamptz,
  ejecutada_por   text, ejecutada_en  timestamptz,
  mov_id          uuid, mov_ref text,
  actor           text, actor_name text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_sol_salida_estado on public.solicitudes_salida(estado);
create index if not exists idx_sol_salida_scope_tipo on public.solicitudes_salida(scope, tipo);
-- RLS: lectura auth; escritura is_operativo() (el gate "obrero no aprueba" vive en el front).
alter table public.solicitudes_salida enable row level security;
create policy "sol_salida read auth"      on public.solicitudes_salida for select using (auth.role() = 'authenticated');
create policy "sol_salida write operativo" on public.solicitudes_salida for all using (public.is_operativo()) with check (public.is_operativo());

-- Datos de la nota de salida en tránsito (chofer/responsable + cédula, vehículo + placa,
-- direcciones origen→destino) y marca de consumo interno. Se ven en el detalle y la trazabilidad.
alter table public.solicitudes_salida add column if not exists chofer             text;
alter table public.solicitudes_salida add column if not exists chofer_cedula      text;
alter table public.solicitudes_salida add column if not exists vehiculo           text;
alter table public.solicitudes_salida add column if not exists vehiculo_placa     text;
alter table public.solicitudes_salida add column if not exists direccion_despacho text;
alter table public.solicitudes_salida add column if not exists direccion_destino  text;
alter table public.solicitudes_salida add column if not exists consumo_interno    boolean not null default false;

-- Sede/centro de acopio destino (desplegable de almacenes padre + centros de acopio) y
-- salida a CLIENTE: al ejecutar se genera una cuenta por cobrar (motivo "Salida de material
-- · <codigo>", monto = valor del material, editable; el cliente paga en dinero o producto).
alter table public.solicitudes_salida add column if not exists sede_destino   text;
alter table public.solicitudes_salida add column if not exists cliente_id     uuid references public.clientes(id) on delete set null;
alter table public.solicitudes_salida add column if not exists cliente_nombre text;
alter table public.solicitudes_salida add column if not exists cxc_monto      numeric;
alter table public.solicitudes_salida add column if not exists cxc_moneda     text;
alter table public.solicitudes_salida add column if not exists cxc_id         uuid;

-- ─────────────────────────────────────────────────────────────
-- 5c. Catálogos de Salidas/Traslados: choferes y vehículos (modificables, deshabilitables).
--   Chofer = responsable + cédula; Vehículo = nombre + placa. Buscables en el formulario.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.salidas_choferes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  cedula     text,
  activo     boolean not null default true,
  actor      text,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_salidas_choferes_nombre on public.salidas_choferes(lower(nombre));
alter table public.salidas_choferes enable row level security;
create policy "choferes read auth"      on public.salidas_choferes for select using (auth.role() = 'authenticated');
create policy "choferes write operativo" on public.salidas_choferes for all using (public.is_operativo()) with check (public.is_operativo());

create table if not exists public.salidas_vehiculos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  placa      text,
  activo     boolean not null default true,
  actor      text,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_salidas_vehiculos_nombre on public.salidas_vehiculos(lower(nombre));
alter table public.salidas_vehiculos enable row level security;
create policy "vehiculos read auth"      on public.salidas_vehiculos for select using (auth.role() = 'authenticated');
create policy "vehiculos write operativo" on public.salidas_vehiculos for all using (public.is_operativo()) with check (public.is_operativo());

-- ─────────────────────────────────────────────────────────────
-- 6. ordenes (de compra / pedido)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.ordenes (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique,
  proveedor_id       uuid not null references public.proveedores(id) on delete restrict,
  solicitante_email  text not null,
  solicitante        text,
  items              jsonb not null default '[]',
  total              numeric not null default 0,
  estado             estado_orden not null default 'pendiente',
  notas              text,
  motivo             text,           -- "porqué" de la OP: motivo de la solicitud
  finalidad          text,           -- "porqué" de la OP: para qué se usará
  clasificacion      text[],
  historial          jsonb not null default '[]',
  aprobada_por       text,
  aprobada_en        timestamptz,
  rechazada_por      text,
  rechazada_en       timestamptz,
  motivo_rechazo     text,
  -- Sub-OC por proveedor: si la OP se reparte entre varios proveedores, cada OC
  -- hija apunta a su OP padre por aquí (la padre queda en estado 'asignada').
  parent_orden_id    uuid references public.ordenes(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

alter table public.ordenes add column if not exists parent_orden_id uuid references public.ordenes(id) on delete set null;
create index if not exists idx_ordenes_proveedor on public.ordenes(proveedor_id);
create index if not exists idx_ordenes_estado    on public.ordenes(estado);
create index if not exists idx_ordenes_parent    on public.ordenes(parent_orden_id);

-- ─────────────────────────────────────────────────────────────
-- 7. facturas
-- ─────────────────────────────────────────────────────────────
create table if not exists public.facturas (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique,
  orden_id      uuid references public.ordenes(id) on delete set null,
  proveedor_id  uuid not null references public.proveedores(id) on delete restrict,
  items         jsonb not null default '[]',
  subtotal      numeric not null default 0,
  iva           numeric not null default 0,
  total         numeric not null default 0,
  estado        estado_factura not null default 'pendiente',
  emision       timestamptz not null default now(),
  vencimiento   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- 8. notificaciones (in-app)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  -- destinatario: 'all' o un user_role
  destino     text not null default 'all',
  kind        notif_kind not null default 'info',
  title       text not null,
  message     text,
  link        text,
  dedup_key   text,
  read        boolean not null default false,
  at          timestamptz not null default now()
);

create index if not exists idx_notif_destino_at on public.notificaciones(destino, at desc);
create index if not exists idx_notif_dedup      on public.notificaciones(dedup_key) where dedup_key is not null;

-- ─────────────────────────────────────────────────────────────
-- 9. config (Key/Value para política de restock, preferencias, etc.)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.config (
  key        text primary key,
  value      jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 8.b taxonomias — catálogos compartidos (categorías, unidades,
--     departamentos, monedas) por `scope`. Alimentan los selects
--     de Inventario/Proveedores/Usuarios además de los valores ya
--     presentes en cada tabla. Únicos por (scope, valor).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.taxonomias (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null,
  valor      text not null,
  created_at timestamptz not null default now(),
  created_by text,
  constraint taxonomias_scope_valor_unique unique (scope, valor)
);
alter table public.taxonomias enable row level security;
-- Lectura/alta abiertas (catálogo); borrar/renombrar requiere sesión.
-- (El gate de quién administra el catálogo vive en el front.)
drop policy if exists "taxonomias_read_all"    on public.taxonomias;
drop policy if exists "taxonomias_write_all"   on public.taxonomias;
drop policy if exists "taxonomias_delete_auth" on public.taxonomias;
drop policy if exists "taxonomias_update_auth" on public.taxonomias;
create policy "taxonomias_read_all"    on public.taxonomias for select using (true);
create policy "taxonomias_write_all"   on public.taxonomias for insert with check (true);
create policy "taxonomias_delete_auth" on public.taxonomias for delete using (auth.role() = 'authenticated');
create policy "taxonomias_update_auth" on public.taxonomias for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────
-- 9.b tasa_cambio (Tesorería · historial de tasas BCV USD/EUR)
--     La Edge Function `tasa-bcv` la actualiza a diario; snapshot
--     del día en config (key 'tesoreria.tasa_hoy').
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tasa_cambio (
  id         uuid primary key default gen_random_uuid(),
  fecha      date not null,
  moneda     text not null check (moneda in ('USD','EUR','USDT','COP')),
  tasa       numeric not null check (tasa > 0),
  fuente     text not null default 'bcv',
  created_by text,
  at         timestamptz not null default now(),
  unique (fecha, moneda, fuente)
);
create index if not exists tasa_cambio_fecha_idx on public.tasa_cambio (fecha desc);
alter table public.tasa_cambio enable row level security;
create policy tasa_cambio_read on public.tasa_cambio for select to authenticated using (true);
-- Escritura para cualquier usuario registrado (el acceso al módulo de Tesorería lo
-- gobierna la matriz del front; antes era is_admin() y bloqueaba a analistas).
create policy tasa_cambio_write on public.tasa_cambio for all to authenticated using (public.is_operativo()) with check (public.is_operativo());

-- ─────────────────────────────────────────────────────────────
-- 8.1 Tesorería multimoneda (Fase 0) — cajas con varias monedas,
--     cuentas (jurídica/personal en Bs), promedio ponderado de tasa
--     (como el PMP del inventario) y serie histórica de tasas.
-- ─────────────────────────────────────────────────────────────
-- Serie de tasas (varias por día) para el gráfico día a día.
create table if not exists public.tasa_snapshot (
  id     uuid primary key default gen_random_uuid(),
  par    text not null,                          -- 'USDT_VES','USD_VES','COP_USD', etc.
  tasa   numeric not null,
  fuente text not null default 'binance_p2p',    -- 'binance_p2p','bcv','trm','er_api','manual'
  at     timestamptz not null default now()
);
create index if not exists idx_tasa_snapshot_par_at on public.tasa_snapshot(par, at desc);
alter table public.tasa_snapshot enable row level security;
create policy "tasa_snapshot read auth" on public.tasa_snapshot for select using (auth.role()='authenticated');
create policy "tasa_snapshot write operativo" on public.tasa_snapshot for all using (public.is_operativo()) with check (public.is_operativo());

-- Saldo por (caja, cuenta, moneda) + tasa promedio ponderada en Bs por unidad.
create table if not exists public.caja_saldos (
  id         uuid primary key default gen_random_uuid(),
  caja_id    uuid not null references public.cajas(id) on delete cascade,
  cuenta     text not null default 'general',    -- Bs: 'juridica'|'personal'; otras: 'general'
  moneda     text not null check (moneda in ('Bs','USD','USDT','COP')),
  saldo      numeric not null default 0,
  tasa_prom  numeric,                             -- Bs por 1 unidad (null/1 para Bs)
  updated_at timestamptz not null default now(),
  unique (caja_id, cuenta, moneda)
);
alter table public.caja_saldos enable row level security;
create policy "caja_saldos read auth" on public.caja_saldos for select using (auth.role()='authenticated');
create policy "caja_saldos write operativo" on public.caja_saldos for all using (public.is_operativo()) with check (public.is_operativo());

-- Trazabilidad: cada ingreso de divisa con la tasa a la que se compró.
create table if not exists public.caja_lotes (
  id         uuid primary key default gen_random_uuid(),
  caja_id    uuid not null references public.cajas(id) on delete cascade,
  cuenta     text not null default 'general',
  moneda     text not null check (moneda in ('Bs','USD','USDT','COP')),
  monto      numeric not null,
  tasa_bs    numeric,                             -- Bs por 1 unidad al comprar
  origen     text,
  motivo     text,
  actor      text,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_caja_lotes_caja on public.caja_lotes(caja_id, moneda, cuenta);
alter table public.caja_lotes enable row level security;
create policy "caja_lotes read auth" on public.caja_lotes for select using (auth.role()='authenticated');
create policy "caja_lotes write operativo" on public.caja_lotes for all using (public.is_operativo()) with check (public.is_operativo());

-- Directorio de contrapartes (clientes / proveedores) para reusar en ingresos
-- manuales a caja y en cuentas por pagar. El tipo es su categoría.
create table if not exists public.tesoreria_contrapartes (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('cliente','proveedor')),
  nombre     text not null,
  rif        text,
  telefono   text,
  email      text,
  nota       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.tesoreria_contrapartes enable row level security;
create policy "contrapartes read auth" on public.tesoreria_contrapartes for select using (auth.role()='authenticated');
create policy "contrapartes write operativo" on public.tesoreria_contrapartes for all using (public.is_operativo()) with check (public.is_operativo());

-- Cuentas por pagar manuales: un ingreso manual a caja (cliente/proveedor) genera
-- una cuenta por pagar por el mismo monto, saldable con abonos (egresos de caja).
create table if not exists public.cuentas_por_pagar (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('cliente','proveedor')),
  contraparte text not null,
  monto       numeric not null check (monto > 0),
  abonado     numeric not null default 0,
  moneda      text not null,
  cuenta      text,
  caja_id     uuid references public.cajas(id) on delete set null,
  caja_mov_id uuid,
  estado      text not null default 'abierta' check (estado in ('abierta','saldada')),
  nota        text,
  actor       text,
  actor_name  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create table if not exists public.cuentas_por_pagar_abonos (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null references public.cuentas_por_pagar(id) on delete cascade,
  monto          numeric not null check (monto > 0),
  moneda         text not null,
  caja_id        uuid references public.cajas(id) on delete set null,
  cuenta         text,
  caja_mov_id    uuid,
  saldo_restante numeric,
  nota           text,
  actor          text,
  actor_name     text,
  at             timestamptz not null default now()
);
alter table public.cuentas_por_pagar enable row level security;
alter table public.cuentas_por_pagar_abonos enable row level security;
create policy "cxp read auth" on public.cuentas_por_pagar for select using (auth.role()='authenticated');
create policy "cxp write operativo" on public.cuentas_por_pagar for all using (public.is_operativo()) with check (public.is_operativo());
create policy "cxpa read auth" on public.cuentas_por_pagar_abonos for select using (auth.role()='authenticated');
create policy "cxpa write operativo" on public.cuentas_por_pagar_abonos for all using (public.is_operativo()) with check (public.is_operativo());

-- Ingresos (lotes) de una cuenta por pagar: cada entrada de dinero del mismo
-- cliente/proveedor con su fecha. La cuenta es ÚNICA por contraparte+moneda y su
-- monto acumula (incremental); acá queda la traza de cada ingreso (fecha + monto).
create table if not exists public.cuentas_por_pagar_ingresos (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null references public.cuentas_por_pagar(id) on delete cascade,
  monto       numeric not null default 0,
  moneda      text not null,
  caja_id     uuid, cuenta text, caja_mov_id uuid,
  nota        text, actor text, actor_name text,
  at          timestamptz not null default now()
);
create index if not exists idx_cxp_ingresos_cuenta on public.cuentas_por_pagar_ingresos(cuenta_id, at);
alter table public.cuentas_por_pagar_ingresos enable row level security;
do $$ begin
  create policy "cxpi_read"  on public.cuentas_por_pagar_ingresos for select using (auth.role()='authenticated');
  create policy "cxpi_write" on public.cuentas_por_pagar_ingresos for all using (public.is_operativo()) with check (public.is_operativo());
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.cuentas_por_pagar_ingresos;
exception when duplicate_object then null; end $$;

-- Cuentas por cobrar: si se le paga de MÁS a un cliente/proveedor, el excedente
-- queda como deuda del cliente hacia la empresa. Incremental por (tipo+contraparte+
-- moneda); se salda con abonos (ingresos a caja).
create table if not exists public.cuentas_por_cobrar (
  id          uuid primary key default gen_random_uuid(),
  -- 'centro_acopio' = cuenta por cobrar generada por un traspaso de dinero a un centro de costo.
  tipo        text not null check (tipo in ('cliente','proveedor','centro_acopio')),
  contraparte text not null,
  monto       numeric not null default 0,
  abonado     numeric not null default 0,
  moneda      text not null,
  estado      text not null default 'abierta' check (estado in ('abierta','saldada')),
  origen      text,
  nota        text, actor text, actor_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create table if not exists public.cuentas_por_cobrar_abonos (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null references public.cuentas_por_cobrar(id) on delete cascade,
  monto          numeric not null check (monto > 0),
  moneda         text not null,
  caja_id        uuid references public.cajas(id) on delete set null,
  cuenta         text, caja_mov_id uuid, saldo_restante numeric,
  -- Abono en PRODUCTO (intercambio dinero↔producto): el producto entra al inventario y su
  -- valor ($ al cambio) salda la cuenta. tipo_abono='dinero' (entra a caja) | 'producto' (entra a inventario).
  tipo_abono     text not null default 'dinero' check (tipo_abono in ('dinero','producto')),
  producto_id    uuid, producto_nombre text, cantidad numeric, unidad text, costo_unit numeric,
  almacen        text, inv_mov_id uuid,
  nota           text, actor text, actor_name text,
  at             timestamptz not null default now()
);
create index if not exists idx_cxc_abonos_cuenta on public.cuentas_por_cobrar_abonos(cuenta_id, at);
alter table public.cuentas_por_cobrar enable row level security;
alter table public.cuentas_por_cobrar_abonos enable row level security;
do $$ begin
  create policy "cxc_read"   on public.cuentas_por_cobrar        for select using (auth.role()='authenticated');
  create policy "cxc_write"  on public.cuentas_por_cobrar        for all using (public.is_operativo()) with check (public.is_operativo());
  create policy "cxca_read"  on public.cuentas_por_cobrar_abonos for select using (auth.role()='authenticated');
  create policy "cxca_write" on public.cuentas_por_cobrar_abonos for all using (public.is_operativo()) with check (public.is_operativo());
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.cuentas_por_cobrar;
  alter publication supabase_realtime add table public.cuentas_por_cobrar_abonos;
exception when duplicate_object then null; end $$;

-- Categorías y subcategorías de GASTO (jerárquico: padre_id null = categoría).
-- El registro de gasto las exige (obligatorias). Catálogo dinámico/buscable.
create table if not exists public.categorias_gasto (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  padre_id   uuid references public.categorias_gasto(id) on delete cascade,
  activo     boolean not null default true,
  actor      text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_catgasto_top on public.categorias_gasto (lower(nombre)) where padre_id is null;
create unique index if not exists ux_catgasto_sub on public.categorias_gasto (padre_id, lower(nombre)) where padre_id is not null;
alter table public.categorias_gasto enable row level security;
do $$ begin
  create policy "catgasto read auth"     on public.categorias_gasto for select using (auth.role()='authenticated');
  create policy "catgasto write operativo" on public.categorias_gasto for all using (public.is_operativo()) with check (public.is_operativo());
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.categorias_gasto;
exception when duplicate_object then null; end $$;
-- Gasto: categoría y subcategoría elegidas (se guardan en el movimiento).
alter table public.movimientos_caja add column if not exists gasto_categoria    text;
alter table public.movimientos_caja add column if not exists gasto_subcategoria text;
-- Correlativo numérico para categorías que lo requieren (RECEPCION / EXPORTACION):
-- el usuario ingresa el inicial la primera vez y luego se autoincrementa por categoría.
alter table public.movimientos_caja add column if not exists gasto_correlativo  integer;

-- movimientos_caja: cuenta + tasa aplicada (multipago y trazabilidad).
alter table public.movimientos_caja add column if not exists cuenta  text;
alter table public.movimientos_caja add column if not exists tasa_bs numeric;

-- ─────────────────────────────────────────────────────────────
-- Cierre de mes (caja): snapshot del período + archivado reversible.
-- Al cerrar un mes se guarda el reporte (jsonb) y se "marcan" los
-- movimientos del período con cierre_id, para que las vistas de
-- Tesorería arranquen limpias. Reabrir el cierre quita la marca.
-- NO borra nada ni toca inventario/saldos.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.cierres_caja (
  id            uuid primary key default gen_random_uuid(),
  periodo       text not null,                 -- 'YYYY-MM'
  desde         date not null,
  hasta         date not null,
  snapshot      jsonb not null default '{}'::jsonb,  -- reporte calculado al cerrar
  estado        text not null default 'cerrado' check (estado in ('cerrado','reabierto')),
  movimientos   integer not null default 0,    -- cuántos movimientos quedaron archivados
  actor         text,
  actor_name    text,
  reabierto_por text,
  reabierto_en  timestamptz,
  created_at    timestamptz not null default now()
);
-- Un solo cierre vigente por período (los reabiertos no cuentan).
create unique index if not exists ux_cierre_periodo on public.cierres_caja(periodo) where estado = 'cerrado';
alter table public.cierres_caja enable row level security;
do $$ begin
  create policy "cierres read auth" on public.cierres_caja for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "cierres write staff" on public.cierres_caja for all using (public.is_staff()) with check (public.is_staff());
exception when duplicate_object then null; end $$;
alter publication supabase_realtime add table public.cierres_caja;

-- Marca de archivado en los movimientos (null = período abierto/actual).
alter table public.movimientos_caja add column if not exists cierre_id uuid references public.cierres_caja(id) on delete set null;
create index if not exists idx_mov_cierre on public.movimientos_caja(cierre_id);

-- ─────────────────────────────────────────────────────────────
-- Control de Maquinaria (traído de Golden Touch): catálogos, equipos, bitácora.
-- Se vincula con Combustible por nombre de equipo (maquinaria_equipos.combustible_equipo):
-- de ahí se traen el horómetro vigente y el gasoil consumido del equipo.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.maquinaria_catalogos (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('tipo_maquinaria','propietario','status')),
  valor      text not null,
  activo     boolean not null default true,
  orden      int not null default 999,
  created_at timestamptz not null default now(),
  unique (tipo, valor)
);
alter table public.maquinaria_catalogos enable row level security;
drop policy if exists "maquinaria_cat read auth" on public.maquinaria_catalogos;
drop policy if exists "maquinaria_cat write op" on public.maquinaria_catalogos;
create policy "maquinaria_cat read auth" on public.maquinaria_catalogos for select using (auth.role()='authenticated');
create policy "maquinaria_cat write op" on public.maquinaria_catalogos for all using (public.is_operativo()) with check (public.is_operativo());

create table if not exists public.maquinaria_equipos (
  id            uuid primary key default gen_random_uuid(),
  equipo        text not null,
  tipo          text,
  propietario   text,
  status        text not null default 'ACTIVO',
  ubicacion     text,
  anio          int,
  marca         text, modelo text, color text, serial text, placa text,
  motor_modelo  text, motor_serial text,
  combustible   text, litros_consume numeric,
  ficha_tecnica text, ficha_mantenimiento text, documentacion text,
  mantenimiento_cada_hrs numeric,
  -- Nivel de DISPARO de alerta (objetivo) que el usuario fija en la ficha del equipo.
  -- Las lecturas (horómetro/km vigente) se toman de Combustible; al acercarse, salta tarjeta en Equipos.
  alerta_km numeric, alerta_horometro numeric,
  -- Intervalos de servicio por ítem (horas de horómetro) para el control de ESTADO CRÍTICO.
  -- El "último servicio" de cada ítem se deriva de la bitácora (último registro con aceite/filtro/gasoil).
  aceite_cada_hrs numeric, filtro_cada_hrs numeric, combustible_cada_hrs numeric,
  -- INTEGRACIÓN COMBUSTIBLE: nombre del equipo en el módulo de Combustible.
  combustible_equipo text,
  -- Submódulo Servicio de Mantenimiento: clasifica el equipo en un grupo
  -- (FLOTA PESADA / VEHÍCULOS DE CARGA / PLANTAS ELÉCTRICAS). Texto libre clasificado por la UI.
  grupo_mantenimiento text,
  doc_fisico boolean not null default false, ficha_mantt boolean not null default false,
  doc_drive boolean not null default false, esp_tecnicas boolean not null default false,
  revision_mina boolean not null default false,
  notas text, activo boolean not null default true,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz
);
create index if not exists idx_maq_equipos_tipo on public.maquinaria_equipos(tipo);
create index if not exists idx_maq_equipos_status on public.maquinaria_equipos(status);
create index if not exists idx_maq_equipos_grupo on public.maquinaria_equipos(grupo_mantenimiento);
-- Intervalos de servicio por ítem (control de ESTADO CRÍTICO) para entornos ya creados.
alter table public.maquinaria_equipos add column if not exists aceite_cada_hrs numeric;
alter table public.maquinaria_equipos add column if not exists filtro_cada_hrs numeric;
alter table public.maquinaria_equipos add column if not exists combustible_cada_hrs numeric;

create table if not exists public.maquinaria_mantenimientos (
  id            uuid primary key default gen_random_uuid(),
  equipo_id     uuid not null references public.maquinaria_equipos(id) on delete cascade,
  fecha         date not null default current_date,
  horometro     numeric,
  kilometraje   numeric,   -- lectura del odómetro (km) en este registro (vehículos)
  alerta_km     numeric,   -- km objetivo de aviso: al acercarse, salta alerta en Servicio de Mantenimiento
  tipo          text,   -- tipo de mantenimiento (cambio de aceite, cambio de pieza, preventivo…)
  pieza         text,   -- pieza cambiada (cuando tipo = cambio de pieza, ej. motor)
  aceite_lts    numeric, refrigerante_lts numeric, gasoil_lts numeric,
  filtros_cant  numeric, filtros_tipo text,   -- filtros cambiados: cantidad + tipo (aceite/aire/combustible…)
  insumos       jsonb not null default '[]'::jsonb,  -- repuestos/insumos cambiados: [{concepto, cantidad, unidad}] (cauchos, pintura, batería…)
  solicitud_id  uuid,                  -- vínculo con la Solicitud de Servicio (ordenes clase='servicio')
  solicitud_codigo text,               -- SV-AAAA-NNNN de la solicitud atendida
  cantidad_colocada numeric,           -- cuánto se colocó/aplicó del servicio solicitado
  trabajo       text, consumibles text, mecanico text, ubicacion text, observacion text,
  created_by    text, actor_name text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_maq_mant_equipo on public.maquinaria_mantenimientos(equipo_id, fecha desc, created_at desc);

alter table public.maquinaria_equipos enable row level security;
alter table public.maquinaria_mantenimientos enable row level security;
drop policy if exists "maq_equipos read auth" on public.maquinaria_equipos;
drop policy if exists "maq_equipos write op" on public.maquinaria_equipos;
drop policy if exists "maq_mant read auth" on public.maquinaria_mantenimientos;
drop policy if exists "maq_mant write op" on public.maquinaria_mantenimientos;
create policy "maq_equipos read auth" on public.maquinaria_equipos for select using (auth.role()='authenticated');
create policy "maq_equipos write op" on public.maquinaria_equipos for all using (public.is_operativo()) with check (public.is_operativo());
create policy "maq_mant read auth" on public.maquinaria_mantenimientos for select using (auth.role()='authenticated');
create policy "maq_mant write op" on public.maquinaria_mantenimientos for all using (public.is_operativo()) with check (public.is_operativo());

-- ─────────────────────────────────────────────────────────────
-- 9.0 Ofertas de proveedores + evaluaciones de recepción (Sourcing)
--     Permite cargar varias ofertas por orden y comparar/seleccionar.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_oferta') then
    create type estado_oferta as enum ('pendiente', 'aceptada', 'descartada');
  end if;
end$$;

create table if not exists public.ofertas_proveedor (
  id                         uuid primary key default gen_random_uuid(),
  orden_id                   uuid not null references public.ordenes(id) on delete cascade,
  proveedor_id               uuid not null references public.proveedores(id) on delete restrict,
  items                      jsonb not null default '[]',  -- precios y cantidades cotizados
  precio_total               numeric not null,              -- total a tasa BCV (precio nominal)
  precio_efectivo            numeric,                       -- total si se paga en divisa efectivo (descuento vs BCV)
  fecha_entrega_prometida    date,
  condiciones_pago           text,
  notas                      text,
  estado                     estado_oferta not null default 'pendiente',
  score_calculado            numeric,                       -- snapshot al momento de aceptar
  registrada_por_email       text not null,
  registrada_en              timestamptz not null default now(),
  decidida_por_email         text,
  decidida_en                timestamptz,
  motivo_descarte            text,
  pdf_path                   text,                          -- path en bucket `ofertas-pdf`
  pdf_filename               text
);

-- Reconciliación: agrega columnas PDF si el schema ya estaba creado
alter table public.ofertas_proveedor
  add column if not exists pdf_path text,
  add column if not exists pdf_filename text,
  -- Datos técnicos/logísticos declarados por el proveedor (marca, modelo,
  -- procedencia, materiales, dimensiones, peso, calidad, fletes/seguros).
  add column if not exists detalle jsonb,
  -- Precio total si se paga en divisa efectivo (descuento vs. BCV; informa la decisión).
  add column if not exists precio_efectivo numeric,
  -- Descuento sobre el total BCV (BCV total = subtotal − descuento).
  add column if not exists descuento numeric,
  -- Adjuntos (varias fotos/PDF de la cotización): [{ path, filename }].
  add column if not exists adjuntos jsonb;

create index if not exists idx_ofertas_orden     on public.ofertas_proveedor(orden_id);
create index if not exists idx_ofertas_proveedor on public.ofertas_proveedor(proveedor_id);
create index if not exists idx_ofertas_estado    on public.ofertas_proveedor(estado);

-- Solo una oferta aceptada por orden (constraint funcional vía índice parcial único)
create unique index if not exists uniq_oferta_aceptada_por_orden
  on public.ofertas_proveedor(orden_id) where estado = 'aceptada';

create table if not exists public.evaluaciones_recepcion (
  id                  uuid primary key default gen_random_uuid(),
  orden_id            uuid not null unique references public.ordenes(id) on delete cascade,
  proveedor_id        uuid not null references public.proveedores(id) on delete restrict,
  calidad             smallint not null check (calidad between 1 and 5),
  puntualidad_dias    integer not null,                    -- signed: negativo = atrasado, 0 = en fecha, positivo = adelantado
  comentario          text,
  evaluado_por_email  text not null,
  evaluado_por_rol    text not null,                       -- 'almacenista' o 'jefe'
  evaluado_en         timestamptz not null default now(),
  ajustado_por_jefe   boolean not null default false,
  rating_original     smallint check (rating_original between 1 and 5),  -- preserva calificación del almacenista si el jefe ajustó
  ajustado_en         timestamptz
);

create index if not exists idx_evals_proveedor on public.evaluaciones_recepcion(proveedor_id);

-- Semilla de pesos del score (idempotente)
insert into public.config(key, value)
  values ('oferta.score.weights',
          '{"precio":0.40,"puntualidad":0.25,"calidad":0.25,"cumplimiento":0.10}'::jsonb)
on conflict (key) do nothing;

-- RLS: cualquier autenticado lee; admin escribe
alter table public.ofertas_proveedor       enable row level security;
alter table public.evaluaciones_recepcion  enable row level security;

drop policy if exists "ofertas read auth"  on public.ofertas_proveedor;
drop policy if exists "ofertas write admin" on public.ofertas_proveedor;
drop policy if exists "ofertas write staff" on public.ofertas_proveedor;
drop policy if exists "evals read auth"    on public.evaluaciones_recepcion;
drop policy if exists "evals write admin"  on public.evaluaciones_recepcion;

create policy "ofertas read auth"
  on public.ofertas_proveedor for select
  using (auth.role() = 'authenticated');
-- Escritura para STAFF (admin + analista): el analista gestiona las cotizaciones.
create policy "ofertas write staff"
  on public.ofertas_proveedor for all
  using (public.is_staff()) with check (public.is_staff());

create policy "evals read auth"
  on public.evaluaciones_recepcion for select
  using (auth.role() = 'authenticated');
create policy "evals write admin"
  on public.evaluaciones_recepcion for all
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 9.1 Reconciliar columnas (en caso de schema previo más simple)
--     Estos ALTER son no-ops si la columna ya existe.
-- ─────────────────────────────────────────────────────────────
alter table public.usuarios    add column if not exists telefono     text;
alter table public.usuarios    add column if not exists departamento text;
alter table public.usuarios    add column if not exists estado       estado_generico not null default 'activo';
alter table public.usuarios    add column if not exists updated_at   timestamptz;
alter table public.usuarios    add column if not exists ci           text;

alter table public.proveedores add column if not exists updated_at   timestamptz;
alter table public.productos   add column if not exists updated_at   timestamptz;
alter table public.productos   add column if not exists tipo         text check (tipo in ('inicial','proceso','final'));

-- Trazabilidad de costos (PMP / promedio ponderado):
--   precio_unitario → costo unitario informado en ese movimiento (lo pagado al proveedor en una entrada).
--   costo_promedio  → costo base resultante (PMP) del producto luego de aplicar el movimiento.
alter table public.movimientos add column if not exists precio_unitario numeric;
alter table public.movimientos add column if not exists costo_promedio  numeric;
alter table public.ordenes     add column if not exists updated_at      timestamptz;
alter table public.ordenes     add column if not exists ci_solicitante  text;
alter table public.ordenes     add column if not exists solicitante_persona text;  -- persona que solicita (servicios)
-- El formulario de solicitud del obrero/planta NO pide proveedor; el admin
-- lo asigna después en el flujo de aprobación / sourcing.
alter table public.ordenes     alter column proveedor_id drop not null;
alter table public.facturas    add column if not exists updated_at   timestamptz;

-- ─────────────────────────────────────────────────────────────
-- Re-flujo de Compras (FASE 3): la OP se aprueba/rechaza; al elegir la oferta
-- ganadora se crea la OC (oc_creada · sin confirmar); se aprueba en lote desde
-- el checklist (oc_aprobada); Tesorería la paga (pagada) → recibida → finalizada.
-- Estados nuevos del enum estado_orden + columnas de OC/pago en ordenes.
-- ─────────────────────────────────────────────────────────────
alter type public.estado_orden add value if not exists 'oc_emitida';
alter type public.estado_orden add value if not exists 'oc_creada';
alter type public.estado_orden add value if not exists 'oc_aprobada';
alter type public.estado_orden add value if not exists 'pagada';
-- Fase 4: el gerente confirma → 'confirmada_metodo' (indicar método de pago);
-- al indicar el método (multipago) y "Enviar para Pagar" → 'oc_aprobada' (Confirmada pagar).
alter type public.estado_orden add value if not exists 'confirmada_metodo';
alter table public.ordenes add column if not exists condiciones_pago text;   -- copiado de la oferta
alter table public.ordenes add column if not exists metodo_pago     jsonb;   -- [{metodo,moneda,monto}] multipago
alter table public.ordenes add column if not exists metodo_pago_por text;
alter table public.ordenes add column if not exists metodo_pago_en  timestamptz;
alter table public.ofertas_proveedor add column if not exists condiciones_pago text; -- contra_entrega|anticipado|credito
-- Monedas dinámicas (registro tipo taxonomía, scope 'tesoreria.moneda'):
-- se liberan los CHECK de moneda para admitir cualquier código registrado.
alter table public.caja_saldos drop constraint if exists caja_saldos_moneda_check;
alter table public.caja_lotes  drop constraint if exists caja_lotes_moneda_check;
alter table public.tasa_cambio drop constraint if exists tasa_cambio_moneda_check;
alter type public.estado_orden add value if not exists 'finalizada';
alter type public.estado_orden add value if not exists 'anulada';
alter table public.ordenes add column if not exists oc_codigo       text;
-- clase: 'producto' (compra normal) | 'servicio' (recarga de gas, mantenimiento…). Los
-- servicios usan correlativo SV y no tocan inventario al recibir (sus items no tienen productoId).
alter table public.ordenes add column if not exists clase           text not null default 'producto';
alter table public.ordenes add column if not exists oc_emitida_por  text;
alter table public.ordenes add column if not exists oc_emitida_en   timestamptz;
alter table public.ordenes add column if not exists oc_creada_por   text;
alter table public.ordenes add column if not exists oc_creada_en    timestamptz;
alter table public.ordenes add column if not exists oc_aprobada_por text;
alter table public.ordenes add column if not exists oc_aprobada_en  timestamptz;
-- Almacén destino de la mercancía, elegido al confirmar la OC (oc_creada → oc_aprobada).
alter table public.ordenes add column if not exists almacen_destino text;
alter table public.ordenes add column if not exists pagada_por      text;
alter table public.ordenes add column if not exists pagada_en       timestamptz;
alter table public.ordenes add column if not exists caja_id         uuid;
alter table public.ordenes add column if not exists caja_mov_id     uuid;
alter table public.ordenes add column if not exists factura_path    text;
alter table public.ordenes add column if not exists factura_nombre  text;
alter table public.ordenes add column if not exists retencion_path  text;
alter table public.ordenes add column if not exists retencion_nombre text;
-- Módulo Retenciones: 3 comprobantes fiscales por OC (IVA / ISLR / Municipal) + estado.
alter table public.ordenes add column if not exists retencion_iva_path        text;
alter table public.ordenes add column if not exists retencion_iva_nombre      text;
alter table public.ordenes add column if not exists retencion_islr_path       text;
alter table public.ordenes add column if not exists retencion_islr_nombre     text;
alter table public.ordenes add column if not exists retencion_municipal_path  text;
alter table public.ordenes add column if not exists retencion_municipal_nombre text;
alter table public.ordenes add column if not exists retencion_finalizada      boolean not null default false;
alter table public.ordenes add column if not exists retencion_finalizada_por  text;
alter table public.ordenes add column if not exists retencion_finalizada_en   timestamptz;
-- Soporte elegido al indicar método de pago + modo de retención + marca de pago Tesorería.
alter table public.ordenes add column if not exists comprobante_tipo    text;   -- 'nota_entrega' | 'factura'
alter table public.ordenes add column if not exists retencion_modo      text;   -- 'se_paga_despues' | 'completo_reembolso'
alter table public.ordenes add column if not exists retencion_pagada    boolean not null default false;
alter table public.ordenes add column if not exists retencion_pagada_en timestamptz;
-- Storage: bucket privado `compras-oc` para la factura adjunta al pago de la OC
-- (políticas: lectura/escritura para usuarios autenticados, espejo de `compras-directas`).
-- movimientos_caja: categoría 'pago_oc' (ref_orden_id) casa el pago con la orden.

-- Flujo de compras por condición de pago (contra_entrega / anticipado / credito):
--  · contra_entrega → 'por_recibir' (recibe primero, paga lo recibido)
--  · credito        → 'cuenta_abierta' (abonos hasta saldar) → 'por_recibir'
--  · anticipado/null → flujo actual (confirmada_metodo → oc_aprobada → pagada → recibida).
alter type public.estado_orden add value if not exists 'por_recibir';
alter type public.estado_orden add value if not exists 'cuenta_abierta';
-- OP repartida entre varios proveedores (umbrella): sus OC hijas llevan parent_orden_id.
alter type public.estado_orden add value if not exists 'asignada';
-- Recepción parcial: items[].cantidad_recibida (jsonb) + nota y total recibido.
alter table public.ordenes add column if not exists nota_recepcion text;
alter table public.ordenes add column if not exists recibido_total numeric;  -- Σ cantidad_recibida×precio
alter table public.ordenes add column if not exists recibida_por   text;
alter table public.ordenes add column if not exists recibida_en    timestamptz;
alter table public.ordenes add column if not exists abonado_total  numeric default 0;  -- caché Σ abonos (crédito)
-- Compra cuyos productos YA se ingresaron manualmente al inventario: al recibirla
-- NO se generan entradas de stock (evita duplicar). La orden igual se recibe/finaliza.
alter table public.ordenes add column if not exists sin_inventario boolean not null default false;
-- Descuento OBTENIDO (negociado) que reduce el monto de la factura: total = Σ ítems − descuento.
alter table public.ordenes add column if not exists descuento_obtenido numeric;
-- Seriales de los billetes entregados cuando se paga una OC en USD físico (efectivo).
alter table public.ordenes add column if not exists seriales_billetes text[];
-- Snapshot de la oferta elegida: datos técnicos/logísticos + precio en divisa efectivo (se ven en la OC y su PDF).
alter table public.ordenes add column if not exists oferta_detalle         jsonb;
alter table public.ordenes add column if not exists oferta_precio_efectivo numeric;
-- Total BCV/general original cuando se aplicó el descuento por efectivo (el `total` ya
-- pasa a ser el efectivo; este se conserva para mostrar el ahorro en "Datos de la oferta").
alter table public.ordenes add column if not exists oferta_precio_bcv      numeric;
-- Marca de prioridad: ORDEN URGENTE (se refleja en el PDF y en toda la trazabilidad).
alter table public.ordenes add column if not exists urgente boolean not null default false;
-- Imagen de referencia adjunta a la OP (path en el bucket de adjuntos de OC).
alter table public.ordenes add column if not exists imagen_path text;

-- Abonos de compras a crédito (cada abono es un egreso real de caja vía pagarOrden).
create table if not exists public.abonos_credito (
  id          uuid primary key default gen_random_uuid(),
  orden_id    uuid not null references public.ordenes(id) on delete cascade,
  monto       numeric not null check (monto > 0),
  moneda      text not null default 'USD',
  caja_id     uuid references public.cajas(id) on delete set null,
  caja_mov_id uuid references public.movimientos_caja(id) on delete set null,
  saldo_restante numeric,            -- total - Σabonos tras este abono
  actor       text not null, actor_name text, nota text,
  comprobante_path text, comprobante_nombre text,
  comision_monto numeric,            -- comisión bancaria del abono (egreso extra de caja)
  comision_moneda text,
  at          timestamptz not null default now()
);
create index if not exists idx_abonos_orden on public.abonos_credito(orden_id, at);
alter table public.abonos_credito enable row level security;
create policy "abonos read auth"  on public.abonos_credito for select using (auth.role() = 'authenticated');
create policy "abonos write staff" on public.abonos_credito for all using (public.is_staff()) with check (public.is_staff());

-- Chat interno por Orden de Compra: hilo de seguimiento (gerente ↔ analista, etc.).
-- Realtime + contador de no leídos por usuario (jsonb leido_por).
create table if not exists public.oc_mensajes (
  id          uuid primary key default gen_random_uuid(),
  orden_id    uuid not null references public.ordenes(id) on delete cascade,
  texto       text not null check (length(btrim(texto)) > 0),
  autor       uuid,                                    -- auth.uid() del que escribe
  autor_email text,
  autor_nombre text,
  leido_por   jsonb not null default '[]'::jsonb,      -- ids de usuarios que ya lo leyeron
  created_at  timestamptz not null default now()
);
create index if not exists idx_oc_mensajes_orden on public.oc_mensajes(orden_id, created_at);
alter table public.oc_mensajes enable row level security;
create policy "oc_mensajes read auth" on public.oc_mensajes for select using (auth.role() = 'authenticated');
create policy "oc_mensajes write op"  on public.oc_mensajes for all using (public.is_operativo()) with check (public.is_operativo());
-- realtime: alter publication supabase_realtime add table public.oc_mensajes; (aplicado)

-- Personal (nómina): TODO el personal a pagar, tengan o no usuario del sistema.
-- "Usuarios" = los del login; "Personal" engloba a todos para la nómina. Se
-- administra y se paga desde Tesorería → Pago a personal.
create table if not exists public.personal (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  apellido     text not null default '',
  cedula       text,
  cargo        text,
  departamento text,
  sueldo_base  numeric not null default 0,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   text
);
-- Campos extra para el módulo RRHH (Fase 3 administrativo). Fase 1 conserva su estructura.
alter table public.personal add column if not exists fecha_ingreso date;
alter table public.personal add column if not exists datos_pago jsonb;
create index if not exists idx_personal_activo on public.personal(activo);
alter table public.personal enable row level security;
create policy "personal read auth"  on public.personal for select using (auth.role() = 'authenticated');
create policy "personal write staff" on public.personal for all using (public.is_staff()) with check (public.is_staff());

-- ─────────────────────────────────────────────────────────────
-- RRHH / Nómina
-- RRHH carga la nómina (quincenal, en USD con referencia a tasa BCV) y Tesorería
-- paga renglón por renglón (egreso real de caja, con seriales/comprobante como en OC).
-- ─────────────────────────────────────────────────────────────

-- Movimiento de caja: enlace al renglón de nómina pagado (como ref_orden_id para OC).
alter table public.movimientos_caja add column if not exists ref_nomina_renglon_id uuid;

-- Anticipos y préstamos: deducción con saldo (se descuenta por cuotas en la nómina).
create table if not exists public.anticipos_prestamos (
  id           uuid primary key default gen_random_uuid(),
  personal_id  uuid not null references public.personal(id) on delete cascade,
  tipo         text not null check (tipo in ('anticipo','prestamo')),
  monto_total  numeric not null check (monto_total > 0),
  saldo        numeric not null,            -- pendiente por descontar
  cuota_sugerida numeric,
  estado       text not null default 'activo' check (estado in ('activo','saldado')),
  motivo       text,
  creado_por   text, actor_name text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_anticipos_personal on public.anticipos_prestamos(personal_id, estado);
alter table public.anticipos_prestamos enable row level security;
create policy "anticipos read auth"  on public.anticipos_prestamos for select using (auth.role() = 'authenticated');
create policy "anticipos write staff" on public.anticipos_prestamos for all using (public.is_staff()) with check (public.is_staff());

-- Nómina: período (una por quincena) cargado desde RRHH.
create table if not exists public.nomina_periodos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null,              -- NOM-AAAA-NNNN
  tipo          text not null default 'quincena',
  periodo_desde date, periodo_hasta date,
  dias_base     int not null default 15,
  tasa_bcv      numeric,                    -- tasa BCV del día de carga (referencia)
  estado        text not null default 'cargada' check (estado in ('cargada','en_pago','pagada')),
  total_usd     numeric not null default 0,
  notas         text,
  creada_por    text, actor_name text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_nomina_periodos_estado on public.nomina_periodos(estado, created_at desc);
alter table public.nomina_periodos enable row level security;
create policy "nomina_per read auth"  on public.nomina_periodos for select using (auth.role() = 'authenticated');
create policy "nomina_per write staff" on public.nomina_periodos for all using (public.is_staff()) with check (public.is_staff());

-- Renglón de nómina = pago individual de cada persona (su histórico quincenal).
-- Cálculo: salario_bruto = sueldo_base_mensual/30 × dias_trabajados;
-- neto_usd = salario_bruto + asignaciones(bonos) − (anticipos + préstamos + ivss + faov).
-- IVSS/FAOV/bonos quedan montados (campos) pero hoy en 0 (deshabilitados en la UI).
create table if not exists public.nomina_renglones (
  id            uuid primary key default gen_random_uuid(),
  periodo_id    uuid not null references public.nomina_periodos(id) on delete cascade,
  personal_id   uuid references public.personal(id) on delete set null,
  nombre        text not null,
  cargo         text, departamento text,
  sueldo_base_mensual numeric not null default 0,
  dias_trabajados numeric not null default 15,
  salario_bruto numeric not null default 0,
  asignaciones  numeric not null default 0,   -- bonos (futuro)
  deduc_anticipos numeric not null default 0,
  deduc_prestamos numeric not null default 0,
  deduc_ivss    numeric not null default 0,    -- futuro
  deduc_faov    numeric not null default 0,    -- futuro
  deducciones   jsonb not null default '[]'::jsonb,  -- [{id,tipo,monto}] origen de cada deducción
  neto_usd      numeric not null default 0,
  estado        text not null default 'por_pagar' check (estado in ('por_pagar','pagada')),
  pagada_por    text, pagada_en timestamptz,
  caja_id       uuid references public.cajas(id) on delete set null,
  caja_mov_id   uuid references public.movimientos_caja(id) on delete set null,
  monto_pagado  numeric, moneda_pago text, tasa_pago numeric,
  seriales_billetes text[],
  comprobante_path text, comprobante_nombre text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_nom_reng_periodo  on public.nomina_renglones(periodo_id);
create index if not exists idx_nom_reng_estado   on public.nomina_renglones(estado);
create index if not exists idx_nom_reng_personal on public.nomina_renglones(personal_id, created_at desc);
alter table public.nomina_renglones enable row level security;
create policy "nomina_ren read auth"  on public.nomina_renglones for select using (auth.role() = 'authenticated');
create policy "nomina_ren write staff" on public.nomina_renglones for all using (public.is_staff()) with check (public.is_staff());

-- Fase 3 administrativo: vacaciones, permisos, utilidades/aguinaldos, notas/historial laboral.
create table if not exists public.rrhh_eventos (
  id           uuid primary key default gen_random_uuid(),
  personal_id  uuid not null references public.personal(id) on delete cascade,
  tipo         text not null check (tipo in ('vacacion','permiso','utilidad','nota')),
  fecha_desde  date, fecha_hasta date,
  dias         numeric,
  monto        numeric,
  descripcion  text,
  estado       text not null default 'registrado',
  procesada    boolean not null default false,   -- vacación ya enviada a Tesorería (pago)
  nomina_renglon_id uuid,                         -- renglón generado al procesar la vacación
  creado_por   text, actor_name text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_rrhh_eventos_personal on public.rrhh_eventos(personal_id, tipo, created_at desc);
alter table public.rrhh_eventos enable row level security;
create policy "rrhh_ev read auth"  on public.rrhh_eventos for select using (auth.role() = 'authenticated');
create policy "rrhh_ev write staff" on public.rrhh_eventos for all using (public.is_staff()) with check (public.is_staff());

-- Storage: bucket privado `nomina-comprobantes` para los comprobantes de pago de nómina.
insert into storage.buckets (id, name, public) values ('nomina-comprobantes','nomina-comprobantes', false) on conflict (id) do nothing;
create policy "nomina read auth"   on storage.objects for select to authenticated using (bucket_id = 'nomina-comprobantes');
create policy "nomina write staff"  on storage.objects for insert to authenticated with check (bucket_id = 'nomina-comprobantes' and public.is_staff());
create policy "nomina update staff" on storage.objects for update to authenticated using (bucket_id = 'nomina-comprobantes' and public.is_staff());
create policy "nomina delete staff" on storage.objects for delete to authenticated using (bucket_id = 'nomina-comprobantes' and public.is_staff());

-- Storage: bucket privado `ofertas-pdf` para las cotizaciones de los proveedores.
-- Acepta PDF o IMAGEN (foto de la cotización): allowed_mime_types incluye image/* para
-- no rechazar PNG/JPG/WEBP en el servidor. Límite 10 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ofertas-pdf','ofertas-pdf', false, 10485760, array['application/pdf','image/*'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
-- Escritura/lectura para cualquier usuario AUTENTICADO (el bucket es privado). Se quitó
-- el is_staff() del INSERT/UPDATE/DELETE: era redundante (is_staff = cualquier registrado)
-- y al subir varias imágenes daba "invalid policy". Basta con que esté logueado.
drop policy if exists "ofertas-pdf write admin"  on storage.objects;
drop policy if exists "ofertas-pdf update admin"  on storage.objects;
drop policy if exists "ofertas-pdf delete admin"  on storage.objects;
drop policy if exists "ofertas-pdf write staff"  on storage.objects;
drop policy if exists "ofertas-pdf update staff" on storage.objects;
drop policy if exists "ofertas-pdf delete staff" on storage.objects;
create policy "ofertas-pdf write auth"  on storage.objects for insert to authenticated
  with check (bucket_id = 'ofertas-pdf');
create policy "ofertas-pdf update auth" on storage.objects for update to authenticated
  using (bucket_id = 'ofertas-pdf') with check (bucket_id = 'ofertas-pdf');
create policy "ofertas-pdf delete auth" on storage.objects for delete to authenticated
  using (bucket_id = 'ofertas-pdf');

-- ─────────────────────────────────────────────────────────────
-- 10. updated_at automático
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare
  t text;
begin
  for t in select unnest(array['usuarios', 'proveedores', 'productos', 'ordenes', 'facturas']) loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end$$;

-- ─────────────────────────────────────────────────────────────
-- 11. RLS · política simple para FASE 0
--     - Cualquier usuario autenticado puede leer todo.
--     - Solo admin puede escribir (insert/update/delete).
--     - La tabla usuarios tiene reglas específicas.
-- ─────────────────────────────────────────────────────────────
alter table public.usuarios       enable row level security;
alter table public.proveedores    enable row level security;
alter table public.productos      enable row level security;
alter table public.movimientos    enable row level security;
alter table public.ordenes        enable row level security;
alter table public.facturas       enable row level security;
alter table public.notificaciones enable row level security;
alter table public.config         enable row level security;
alter table public.almacenes      enable row level security;
alter table public.hornos         enable row level security;
alter table public.cajas          enable row level security;
alter table public.movimientos_caja enable row level security;
alter table public.existencias    enable row level security;
alter table public.produccion     enable row level security;
alter table public.produccion_materiales enable row level security;

-- Helper: ¿el usuario actual es admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and role = 'admin');
$$;

-- usuarios
drop policy if exists "usuarios self read" on public.usuarios;
create policy "usuarios self read" on public.usuarios for select using (auth.uid() = id);

drop policy if exists "usuarios admin all" on public.usuarios;
create policy "usuarios admin all" on public.usuarios for all using (public.is_admin());

-- proveedores, productos, movimientos, ordenes, facturas, config:
-- read = cualquiera autenticado · write = admin
do $$
declare t text;
begin
  for t in select unnest(array['proveedores', 'productos', 'movimientos', 'ordenes', 'facturas', 'config', 'almacenes', 'hornos', 'cajas', 'movimientos_caja', 'existencias', 'produccion', 'produccion_materiales']) loop
    execute format('drop policy if exists "%I read auth" on public.%I', t, t);
    execute format('create policy "%I read auth" on public.%I for select using (auth.role() = ''authenticated'')', t, t);

    execute format('drop policy if exists "%I write admin" on public.%I', t, t);
    execute format('create policy "%I write admin" on public.%I for all using (public.is_admin())', t, t);
  end loop;
end$$;

-- Helper: ¿el usuario actual puede escribir? (cualquier usuario registrado).
-- El control de acceso POR MÓDULO vive en el front (matriz de permisos
-- `roles_permisos` + custom_roles): la app oculta lo que el rol no puede usar.
-- RLS es un gate pragmático: distingue "usuario legítimo" de "anónimo". Antes
-- enumeraba roles fijos ('admin','analista','obrero') y rompía con cada rol
-- nuevo (analista_tesoreria, jefa_de_rrhh, jefe_de_administracion, etc.), que
-- quedaban sin poder escribir nada. is_staff e is_operativo son equivalentes:
-- cualquier usuario en `usuarios`. is_admin() sigue siendo estricto (solo admin).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid());
$$;

create or replace function public.is_operativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid());
$$;

-- Directorio mínimo de usuarios activos (id, nombre, apellido, cargo) legible por
-- cualquier autenticado. La tabla usuarios tiene RLS de "solo tu fila"; esta
-- función SECURITY DEFINER expone solo datos no sensibles para elegir destinatario
-- (módulo Salidas · "a quién va dirigido" → Persona).
create or replace function public.directorio_usuarios()
returns table(id uuid, nombre text, apellido text, cargo text)
language sql stable security definer set search_path = public as $$
  select id, nombre, coalesce(apellido,''), coalesce(nullif(departamento,''), role::text)
  from public.usuarios
  where estado = 'activo'
  order by nombre, apellido;
$$;
grant execute on function public.directorio_usuarios() to authenticated, anon;

-- ordenes (pedidos): el ciclo de negocio (crear solicitud, aprobar, recibir,
-- finalizar) lo ejecutan analistas y obreros desde el cliente, no solo el admin.
-- Por eso permitimos escritura a cualquier autenticado (los guards de rol viven
-- en el front). El obrero debe poder CREAR su OP y FINALIZARLA.
drop policy if exists "ordenes write admin" on public.ordenes;
drop policy if exists "ordenes write auth"  on public.ordenes;
create policy "ordenes write auth" on public.ordenes for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Tablas exclusivas del ciclo de compras: escritura para STAFF (admin o analista).
do $$
declare t text;
begin
  for t in select unnest(array['proveedores', 'ofertas_proveedor', 'evaluaciones_recepcion']) loop
    execute format('drop policy if exists "%I write admin" on public.%I', t, t);
    execute format('drop policy if exists "%I write staff" on public.%I', t, t);
    execute format('create policy "%I write staff" on public.%I for all using (public.is_staff()) with check (public.is_staff())', t, t);
  end loop;
end$$;

-- Tablas operativas (inventario + producción): escritura para OPERATIVO
-- (admin, analista u obrero). El obrero trabaja inventario y producción.
do $$
declare t text;
begin
  for t in select unnest(array['movimientos', 'productos', 'existencias', 'almacenes', 'produccion', 'produccion_materiales', 'hornos', 'cajas', 'movimientos_caja']) loop
    execute format('drop policy if exists "%I write admin" on public.%I', t, t);
    execute format('drop policy if exists "%I write staff" on public.%I', t, t);
    execute format('drop policy if exists "%I write operativo" on public.%I', t, t);
    execute format('create policy "%I write operativo" on public.%I for all using (public.is_operativo()) with check (public.is_operativo())', t, t);
  end loop;
end$$;

-- facturas: el módulo de facturación lo usan analistas/tesorería, no solo el
-- admin. Escritura para cualquier usuario registrado (la matriz del front decide
-- quién ve el módulo); antes era is_admin() y bloqueaba a usuarios con permiso.
drop policy if exists "facturas write admin"     on public.facturas;
drop policy if exists "facturas write operativo" on public.facturas;
create policy "facturas write operativo" on public.facturas for all
  using (public.is_operativo()) with check (public.is_operativo());

-- productos: además de la escritura operativa, permitimos que cualquier
-- autenticado INSERTE un producto (alta rápida de "producto nuevo" desde una
-- solicitud de pedido).
drop policy if exists "productos insert auth" on public.productos;
create policy "productos insert auth" on public.productos for insert
  with check (auth.role() = 'authenticated');

-- notificaciones:
--   SELECT: cualquier autenticado puede leer las que matchean su rol o 'all'.
--   INSERT: cualquier autenticado puede crear notificaciones (necesario para auto-alertas
--           de stock que disparan los clientes — el front del admin las inserta on-mount).
--   UPDATE: cualquier autenticado puede marcar como leídas las que puede ver.
--   DELETE: solo admin.
drop policy if exists "notif read role"  on public.notificaciones;
drop policy if exists "notif write admin" on public.notificaciones;
drop policy if exists "notif insert auth" on public.notificaciones;
drop policy if exists "notif update auth" on public.notificaciones;
drop policy if exists "notif delete admin" on public.notificaciones;

create policy "notif read role" on public.notificaciones for select using (
  destino = 'all'
  or destino = (select role::text from public.usuarios where id = auth.uid())
);

create policy "notif insert auth" on public.notificaciones for insert
  with check (auth.role() = 'authenticated');

create policy "notif update auth" on public.notificaciones for update using (
  destino = 'all'
  or destino = (select role::text from public.usuarios where id = auth.uid())
);

create policy "notif delete admin" on public.notificaciones for delete using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 12. Promover admin@gmail.com a rol admin
-- (Correr después de crear el usuario en Authentication → Users)
-- ─────────────────────────────────────────────────────────────
update public.usuarios
   set role = 'admin', nombre = 'Administrador MGG'
 where email = 'admin@gmail.com';

-- ─────────────────────────────────────────────────────────────
-- 13. Respaldo de datos (.sql)
-- Función SECURITY DEFINER que recorre todas las tablas BASE de `public`
-- y devuelve un script SQL con los INSERT (ON CONFLICT DO NOTHING).
-- Valida por dentro que el solicitante sea admin o analista (auth.uid()).
-- El front la invoca con supabase.rpc('dump_database_sql') para:
--   · Respaldo MANUAL: botón "Respaldo de Data" en el menú lateral.
--   · Respaldo AUTOMÁTICO: cada 30 días al entrar un admin/analista
--     (la fecha del último respaldo se guarda en config key 'backup.ultimo').
-- ─────────────────────────────────────────────────────────────
create or replace function public.dump_database_sql()
returns text
language plpgsql
security definer
set search_path = public
as $func$
declare
  t record; r jsonb; k text; v jsonb; cols text; vals text; out text := '';
begin
  if not exists (select 1 from public.usuarios where id = auth.uid() and role in ('admin','analista')) then
    raise exception 'Solo un administrador o analista puede generar el respaldo de datos.';
  end if;
  out := '-- MGG-Inventario · Respaldo de DATOS · ' || now()::text || chr(10)
       || '-- Restaurar sobre el esquema base (supabase/schema.sql).' || chr(10) || chr(10);
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  loop
    out := out || '-- ===== ' || t.table_name || ' =====' || chr(10);
    for r in execute format('select to_jsonb(x) from public.%I x', t.table_name) loop
      cols := ''; vals := '';
      for k, v in select key, value from jsonb_each(r) loop
        if cols <> '' then cols := cols || ', '; vals := vals || ', '; end if;
        cols := cols || quote_ident(k);
        if v is null or jsonb_typeof(v) = 'null' then vals := vals || 'NULL';
        elsif jsonb_typeof(v) = 'number'  then vals := vals || (v #>> '{}');
        elsif jsonb_typeof(v) = 'boolean' then vals := vals || (v #>> '{}');
        elsif jsonb_typeof(v) in ('object','array') then vals := vals || quote_literal(v::text) || '::jsonb';
        else vals := vals || quote_literal(v #>> '{}'); end if;
      end loop;
      out := out || format('INSERT INTO public.%I (%s) VALUES (%s) ON CONFLICT DO NOTHING;', t.table_name, cols, vals) || chr(10);
    end loop;
    out := out || chr(10);
  end loop;
  return out;
end;
$func$;
revoke all on function public.dump_database_sql() from public, anon;
grant execute on function public.dump_database_sql() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 14. Centro de Acopio PERAMANAL · Control de recepción de mineral
-- Maestro (acopio_recepciones) + detalle (acopio_recepcion_lotes).
-- Réplica del formato Excel "CONTROL DE RECEPCIÓN POR CENTRO DE ACOPIO":
-- los 3 cálculos (peso bruto, diferencia bruto-neto, diferencia neto-
-- recepcionado) viven como columnas GENERADAS en la base. Al CERRAR una
-- recepción se suma el mineral al inventario (producto/almacén elegido)
-- vía el kardex; al ANULAR se revierte.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.acopio_recepciones (
  id               uuid primary key default gen_random_uuid(),
  numero           text not null unique,                 -- correlativo REC-AAAA-NNNN
  fecha            date not null default current_date,
  centro_acopio    text,
  aliado           text,
  -- Stock: el mineral recibido se suma a este producto/almacén del inventario.
  producto_id      uuid references public.productos(id),
  almacen          text,
  entregado_nombre text, entregado_ci text,
  recibido_nombre  text, recibido_ci  text,
  observaciones    text,
  estado           text not null default 'abierta'
                     check (estado in ('abierta','cerrada','anulada')),
  mov_id           uuid,
  mov_producto_id  uuid,
  mov_almacen      text,
  mov_cantidad     numeric,
  cerrada_por      text, cerrada_en  timestamptz,
  anulada_por      text, anulada_en  timestamptz,
  created_by       text,
  actor_name       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table if not exists public.acopio_recepcion_lotes (
  id                   uuid primary key default gen_random_uuid(),
  recepcion_id         uuid not null references public.acopio_recepciones(id) on delete cascade,
  orden                int  not null default 0,
  nro_lote             text,
  cantidad_bolsas      numeric not null default 0,
  peso_bolsa_kg        numeric not null default 0,
  peso_bruto_total     numeric generated always as
                         (coalesce(cantidad_bolsas,0) * coalesce(peso_bolsa_kg,0)) stored,
  peso_neto_kg         numeric not null default 0,
  dif_bruto_neto       numeric generated always as
                         (coalesce(cantidad_bolsas,0) * coalesce(peso_bolsa_kg,0) - coalesce(peso_neto_kg,0)) stored,
  precinto_inicio      text,
  peso_recepcionado_kg numeric not null default 0,
  dif_neto_recepcionado numeric generated always as
                         (coalesce(peso_neto_kg,0) - coalesce(peso_recepcionado_kg,0)) stored,
  precinto_final       text,
  -- 🧮 Verf. = IF(precinto_inicio = precinto_final, 'V', 'F') del Excel:
  -- el sello (precinto) de inicio debe coincidir con el de fin → no manipulado.
  verificado           boolean generated always as
                         (precinto_inicio is not distinct from precinto_final) stored,
  created_at           timestamptz not null default now()
);
create index if not exists idx_acopio_lotes_recepcion on public.acopio_recepcion_lotes(recepcion_id);

alter table public.acopio_recepciones     enable row level security;
alter table public.acopio_recepcion_lotes enable row level security;
do $$
declare t text;
begin
  for t in select unnest(array['acopio_recepciones','acopio_recepcion_lotes']) loop
    execute format('drop policy if exists "%I read auth" on public.%I', t, t);
    execute format('create policy "%I read auth" on public.%I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "%I write auth" on public.%I', t, t);
    execute format('create policy "%I write auth" on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t, t);
  end loop;
end$$;

-- Realtime
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_recepciones') then
    alter publication supabase_realtime add table public.acopio_recepciones;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_recepcion_lotes') then
    alter publication supabase_realtime add table public.acopio_recepcion_lotes;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────
-- 14b. Centro de Acopio · CONTRATOS de producción + catálogo de lugares
-- Botón "Crear contrato": correlativo "Producción GT-01", fecha+hora
-- automáticas y lugar de extracción tomado de un catálogo editable
-- (alta/edición/borrado), igual que los catálogos de combustible.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.acopio_catalogos (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('lugar_extraccion','supervisor')),
  valor      text not null,
  activo     boolean not null default true,
  orden      int not null default 999,
  created_at timestamptz not null default now(),
  unique (tipo, valor)
);
create table if not exists public.acopio_contratos (
  id               uuid primary key default gen_random_uuid(),
  numero           text not null unique,           -- "Producción GT-01"
  seq              int  not null,                  -- correlativo numérico
  fecha            date not null default current_date,
  hora             text,                           -- "8:02:00 AM" (hora Venezuela)
  supervisor       text,                           -- Supervisor de Producción (obligatorio en UI)
  lugar_extraccion text,
  molino           text,                           -- Molino utilizado
  -- Inputs principales (réplica de la hoja del Excel):
  ton_procesadas   numeric not null default 0,     -- Ton procesadas (material primario)
  kg_humedo        numeric not null default 0,     -- Kg Peso húmedo
  kg_secos         numeric not null default 0,     -- Kg secos
  kg_seco_limpio   numeric not null default 0,     -- Kg seco, limpio (Casiterita final = Kg seco Limpio Finales)
  -- Enlace con el inventario: al CERRAR, la casiterita (kg_seco_limpio) entra como
  -- stock del producto 'Casiterita'. Se guarda la traza para revertir al reabrir.
  mov_id           uuid,
  mov_producto_id  uuid,
  mov_almacen      text,
  mov_cantidad     numeric,
  -- Fórmulas automáticas (idénticas al Excel; NULLIF evita división por cero):
  tolva                       numeric generated always as (ton_procesadas / 1.2) stored,
  pct_recuperado_impurezas    numeric generated always as (kg_humedo / nullif(ton_procesadas * 1000, 0)) stored,
  pct_humedad                 numeric generated always as (kg_secos / nullif(kg_humedo, 0) - 1) stored,
  pct_recuperacion_casiterita numeric generated always as (kg_seco_limpio / nullif(ton_procesadas * 1000, 0)) stored,
  kg_hierro                   numeric generated always as (kg_seco_limpio - kg_secos) stored,
  pct_hierro                  numeric generated always as ((kg_seco_limpio - kg_secos) / nullif(kg_secos, 0)) stored,
  -- KG MESAS (merma por humedad): inputs manuales + fórmulas. Admite negativos.
  mesa_peso_mojado numeric,                          -- Pesos Mojado (manual, 2 dec)
  mesa_peso_seco   numeric,                           -- Pesos Seco (manual, 2 dec)
  mesa_merma_kg    numeric generated always as (mesa_peso_seco - mesa_peso_mojado) stored,
  mesa_pct_merma   numeric generated always as ((mesa_peso_seco - mesa_peso_mojado) / nullif(mesa_peso_mojado, 0) * 100) stored,
  estado           text not null default 'activo'
                     check (estado in ('activo','cerrado')),
  cerrado_at       timestamptz,
  cerrado_por      text,
  observaciones    text,
  created_by       text,
  actor_name       text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_acopio_contratos_seq on public.acopio_contratos(seq desc);

alter table public.acopio_catalogos enable row level security;
alter table public.acopio_contratos enable row level security;
do $$
declare t text;
begin
  for t in select unnest(array['acopio_catalogos','acopio_contratos']) loop
    execute format('drop policy if exists "%I read auth" on public.%I', t, t);
    execute format('create policy "%I read auth" on public.%I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "%I write auth" on public.%I', t, t);
    execute format('create policy "%I write auth" on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t, t);
  end loop;
end$$;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_catalogos') then
    alter publication supabase_realtime add table public.acopio_catalogos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_contratos') then
    alter publication supabase_realtime add table public.acopio_contratos;
  end if;
end$$;

-- Producto destino de la casiterita de los contratos (al cerrar suma su stock).
insert into public.productos (sku, nombre, categoria, unidad, almacen, tipo, estado)
values ('CASITERITA', 'Casiterita', 'Mineral', 'Kg', 'PRODUCCION', 'final', 'activo')
on conflict (sku) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 15. Centro de Acopio · CAJA PERAMANAL
-- Libro de caja (réplica de la hoja "CAJA PERAMANAL - GOLDEN TOUCH").
-- Cada movimiento se clasifica en uno de los 5 grupos de la hoja
-- CLASIFICACIONES. La TASA del material se deriva en el front:
--   tasa = (Σ facturados + Σ gastos + Σ nominas) / Σ kg_cerrados
-- Los saldos corrientes (K/M del Excel) también se calculan en el front.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.acopio_clasificaciones (
  id     uuid primary key default gen_random_uuid(),
  grupo  text not null check (grupo in ('contratos','gastos_caja','movimientos_caja','nomina','traslado')),
  valor  text not null,
  orden  int  not null default 0,
  activo boolean not null default true,
  unique (grupo, valor)
);
create table if not exists public.acopio_caja_movimientos (
  id              uuid primary key default gen_random_uuid(),
  fecha           date not null default current_date,
  descripcion     text,
  usd_entregado   numeric not null default 0,   -- D · entrada de caja
  kg_cerrados     numeric not null default 0,   -- E · Kg de casiterita cerrados
  facturados      numeric not null default 0,   -- G · $Usd facturados
  gastos          numeric not null default 0,   -- H · Gastos GT
  nominas         numeric not null default 0,   -- I · Nóminas GT
  traslado        numeric not null default 0,   -- J · Traslado de caja
  compra_material numeric not null default 0,   -- $ Compra de material (egreso · baja el Saldo $)
  kg_recibidos    numeric not null default 0,   -- L · Kg recibidos por MGG
  clasif_grupo    text check (clasif_grupo in ('contratos','gastos_caja','movimientos_caja','nomina','traslado')),
  clasif_valor    text,
  orden           int not null default 0,
  created_by      text,
  actor_name      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_acopio_caja_fecha on public.acopio_caja_movimientos(fecha, orden, created_at);

alter table public.acopio_clasificaciones  enable row level security;
alter table public.acopio_caja_movimientos enable row level security;
do $$
declare t text;
begin
  for t in select unnest(array['acopio_clasificaciones','acopio_caja_movimientos']) loop
    execute format('drop policy if exists "%I read auth" on public.%I', t, t);
    execute format('create policy "%I read auth" on public.%I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "%I write auth" on public.%I', t, t);
    execute format('create policy "%I write auth" on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t, t);
  end loop;
end$$;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_caja_movimientos') then
    alter publication supabase_realtime add table public.acopio_caja_movimientos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_clasificaciones') then
    alter publication supabase_realtime add table public.acopio_clasificaciones;
  end if;
end$$;

-- ============================================================
-- CONSUMO DE MARTILLOS (Molino H66) — hoja «CONSUMO MAZOS MARTILLOS GT»
-- ============================================================
create table if not exists public.acopio_martillos_movimientos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  descripcion text,
  usd_entregados numeric not null default 0,
  cantidad_entregados numeric not null default 0,
  usd_facturados numeric not null default 0,
  martillos_a_gt numeric not null default 0,
  consumidos numeric not null default 0,        -- martillos consumidos/usados (uso) → genera gasto en Acopio
  orden int not null default 0,
  created_by text,
  actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_acopio_martillos_fecha on public.acopio_martillos_movimientos(fecha, orden, created_at);
alter table public.acopio_martillos_movimientos enable row level security;
do $$ begin
  drop policy if exists "mart read auth" on public.acopio_martillos_movimientos;
  create policy "mart read auth" on public.acopio_martillos_movimientos for select using (auth.role() = 'authenticated');
  drop policy if exists "mart write auth" on public.acopio_martillos_movimientos;
  create policy "mart write auth" on public.acopio_martillos_movimientos for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_martillos_movimientos') then
    alter publication supabase_realtime add table public.acopio_martillos_movimientos;
  end if;
end$$;

-- ============================================================
-- SINCRONIZACIÓN Acopio → Inventario (con trazabilidad)
-- · CASITERITA: el stock aumenta al CERRAR un contrato desde Producción
--   (cerrarContrato → registrarMovimiento), valorizado a la TASA de acopio
--   vigente en ese momento. No la maneja un trigger (la sincroniza el cierre).
-- · MARTILLOS: se reflejan como producto y su cantidad/costo se mantienen al día
--   por trigger desde el libro de martillos. Cada cambio queda como AJUSTE.
-- El helper _acopio_sync_producto registra el ajuste en la trazabilidad.
-- ============================================================
create or replace function public._acopio_sync_producto(
  p_sku text, p_nombre text, p_categoria text, p_unidad text, p_almacen text,
  p_target_stock numeric, p_costo numeric, p_detalle text
) returns void language plpgsql as $$
declare v_pid uuid; v_stock numeric; v_costo numeric; v_delta numeric;
begin
  select id into v_pid from public.productos where sku = p_sku;
  if v_pid is null then
    insert into public.productos (sku, nombre, categoria, unidad, almacen, tipo, estado)
    values (p_sku, p_nombre, p_categoria, p_unidad, p_almacen, 'final', 'activo') returning id into v_pid;
  end if;
  select stock, costo_promedio into v_stock, v_costo from public.existencias where producto_id = v_pid and almacen = p_almacen;
  v_stock := coalesce(v_stock, 0); v_costo := coalesce(v_costo, 0);
  if abs(p_target_stock - v_stock) < 0.0001 and abs(p_costo - v_costo) < 0.0001 then return; end if;
  v_delta := p_target_stock - v_stock;
  insert into public.movimientos (producto_id, tipo, delta, almacen, stock_antes, stock_despues, actor, ref_tipo, detalle, precio_unitario, costo_promedio, at)
  values (v_pid, 'ajuste', v_delta, p_almacen, v_stock, p_target_stock, 'acopio-sync', 'acopio_sync', p_detalle, p_costo, p_costo, now());
  insert into public.existencias (producto_id, almacen, stock, costo_promedio, updated_at)
  values (v_pid, p_almacen, p_target_stock, p_costo, now())
  on conflict (producto_id, almacen) do update set stock = excluded.stock, costo_promedio = excluded.costo_promedio, updated_at = now();
  update public.productos p set stock = coalesce((select sum(stock) from public.existencias e where e.producto_id = p.id), 0), precio = p_costo where p.id = v_pid;
end$$;

-- Inventario: el stock de martillos = Σ(entregados − a_gt − consumidos).
create or replace function public._trg_sync_martillos() returns trigger language plpgsql as $$
declare v_stock numeric; v_tasa numeric;
begin
  select coalesce(sum(cantidad_entregados - martillos_a_gt - consumidos),0),
         case when coalesce(sum(cantidad_entregados),0) > 0 then sum(usd_entregados)/sum(cantidad_entregados) else 0 end
    into v_stock, v_tasa from public.acopio_martillos_movimientos;
  perform public._acopio_sync_producto('MARTILLO-H66','Martillos Molino H66','Insumo','Unidad','PRODUCCION',
    v_stock, round(v_tasa,4), 'Sync martillos · precio '||round(v_tasa,2)||' $/u · restantes '||round(v_stock,2));
  return null;
end$$;

drop trigger if exists trg_sync_martillos on public.acopio_martillos_movimientos;
create trigger trg_sync_martillos after insert or update or delete on public.acopio_martillos_movimientos for each statement execute function public._trg_sync_martillos();

-- Vínculo del gasto generado por un consumo (para actualizar/borrar en cascada).
alter table public.acopio_caja_movimientos
  add column if not exists ref_martillo_id uuid
  references public.acopio_martillos_movimientos(id) on delete cascade;
create index if not exists idx_acopio_caja_ref_martillo on public.acopio_caja_movimientos(ref_martillo_id);

-- Gasto por consumo: cada movimiento con `consumidos` > 0 genera (o actualiza) un gasto en
-- la caja de Acopio (grupo Gastos Caja, clasif. "USO DE MARTILLOS") = consumidos × precio
-- vigente (Σ facturados / Σ cantidad entregados). Se ancla a la caja abierta (si hay).
create or replace function public._trg_martillo_gasto() returns trigger language plpgsql as $$
declare v_precio numeric; v_caja uuid; v_gasto numeric;
begin
  select case when coalesce(sum(cantidad_entregados),0) > 0
              then sum(usd_facturados)/sum(cantidad_entregados) else 0 end
    into v_precio from public.acopio_martillos_movimientos;
  delete from public.acopio_caja_movimientos where ref_martillo_id = new.id;
  if coalesce(new.consumidos,0) > 0 and v_precio > 0 then
    v_gasto := round(new.consumidos * v_precio, 2);
    select id into v_caja from public.acopio_cajas where estado = 'abierta' order by created_at desc limit 1;
    insert into public.acopio_caja_movimientos
      (fecha, descripcion, gastos, clasif_grupo, clasif_valor, caja_id, ref_martillo_id, created_by, actor_name)
    values
      (new.fecha,
       'USO DE MARTILLOS · ' || trim(to_char(new.consumidos,'FM999999990.##')) || ' u × ' || trim(to_char(round(v_precio,2),'FM999999990.00')) || ' $/u'
         || case when new.descripcion is not null and length(trim(new.descripcion)) > 0 then ' · ' || new.descripcion else '' end,
       v_gasto, 'gastos_caja', 'USO DE MARTILLOS', v_caja, new.id, new.created_by, new.actor_name);
  end if;
  return new;
end$$;

drop trigger if exists trg_martillo_gasto on public.acopio_martillos_movimientos;
create trigger trg_martillo_gasto after insert or update on public.acopio_martillos_movimientos for each row execute function public._trg_martillo_gasto();

-- Seed de las 5 clasificaciones (hoja CLASIFICACIONES del Excel).
-- Catálogo según la hoja "CLASIFICACION GASTOS" (CA LOS PIJIGUAOS / GMG): 3 grupos.
-- La nómina NO es un grupo aparte: sus categorías viven dentro de GASTOS.
insert into public.acopio_clasificaciones (grupo, valor, orden) values
  ('contratos','COMPRA CASITERITA',1),
  ('contratos','CASITERITA DEUDA - RUANO LÓPEZ',2),
  ('contratos','CASITERITA POR INSUMOS',3),
  ('contratos','CASITERITA DEUDA - ENDER MEJÍA',4),
  ('contratos','1. COMPRA CONTADO CASITERITA',20),
  ('contratos','2. COMPRA ALBERTO',21),
  ('contratos','3. COMPRA MAGUIBER',22),
  ('movimientos_caja','1. ENTRADA DE CAJA',1),
  ('movimientos_caja','2. C.MULTIMONEDAS MGG / CA LOS PIJIGUAOS',21),
  ('traslado','COMPRA CASITERITA CREDITOS - MAGUIBER',1),
  ('traslado','COMPRA CASITERITA CREDITOS - ALBERTO',2),
  ('traslado','COMPRA CASITERITA CREDITOS - CAMPOS YEPEZ',3),
  ('traslado','TRASPASO MULTIMONEDAS MGG',4),
  ('traslado','TRASPASO MINA 40 ALBERTO',5),
  ('movimientos_caja','2. CAJA MULTIMONEDA MGG - CA GMT',2),
  ('movimientos_caja','3. SAL-ENT C.MULTIMONEDA - CA GMT',3),
  ('movimientos_caja','2. CAJA MULTIMONEDAS - CA PERAMANAL',4),
  ('movimientos_caja','3. CAJA INVENTARIO MGG',5),
  ('movimientos_caja','2. CAJA MULTIMONEDA - CAJA LA ESMERALDA',13),
  ('gastos_caja','GASOLINA',1),
  ('gastos_caja','GASOIL',2),
  ('gastos_caja','VALES',3),
  ('gastos_caja','COMIDA - MERCADO - REFRIGERIOS',4),
  ('gastos_caja','NÓMINA GENERAL',5),
  ('gastos_caja','UTILIDAD COMERCIALIZADORES',6),
  ('gastos_caja','PAGO OBREROS',7),
  ('gastos_caja','PAGO AYUDANTE',8),
  ('gastos_caja','PAGO COCINERA',9),
  ('gastos_caja','SERVICIOS DE INTERNET - STARLINK',10),
  ('gastos_caja','VIÁTICOS: HOSPEDAJE - COMIDA - GASTOS VARIOS',11),
  ('gastos_caja','PAGO DE CALETEROS - SUBIDAS DE MATERIAL - LOGISTICA CAMPAMENTOS',12),
  ('gastos_caja','APOYOS - DONACIONES - COLABORACIONES',13),
  ('gastos_caja','AGUA POTABLE',14),
  ('gastos_caja','MATERIALES - INSUMOS VARIOS',15),
  ('gastos_caja','RECARGA DE BOMBONAS',16),
  ('gastos_caja','MOTO: REPUESTOS - REPARACIONES - SERVICIOS MOTOS',17),
  ('gastos_caja','MAQUINARIA PESADA: REPUESTOS - REPARACIONES - SERVICIOS',18),
  ('gastos_caja','MAQUINARIA LIVIANA: REPUESTOS - REPARACIONES - SERVICIOS',19),
  ('gastos_caja','VEHICULO: REPUESTOS - REPARACIONES - SERVICIOS',20),
  ('gastos_caja','REPARACIONES CENTRO DE ACOPIO',21)
on conflict (grupo, valor) do nothing;

-- ─────────────────────────────────────────────────────────────
-- LA ESMERALDA ALI · Reportes de pérdida (snapshot fiel del Excel)
--   seccion 'cuenta' → hoja «CUENTA DE PERDIDA CON ALI»
--       v1=monto factura $ · v2=kg entregados · v3=$/kg · v4=abono (kg valorizados) · v5=total deuda
--   seccion 'cuadro' → hoja «CUADRO RESUMEN DEL VALOR DE LA PERDIDA TOTAL»
--       v1=cantidad/kg · v2=precio $/kg · v3=subtotal $ · v4=monto $ (columna F)
--   estilo: normal | total | header | destacado
-- Datos congelados (período de pérdida cerrado); se muestran en dos vistas con «Volver».
-- ─────────────────────────────────────────────────────────────
create table if not exists public.acopio_esmeralda_perdida (
  id          uuid primary key default gen_random_uuid(),
  seccion     text not null check (seccion in ('cuenta','cuadro')),
  orden       int  not null default 0,
  etiqueta    text not null,
  descripcion text,
  v1 numeric, v2 numeric, v3 numeric, v4 numeric, v5 numeric,
  estilo      text not null default 'normal'
);
alter table public.acopio_esmeralda_perdida enable row level security;
drop policy if exists "esme_perdida read auth" on public.acopio_esmeralda_perdida;
create policy "esme_perdida read auth" on public.acopio_esmeralda_perdida for select using (auth.role() = 'authenticated');
drop policy if exists "esme_perdida write auth" on public.acopio_esmeralda_perdida;
create policy "esme_perdida write auth" on public.acopio_esmeralda_perdida for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_esmeralda_perdida') then
    alter publication supabase_realtime add table public.acopio_esmeralda_perdida;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 16. Centro de Acopio · Hojas del Excel (snapshot fiel de referencia)
-- Cada hoja del libro original se guarda como grilla (array de filas;
-- cada celda: {v texto, c color fondo, t color texto, b negrita, cs/rs
-- colspan/rowspan, x cubierta por merge}). Se renderiza como tabla fiel
-- y luego cada hoja relevante se "depura" hacia un módulo interactivo.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.acopio_hojas_excel (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  orden      int  not null default 0,
  cols       int  not null default 0,
  datos      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.acopio_hojas_excel enable row level security;
drop policy if exists "acopio_hojas_excel read auth" on public.acopio_hojas_excel;
create policy "acopio_hojas_excel read auth" on public.acopio_hojas_excel for select using (auth.role() = 'authenticated');
drop policy if exists "acopio_hojas_excel write auth" on public.acopio_hojas_excel;
create policy "acopio_hojas_excel write auth" on public.acopio_hojas_excel for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_hojas_excel') then
    alter publication supabase_realtime add table public.acopio_hojas_excel;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 17. Centro de Acopio · CUADRE DE CAJA (EFECTIVO)
-- Optimiza la hoja "Recepcion Caja GT Peramanal" (cuadre Sr. Cheli):
-- entrada de efectivo con conteo de billetes (verificación),
-- movimientos categorizados y control de vales/deudas pendientes.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.acopio_cuadres (
  id             uuid primary key default gen_random_uuid(),
  numero         text not null unique,
  fecha          date not null default current_date,
  fuente         text,
  responsable    text,
  monto_recibido numeric not null default 0,
  billetes       jsonb not null default '[]'::jsonb,   -- [{denom, cantidad}]
  verificado     boolean not null default false,
  observaciones  text,
  estado         text not null default 'abierto' check (estado in ('abierto','cerrado')),
  cerrado_por    text, cerrado_en timestamptz,
  created_by     text, actor_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create table if not exists public.acopio_cuadre_movimientos (
  id           uuid primary key default gen_random_uuid(),
  cuadre_id    uuid not null references public.acopio_cuadres(id) on delete cascade,
  fecha        date,
  tipo         text not null default 'salida' check (tipo in ('entrada','salida')),
  categoria    text,   -- nomina | adelanto_vale | compra_casiterita | compra_comida | refuerzo | traslado | otro
  descripcion  text,
  beneficiario text,
  monto        numeric not null default 0,
  monto_bs     numeric not null default 0,
  es_vale      boolean not null default false,
  pagado       boolean not null default true,
  nota         text,
  orden        int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_acopio_cuadre_mov on public.acopio_cuadre_movimientos(cuadre_id, orden, created_at);

alter table public.acopio_cuadres            enable row level security;
alter table public.acopio_cuadre_movimientos enable row level security;
do $$
declare t text;
begin
  for t in select unnest(array['acopio_cuadres','acopio_cuadre_movimientos']) loop
    execute format('drop policy if exists "%I read auth" on public.%I', t, t);
    execute format('create policy "%I read auth" on public.%I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "%I write auth" on public.%I', t, t);
    execute format('create policy "%I write auth" on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t, t);
  end loop;
end$$;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_cuadres') then
    alter publication supabase_realtime add table public.acopio_cuadres;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_cuadre_movimientos') then
    alter publication supabase_realtime add table public.acopio_cuadre_movimientos;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────
-- 18. Centro de Acopio · Cierres de Caja + Costos (2 niveles)
-- La Caja Peramanal pasa a tener períodos (cierres) con número,
-- rango de fechas y recepción; el RESUMEN del cierre se calcula en
-- el front (días, total gastado, % por categoría, tasa promedio).
-- Cada gasto puede llevar una clasificación de costo en 2 niveles
-- (Clasificación → Sub-clasificación) para el análisis de costos.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.acopio_costo_clases (
  id               uuid primary key default gen_random_uuid(),
  clasificacion    text not null,
  subclasificacion text not null,
  orden            int  not null default 0,
  activo           boolean not null default true,
  unique (clasificacion, subclasificacion)
);
create table if not exists public.acopio_cajas (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null,
  nombre        text,
  recepcion     text,
  fecha_inicio  date not null default current_date,
  fecha_fin     date,
  estado        text not null default 'abierta' check (estado in ('abierta','cerrada')),
  saldo_final   numeric,
  cerrada_por   text, cerrada_en timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Centro de acopio dueño de la caja (LA ESPERANZA, LOS PIJIGUAOS…). Cada centro ve
  -- solo lo suyo; el traspaso de Tesorería entra a la caja abierta de su centro.
  centro_nombre text
);
alter table public.acopio_cajas add column if not exists centro_nombre text;
update public.acopio_cajas set centro_nombre = 'LA ESPERANZA' where centro_nombre is null;
alter table public.acopio_caja_movimientos add column if not exists caja_id uuid references public.acopio_cajas(id) on delete set null;
alter table public.acopio_caja_movimientos add column if not exists costo_clasificacion text;
alter table public.acopio_caja_movimientos add column if not exists costo_subclasificacion text;
-- Vehículo/maquinaria (del catálogo de Combustible) al que se imputa el gasto cuando la
-- categoría es de REPUESTOS - REPARACIONES - SERVICIOS. Opcional ("no a juro").
alter table public.acopio_caja_movimientos add column if not exists vehiculo text;
-- $ Compra de material: egreso ingresado por el usuario que baja el Saldo $ de la caja.
alter table public.acopio_caja_movimientos add column if not exists compra_material numeric not null default 0;
create index if not exists idx_acopio_caja_mov_caja on public.acopio_caja_movimientos(caja_id);
create index if not exists idx_acopio_caja_mov_vehiculo on public.acopio_caja_movimientos(vehiculo);

insert into public.acopio_costo_clases (clasificacion, subclasificacion, orden) values
  ('Costos de Extracción y acarreo','Gastos de Nomina',1),
  ('Costos de Extracción y acarreo','Gastos de Combustible',2),
  ('Costos de Extracción y acarreo','Repuestos y Suministros de Maquinarias y Equipos',3),
  ('Costos de Extracción y acarreo','Gasto de Mantenimiento y Reparación de Maquinarias y Equipos',4)
on conflict (clasificacion, subclasificacion) do nothing;

alter table public.acopio_costo_clases enable row level security;
alter table public.acopio_cajas        enable row level security;
do $$
declare t text;
begin
  for t in select unnest(array['acopio_costo_clases','acopio_cajas']) loop
    execute format('drop policy if exists "%I read auth" on public.%I', t, t);
    execute format('create policy "%I read auth" on public.%I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "%I write auth" on public.%I', t, t);
    execute format('create policy "%I write auth" on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t, t);
  end loop;
end$$;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_cajas') then
    alter publication supabase_realtime add table public.acopio_cajas;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='acopio_costo_clases') then
    alter publication supabase_realtime add table public.acopio_costo_clases;
  end if;
end$$;

-- Almacén destino del Centro de Acopio LA ESPERANZA: el mineral recibido entra
-- DIRECTO al sub-almacén CASITERITA (anidado bajo el almacén LA ESPERANZA).
insert into public.almacenes (nombre, sede, estado) values ('LA ESPERANZA','LA ESPERANZA','activo')
  on conflict (nombre) do nothing;
insert into public.almacenes (nombre, sede, parent_id, estado)
  select 'CASITERITA','LA ESPERANZA',(select id from public.almacenes where nombre='LA ESPERANZA'),'activo'
  on conflict (nombre) do nothing;

-- ============================================================
-- Centro de Acopio · Sub-ledgers (Por aliado + Cuentas por cobrar)
-- Cada hoja del Excel («CENTRO ACOPIO - {ALIADO}» y «CUENTA POR COBRAR»)
-- es su propio libro con saldos corridos calculados en el front.
-- Integración: cada CIERRE de aliado genera un TRASLADO en la caja general
-- (acopio_caja_movimientos) y entra como USD ENTREGADO en el ledger del aliado.
-- Los Kg de un abono entran a stock de CASITERITA solo si se marca (opt-in).
-- ============================================================
create table if not exists public.acopio_aliados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  centro_nombre text not null default 'LA ESPERANZA',
  activo boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_acopio_aliados_nombre on public.acopio_aliados(centro_nombre, lower(nombre));

create table if not exists public.acopio_aliado_movimientos (
  id uuid primary key default gen_random_uuid(),
  aliado_id uuid not null references public.acopio_aliados(id) on delete cascade,
  fecha date not null,
  corte integer,
  tipo text not null default 'cierre' check (tipo in ('cierre','abono')),
  descripcion text,
  usd_entregado numeric not null default 0,   -- E
  kg_cerrados numeric not null default 0,      -- F (Kg comprometidos en el cierre)
  precio_usd_kg numeric not null default 0,    -- G  (H facturado = F*G se calcula en el front)
  kg_recibidos numeric not null default 0,     -- K (Kg entregados como abono)
  gastos numeric not null default 0,           -- salidas de gasto del aliado (plantilla Entrada/Salida/Gastos)
  caja_mov_id uuid references public.acopio_caja_movimientos(id) on delete set null, -- traslado reflejado en la caja general
  reflejo_casiterita boolean not null default false,
  recepcion_mov_id uuid,                       -- movimiento de inventario (entrada a CASITERITA) si aplicó
  orden integer not null default 0,
  -- Periodo de "caja" del aliado: la vista viva se acota al periodo abierto;
  -- los cerrados quedan en el historial (acopio_aliado_cierres).
  periodo integer not null default 1,
  created_by text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_acopio_aliadomov_aliado on public.acopio_aliado_movimientos(aliado_id, fecha, orden);
alter table public.acopio_aliado_movimientos add column if not exists periodo integer not null default 1;
create index if not exists idx_aliado_mov_periodo on public.acopio_aliado_movimientos(aliado_id, periodo);

-- Historial de cierres de caja por aliado (réplica del cierre de los centros:
-- el saldo $ arranca el periodo nuevo como apertura y el saldo en Kg/gramos pasa
-- al inventario —casiterita, u ORO en los aliados de oro— a la tasa del aliado).
create table if not exists public.acopio_aliado_cierres (
  id uuid primary key default gen_random_uuid(),
  aliado_id uuid not null references public.acopio_aliados(id) on delete cascade,
  periodo int not null,
  fecha_inicio date,
  fecha_fin date not null default current_date,
  saldo_usd numeric,
  saldo_kg numeric,
  tasa numeric,
  almacen text,
  inv_mov_id uuid,
  created_by text, actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_aliado_cierres_aliado on public.acopio_aliado_cierres(aliado_id);
alter table public.acopio_aliado_cierres enable row level security;

create table if not exists public.acopio_cuentas_cobrar (
  id uuid primary key default gen_random_uuid(),
  centro_nombre text not null default 'LA ESPERANZA',
  cliente text not null,
  descripcion text,                            -- "Venta de Camión NHR"
  monto_factura numeric not null default 0,    -- D inicial (deuda)
  precio_usd_kg numeric not null default 0,    -- F referencia $/Kg
  estado text not null default 'abierta' check (estado in ('abierta','saldada')),
  created_by text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.acopio_cobrar_abonos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.acopio_cuentas_cobrar(id) on delete cascade,
  fecha date not null,
  descripcion text,
  monto_factura numeric not null default 0,    -- D (normalmente 0; permite cargos extra a la deuda)
  kg_entregados numeric not null default 0,    -- E
  precio_usd_kg numeric not null default 0,    -- F  (G total usd = E*F se calcula en el front)
  reflejo_casiterita boolean not null default false,
  recepcion_mov_id uuid,
  orden integer not null default 0,
  created_by text, actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_acopio_cobrarabono_cuenta on public.acopio_cobrar_abonos(cuenta_id, fecha, orden);

alter table public.acopio_aliados            enable row level security;
alter table public.acopio_aliado_movimientos enable row level security;
alter table public.acopio_cuentas_cobrar     enable row level security;
alter table public.acopio_cobrar_abonos      enable row level security;
do $$ begin
  create policy "acopio_aliados read"  on public.acopio_aliados            for select using (auth.role()='authenticated');
  create policy "acopio_aliados write" on public.acopio_aliados            for all using (public.is_operativo()) with check (public.is_operativo());
  create policy "acopio_amov read"     on public.acopio_aliado_movimientos for select using (auth.role()='authenticated');
  create policy "acopio_amov write"    on public.acopio_aliado_movimientos for all using (public.is_operativo()) with check (public.is_operativo());
  create policy "acopio_cobrar read"   on public.acopio_cuentas_cobrar     for select using (auth.role()='authenticated');
  create policy "acopio_cobrar write"  on public.acopio_cuentas_cobrar     for all using (public.is_operativo()) with check (public.is_operativo());
  create policy "acopio_cabono read"   on public.acopio_cobrar_abonos      for select using (auth.role()='authenticated');
  create policy "acopio_cabono write"  on public.acopio_cobrar_abonos      for all using (public.is_operativo()) with check (public.is_operativo());
  create policy "acopio_aliado_cierres read"  on public.acopio_aliado_cierres for select using (auth.role()='authenticated');
  create policy "acopio_aliado_cierres write" on public.acopio_aliado_cierres for all using (public.is_operativo()) with check (public.is_operativo());
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.acopio_aliados;
  alter publication supabase_realtime add table public.acopio_aliado_movimientos;
  alter publication supabase_realtime add table public.acopio_cuentas_cobrar;
  alter publication supabase_realtime add table public.acopio_cobrar_abonos;
  alter publication supabase_realtime add table public.acopio_aliado_cierres;
exception when duplicate_object then null; end $$;

-- Catálogo de DESTINOS de un «Traslado de caja» del acopio (La Esperanza).
-- Al registrar un traslado se elige un destino y el monto se refleja como
-- «$Usd entregado» en ese destino:
--   · tipo 'aliado_interno' → inserta un movimiento en el ledger del aliado
--     (acopio_aliado_movimientos) de este mismo sistema. Directo, sin confirmar.
--   · tipo 'externo' → empuja una transferencia saliente por el puente
--     inter-sistema (transferencias_inter) a `empresa_codigo`; el otro sistema
--     la confirma (caja_externa_id = caja espejo local del centro externo).
create table if not exists public.acopio_destinos_traslado (
  id uuid primary key default gen_random_uuid(),
  centro_nombre text not null default 'LA ESPERANZA',
  nombre text not null,
  tipo text not null check (tipo in ('aliado_interno','externo')),
  aliado_id uuid references public.acopio_aliados(id) on delete set null,
  caja_externa_id uuid references public.cajas(id) on delete set null,
  empresa_codigo text,
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists idx_acopio_destinos_centro on public.acopio_destinos_traslado(centro_nombre, activo);
alter table public.acopio_destinos_traslado enable row level security;
do $$ begin
  create policy "destinos read auth"  on public.acopio_destinos_traslado for select using (auth.role()='authenticated');
  create policy "destinos write auth" on public.acopio_destinos_traslado for all using (auth.role()='authenticated') with check (auth.role()='authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.acopio_destinos_traslado;
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────
-- 19. Centro de Acopio · Resumen Semanal Casiterita (REPORTE PRELIMINAR)
-- Réplica de la hoja Excel «REPORTE PRELIMINAR DE CENTROS DE ACOPIOS».
-- Reporte semanal que se ARCHIVA a histórico (snapshot). Los datos los
-- ingresa el usuario por SECTOR (grupo de centros); `filas` guarda los
-- sectores con sus centros; `totales` el resumen calculado en el front.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.acopio_resumen_semanal (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null,
  titulo        text not null default 'REPORTE PRELIMINAR DE CENTROS DE ACOPIOS',
  periodo_desde date,
  periodo_hasta date,
  fecha         date not null default current_date,
  filas         jsonb not null default '[]'::jsonb,   -- [{ nombre, resguardos_gt, precio_prom, saldo_usd, centros:[{centro, kg_cobrar, kg_disponible}] }]
  totales       jsonb not null default '{}'::jsonb,    -- { kg_cobrar, kg_disponible, kg_resguardos_gt, kg_acopiado_mgg, saldo_usd }
  nota          text,
  created_by    text, actor_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_acopio_resumen_semanal_fecha on public.acopio_resumen_semanal(fecha desc, created_at desc);

-- Métrica vinculable: «Saldo en Kg» del acopio (misma fórmula que la tarjeta del
-- módulo). El Resumen Semanal la consume para autocompletar Disponibles vinculados.
-- El MISMO RPC existe en Golden Touch; la Edge Function `metricas-externas` lo lee
-- allá con la service-key de GT (secretos GT_URL / GT_SERVICE_KEY).
create or replace function public.metrica_acopio_saldo_kg()
returns numeric language sql security definer set search_path = public as $fn$
  -- Saldo en Kg del acopio LA ESPERANZA = Σ(kg_cerrados − kg_recibidos) de SUS cajas,
  -- idéntico a la tarjeta «Saldo en Kg» del módulo (resumirCaja, centro LA ESPERANZA).
  -- Se ACOTA al centro LA ESPERANZA para no sumar los demás centros que comparten la
  -- tabla acopio_caja_movimientos (GMT, LA ESMERALDA ALÍ, LOS PIJIGUAOS, PERAMANAL).
  select coalesce((
    select sum(coalesce(m.kg_cerrados,0) - coalesce(m.kg_recibidos,0))
    from public.acopio_caja_movimientos m
    join public.acopio_cajas c on c.id = m.caja_id
    where c.centro_nombre = 'LA ESPERANZA'
  ),0);
$fn$;
revoke all on function public.metrica_acopio_saldo_kg() from public;
grant execute on function public.metrica_acopio_saldo_kg() to authenticated, service_role;

alter table public.acopio_resumen_semanal enable row level security;
do $$ begin
  create policy "acopio_resumen_semanal read auth"  on public.acopio_resumen_semanal for select using (auth.role()='authenticated');
  create policy "acopio_resumen_semanal write auth" on public.acopio_resumen_semanal for all using (auth.role()='authenticated') with check (auth.role()='authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.acopio_resumen_semanal;
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────
-- 19b. Acceso biométrico (WebAuthn / Passkeys)
-- La huella/Face ID/Windows Hello NUNCA sale del dispositivo: aquí solo
-- se guarda la CLAVE PÚBLICA. La credencial queda atada al dominio (rp_id)
-- donde se enroló. La Edge Function `webauthn` (service role) registra/
-- verifica; el login con clave sigue siendo el respaldo.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.webauthn_credentials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  email         text not null,
  credential_id text not null unique,         -- id de la credencial (base64url)
  public_key    text not null,                -- clave pública (base64url)
  counter       bigint not null default 0,    -- contador anti-clonación
  rp_id         text not null,                -- dominio donde se enroló
  transports    text,                         -- csv (internal, hybrid…)
  device_label  text,                         -- etiqueta legible del dispositivo
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists idx_webauthn_cred_user     on public.webauthn_credentials(user_id);
create index if not exists idx_webauthn_cred_email_rp on public.webauthn_credentials(email, rp_id);

-- Retos efímeros (challenge) de registro/login. Solo la Edge Function (service role) los toca.
create table if not exists public.webauthn_challenges (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  kind       text not null check (kind in ('register','authenticate')),
  challenge  text not null,
  user_id    uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_webauthn_chal_lookup on public.webauthn_challenges(email, kind, created_at desc);

alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges  enable row level security;
do $$ begin
  create policy "webauthn_cred owner read"   on public.webauthn_credentials for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "webauthn_cred owner delete" on public.webauthn_credentials for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- webauthn_challenges: sin policies (deny-all a clientes; solo service role).
do $$ begin
  alter publication supabase_realtime add table public.webauthn_credentials;
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────
-- 20. Ventas · Clientes + Facturas
-- Factura con items (jsonb): producto, cantidad, tenor (ley del mineral),
-- precio, costo y ganancia por línea. Al EMITIR descuenta stock; al ANULAR
-- lo revierte. Totales (subtotal, descuento, IVA, total, costo, ganancia,
-- % de ganancia) viven en la cabecera.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rif text, telefono text, email text, direccion text,
  activo boolean not null default true,
  nota text,
  created_by text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_clientes_nombre on public.clientes(nombre);

create table if not exists public.ventas (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  fecha date not null default current_date,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nombre text,
  estado text not null default 'borrador' check (estado in ('borrador','emitida','pagada','anulada')),
  moneda text not null default 'USD',
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  descuento numeric not null default 0,
  iva_pct numeric not null default 0,
  iva_monto numeric not null default 0,
  total numeric not null default 0,
  costo_total numeric not null default 0,
  ganancia numeric not null default 0,
  ganancia_pct numeric not null default 0,
  metodo_pago text,
  pagado_monto numeric not null default 0,
  vendedor text,
  nota text,
  emitida_en timestamptz, emitida_por text,
  created_by text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ventas_fecha   on public.ventas(fecha desc, created_at desc);
create index if not exists idx_ventas_estado  on public.ventas(estado);
create index if not exists idx_ventas_cliente on public.ventas(cliente_id);

alter table public.clientes enable row level security;
alter table public.ventas   enable row level security;
do $$ begin
  create policy "clientes read auth"  on public.clientes for select using (auth.role()='authenticated');
  create policy "clientes write auth" on public.clientes for all using (auth.role()='authenticated') with check (auth.role()='authenticated');
  create policy "ventas read auth"    on public.ventas   for select using (auth.role()='authenticated');
  create policy "ventas write auth"   on public.ventas   for all using (auth.role()='authenticated') with check (auth.role()='authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.clientes;
  alter publication supabase_realtime add table public.ventas;
exception when duplicate_object then null; end $$;

-- ============================================================
-- RECEPCIONES · paso intermedio acopio → inventario
-- Al cerrar la caja de un centro/aliado de acopio, el saldo en Kg de
-- casiterita NO entra directo al inventario: se crea una RECEPCIÓN
-- (peso + procedencia). El laboratorio carga sus análisis por mineral
-- configurable (RECEPCIÓN GLOBAL LABORATORIO). El ingreso al inventario
-- se hará luego (paso posterior).
-- ============================================================
-- La vista es por TARJETA de recepción (como Combustible). Hay una GENERAL y
-- se pueden añadir más; todas las tablas de datos llevan grupo_id.
create table if not exists public.recepcion_grupos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  orden int not null default 0,
  es_general boolean not null default false,
  nota text,
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.recepcion_grupos enable row level security;
create policy "rec_grupos read auth" on public.recepcion_grupos for select using (auth.role()='authenticated');
create policy "rec_grupos write op"  on public.recepcion_grupos for all using (public.is_operativo()) with check (public.is_operativo());
insert into public.recepcion_grupos (nombre, orden, es_general)
select 'RECEPCIÓN GENERAL', 0, true
where not exists (select 1 from public.recepcion_grupos where es_general);

create table if not exists public.recepciones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references public.recepcion_grupos(id) on delete cascade,
  item int not null,
  fecha timestamptz not null default now(),
  peso_kg numeric not null default 0,
  tasa numeric,                                   -- tasa del cierre (USD/Kg) para precargar Totales
  procedencia text not null default '',           -- centro o aliado, en MAYÚSCULAS (editable)
  centro_nombre text,
  origen text not null default 'manual' check (origen in ('cierre_caja','cierre_aliado','manual')),
  ref_caja_id uuid,
  ref_aliado_id uuid,
  nota text,
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_recepciones_item on public.recepciones(item);
alter table public.recepciones enable row level security;
create policy "recepciones read auth" on public.recepciones for select using (auth.role()='authenticated');
create policy "recepciones write op"  on public.recepciones for all using (public.is_operativo()) with check (public.is_operativo());

-- Minerales configurables (columnas del laboratorio). modo: abc=A/B/C/Prom · prom=solo Prom (ej. UCV)
create table if not exists public.recepcion_minerales (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  nombre text not null,
  subtitulo text,
  modo text not null default 'abc' check (modo in ('abc','prom')),
  color text,
  orden int not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.recepcion_minerales enable row level security;
create policy "rec_min read auth" on public.recepcion_minerales for select using (auth.role()='authenticated');
create policy "rec_min write op"  on public.recepcion_minerales for all using (public.is_operativo()) with check (public.is_operativo());
insert into public.recepcion_minerales (clave, nombre, subtitulo, modo, color, orden) values
  ('sn','Sn (Estaño)','Laboratorio Mineral Group','abc','#f5c542',1),
  ('ucv','UCV',null,'prom','#e0a92e',2),
  ('fe','Fe (Hierro)',null,'abc','#fbe0c3',3),
  ('ti','Ti (Titanio)',null,'abc','#bcdcf2',4),
  ('ta','Ta (Tántalo)',null,'abc','#d8cce8',5),
  ('nb','Nb (Niobio)',null,'abc','#bfe0bf',6),
  ('v','V (Vanadio)',null,'abc','#d9a7bd',7),
  ('zr','Zr (Circonio)',null,'abc','#7fa7b0',8),
  ('bal','Bal (estéril)',null,'abc','#f0a868',9),
  ('mn','Mn (Manganeso)',null,'abc','#f0c419',10),
  ('hf','Hf (hafnio)',null,'abc','#6aa9d8',11)
on conflict (clave) do nothing;

-- Análisis de laboratorio (RECEPCIÓN GLOBAL LABORATORIO). valores jsonb por mineral:
--   { "<clave>": {a,b,c} }  (modo abc)  ·  { "<clave>": {prom} }  (modo prom)
create table if not exists public.recepcion_analisis (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references public.recepcion_grupos(id) on delete cascade,
  n_analisis int not null,
  fecha timestamptz not null default now(),
  valores jsonb not null default '{}'::jsonb,
  nota text,
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_rec_analisis_n on public.recepcion_analisis(n_analisis);
alter table public.recepcion_analisis enable row level security;
create policy "rec_analisis read auth" on public.recepcion_analisis for select using (auth.role()='authenticated');
create policy "rec_analisis write op"  on public.recepcion_analisis for all using (public.is_operativo()) with check (public.is_operativo());

-- Humedad bajo la grilla de análisis (dos tablas lado a lado). Cuerpo = entradas
-- manuales; el pie "Promedio del lote" promedia los % y suma la merma (en el front).
create table if not exists public.recepcion_humedad_prov (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references public.recepcion_grupos(id) on delete cascade,
  orden int not null default 0,
  peso_humedo numeric,         -- Peso (Gr) Húmedos
  peso_seco numeric,           -- Peso (Gr) seco
  pct_humedad numeric,         -- % Humedad
  merma_h2o numeric,           -- Merma peso H2O
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.recepcion_humedad_prov enable row level security;
create policy "rec_hum_prov read auth" on public.recepcion_humedad_prov for select using (auth.role()='authenticated');
create policy "rec_hum_prov write op"  on public.recepcion_humedad_prov for all using (public.is_operativo()) with check (public.is_operativo());

create table if not exists public.recepcion_humedad_final (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references public.recepcion_grupos(id) on delete cascade,
  orden int not null default 0,
  peso_kg numeric,             -- Peso (Kg)
  peso_recogido numeric,       -- Peso (Kg) recogido
  merma_h2o numeric,           -- Merma peso H2O (calculada: peso_kg - peso_recogido)
  pct_humedad numeric,         -- % Humedad final
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.recepcion_humedad_final enable row level security;
create policy "rec_hum_final read auth" on public.recepcion_humedad_final for select using (auth.role()='authenticated');
create policy "rec_hum_final write op"  on public.recepcion_humedad_final for all using (public.is_operativo()) with check (public.is_operativo());

-- Pesajes de bigbags (Pesos Húmedos / Pesos Secos). Histórico modificable.
--   bigbags: [{proc_h, peso_h, proc_s, peso_s, categoria, cant}]
--   categoria: bigbag(×1,5) · saco(×0,06) · hielo(×0,05); cant = cantidad de la categoría
--   DESCUENTO = -Σ (factor × cant) de cada fila con peso (ej. 7 big bags → -1,5×7)
--   TOTAL NETO = suma de pesos + DESCUENTO (permite negativos).
create table if not exists public.recepcion_pesajes (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references public.recepcion_grupos(id) on delete cascade,
  item int not null default 0,
  fecha timestamptz not null default now(),
  bigbags jsonb not null default '[]'::jsonb,
  factor numeric not null default 1.5,
  modo text not null default 'bigbag',   -- deducción: bigbag (×1,5) · saco (×0,06) · hielo (×0,05)
  total_neto_humedo numeric,
  total_neto_seco numeric,
  nota text,
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_recepcion_pesajes_item on public.recepcion_pesajes(item);
alter table public.recepcion_pesajes enable row level security;
create policy "rec_pesajes read auth" on public.recepcion_pesajes for select using (auth.role()='authenticated');
create policy "rec_pesajes write op"  on public.recepcion_pesajes for all using (public.is_operativo()) with check (public.is_operativo());

-- Conciliación de Centros de Acopio. Histórico editable.
--   centros: [{nombre, saldo_kg}] (centros + aliados, tomados del cierre de caja)
--   Kg Faltante = Peso KG TOTAL − Σ saldos · Kg No Llegó = Faltante + Bolsas + Muestras
--   % no llegó = Kg No Llegó ÷ Total Reportado × 100
create table if not exists public.recepcion_conciliaciones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references public.recepcion_grupos(id) on delete cascade,
  numero int not null,
  fecha timestamptz not null default now(),
  centros jsonb not null default '[]'::jsonb,
  peso_kg_total numeric,
  kg_peso_bolsas numeric,
  muestras_laboratorio numeric,
  total_reportado numeric,
  kg_faltante numeric,
  kg_no_llego numeric,
  pct_no_llego numeric,
  tasa numeric,              -- USD/Kg: el TOTAL NETO seco entra al inventario valuado a esta tasa
  neto_seco numeric,         -- Σ total_neto_seco de los pesajes que entró al inventario
  almacen_neto text,         -- almacén destino del neto seco
  neto_seco_mov_id uuid,     -- movimiento de inventario del neto seco (idempotencia)
  nota text,
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_recepcion_concil_numero on public.recepcion_conciliaciones(numero);
alter table public.recepcion_conciliaciones enable row level security;
create policy "rec_concil read auth" on public.recepcion_conciliaciones for select using (auth.role()='authenticated');
create policy "rec_concil write op"  on public.recepcion_conciliaciones for all using (public.is_operativo()) with check (public.is_operativo());

-- Totales (promedio de precio de compra). Histórico editable.
--   centros: [{nombre, sno2, precio}] · Total Moneda = sno2*precio (+ gastos en el total)
--   Tasa recepcionada = Total Moneda / Pesos Kg
--   Costo final: SnO2 = Pesos Kg + Humedad Prov + Humedad Final + Fe esteril
--                Total Moneda = (Σ 3 filas) ó (si 0) el Total Moneda recepcionado · Tasa = TM/SnO2
create table if not exists public.recepcion_totales (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references public.recepcion_grupos(id) on delete cascade,
  numero int not null,
  fecha timestamptz not null default now(),
  centros jsonb not null default '[]'::jsonb,
  gastos numeric,
  pesos_kg numeric,
  humedad_prov numeric,
  humedad_final numeric,
  fe_esteril numeric,
  total_sno2 numeric,
  total_moneda numeric,
  tasa_recepcionada numeric,
  total_sno2_final numeric,
  total_moneda_final numeric,
  tasa_final numeric,
  nota text,
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_recepcion_totales_numero on public.recepcion_totales(numero);
alter table public.recepcion_totales enable row level security;
create policy "rec_totales read auth" on public.recepcion_totales for select using (auth.role()='authenticated');
create policy "rec_totales write op"  on public.recepcion_totales for all using (public.is_operativo()) with check (public.is_operativo());

-- CERRAR RECEPCIÓN: snapshot de todos los datos de la tarjeta (histórico).
create table if not exists public.recepcion_cierres (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references public.recepcion_grupos(id) on delete cascade,
  grupo_nombre text,
  numero int not null,
  fecha timestamptz not null default now(),
  datos jsonb not null default '{}'::jsonb,
  -- Entrada al inventario del TOTAL NETO seco al CERRAR la recepción:
  -- valuado a la tasa_final de Totales, en el almacén/subalmacén asignado aquí.
  neto_seco numeric,
  tasa_final numeric,
  almacen_neto text,
  neto_seco_mov_id uuid,
  nota text,
  actor text, actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_recepcion_cierres_grupo on public.recepcion_cierres(grupo_id);
create index if not exists idx_recepcion_cierres_numero on public.recepcion_cierres(numero);
alter table public.recepcion_cierres enable row level security;
create policy "rec_cierres read auth" on public.recepcion_cierres for select using (auth.role()='authenticated');
create policy "rec_cierres write op"  on public.recepcion_cierres for all using (public.is_operativo()) with check (public.is_operativo());

-- ============================================================
-- Realtime en TODOS los módulos: publica las tablas de datos del esquema
-- public que aún no estén en supabase_realtime (multiusuario en vivo).
-- ============================================================
do $$
declare t text;
declare faltantes text[] := array[
  'abonos_credito','caja_lotes','catalogos_pedido','combustible_movimientos','combustible_sedes',
  'config','custom_roles','evaluaciones_recepcion','existencias','facturas','hornos','notificaciones',
  'ofertas_proveedor','produccion','produccion_materiales','proveedor_datos_pago','proveedores',
  'recepcion_grupos','recepciones','recepcion_analisis','recepcion_minerales','recepcion_humedad_prov','recepcion_humedad_final','recepcion_pesajes','recepcion_conciliaciones','recepcion_totales','recepcion_cierres',
  'retenciones','roles_permisos','solicitudes_salida','tasa_cambio','tasa_snapshot','taxonomias','usuarios'
];
begin
  foreach t in array faltantes loop
    if exists (select 1 from pg_tables where schemaname='public' and tablename=t)
       and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
