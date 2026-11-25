-- ============================================================
-- Módulo: inventario / compras
-- Archivo: reparar-recepcion-sin-inventario-2026-11-24.sql
-- Estado: PREPARADO · PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- MGG · Reparar una OC que se marcó «recibida sin inventario»
--
-- 24-11-2026: recepción de desinfectantes en Matanza hecha desde almacén
-- Carlos. La OC quedó en «Crédito / cuentas abiertas» con el cartel
-- «📦 Recibido · pendiente por pagar», pero no hay movimientos ni subió
-- el stock. Esta reparación está PENSADA PARA UN CASO Y SOLAMENTE UNO:
-- la OC está recibida, tiene `sin_inventario = true` y NO tiene ninguna
-- entrada de stock a su nombre.
--
-- NO se ejecuta sola. Primero se llama SIN confirmar (solo diagnóstico);
-- recién con `p_confirmar => true` se escribe. Antes de escribir se guarda
-- una foto de la orden, el kardex, las existencias y el stock en
-- `recepcion_reparacion_backup_20261124`.
--
-- El movimiento de reparación se inserta con `ref_codigo` del OC pero
-- `ref_id = null` a propósito: así no choca con el trigger
-- `trg_movimientos_recepcion_unica` (que prohíbe escribir entradas de una
-- orden recibida hace más de 15 minutos). El kardex dice «REPARACIÓN…»
-- y el histórico de recepciones lo agrupa por el código de la OC.
-- ============================================================

create table if not exists public.recepcion_reparacion_backup_20261124 (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null,
  orden_id           uuid not null,
  creado_en          timestamptz not null default now(),
  creado_por         text,
  orden_json         jsonb not null,
  movimientos_antes  jsonb not null default '[]'::jsonb,
  existencias_antes  jsonb not null default '[]'::jsonb,
  productos_antes    jsonb not null default '[]'::jsonb
);

alter table public.recepcion_reparacion_backup_20261124 enable row level security;
drop policy if exists "backup reparacion solo admin" on public.recepcion_reparacion_backup_20261124;
create policy "backup reparacion solo admin" on public.recepcion_reparacion_backup_20261124
  for select using ((select public.is_admin()));
revoke all on table public.recepcion_reparacion_backup_20261124 from anon;
grant select on table public.recepcion_reparacion_backup_20261124 to authenticated;

create or replace function public.reparar_stock_recepcion_sin_inventario(
  p_codigo text,
  p_almacen text default null,
  p_confirmar boolean default false
)
returns table (
  renglon text,
  producto_id uuid,
  unidades numeric,
  stock_antes numeric,
  stock_despues numeric,
  accion text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden        public.ordenes%rowtype;
  v_alm          text;
  v_actor        text;
  v_ya           integer;
  v_item         record;
  v_cant         numeric;
  v_unidades     numeric;
  v_factor       numeric;
  v_uc           text;
  v_u            text;
  v_prod         public.productos%rowtype;
  v_precio       numeric;
  v_antes_p      numeric;
  v_despues_p    numeric;
  v_antes_e      numeric;
  v_costo_e      numeric;
  v_despues_e    numeric;
  v_pmp          numeric;
  v_hist         jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo un administrador puede reparar stock.';
  end if;

  select o.* into v_orden
    from public.ordenes o
   where o.codigo = p_codigo or o.oc_codigo = p_codigo or o.id::text = p_codigo
   order by o.created_at desc
   limit 1;
  if not found then
    raise exception 'No encontré la OC «%». Revisá el código en Pedidos.', p_codigo;
  end if;

  if v_orden.recibida_en is null then
    raise exception 'La OC % todavía no figura como recibida; no se cambia nada.', p_codigo;
  end if;
  if coalesce(v_orden.sin_inventario, false) is not true then
    raise exception 'La OC % no está marcada «sin inventario». No se cambia nada.', p_codigo;
  end if;

  -- Si ya entró algo (por esta OC o por una reparación anterior), NO se suma dos veces.
  select count(*) into v_ya
    from public.movimientos m
   where m.tipo = 'entrada'
     and (
       (m.ref_tipo = 'orden' and m.ref_id = v_orden.id::text)
       or (m.ref_codigo = v_orden.codigo and m.detalle ilike '%REPARACIÓN 24-11-2026%')
     );
  if v_ya > 0 then
    raise exception 'La OC % ya tiene entradas de inventario. No se vuelve a sumar stock.', p_codigo;
  end if;

  v_alm := coalesce(nullif(btrim(p_almacen), ''), nullif(btrim(coalesce(v_orden.almacen_destino, '')), ''), 'General');
  v_actor := coalesce(nullif(btrim(coalesce(v_orden.recibida_por, '')), ''), 'sistema');

  -- Respaldo ANTES de tocar nada (una foto por llamada, aunque sea diagnóstico).
  insert into public.recepcion_reparacion_backup_20261124 (
    codigo, orden_id, creado_por, orden_json,
    movimientos_antes, existencias_antes, productos_antes
  )
  values (
    coalesce(v_orden.oc_codigo, v_orden.codigo), v_orden.id, v_actor, to_jsonb(v_orden),
    coalesce((
      select jsonb_agg(to_jsonb(m) order by m.at)
        from public.movimientos m
       where m.ref_tipo = 'orden' and m.ref_id = v_orden.id::text
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(e) order by e.almacen)
        from public.existencias e
       where e.producto_id in (
         select (it.value->>'producto_id')::uuid
           from jsonb_array_elements(coalesce(v_orden.items, '[]'::jsonb)) it
          where nullif(it.value->>'producto_id', '') is not null
       )
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(p))
        from public.productos p
       where p.id in (
         select (it.value->>'producto_id')::uuid
           from jsonb_array_elements(coalesce(v_orden.items, '[]'::jsonb)) it
          where nullif(it.value->>'producto_id', '') is not null
       )
    ), '[]'::jsonb)
  );

  for v_item in
    select it.value as valor
      from jsonb_array_elements(coalesce(v_orden.items, '[]'::jsonb)) it
  loop
    v_cant := coalesce(
      nullif(v_item.valor->>'cantidad_recibida', '')::numeric,
      nullif(v_item.valor->>'cantidad', '')::numeric,
      0
    );
    if v_cant <= 0 then
      continue;
    end if;
    if nullif(v_item.valor->>'producto_id', '') is null then
      raise exception 'El renglón «%» no tiene ficha de producto. No se repara ese renglón.',
        coalesce(v_item.valor->>'nombre', v_item.valor->>'sku', 'sin nombre');
    end if;

    -- Misma regla de la app: el factor solo vale si se compró en OTRA medida.
    v_uc := upper(btrim(coalesce(v_item.valor->>'unidad_compra', '')));
    v_u  := upper(btrim(coalesce(v_item.valor->>'unidad', '')));
    v_factor := case
      when v_uc <> '' and v_uc <> v_u
       and not (v_uc in ('KG','KILO','KILOGRAMO') and v_u in ('KG','KILO','KILOGRAMO'))
       and not (v_uc in ('UND','UN','UNIDAD') and v_u in ('UND','UN','UNIDAD'))
      then coalesce(nullif((v_item.valor->>'factor_compra')::numeric, 0), 1)
      else 1
    end;
    v_unidades := round(v_cant * v_factor, 4);

    select p.* into v_prod from public.productos p where p.id = (v_item.valor->>'producto_id')::uuid;
    if not found then
      raise exception 'No existe la ficha de producto del renglón «%». No se repara.',
        coalesce(v_item.valor->>'nombre', v_item.valor->>'sku', 'sin nombre');
    end if;

    -- No se adivina tasa ni precio de compra: se usa el costo que ya tiene la ficha.
    v_precio := coalesce(nullif(v_prod.precio_promedio, 0), nullif(v_prod.precio, 0), 0);
    v_antes_p := coalesce(v_prod.stock, 0);
    v_despues_p := v_antes_p + v_unidades;

    select e.stock, e.costo_promedio into v_antes_e, v_costo_e
      from public.existencias e
     where e.producto_id = v_prod.id and e.almacen = v_alm;
    if not found then
      v_antes_e := 0;
      v_costo_e := v_precio;
    end if;
    v_despues_e := round(v_antes_e + v_unidades, 4);
    v_pmp := case when v_despues_e > 0
      then round((v_antes_e * coalesce(v_costo_e, v_precio) + v_unidades * v_precio) / v_despues_e, 4)
      else v_precio
    end;

    renglon := coalesce(v_item.valor->>'nombre', v_item.valor->>'sku', 'ítem');
    producto_id := v_prod.id;
    unidades := v_unidades;
    stock_antes := v_antes_p;
    stock_despues := v_despues_p;
    accion := case when p_confirmar then 'Cargado' else 'Se cargaría (no se hizo)' end;
    return next;

    if p_confirmar then
      insert into public.movimientos (
        producto_id, tipo, delta, stock_antes, stock_despues, actor, actor_name,
        ref_tipo, ref_id, ref_codigo, almacen, proveedor_id, detalle,
        precio_unitario, costo_promedio, at
      ) values (
        v_prod.id, 'entrada', v_unidades, v_antes_p, v_despues_p, v_actor, null,
        'orden', null, coalesce(v_orden.oc_codigo, v_orden.codigo), v_alm, v_orden.proveedor_id,
        format('REPARACIÓN 24-11-2026 · %s · recepción marcada sin inventario · %s %s → %s',
          coalesce(v_orden.oc_codigo, v_orden.codigo), v_unidades,
          coalesce(nullif(v_item.valor->>'unidad', ''), 'unidad'), v_alm),
        v_precio, v_pmp, now()
      );

      update public.productos p
         set stock = v_despues_p
       where p.id = v_prod.id;

      insert into public.existencias (producto_id, almacen, stock, costo_promedio, updated_at)
      values (v_prod.id, v_alm, v_despues_e, v_pmp, now())
      on conflict (producto_id, almacen) do update
        set stock = excluded.stock,
            costo_promedio = excluded.costo_promedio,
            updated_at = excluded.updated_at;
    end if;
  end loop;

  if p_confirmar then
    v_hist := coalesce(v_orden.historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'evento', 'stock_reparado_2026_11_24',
      'at', now(),
      'actor', v_actor,
      'codigo', coalesce(v_orden.oc_codigo, v_orden.codigo),
      'almacen', v_alm
    ));
    update public.ordenes o
       set sin_inventario = false,
           historial = v_hist
     where o.id = v_orden.id;

    renglon := 'TOTAL';
    producto_id := null;
    unidades := null;
    stock_antes := null;
    stock_despues := null;
    accion := 'Reparación aplicada · Ver el respaldo en recepcion_reparacion_backup_20261124';
    return next;
  end if;
end $$;

revoke all on function public.reparar_stock_recepcion_sin_inventario(text, text, boolean) from public, anon;
grant execute on function public.reparar_stock_recepcion_sin_inventario(text, text, boolean) to authenticated;

-- CÓMO USARLO (en el SQL Editor de Supabase, con un usuario administrador):
--   1) Diagnóstico, NO cambia nada:
--      select * from public.reparar_stock_recepcion_sin_inventario('OC-2026-XXXX');
--   2) Revisá el respaldo:
--      select codigo, creado_en, creado_por from public.recepcion_reparacion_backup_20261124 order by creado_en desc;
--   3) Solo si el diagnóstico dice «Se cargaría» para los renglones correctos:
--      select * from public.reparar_stock_recepcion_sin_inventario('OC-2026-XXXX', 'General', true);
--   4) Verificación:
--      select m.ref_codigo, m.almacen, m.delta, m.detalle, m.at
--        from public.movimientos m
--       where m.detalle ilike 'REPARACIÓN 24-11-2026%' order by m.at desc;
