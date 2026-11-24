-- ============================================================
-- Módulo: delivery
-- Archivo: delivery-fotos-fix-2026-11-20.sql
-- Estado: PENDIENTE DE APLICAR EN SUPABASE SQL EDITOR
-- ------------------------------------------------------------
-- MGG · Correctivo de fotos de delivery (20-11-2026)
--
-- La migración delivery-editar-fotos-2026-11-18.sql quedó APLICADA en la BD
-- (función y política DELETE existen), pero su cuerpo escribe en
-- delivery_pedidos.fotos_factura, columna que NO existe en el esquema real:
-- la base devolvió solo fotos_recibo y fotos_entrega.
-- Resultado: editar fotos de un pedido entregado falla con 42703 para los
-- TRES tipos (recibo, entrega y factura), no solo para factura.
--
-- Este correctivo hace, en este orden:
--   1. crea la columna fotos_factura (si no existe);
--   2. reescribe delivery_fotos para pedidos EN CURSO (recibo/entrega), con
--      validación de ruta y bloqueo de sobrescritura de pedidos entregados;
--   3. reescribe delivery_editar_fotos para pedidos ENTREGADOS, con permiso
--      por flota y la misma validación de ruta;
--   4. crea la RPC delivery_fotos_factura(uuid[]) que el front ya intenta usar;
--   5. endurece las políticas de storage: INSERT solo con prefijo válido y
--      DELETE solo con UUID válido, pedido entregado y flota correcta.
--
-- IDEMPOTENCIA: al inicio comprueba si el estado final ya está presente;
--   si es así, avisa con NOTICE y no toca nada.
-- REVERSIÓN: todo el cuerpo va dentro de un bloque con EXCEPTION. Si falla
--   cualquier sentencia, PostgreSQL deshace los cambios del bloque y vuelve
--   a lanzar el error, para no dejar una aplicación a medias.
-- ============================================================

do $mgg_fotos_fix$
begin
  -- ------------------------------------------------------------
  -- 0) Comprobar si ya fue aplicado
  -- ------------------------------------------------------------
  if exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'delivery_pedidos'
          and column_name = 'fotos_factura'
     )
     and to_regprocedure('public.delivery_fotos_factura(uuid[])') is not null
     and exists (
       select 1 from pg_proc p
        where p.oid = to_regprocedure('public.delivery_fotos(uuid,text,jsonb)')
          and pg_get_functiondef(p.oid) like '%pedido en curso%'
     )
     and exists (
       select 1
         from pg_policy
        where polrelid = 'storage.objects'::regclass
          and polname = 'delivery-fotos delete'
          and pg_get_expr(polqual, polrelid) like '%factura-%'
     )
  then
    raise notice '[MGG 20-11 fotos] YA APLICADO: no se modificó nada.';
    return;
  end if;

  begin
    -- ----------------------------------------------------------
    -- 1) La columna que faltaba
    -- ----------------------------------------------------------
    alter table public.delivery_pedidos
      add column if not exists fotos_factura jsonb not null default '[]'::jsonb;

    comment on column public.delivery_pedidos.fotos_factura is
      'Fotos de la factura del proveedor, cargadas con el pedido ya entregado. [{path, filename}]';

    -- ----------------------------------------------------------
    -- 2) Fotos en pedidos EN CURSO (recibo / entrega)
    -- ----------------------------------------------------------
    create or replace function public.delivery_fotos(
      p_pedido_id uuid, p_tipo text, p_fotos jsonb
    ) returns public.delivery_pedidos
    language plpgsql security definer set search_path = '' as $fn$
    declare
      v_d public.delivery_pedidos;
      f jsonb;
    begin
      if not public.delivery_puede('escritura') then
        raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
      end if;
      if p_tipo not in ('recibo', 'entrega') then
        raise exception 'Tipo de foto inválido.' using errcode = '23514';
      end if;
      if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) > 6 then
        raise exception 'Se pueden adjuntar hasta 6 fotos.' using errcode = '23514';
      end if;
      for f in select x from jsonb_array_elements(p_fotos) x loop
        if jsonb_typeof(f) <> 'object'
           or coalesce(f ->> 'path', '') not like p_pedido_id::text || '/' || p_tipo || '-%'
           or position('..' in coalesce(f ->> 'path', '')) > 0 then
          raise exception 'La foto % no corresponde a este pedido.', coalesce(f ->> 'path', '?') using errcode = '23514';
        end if;
      end loop;
      select * into v_d from public.delivery_pedidos where id = p_pedido_id for update;
      if v_d.id is null then
        raise exception 'No se encontró el pedido.' using errcode = '23503';
      end if;
      if v_d.estado not in ('aceptado', 'en_ruta') then
        raise exception 'Solo se pueden cargar fotos de un pedido en curso; si ya fue entregado usa la edición de fotos.' using errcode = 'P0001';
      end if;
      -- Ojo: flota_puede(..., 'full') NO se usa acá. Esa función devuelve true
      -- también con 'escritura' (ver su propia definición), lo que permitiría a
      -- cualquier operador de la flota sobrescribir las fotos de otro motorizado.
      if v_d.repartidor_id <> auth.uid()
         and not (public.is_admin()
                  or public.puede_modulo(
                       case when v_d.flota = 'carga_pesada' then 'carga_pesada' else 'delivery' end,
                       'full')) then
        raise exception 'Solo quien tomó el pedido puede subir sus fotos.' using errcode = '42501';
      end if;
      update public.delivery_pedidos set
        fotos_recibo = case when p_tipo = 'recibo' then p_fotos else fotos_recibo end,
        fotos_entrega = case when p_tipo = 'entrega' then p_fotos else fotos_entrega end,
        updated_at = now()
      where id = p_pedido_id
      returning * into v_d;
      return v_d;
    end $fn$;

    revoke all on function public.delivery_fotos(uuid, text, jsonb) from public, anon;
    grant execute on function public.delivery_fotos(uuid, text, jsonb) to authenticated;

    -- ----------------------------------------------------------
    -- 3) Fotos de un pedido ENTREGADO (auditoría)
    -- ----------------------------------------------------------
    create or replace function public.delivery_editar_fotos(
      p_pedido_id uuid, p_tipo text, p_fotos jsonb
    ) returns public.delivery_pedidos
    language plpgsql security definer set search_path = '' as $fn$
    declare
      v_d public.delivery_pedidos;
      f jsonb;
      v_email text;
      v_antes int;
    begin
      if p_tipo not in ('recibo', 'entrega', 'factura') then
        raise exception 'Tipo de foto inválido.' using errcode = '23514';
      end if;
      if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) > 6 then
        raise exception 'Se pueden adjuntar hasta 6 fotos.' using errcode = '23514';
      end if;
      for f in select x from jsonb_array_elements(p_fotos) x loop
        if jsonb_typeof(f) <> 'object'
           or coalesce(f ->> 'path', '') not like p_pedido_id::text || '/' || p_tipo || '-%'
           or position('..' in coalesce(f ->> 'path', '')) > 0 then
          raise exception 'La foto % no corresponde a este pedido.', coalesce(f ->> 'path', '?') using errcode = '23514';
        end if;
      end loop;
      select * into v_d from public.delivery_pedidos where id = p_pedido_id for update;
      if v_d.id is null then
        raise exception 'No se encontró el pedido.' using errcode = '23503';
      end if;
      if v_d.estado <> 'entregado' then
        raise exception 'Solo se pueden editar las fotos de un pedido entregado.' using errcode = 'P0001';
      end if;
      if not (public.is_admin()
              or public.flota_puede(v_d.flota, 'escritura')
              or v_d.repartidor_id = auth.uid()) then
        raise exception 'No tienes permiso para editar las fotos de este pedido.' using errcode = '42501';
      end if;
      select email into v_email from public.usuarios where id = auth.uid();
      v_antes := jsonb_array_length(case p_tipo
                    when 'recibo' then coalesce(v_d.fotos_recibo, '[]')
                    when 'entrega' then coalesce(v_d.fotos_entrega, '[]')
                    else coalesce(v_d.fotos_factura, '[]') end);
      update public.delivery_pedidos set
        fotos_recibo = case when p_tipo = 'recibo' then p_fotos else fotos_recibo end,
        fotos_entrega = case when p_tipo = 'entrega' then p_fotos else fotos_entrega end,
        fotos_factura = case when p_tipo = 'factura' then p_fotos else fotos_factura end,
        historial = historial || jsonb_build_array(jsonb_build_object(
          'at', now(), 'evento', 'fotos_editadas', 'actor', v_email,
          'motivo', (case p_tipo
                       when 'recibo' then 'Fotos al retirar'
                       when 'entrega' then 'Fotos al entregar'
                       else 'Fotos de la factura' end)
                    || ': ' || v_antes || ' → ' || jsonb_array_length(p_fotos))),
        updated_at = now()
      where id = p_pedido_id
      returning * into v_d;
      return v_d;
    end $fn$;

    revoke all on function public.delivery_editar_fotos(uuid, text, jsonb) from public, anon;
    grant execute on function public.delivery_editar_fotos(uuid, text, jsonb) to authenticated;

    -- ----------------------------------------------------------
    -- 4) RPC que el front ya intenta usar para leer la factura
    -- ----------------------------------------------------------
    create or replace function public.delivery_fotos_factura(p_pedido_ids uuid[])
    returns table (pedido_id uuid, fotos_factura jsonb)
    language plpgsql stable security definer set search_path = '' as $fn$
    begin
      if not (public.is_admin() or public.delivery_puede('lectura')) then
        raise exception 'No tienes permiso para ver estas fotos.' using errcode = '42501';
      end if;
      return query
        select d.id, coalesce(d.fotos_factura, '[]'::jsonb)
          from public.delivery_pedidos d
         where d.id = any(p_pedido_ids);
    end $fn$;

    revoke all on function public.delivery_fotos_factura(uuid[]) from public, anon;
    grant execute on function public.delivery_fotos_factura(uuid[]) to authenticated;

    -- ----------------------------------------------------------
    -- 5) Políticas del bucket delivery-fotos
    -- ----------------------------------------------------------
    drop policy if exists "delivery-fotos write" on storage.objects;
    create policy "delivery-fotos write" on storage.objects for insert to authenticated
      with check (
        bucket_id = 'delivery-fotos'
        and (select public.delivery_puede('escritura'))
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(recibo|entrega|factura)-[^/]{1,200}$'
      );

    drop policy if exists "delivery-fotos delete" on storage.objects;
    create policy "delivery-fotos delete" on storage.objects for delete to authenticated
      using (
        bucket_id = 'delivery-fotos'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(recibo|entrega|factura)-[^/]{1,200}$'
        and exists (
          select 1
            from public.delivery_pedidos d
           where d.id = (split_part(name, '/', 1))::uuid
             and d.estado = 'entregado'
             and ((select public.is_admin())
                  or (select public.flota_puede(d.flota, 'escritura'))
                  or d.repartidor_id = (select auth.uid()))
        /* No se exige que 'name' esté todavía en los arrays de fotos:
           el frontend borra el archivo DESPUÉS de que la RPC ya quitó esa ruta
           de fotos_recibo / fotos_entrega / fotos_factura. Exigirlo dejaría
           archivos huérfanos en el bucket. El UUID del prefijo, el estado
           'entregado' y la flota sí se validan arriba. */
        )
      );

  exception when others then
    raise notice '[MGG 20-11 fotos] ERROR: %. Se revierten todos los cambios de este script.', sqlerrm;
    raise;
  end;
end $mgg_fotos_fix$;

-- Verificación (solo lectura)
with estado as (
  select
    exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'delivery_pedidos'
         and column_name = 'fotos_factura'
    ) as columna,
    to_regprocedure('public.delivery_fotos_factura(uuid[])') is not null as rpc,
    exists (
      select 1 from pg_proc p
       where p.oid = to_regprocedure('public.delivery_fotos(uuid,text,jsonb)')
         and pg_get_functiondef(p.oid) like '%pedido en curso%'
    ) as guarda_entregado,
    exists (
      select 1 from pg_policy
       where polrelid = 'storage.objects'::regclass
         and polname = 'delivery-fotos delete'
         and pg_get_expr(polqual, polrelid) like '%factura-%'
    ) as politica_delete
)
select
  case when columna then 'OK' else 'FALTA' end as columna_fotos_factura,
  case when rpc then 'OK' else 'FALTA' end as rpc_fotos_factura,
  case when guarda_entregado then 'OK' else 'FALTA' end as bloqueo_sobrescritura,
  case when politica_delete then 'OK' else 'FALTA' end as politica_delete,
  case when columna and rpc and guarda_entregado and politica_delete
       then 'CORRECTIVO APLICADO' else 'REVISAR' end as veredicto
from estado;
