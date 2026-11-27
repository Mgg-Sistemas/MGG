begin;
alter table public.compras_reintegros add column if not exists comprobantes_compras jsonb not null default '[]'::jsonb;
create or replace function public.compras_adjuntar_comprobantes_reintegro(p_id uuid,p_archivos jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; todos jsonb; a jsonb; n_img int; n_pdf int;
begin
 if not (public.is_admin() or public.puede_modulo('pedidos')) then raise exception 'Sin permiso de Compras'; end if;
 select * into r from public.compras_reintegros where id=p_id for update;
 if not found then raise exception 'Reintegro inexistente'; end if;
 if p_archivos is null or jsonb_typeof(p_archivos)<>'array' or jsonb_array_length(p_archivos) not between 1 and 5 then raise exception 'Adjunta hasta cuatro imágenes y un PDF'; end if;
 todos:=r.comprobantes_compras;
 for a in select value from jsonb_array_elements(p_archivos) loop
  if a->>'tipo' is null or a->>'tipo' not in ('imagen','pdf') or nullif(trim(a->>'nombre'),'') is null or a->>'path' is null
   or a->>'path' not like r.orden_id::text||'/reintegros/'||r.id::text||'/%'
  then raise exception 'Comprobante inválido'; end if;
  if not exists(select 1 from storage.objects s where s.bucket_id='compras-oc' and s.name=a->>'path'
    and (s.metadata->>'size')::bigint between 1 and 10485760
    and (case when a->>'tipo'='pdf' then s.metadata->>'mimetype'='application/pdf' else s.metadata->>'mimetype' like 'image/%' end))
  then raise exception 'El comprobante no está cargado o supera 10 MB'; end if;
  if not exists(select 1 from jsonb_array_elements(todos) x where x->>'path'=a->>'path') then
   todos:=todos||jsonb_build_array(jsonb_build_object('path',a->>'path','nombre',a->>'nombre','tipo',a->>'tipo','fecha',now(),'por',auth.jwt()->>'email'));
  end if;
 end loop;
 select count(*) filter(where x->>'tipo'='imagen'),count(*) filter(where x->>'tipo'='pdf') into n_img,n_pdf from jsonb_array_elements(todos) x;
 if n_img>4 or n_pdf>1 then raise exception 'Máximo cuatro imágenes y un PDF por reintegro'; end if;
 update public.compras_reintegros set comprobantes_compras=todos where id=p_id;
end $$;
revoke all on function public.compras_adjuntar_comprobantes_reintegro(uuid,jsonb) from public;
grant execute on function public.compras_adjuntar_comprobantes_reintegro(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
