-- ============================================================
-- MGG · Compras · ¿Se retiene ANTES o DESPUÉS de pagar? (30-10-2026)
-- Solo con el flujo nuevo de compras encendido (config compras.revision_almacen).
--
-- Al indicar el método de pago, Compras marca:
--   · 'antes'   → la OC va primero a RETENCIONES; cuando se hace la retención
--                 pasa a Tesorería para pagar.
--   · 'despues' → la OC va a TESORERÍA; después de pagada, Retenciones retiene.
-- Delivery recibe la OC cuando está pagada Y retenida (o sin momento: flujo viejo).
-- ============================================================

alter table public.ordenes add column if not exists retencion_momento text;
alter table public.ordenes add column if not exists retencion_hecha_en timestamptz;
alter table public.ordenes add column if not exists retencion_hecha_por text;
alter table public.ordenes add column if not exists retencion_nota text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ordenes_retencion_momento_check') then
    alter table public.ordenes add constraint ordenes_retencion_momento_check
      check (retencion_momento is null or retencion_momento in ('antes', 'despues'));
  end if;
end $$;

-- Retenciones marca la retención como hecha (o que no aplica, con nota).
create or replace function public.compras_marcar_retencion(p_orden_id uuid, p_nota text default null)
returns public.ordenes
language plpgsql security definer set search_path = '' as $$
declare v_o public.ordenes; v_email text;
begin
  if not (public.is_admin() or public.puede_modulo('retenciones', 'escritura')) then
    raise exception 'Sin permiso de escritura en Retenciones.' using errcode = '42501';
  end if;
  select * into v_o from public.ordenes where id = p_orden_id for update;
  if v_o.id is null then raise exception 'No se encontró la orden.' using errcode = '23503'; end if;
  if v_o.retencion_momento is null then
    raise exception 'La orden % no espera retención en este flujo.', coalesce(v_o.oc_codigo, v_o.codigo) using errcode = 'P0001';
  end if;
  if v_o.retencion_hecha_en is not null then
    raise exception 'La retención de % ya estaba marcada.', coalesce(v_o.oc_codigo, v_o.codigo) using errcode = 'P0001';
  end if;
  if v_o.retencion_momento = 'despues' and v_o.estado <> 'pagada' then
    raise exception 'La orden % se retiene después de pagar y todavía no está pagada.', coalesce(v_o.oc_codigo, v_o.codigo) using errcode = 'P0001';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  update public.ordenes set
    retencion_hecha_en = now(),
    retencion_hecha_por = v_email,
    retencion_nota = nullif(btrim(coalesce(p_nota, '')), ''),
    historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', now(), 'evento', 'retencion_hecha', 'actor', v_email,
      'detalle', case when v_o.retencion_momento = 'antes' then 'Retenida antes de pagar: pasa a Tesorería' else 'Retenida después de pagar' end))
  where id = p_orden_id returning * into v_o;
  return v_o;
end $$;
revoke all on function public.compras_marcar_retencion(uuid, text) from public, anon;
grant execute on function public.compras_marcar_retencion(uuid, text) to authenticated;

select count(*) as columnas from information_schema.columns
 where table_schema = 'public' and table_name = 'ordenes'
   and column_name in ('retencion_momento', 'retencion_hecha_en', 'retencion_hecha_por', 'retencion_nota');
