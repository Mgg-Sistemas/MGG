begin;
create table if not exists public.compras_reintegros (
 id uuid primary key default gen_random_uuid(),
 orden_id uuid not null references public.ordenes(id),
 detalle jsonb not null,
 monto numeric(18,2) not null check (monto > 0),
 moneda text not null check (moneda in ('USD','Bs','USDT','COP','EUR','BRL')),
 motivo text not null check (length(trim(motivo)) > 0),
 estado text not null default 'pendiente' check (estado in ('pendiente','recibido')),
 created_at timestamptz not null default now(),
 created_by text not null,
 recibido_at timestamptz,
 movimiento_id uuid references public.movimientos_caja(id),
 comprobante_url text,
 referencia text,
 unique(movimiento_id)
);
alter table public.compras_reintegros enable row level security;
drop policy if exists reintegros_lectura on public.compras_reintegros;
create policy reintegros_lectura on public.compras_reintegros for select to authenticated
 using (public.puede_modulo('pedidos','lectura') or public.puede_modulo('tesoreria','lectura') or public.puede_modulo('pedidos') or public.puede_modulo('tesoreria'));
grant select on public.compras_reintegros to authenticated;

create or replace function public.compras_solicitar_reintegro(
 p_orden uuid, p_detalle jsonb, p_monto numeric, p_moneda text, p_motivo text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o record; r record; v_id uuid; v_cantidad numeric; v_previo numeric;
begin
 if not (public.is_admin() or public.puede_modulo('pedidos')) then raise exception 'Sin permiso de Compras'; end if;
 select * into o from public.ordenes where id=p_orden for update;
 if not found then raise exception 'Orden inexistente'; end if;
 if o.estado::text not in ('pagada','por_recibir','recibida','finalizada','reasignada')
    or (o.estado::text='reasignada' and o.pagada_en is null)
 then raise exception 'La orden debe tener un pago registrado'; end if;
 if jsonb_typeof(p_detalle) <> 'array' or jsonb_array_length(p_detalle)=0 then raise exception 'Selecciona los productos no suministrados'; end if;
 if p_monto is null or p_monto::text in ('NaN','Infinity','-Infinity') or p_monto <= 0 or nullif(trim(p_motivo),'') is null then raise exception 'Indica importe y motivo'; end if;
 if (select count(*) from jsonb_array_elements(p_detalle)) <>
    (select count(distinct (x->>'indice')::int) from jsonb_array_elements(p_detalle) x) then raise exception 'Producto repetido'; end if;
 for r in select x from jsonb_array_elements(p_detalle) x loop
  if (r.x->>'indice')::int < 0 or o.items->((r.x->>'indice')::int) is null then raise exception 'Producto inexistente'; end if;
  v_cantidad := (r.x->>'cantidad')::numeric;
  select coalesce(sum((x->>'cantidad')::numeric),0) into v_previo
   from public.compras_reintegros cr cross join lateral jsonb_array_elements(cr.detalle) x
   where cr.orden_id=p_orden and (x->>'indice')::int=(r.x->>'indice')::int;
  if v_cantidad is null or v_cantidad <= 0 or v_cantidad+v_previo > (o.items->((r.x->>'indice')::int)->>'cantidad')::numeric
   then raise exception 'La cantidad supera lo comprado o ya solicitado en reintegro'; end if;
  if o.recibida_en is not null and o.items->((r.x->>'indice')::int)->>'cantidad_recibida' is not null and v_cantidad+v_previo >
     (o.items->((r.x->>'indice')::int)->>'cantidad')::numeric-coalesce((o.items->((r.x->>'indice')::int)->>'cantidad_recibida')::numeric,0)
    then raise exception 'La cantidad supera el faltante registrado por Almacén'; end if;
 end loop;
 insert into public.compras_reintegros(orden_id,detalle,monto,moneda,motivo,created_by)
 values(p_orden,
 (select jsonb_agg(jsonb_build_object('indice',(x->>'indice')::int,'cantidad',(x->>'cantidad')::numeric,
 'sku',o.items->((x->>'indice')::int)->>'sku','nombre',o.items->((x->>'indice')::int)->>'nombre'))
 from jsonb_array_elements(p_detalle) x),
 round(p_monto,2),p_moneda,trim(p_motivo),coalesce(auth.jwt()->>'email','sistema')) returning id into v_id;
 return v_id;
end $$;

create or replace function public.tesoreria_recibir_reintegro(
 p_id uuid, p_caja uuid, p_cuenta text, p_referencia text, p_comprobante text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 r record; c record; s record; v_mov uuid; v_antes numeric; v_despues numeric; v_codigo text;
begin
 if not (public.is_admin() or public.puede_modulo('tesoreria')) then raise exception 'Sin permiso de Tesorería'; end if;
 select * into r from public.compras_reintegros where id=p_id for update;
 if not found then raise exception 'Reintegro inexistente'; end if;
 if r.estado='recibido' then return r.movimiento_id; end if;
 if nullif(trim(p_referencia),'') is null or nullif(trim(p_comprobante),'') is null then raise exception 'Adjunta comprobante e indica referencia'; end if;
 select * into c from public.cajas where id=p_caja and estado::text='activo' for update;
 if not found or c.moneda<>r.moneda then raise exception 'Selecciona una caja activa en la moneda del reintegro'; end if;
 if coalesce(c.externo,false) or c.tipo='centro_acopio' then raise exception 'Selecciona una cuenta de Tesorería'; end if;
 select * into s from public.caja_saldos where caja_id=p_caja and cuenta=p_cuenta and moneda=r.moneda for update;
 if found then
  v_antes:=s.saldo; v_despues:=v_antes+r.monto;
  update public.caja_saldos set saldo=v_despues,updated_at=now() where id=s.id;
 else
  if exists(select 1 from public.caja_saldos where caja_id=p_caja and moneda=r.moneda) or p_cuenta<>'general' then raise exception 'Cuenta inválida'; end if;
  v_antes:=c.saldo; v_despues:=v_antes+r.monto;
 end if;
 update public.cajas set saldo=saldo+r.monto where id=p_caja;
 select coalesce(oc_codigo,codigo) into v_codigo from public.ordenes where id=r.orden_id;
 insert into public.movimientos_caja(caja_id,tipo,monto,moneda,saldo_antes,saldo_despues,cuenta,motivo,categoria,ref_orden_id,actor,nota_entrega)
 values(p_caja,'ingreso',r.monto,r.moneda,v_antes,v_despues,p_cuenta,
 'REINTEGRO DE '||v_codigo||' · '||trim(p_referencia),'reintegro_proveedor',r.orden_id,auth.jwt()->>'email',p_comprobante)
 returning id into v_mov;
 update public.compras_reintegros set estado='recibido',recibido_at=now(),movimiento_id=v_mov,
 referencia=trim(p_referencia),comprobante_url=p_comprobante where id=p_id;
 return v_mov;
end $$;
revoke all on function public.compras_solicitar_reintegro(uuid,jsonb,numeric,text,text) from public;
revoke all on function public.tesoreria_recibir_reintegro(uuid,uuid,text,text,text) from public;
grant execute on function public.compras_solicitar_reintegro(uuid,jsonb,numeric,text,text) to authenticated;
grant execute on function public.tesoreria_recibir_reintegro(uuid,uuid,text,text,text) to authenticated;
alter table public.ordenes add column if not exists reposicion_origen_id uuid references public.ordenes(id);
create unique index if not exists orden_reposicion_unica on public.ordenes(reposicion_origen_id) where reposicion_origen_id is not null;
create or replace function public.compras_recotizar_faltantes(p_orden uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o record; v_id uuid; v_items jsonb; v_codigo text; v_year int; v_num bigint;
begin
 if not (public.is_admin() or public.puede_modulo('pedidos')) then raise exception 'Sin permiso de Compras'; end if;
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
revoke all on function public.compras_recotizar_faltantes(uuid) from public;
grant execute on function public.compras_recotizar_faltantes(uuid) to authenticated;
commit;
