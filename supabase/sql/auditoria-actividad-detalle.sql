drop function if exists public.auditoria_actividad(timestamptz, timestamptz, text, integer);

create or replace function public.auditoria_actividad(
  p_desde timestamptz, p_hasta timestamptz, p_actor text default null, p_limit integer default 8000)
returns table(tabla text, actor text, actor_name text, ts timestamptz, accion text, detalle text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  parts text[] := '{}';
  actor_col text;
  name_col text;
  ts_col text;
  det_expr text;
  from_expr text;
  pair text[];
  pairs text[] := array[
    'aprobada_por|aprobada_en|aprobó',
    'ejecutada_por|ejecutada_en|ejecutó',
    'confirmada_por|confirmada_at|confirmó',
    'cerrado_por|cerrado_en|cerró'
  ];
  -- Columnas que sirven para decir QUÉ es la fila, de la más identificatoria a la
  -- más genérica. Se toman las cuatro primeras que existan en la tabla.
  prio text[] := array[
    'codigo','sku','numero','nombre','producto_nombre','titulo','item','concepto',
    'tanque_nombre','centro_nombre','descripcion','detalle','nota','motivo','metodo',
    'cuenta','monto','moneda','tipo','categoria','procedencia','almacen','destino',
    'planta','scope','valor','estado'
  ];
  p text;
  sql text;
begin
  if not exists (select 1 from public.usuarios where id = auth.uid() and role = 'admin') then
    raise exception 'Solo administradores pueden consultar la auditoría';
  end if;

  for r in
    select t.table_name from information_schema.tables t
    where t.table_schema='public' and t.table_type='BASE TABLE'
      and t.table_name <> 'user_sessions'
  loop
    -- columna de actor (texto): creación
    select c.column_name into actor_col from information_schema.columns c
      where c.table_schema='public' and c.table_name=r.table_name
        and c.column_name in ('actor','created_by','creado_por')
        and c.data_type in ('text','character varying')
      order by array_position(array['actor','created_by','creado_por'], c.column_name) limit 1;
    -- columna de tiempo de creación
    select c.column_name into ts_col from information_schema.columns c
      where c.table_schema='public' and c.table_name=r.table_name
        and c.column_name in ('created_at','at','fecha')
      order by array_position(array['created_at','at','fecha'], c.column_name) limit 1;
    -- nombre del actor (opcional)
    select c.column_name into name_col from information_schema.columns c
      where c.table_schema='public' and c.table_name=r.table_name
        and c.column_name='actor_name' and c.data_type in ('text','character varying') limit 1;

    -- QUÉ se tocó: hasta cuatro columnas descriptivas, unidas con " · ".
    from_expr := format('public.%I t', r.table_name);
    det_expr := null;
    select 'nullif(btrim(concat_ws('' · '', ' || string_agg(x.expr, ', ' order by x.ord) || ')), '''')'
      into det_expr
    from (
      select format('nullif(btrim((t.%I)::text), '''')', c.column_name) as expr,
             array_position(prio, c.column_name) as ord
      from information_schema.columns c
      where c.table_schema='public' and c.table_name = r.table_name
        and c.column_name = any(prio)
      order by array_position(prio, c.column_name)
      limit 4
    ) x;
    if det_expr is null then det_expr := 'null::text'; end if;

    -- El kardex es el caso que más se mira: ahí el "qué" es el PRODUCTO, que vive
    -- en otra tabla. Sin el join la auditoría decía "creó" y nada más.
    if r.table_name = 'movimientos' then
      from_expr := 'public.movimientos t left join public.productos pr on pr.id = t.producto_id';
      det_expr := 'nullif(btrim(concat_ws('' · '', (t.tipo)::text, '
                || 'coalesce(pr.nombre, ''producto borrado''), '
                || 'nullif(btrim(coalesce(pr.sku, '''')), ''''), '
                || 'nullif(btrim(coalesce(t.detalle, '''')), ''''), '
                || 'nullif(btrim(coalesce(t.almacen, '''')), ''''))), '''')';
    elsif r.table_name = 'existencias' then
      from_expr := 'public.existencias t left join public.productos pr on pr.id = t.producto_id';
      det_expr := 'nullif(btrim(concat_ws('' · '', coalesce(pr.nombre, ''producto borrado''), t.almacen)), '''')';
    end if;

    if actor_col is not null and ts_col is not null then
      parts := parts || format(
        'select %L::text, (t.%I)::text, %s, (t.%I)::timestamptz, %L::text, %s from %s where t.%I is not null and (t.%I)::timestamptz >= %L and (t.%I)::timestamptz < %L',
        r.table_name, actor_col,
        case when name_col is null then 'null::text' else format('(t.%I)::text', name_col) end,
        ts_col, 'creó', det_expr, from_expr, actor_col, ts_col, p_desde, ts_col, p_hasta);
    end if;

    -- acciones (aprobó/ejecutó/confirmó/cerró): requieren ambas columnas
    foreach p in array pairs loop
      pair := string_to_array(p, '|');
      if exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=r.table_name and c.column_name=pair[1] and c.data_type in ('text','character varying'))
         and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=r.table_name and c.column_name=pair[2]) then
        parts := parts || format(
          'select %L::text, (t.%I)::text, null::text, (t.%I)::timestamptz, %L::text, %s from %s where t.%I is not null and (t.%I)::timestamptz >= %L and (t.%I)::timestamptz < %L',
          r.table_name, pair[1], pair[2], pair[3], det_expr, from_expr, pair[1], pair[2], p_desde, pair[2], p_hasta);
      end if;
    end loop;
  end loop;

  if array_length(parts,1) is null then return; end if;

  sql := 'select u.tabla, u.actor, u.actor_name, u.ts, u.accion, u.detalle from ( '
      || array_to_string(parts, ' union all ')
      || ' ) as u(tabla,actor,actor_name,ts,accion,detalle) where u.actor is not null and u.actor <> '''''
      || case when p_actor is not null and p_actor <> '' then format(' and lower(u.actor)=lower(%L)', p_actor) else '' end
      || ' order by u.ts desc limit ' || greatest(coalesce(p_limit,8000), 1);
  return query execute sql;
end $function$;

grant execute on function public.auditoria_actividad(timestamptz, timestamptz, text, integer) to authenticated;
