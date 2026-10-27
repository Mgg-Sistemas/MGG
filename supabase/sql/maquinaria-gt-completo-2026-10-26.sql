-- ============================================================
-- Control de Maquinaria · se trae COMPLETO de Golden Touch (26-10-2026)
-- Pedido de la administradora: «toda la funcionalidad y el frontend de GT,
-- sin traerte los equipos». Los equipos, documentos y fotos de MGG se quedan;
-- la base se acomoda a la forma que espera el código de GT.
-- Permisos: en MGG se sigue con is_operativo() (GT usa puede('maquinaria')).
-- ============================================================

-- 1) Documentos del equipo: columnas con los nombres de GT, 20 espacios y encuadre.
alter table public.maquinaria_documentos rename column slot to espacio;
alter table public.maquinaria_documentos rename column filename to archivo;
alter table public.maquinaria_documentos rename column mime to content_type;
alter table public.maquinaria_documentos rename column size_bytes to tamano;
alter table public.maquinaria_documentos rename column created_by to subido_por;
alter table public.maquinaria_documentos add column if not exists subido_por_nombre text;
alter table public.maquinaria_documentos add column if not exists encuadre jsonb;
alter table public.maquinaria_documentos drop column if exists updated_by;
alter table public.maquinaria_documentos drop constraint if exists maquinaria_documentos_slot_check;
alter table public.maquinaria_documentos add constraint maquinaria_documentos_espacio_check check (espacio >= 1 and espacio <= 20);
alter table public.maquinaria_documentos drop constraint if exists maquinaria_documentos_equipo_slot_key;
alter table public.maquinaria_documentos add constraint maquinaria_documentos_equipo_espacio_key unique (equipo_id, espacio);
alter table public.maquinaria_documentos add constraint maquinaria_documentos_encuadre_check check (
  encuadre is null or (jsonb_typeof(encuadre) = 'object'
    and (encuadre->>'zoom')::numeric between 1 and 4
    and (encuadre->>'x')::numeric between 0 and 1
    and (encuadre->>'y')::numeric between 0 and 1));
drop trigger if exists trg_maquinaria_documentos_updated_at on public.maquinaria_documentos;
create trigger trg_maquinaria_documentos_updated_at before update on public.maquinaria_documentos for each row execute function set_updated_at();

-- 2) Las fotos del equipo (tabla propia de MGG) pasan a ser documentos «FOTO DEL EQUIPO»,
--    como en GT (la portada es la que se llama así). Mismo archivo en el bucket equipos-docs.
insert into public.maquinaria_documentos (equipo_id, espacio, nombre, path, archivo, content_type, tamano, subido_por, subido_por_nombre, created_at, encuadre)
select f.equipo_id,
       (select coalesce(max(d.espacio),0) from public.maquinaria_documentos d where d.equipo_id = f.equipo_id)
         + row_number() over (partition by f.equipo_id order by f.orden, f.created_at),
       case when row_number() over (partition by f.equipo_id order by f.orden, f.created_at) = 1 then 'FOTO DEL EQUIPO'
            else 'FOTO DEL EQUIPO ' || row_number() over (partition by f.equipo_id order by f.orden, f.created_at) end,
       f.path, f.filename, f.mime, f.size_bytes, f.created_by, null, f.created_at, null
from public.maquinaria_fotos f;
drop table public.maquinaria_fotos;

-- 3) Ficha de repuestos: forma de GT (equivalencias como lista, cada_hrs, en_servicio, created_by/updated_by).
alter table public.maquinaria_repuestos_equipo rename column cada_horas to cada_hrs;
alter table public.maquinaria_repuestos_equipo rename column actor to created_by;
alter table public.maquinaria_repuestos_equipo drop column if exists actor_name;
alter table public.maquinaria_repuestos_equipo add column if not exists updated_by text;
alter table public.maquinaria_repuestos_equipo add column if not exists en_servicio boolean not null default true;
alter table public.maquinaria_repuestos_equipo alter column equivalencias type text[]
  using case when equivalencias is null or btrim(equivalencias) = '' then '{}'::text[]
             else regexp_split_to_array(equivalencias, '\s*[,;]\s*') end;
alter table public.maquinaria_repuestos_equipo alter column equivalencias set default '{}'::text[];
alter table public.maquinaria_repuestos_equipo alter column equivalencias set not null;
alter table public.maquinaria_repuestos_equipo drop constraint if exists maquinaria_repuestos_equipo_cada_horas_check;
alter table public.maquinaria_repuestos_equipo add constraint maquinaria_repuestos_equipo_cada_hrs_check check (cada_hrs is null or cada_hrs > 0);
alter table public.maquinaria_repuestos_equipo drop constraint if exists maquinaria_repuestos_equipo_sistema_check;
alter table public.maquinaria_repuestos_equipo add constraint maquinaria_repuestos_equipo_sistema_check check (sistema = any (array['motor','hidraulico','transmision','refrigeracion','combustible','aire','cabina','cauchos','electrico','frenos','rodaje','otros']));
alter table public.maquinaria_repuestos_equipo drop constraint if exists maquinaria_repuestos_equipo_tipo_check;
alter table public.maquinaria_repuestos_equipo add constraint maquinaria_repuestos_equipo_tipo_check check (length(btrim(tipo)) > 0);
drop trigger if exists trg_maquinaria_rep_updated_at on public.maquinaria_repuestos_equipo;
drop trigger if exists trg_maquinaria_repuestos_equipo_updated_at on public.maquinaria_repuestos_equipo;
create trigger trg_maquinaria_repuestos_equipo_updated_at before update on public.maquinaria_repuestos_equipo for each row execute function set_updated_at();

-- 4) Bucket: mismo tope que GT (50 MB).
update storage.buckets set file_size_limit = 52428800 where id = 'equipos-docs';

-- 5) Funciones que el código de GT usa y MGG no tenía.
create or replace function public.maquinaria_momento(p_fecha date, p_hora text, p_created timestamptz)
returns timestamptz language plpgsql stable set search_path to 'public' as $$
begin
  if p_fecha is null then return p_created; end if;
  if coalesce(btrim(p_hora), '') <> '' then
    begin
      return (p_fecha::text || ' ' || to_char(to_timestamp(btrim(p_hora), 'HH12:MI:SS AM'), 'HH24:MI:SS'))::timestamp at time zone 'America/Caracas';
    exception when others then null;
    end;
  end if;
  return (p_fecha::timestamp + (coalesce(p_created, now()) at time zone 'America/Caracas')::time) at time zone 'America/Caracas';
end $$;

create or replace function public.maquinaria_finalidad_os(p_id uuid)
returns text language plpgsql stable set search_path to 'public' as $$
declare
  o record; e record; v_que text; v_id text; v_tr text[]; n int;
begin
  select * into o from public.maquinaria_ordenes_servicio where id = p_id;
  if not found then return null; end if;
  select equipo, placa, serial into e from public.maquinaria_equipos where id = o.equipo_id;
  select array_agg(btrim(t)) into v_tr from unnest(coalesce(o.trabajos, '{}'::text[])) t where btrim(t) <> '';
  n := coalesce(array_length(v_tr, 1), 0);
  if n = 1 then v_que := v_tr[1];
  elsif n > 1 then v_que := array_to_string(v_tr[1:n-1], ', ') || ' y ' || v_tr[n];
  else
    v_que := case o.tipo
      when 'preventivo' then 'Mantenimiento preventivo' when 'reparacion' then 'Reparación'
      when 'cambio_pieza' then 'Cambio de piezas' when 'cauchos' then 'Cauchos / neumáticos'
      when 'aceite' then 'Cambio de aceite y filtros' when 'frenos' then 'Frenos'
      when 'electrico' then 'Sistema eléctrico' when 'hidraulico' then 'Sistema hidráulico'
      when 'soldadura' then 'Soldadura' when 'pintura' then 'Pintura / latonería'
      when 'inspeccion' then 'Inspección'
      else coalesce(nullif(btrim(o.descripcion), ''), 'Servicio') end;
  end if;
  if coalesce(upper(regexp_replace(btrim(e.placa), '[\s./-]', '', 'g')), '') not in ('', 'SN', 'NA', 'NO', 'SINPLACA', '0') then
    v_id := ' (PLACA ' || btrim(e.placa) || ')';
  elsif coalesce(upper(regexp_replace(btrim(e.serial), '[\s./-]', '', 'g')), '') not in ('', 'SN', 'NA', 'NO', '0') then
    v_id := ' (SERIAL ' || btrim(e.serial) || ')';
  else v_id := '';
  end if;
  return upper(v_que || ' para ' || coalesce(e.equipo, 'equipo') || v_id);
end $$;

-- Directorio de personas (correo → nombre y apellido) legible por cualquier sesión activa:
-- lo usa «quién hizo qué» en las pantallas de GT. Solo nombre, apellido y rol: nada sensible.
create or replace function public.obtener_directorio_personas()
returns table(id uuid, email text, nombre text, apellido text, role text)
language sql stable security definer set search_path to 'public' as $$
  select id, email, nombre, apellido, role::text from public.usuarios
  where email is not null and public.is_operativo();
$$;
revoke all on function public.obtener_directorio_personas() from anon;

select 'docs' k, count(*)::text v from public.maquinaria_documentos
union all select 'docs FOTO', count(*)::text from public.maquinaria_documentos where nombre like 'FOTO DEL EQUIPO%'
union all select 'rep cols', string_agg(column_name, ',') from information_schema.columns where table_name='maquinaria_repuestos_equipo'
union all select 'doc cols', string_agg(column_name, ',') from information_schema.columns where table_name='maquinaria_documentos';

-- 6) Realtime: el expediente de GT escucha también los servicios directos del equipo.
do $$
begin
  if to_regclass('public.servicios_directos') is not null
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='servicios_directos') then
    alter publication supabase_realtime add table public.servicios_directos;
  end if;
end $$;

-- 7) Catálogo: GT guarda también los «encargados responsables» de los equipos.
alter table public.maquinaria_catalogos drop constraint if exists maquinaria_catalogos_tipo_check;
alter table public.maquinaria_catalogos add constraint maquinaria_catalogos_tipo_check
  check (tipo in ('tipo_maquinaria','propietario','status','documento','grupo_mantenimiento','encargado_responsable'));
