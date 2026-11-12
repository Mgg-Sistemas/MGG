-- ============================================================
-- MGG · Los Pinos · Casiterita — FASE 4: Cierre mensual y conteo físico  (12-11-2026)
-- Requiere las fases 1 y 3.
--
-- · casiterita_saldo_al(fecha): el mismo cálculo del libro que hace la app
--   (src/modules/inventario/casiteritaPmp.ts · calcularLibro), en la base, para
--   que el cierre no dependa de lo que mande la pantalla.
-- · casiterita_cierres_pmp: foto fija de cada mes cerrado (saldo global, inventario
--   MGG, costo, PMP, resguardo). Un mes cerrado ya no admite movimientos (ni
--   cargar ni borrar con fecha de ese mes o anterior). Se cierra en orden; reabrir
--   el último mes cerrado solo lo hace un administrador.
-- · casiterita_conteos: conteo físico del galpón contra el libro; si hay
--   diferencia se puede registrar el ajuste en el libro en el mismo paso.
-- Los cierres de agosto–octubre 2026 se cargan con la semilla privada de docs/.
-- Idempotente.
-- ============================================================

create or replace function public.casiterita_saldo_al(p_fecha date)
returns table (kg_global numeric, kg_mgg numeric, costo numeric, pmp numeric, movimientos int)
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  g numeric := 0; m numeric := 0; c numeric := 0;
  pm numeric; pct numeric; dm numeric; n int := 0;
begin
  for r in select * from public.casiterita_libro where fecha <= p_fecha order by fecha, orden loop
    pm := case when m > 0 then c / m else 0 end;
    n := n + 1;
    if r.tipo in ('apertura', 'entrada') then
      g := g + r.kg_global; m := m + r.kg_mgg; c := c + r.costo;
    elsif r.tipo = 'recuperacion' then
      g := g + r.kg; m := m + r.kg;
    elsif r.tipo = 'exportacion' then
      pct := case when g > 0 then r.kg / g else 0 end;
      dm := -(m * pct);
      g := g - r.kg; m := m + dm; c := c + dm * pm;
    else -- muestra · merma · ajuste · fundición
      dm := case when r.afecta_mgg then -r.kg else 0 end;
      g := g - r.kg; m := m + dm; c := c + dm * pm;
    end if;
  end loop;
  return query select g, m, c, case when m > 0 then c / m else 0::numeric end, n;
end $$;

create table if not exists public.casiterita_cierres_pmp (
  mes          text primary key check (mes ~ '^\d{4}-\d{2}$'),
  kg_global    numeric(16,3) not null,
  kg_mgg       numeric(18,6) not null,
  costo        numeric(18,4) not null,
  pmp          numeric(14,6) not null,
  resguardo    numeric(16,3) not null,
  movimientos  int not null default 0,
  cerrado_por_name text,
  cerrado_en   timestamptz not null default now()
);

create table if not exists public.casiterita_conteos (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  renglones   jsonb not null default '[]'::jsonb,
  kg_fisico   numeric(16,3) not null,
  kg_libro    numeric(16,3) not null,
  diferencia  numeric(16,3) not null,
  ajuste_id   uuid references public.casiterita_libro(id) on delete set null,
  nota        text,
  actor       uuid default auth.uid(),
  actor_name  text,
  created_at  timestamptz not null default now()
);
create index if not exists casiterita_conteos_fecha_idx on public.casiterita_conteos (fecha desc);

-- ── Un mes cerrado no admite movimientos (ni de antes) ──
create or replace function public.casiterita_libro_mes_cerrado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ult text;
  v_fecha date := case when tg_op = 'DELETE' then old.fecha else new.fecha end;
begin
  -- Lee el último cierre con bloqueo compartido: si un cierre está en curso, espera a que termine.
  select max(mes) into v_ult from (select mes from public.casiterita_cierres_pmp for share) c;
  if v_ult is not null and to_char(v_fecha, 'YYYY-MM') <= v_ult then
    raise exception 'El libro está cerrado hasta % (%): no se cargan ni se borran movimientos de esa fecha.',
      v_ult, to_char(v_fecha, 'DD-MM-YYYY');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists casiterita_libro_mes_cerrado on public.casiterita_libro;
create trigger casiterita_libro_mes_cerrado before insert or delete on public.casiterita_libro
  for each row execute function public.casiterita_libro_mes_cerrado();

-- ── Cerrar un mes (en orden; nunca el mes en curso) ──
create or replace function public.casiterita_cerrar_mes(p_mes text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ult text;
  v_fin date;
  v_hoy text := to_char((now() at time zone 'America/Caracas')::date, 'YYYY-MM');
  v_ap date;
  s record;
begin
  if not public.casiterita_puede_escribir() then raise exception 'No tienes permiso para cerrar el libro.'; end if;
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then raise exception 'Mes no válido.'; end if;
  if p_mes >= v_hoy then raise exception 'Solo se cierran meses terminados.'; end if;
  select fecha into v_ap from public.casiterita_libro where tipo = 'apertura';
  if v_ap is null then raise exception 'El libro no tiene saldo inicial.'; end if;
  if p_mes < to_char(v_ap, 'YYYY-MM') then raise exception 'Ese mes es anterior a la apertura del libro.'; end if;
  perform pg_advisory_xact_lock(hashtext('casiterita_lotes'));
  -- Serializa el cierre con las cargas y borrados del libro: espera a los que están
  -- en curso y bloquea los nuevos hasta terminar, así nada entra a un mes que se está cerrando.
  lock table public.casiterita_libro in share row exclusive mode;
  select max(mes) into v_ult from public.casiterita_cierres_pmp;
  if v_ult is not null and p_mes <= v_ult then raise exception 'Ese mes ya está cerrado.'; end if;
  -- En orden: no puede quedar abierto un mes anterior con movimientos.
  if exists (select 1 from public.casiterita_libro
              where to_char(fecha, 'YYYY-MM') < p_mes and to_char(fecha, 'YYYY-MM') > coalesce(v_ult, '0000-00')
                and to_char(fecha, 'YYYY-MM') >= to_char(v_ap, 'YYYY-MM')
                and to_char(fecha, 'YYYY-MM') not in (select mes from public.casiterita_cierres_pmp)) then
    raise exception 'Hay un mes anterior sin cerrar: ciérralo primero.';
  end if;
  v_fin := (to_date(p_mes || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;
  select * into s from public.casiterita_saldo_al(v_fin);
  insert into public.casiterita_cierres_pmp (mes, kg_global, kg_mgg, costo, pmp, resguardo, movimientos, cerrado_por_name)
    values (p_mes, s.kg_global, s.kg_mgg, s.costo, s.pmp, s.kg_global - s.kg_mgg,
            (select count(*) from public.casiterita_libro where to_char(fecha, 'YYYY-MM') = p_mes),
            public.casiterita_nombre_actor());
end $$;

-- ── Reabrir el último mes cerrado (solo administrador) ──
create or replace function public.casiterita_reabrir_mes(p_mes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.usuarios where id = auth.uid() and role = 'admin' and estado = 'activo') then
    raise exception 'Solo un administrador reabre un mes cerrado.';
  end if;
  if p_mes is distinct from (select max(mes) from public.casiterita_cierres_pmp) then
    raise exception 'Solo se reabre el último mes cerrado.';
  end if;
  delete from public.casiterita_cierres_pmp where mes = p_mes;
end $$;

-- ── Conteo físico (y su ajuste, si se pide) ──
create or replace function public.casiterita_registrar_conteo(p_fecha date, p_renglones jsonb, p_nota text, p_ajustar boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_fisico numeric;
  v_n int;
  s record;
  v_dif numeric;
  v_ajuste uuid;
  v_id uuid;
begin
  if not public.casiterita_puede_escribir() then raise exception 'No tienes permiso para registrar conteos.'; end if;
  if p_fecha is null then raise exception 'Indica la fecha del conteo.'; end if;
  if p_fecha > (now() at time zone 'America/Caracas')::date then raise exception 'El conteo no puede ser de una fecha futura.'; end if;
  if jsonb_typeof(p_renglones) <> 'array' or jsonb_array_length(p_renglones) = 0 then raise exception 'Carga al menos un renglón.'; end if;
  select count(*), coalesce(sum((x->>'kg')::numeric), 0) into v_n, v_fisico
    from jsonb_array_elements(p_renglones) x
   where coalesce(trim(x->>'descripcion'), '') <> '' and (x->>'kg')::numeric >= 0;
  if v_n <> jsonb_array_length(p_renglones) then raise exception 'Cada renglón lleva descripción y kg (cero o más).'; end if;
  perform pg_advisory_xact_lock(hashtext('casiterita_lotes'));
  select * into s from public.casiterita_saldo_al(p_fecha);
  v_dif := round(v_fisico - s.kg_global, 3);
  if p_ajustar and abs(v_dif) > 0.001 then
    if -v_dif > s.kg_mgg + 0.001 then
      raise exception 'El faltante (% kg) es mayor que el inventario MGG (% kg): revisa el conteo.', round(-v_dif, 2), round(s.kg_mgg, 2);
    end if;
    insert into public.casiterita_libro (fecha, tipo, descripcion, kg, nota)
      values (p_fecha, 'ajuste',
              format('Ajuste por conteo físico %s (físico %s kg · libro %s kg)', to_char(p_fecha, 'DD-MM-YYYY'),
                     to_char(v_fisico, 'FM999G999G990D00'), to_char(s.kg_global, 'FM999G999G990D00')),
              -v_dif, nullif(trim(p_nota), ''))
      returning id into v_ajuste;
  end if;
  insert into public.casiterita_conteos (fecha, renglones, kg_fisico, kg_libro, diferencia, ajuste_id, nota, actor_name)
    values (p_fecha, p_renglones, v_fisico, s.kg_global, v_dif, v_ajuste, nullif(trim(p_nota), ''), public.casiterita_nombre_actor())
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.casiterita_saldo_al(date) from public, anon;
revoke all on function public.casiterita_cerrar_mes(text) from public, anon;
revoke all on function public.casiterita_reabrir_mes(text) from public, anon;
revoke all on function public.casiterita_registrar_conteo(date, jsonb, text, boolean) from public, anon;
-- casiterita_saldo_al es interna (cierre y conteo): sin EXECUTE para la app.
revoke execute on function public.casiterita_saldo_al(date) from authenticated;
grant execute on function public.casiterita_cerrar_mes(text) to authenticated;
grant execute on function public.casiterita_reabrir_mes(text) to authenticated;
grant execute on function public.casiterita_registrar_conteo(date, jsonb, text, boolean) to authenticated;

alter table public.casiterita_cierres_pmp enable row level security;
alter table public.casiterita_conteos enable row level security;
drop policy if exists "casi cierres read" on public.casiterita_cierres_pmp;
create policy "casi cierres read" on public.casiterita_cierres_pmp for select
  using ((select public.puede_modulo('inventario', 'lectura')));
drop policy if exists "casi conteos read" on public.casiterita_conteos;
create policy "casi conteos read" on public.casiterita_conteos for select
  using ((select public.puede_modulo('inventario', 'lectura')));
grant select on public.casiterita_cierres_pmp, public.casiterita_conteos to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.casiterita_cierres_pmp; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.casiterita_conteos; exception when duplicate_object then null; end;
end $$;
