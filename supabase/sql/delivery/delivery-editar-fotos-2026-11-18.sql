-- ============================================================
-- Módulo: delivery
-- Archivo: delivery-editar-fotos-2026-11-18.sql
-- Estado: PENDIENTE DE APLICAR EN SUPABASE SQL EDITOR
-- ------------------------------------------------------------
-- MGG · Delivery · editar fotos de un pedido ENTREGADO (18/11/2026)
--
-- delivery_fotos solo deja tocar las fotos al motorizado que tomó el pedido
-- (o a quien tenga «full»). Una vez entregado, se permite corregirlas a:
--   · admin, · quien tenga escritura en 'delivery', · el motorizado que lo entregó.
-- Queda en el historial del pedido (evento 'fotos_editadas').
--
-- Los archivos que se quitan se borran DESDE LA APP (Supabase bloquea DELETE
-- en storage.objects desde SQL/triggers): por eso se agrega la política DELETE
-- del bucket delivery-fotos con el mismo gate.
-- ============================================================

create or replace function public.delivery_editar_fotos(p_pedido_id uuid, p_tipo text, p_fotos jsonb)
returns public.delivery_pedidos
language plpgsql
security definer
set search_path to ''
as $function$
declare v_d public.delivery_pedidos; f jsonb; v_email text; v_antes int;
begin
  if p_tipo not in ('recibo', 'entrega', 'factura') then raise exception 'Tipo de foto inválido.' using errcode = '23514'; end if;
  if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) > 6 then
    raise exception 'Se pueden adjuntar hasta 6 fotos.' using errcode = '23514';
  end if;
  for f in select x from jsonb_array_elements(p_fotos) x loop
    if jsonb_typeof(f) <> 'object' or coalesce(f ->> 'path', '') not like p_pedido_id::text || '/' || p_tipo || '-%'
       or position('..' in coalesce(f ->> 'path', '')) > 0 then
      raise exception 'La foto % no corresponde a este pedido.', coalesce(f ->> 'path', '?') using errcode = '23514';
    end if;
  end loop;
  select * into v_d from public.delivery_pedidos where id = p_pedido_id for update;
  if v_d.id is null then raise exception 'No se encontró el pedido.' using errcode = '23503'; end if;
  if v_d.estado <> 'entregado' then
    raise exception 'Solo se pueden editar las fotos de un pedido entregado.' using errcode = 'P0001';
  end if;
  if not (public.is_admin() or public.delivery_puede('escritura') or v_d.repartidor_id = auth.uid()) then
    raise exception 'No tienes permiso para editar las fotos de este pedido.' using errcode = '42501';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  v_antes := jsonb_array_length(case p_tipo when 'recibo' then coalesce(v_d.fotos_recibo, '[]')
                                            when 'entrega' then coalesce(v_d.fotos_entrega, '[]')
                                            else coalesce(v_d.fotos_factura, '[]') end);
  update public.delivery_pedidos set
    fotos_recibo = case when p_tipo = 'recibo' then p_fotos else fotos_recibo end,
    fotos_entrega = case when p_tipo = 'entrega' then p_fotos else fotos_entrega end,
    fotos_factura = case when p_tipo = 'factura' then p_fotos else fotos_factura end,
    historial = historial || jsonb_build_array(jsonb_build_object('at', now(), 'evento', 'fotos_editadas', 'actor', v_email,
      'motivo', (case p_tipo when 'recibo' then 'Fotos al retirar' when 'entrega' then 'Fotos al entregar' else 'Fotos de la factura' end)
                || ': ' || v_antes || ' → ' || jsonb_array_length(p_fotos))),
    updated_at = now()
  where id = p_pedido_id returning * into v_d;
  return v_d;
end $function$;

revoke all on function public.delivery_editar_fotos(uuid, text, jsonb) from public, anon;
grant execute on function public.delivery_editar_fotos(uuid, text, jsonb) to authenticated;

-- Borrar archivos del bucket desde la app (solo pedidos entregados).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'delivery-fotos delete') then
    create policy "delivery-fotos delete" on storage.objects for delete to authenticated
    using (
      bucket_id = 'delivery-fotos'
      and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(recibo|entrega|factura)-[^/]{1,200}$'
      and exists (
        select 1 from public.delivery_pedidos d
         where d.id = split_part(name, '/', 1)::uuid
           and d.estado = 'entregado'
           and ((select public.is_admin()) or (select public.delivery_puede('escritura')) or d.repartidor_id = (select auth.uid()))
      )
    );
  end if;
end $$;
