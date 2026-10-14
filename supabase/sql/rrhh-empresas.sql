-- ============================================================
-- MGG · RRHH · Empresas / nóminas configurables (14-10-2026)
-- Como en Golden Touch (Nómina GT / Nómina MTO) pero sin tope: la administradora
-- crea las empresas que necesite. Cada una lleva su personal, anticipos, períodos
-- de nómina, eventos y descansos (todo lo que ya filtraba por `empresa`).
-- Una persona se pasa de una nómina a otra con rrhh_transferir_empresa.
-- Idempotente. No borra datos.
-- ============================================================

-- ───────── 1. Catálogo de empresas ─────────
create table if not exists public.rrhh_empresas (
  codigo       text primary key check (codigo ~ '^[A-Z0-9]{2,10}$'),
  nombre       text not null check (length(btrim(nombre)) >= 2),
  razon_social text not null check (length(btrim(razon_social)) >= 3),
  rif          text,
  icono        text not null default '🏢',
  color        text not null default '#ff8a00',
  orden        integer not null default 0,
  activa       boolean not null default true,
  actor        text,
  actor_name   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
alter table public.rrhh_empresas enable row level security;
revoke all on public.rrhh_empresas from anon;
drop policy if exists "rrhh_empresas read auth" on public.rrhh_empresas;
create policy "rrhh_empresas read auth" on public.rrhh_empresas for select using ((select auth.role()) = 'authenticated');
drop policy if exists "rrhh_empresas write rrhh" on public.rrhh_empresas;
create policy "rrhh_empresas write rrhh" on public.rrhh_empresas for all
  using ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura')))
  with check ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura')));
grant select, insert, update on public.rrhh_empresas to authenticated;
drop trigger if exists trg_rrhh_empresas_updated_at on public.rrhh_empresas;
create trigger trg_rrhh_empresas_updated_at before update on public.rrhh_empresas for each row execute function public.set_updated_at();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='rrhh_empresas') then
    alter publication supabase_realtime add table public.rrhh_empresas; end if;
end $$;

-- MGG es la de siempre: queda con la razón social y el RIF que ya imprimían los PDF.
insert into public.rrhh_empresas (codigo, nombre, razon_social, rif, icono, color, orden)
values ('MGG', 'MGG', 'Mineral Group Guayana C.A.', 'J-50221930-7', '⛏', '#ff8a00', 0)
on conflict (codigo) do nothing;

-- ───────── 2. La columna `empresa` deja de estar clavada en 'MGG' ─────────
-- Antes: check (empresa = 'MGG'). Ahora: llave foránea al catálogo.
do $$
declare t text;
begin
  foreach t in array array['personal', 'nomina_periodos', 'nomina_renglones', 'anticipos_prestamos', 'rrhh_eventos'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_empresa_check');
    if not exists (select 1 from pg_constraint where conname = t || '_empresa_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (empresa) references public.rrhh_empresas(codigo) on update cascade', t, t || '_empresa_fkey');
    end if;
  end loop;
end $$;

-- ───────── 3. Código de nómina por empresa ─────────
-- MGG sigue con NOM-AAAA-0001 (no cambia nada de lo ya cargado); las demás
-- llevan su código en el prefijo: NOM-MTO-AAAA-0001. Cada empresa cuenta aparte.
create or replace function public.siguiente_codigo_nomina(p_empresa text) returns text
language plpgsql security definer set search_path to 'public' as $$
declare
  v_empresa text := upper(coalesce(nullif(btrim(p_empresa), ''), 'MGG'));
  v_anio    int := extract(year from current_date);
  v_prefijo text;
  v_n       int;
begin
  if not exists (select 1 from public.rrhh_empresas where codigo = v_empresa) then
    raise exception 'Empresa desconocida: %. Créala en RRHH → ⚙ Empresas.', p_empresa;
  end if;
  v_prefijo := case when v_empresa = 'MGG' then 'NOM-' || v_anio || '-' else 'NOM-' || v_empresa || '-' || v_anio || '-' end;
  lock table public.nomina_periodos in share row exclusive mode;
  select coalesce(max(substring(codigo from length(v_prefijo) + 1)::int), 0) + 1 into v_n
    from public.nomina_periodos
   where empresa = v_empresa
     and codigo ~ ('^' || v_prefijo || '[0-9]+$');
  return v_prefijo || lpad(v_n::text, 4, '0');
end $$;

-- ───────── 4. N° de ficha automático: el siguiente de TODO el personal ─────────
-- El índice único de ficha es global (una ficha «001» en MGG no se repite en
-- otra empresa), así que el número automático también se calcula sobre todas.
create or replace function public.personal_asignar_numero_ficha() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_siguiente integer;
begin
  if new.numero_ficha is null or btrim(new.numero_ficha) = '' then
    select coalesce(max(numero_ficha::integer), 0) + 1
      into v_siguiente
      from public.personal
     where numero_ficha ~ '^[0-9]+$';
    new.numero_ficha := lpad(v_siguiente::text, 3, '0');
  else
    new.numero_ficha := upper(btrim(new.numero_ficha));
  end if;
  return new;
end $$;

-- ───────── 5. Transferir a una persona de una nómina a otra ─────────
-- Se lleva su ficha, sus anticipos/préstamos ACTIVOS (para que se sigan
-- descontando en la nómina nueva) y sus eventos (vacaciones, permisos, notas).
-- Los renglones de nómina ya cargados o pagados se quedan donde se pagaron:
-- son historia de esa empresa. Deja una nota en el expediente.
create or replace function public.rrhh_transferir_empresa(p_personal uuid, p_empresa text, p_motivo text default null, p_actor text default null, p_actor_name text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_de text; v_a text := upper(btrim(coalesce(p_empresa, ''))); v_activa boolean; v_nombre_a text; v_nombre_de text;
begin
  if not ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura'))) then
    raise exception 'No autorizado.' using errcode = 'insufficient_privilege';
  end if;
  select activa, nombre into v_activa, v_nombre_a from public.rrhh_empresas where codigo = v_a;
  if v_activa is null then raise exception 'La empresa % no existe.', v_a using errcode = 'check_violation'; end if;
  if not v_activa then raise exception 'La empresa % está deshabilitada.', v_nombre_a using errcode = 'check_violation'; end if;
  select empresa into v_de from public.personal where id = p_personal for update;
  if not found then raise exception 'La persona no existe.' using errcode = 'check_violation'; end if;
  if v_de = v_a then raise exception 'Ya está en la nómina %.', v_nombre_a using errcode = 'check_violation'; end if;
  select nombre into v_nombre_de from public.rrhh_empresas where codigo = v_de;

  update public.personal set empresa = v_a where id = p_personal;
  update public.anticipos_prestamos set empresa = v_a where personal_id = p_personal and estado = 'activo';
  update public.rrhh_eventos set empresa = v_a where personal_id = p_personal;
  insert into public.rrhh_eventos (personal_id, tipo, fecha_desde, descripcion, creado_por, actor_name, empresa)
  values (p_personal, 'nota', current_date,
          'Transferido de la nómina ' || coalesce(v_nombre_de, v_de) || ' a la nómina ' || v_nombre_a
            || coalesce(': ' || nullif(btrim(p_motivo), ''), ''),
          p_actor, p_actor_name, v_a);
end $$;
revoke execute on function public.rrhh_transferir_empresa(uuid, text, text, text, text) from anon, public;
grant execute on function public.rrhh_transferir_empresa(uuid, text, text, text, text) to authenticated;

-- Cotejo:
-- select codigo, nombre, activa from rrhh_empresas order by orden;
-- select conname, conrelid::regclass from pg_constraint where conname like '%_empresa_fkey';
