-- ============================================================
-- Maquinaria · vista `maquinaria_lecturas_unificadas` emparejada SIN acentos ni
-- espacios y sin duplicar surtidos (traído de GT el 26-10-2026, commit 4b871872)
--
-- Antes el tramo de Combustible emparejaba por texto EXACTO contra
-- `combustible_equipo`: un surtido cargado como «Hilux  roja» o «HILUX ROJA» no
-- llegaba al horómetro del equipo. Ahora se normaliza (minúsculas, sin acentos,
-- solo letras y números) y cada movimiento cae en UN solo equipo: primero el
-- vínculo explícito `combustible_equipo`, si no, el nombre `equipo`; a igualdad
-- gana el activo y luego el más antiguo.
--
-- MGG ≠ GT: los movimientos de Combustible guardan `fecha` (timestamptz, ya con
-- hora), `horometro_final`, `kilometraje_final` y `actor`; no hay `unaccent`, se
-- quitan los acentos con translate(). Mismas columnas de salida que antes: el
-- RPC `maquinaria_lecturas_vigentes` y la app dependen de ellas.
-- ============================================================
create or replace function public.maquinaria_norm_nombre(x text)
returns text language sql immutable set search_path to 'public' as $$
  select regexp_replace(translate(lower(coalesce(x, '')), 'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc'), '[^a-z0-9]', '', 'g');
$$;

create or replace view public.maquinaria_lecturas_unificadas as
 select l.equipo_id,
    coalesce(nullif(btrim(e.combustible_equipo), ''), btrim(e.equipo)) as equipo_comb,
    'maquinaria'::text as origen,
    l.id::text as referencia,
    l.fecha,
    l.horometro,
    l.kilometraje,
    l.es_correccion,
    coalesce(l.actor_name, l.actor) as actor
   from public.maquinaria_lecturas l
     join public.maquinaria_equipos e on e.id = l.equipo_id
union all
 select eq.equipo_id,
    btrim(m.equipo) as equipo_comb,
    'combustible'::text as origen,
    m.id::text as referencia,
    coalesce(m.fecha, m.created_at) as fecha,
    m.horometro_final as horometro,
    m.kilometraje_final as kilometraje,
    false as es_correccion,
    coalesce(m.actor_name, m.actor) as actor
   from public.combustible_tanque_movimientos m
     cross join lateral (select public.maquinaria_norm_nombre(m.equipo) as norm) n
     left join lateral (
       select e.id as equipo_id
         from public.maquinaria_equipos e
        where n.norm <> ''
          and (public.maquinaria_norm_nombre(e.combustible_equipo) = n.norm
               or public.maquinaria_norm_nombre(e.equipo) = n.norm)
        order by (public.maquinaria_norm_nombre(e.combustible_equipo) = n.norm) desc,
                 e.activo desc, e.created_at asc, e.id asc
        limit 1
     ) eq on true
  where coalesce(btrim(m.equipo), '') <> '' and (m.horometro_final is not null or m.kilometraje_final is not null)
union all
 select b.equipo_id,
    coalesce(nullif(btrim(e.combustible_equipo), ''), btrim(e.equipo)) as equipo_comb,
    'bitacora'::text as origen,
    b.id::text as referencia,
    ((b.fecha::timestamp + (b.created_at at time zone 'America/Caracas')::time) at time zone 'America/Caracas') as fecha,
    b.horometro,
    b.kilometraje,
    false as es_correccion,
    coalesce(b.actor_name, b.created_by) as actor
   from public.maquinaria_mantenimientos b
     join public.maquinaria_equipos e on e.id = b.equipo_id
  where b.horometro is not null or b.kilometraje is not null;

select origen, count(*) n, count(equipo_id) con_equipo from public.maquinaria_lecturas_unificadas group by origen;
