-- Delivery · activación (02-11-2026, orden de la administradora «se activa TODO»).
-- 1) La retención ya no frena nada (01-11): las OC pagadas llegan a Delivery sin
--    esperar que Retenciones las marque. Se edita la definición VIVA de las dos RPC.
-- 2) config compras.delivery → activo.
do $$
declare v_def text; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_pedidos_listado';
  v_n := (length(v_def) - length(replace(v_def, ' and (o.retencion_momento is null or o.retencion_hecha_en is not null)', ''))) / length(' and (o.retencion_momento is null or o.retencion_hecha_en is not null)');
  if v_n <> 1 then raise exception 'delivery_pedidos_listado: se esperaba 1 condición de retención, hay %', v_n; end if;
  execute replace(v_def, ' and (o.retencion_momento is null or o.retencion_hecha_en is not null)', '');

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delivery_tomar';
  v_n := (length(v_def) - length(replace(v_def, ' or not (v_o.retencion_momento is null or v_o.retencion_hecha_en is not null)', ''))) / length(' or not (v_o.retencion_momento is null or v_o.retencion_hecha_en is not null)');
  if v_n <> 1 then raise exception 'delivery_tomar: se esperaba 1 condición de retención, hay %', v_n; end if;
  execute replace(v_def, ' or not (v_o.retencion_momento is null or v_o.retencion_hecha_en is not null)', '');

  update public.config set value = '{"activo": true, "desde": "2026-11-02T13:10:00Z"}'::jsonb, updated_by = 'administradora', updated_at = now()
   where key = 'compras.delivery';
  if not found then raise exception 'No existe config compras.delivery'; end if;
end $$;

select p.proname,
       (pg_get_functiondef(p.oid) like '%retencion_hecha_en%') as aun_mira_retencion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('delivery_pedidos_listado', 'delivery_tomar')
union all
select 'config:' || key, (value->>'activo')::boolean from public.config where key = 'compras.delivery';

-- Rollback (solo si la administradora lo ordena): apagar el interruptor.
-- update public.config set value = '{"activo": false}'::jsonb where key = 'compras.delivery';
