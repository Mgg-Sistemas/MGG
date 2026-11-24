-- ============================================================
-- Módulo: pedidos / delivery
-- Archivo: ordenes-facturas-delivery-fotos-factura-2026-11-20.sql
-- Estado: PENDIENTE DE APLICAR EN SUPABASE SQL EDITOR
-- ------------------------------------------------------------
-- MGG · La factura nueva sí llega a Compras (20-11-2026)
--
-- Requiere aplicar ANTES: delivery-fotos-fix-2026-11-20.sql
-- (crea delivery_pedidos.fotos_factura). Si no está, este script se detiene
-- antes de tocar nada.
--
-- Hoy sync_fotos_delivery_a_orden() solo lee fotos_recibo y lo rotula
-- «factura». Con el grupo nuevo «Factura del proveedor», la foto se guarda en
-- fotos_factura y nunca se copia a ordenes.facturas_delivery: Compras ve
-- «FACTURAS DELIVERY (0)».
--
-- Este script:
--   1. reescribe la sincronía para preferir fotos_factura y usar fotos_recibo
--      solo como respaldo histórico (cuando no hay factura nueva);
--   2. agrega fotos_factura al UPDATE OF del trigger;
--   3. recalcula las OC ya existentes.
--
-- IDEMPOTENCIA: comprueba si la función y el trigger ya contemplan
--   fotos_factura; si es así, avisa con NOTICE y no toca nada.
-- REVERSIÓN: todo el cuerpo va dentro de un bloque con EXCEPTION. Si falla
--   cualquier sentencia, PostgreSQL deshace los cambios del bloque y vuelve
--   a lanzar el error, para no dejar una aplicación a medias.
-- ============================================================

do $mgg_sync_factura$
declare
  r record;
begin
  -- 0) Dependencia previa: sin la columna, no hacemos nada
  if not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'delivery_pedidos'
          and column_name = 'fotos_factura'
     )
  then
    raise exception
      'Falta aplicar primero supabase/sql/delivery/delivery-fotos-fix-2026-11-20.sql (columna fotos_factura).';
  end if;

  -- 1) Comprobar si ya fue aplicado
  if exists (
       select 1
         from pg_proc p
        where p.oid = to_regprocedure('public.sync_fotos_delivery_a_orden(uuid)')
          and pg_get_functiondef(p.oid) like '%fotos_factura%'
     )
     and exists (
       select 1
         from pg_trigger t
        where t.tgrelid = 'public.delivery_pedidos'::regclass
          and t.tgname = 'trg_fotos_delivery_a_orden'
          and pg_get_triggerdef(t.oid) like '%fotos_factura%'
     )
  then
    raise notice '[MGG 20-11 sync factura] YA APLICADO: no se modificó nada.';
    return;
  end if;

  begin
    -- ----------------------------------------------------------
    -- 2) Sincronía: factura nueva primero, recibo como respaldo
    -- ----------------------------------------------------------
    create or replace function public.sync_fotos_delivery_a_orden(p_orden_id uuid)
    returns void
    language plpgsql security definer set search_path = public as $fn$
    declare
      v_nuevo jsonb;
    begin
      if p_orden_id is null then return; end if;

      select coalesce(jsonb_agg(f order by f ->> 'n'), '[]'::jsonb) into v_nuevo
      from (
        select jsonb_build_object(
                 'path', v.x ->> 'path',
                 'filename', coalesce(v.x ->> 'filename', 'foto.jpg'),
                 'tipo', 'factura',
                 'quien', v.repartidor_nombre,
                 'pedido_id', v.pedido_id,
                 'n', v.orden || v.creado || lpad(v.k::text, 3, '0')
               ) as f
        from (
          -- Factura del proveedor (grupo nuevo): fuente preferida.
          select d.id as pedido_id, d.repartidor_nombre, d.created_at::text as creado,
                 e.x as x, e.k as k, '0' as orden
            from public.delivery_pedidos d,
                 jsonb_array_elements(coalesce(d.fotos_factura, '[]'::jsonb)) with ordinality as e(x, k)
           where d.orden_id = p_orden_id
             and e.x ->> 'path' is not null
          union all
          -- Histórico: antes la factura se subía como «foto al recibir».
          select d.id, d.repartidor_nombre, d.created_at::text,
                 e.x, e.k, '1'
            from public.delivery_pedidos d,
                 jsonb_array_elements(coalesce(d.fotos_recibo, '[]'::jsonb)) with ordinality as e(x, k)
           where d.orden_id = p_orden_id
             and e.x ->> 'path' is not null
             and jsonb_array_length(coalesce(d.fotos_factura, '[]'::jsonb)) = 0
        ) v
      ) s;

      update public.ordenes set facturas_delivery = v_nuevo
       where id = p_orden_id
         and facturas_delivery is distinct from v_nuevo;
    end $fn$;

    revoke all on function public.sync_fotos_delivery_a_orden(uuid) from public, anon;

    -- ----------------------------------------------------------
    -- 3) El trigger debe enterarse de cambios en fotos_factura
    -- ----------------------------------------------------------
    drop trigger if exists trg_fotos_delivery_a_orden on public.delivery_pedidos;
    create trigger trg_fotos_delivery_a_orden
      after insert or delete
         or update of fotos_recibo, fotos_factura, orden_id, repartidor_nombre
      on public.delivery_pedidos
      for each row execute function public.trg_fn_fotos_delivery_a_orden();

    -- ----------------------------------------------------------
    -- 4) Recalcular lo que ya estaba copiado
    -- ----------------------------------------------------------
    for r in
      select distinct orden_id
        from public.delivery_pedidos
       where orden_id is not null
      union
      select id as orden_id
        from public.ordenes
       where jsonb_array_length(coalesce(facturas_delivery, '[]'::jsonb)) > 0
    loop
      perform public.sync_fotos_delivery_a_orden(r.orden_id);
    end loop;

  exception when others then
    raise notice '[MGG 20-11 sync factura] ERROR: %. Se revierten todos los cambios de este script.', sqlerrm;
    raise;
  end;
end $mgg_sync_factura$;

-- Verificación (solo lectura)
with estado as (
  select
    exists (
      select 1 from pg_proc p
       where p.oid = to_regprocedure('public.sync_fotos_delivery_a_orden(uuid)')
         and pg_get_functiondef(p.oid) like '%fotos_factura%'
    ) as funcion,
    exists (
      select 1 from pg_trigger t
       where t.tgrelid = 'public.delivery_pedidos'::regclass
         and t.tgname = 'trg_fotos_delivery_a_orden'
         and pg_get_triggerdef(t.oid) like '%fotos_factura%'
    ) as disparador,
    exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'delivery_pedidos'
         and column_name = 'fotos_factura'
    ) as columna
)
select
  case when columna then 'OK' else 'FALTA' end as columna_fotos_factura,
  case when funcion then 'OK' else 'FALTA' end as sincroniza_factura,
  case when disparador then 'OK' else 'FALTA' end as trigger_actualizado,
  case when columna and funcion and disparador
       then 'SINCRONÍA APLICADA' else 'REVISAR' end as veredicto
from estado;

-- Comprobación opcional de datos: OC entregadas con factura en Delivery y
-- cuántas le llegaron a Compras (ambas columnas deben coincidir).
select coalesce(o.oc_codigo, o.codigo) as oc,
       jsonb_array_length(coalesce(d.fotos_factura, '[]'::jsonb)) as fotos_factura_delivery,
       jsonb_array_length(coalesce(o.facturas_delivery, '[]'::jsonb)) as facturas_en_compras
  from public.ordenes o
  join public.delivery_pedidos d on d.orden_id = o.id
 where jsonb_array_length(coalesce(d.fotos_factura, '[]'::jsonb)) > 0
 order by 1;
