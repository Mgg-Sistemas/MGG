begin;
alter table public.ordenes add column if not exists items_no_cotizados jsonb not null default '[]'::jsonb;
alter table public.ordenes add column if not exists cotizacion_pendiente_origen_id uuid references public.ordenes(id);
alter table public.ordenes add column if not exists cotizacion_pendiente_clave text;
create unique index if not exists cotizacion_pendiente_clave_unica
 on public.ordenes(cotizacion_pendiente_clave) where cotizacion_pendiente_clave is not null;

create or replace function public.compras_crear_pendiente_cotizacion(p_orden uuid,p_items jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o record; v_items jsonb; v_clave text; v_id uuid; v_year int; v_num bigint; v_codigo text;
begin
 select * into o from public.ordenes where id=p_orden for update;
 if not found then raise exception 'No existe la OC de origen'; end if;
 select jsonb_agg((i-'cantidad_recibida'-'marca_recibida'-'modelo_recibido'-'precio_usd'-'precio_eur'-'descuento') ||
  jsonb_build_object('precio',0,'comprar',true,'cantidad_solicitada_original',(i->>'cantidad')::numeric,
    'cubierto_almacen',0,'cubierto_por_almacen',null)) into v_items
 from jsonb_array_elements(p_items) i where (i->>'cantidad')::numeric>0;
 if v_items is null then return null; end if;
 v_clave:=p_orden::text||':'||md5(v_items::text);
 select id into v_id from public.ordenes where cotizacion_pendiente_clave=v_clave;
 if found then return v_id; end if;
 v_year:=extract(year from now() at time zone 'America/Caracas');
  perform pg_advisory_xact_lock(hashtext('reintegros-sp-'||v_year));
 select coalesce(max(substring(codigo from '[0-9]+$')::bigint),0)+1 into v_num
 from public.ordenes where codigo ~ ('^SP-'||v_year||'-[0-9]+$');
 loop
  v_codigo:='SP-'||v_year||'-'||lpad(v_num::text,greatest(4,length(v_num::text)),'0');
  insert into public.ordenes(codigo,clase,proveedor_id,solicitante_email,solicitante,items,total,estado,
    notas,motivo,finalidad,cotizacion_pendiente_origen_id,cotizacion_pendiente_clave,historial,aprobada_en,aprobada_por)
  values(v_codigo,'producto',null,o.solicitante_email,o.solicitante,v_items,0,'aprobada',
    'Productos pendientes de cotizar de '||coalesce(o.oc_codigo,o.codigo),
    'Renglones sin precio, excluidos de la OC '||coalesce(o.oc_codigo,o.codigo),o.finalidad,p_orden,v_clave,
    jsonb_build_array(jsonb_build_object('at',now(),'evento','aprobada','actor',auth.jwt()->>'email',
      'motivo','Pendientes de cotizar de '||coalesce(o.oc_codigo,o.codigo))),now(),auth.jwt()->>'email')
  on conflict(codigo) do nothing returning id into v_id;
  if v_id is not null then return v_id; end if;
  v_num:=v_num+1;
 end loop;
end $$;
revoke all on function public.compras_crear_pendiente_cotizacion(uuid,jsonb) from public,authenticated;

create or replace function public.compras_excluir_no_cotizados()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare i jsonb; precio numeric; cotizados jsonb:='[]'::jsonb; pendientes jsonb:='[]'::jsonb; previos jsonb;
begin
 if coalesce(new.clase,'producto')<>'producto' or nullif(new.oc_codigo,'') is null
 or new.estado::text not in ('oc_creada','confirmada_metodo','oc_aprobada','pagada','por_recibir','cuenta_abierta','recibida','finalizada')
 then return new; end if;
 previos:=case when tg_op='UPDATE' then coalesce(old.items_no_cotizados,'[]'::jsonb) else '[]'::jsonb end;
 for i in select x from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) x loop
  if coalesce(i->>'comprar','true')='false' or coalesce((i->>'cantidad')::numeric,0)<=0 then continue; end if;
  precio:=case when coalesce(new.pago_en_divisa,false) and nullif(i->>'precio_usd','') is not null
    then (i->>'precio_usd')::numeric else coalesce((i->>'precio')::numeric,0) end;
  if precio>0 then
   cotizados:=cotizados||jsonb_build_array(i);
  else
   i:=i-'cantidad_recibida'-'marca_recibida'-'modelo_recibido';
   if not previos @> jsonb_build_array(i) then pendientes:=pendientes||jsonb_build_array(i); end if;
  end if;
 end loop;
 if jsonb_array_length(cotizados)=0 then
  raise exception 'La OC debe contener al menos un producto cotizado con precio mayor que cero. Los renglones sin precio quedan pendientes de cotizar.' using errcode='23514';
 end if;
 new.items:=cotizados;
 new.items_no_cotizados:=previos||pendientes;
 return new;
end $$;
revoke all on function public.compras_excluir_no_cotizados() from public,authenticated;
drop trigger if exists trg_compras_excluir_no_cotizados on public.ordenes;
create trigger trg_compras_excluir_no_cotizados
 before insert or update of items,estado,oc_codigo,pago_en_divisa on public.ordenes
 for each row execute function public.compras_excluir_no_cotizados();

create or replace function public.compras_encolar_no_cotizados()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare previos jsonb; nuevos jsonb;
begin
 previos:=case when tg_op='UPDATE' then coalesce(old.items_no_cotizados,'[]'::jsonb) else '[]'::jsonb end;
 select jsonb_agg(i) into nuevos from jsonb_array_elements(new.items_no_cotizados) i
 where not previos @> jsonb_build_array(i);
 if new.parent_orden_id is not null and nuevos is not null then
  -- Si la SP madre sigue abierta, esos productos ya quedan pendientes allí.
  select jsonb_agg(i) into nuevos from jsonb_array_elements(nuevos) i
  where not exists(
   select 1 from public.ordenes p cross join lateral jsonb_array_elements(p.items) j
   where p.id=new.parent_orden_id and p.estado::text='aprobada' and p.oc_codigo is null
     and j->>'sku'=i->>'sku' and coalesce(j->>'comprar','true')<>'false'
     and (j->>'cantidad')::numeric>=(i->>'cantidad')::numeric
  );
 end if;
 if nuevos is not null then perform public.compras_crear_pendiente_cotizacion(new.id,nuevos); end if;
 return null;
end $$;
revoke all on function public.compras_encolar_no_cotizados() from public,authenticated;
drop trigger if exists trg_compras_encolar_no_cotizados on public.ordenes;
create trigger trg_compras_encolar_no_cotizados after insert or update on public.ordenes
 for each row execute function public.compras_encolar_no_cotizados();

-- La solicitud interna ya pasó la revisión de Almacén en la OC de origen.
-- El INSERT directo de un usuario conserva la validación de nombres genéricos.
do $migration$
declare d text; nueva text; guardia text:=$guard$
  -- pendiente_cotizacion_interno
  if pg_trigger_depth()>1 and new.cotizacion_pendiente_origen_id is not null
    and new.estado::text='aprobada' and new.proveedor_id is null
    and exists(select 1 from public.ordenes p where p.id=new.cotizacion_pendiente_origen_id and p.oc_codigo is not null)
  then return new; end if;
$guard$;
begin
 select pg_get_functiondef(oid) into d from pg_proc
 where pronamespace='public'::regnamespace and proname='ordenes_sp_nombres_genericos' and pronargs=0;
 if d is null or position('pendiente_cotizacion_interno' in d)>0 then return; end if;
 nueva:=regexp_replace(d,'begin[[:space:]]','begin'||chr(10)||guardia,'i');
 if position('pendiente_cotizacion_interno' in nueva)=0 then raise exception 'No se pudo actualizar la validación de solicitudes'; end if;
 execute nueva;
end $migration$;

create or replace function public.compras_pendientes_cotizar()
returns table(id uuid,codigo text,items jsonb,notas text,cotizacion_pendiente_origen_id uuid,created_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select o.id,o.codigo,p.items,o.notas,o.cotizacion_pendiente_origen_id,o.created_at
 from public.ordenes o
 cross join lateral(
  select jsonb_agg(i||jsonb_build_object('cantidad',(i->>'cantidad')::numeric-c.cantidad)) as items
  from jsonb_array_elements(o.items) i
  cross join lateral(
   select coalesce(sum((j->>'cantidad')::numeric),0) cantidad from public.ordenes h
   cross join lateral jsonb_array_elements(h.items) j
   where h.parent_orden_id=o.id and h.estado::text not in ('cancelada','anulada','rechazada','reasignada')
     and j->>'sku'=i->>'sku' and coalesce(j->>'comprar','true')<>'false'
     and (case when coalesce(h.pago_en_divisa,false) and nullif(j->>'precio_usd','') is not null
       then (j->>'precio_usd')::numeric else coalesce((j->>'precio')::numeric,0) end)>0
  ) c
  where coalesce(i->>'comprar','true')<>'false' and (i->>'cantidad')::numeric>c.cantidad
 ) p
 where o.estado::text='aprobada' and o.oc_codigo is null and coalesce(o.clase,'producto')='producto'
 and p.items is not null
 order by o.created_at desc,o.id;
$$;
revoke all on function public.compras_pendientes_cotizar() from public;
grant execute on function public.compras_pendientes_cotizar() to authenticated;
notify pgrst,'reload schema';
commit;