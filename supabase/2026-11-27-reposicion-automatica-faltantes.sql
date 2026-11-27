begin;
create or replace function public.compras_crear_reposicion_interna(p_orden uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o record; v_id uuid; v_items jsonb; v_codigo text; v_year int; v_num bigint;
begin

 select * into o from public.ordenes where id=p_orden for update;
 if not found or o.recibida_en is null then raise exception 'Primero Almacén debe registrar la recepción'; end if;
 select id into v_id from public.ordenes where reposicion_origen_id=p_orden;
 if found then return v_id; end if;
 select jsonb_agg((x - 'cantidad_recibida' - 'marca_recibida' - 'modelo_recibido' - 'precio_usd' - 'precio_eur' - 'descuento') ||
   jsonb_build_object(
     'cantidad',(x->>'cantidad')::numeric-(x->>'cantidad_recibida')::numeric,
     'cantidad_solicitada_original',(x->>'cantidad')::numeric-(x->>'cantidad_recibida')::numeric,
     'cubierto_almacen',0,'cubierto_por_almacen',null,'comprar',true,'precio',0))
 into v_items from jsonb_array_elements(o.items) x
 where x->>'cantidad_recibida' is not null and (x->>'cantidad')::numeric > (x->>'cantidad_recibida')::numeric;
 if v_items is null then raise exception 'La OC no tiene faltantes'; end if;
 v_year:=extract(year from now() at time zone 'America/Caracas');
 perform pg_advisory_xact_lock(hashtext('reintegros-sp-'||v_year));
 select coalesce(max(substring(codigo from '[0-9]+$')::bigint),0)+1 into v_num
   from public.ordenes where codigo ~ ('^SP-'||v_year||'-[0-9]+$');
 loop
 v_codigo:='SP-'||v_year||'-'||lpad(v_num::text,greatest(4,length(v_num::text)),'0');
 insert into public.ordenes(codigo,clase,proveedor_id,solicitante_email,solicitante,items,total,estado,
 notas,motivo,finalidad,reposicion_origen_id,historial,aprobada_en,aprobada_por)
 values(v_codigo,'producto',null,o.solicitante_email,o.solicitante,v_items,0,'aprobada',
 'Reposición de faltantes de '||coalesce(o.oc_codigo,o.codigo),
 'Material no recibido en '||coalesce(o.oc_codigo,o.codigo),o.finalidad,p_orden,
 jsonb_build_array(jsonb_build_object('evento','aprobada','actor',auth.jwt()->>'email','at',now(),
 'motivo','Faltantes de '||coalesce(o.oc_codigo,o.codigo)||' enviados a cotización')),now(),auth.jwt()->>'email')
 on conflict (codigo) do nothing returning id into v_id;
 exit when v_id is not null;
 v_num:=v_num+1;
 end loop;
 return v_id;
end $$;
revoke all on function public.compras_crear_reposicion_interna(uuid) from public, authenticated;

create or replace function public.compras_recotizar_faltantes(p_orden uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not (public.is_admin() or public.puede_modulo('pedidos')) then
   raise exception 'Sin permiso de Compras';
 end if;
 return public.compras_crear_reposicion_interna(p_orden);
end $$;
revoke all on function public.compras_recotizar_faltantes(uuid) from public;
grant execute on function public.compras_recotizar_faltantes(uuid) to authenticated;

create or replace function public.compras_reposicion_al_recibir()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(new.clase,'producto') = 'producto' and exists (
   select 1 from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) i
   where i->>'cantidad_recibida' is not null
     and (i->>'cantidad_recibida')::numeric < (i->>'cantidad')::numeric
 ) then
   perform public.compras_crear_reposicion_interna(new.id);
 end if;
 return null;
end $$;
revoke all on function public.compras_reposicion_al_recibir() from public, authenticated;
drop trigger if exists trg_compras_reposicion_al_recibir on public.ordenes;
create trigger trg_compras_reposicion_al_recibir
 after update of items, recibida_en on public.ordenes
 for each row when (old.recibida_en is null and new.recibida_en is not null)
 execute function public.compras_reposicion_al_recibir();

commit;