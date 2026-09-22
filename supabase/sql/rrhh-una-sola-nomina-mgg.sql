-- ════════════════════════════════════════════════════════════════
-- RRHH · Vuelve a haber UNA sola nómina: MGG
--
-- Se quitó el interruptor MGG / GoMetal. La columna `empresa` NO se borra:
-- cada ficha la lleva, los anticipos / vacaciones / renglones la heredan por
-- trigger desde la ficha de la persona, y el correlativo de nómina la recibe
-- como parámetro. Lo que cambia es el universo de valores admitidos: antes
-- eran dos, ahora es uno.
--
-- Por qué en la base y no solo en el front: el front ya no sabe escribir
-- 'GOMETAL', pero "nadie lo escribe" no es lo mismo que "no se puede
-- escribir". Un import, un parche a mano o una pantalla futura sí podrían.
-- La regla vive donde está el dato.
--
-- PARA VOLVER ATRÁS (si algún día vuelve una segunda nómina) basta con
-- devolverle a cada CHECK el array de dos:
--   alter table public.personal drop constraint personal_empresa_check;
--   alter table public.personal add constraint personal_empresa_check
--     check (empresa in ('MGG','GOMETAL'));
-- ...y lo mismo en las otras cuatro tablas.
-- ════════════════════════════════════════════════════════════════

-- 1) Por las dudas: si quedó alguna fila del otro lado, pasa a MGG.
--    Hoy son 0 en las cinco tablas, pero el guion tiene que poder correrse
--    dos veces y en cualquier ambiente sin fallar por el CHECK del paso 2.
update public.personal            set empresa = 'MGG' where empresa is distinct from 'MGG';
update public.nomina_periodos     set empresa = 'MGG' where empresa is distinct from 'MGG';
update public.nomina_renglones    set empresa = 'MGG' where empresa is distinct from 'MGG';
update public.anticipos_prestamos set empresa = 'MGG' where empresa is distinct from 'MGG';
update public.rrhh_eventos        set empresa = 'MGG' where empresa is distinct from 'MGG';

-- 2) El CHECK deja de admitir dos valores y admite uno.
do $$
declare
  t text;
begin
  foreach t in array array['personal','nomina_periodos','nomina_renglones','anticipos_prestamos','rrhh_eventos']
  loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_empresa_check');
    execute format('alter table public.%I add constraint %I check (empresa = ''MGG'')', t, t || '_empresa_check');
  end loop;
end $$;

-- 3) El correlativo de nómina ya no tiene un prefijo que elegir.
--    Antes GoMetal numeraba aparte con 'GM-'. Queda el parámetro p_empresa
--    porque el front ya lo manda y porque, si vuelve una segunda nómina, es
--    acá donde se vuelve a ramificar; pero hoy cualquier valor que no sea MGG
--    es un error, no un prefijo distinto.
create or replace function public.siguiente_codigo_nomina(p_empresa text)
returns text language plpgsql security definer set search_path = public
as $$
declare
  v_empresa text := upper(coalesce(nullif(btrim(p_empresa), ''), 'MGG'));
  v_anio    int := extract(year from current_date);
  v_n       int;
begin
  if v_empresa <> 'MGG' then
    raise exception 'Empresa desconocida: %. Hoy la unica nomina es MGG.', p_empresa;
  end if;
  -- Candado sobre la tabla: dos personas cargando a la vez no pueden sacar
  -- el mismo número.
  lock table public.nomina_periodos in share row exclusive mode;
  select count(*) + 1 into v_n
    from public.nomina_periodos
   where empresa = v_empresa
     and codigo like 'NOM-' || v_anio || '-%';
  return 'NOM-' || v_anio || '-' || lpad(v_n::text, 4, '0');
end $$;

revoke all on function public.siguiente_codigo_nomina(text) from public, anon;
grant execute on function public.siguiente_codigo_nomina(text) to authenticated;

-- 4) El trigger que impedía mezclar las dos nóminas se queda: sigue siendo
--    cierto que un período no puede mezclar empresas. Solo cambia el mensaje,
--    que nombraba a GoMetal.
create or replace function public.nomina_periodo_una_sola_empresa()
returns trigger language plpgsql as $$
declare v_empresas int;
begin
  select count(distinct empresa) into v_empresas
    from public.nomina_renglones where periodo_id = new.periodo_id;
  if v_empresas > 1 then
    raise exception 'Una nomina no puede mezclar personal de dos empresas distintas.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- 5) Verificación: las cinco tienen que quedar admitiendo solo MGG.
select rel.relname as tabla, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and con.contype = 'c'
  and con.conname like '%_empresa_check'
order by 1;
