-- ============================================================
-- MGG · Maquinaria · Entregas del almacén para mantenimiento (12-11-2026)
-- Traído de Golden Touch (commit 78bda6c2) y adaptado al esquema de MGG.
--
-- El almacenista saca material (teléfono de Inventario o Salidas en la PC) y
-- marca que es para el mantenimiento de una máquina. Eso crea una ENTREGA
-- (EMA-00001) que les llega a todos los roles con permiso en Maquinaria.
-- Maquinaria la abre, registra lo que se hizo (horómetro, fotos…) y queda en
-- la BITÁCORA de la máquina. Si no corresponde, la RECHAZA con el motivo: la
-- entrega vuelve al almacén como DEVOLUCIÓN y el almacenista le da entrada.
--
-- Diferencias con Golden Touch:
--   · El teléfono de MGG guarda las salidas en inventario_salidas_telefono
--     (no deposito_mina_salidas) y sus fotos en el bucket inventario-salidas.
--   · Las salidas de la PC son solicitudes: la entrega nace cuando se EJECUTA
--     una solicitud marcada (equipo_mant_id). Sus «fotos» son los adjuntos de
--     la solicitud (bucket salidas-adjuntos).
--   · Permisos con puede_modulo(módulo, nivel) / inv_tel_puede_escribir():
--     MGG no tiene puede(), puede_leer() ni puede_escribir_almacen().
--   · El correlativo sale de next_correlativo('maquinaria-entrega-almacen').
--   · Quién lo hizo (correo y nombre) lo pone la base (auth.uid() / jwt): las
--     RPC no reciben el nombre del cliente.
--   · La devolución entra al MISMO almacén del que salió el material (en MGG
--     el stock vive por almacén en existencias), con registrar_movimiento_stock.
--
-- Qué crea:
--   1. Tabla maquinaria_entregas_almacen (solo lectura directa; RLS).
--   2. Columnas nuevas en maquinaria_mantenimientos: tipos[], fotos, entrega_id.
--   3. Columnas nuevas en solicitudes_salida: equipo_mant_id, _nota, _tipo.
--   4. RPC entrega_mantenimiento_crear / _registrar / _rechazar / _dar_entrada
--      y entrega_mantenimiento_fotos_salida (las fotos al día de la salida).
--   5. Realtime de la tabla nueva.
--
-- Idempotente: se puede correr más de una vez.
-- ============================================================

-- 1. Tabla ----------------------------------------------------
create table if not exists public.maquinaria_entregas_almacen (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  equipo_id uuid not null references public.maquinaria_equipos(id),
  equipo_nombre text not null,
  origen text not null check (origen in ('telefono', 'pc')),
  almacen text,
  -- Teléfono: las filas de inventario_salidas_telefono. PC: la solicitud de salida ejecutada.
  salida_ids uuid[] not null default '{}',
  solicitud_salida_id uuid references public.solicitudes_salida(id) on delete set null,
  ref_codigo text,
  -- [{producto_id, producto_nombre, unidad, cantidad, almacen, salida_id?}] (lo arma la base)
  items jsonb not null default '[]'::jsonb,
  tipo_sugerido text,
  nota text,
  -- Fotos de la salida al momento de la entrega: [{path, filename, bucket}]
  fotos jsonb not null default '[]'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'registrada', 'rechazada')),
  entregado_por text,
  entregado_por_nombre text,
  created_at timestamptz not null default now(),
  atendida_por text,
  atendida_por_nombre text,
  atendida_en timestamptz,
  mantenimiento_id uuid,
  rechazo_motivo text,
  devolucion_estado text check (devolucion_estado in ('pendiente', 'recibida')),
  devolucion_por text,
  devolucion_por_nombre text,
  devolucion_en timestamptz,
  devolucion_nota text
);

create index if not exists maq_entregas_estado_idx on public.maquinaria_entregas_almacen (estado, created_at desc);
create index if not exists maq_entregas_equipo_idx on public.maquinaria_entregas_almacen (equipo_id, created_at desc);
create index if not exists maq_entregas_devolucion_idx on public.maquinaria_entregas_almacen (devolucion_estado) where devolucion_estado is not null;
create unique index if not exists maq_entregas_solicitud_unica
  on public.maquinaria_entregas_almacen (solicitud_salida_id) where solicitud_salida_id is not null;

-- 2. Bitácora: varios tipos por registro, fotos y la entrega de la que salió ----
alter table public.maquinaria_mantenimientos add column if not exists tipos text[];
alter table public.maquinaria_mantenimientos add column if not exists fotos jsonb not null default '[]'::jsonb;
alter table public.maquinaria_mantenimientos add column if not exists entrega_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maq_mant_entrega_fk') then
    alter table public.maquinaria_mantenimientos
      add constraint maq_mant_entrega_fk foreign key (entrega_id)
      references public.maquinaria_entregas_almacen(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maq_entrega_mant_fk') then
    alter table public.maquinaria_entregas_almacen
      add constraint maq_entrega_mant_fk foreign key (mantenimiento_id)
      references public.maquinaria_mantenimientos(id) on delete set null;
  end if;
end $$;

-- 3. Salidas de la PC: para qué máquina va (se llena al crear la solicitud) ----
alter table public.solicitudes_salida add column if not exists equipo_mant_id uuid references public.maquinaria_equipos(id);
alter table public.solicitudes_salida add column if not exists equipo_mant_nota text;
alter table public.solicitudes_salida add column if not exists equipo_mant_tipo text;

-- RLS de la tabla nueva: solo lectura directa; todo cambio pasa por las RPC.
alter table public.maquinaria_entregas_almacen enable row level security;
revoke all on public.maquinaria_entregas_almacen from anon;
revoke insert, update, delete, truncate on public.maquinaria_entregas_almacen from authenticated;
grant select on public.maquinaria_entregas_almacen to authenticated;

-- Quién puede LEER las entregas: Maquinaria (las atiende), Inventario y Salidas (las devoluciones).
create or replace function public.maq_entregas_puede_leer() returns boolean
language sql stable security definer set search_path = 'public' as $$
  select public.is_admin()
      or public.puede_modulo('maquinaria', 'lectura') or public.puede_modulo('maquinaria', 'escritura')
      or public.puede_modulo('inventario', 'lectura') or public.puede_modulo('inventario', 'escritura')
      or public.puede_modulo('salidas', 'lectura') or public.puede_modulo('salidas', 'escritura');
$$;

drop policy if exists "maq entregas read" on public.maquinaria_entregas_almacen;
create policy "maq entregas read" on public.maquinaria_entregas_almacen for select to authenticated using (
  (select public.maq_entregas_puede_leer())
  or lower(coalesce(entregado_por, '')) = (select lower(coalesce(auth.jwt()->>'email', '')))
);

-- Nombre de quien llama (lo pone la base, no el cliente).
create or replace function public.maq_entregas_nombre_actual() returns text
language sql stable security definer set search_path = 'public' as $$
  select nullif(btrim(coalesce(u.nombre, '')), '') from public.usuarios u where u.id = auth.uid();
$$;

-- Aviso a todos los roles con permiso (lectura o escritura) en Maquinaria. Sin
-- duplicar: la tabla notificaciones no tiene índice único por dedup_key.
create or replace function public.maq_entregas_avisar_maquinaria(p_id uuid, p_titulo text, p_mensaje text)
returns void language plpgsql security definer set search_path = 'public' as $$
begin
  insert into public.notificaciones (destino, kind, title, message, link, dedup_key)
  select rp.role, 'info', p_titulo, p_mensaje,
         '#/app/maquinaria/servicio-mantenimiento?entregas=1',
         'maq-entrega-' || p_id::text || '-' || rp.role
    from public.roles_permisos rp
   where (rp.role = 'admin'
      or coalesce((rp.permisos -> 'maquinaria' ->> 'lectura')::boolean, false)
      or coalesce((rp.permisos -> 'maquinaria' ->> 'escritura')::boolean, false)
      or coalesce((rp.permisos -> 'maquinaria' ->> 'full')::boolean, false))
     and not exists (select 1 from public.notificaciones n
                      where n.dedup_key = 'maq-entrega-' || p_id::text || '-' || rp.role);
end $$;

-- 4a. Crear la entrega (la llama quien hizo la salida) ------------------------
-- p: {origen: 'telefono'|'pc', equipo_id, salida_ids: [uuid], solicitud_salida_id, tipo_sugerido, nota}
create or replace function public.entrega_mantenimiento_crear(p jsonb)
returns public.maquinaria_entregas_almacen
language plpgsql security definer set search_path = 'public' as $$
declare
  v_email text := lower(nullif(auth.jwt()->>'email', ''));
  v_origen text := p->>'origen';
  v_equipo public.maquinaria_equipos;
  v_ids uuid[];
  v_sol public.solicitudes_salida;
  v_items jsonb := '[]'::jsonb;
  v_fotos jsonb := '[]'::jsonb;
  v_almacen text;
  v_ref text;
  v_tipo text := nullif(btrim(coalesce(p->>'tipo_sugerido', '')), '');
  v_nota text := nullif(btrim(coalesce(p->>'nota', '')), '');
  v_n int;
  v_e public.maquinaria_entregas_almacen;
begin
  if v_email is null or auth.uid() is null then raise exception 'Sesión no válida.' using errcode = '42501'; end if;
  -- Una entrega a la vez: así dos toques seguidos no crean dos entregas de la misma salida.
  perform pg_advisory_xact_lock(hashtext('maquinaria_entregas_almacen'));

  if v_origen = 'telefono' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_ids
      from jsonb_array_elements_text(coalesce(p->'salida_ids', '[]'::jsonb)) x;
    if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Faltan las salidas de la entrega.' using errcode = '23514'; end if;
    select count(*) into v_n from public.inventario_salidas_telefono s where s.id = any (v_ids);
    if v_n <> array_length(v_ids, 1) then raise exception 'No se encontró la salida.' using errcode = '23503'; end if;
    select count(*) into v_n from public.inventario_salidas_telefono s
     where s.id = any (v_ids) and lower(coalesce(s.actor, '')) = v_email and s.created_at > now() - interval '2 days';
    if v_n <> array_length(v_ids, 1) and not public.is_admin() then
      raise exception 'Solo quien hizo la salida (en los últimos 2 días) puede enviarla a Maquinaria.' using errcode = '42501';
    end if;
    if exists (select 1 from public.maquinaria_entregas_almacen e where e.salida_ids && v_ids) then
      raise exception 'Esa salida ya se envió a Maquinaria.' using errcode = '23505';
    end if;
    select * into v_equipo from public.maquinaria_equipos where id = nullif(p->>'equipo_id', '')::uuid;
    if v_equipo.id is null then raise exception 'Elige la máquina a la que va el material.' using errcode = '23514'; end if;
    -- Solo lo que todavía no retornó: si parte ya volvió por «Por retornar», eso no se entrega ni se devuelve.
    select coalesce(jsonb_agg(jsonb_build_object('producto_id', s.producto_id, 'producto_nombre', s.producto_nombre,
             'unidad', s.unidad, 'cantidad', s.cantidad - s.retornado, 'almacen', s.almacen, 'salida_id', s.id) order by s.producto_nombre)
             filter (where s.cantidad - s.retornado > 0), '[]'::jsonb),
           min(s.almacen), string_agg(distinct s.codigo, ', ')
      into v_items, v_almacen, v_ref
      from public.inventario_salidas_telefono s where s.id = any (v_ids);
    -- Las fotos van una sola vez aunque estén repetidas en cada fila del lote.
    select coalesce(jsonb_agg(distinct jsonb_build_object('path', f->>'path', 'filename', f->>'filename', 'bucket', 'inventario-salidas')), '[]'::jsonb)
      into v_fotos
      from public.inventario_salidas_telefono s, jsonb_array_elements(coalesce(s.fotos, '[]'::jsonb)) f
     where s.id = any (v_ids) and coalesce(f->>'path', '') <> '';
  elsif v_origen = 'pc' then
    select * into v_sol from public.solicitudes_salida where id = nullif(p->>'solicitud_salida_id', '')::uuid;
    if v_sol.id is null then raise exception 'No se encontró la solicitud de salida.' using errcode = '23503'; end if;
    if v_sol.scope <> 'salida' or v_sol.tipo <> 'material' then
      raise exception 'Solo una salida de material se envía a Maquinaria.' using errcode = '23514';
    end if;
    if v_sol.estado <> 'ejecutada' then raise exception 'La salida todavía no se ejecutó.' using errcode = '23514'; end if;
    if exists (select 1 from public.maquinaria_entregas_almacen e where e.solicitud_salida_id = v_sol.id) then
      raise exception 'Esa salida ya se envió a Maquinaria.' using errcode = '23505';
    end if;
    if lower(coalesce(v_sol.ejecutada_por, '')) <> v_email and not (public.is_admin()
       or public.puede_modulo('salidas', 'escritura') or public.puede_aprobar('salidas')) then
      raise exception 'Solo quien ejecutó la salida (o quien trabaja en Salidas) puede enviarla a Maquinaria.' using errcode = '42501';
    end if;
    if v_sol.equipo_mant_id is null then
      raise exception 'Esa salida no se marcó para el mantenimiento de una máquina.' using errcode = '23514';
    end if;
    select * into v_equipo from public.maquinaria_equipos where id = v_sol.equipo_mant_id;
    if v_equipo.id is null then raise exception 'No se encontró la máquina de la salida.' using errcode = '23503'; end if;
    if jsonb_typeof(v_sol.items) = 'array' and jsonb_array_length(v_sol.items) > 0 then
      -- Fuera la comida que fue vale de cocina o viajó a otra cocina: esa no salió para la máquina.
      select coalesce(jsonb_agg(jsonb_build_object('producto_id', i->>'producto_id', 'producto_nombre', coalesce(i->>'producto_nombre', pr.nombre),
               'unidad', coalesce(nullif(i->>'unidad', ''), pr.unidad), 'cantidad', (i->>'cantidad')::numeric,
               'almacen', coalesce(nullif(i->>'almacen', ''), v_sol.almacen_origen))), '[]'::jsonb)
        into v_items
        from jsonb_array_elements(v_sol.items) i
        left join public.productos pr on pr.id::text = i->>'producto_id'
       where not coalesce((i->>'descuenta_cocina')::boolean, false)
         and coalesce(i->>'traslado_cocina', '') = ''
         and coalesce((i->>'cantidad')::numeric, 0) > 0;
    elsif v_sol.producto_id is not null and coalesce(v_sol.cantidad, 0) > 0 then
      select jsonb_build_array(jsonb_build_object('producto_id', v_sol.producto_id, 'producto_nombre', coalesce(v_sol.producto_nombre, pr.nombre),
               'unidad', pr.unidad, 'cantidad', v_sol.cantidad, 'almacen', v_sol.almacen_origen))
        into v_items
        from public.productos pr where pr.id = v_sol.producto_id;
    end if;
    v_almacen := coalesce(v_items->0->>'almacen', v_sol.almacen_origen);
    v_ref := v_sol.codigo;
    v_tipo := coalesce(v_tipo, nullif(btrim(coalesce(v_sol.equipo_mant_tipo, '')), ''));
    v_nota := coalesce(v_nota, nullif(btrim(coalesce(v_sol.equipo_mant_nota, '')), ''));
    select coalesce(jsonb_agg(jsonb_build_object('path', a->>'path', 'filename', a->>'filename', 'bucket', 'salidas-adjuntos')), '[]'::jsonb)
      into v_fotos
      from jsonb_array_elements(case when jsonb_typeof(v_sol.adjuntos) = 'array' then v_sol.adjuntos else '[]'::jsonb end) a
     where coalesce(a->>'path', '') <> '';
  else
    raise exception 'Origen no válido.' using errcode = '23514';
  end if;

  if jsonb_array_length(coalesce(v_items, '[]'::jsonb)) = 0 then
    raise exception 'La salida no tiene materiales para entregar.' using errcode = '23514';
  end if;

  insert into public.maquinaria_entregas_almacen (
    codigo, equipo_id, equipo_nombre, origen, almacen, salida_ids, solicitud_salida_id, ref_codigo,
    items, tipo_sugerido, nota, fotos, entregado_por, entregado_por_nombre
  ) values (
    'EMA-' || lpad(public.next_correlativo('maquinaria-entrega-almacen')::text, 5, '0'),
    v_equipo.id, v_equipo.equipo, v_origen, v_almacen, coalesce(v_ids, '{}'), v_sol.id, v_ref,
    v_items, v_tipo, v_nota, coalesce(v_fotos, '[]'::jsonb), v_email, public.maq_entregas_nombre_actual()
  ) returning * into v_e;

  perform public.maq_entregas_avisar_maquinaria(v_e.id,
    '📦 Entrega del almacén para mantenimiento',
    coalesce(v_e.entregado_por_nombre, v_e.entregado_por) || ' entrega ' || jsonb_array_length(v_items)
      || case when jsonb_array_length(v_items) = 1 then ' ítem' else ' ítems' end
      || ' para la máquina ' || v_e.equipo_nombre || ' (' || v_e.codigo || ').');
  return v_e;
end $$;

-- 4b. Maquinaria registra el trabajo → bitácora --------------------------------
-- p: {equipo_id?, fecha, tipos: [text], horometro, kilometraje, aceite_lts, refrigerante_lts,
--     trabajo, mecanico, ubicacion, observacion, fotos: [{path, filename}]}
create or replace function public.entrega_mantenimiento_registrar(p_id uuid, p jsonb)
returns public.maquinaria_entregas_almacen
language plpgsql security definer set search_path = 'public' as $$
declare
  v_email text := lower(nullif(auth.jwt()->>'email', ''));
  v_nombre text := public.maq_entregas_nombre_actual();
  v_e public.maquinaria_entregas_almacen;
  v_equipo public.maquinaria_equipos;
  v_tipos text[];
  v_fecha date;
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_fotos jsonb := coalesce(p->'fotos', '[]'::jsonb);
  v_mant uuid;
  v_consumibles text;
  v_num numeric;
  k text;
begin
  if not (public.is_admin() or public.puede_modulo('maquinaria', 'escritura')) then
    raise exception 'Solo Maquinaria (con permiso de escritura) registra el mantenimiento.' using errcode = '42501';
  end if;
  select * into v_e from public.maquinaria_entregas_almacen where id = p_id for update;
  if v_e.id is null then raise exception 'No se encontró la entrega.' using errcode = '23503'; end if;
  if v_e.estado <> 'pendiente' then raise exception 'Esa entrega ya se atendió.' using errcode = '23514'; end if;

  -- Maquinaria puede corregir la máquina si el almacén eligió otra.
  select * into v_equipo from public.maquinaria_equipos
   where id = coalesce(nullif(p->>'equipo_id', '')::uuid, v_e.equipo_id);
  if v_equipo.id is null then raise exception 'No se encontró la máquina.' using errcode = '23503'; end if;

  -- Sin repetidos y en el orden en que se marcaron: el primero va como tipo principal.
  select coalesce(array_agg(y.tipo order by y.orden), '{}') into v_tipos
    from (select btrim(x.t) as tipo, min(x.o) as orden
            from jsonb_array_elements_text(coalesce(p->'tipos', '[]'::jsonb)) with ordinality as x(t, o)
           where btrim(x.t) <> ''
           group by btrim(x.t)) y;
  if coalesce(array_length(v_tipos, 1), 0) = 0 then raise exception 'Indica qué se hizo (al menos un tipo).' using errcode = '23514'; end if;

  v_fecha := coalesce(nullif(p->>'fecha', '')::date, v_hoy);
  if v_fecha > v_hoy then raise exception 'La fecha del mantenimiento no puede ser futura.' using errcode = '23514'; end if;
  foreach k in array array['horometro', 'kilometraje', 'aceite_lts', 'refrigerante_lts'] loop
    v_num := nullif(p->>k, '')::numeric;
    if v_num is not null and v_num < 0 then raise exception 'El % no puede ser negativo.', replace(k, '_lts', '') using errcode = '23514'; end if;
  end loop;
  if jsonb_typeof(v_fotos) <> 'array' or jsonb_array_length(v_fotos) > 8 then
    raise exception 'Se pueden adjuntar hasta 8 fotos.' using errcode = '23514';
  end if;

  -- trim_scale y no rtrim('0'): rtrim convertía «10» en «1».
  select string_agg(coalesce(i->>'producto_nombre', 'Material') || ' ×' ||
           trim_scale((i->>'cantidad')::numeric)::text || coalesce(' ' || nullif(i->>'unidad', ''), ''), ' · ')
    into v_consumibles from jsonb_array_elements(v_e.items) i;

  insert into public.maquinaria_mantenimientos (
    equipo_id, fecha, tipo, tipos, horometro, kilometraje, aceite_lts, refrigerante_lts,
    trabajo, consumibles, mecanico, ubicacion, observacion, fotos, entrega_id, created_by, actor_name
  ) values (
    v_equipo.id, v_fecha, v_tipos[1], v_tipos,
    nullif(p->>'horometro', '')::numeric, nullif(p->>'kilometraje', '')::numeric,
    nullif(p->>'aceite_lts', '')::numeric, nullif(p->>'refrigerante_lts', '')::numeric,
    nullif(btrim(coalesce(p->>'trabajo', '')), ''), v_consumibles,
    nullif(upper(btrim(coalesce(p->>'mecanico', ''))), ''), nullif(upper(btrim(coalesce(p->>'ubicacion', ''))), ''),
    concat_ws(' · ', 'Entrega del almacén ' || v_e.codigo || coalesce(' (' || v_e.ref_codigo || ')', ''),
      nullif(btrim(coalesce(p->>'observacion', '')), '')),
    v_fotos, v_e.id, v_email, v_nombre
  ) returning id into v_mant;

  update public.maquinaria_entregas_almacen
     set estado = 'registrada', mantenimiento_id = v_mant,
         equipo_id = v_equipo.id, equipo_nombre = v_equipo.equipo,
         atendida_por = v_email, atendida_por_nombre = v_nombre, atendida_en = now()
   where id = p_id
  returning * into v_e;
  return v_e;
end $$;

-- 4c. Maquinaria la rechaza → vuelve al almacén como devolución ------------
create or replace function public.entrega_mantenimiento_rechazar(p_id uuid, p_motivo text)
returns public.maquinaria_entregas_almacen
language plpgsql security definer set search_path = 'public' as $$
declare
  v_email text := lower(nullif(auth.jwt()->>'email', ''));
  v_e public.maquinaria_entregas_almacen;
  v_rol text;
begin
  if not (public.is_admin() or public.puede_modulo('maquinaria', 'escritura')) then
    raise exception 'Solo Maquinaria (con permiso de escritura) puede rechazar la entrega.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribe el motivo del rechazo.' using errcode = '23514'; end if;
  select * into v_e from public.maquinaria_entregas_almacen where id = p_id for update;
  if v_e.id is null then raise exception 'No se encontró la entrega.' using errcode = '23503'; end if;
  if v_e.estado <> 'pendiente' then raise exception 'Esa entrega ya se atendió.' using errcode = '23514'; end if;

  update public.maquinaria_entregas_almacen
     set estado = 'rechazada', rechazo_motivo = btrim(p_motivo), devolucion_estado = 'pendiente',
         atendida_por = v_email, atendida_por_nombre = public.maq_entregas_nombre_actual(), atendida_en = now()
   where id = p_id
  returning * into v_e;

  -- Aviso al rol de quien la entregó (normalmente «almacenista»).
  select u.role into v_rol from public.usuarios u where lower(u.email) = lower(v_e.entregado_por) limit 1;
  if not exists (select 1 from public.notificaciones where dedup_key = 'maq-entrega-rechazo-' || v_e.id::text) then
    insert into public.notificaciones (destino, kind, title, message, link, dedup_key)
    values (coalesce(v_rol, 'almacenista'), 'warning', '↩ Maquinaria devolvió una entrega',
            'La entrega ' || v_e.codigo || ' (' || v_e.equipo_nombre || ') fue rechazada: ' || v_e.rechazo_motivo
              || '. Dale entrada al inventario desde '
              || case when v_e.origen = 'pc' then 'Salidas.' else '«Por retornar» del teléfono.' end,
            case when v_e.origen = 'pc' then '#/app/salidas' else '#/app/inventario/telefono' end,
            'maq-entrega-rechazo-' || v_e.id::text);
  end if;
  return v_e;
end $$;

-- 4d. El almacenista le da entrada a la devolución -------------------------------
create or replace function public.entrega_mantenimiento_dar_entrada(p_id uuid, p_nota text default null)
returns public.maquinaria_entregas_almacen
language plpgsql security definer set search_path = 'public' as $$
declare
  v_email text := lower(nullif(auth.jwt()->>'email', ''));
  v_nombre text := public.maq_entregas_nombre_actual();
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_e public.maquinaria_entregas_almacen;
  i jsonb;
  v_alm text;
  v_cant numeric;
  v_pend numeric;
begin
  if v_email is null or auth.uid() is null then raise exception 'Sesión no válida.' using errcode = '42501'; end if;
  if not (public.is_admin() or public.inv_tel_puede_escribir()
          or public.puede_modulo('salidas', 'escritura') or public.puede_aprobar('salidas')) then
    raise exception 'No tienes permiso para darle entrada al inventario.' using errcode = '42501';
  end if;
  select * into v_e from public.maquinaria_entregas_almacen where id = p_id for update;
  if v_e.id is null then raise exception 'No se encontró la entrega.' using errcode = '23503'; end if;
  if v_e.estado <> 'rechazada' or coalesce(v_e.devolucion_estado, '') <> 'pendiente' then
    raise exception 'Esa devolución ya se recibió (o la entrega no fue rechazada).' using errcode = '23514';
  end if;

  for i in select * from jsonb_array_elements(v_e.items) loop
    -- Vuelve al MISMO almacén del que salió (en MGG el stock vive por almacén).
    v_alm := coalesce(nullif(btrim(coalesce(i->>'almacen', '')), ''), v_e.almacen);
    if v_alm is null then
      raise exception 'No se sabe de qué almacén salió %: la devolución se hace a mano.', i->>'producto_nombre' using errcode = '23514';
    end if;
    if not exists (select 1 from public.productos where id = (i->>'producto_id')::uuid) then
      raise exception 'No se encontró el producto %.', i->>'producto_nombre' using errcode = '23503';
    end if;
    v_cant := round(coalesce((i->>'cantidad')::numeric, 0), 4);
    -- Teléfono: nunca más de lo que todavía falta por volver de esa salida.
    if nullif(i->>'salida_id', '') is not null then
      select greatest(0, cantidad - retornado) into v_pend from public.inventario_salidas_telefono
       where id = (i->>'salida_id')::uuid for update;
      v_cant := least(v_cant, coalesce(v_pend, 0));
    end if;
    if v_cant <= 0 then continue; end if;

    perform public.registrar_movimiento_stock(jsonb_build_object(
      'producto_id', i->>'producto_id', 'tipo', 'entrada', 'delta', v_cant, 'almacen', v_alm,
      'actor', v_email, 'actor_name', v_nombre,
      'ref_tipo', 'devolucion_maquinaria', 'ref_id', v_e.id::text, 'ref_codigo', v_e.codigo,
      'detalle', 'Devolución de Maquinaria ' || v_e.codigo || ' (' || v_e.equipo_nombre || ')'
        || coalesce(' · ' || v_e.ref_codigo, '') || coalesce(' · ' || v_nota, '')));

    -- Teléfono: la salida original queda con su retorno anotado (mismo registro que «Por retornar»).
    if nullif(i->>'salida_id', '') is not null then
      update public.inventario_salidas_telefono
         set retornado = retornado + v_cant,
             estado = case when retornado + v_cant >= cantidad then 'retornada'
                           when retorna then 'por_retornar' else estado end,
             retornos = retornos || jsonb_build_array(jsonb_build_object(
               'at', now(), 'cantidad', v_cant,
               'nota', 'Devolución de Maquinaria ' || v_e.codigo || coalesce(' · ' || v_nota, ''),
               'actor', v_email, 'actor_name', v_nombre)),
             updated_at = now()
       where id = (i->>'salida_id')::uuid;
    end if;
  end loop;

  update public.maquinaria_entregas_almacen
     set devolucion_estado = 'recibida', devolucion_por = v_email,
         devolucion_por_nombre = v_nombre, devolucion_en = now(), devolucion_nota = v_nota
   where id = p_id
  returning * into v_e;
  return v_e;
end $$;

-- 4e. Las fotos de la salida AL DÍA (en el teléfono se pueden sumar fotos
--     después de guardar; en la PC, adjuntos). Mismo permiso que leer la entrega.
create or replace function public.entrega_mantenimiento_fotos_salida(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = 'public' as $$
declare
  v_e public.maquinaria_entregas_almacen;
  v_out jsonb := '[]'::jsonb;
begin
  select * into v_e from public.maquinaria_entregas_almacen where id = p_id;
  if v_e.id is null then return '[]'::jsonb; end if;
  if not (public.maq_entregas_puede_leer()
          or lower(coalesce(v_e.entregado_por, '')) = lower(coalesce(auth.jwt()->>'email', ''))) then
    raise exception 'No tienes permiso para ver esta entrega.' using errcode = '42501';
  end if;
  if v_e.origen = 'telefono' then
    select coalesce(jsonb_agg(distinct jsonb_build_object('path', f->>'path', 'filename', f->>'filename', 'bucket', 'inventario-salidas')), '[]'::jsonb)
      into v_out
      from public.inventario_salidas_telefono s, jsonb_array_elements(coalesce(s.fotos, '[]'::jsonb)) f
     where s.id = any (v_e.salida_ids) and coalesce(f->>'path', '') <> '';
  elsif v_e.solicitud_salida_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('path', a->>'path', 'filename', a->>'filename', 'bucket', 'salidas-adjuntos')), '[]'::jsonb)
      into v_out
      from public.solicitudes_salida s,
           jsonb_array_elements(case when jsonb_typeof(s.adjuntos) = 'array' then s.adjuntos else '[]'::jsonb end) a
     where s.id = v_e.solicitud_salida_id and coalesce(a->>'path', '') <> '';
  end if;
  -- Si la salida ya no tiene fotos (o se borró), quedan las que tenía al entregarse.
  return case when jsonb_array_length(coalesce(v_out, '[]'::jsonb)) > 0 then v_out else v_e.fotos end;
end $$;

revoke all on function public.maq_entregas_puede_leer() from public, anon;
revoke all on function public.maq_entregas_nombre_actual() from public, anon;
revoke all on function public.maq_entregas_avisar_maquinaria(uuid, text, text) from public, anon, authenticated;
revoke all on function public.entrega_mantenimiento_crear(jsonb) from public, anon;
revoke all on function public.entrega_mantenimiento_registrar(uuid, jsonb) from public, anon;
revoke all on function public.entrega_mantenimiento_rechazar(uuid, text) from public, anon;
revoke all on function public.entrega_mantenimiento_dar_entrada(uuid, text) from public, anon;
revoke all on function public.entrega_mantenimiento_fotos_salida(uuid) from public, anon;
grant execute on function public.maq_entregas_puede_leer() to authenticated;
grant execute on function public.maq_entregas_nombre_actual() to authenticated;
grant execute on function public.entrega_mantenimiento_crear(jsonb) to authenticated;
grant execute on function public.entrega_mantenimiento_registrar(uuid, jsonb) to authenticated;
grant execute on function public.entrega_mantenimiento_rechazar(uuid, text) to authenticated;
grant execute on function public.entrega_mantenimiento_dar_entrada(uuid, text) to authenticated;
grant execute on function public.entrega_mantenimiento_fotos_salida(uuid) to authenticated;

-- 5. Realtime -------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'maquinaria_entregas_almacen') then
    alter publication supabase_realtime add table public.maquinaria_entregas_almacen;
  end if;
end $$;

-- Comprobación
select
  (select relrowsecurity from pg_class where oid = 'public.maquinaria_entregas_almacen'::regclass) as rls,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'maquinaria_entregas_almacen') as realtime,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'maquinaria_mantenimientos'
     and column_name in ('tipos', 'fotos', 'entrega_id')) as columnas_bitacora,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'solicitudes_salida'
     and column_name in ('equipo_mant_id', 'equipo_mant_nota', 'equipo_mant_tipo')) as columnas_salidas,
  (select count(*) from pg_proc where proname like 'entrega_mantenimiento_%') as rpc;
