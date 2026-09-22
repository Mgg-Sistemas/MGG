/* ============================================================
   MGG · RRHH · Dos nóminas: MGG y GoMetal — 22/09/2026

   GoMetal es otra empresa, con su propio personal. Su nómina no se mezcla con
   la de MGG, aunque Tesorería pague las dos.

   LA EMPRESA LA DEFINE LA PERSONA, NO LA PANTALLA
   El trabajador pertenece a una empresa. Todo lo que se le carga —su
   anticipo, su vacación, su renglón de nómina— HEREDA esa empresa, copiada
   por la base desde la ficha.

   Podría haberse guardado solo en `personal` y resolverla con un join cada
   vez. No se hizo por dos razones:
   · Tesorería lee la cola de pago sin traer el personal: necesita la etiqueta
     en el renglón para mostrarla y filtrar sin un join extra.
   · Un renglón de nómina es un documento histórico. Si mañana alguien pasa de
     una empresa a la otra, la nómina que ya se le pagó tiene que seguir
     diciendo bajo qué empresa se pagó.

   Y como la copia la hace la base y no el formulario, no puede desincronizarse
   por un descuido del código.

   TODO LO QUE YA EXISTÍA ES DE MGG. GoMetal nació hoy.
   ============================================================ */
begin;

/* ── 1) La empresa en la ficha: acá manda ─────────────────────────────── */
alter table public.personal
  add column if not exists empresa text not null default 'MGG';

alter table public.personal drop constraint if exists personal_empresa_check;
alter table public.personal add constraint personal_empresa_check
  check (empresa in ('MGG', 'GOMETAL'));

create index if not exists personal_empresa_idx on public.personal (empresa, activo);

/* ── 2) La empresa heredada, en lo que cuelga de la persona ───────────── */
alter table public.anticipos_prestamos add column if not exists empresa text not null default 'MGG';
alter table public.rrhh_eventos        add column if not exists empresa text not null default 'MGG';
alter table public.nomina_renglones    add column if not exists empresa text not null default 'MGG';
alter table public.nomina_periodos     add column if not exists empresa text not null default 'MGG';

do $$
declare t text;
begin
  foreach t in array array['anticipos_prestamos', 'rrhh_eventos', 'nomina_renglones', 'nomina_periodos'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_empresa_check');
    execute format('alter table public.%I add constraint %I check (empresa in (''MGG'', ''GOMETAL''))', t, t || '_empresa_check');
  end loop;
end $$;

create index if not exists anticipos_prestamos_empresa_idx on public.anticipos_prestamos (empresa, estado);
create index if not exists rrhh_eventos_empresa_idx on public.rrhh_eventos (empresa, tipo);
create index if not exists nomina_renglones_empresa_idx on public.nomina_renglones (empresa, estado);
create index if not exists nomina_periodos_empresa_idx on public.nomina_periodos (empresa, created_at desc);

/* ── 3) La copia la hace la base, no el formulario ──────────────────────
   Un insert que se olvide de poner la empresa no puede terminar con el
   anticipo de alguien de GoMetal colgando de la nómina de MGG.            */
create or replace function public.heredar_empresa_de_personal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_empresa text;
begin
  if new.personal_id is null then
    return new;
  end if;
  select p.empresa into v_empresa from public.personal p where p.id = new.personal_id;
  if v_empresa is not null then
    new.empresa := v_empresa;
  end if;
  return new;
end $$;

drop trigger if exists trg_anticipos_empresa on public.anticipos_prestamos;
create trigger trg_anticipos_empresa
  before insert on public.anticipos_prestamos
  for each row execute function public.heredar_empresa_de_personal();

drop trigger if exists trg_eventos_empresa on public.rrhh_eventos;
create trigger trg_eventos_empresa
  before insert on public.rrhh_eventos
  for each row execute function public.heredar_empresa_de_personal();

drop trigger if exists trg_renglones_empresa on public.nomina_renglones;
create trigger trg_renglones_empresa
  before insert on public.nomina_renglones
  for each row execute function public.heredar_empresa_de_personal();

/* ── 4) El período toma la empresa de sus renglones ─────────────────────
   Un período con gente de las dos empresas sería una nómina que no se puede
   pagar ni explicar: se rechaza al cargarla.                               */
create or replace function public.nomina_periodo_una_sola_empresa()
returns trigger
language plpgsql
as $$
declare v_empresas int;
begin
  select count(distinct empresa) into v_empresas
    from public.nomina_renglones where periodo_id = new.periodo_id;
  if v_empresas > 1 then
    raise exception 'Una nómina no puede mezclar personal de MGG y de GoMetal: son empresas distintas.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_nomina_una_empresa on public.nomina_renglones;
create trigger trg_nomina_una_empresa
  after insert on public.nomina_renglones
  for each row execute function public.nomina_periodo_una_sola_empresa();

/* ── 5) El correlativo por empresa ──────────────────────────────────────
   Cada una numera la suya desde 1: la nómina 3 de GoMetal no tiene por qué
   saber cuántas lleva MGG. Lo da la base para que dos personas cargando a la
   vez no saquen el mismo número.                                            */
create or replace function public.siguiente_codigo_nomina(p_empresa text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa text := upper(coalesce(nullif(btrim(p_empresa), ''), 'MGG'));
  v_prefijo text;
  v_anio    int := extract(year from current_date);
  v_n       int;
begin
  if v_empresa not in ('MGG', 'GOMETAL') then
    raise exception 'Empresa desconocida: %', p_empresa;
  end if;
  v_prefijo := case when v_empresa = 'GOMETAL' then 'GM-' else '' end;

  /* Se cuenta sobre los códigos ya emitidos del año y la empresa, con candado
     sobre la tabla para que dos cargas simultáneas no repitan el número. */
  lock table public.nomina_periodos in share row exclusive mode;
  select count(*) + 1 into v_n
    from public.nomina_periodos
   where empresa = v_empresa
     and codigo like v_prefijo || 'NOM-' || v_anio || '-%';

  return v_prefijo || 'NOM-' || v_anio || '-' || lpad(v_n::text, 4, '0');
end $$;

revoke all on function public.siguiente_codigo_nomina(text) from public, anon;
grant execute on function public.siguiente_codigo_nomina(text) to authenticated;

commit;

select
  (select count(*) from public.personal where empresa = 'MGG') as personal_mgg,
  (select count(*) from public.personal where empresa = 'GOMETAL') as personal_gometal,
  public.siguiente_codigo_nomina('MGG')     as proximo_mgg,
  public.siguiente_codigo_nomina('GOMETAL') as proximo_gometal;
