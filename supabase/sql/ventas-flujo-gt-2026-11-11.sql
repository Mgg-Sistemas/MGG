-- ============================================================
-- MGG · Ventas: flujo NUEVO traído de Golden Touch (11-11-2026)
--
-- Pedido de la administradora: «trae el nuevo flujo de ventas de GT, con sus
-- mensajes de WhatsApp, tablas, RLS, todo». Cotización → despacho por aprobar
-- → despachada por cobrar → facturada por cobrar → cobrada (y anuladas / no
-- aprobadas), con UNA aprobación por venta: al despachar.
--
-- Se reemplaza el módulo de ventas anterior de MGG (0 ventas cargadas; la tabla
-- `clientes` se conserva porque la usa Salidas). Adaptaciones a MGG:
--   · Permisos por la matriz: puede/puede_leer de GT → puede_modulo(m, nivel).
--   · CxC: GT usa `cobrado`; en MGG la columna es `abonado`.
--   · Tesorería multimoneda: el cobro entra por caja_ingresar_divisa (caja_saldos
--     + lote + libro) y la anulación lo saca de caja_saldos (puede quedar negativo,
--     igual que en GT).
--   · Stock: registrar_movimiento_stock de GT; si el almacén de la ficha no
--     alcanza para la salida, toma el almacén que sí tenga existencia.
--   · Avisos al rol jefe_de_administracion (en GT «jefa_de_…»).
--   · Sin la auditoría fn_auditar de GT: la Auditoría de MGG ya lee ventas.
-- ============================================================
begin;

-- 0 · Módulo anterior (solo si está vacío)
do $$ begin
  if to_regclass('public.ventas') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='items') then
    if (select count(*) from public.ventas) > 0 then
      raise exception 'La tabla ventas de MGG tiene datos: no se reemplaza.';
    end if;
    drop table public.ventas cascade;
  end if;
end $$;
drop function if exists public.ventas_solo_autorizados() cascade;
drop function if exists public.ventas_nace_en_borrador() cascade;

-- 1 · Columnas que el flujo necesita en tablas existentes
alter table public.cuentas_por_cobrar add column if not exists caja_id uuid references public.cajas(id) on delete set null;
alter table public.cuentas_por_cobrar add column if not exists caja_mov_id uuid;
alter table public.cuentas_por_cobrar add column if not exists cuenta text;
alter table public.cuentas_por_cobrar add column if not exists ref_venta_id uuid;
alter table public.cuentas_por_cobrar_abonos add column if not exists ref_venta_id uuid;
alter table public.movimientos_caja add column if not exists ref_venta_id uuid;
alter table public.usuarios_autorizados add column if not exists aprobar_despachos boolean not null default false;

-- 2 · Tablas (DDL de GT)
create table if not exists public.ventas (
  id uuid default gen_random_uuid() not null,
  codigo text not null,
  tipo text default 'venta'::text not null,
  estado text default 'borrador'::text not null,
  cliente_id uuid,
  cliente_nombre text,
  cliente_rif text,
  condicion text default 'contado'::text not null,
  moneda text default 'USD'::text not null,
  tasa_bs numeric,
  subtotal numeric default 0 not null,
  descuento numeric default 0 not null,
  iva_pct numeric default 16 not null,
  iva_monto numeric default 0 not null,
  total numeric default 0 not null,
  costo_total numeric default 0 not null,
  ganancia_total numeric default 0 not null,
  valor_recibido numeric default 0 not null,
  diferencia numeric default 0 not null,
  pago_legs jsonb default '[]'::jsonb not null,
  cxc_id uuid,
  nota text,
  actor text,
  actor_name text,
  confirmada_at timestamp with time zone,
  confirmada_por text,
  entregada_at timestamp with time zone,
  entregada_por text,
  anulada_at timestamp with time zone,
  anulada_por text,
  motivo_anulacion text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone,
  documento text default 'nota_entrega'::text not null,
  numero_factura text,
  numero_control text,
  igtf_pct numeric default 0 not null,
  igtf_monto numeric default 0 not null,
  historial jsonb default '[]'::jsonb not null,
  enviada_at timestamp with time zone,
  enviada_por text,
  autorizada_at timestamp with time zone,
  autorizada_por text,
  rechazada_at timestamp with time zone,
  rechazada_por text,
  rechazo_motivo text,
  no_despacho_motivo text,
  no_despacho_detalle text,
  no_despacho_por text,
  no_despacho_en timestamp with time zone,
  cobrar_el date,
  facturada_at timestamp with time zone,
  facturada_por text,
  constraint ventas_codigo_key UNIQUE (codigo),
  constraint ventas_pkey PRIMARY KEY (id),
  constraint ventas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.tesoreria_contrapartes(id),
  constraint ventas_cxc_id_fkey FOREIGN KEY (cxc_id) REFERENCES public.cuentas_por_cobrar(id),
  constraint ventas_condicion_check CHECK ((condicion = ANY (ARRAY['contado'::text, 'credito'::text]))),
  constraint ventas_documento_check CHECK ((documento = ANY (ARRAY['nota_entrega'::text, 'factura'::text]))),
  constraint ventas_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'por_autorizar'::text, 'autorizada'::text, 'confirmada'::text, 'entregada'::text, 'anulada'::text]))),
  constraint ventas_igtf_check CHECK (((igtf_pct >= (0)::numeric) AND (igtf_monto >= (0)::numeric))),
  constraint ventas_no_despacho_motivo_check CHECK (((no_despacho_motivo IS NULL) OR (no_despacho_motivo = ANY (ARRAY['deuda_vencida'::text, 'sin_cupo'::text, 'sin_existencia'::text, 'otro'::text])))),
  constraint ventas_tipo_check CHECK ((tipo = ANY (ARRAY['venta'::text, 'permuta'::text])))
);

create table if not exists public.ventas_renglones (
  id uuid default gen_random_uuid() not null,
  venta_id uuid not null,
  orden integer default 0 not null,
  producto_id uuid not null,
  producto_sku text,
  producto_nombre text,
  unidad text,
  cantidad numeric not null,
  precio_unit numeric default 0 not null,
  costo_unit numeric default 0 not null,
  descuento numeric default 0 not null,
  subtotal numeric default 0 not null,
  ganancia numeric default 0 not null,
  mov_id uuid,
  constraint ventas_renglones_pkey PRIMARY KEY (id),
  constraint ventas_renglones_mov_id_fkey FOREIGN KEY (mov_id) REFERENCES public.movimientos(id),
  constraint ventas_renglones_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id),
  constraint ventas_renglones_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE CASCADE,
  constraint ventas_renglones_cantidad_check CHECK ((cantidad > (0)::numeric))
);

create table if not exists public.ventas_recibidos (
  id uuid default gen_random_uuid() not null,
  venta_id uuid not null,
  orden integer default 0 not null,
  producto_id uuid not null,
  producto_sku text,
  producto_nombre text,
  unidad text,
  cantidad numeric not null,
  valor_unit numeric default 0 not null,
  subtotal numeric default 0 not null,
  mov_id uuid,
  constraint ventas_recibidos_pkey PRIMARY KEY (id),
  constraint ventas_recibidos_mov_id_fkey FOREIGN KEY (mov_id) REFERENCES public.movimientos(id),
  constraint ventas_recibidos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id),
  constraint ventas_recibidos_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE CASCADE,
  constraint ventas_recibidos_cantidad_check CHECK ((cantidad > (0)::numeric)),
  constraint ventas_recibidos_valor_unit_check CHECK ((valor_unit > (0)::numeric))
);

create table if not exists public.cuentas_por_cobrar_cargos (
  id uuid default gen_random_uuid() not null,
  cuenta_id uuid not null,
  monto numeric not null,
  moneda text not null,
  caja_id uuid,
  cuenta text,
  caja_mov_id uuid,
  total_adeudado numeric,
  nota text,
  actor text,
  actor_name text,
  at timestamp with time zone default now() not null,
  ref_venta_id uuid,
  transf_id uuid,
  constraint cuentas_por_cobrar_cargos_pkey PRIMARY KEY (id),
  constraint cuentas_por_cobrar_cargos_caja_id_fkey FOREIGN KEY (caja_id) REFERENCES public.cajas(id) ON DELETE SET NULL,
  constraint cuentas_por_cobrar_cargos_cuenta_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas_por_cobrar(id) ON DELETE CASCADE,
  constraint cuentas_por_cobrar_cargos_ref_venta_id_fkey FOREIGN KEY (ref_venta_id) REFERENCES public.ventas(id),
  constraint cuentas_por_cobrar_cargos_monto_check CHECK ((monto <> (0)::numeric))
);

CREATE INDEX IF NOT EXISTS idx_cuentas_por_cobrar_cargos_caja_id ON public.cuentas_por_cobrar_cargos USING btree (caja_id);
CREATE INDEX IF NOT EXISTS idx_cxc_cargos_cuenta ON public.cuentas_por_cobrar_cargos USING btree (cuenta_id);
CREATE INDEX IF NOT EXISTS cxc_cargos_ref_venta_idx ON public.cuentas_por_cobrar_cargos USING btree (ref_venta_id) WHERE (ref_venta_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS cxc_cargos_transf_id_uniq ON public.cuentas_por_cobrar_cargos USING btree (transf_id) WHERE (transf_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ventas_cxc_id ON public.ventas USING btree (cxc_id);
CREATE INDEX IF NOT EXISTS ventas_estado_fecha_idx ON public.ventas USING btree (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS ventas_cliente_idx ON public.ventas USING btree (cliente_id);
CREATE INDEX IF NOT EXISTS ventas_tipo_idx ON public.ventas USING btree (tipo);
CREATE UNIQUE INDEX IF NOT EXISTS ventas_numero_control_unico ON public.ventas USING btree (upper(btrim(numero_control))) WHERE ((numero_control IS NOT NULL) AND (btrim(numero_control) <> ''::text) AND (estado <> 'anulada'::text));
CREATE INDEX IF NOT EXISTS idx_ventas_recibidos_producto_id ON public.ventas_recibidos USING btree (producto_id);
CREATE INDEX IF NOT EXISTS idx_ventas_recibidos_mov_id ON public.ventas_recibidos USING btree (mov_id);
CREATE INDEX IF NOT EXISTS ventas_recibidos_venta_idx ON public.ventas_recibidos USING btree (venta_id);
CREATE INDEX IF NOT EXISTS idx_ventas_renglones_mov_id ON public.ventas_renglones USING btree (mov_id);
CREATE INDEX IF NOT EXISTS ventas_renglones_venta_idx ON public.ventas_renglones USING btree (venta_id);
CREATE INDEX IF NOT EXISTS ventas_renglones_producto_idx ON public.ventas_renglones USING btree (producto_id);

-- FK de las columnas nuevas hacia ventas
do $$ begin
  if not exists (select 1 from pg_constraint where conname='cuentas_por_cobrar_ref_venta_id_fkey') then
    alter table public.cuentas_por_cobrar add constraint cuentas_por_cobrar_ref_venta_id_fkey foreign key (ref_venta_id) references public.ventas(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='cuentas_por_cobrar_abonos_ref_venta_id_fkey') then
    alter table public.cuentas_por_cobrar_abonos add constraint cuentas_por_cobrar_abonos_ref_venta_id_fkey foreign key (ref_venta_id) references public.ventas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='movimientos_caja_ref_venta_id_fkey') then
    alter table public.movimientos_caja add constraint movimientos_caja_ref_venta_id_fkey foreign key (ref_venta_id) references public.ventas(id);
  end if;
end $$;
create index if not exists cxc_ref_venta_idx on public.cuentas_por_cobrar(ref_venta_id) where ref_venta_id is not null;
create index if not exists cxca_ref_venta_idx on public.cuentas_por_cobrar_abonos(ref_venta_id) where ref_venta_id is not null;
create index if not exists movcaja_ref_venta_idx on public.movimientos_caja(ref_venta_id) where ref_venta_id is not null;

-- 3 · Vista de los movimientos de caja de cada venta
create or replace view public.ventas_movimientos_caja with (security_invoker=on) as
 SELECT m.ref_venta_id AS venta_id, m.id AS movimiento_id, m.at, m.tipo, m.categoria, m.monto, m.moneda, m.cuenta,
        m.caja_id, c.nombre AS caja_nombre, m.motivo, m.actor_name, m.cierre_id
   FROM public.movimientos_caja m
   LEFT JOIN public.cajas c ON c.id = m.caja_id
  WHERE m.ref_venta_id IS NOT NULL;

-- 4 · Funciones (de GT, adaptadas)

-- ventas_round2
CREATE OR REPLACE FUNCTION public.ventas_round2(p double precision)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select round((floor(coalesce(p, 0) * 100 + 0.5) / 100)::numeric, 2);
$function$
;

-- es_autorizador_ventas
CREATE OR REPLACE FUNCTION public.es_autorizador_ventas()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.usuarios u
     where u.id = auth.uid()
       and coalesce(u.estado::text, 'activo') = 'activo'
       and not coalesce(u.must_change_password, false)
       and (
         u.role::text = 'admin'
         or exists (select 1 from public.usuarios_autorizados a
                     where lower(btrim(a.email)) = lower(btrim(u.email))
                       and a.aprobar_despachos)
       )
  );
$function$
;

-- crear_o_acumular_cxc
CREATE OR REPLACE FUNCTION public.crear_o_acumular_cxc(p_tipo text, p_contraparte text, p_monto numeric, p_moneda text, p_cuenta text DEFAULT NULL::text, p_caja_id uuid DEFAULT NULL::uuid, p_caja_mov_id uuid DEFAULT NULL::uuid, p_nota text DEFAULT NULL::text, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text, p_ref_venta_id uuid DEFAULT NULL::uuid)
 RETURNS cuentas_por_cobrar
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_monto       numeric;
  v_contraparte text;
  v_nota        text;
  v_cuenta      public.cuentas_por_cobrar;
  v_adeudado    numeric;
begin
  -- Las mismas dos validaciones que hacía la versión TypeScript.
  v_monto := round(coalesce(p_monto, 0)::numeric, 2);
  if v_monto <= 0 then
    raise exception 'El monto debe ser mayor que 0.';
  end if;
  v_contraparte := btrim(coalesce(p_contraparte, ''));
  if v_contraparte = '' then
    raise exception 'Indica el cliente o proveedor.';
  end if;
  v_nota := nullif(btrim(coalesce(p_nota, '')), '');

  -- ¿Ya tiene cuenta abierta en esta moneda? `for update` la bloquea hasta el
  -- fin de la transacción: dos ventas simultáneas del mismo cliente se suman
  -- una detrás de la otra en vez de pisarse.
  select * into v_cuenta
    from public.cuentas_por_cobrar
   where tipo = p_tipo
     and moneda = p_moneda
     and estado = 'abierta'
     and contraparte ilike v_contraparte
   order by created_at desc
   limit 1
   for update;

  if found then
    update public.cuentas_por_cobrar
       set monto      = round(coalesce(monto, 0) + v_monto, 2),
           estado     = 'abierta',
           updated_at = now()
     where id = v_cuenta.id
     returning * into v_cuenta;
  else
    insert into public.cuentas_por_cobrar (
      tipo, contraparte, monto, abonado, moneda,
      cuenta, caja_id, caja_mov_id, estado, nota, actor, actor_name
    ) values (
      p_tipo, v_contraparte, v_monto, 0, p_moneda,
      p_cuenta, p_caja_id, p_caja_mov_id, 'abierta', v_nota, p_actor, p_actor_name
    )
    returning * into v_cuenta;
  end if;

  -- El rastro con fecha. `total_adeudado` es la foto de lo que se debía
  -- después de este cargo: monto acumulado menos lo ya cobrado.
  v_adeudado := round(coalesce(v_cuenta.monto, 0) - coalesce(v_cuenta.abonado, 0), 2);
  insert into public.cuentas_por_cobrar_cargos (
    cuenta_id, monto, moneda, caja_id, cuenta, caja_mov_id,
    total_adeudado, nota, actor, actor_name, ref_venta_id
  ) values (
    v_cuenta.id, v_monto, p_moneda, p_caja_id, p_cuenta, p_caja_mov_id,
    v_adeudado, v_nota, p_actor, p_actor_name, p_ref_venta_id
  );

  return v_cuenta;
end $function$
;

-- revertir_cargo_cxc
CREATE OR REPLACE FUNCTION public.revertir_cargo_cxc(p_cuenta_id uuid, p_monto numeric, p_nota text DEFAULT NULL::text, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS cuentas_por_cobrar
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_monto    numeric;
  v_nota     text;
  v_cuenta   public.cuentas_por_cobrar;
  v_nuevo    numeric;
  v_cobrado  numeric;
  v_estado   text;
begin
  v_monto := round(coalesce(p_monto, 0)::numeric, 2);
  if v_monto <= 0 then
    raise exception 'El monto a revertir debe ser mayor que 0.';
  end if;
  v_nota := nullif(btrim(coalesce(p_nota, '')), '');

  select * into v_cuenta
    from public.cuentas_por_cobrar
   where id = p_cuenta_id
   for update;
  if not found then
    raise exception 'No existe la cuenta por cobrar %.', p_cuenta_id;
  end if;

  v_cobrado := round(coalesce(v_cuenta.abonado, 0), 2);
  v_nuevo   := round(coalesce(v_cuenta.monto, 0) - v_monto, 2);

  -- Una cuenta no puede quedar con más cobrado que debido: eso sería plata
  -- recibida que ya no se le debe a nadie. Primero hay que devolverla.
  if v_cobrado > v_nuevo + 0.01 then
    raise exception 'No se puede revertir % de la cuenta de %: quedaria en % y ya tiene % cobrado. Hay que devolver esa plata primero.',
      v_monto, v_cuenta.contraparte, v_nuevo, v_cobrado;
  end if;

  if v_nuevo < 0 then
    v_nuevo := 0;
  end if;
  -- Sin saldo pendiente, la cuenta se cierra.
  v_estado := case when v_nuevo <= 0 or v_cobrado >= v_nuevo - 0.01 then 'saldada' else 'abierta' end;

  update public.cuentas_por_cobrar
     set monto      = v_nuevo,
         estado     = v_estado,
         updated_at = now()
   where id = v_cuenta.id
   returning * into v_cuenta;

  -- El cargo negativo es el rastro de la reversa: la cuenta es corriente y
  -- su historia tiene que poder leerse renglón por renglón.
  insert into public.cuentas_por_cobrar_cargos (
    cuenta_id, monto, moneda, caja_id, cuenta, caja_mov_id,
    total_adeudado, nota, actor, actor_name
  ) values (
    v_cuenta.id, -v_monto, v_cuenta.moneda, null, null, null,
    round(v_nuevo - v_cobrado, 2), v_nota, p_actor, p_actor_name
  );

  return v_cuenta;
end $function$
;

-- registrar_movimiento_stock
CREATE OR REPLACE FUNCTION public.registrar_movimiento_stock(p jsonb)
 RETURNS movimientos
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_producto_id uuid := (p->>'producto_id')::uuid;
  v_almacen     text := 'General';
  v_alm_prod    text;
  v_delta       numeric := coalesce((p->>'delta')::numeric, 0);
  v_tipo        public.tipo_movimiento := (p->>'tipo')::public.tipo_movimiento;
  v_ref_tipo    text := coalesce(p->>'ref_tipo', 'manual');
  v_precio      numeric;
  v_nombre      text;
  v_precio_prod numeric := 0;
  v_stock_antes numeric := 0;
  v_costo_antes numeric := 0;
  v_stock_desp  numeric;
  v_costo       numeric;
  v_total_qty   numeric;
  v_total_stock numeric;
  v_valor       numeric;
  v_mov         public.movimientos;
begin
  if v_producto_id is null then
    raise exception 'producto_id requerido';
  end if;

  select nombre, coalesce(precio, 0), almacen
    into v_nombre, v_precio_prod, v_alm_prod
    from public.productos where id = v_producto_id for update;
  if not found then
    -- Con el RLS por depósito, un producto de un depósito sin permiso no se ve:
    -- no se puede mover su stock (antes caía como 'General').
    raise exception 'No se encontró el producto (o no tienes permiso en su depósito).' using errcode = '42501';
  end if;
  -- Cada depósito es independiente: el stock vive en el almacén del producto
  -- (General = Inventario Los Pinos; Depósito Mina, Reutilizables, Dañados, ...).
  v_almacen := coalesce(nullif(btrim(coalesce(p->>'almacen', '')), ''), nullif(btrim(v_alm_prod), ''), 'General');
  -- MGG (11-11-2026): el stock de una ficha puede estar en otra sede. Para una
  -- salida sin almacén indicado, si el de la ficha no alcanza se usa el almacén
  -- que sí tiene la existencia (el de la ficha primero, luego el de más stock).
  if v_delta < 0 and nullif(btrim(coalesce(p->>'almacen', '')), '') is null then
    select e.almacen into v_alm_prod
      from public.existencias e
     where e.producto_id = v_producto_id and coalesce(e.stock, 0) >= -v_delta
     order by (e.almacen = v_almacen) desc, e.stock desc
     limit 1;
    if v_alm_prod is not null then v_almacen := v_alm_prod; end if;
  end if;

  begin
    v_precio := nullif(p->>'precio_unitario','')::numeric;
  exception when others then
    v_precio := null;
  end;

  select coalesce(stock,0), coalesce(costo_promedio,0)
    into v_stock_antes, v_costo_antes
    from public.existencias
   where producto_id = v_producto_id and almacen = v_almacen
   for update;
  v_stock_antes := coalesce(v_stock_antes, 0);
  v_costo_antes := coalesce(v_costo_antes, 0);

  v_stock_desp := v_stock_antes + v_delta;
  if v_stock_desp < 0 then
    if v_ref_tipo = 'cocina' then
      v_stock_desp := 0;
    else
      raise exception 'Stock insuficiente de "%": hay % y se intentaron sacar %.',
        coalesce(v_nombre, 'este producto'),
        trim(to_char(v_stock_antes, 'FM999999990.####')),
        trim(to_char(abs(v_delta),  'FM999999990.####'))
        using errcode = 'check_violation';
    end if;
  end if;

  if v_delta > 0 and v_precio is not null and v_precio > 0 then
    v_total_qty := v_stock_antes + v_delta;
    if v_total_qty <= 0 then
      v_costo := v_precio;
    else
      v_costo := round((v_stock_antes * v_costo_antes + v_delta * v_precio) / v_total_qty, 4);
    end if;
  elsif v_delta > 0 and v_costo_antes <= 0 then
    v_costo := greatest(coalesce(v_precio_prod, 0), 0);
  else
    v_costo := v_costo_antes;
  end if;

  insert into public.movimientos (
    producto_id, tipo, delta, almacen, stock_antes, stock_despues,
    actor, actor_name, ref_tipo, ref_id, ref_codigo, proveedor_id,
    detalle, destino, solicitante, nota_entrega, fecha_entrega,
    precio_unitario, costo_promedio, at
  ) values (
    v_producto_id, v_tipo, v_delta, v_almacen, v_stock_antes, v_stock_desp,
    p->>'actor', p->>'actor_name', v_ref_tipo,
    p->>'ref_id', p->>'ref_codigo', nullif(p->>'proveedor_id','')::uuid,
    p->>'detalle', p->>'destino', p->>'solicitante', p->>'nota_entrega',
    nullif(p->>'fecha_entrega','')::date,
    v_precio, v_costo, coalesce(nullif(p->>'at','')::timestamptz, now())
  ) returning * into v_mov;

  insert into public.existencias (producto_id, almacen, stock, costo_promedio, updated_at)
  values (v_producto_id, v_almacen, v_stock_desp, v_costo, now())
  on conflict (producto_id, almacen)
  do update set stock = excluded.stock, costo_promedio = excluded.costo_promedio, updated_at = now();

  select coalesce(sum(stock),0), coalesce(sum(stock*costo_promedio),0)
    into v_total_stock, v_valor
    from public.existencias where producto_id = v_producto_id;
  if v_total_stock > 0 and v_valor > 0 then
    update public.productos
       set stock = v_total_stock,
           precio_promedio = round(v_valor / v_total_stock, 4)
     where id = v_producto_id;
  else
    update public.productos set stock = v_total_stock where id = v_producto_id;
  end if;

  if v_tipo in ('fundicion','fin_fundicion') then
    update public.productos set en_fundicion = (v_tipo = 'fundicion') where id = v_producto_id;
  end if;

  return v_mov;
end;
$function$
;

-- ventas_guardia_y_historial
CREATE OR REPLACE FUNCTION public.ventas_guardia_y_historial()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_nombre  text;
  v_evento  text;
  v_motivo  text;
  v_ok      boolean;
  v_fila    jsonb;
begin
  if v_uid is not null then
    select u.email, u.nombre into v_email, v_nombre from public.usuarios u where u.id = v_uid;
  end if;

  if TG_OP = 'INSERT' then
    if v_uid is not null and NEW.estado <> 'borrador' then
      raise exception 'Una venta nace como borrador, no como %.', NEW.estado using errcode = 'P0001';
    end if;
    NEW.historial := jsonb_build_array(jsonb_build_object(
      'at', now(), 'evento', 'creada', 'a', NEW.estado,
      'actor', coalesce(v_email, NEW.actor, 'sistema'),
      'actor_name', coalesce(v_nombre, NEW.actor_name),
      'total', NEW.total, 'documento', NEW.documento));
    return NEW;
  end if;

  if NEW.estado is distinct from OLD.estado then
    if v_uid is not null then
      v_ok := case
        when NEW.estado = 'anulada'                                   then OLD.estado <> 'anulada'
        when OLD.estado = 'borrador'      and NEW.estado = 'por_autorizar' then true
        when OLD.estado = 'por_autorizar' and NEW.estado = 'autorizada'    then public.es_autorizador_ventas()
        when OLD.estado = 'por_autorizar' and NEW.estado = 'borrador'      then true
        when OLD.estado = 'autorizada'    and NEW.estado = 'borrador'      then true
        when OLD.estado = 'autorizada'    and NEW.estado = 'confirmada'    then true
        when OLD.estado = 'confirmada'    and NEW.estado = 'entregada'     then true
        else false end;
      if not v_ok then
        if OLD.estado = 'por_autorizar' and NEW.estado = 'autorizada' then
          raise exception 'Solo un administrador o un usuario autorizado para aprobar despachos puede aprobar la venta %.', OLD.codigo using errcode = 'P0001';
        end if;
        raise exception 'La venta % esta % y no puede pasar a %.', OLD.codigo, OLD.estado, NEW.estado using errcode = 'P0001';
      end if;
    end if;

    v_evento := case NEW.estado
      when 'por_autorizar' then 'enviada_a_autorizar'
      when 'autorizada'    then 'autorizada'
      when 'confirmada'    then 'confirmada'
      when 'entregada'     then 'entregada'
      when 'anulada'       then 'anulada'
      when 'borrador'      then
        case when NEW.rechazada_at is distinct from OLD.rechazada_at then 'rechazada' else 'devuelta_a_borrador' end
      else NEW.estado end;
    v_motivo := case
      when NEW.estado = 'anulada' then NEW.motivo_anulacion
      when v_evento = 'rechazada' then NEW.rechazo_motivo
      when v_evento = 'devuelta_a_borrador' then 'Se editó: necesita una nueva autorización.'
      else null end;

  elsif NEW.estado = 'borrador' and NEW.updated_at is distinct from OLD.updated_at then
    v_evento := 'editada';
  end if;

  if v_evento is null then
    NEW.historial := coalesce(OLD.historial, '[]'::jsonb);
    return NEW;
  end if;

  v_fila := jsonb_build_object(
    'at', now(), 'evento', v_evento, 'de', OLD.estado, 'a', NEW.estado,
    'actor', coalesce(v_email, 'sistema'), 'actor_name', v_nombre,
    'total', NEW.total);
  if v_motivo is not null and btrim(v_motivo) <> '' then
    v_fila := v_fila || jsonb_build_object('motivo', v_motivo);
  end if;
  if v_evento = 'editada' and NEW.total is distinct from OLD.total then
    v_fila := v_fila || jsonb_build_object('total_antes', OLD.total);
  end if;

  NEW.historial := coalesce(OLD.historial, '[]'::jsonb) || jsonb_build_array(v_fila);
  return NEW;
end $function$
;

-- cxc_abono_venta_valida
CREATE OR REPLACE FUNCTION public.cxc_abono_venta_valida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dif     numeric;
  v_codigo  text;
  v_legs    numeric;
  v_otros   numeric;
begin
  if NEW.ref_venta_id is null then
    return NEW;
  end if;
  if not exists (select 1 from public.cuentas_por_cobrar_cargos c
                  where c.cuenta_id = NEW.cuenta_id and c.ref_venta_id = NEW.ref_venta_id) then
    raise exception 'Ese cobro no corresponde a la venta: la venta no tiene cargos en esta cuenta por cobrar.' using errcode = 'P0001';
  end if;
  select v.diferencia, v.codigo,
         (select coalesce(sum(coalesce((l->>'monto')::numeric, 0)), 0) from jsonb_array_elements(coalesce(v.pago_legs, '[]'::jsonb)) l)
    into v_dif, v_codigo, v_legs
    from public.ventas v where v.id = NEW.ref_venta_id;
  select coalesce(sum(a.monto), 0) into v_otros
    from public.cuentas_por_cobrar_abonos a
   where a.ref_venta_id = NEW.ref_venta_id and a.id is distinct from NEW.id;
  if coalesce(v_otros, 0) + coalesce(v_legs, 0) + coalesce(NEW.monto, 0) > coalesce(v_dif, 0) + 0.01 then
    raise exception 'El cobro supera lo que debe la venta % (saldo %).', v_codigo,
      round(coalesce(v_dif, 0) - coalesce(v_otros, 0) - coalesce(v_legs, 0), 2) using errcode = 'P0001';
  end if;
  return NEW;
end $function$
;

-- confirmar_venta
CREATE OR REPLACE FUNCTION public.confirmar_venta(p_venta_id uuid, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v              public.ventas;
  r              public.ventas_renglones;
  v_actor        text;
  v_quien        text;
  v_n            int;

  -- Acumuladores del documento. Se suman SIN redondear y en `double precision`,
  -- igual que el `for` de `calcularTotalesVenta`: el redondeo va una sola vez,
  -- al final.
  v_sub_bruto    double precision := 0;
  v_costo_bruto  double precision := 0;
  v_gan_bruta    double precision := 0;

  -- Del renglón que se está recorriendo. `_num` es lo que se guarda en la
  -- tabla (decimal exacto); el resto es la cuenta.
  v_costo_num    numeric;
  v_desc_ren_num numeric;
  v_cant         double precision;
  v_precio       double precision;
  v_costo        double precision;
  v_desc_ren     double precision;

  -- Del documento, ya redondeados.
  v_desc_doc     numeric;
  v_pct          numeric;
  v_subtotal     numeric;
  v_base         numeric;
  v_iva          numeric;
  v_igtf         numeric;
  v_igtf_pct     numeric;
  v_total        numeric;
  v_costo_total  numeric;
  v_ganancia     numeric;
  v_recibido     numeric;
  v_diferencia   numeric;

  -- Cliente congelado.
  v_cli_nombre   text;
  v_cli_rif      text;

  -- Cobro.
  v_legs         jsonb;
  v_leg          jsonb;
  v_legs_suma    numeric := 0;
  v_leg_monto    numeric;
  v_leg_caja     uuid;
  v_leg_moneda   text;
  v_leg_cuenta   text;
  v_caja_nombre  text;
  v_saldo        jsonb;
  v_cxc          public.cuentas_por_cobrar;
  v_cxc_id       uuid;
begin
  v_actor := coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'sistema');
  v_quien := coalesce(nullif(btrim(coalesce(p_actor_name, '')), ''), v_actor);

  -- ── 1 · La venta, bloqueada hasta el fin de la transacción ────────
  -- `for update` para que dos pantallas no confirmen la misma venta a la vez
  -- y le cobren dos veces al cliente.
  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'No existe la venta %.', p_venta_id using errcode = 'P0001';
  end if;
  if v.estado <> 'autorizada' then
    raise exception 'La venta % ya esta %: solo se confirma una venta AUTORIZADA (la autorizan LEYDIS RENGEL o JESUS LOZADA).',
      v.codigo, v.estado using errcode = 'P0001';
  end if;

  -- ── 2 · Sin renglones no hay venta ────────────────────────────────
  select count(*) into v_n from public.ventas_renglones where venta_id = v.id;
  if v_n = 0 then
    raise exception 'La venta % no tiene renglones: no hay nada que confirmar.',
      v.codigo using errcode = 'P0001';
  end if;

  -- Los mismos dos clamps que hace el TS antes de empezar.
  v_desc_doc := greatest(0, public.ventas_round2(coalesce(v.descuento, 0)));
  v_pct      := greatest(0, coalesce(v.iva_pct, 0));
  v_igtf_pct := greatest(0, coalesce(v.igtf_pct, 0));

  -- ── 3 · Congelar el costo y recalcular cada renglón ───────────────
  for r in
    select * from public.ventas_renglones where venta_id = v.id order by orden, id
  loop
    -- El costo promedio de la ficha, hoy. Se prefiere el almacén General, que
    -- es el único que usa el sistema; el `order by` está por si mañana hay más.
    select e.costo_promedio into v_costo_num
      from public.existencias e
     where e.producto_id = r.producto_id
     order by (e.almacen = 'General') desc, e.updated_at desc nulls last
     limit 1;
    -- Sin ficha de existencias no se pisa lo que traía el borrador; con ficha,
    -- manda el costo promedio aunque sea 0 (producto sin costo: avisa, no bloquea).
    v_costo_num    := coalesce(v_costo_num, r.costo_unit, 0);
    v_desc_ren_num := greatest(0, coalesce(r.descuento, 0));

    v_cant     := coalesce(r.cantidad, 0);
    v_precio   := coalesce(r.precio_unit, 0);
    v_costo    := v_costo_num;
    v_desc_ren := v_desc_ren_num;

    v_sub_bruto   := v_sub_bruto   + v_cant * v_precio - v_desc_ren;
    v_costo_bruto := v_costo_bruto + v_cant * v_costo;
    -- El descuento del renglón va DENTRO de la sumatoria de la ganancia.
    v_gan_bruta   := v_gan_bruta   + v_cant * (v_precio - v_costo) - v_desc_ren;

    update public.ventas_renglones
       set costo_unit = v_costo_num,
           descuento  = v_desc_ren_num,
           subtotal   = public.ventas_round2(v_cant * v_precio - v_desc_ren),
           ganancia   = public.ventas_round2(v_cant * (v_precio - v_costo) - v_desc_ren)
     where id = r.id;
  end loop;

  -- ── 4 · El documento ──────────────────────────────────────────────
  -- Los `::double precision` no son decorativos: sin ellos Postgres haría la
  -- cuenta en decimal exacto y volvería a separarse de la pantalla. Cada paso
  -- tiene que ser la misma operación sobre el mismo doble que hace el TS.
  v_subtotal    := public.ventas_round2(v_sub_bruto);
  v_base        := public.ventas_round2(v_subtotal::double precision - v_desc_doc::double precision);
  v_iva         := public.ventas_round2(v_base::double precision * v_pct::double precision / 100);
  -- IGTF sobre la BASE, igual que en las OC. Misma cuenta que `calcularTotalesVenta`.
  v_igtf        := public.ventas_round2(v_base::double precision * v_igtf_pct::double precision / 100);
  v_total       := public.ventas_round2(v_base::double precision + v_iva::double precision + v_igtf::double precision);
  v_costo_total := public.ventas_round2(v_costo_bruto);
  -- NUNCA `v_total - v_costo_total`: el total lleva IVA y el IVA no es ganancia.
  v_ganancia    := public.ventas_round2(v_gan_bruta - v_desc_doc::double precision);

  -- ── 5 · La permuta: lo que se cobra es la DIFERENCIA ──────────────
  -- Se recalcula el subtotal de cada recibido por el mismo motivo que el de
  -- los renglones: al confirmar se congela, no se confía en lo que dejó el
  -- borrador. En una venta normal no hay recibidos, así que `valor_recibido`
  -- queda en 0 y `diferencia` da exactamente `total`.
  update public.ventas_recibidos
     set subtotal = public.ventas_round2(coalesce(cantidad, 0) * coalesce(valor_unit, 0))
   where venta_id = v.id;

  -- Acá ya son todos valores de dos decimales exactos, así que la suma y la
  -- resta se hacen en `numeric`: no hay nada que redondear ni que emparejar.
  select coalesce(sum(coalesce(subtotal, 0)), 0) into v_recibido
    from public.ventas_recibidos where venta_id = v.id;
  v_recibido   := round(v_recibido, 2);
  v_diferencia := round(v_total - v_recibido, 2);

  -- ── 6 · Congelar el cliente ───────────────────────────────────────
  -- El comprobante que se imprima dentro de seis meses tiene que seguir
  -- diciendo lo que decía hoy, aunque después le corrijan el nombre o el RIF.
  select tc.nombre, tc.rif into v_cli_nombre, v_cli_rif
    from public.tesoreria_contrapartes tc where tc.id = v.cliente_id;
  v_cli_nombre := coalesce(nullif(btrim(coalesce(v_cli_nombre, '')), ''),
                           nullif(btrim(coalesce(v.cliente_nombre, '')), ''));
  v_cli_rif    := coalesce(nullif(btrim(coalesce(v_cli_rif, '')), ''),
                           nullif(btrim(coalesce(v.cliente_rif, '')), ''));

  -- ── 7 · Cobrar de contado: una pata, una caja ─────────────────────
  -- `v_legs` es lo que queda guardado en la venta. Si no se cobró nada (una
  -- permuta cerrada, o una venta a crédito) queda vacío A PROPÓSITO:
  -- `anular_venta` reversa las patas de caja una por una, y una pata que nunca
  -- entró no se puede sacar.
  v_legs := '[]'::jsonb;

  if v_diferencia > 0 and v.condicion = 'contado'
     and (select coalesce(sum(coalesce((l->>'monto')::numeric, 0)), 0)
            from jsonb_array_elements(coalesce(v.pago_legs, '[]'::jsonb)) l) > 0 then
    v_legs := coalesce(v.pago_legs, '[]'::jsonb);

    select coalesce(sum(coalesce((leg->>'monto')::numeric, 0)), 0) into v_legs_suma
      from jsonb_array_elements(v_legs) leg;
    v_legs_suma := round(v_legs_suma, 2);

    if abs(v_legs_suma - v_diferencia) > 0.01 then
      raise exception 'Las formas de pago de % suman % y hay que cobrar %. Ajusta el pago antes de confirmar.',
        v.codigo, v_legs_suma, v_diferencia using errcode = 'P0001';
    end if;

    for v_leg in select value from jsonb_array_elements(v_legs) loop
      v_leg_monto := round(coalesce((v_leg->>'monto')::numeric, 0), 2);
      if v_leg_monto <= 0 then
        continue;
      end if;

      -- La pantalla guarda la caja como cajaId; se acepta caja_id por si
      -- alguna pata quedó escrita con el nombre de la columna.
      v_leg_caja := coalesce(nullif(btrim(coalesce(v_leg->>'cajaId', '')), '')::uuid,
                             nullif(btrim(coalesce(v_leg->>'caja_id', '')), '')::uuid);
      if v_leg_caja is null then
        raise exception 'Una de las formas de pago de % no dice en que caja entra la plata.',
          v.codigo using errcode = 'P0001';
      end if;
      v_leg_moneda := coalesce(nullif(btrim(coalesce(v_leg->>'moneda', '')), ''), v.moneda);
      v_leg_cuenta := nullif(btrim(coalesce(v_leg->>'cuenta', '')), '');

      -- Primero el saldo (devuelve el antes y el después reales), después el
      -- renglón del libro con esos dos números. Todo en la misma transacción:
      -- si el segundo paso falla, el primero se deshace solo.
      select coalesce(nombre, 'la caja') into v_caja_nombre from public.cajas where id = v_leg_caja;

      begin
        -- MGG: Tesorería es multimoneda (caja_saldos por cuenta y moneda). El
        -- ingreso va por caja_ingresar_divisa (saldo + lote + libro) y después
        -- se marca su renglón como cobro de esta venta.
        v_saldo := public.caja_ingresar_divisa(
          v_leg_caja, coalesce(v_leg_cuenta, 'general'), v_leg_moneda, v_leg_monto,
          case when v_leg_moneda = 'Bs' then 1 else v.tasa_bs end,
          'Cliente: ' || coalesce(v_cli_nombre, '—'),
          'Cobro de venta ' || v.codigo || coalesce(' · ' || v_cli_nombre, ''),
          v_actor, nullif(btrim(coalesce(p_actor_name, '')), ''));
        update public.movimientos_caja
           set categoria = 'cobro_venta', beneficiario = v_cli_nombre, ref_venta_id = v.id
         where id = (v_saldo->>'mov_id')::uuid;
      exception when others then
        -- El trigger `bloquear_movimiento_en_caja_cerrada` habla en jerga de
        -- Postgres. Al vendedor le tiene que llegar en castellano. Cualquier
        -- otro error sube tal cual: tragárselo sería peor que mostrarlo feo.
        if sqlerrm ilike '%ya fue cerrada%' or sqlerrm ilike '%caja%cerrada%' then
          raise exception 'La caja de ese periodo esta cerrada: no se puede registrar el cobro ahi (%).',
            v_caja_nombre using errcode = 'P0001';
        end if;
        raise;
      end;
    end loop;

  -- ── 8 · A crédito: la deuda va a la cuenta corriente del cliente ──
  -- `crear_o_acumular_cxc` en la MISMA transacción: si la venta se confirmara
  -- acá y la deuda se registrara desde el navegador, un corte en el medio
  -- dejaría una venta a crédito sin deuda — plata que nadie debe.
  elsif v_diferencia > 0 then
    if coalesce(btrim(coalesce(v_cli_nombre, '')), '') = '' then
      raise exception 'La venta % queda por cobrar y no tiene cliente: no se sabe a quien cargarle la deuda.',
        v.codigo using errcode = 'P0001';
    end if;
    -- El último parámetro sella de qué venta viene el cargo. Importa porque la
    -- cuenta es CORRIENTE: acumula varias ventas del mismo cliente, y sin esto
    -- tres ventas a crédito se ven como una deuda sola, sin poder decir cuál
    -- trajo cuánto. El cargo es el único lugar donde se distinguen.
    v_cxc := public.crear_o_acumular_cxc(
      'cliente', v_cli_nombre, v_diferencia, v.moneda,
      null, null, null,
      'Venta ' || v.codigo, v_actor, nullif(btrim(coalesce(p_actor_name, '')), ''),
      v.id);
    v_cxc_id := v_cxc.id;
  end if;

  -- ── 9 · Queda confirmada. El stock no se tocó ─────────────────────
  update public.ventas
     set subtotal       = v_subtotal,
         descuento      = v_desc_doc,
         iva_pct        = v_pct,
         iva_monto      = v_iva,
         igtf_pct       = v_igtf_pct,
         igtf_monto     = v_igtf,
         total          = v_total,
         costo_total    = v_costo_total,
         ganancia_total = v_ganancia,
         valor_recibido = v_recibido,
         diferencia     = v_diferencia,
         cliente_nombre = v_cli_nombre,
         cliente_rif    = v_cli_rif,
         pago_legs      = v_legs,
         cxc_id         = coalesce(v_cxc_id, cxc_id),
         estado         = 'confirmada',
         confirmada_at  = now(),
         confirmada_por = v_quien,
         updated_at     = now()
   where id = v.id
   returning * into v;

  return v;
end $function$
;

-- entregar_venta
CREATE OR REPLACE FUNCTION public.entregar_venta(p_venta_id uuid, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v            public.ventas;
  r            record;
  v_mov        public.movimientos;
  v_nombre     text;
  v_hay        numeric;
  v_faltan     numeric;
  v_msg        text;
  v_state      text;
  v_actor      text := nullif(trim(coalesce(p_actor, '')), '');
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
  v_salieron   numeric;
  v_entraron   numeric;
begin
  if p_venta_id is null then
    raise exception 'Falta decir qué venta se entrega.' using errcode = 'check_violation';
  end if;

  -- `for update` porque dos usuarios pueden apretar «Entregar» en el mismo
  -- segundo: el segundo espera acá y se encuentra el estado ya en «entregada»,
  -- que es exactamente lo que rechaza la guarda de abajo. Sin el candado, los
  -- dos leerían «confirmada» y el stock saldría dos veces.
  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'No existe la venta %.', p_venta_id using errcode = 'no_data_found';
  end if;

  if v.estado <> 'confirmada' then
    raise exception 'La venta % está en «%»: solo se entrega una venta confirmada.',
      v.codigo, v.estado using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.ventas_renglones where venta_id = v.id) then
    raise exception 'La venta % no tiene renglones: no hay nada que entregar.',
      v.codigo using errcode = 'check_violation';
  end if;

  -- Red de seguridad contra una entrega repetida que se le escapara al estado:
  -- `mov_id` lleno significa que ese renglón ya salió del almacén una vez.
  if exists (select 1 from public.ventas_renglones where venta_id = v.id and mov_id is not null) then
    raise exception 'La venta % ya tiene renglones descargados del almacén: no se entrega dos veces.',
      v.codigo using errcode = 'check_violation';
  end if;

  -- ═════════════════════════════════════════════════════════════════
  -- 1 · Sale lo vendido
  -- ═════════════════════════════════════════════════════════════════
  for r in
    select * from public.ventas_renglones where venta_id = v.id order by orden, id
  loop
    v_nombre := coalesce(nullif(r.producto_nombre, ''), nullif(r.producto_sku, ''),
                         (select p.nombre from public.productos p where p.id = r.producto_id),
                         'este producto');
    begin
      v_mov := public.registrar_movimiento_stock(jsonb_build_object(
        'producto_id', r.producto_id,
        'tipo',        'salida',
        'delta',       -r.cantidad,
        'ref_tipo',    'venta',
        'ref_id',      v.id::text,
        'ref_codigo',  v.codigo,
        'actor',       coalesce(v_actor, v.actor),
        'actor_name',  coalesce(v_actor_name, v.actor_name),
        'destino',     coalesce(nullif(v.cliente_nombre, ''), 'Cliente'),
        'detalle',     format('Entrega de la venta %s · %s', v.codigo, v_nombre)
      ));
    exception when others then
      -- Se traduce el error, no se lo perdona: las dos ramas terminan en un
      -- `raise`, así que la transacción entera se va abajo y el stock de los
      -- renglones anteriores vuelve solo.
      get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
      select coalesce(sum(e.stock), 0) into v_hay
        from public.existencias e where e.producto_id = r.producto_id;
      v_faltan := r.cantidad - v_hay;
      if v_state = '23514' and v_faltan > 0 then
        raise exception 'No se entregó la venta %: de «%» hacen falta % y hay %. Faltan %. No se movió nada del almacén.',
          v.codigo, v_nombre,
          trim(to_char(r.cantidad, 'FM999999990.####')),
          trim(to_char(v_hay,      'FM999999990.####')),
          trim(to_char(v_faltan,   'FM999999990.####'))
          using errcode = 'check_violation';
      end if;
      raise exception 'No se entregó la venta %: falló la salida de «%» (%). No se movió nada del almacén.',
        v.codigo, v_nombre, v_msg using errcode = v_state;
    end;

    -- Guarda de sanidad: lo que dice el kardex que salió tiene que ser lo que
    -- el renglón dice que se vendió. Si algún día un trigger recorta la salida,
    -- acá se ve; no en el inventario físico tres meses después.
    v_salieron := v_mov.stock_antes - v_mov.stock_despues;
    if round(v_salieron, 4) <> round(r.cantidad, 4) then
      raise exception 'Descuadre entregando %: de «%» se pidió sacar % y el kardex sacó %.',
        v.codigo, v_nombre,
        trim(to_char(r.cantidad,  'FM999999990.####')),
        trim(to_char(v_salieron, 'FM999999990.####'))
        using errcode = 'check_violation';
    end if;

    update public.ventas_renglones set mov_id = v_mov.id where id = r.id;
  end loop;

  -- ════════════════════════════════════���════════════════════════════
  -- 2 · Entra lo recibido (solo permuta)
  -- ═════════════════════════════════════════════════════════════════
  -- El intercambio ocurre físicamente en un solo acto: la misma transacción que
  -- saca lo vendido mete lo que el cliente trajo.
  if v.tipo = 'permuta' then
    for r in
      select * from public.ventas_recibidos where venta_id = v.id order by orden, id
    loop
      v_nombre := coalesce(nullif(r.producto_nombre, ''), nullif(r.producto_sku, ''),
                           (select p.nombre from public.productos p where p.id = r.producto_id),
                           'este producto');
      begin
        v_mov := public.registrar_movimiento_stock(jsonb_build_object(
          'producto_id',     r.producto_id,
          'tipo',            'entrada',
          'delta',           r.cantidad,
          -- El valor pactado ES el costo de ingreso: con esto el promedio
          -- ponderado de la ficha se recalcula solo.
          'precio_unitario', r.valor_unit,
          'ref_tipo',        'venta',
          'ref_id',          v.id::text,
          'ref_codigo',      v.codigo,
          'actor',           coalesce(v_actor, v.actor),
          'actor_name',      coalesce(v_actor_name, v.actor_name),
          'detalle',         format('Material recibido en la permuta %s · %s (valor pactado %s por %s)',
                                    v.codigo, v_nombre,
                                    trim(to_char(r.valor_unit, 'FM999999990.00')),
                                    coalesce(nullif(r.unidad, ''), 'unidad'))
        ));
      exception when others then
        get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
        raise exception 'No se entregó la permuta %: falló la entrada de «%» (%). No se movió nada del almacén.',
          v.codigo, v_nombre, v_msg using errcode = v_state;
      end;

      v_entraron := v_mov.stock_despues - v_mov.stock_antes;
      if round(v_entraron, 4) <> round(r.cantidad, 4) then
        raise exception 'Descuadre entregando %: de «%» se pidió meter % y el kardex metió %.',
          v.codigo, v_nombre,
          trim(to_char(r.cantidad,  'FM999999990.####')),
          trim(to_char(v_entraron, 'FM999999990.####'))
          using errcode = 'check_violation';
      end if;

      update public.ventas_recibidos set mov_id = v_mov.id where id = r.id;
    end loop;
  end if;

  -- ═════════════════════���═══════════════════════════════════════════
  -- 3 · El documento pasa a entregada
  -- ═════════════════════════════════════════════════════════════════
  -- `entregada_por` guarda el actor (el correo), igual que `cerrada_por` y
  -- `aprobada_por` en el resto del sistema; el nombre se muestra buscándolo.
  update public.ventas
     set estado        = 'entregada',
         entregada_at  = now(),
         entregada_por = coalesce(v_actor, v_actor_name, v.actor),
         updated_at    = now()
   where id = v.id
   returning * into v;

  return v;
end;
$function$
;

-- enviar_venta_a_autorizar
CREATE OR REPLACE FUNCTION public.enviar_venta_a_autorizar(p_venta_id uuid, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v        public.ventas;
  v_n      int;
  v_quien  text;
  v_rol    text;
begin
  v_quien := coalesce(nullif(btrim(coalesce(p_actor_name, '')), ''), nullif(btrim(coalesce(p_actor, '')), ''), 'sistema');

  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'No existe la venta %.', p_venta_id using errcode = 'P0001';
  end if;
  if v.estado <> 'borrador' then
    raise exception 'La venta % ya esta %: solo un borrador se envia a autorizar.', v.codigo, v.estado using errcode = 'P0001';
  end if;
  select count(*) into v_n from public.ventas_renglones where venta_id = v.id;
  if v_n = 0 then
    raise exception 'La venta % no tiene renglones: no hay nada que autorizar.', v.codigo using errcode = 'P0001';
  end if;

  update public.ventas
     set estado = 'por_autorizar', enviada_at = now(), enviada_por = v_quien,
         rechazada_at = null, rechazada_por = null, rechazo_motivo = null,
         updated_at = now()
   where id = v.id
   returning * into v;

  foreach v_rol in array array['admin', 'jefe_de_administracion'] loop
    if not exists (select 1 from public.notificaciones n
                    where n.dedup_key = 'venta-autorizar:' || v.id::text || ':' || v_rol and n.read = false) then
      insert into public.notificaciones (destino, kind, title, message, link, dedup_key)
      values (v_rol, 'warning',
              'Venta ' || v.codigo || ' · despacho por aprobar',
              coalesce(v.cliente_nombre, 'Sin cliente') || ' · ' || v.total::text || ' ' || v.moneda || ' · la envió ' || v_quien,
              '#/app/ventas', 'venta-autorizar:' || v.id::text || ':' || v_rol);
    end if;
  end loop;

  return v;
end $function$
;

-- autorizar_venta
CREATE OR REPLACE FUNCTION public.autorizar_venta(p_venta_id uuid, p_aprobar boolean, p_motivo text DEFAULT NULL::text, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v        public.ventas;
  v_quien  text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_rol    text;
begin
  if not public.es_autorizador_ventas() then
    raise exception 'Solo un administrador o un usuario autorizado para aprobar despachos puede autorizar o rechazar.' using errcode = 'P0001';
  end if;
  v_quien := coalesce(nullif(btrim(coalesce(p_actor_name, '')), ''), nullif(btrim(coalesce(p_actor, '')), ''), 'autorizador');

  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'No existe la venta %.', p_venta_id using errcode = 'P0001';
  end if;
  if v.estado <> 'por_autorizar' then
    raise exception 'La venta % esta %: no hay nada que autorizar.', v.codigo, v.estado using errcode = 'P0001';
  end if;

  if p_aprobar then
    update public.ventas
       set estado = 'autorizada', autorizada_at = now(), autorizada_por = v_quien, updated_at = now()
     where id = v.id returning * into v;
  else
    if v_motivo is null then
      raise exception 'Para rechazar la venta % hay que decir por que.', v.codigo using errcode = 'P0001';
    end if;
    update public.ventas
       set estado = 'borrador', rechazada_at = now(), rechazada_por = v_quien, rechazo_motivo = v_motivo,
           autorizada_at = null, autorizada_por = null, updated_at = now()
     where id = v.id returning * into v;
  end if;

  update public.notificaciones set read = true
   where dedup_key like 'venta-autorizar:' || v.id::text || ':%' and read = false;

  select u.role into v_rol from public.usuarios u where lower(u.email) = lower(coalesce(v.actor, '')) limit 1;
  if v_rol is not null then
    insert into public.notificaciones (destino, kind, title, message, link)
    values (v_rol, case when p_aprobar then 'success' else 'danger' end,
            'Venta ' || v.codigo || case when p_aprobar then ' autorizada' else ' rechazada' end,
            case when p_aprobar then 'La autorizó ' || v_quien || '. Ya se puede confirmar.'
                 else 'La rechazó ' || v_quien || ': ' || v_motivo end,
            '#/app/ventas');
  end if;

  return v;
end $function$
;

-- aprobar_despacho_venta
CREATE OR REPLACE FUNCTION public.aprobar_despacho_venta(p_venta_id uuid, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v        public.ventas;
  v_email  text;
  v_admin  boolean;
  v_pidio  text;
  v_quien  text;
  v_rol    text;
begin
  if not public.es_autorizador_ventas() then
    raise exception 'Solo un administrador o un usuario autorizado para aprobar despachos puede aprobarlo.' using errcode = 'P0001';
  end if;
  -- Quién aprueba sale de la SESIÓN (auth.uid()), nunca de lo que manda la pantalla:
  -- `p_actor` / `p_actor_name` se ignoran para que el rastro no se pueda falsear.
  select lower(btrim(u.email)), u.role::text = 'admin',
         coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), u.email)
    into v_email, v_admin, v_quien
    from public.usuarios u where u.id = auth.uid();
  if v_email is null then
    raise exception 'No se pudo identificar al usuario que aprueba.' using errcode = '42501';
  end if;

  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'No existe la venta %.', p_venta_id using errcode = 'P0001';
  end if;
  if v.estado <> 'por_autorizar' then
    raise exception 'La venta % está %: solo se aprueba un despacho que se pidió.', v.codigo, v.estado using errcode = 'P0001';
  end if;

  -- Nadie aprueba su propio pedido (salvo un administrador). Quién lo pidió lo
  -- escribe el trigger con el correo de la sesión: no lo puede tocar el cliente.
  -- Si no se sabe quién lo pidió, solo un administrador lo aprueba (falla cerrado).
  select lower(btrim(e->>'actor')) into v_pidio
    from jsonb_array_elements(coalesce(v.historial, '[]'::jsonb)) e
   where e->>'evento' = 'enviada_a_autorizar'
   order by e->>'at' desc
   limit 1;
  if not coalesce(v_admin, false) and (v_pidio is null or v_pidio in ('', 'sistema')) then
    raise exception 'No se sabe quién pidió el despacho de la venta %: solo un administrador puede aprobarlo.', v.codigo
      using errcode = '42501';
  end if;
  if not coalesce(v_admin, false) and v_pidio = v_email then
    raise exception 'No puedes aprobar el despacho de la venta % porque lo pediste tú. Lo aprueba otro autorizado o un administrador.', v.codigo
      using errcode = '42501';
  end if;

  -- 1) Aprobado (el trigger valida la transición y deja el rastro).
  update public.ventas
     set estado = 'autorizada', autorizada_at = now(), autorizada_por = v_quien,
         no_despacho_motivo = null, no_despacho_detalle = null, no_despacho_por = null, no_despacho_en = null,
         updated_at = now()
   where id = v.id;

  -- 2) Se congela y queda por cobrar (o entra a caja si ya se cobró).
  perform public.confirmar_venta(v.id, v_email, v_quien);
  -- 3) Sale el material. Si falta existencia, se deshace TODO.
  perform public.entregar_venta(v.id, v_email, v_quien);

  update public.notificaciones set read = true
   where dedup_key like 'venta-autorizar:' || v.id::text || ':%' and read = false;

  select * into v from public.ventas where id = v.id;
  select u.role::text into v_rol from public.usuarios u where lower(u.email) = lower(coalesce(v.actor, '')) limit 1;
  if v_rol is not null then
    insert into public.notificaciones (destino, kind, title, message, link)
    values (v_rol, 'success', 'Despacho aprobado · ' || v.codigo,
            'Lo aprobó ' || v_quien || '. Salió el material y la venta queda por cobrar.', '#/app/ventas');
  end if;
  return v;
end $function$
;

-- rechazar_despacho_venta
CREATE OR REPLACE FUNCTION public.rechazar_despacho_venta(p_venta_id uuid, p_motivo text, p_actor_name text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v        public.ventas;
  v_mot    text := nullif(upper(left(btrim(coalesce(p_motivo, '')), 400)), '');
  v_quien  text;
  v_rol    text;
begin
  if not public.es_autorizador_ventas() then
    raise exception 'Solo un administrador o un usuario autorizado para aprobar despachos puede responderlo.' using errcode = 'P0001';
  end if;
  if coalesce(length(v_mot), 0) < 4 then
    raise exception 'Escribe la justificación (al menos 4 letras).' using errcode = 'P0001';
  end if;
  -- El nombre sale de la sesión; `p_actor_name` se ignora (no se puede falsear el rastro).
  select coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), u.email) into v_quien
    from public.usuarios u where u.id = auth.uid();

  select * into v from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'No existe la venta %.', p_venta_id using errcode = 'P0001'; end if;
  if v.estado <> 'por_autorizar' then
    raise exception 'La venta % está %: no hay un despacho por aprobar.', v.codigo, v.estado using errcode = 'P0001';
  end if;

  update public.ventas
     set estado = 'anulada', anulada_at = now(), anulada_por = v_quien,
         motivo_anulacion = 'NO PROCEDE: ' || v_mot, updated_at = now()
   where id = v.id
   returning * into v;

  update public.notificaciones set read = true
   where dedup_key like 'venta-autorizar:' || v.id::text || ':%' and read = false;
  select u.role::text into v_rol from public.usuarios u where lower(u.email) = lower(coalesce(v.actor, '')) limit 1;
  if v_rol is not null then
    insert into public.notificaciones (destino, kind, title, message, link)
    values (v_rol, 'danger', 'Despacho ' || v.codigo || ' no aprobado', 'No procede: ' || v_mot || ' · ' || coalesce(v_quien, ''), '#/app/ventas');
  end if;
  return v;
end $function$
;

-- venta_no_se_despacha
CREATE OR REPLACE FUNCTION public.venta_no_se_despacha(p_venta_id uuid, p_motivo text, p_detalle text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v        public.ventas;
  v_det    text := nullif(upper(left(btrim(coalesce(p_detalle, '')), 500)), '');
  v_quien  text;
  v_rol    text;
  v_texto  text;
begin
  if not public.es_autorizador_ventas() then
    raise exception 'Solo un administrador o un usuario autorizado para aprobar despachos puede responderlo.' using errcode = 'P0001';
  end if;
  if p_motivo is null or p_motivo not in ('deuda_vencida', 'sin_cupo', 'sin_existencia', 'otro') then
    raise exception 'Elige por qué no se despacha.' using errcode = 'P0001';
  end if;
  if p_motivo = 'otro' and coalesce(length(v_det), 0) < 4 then
    raise exception 'Especifica el motivo (al menos 4 letras).' using errcode = 'P0001';
  end if;
  -- El nombre sale de la sesión; `p_actor_name` se ignora (no se puede falsear el rastro).
  select coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), u.email) into v_quien
    from public.usuarios u where u.id = auth.uid();

  select * into v from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'No existe la venta %.', p_venta_id using errcode = 'P0001'; end if;
  if v.estado <> 'por_autorizar' then
    raise exception 'La venta % está %: no hay un despacho por aprobar.', v.codigo, v.estado using errcode = 'P0001';
  end if;

  update public.ventas
     set no_despacho_motivo = p_motivo, no_despacho_detalle = v_det,
         no_despacho_por = v_quien, no_despacho_en = now()
   where id = v.id
   returning * into v;

  v_texto := case p_motivo
    when 'deuda_vencida' then 'Cliente con deuda vencida'
    when 'sin_cupo' then 'Cliente sin cupo de crédito'
    when 'sin_existencia' then 'No hay existencia en el inventario'
    else 'Otro' end || coalesce(': ' || v_det, '');
  select u.role::text into v_rol from public.usuarios u where lower(u.email) = lower(coalesce(v.actor, '')) limit 1;
  if v_rol is not null then
    insert into public.notificaciones (destino, kind, title, message, link)
    values (v_rol, 'warning', 'Despacho ' || v.codigo || ' no aprobado por ahora', v_texto || ' · ' || coalesce(v_quien, ''), '#/app/ventas');
  end if;
  return v;
end $function$
;

-- facturar_venta
CREATE OR REPLACE FUNCTION public.facturar_venta(p_venta_id uuid, p_numero_factura text, p_numero_control text, p_iva_pct numeric DEFAULT NULL::numeric, p_igtf_pct numeric DEFAULT NULL::numeric, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v          public.ventas;
  v_nf       text := nullif(btrim(coalesce(p_numero_factura, '')), '');
  v_nc       text := nullif(btrim(coalesce(p_numero_control, '')), '');
  v_iva_pct  numeric;
  v_igtf_pct numeric;
  v_base     numeric;
  v_iva      numeric;
  v_igtf     numeric;
  v_total    numeric;
  v_dif      numeric;
  v_delta    numeric;
  v_legs     numeric;
  v_cobrado  numeric;
  v_cxc      public.cuentas_por_cobrar;
  v_cxc_id   uuid;
  v_antes    uuid[];
  v_quien    text;
  v_email    text;
begin
  if not (public.is_admin() or public.puede_modulo('ventas', 'escritura')) then
    raise exception 'No tienes permiso para facturar ventas.' using errcode = '42501';
  end if;
  if v_nf is null then raise exception 'Escribe el número de la factura.' using errcode = 'P0001'; end if;
  if v_nc is null then raise exception 'Escribe el número de control.' using errcode = 'P0001'; end if;
  -- Quién factura sale de la SESIÓN; `p_actor` / `p_actor_name` se ignoran.
  select coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), u.email), lower(btrim(u.email))
    into v_quien, v_email
    from public.usuarios u where u.id = auth.uid();
  if v_email is null then
    raise exception 'No se pudo identificar al usuario que factura.' using errcode = '42501';
  end if;

  select * into v from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'No existe la venta %.', p_venta_id using errcode = 'P0001'; end if;
  if v.estado <> 'entregada' then
    raise exception 'La venta % está %: se factura una venta ya despachada.', v.codigo, v.estado using errcode = 'P0001';
  end if;
  if v.facturada_at is not null then
    raise exception 'La venta % ya tiene su factura (% · control %).', v.codigo, v.numero_factura, v.numero_control using errcode = 'P0001';
  end if;

  v_iva_pct  := greatest(0, coalesce(p_iva_pct, v.iva_pct, 0));
  v_igtf_pct := greatest(0, coalesce(p_igtf_pct, v.igtf_pct, 0));
  v_base  := round(coalesce(v.subtotal, 0) - coalesce(v.descuento, 0), 2);
  v_iva   := round(v_base * v_iva_pct / 100, 2);
  v_igtf  := round(v_base * v_igtf_pct / 100, 2);
  v_total := round(v_base + v_iva + v_igtf, 2);
  v_dif   := round(v_total - coalesce(v.valor_recibido, 0), 2);
  v_delta := round(v_dif - coalesce(v.diferencia, 0), 2);
  v_cxc_id := v.cxc_id;

  if abs(v_delta) > 0.004 then
    select coalesce(sum(coalesce((l->>'monto')::numeric, 0)), 0) into v_legs
      from jsonb_array_elements(coalesce(v.pago_legs, '[]'::jsonb)) l;
    if v_legs > 0 then
      raise exception 'La venta % ya se cobró en caja al despacharla: el IVA y el IGTF se quedan como estaban.', v.codigo using errcode = 'P0001';
    end if;
    select coalesce(sum(monto), 0) into v_cobrado
      from public.cuentas_por_cobrar_abonos where ref_venta_id = v.id;
    if v_dif < v_cobrado - 0.01 then
      raise exception 'Con esos impuestos la venta % quedaría por debajo de lo ya cobrado (%).', v.codigo, v_cobrado using errcode = 'P0001';
    end if;
    if v_delta > 0 then
      if coalesce(btrim(coalesce(v.cliente_nombre, '')), '') = '' then
        raise exception 'La venta % no tiene cliente: no se sabe a quién cargarle el impuesto.', v.codigo using errcode = 'P0001';
      end if;
      v_cxc := public.crear_o_acumular_cxc('cliente', v.cliente_nombre, v_delta, v.moneda, null, null, null,
        'Factura ' || v_nf || ' de la venta ' || v.codigo || ' (impuestos)', v_email, v_quien, v.id);
      v_cxc_id := v_cxc.id;
    else
      if v_cxc_id is null then
        raise exception 'La venta % no tiene cuenta por cobrar para descontarle impuestos.', v.codigo using errcode = 'P0001';
      end if;
      select coalesce(array_agg(id), '{}'::uuid[]) into v_antes
        from public.cuentas_por_cobrar_cargos where cuenta_id = v_cxc_id;
      perform public.revertir_cargo_cxc(v_cxc_id, -v_delta,
        'Factura ' || v_nf || ' de la venta ' || v.codigo || ' (ajuste de impuestos)', v_email, v_quien);
      update public.cuentas_por_cobrar_cargos set ref_venta_id = v.id
       where cuenta_id = v_cxc_id and not (id = any (v_antes));
    end if;
  end if;

  begin
    update public.ventas
       set documento = 'factura', numero_factura = v_nf, numero_control = v_nc,
           iva_pct = v_iva_pct, iva_monto = v_iva, igtf_pct = v_igtf_pct, igtf_monto = v_igtf,
           total = v_total, diferencia = v_dif, cxc_id = v_cxc_id,
           facturada_at = now(), facturada_por = v_quien, updated_at = now()
     where id = v.id
     returning * into v;
  exception when unique_violation then
    raise exception 'El número de control % ya está en otra venta.', v_nc using errcode = 'P0001';
  end;
  return v;
end $function$
;

-- anular_venta
CREATE OR REPLACE FUNCTION public.anular_venta(p_venta_id uuid, p_actor text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS ventas
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v              public.ventas;
  r              record;
  m              record;
  v_actor        text;
  v_quien        text;
  v_motivo       text;
  v_dif          numeric;
  v_abonos       int;
  v_cuenta_n     int;
  v_cargos_antes uuid[];
  v_saldo        jsonb;
  v_mov          public.movimientos;
  v_costo_ret    numeric;
  v_nombre       text;
  v_hay          numeric;
  v_msg          text;
  v_state        text;
  v_devuelto     numeric;
  v_sacado       numeric;
begin
  if p_venta_id is null then
    raise exception 'Falta decir qué venta se anula.' using errcode = 'P0001';
  end if;

  v_actor  := coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'sistema');
  v_quien  := coalesce(nullif(btrim(coalesce(p_actor_name, '')), ''), v_actor);
  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');

  -- ── 1 · Motivo obligatorio ────────────────────────────────────────
  -- Una anulación mueve plata y material para atrás. Sin motivo escrito,
  -- dentro de un mes nadie sabe si fue un error de carga, una devolución o una
  -- venta que se cayó.
  if v_motivo is null then
    raise exception 'Hay que escribir por que se anula la venta: el motivo queda guardado en el documento.'
      using errcode = 'P0001';
  end if;

  -- ── 2 · La venta, bloqueada hasta el fin de la transacción ────────
  -- Mismo `for update` que confirmar y entregar: dos pantallas apretando
  -- «Anular» a la vez tienen que hacer cola, no reversar dos veces.
  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'No existe la venta %.', p_venta_id using errcode = 'P0001';
  end if;
  if v.estado = 'anulada' then
    raise exception 'La venta % ya esta anulada (%). No se anula dos veces.',
      v.codigo, coalesce(to_char(v.anulada_at, 'DD/MM/YYYY'), 'sin fecha')
      using errcode = 'P0001';
  end if;

  v_dif := round(coalesce(v.diferencia, 0), 2);

  -- ═════════════════════════════════════════════════════════════════
  -- 3 · La deuda del cliente: se RESTA de la cuenta corriente
  -- ═════════════════════════════════════════════════════════════════
  -- Solo si confirmar llegó a cargarla: hace falta que la venta esté
  -- confirmada o entregada, que sea a crédito, que haya quedado un `cxc_id` y
  -- que la diferencia haya sido positiva (una permuta pareja no endeudó a
  -- nadie, y confirmar no le abrió cuenta a nadie).
  if v.estado in ('confirmada', 'entregada')
     and v.cxc_id is not null
     and v_dif > 0 then

    select count(*) into v_cuenta_n from public.cuentas_por_cobrar where id = v.cxc_id;
    if v_cuenta_n = 0 then
      raise exception 'La venta % apunta a una cuenta por cobrar que ya no existe: revisa Tesoreria antes de anular.',
        v.codigo using errcode = 'P0001';
    end if;

    -- ── El freno: plata que ya se cobró ────────────────────────────
    select count(*) into v_abonos
      from public.cuentas_por_cobrar_abonos where cuenta_id = v.cxc_id;
    if v_abonos > 0 then
      raise exception 'La cuenta del cliente ya tiene cobros: hay que devolver esa plata antes de anular la venta %.',
        v.codigo using errcode = 'P0001';
    end if;

    -- `revertir_cargo_cxc` no recibe la venta, así que el cargo negativo nace
    -- sin `ref_venta_id`. Se lo sellamos acá identificándolo por descarte: el
    -- único cargo de esa cuenta que no estaba antes de llamarla. Es el dato que
    -- Tesorería mira para ver la anulación venta por venta —la cuenta acumula,
    -- el cargo no—.
    select coalesce(array_agg(id), '{}'::uuid[]) into v_cargos_antes
      from public.cuentas_por_cobrar_cargos where cuenta_id = v.cxc_id;

    perform public.revertir_cargo_cxc(
      v.cxc_id, v_dif,
      'Anulacion de la venta ' || v.codigo || ' · ' || v_motivo,
      v_actor, nullif(btrim(coalesce(p_actor_name, '')), ''));

    update public.cuentas_por_cobrar_cargos
       set ref_venta_id = v.id
     where cuenta_id = v.cxc_id
       and not (id = any (v_cargos_antes));
  end if;

  -- ═════════════════════════════════════════════════════════════════
  -- 4 · El material vuelve al almacén (solo si había salido)
  -- ═════════════════════════════════════════════════════════════════
  if v.estado = 'entregada' then

    -- ── 4.a · Vuelve lo vendido ────────────────────────────────────
    for r in
      select * from public.ventas_renglones where venta_id = v.id order by orden, id
    loop
      -- Un renglón sin `mov_id` nunca salió del almacén: devolverlo sería
      -- inventar stock. No debería pasar con la venta en «entregada», pero si
      -- pasa se saltea en vez de duplicar material.
      if r.mov_id is null then
        continue;
      end if;

      v_nombre := coalesce(nullif(r.producto_nombre, ''), nullif(r.producto_sku, ''),
                           (select p.nombre from public.productos p where p.id = r.producto_id),
                           'este producto');

      -- El valor con el que efectivamente salió, no el congelado al confirmar.
      select round(coalesce(mo.costo_promedio, 0), 4) into v_costo_ret
        from public.movimientos mo where mo.id = r.mov_id;
      v_costo_ret := coalesce(nullif(v_costo_ret, 0), round(coalesce(r.costo_unit, 0), 4), 0);

      begin
        v_mov := public.registrar_movimiento_stock(jsonb_build_object(
          'producto_id',     r.producto_id,
          'tipo',            'entrada',
          'delta',           r.cantidad,
          -- Un precio nulo en `registrar_movimiento_stock` significa «no me
          -- informaron precio» y deja el costo promedio como estaba, que para
          -- una devolución sin costo conocido también es la respuesta correcta.
          'precio_unitario', case when v_costo_ret > 0 then v_costo_ret else null end,
          'ref_tipo',        'venta_anulacion',
          'ref_id',          v.id::text,
          'ref_codigo',      v.codigo,
          'actor',           v_actor,
          'actor_name',      nullif(btrim(coalesce(p_actor_name, '')), ''),
          'detalle',         format('Devolucion por anulacion de la venta %s · %s · %s',
                                    v.codigo, v_nombre, v_motivo)
        ));
      exception when others then
        -- Se traduce el error, no se lo perdona: las dos ramas terminan en un
        -- `raise`, así que la transacción entera se cae y nada queda a medias.
        get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
        raise exception 'No se anulo la venta %: fallo la devolucion de «%» al almacen (%). No se movio nada.',
          v.codigo, v_nombre, v_msg using errcode = v_state;
      end;

      -- Guarda de sanidad: lo que el kardex dice que volvió tiene que ser lo
      -- que el renglón dice que se había vendido.
      v_devuelto := v_mov.stock_despues - v_mov.stock_antes;
      if round(v_devuelto, 4) <> round(r.cantidad, 4) then
        raise exception 'Descuadre anulando %: de «%» se pidio devolver % y el kardex devolvio %.',
          v.codigo, v_nombre,
          trim(to_char(r.cantidad, 'FM999999990.####')),
          trim(to_char(v_devuelto, 'FM999999990.####'))
          using errcode = 'P0001';
      end if;
    end loop;

    -- ── 4.b · Y sale lo que se había recibido en la permuta ────────
    -- El intercambio se deshace entero: si el material vendido vuelve al
    -- estante, el que el cliente entregó a cambio tiene que salir. Acá es donde
    -- una anulación puede fallar legítimamente: si ese material ya se vendió o
    -- se consumió, no está para devolverlo.
    if v.tipo = 'permuta' then
      for r in
        select * from public.ventas_recibidos where venta_id = v.id order by orden, id
      loop
        if r.mov_id is null then
          continue;
        end if;

        v_nombre := coalesce(nullif(r.producto_nombre, ''), nullif(r.producto_sku, ''),
                             (select p.nombre from public.productos p where p.id = r.producto_id),
                             'este producto');

        begin
          v_mov := public.registrar_movimiento_stock(jsonb_build_object(
            'producto_id', r.producto_id,
            'tipo',        'salida',
            'delta',       -r.cantidad,
            'ref_tipo',    'venta_anulacion',
            'ref_id',      v.id::text,
            'ref_codigo',  v.codigo,
            'actor',       v_actor,
            'actor_name',  nullif(btrim(coalesce(p_actor_name, '')), ''),
            'destino',     coalesce(nullif(v.cliente_nombre, ''), 'Cliente'),
            'detalle',     format('Salida del material recibido en la permuta %s por anulacion · %s · %s',
                                  v.codigo, v_nombre, v_motivo)
          ));
        exception when others then
          get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
          select coalesce(sum(e.stock), 0) into v_hay
            from public.existencias e where e.producto_id = r.producto_id;
          if v_state = '23514' then
            raise exception 'No se anulo la permuta %: el material que entrego el cliente («%») ya no esta en el almacen. Hacen falta % y hay %. Reponelo o corregi el inventario antes de anular.',
              v.codigo, v_nombre,
              trim(to_char(r.cantidad, 'FM999999990.####')),
              trim(to_char(v_hay,      'FM999999990.####'))
              using errcode = 'P0001';
          end if;
          raise exception 'No se anulo la permuta %: fallo la salida de «%» (%). No se movio nada.',
            v.codigo, v_nombre, v_msg using errcode = v_state;
        end;

        v_sacado := v_mov.stock_antes - v_mov.stock_despues;
        if round(v_sacado, 4) <> round(r.cantidad, 4) then
          raise exception 'Descuadre anulando %: de «%» se pidio sacar % y el kardex saco %.',
            v.codigo, v_nombre,
            trim(to_char(r.cantidad, 'FM999999990.####')),
            trim(to_char(v_sacado,   'FM999999990.####'))
            using errcode = 'P0001';
        end if;
      end loop;
    end if;
  end if;

  -- ═════════════════════════════════════════════════════════════════
  -- 5 · La plata sale de la caja por donde entró
  -- ═════════════════════════════════════════════════════════════════
  -- Una fila por cada cobro real. El movimiento original NO se borra ni se
  -- edita: la caja tiene que poder mostrar que entraron 197,20 el martes y que
  -- salieron 197,20 el jueves por una anulación. Un libro de caja se corrige
  -- agregando renglones, no tachando.
  for m in
    select mc.* from public.movimientos_caja mc
     where mc.ref_venta_id = v.id
       and mc.categoria = 'cobro_venta'
       and mc.tipo = 'ingreso'
     order by mc.at, mc.id
  loop
    if round(coalesce(m.monto, 0), 2) <= 0 then
      continue;
    end if;

    -- MGG: sale del saldo de esa caja/cuenta/moneda (se permite negativo, igual que en GT).
    select coalesce(cs.saldo, 0) into v_hay from public.caja_saldos cs
     where cs.caja_id = m.caja_id and cs.cuenta = coalesce(m.cuenta, 'general') and cs.moneda = m.moneda for update;
    v_hay := coalesce(v_hay, 0);
    update public.caja_saldos set saldo = round(v_hay - round(m.monto, 2), 2), updated_at = now()
     where caja_id = m.caja_id and cuenta = coalesce(m.cuenta, 'general') and moneda = m.moneda;
    v_saldo := jsonb_build_object('saldo_antes', v_hay, 'saldo_despues', round(v_hay - round(m.monto, 2), 2));

    insert into public.movimientos_caja (
      caja_id, tipo, monto, moneda, cuenta, tasa_bs,
      saldo_antes, saldo_despues, motivo, categoria, beneficiario,
      ref_venta_id, actor, actor_name
    ) values (
      m.caja_id, 'salida', round(m.monto, 2), m.moneda, m.cuenta, m.tasa_bs,
      (v_saldo->>'saldo_antes')::numeric, (v_saldo->>'saldo_despues')::numeric,
      'Reverso por anulacion de la venta ' || v.codigo || ' · ' || v_motivo,
      -- La marca que pide Tesorería para poder rastrear estos movimientos.
      'reverso_venta', m.beneficiario,
      v.id, v_actor, nullif(btrim(coalesce(p_actor_name, '')), '')
    );
  end loop;

  -- ═════════════════════════════════════════════════════════════════
  -- 6 · El documento queda anulado, con su firma y su motivo
  -- ═════════════════════════════════════════════════════════════════
  -- Los totales, el costo congelado y la ganancia NO se borran: una venta
  -- anulada sigue siendo un documento que hay que poder leer e imprimir. Los
  -- reportes filtran por estado, no por campos vacíos.
  update public.ventas
     set estado           = 'anulada',
         anulada_at       = now(),
         anulada_por      = v_quien,
         motivo_anulacion = v_motivo,
         updated_at       = now()
   where id = v.id
   returning * into v;

  return v;
end $function$
;

-- 5 · Triggers
drop trigger if exists trg_ventas_guardia_y_historial on public.ventas;
CREATE TRIGGER trg_ventas_guardia_y_historial BEFORE INSERT OR UPDATE ON public.ventas FOR EACH ROW EXECUTE FUNCTION public.ventas_guardia_y_historial();
drop trigger if exists trg_cxc_abono_venta_valida on public.cuentas_por_cobrar_abonos;
CREATE TRIGGER trg_cxc_abono_venta_valida BEFORE INSERT OR UPDATE OF ref_venta_id, monto, cuenta_id ON public.cuentas_por_cobrar_abonos FOR EACH ROW EXECUTE FUNCTION public.cxc_abono_venta_valida();

-- 6 · RLS por la matriz de permisos (Roles y Permisos)
alter table public.ventas enable row level security;
alter table public.ventas_renglones enable row level security;
alter table public.ventas_recibidos enable row level security;
alter table public.cuentas_por_cobrar_cargos enable row level security;
drop policy if exists "ventas read rol" on public.ventas;
drop policy if exists "ventas write op" on public.ventas;
drop policy if exists "ventas_renglones read rol" on public.ventas_renglones;
drop policy if exists "ventas_renglones write op" on public.ventas_renglones;
drop policy if exists "ventas_recibidos read rol" on public.ventas_recibidos;
drop policy if exists "ventas_recibidos write op" on public.ventas_recibidos;
drop policy if exists "cxcc read rol" on public.cuentas_por_cobrar_cargos;
drop policy if exists "cxcc write op" on public.cuentas_por_cobrar_cargos;

create policy "cxcc read rol" on public.cuentas_por_cobrar_cargos as PERMISSIVE for SELECT to authenticated using ((( SELECT puede_modulo('tesoreria'::text, 'lectura'::text) AS puede_leer) OR ( SELECT puede_modulo('ventas'::text, 'lectura'::text) AS puede_leer)));
create policy "cxcc write op" on public.cuentas_por_cobrar_cargos as PERMISSIVE for ALL to authenticated using ((select public.is_operativo())) with check ((select public.is_operativo()));
create policy "ventas read rol" on public.ventas as PERMISSIVE for SELECT to authenticated using ((( SELECT puede_modulo('ventas'::text, 'lectura'::text) AS puede_leer) OR ( SELECT puede_modulo('tesoreria'::text, 'lectura'::text) AS puede_leer)));
create policy "ventas write op" on public.ventas as PERMISSIVE for ALL to authenticated using ((( SELECT is_admin() AS is_admin) OR ( SELECT puede_modulo('ventas'::text, 'escritura'::text) AS puede))) with check ((( SELECT is_admin() AS is_admin) OR ( SELECT puede_modulo('ventas'::text, 'escritura'::text) AS puede)));
create policy "ventas_recibidos read rol" on public.ventas_recibidos as PERMISSIVE for SELECT to authenticated using ((( SELECT puede_modulo('ventas'::text, 'lectura'::text) AS puede_leer) OR ( SELECT puede_modulo('tesoreria'::text, 'lectura'::text) AS puede_leer)));
create policy "ventas_recibidos write op" on public.ventas_recibidos as PERMISSIVE for ALL to authenticated using ((( SELECT is_admin() AS is_admin) OR ( SELECT puede_modulo('ventas'::text, 'escritura'::text) AS puede))) with check ((( SELECT is_admin() AS is_admin) OR ( SELECT puede_modulo('ventas'::text, 'escritura'::text) AS puede)));
create policy "ventas_renglones read rol" on public.ventas_renglones as PERMISSIVE for SELECT to authenticated using ((( SELECT puede_modulo('ventas'::text, 'lectura'::text) AS puede_leer) OR ( SELECT puede_modulo('tesoreria'::text, 'lectura'::text) AS puede_leer)));
create policy "ventas_renglones write op" on public.ventas_renglones as PERMISSIVE for ALL to authenticated using ((( SELECT is_admin() AS is_admin) OR ( SELECT puede_modulo('ventas'::text, 'escritura'::text) AS puede))) with check ((( SELECT is_admin() AS is_admin) OR ( SELECT puede_modulo('ventas'::text, 'escritura'::text) AS puede)));

revoke all on public.ventas, public.ventas_renglones, public.ventas_recibidos, public.cuentas_por_cobrar_cargos, public.ventas_movimientos_caja from anon;
grant select, insert, update, delete on public.ventas, public.ventas_renglones, public.ventas_recibidos, public.cuentas_por_cobrar_cargos to authenticated;
grant select on public.ventas_movimientos_caja to authenticated;
revoke all on function public.confirmar_venta(uuid, text, text), public.entregar_venta(uuid, text, text), public.anular_venta(uuid, text, text, text),
  public.enviar_venta_a_autorizar(uuid, text, text), public.autorizar_venta(uuid, boolean, text, text, text), public.aprobar_despacho_venta(uuid, text, text),
  public.rechazar_despacho_venta(uuid, text, text), public.venta_no_se_despacha(uuid, text, text, text),
  public.facturar_venta(uuid, text, text, numeric, numeric, text, text), public.registrar_movimiento_stock(jsonb),
  public.crear_o_acumular_cxc(text, text, numeric, text, text, uuid, uuid, text, text, text, uuid), public.revertir_cargo_cxc(uuid, numeric, text, text, text),
  public.es_autorizador_ventas() from public, anon;
grant execute on function public.confirmar_venta(uuid, text, text), public.entregar_venta(uuid, text, text), public.anular_venta(uuid, text, text, text),
  public.enviar_venta_a_autorizar(uuid, text, text), public.autorizar_venta(uuid, boolean, text, text, text), public.aprobar_despacho_venta(uuid, text, text),
  public.rechazar_despacho_venta(uuid, text, text), public.venta_no_se_despacha(uuid, text, text, text),
  public.facturar_venta(uuid, text, text, numeric, numeric, text, text), public.registrar_movimiento_stock(jsonb),
  public.crear_o_acumular_cxc(text, text, numeric, text, text, uuid, uuid, text, text, text, uuid), public.revertir_cargo_cxc(uuid, numeric, text, text, text),
  public.es_autorizador_ventas() to authenticated;

-- 7 · Realtime
do $$ declare t text; begin
  foreach t in array array['ventas', 'ventas_renglones', 'ventas_recibidos', 'cuentas_por_cobrar_cargos'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

select 'ok' as listo;
