begin;
-- Compatibilidad de las reposiciones automáticas con la validación de SP genéricas.
-- La excepción solo se ejecuta dentro de otro trigger y con una OC ya recibida.
-- Los INSERT directos de un usuario conservan la validación original.
do $migration$
declare
 v_def text;
 v_nueva text;
 v_guard text := $guard$
  -- reposicion_interna_desde_recepcion
  if pg_trigger_depth() > 1
     and new.reposicion_origen_id is not null
     and new.estado::text = 'aprobada'
     and new.proveedor_id is null
     and exists (
       select 1 from public.ordenes origen
        where origen.id = new.reposicion_origen_id and origen.recibida_en is not null
     )
  then
    return new;
  end if;
$guard$;
begin
 select pg_get_functiondef(p.oid) into v_def
   from pg_proc p where p.pronamespace='public'::regnamespace
     and p.proname='ordenes_sp_nombres_genericos' and p.pronargs=0;
 if v_def is null or position('reposicion_interna_desde_recepcion' in v_def)>0 then return; end if;
 v_nueva := regexp_replace(v_def, 'begin[[:space:]]', 'begin' || chr(10) || v_guard, 'i');
 if position('reposicion_interna_desde_recepcion' in v_nueva)=0 then
   raise exception 'No se pudo actualizar la validación de reposiciones';
 end if;
 execute v_nueva;
end $migration$;
commit;