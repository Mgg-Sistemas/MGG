/* ============================================================
   MGG · RRHH · Sueldos viejos: cargar el histórico del Excel — 09/10/2026
   (v2: con la semilla de la fecha de ingreso y la carga en lote desde Excel)

   El historial de sueldos (`personal_sueldos`) tiene por persona un renglón
   «inicial» —LA SEMILLA— que puso el trigger al crear la ficha (04-10-2026):
   «gana X desde la fecha de ingreso». Eso casi nunca es verdad: la persona
   entró con otro sueldo y fue subiendo. Lo de antes está en un Excel y la
   administradora quiere verlo en el sistema: «en qué año cambió su sueldo».

   Esta es la SEGUNDA puerta al historial, más angosta que la primera:
   · NO toca `personal.sueldo_base`: el sueldo de hoy sigue siendo el de hoy.
   · El renglón tiene que regir ANTES del último cambio REAL (los renglones
     que sí movieron la ficha: aumento, ajuste, corrección…; la semilla y los
     históricos no cuentan). Si fuera igual o posterior, eso es
     `cambiar_sueldo_personal`.
   · Nunca a futuro. No dos renglones con la misma fecha. Montos ≥ 0.
   · LA SEMILLA SE CORRIGE, NO SE DUPLICA: el renglón que trae el sueldo de
     hoy con su fecha real («desde cuándo rige de verdad el sueldo actual») le
     cambia la fecha, el anterior y el motivo a la semilla. Sale solo cuando
     la fecha es igual o posterior a la semilla, o cuando quien carga lo marca
     (p_es_sueldo_actual) porque la semilla quedó con una fecha posterior a la
     real. Cualquier OTRO sueldo con fecha igual o posterior a la semilla se
     rechaza: hay que cargar primero el de hoy.
   · Queda marcado tipo 'historico'. Solo el ADMINISTRADOR puede quitar un
     renglón 'historico'; los demás siguen intocables.
   · `cargar_sueldos_historicos(jsonb)`: la carga del Excel, todo o nada.
   ============================================================ */
begin;

/* ── 0) El sueldo del renglón del archivo inmediatamente anterior (por fecha) ─
   Para encadenar: el «anterior» de cada renglón del Excel es el sueldo del
   renglón previo de esa persona en el mismo archivo (0 si es el primero).   */
create or replace function public._sueldo_historico_prev_archivo(p_filas jsonb, p_pid uuid, p_fecha date)
returns numeric
language sql
stable
as $$
  select coalesce((
    select round((f->>'sueldo')::numeric, 2)
      from jsonb_array_elements(p_filas) f
     where (f->>'personal_id')::uuid = p_pid and (f->>'fecha')::date < p_fecha
     order by (f->>'fecha')::date desc limit 1), 0);
$$;
revoke all on function public._sueldo_historico_prev_archivo(jsonb, uuid, date) from public, anon, authenticated;

/* ── 1) El trabajo de verdad: un renglón, con todas las reglas ───────────── */
create or replace function public._sueldo_historico_uno(
  p_personal_id     uuid,
  p_sueldo_anterior numeric,
  p_sueldo_nuevo    numeric,
  p_vigente_desde   date,
  p_motivo          text,
  p_actor           text,
  p_actor_name      text,
  p_es_sueldo_actual boolean,
  p_contexto        text
)
returns public.personal_sueldos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior numeric := round(coalesce(p_sueldo_anterior, 0)::numeric, 2);
  v_nuevo    numeric := round(coalesce(p_sueldo_nuevo, 0)::numeric, 2);
  v_motivo   text    := btrim(coalesce(p_motivo, ''));
  v_sueldo_hoy numeric;
  v_vig_real  date;
  v_semilla   public.personal_sueldos;
  v_fila      public.personal_sueldos;
  v_ctx       text := case when coalesce(p_contexto, '') = '' then '' else p_contexto || ': ' end;
  v_corrige   boolean;
begin
  if p_vigente_desde is null then
    raise exception '%Indicá desde cuándo rigió ese sueldo.', v_ctx using errcode = 'check_violation';
  end if;
  if p_vigente_desde > current_date then
    raise exception '%Un sueldo viejo no puede regir a futuro.', v_ctx using errcode = 'check_violation';
  end if;
  if v_nuevo < 0 or v_anterior < 0 then
    raise exception '%El sueldo no puede ser negativo.', v_ctx using errcode = 'check_violation';
  end if;
  if length(v_motivo) < 4 then
    raise exception '%Escribí el motivo o de dónde sale el dato: queda en el historial.', v_ctx using errcode = 'check_violation';
  end if;

  select round(coalesce(sueldo_base, 0)::numeric, 2) into v_sueldo_hoy from public.personal where id = p_personal_id;
  if not found then
    raise exception '%No existe esa persona en el personal.', v_ctx;
  end if;

  /* Candado por persona: dos cargas a la vez no se pisan. */
  perform pg_advisory_xact_lock(hashtext('personal_sueldos:' || p_personal_id::text));

  /* El último cambio REAL (sin semilla ni históricos). */
  select max(vigente_desde) into v_vig_real
    from public.personal_sueldos
   where personal_id = p_personal_id and coalesce(tipo, '') not in ('historico', 'inicial');
  if v_vig_real is not null and p_vigente_desde >= v_vig_real then
    raise exception '%Esa fecha (%) es igual o posterior al último cambio real de sueldo (%). Los sueldos viejos van antes; para cambiar el sueldo de hoy usá «cambiar sueldo» en la ficha.',
      v_ctx, to_char(p_vigente_desde, 'DD/MM/YYYY'), to_char(v_vig_real, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  /* La semilla (si la hay): el renglón inicial con la fecha de ingreso. */
  select * into v_semilla from public.personal_sueldos
   where personal_id = p_personal_id and tipo = 'inicial'
   order by vigente_desde desc, created_at desc limit 1;

  if v_semilla.id is not null then
    if coalesce(p_es_sueldo_actual, false) and v_nuevo <> v_sueldo_hoy then
      raise exception '%Se marcó como el sueldo actual, pero la ficha dice % y el renglón trae %.', v_ctx, v_sueldo_hoy, v_nuevo
        using errcode = 'check_violation';
    end if;
    v_corrige := coalesce(p_es_sueldo_actual, false)
                 or (p_vigente_desde >= v_semilla.vigente_desde and v_nuevo = v_sueldo_hoy);
    if v_corrige then
      /* Es el sueldo de hoy con su fecha real: se corrige la semilla. */
      if exists (select 1 from public.personal_sueldos
                  where personal_id = p_personal_id and vigente_desde = p_vigente_desde and id <> v_semilla.id) then
        raise exception '%Ya hay un renglón que rige desde el %.', v_ctx, to_char(p_vigente_desde, 'DD/MM/YYYY') using errcode = 'unique_violation';
      end if;
      update public.personal_sueldos
         set vigente_desde = p_vigente_desde,
             sueldo_anterior = v_anterior,
             motivo = v_motivo || ' (fecha real del sueldo actual; la carga inicial decía desde el ' || to_char(v_semilla.vigente_desde, 'DD/MM/YYYY') || ')',
             actor = coalesce(p_actor, actor),
             actor_name = coalesce(p_actor_name, actor_name)
       where id = v_semilla.id
       returning * into v_fila;
      return v_fila;
    end if;
    if p_vigente_desde >= v_semilla.vigente_desde then
      raise exception '%Esa fecha (%) es igual o posterior a la carga inicial del sueldo actual (%, tomada de la fecha de ingreso). Cargá primero el sueldo de hoy (%) con la fecha real desde la que rige: eso corrige la carga inicial. Después cargá los anteriores.',
        v_ctx, to_char(p_vigente_desde, 'DD/MM/YYYY'), to_char(v_semilla.vigente_desde, 'DD/MM/YYYY'), v_sueldo_hoy
        using errcode = 'check_violation';
    end if;
  end if;

  if exists (select 1 from public.personal_sueldos where personal_id = p_personal_id and vigente_desde = p_vigente_desde) then
    raise exception '%Ya hay un renglón que rige desde el %. Si quedó mal, el administrador lo puede quitar y volver a cargar.',
      v_ctx, to_char(p_vigente_desde, 'DD/MM/YYYY')
      using errcode = 'unique_violation';
  end if;

  insert into public.personal_sueldos
        (personal_id, sueldo_anterior, sueldo_nuevo, vigente_desde, motivo, tipo, actor, actor_name)
  values (p_personal_id, v_anterior, v_nuevo, p_vigente_desde, v_motivo, 'historico', p_actor, p_actor_name)
  returning * into v_fila;
  return v_fila;
end $$;
revoke all on function public._sueldo_historico_uno(uuid, numeric, numeric, date, text, text, text, boolean, text) from public, anon, authenticated;

/* ── 2) Cargar un sueldo viejo (a mano) ───────────────────────────────── */
create or replace function public.registrar_sueldo_historico(
  p_personal_id     uuid,
  p_sueldo_anterior numeric,
  p_sueldo_nuevo    numeric,
  p_vigente_desde   date,
  p_motivo          text,
  p_actor           text default null,
  p_actor_name      text default null,
  p_es_sueldo_actual boolean default false
)
returns public.personal_sueldos
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_operativo() then
    raise exception 'No tenés permiso para cargar sueldos.' using errcode = 'insufficient_privilege';
  end if;
  return public._sueldo_historico_uno(p_personal_id, p_sueldo_anterior, p_sueldo_nuevo, p_vigente_desde, p_motivo, p_actor, p_actor_name, p_es_sueldo_actual, '');
end $$;
revoke all on function public.registrar_sueldo_historico(uuid, numeric, numeric, date, text, text, text, boolean) from public, anon;
grant execute on function public.registrar_sueldo_historico(uuid, numeric, numeric, date, text, text, text, boolean) to authenticated;

/* ── 3) Cargar el Excel: muchos renglones, todo o nada ─────────────────────
   p_filas: [{fila, personal_id, fecha, sueldo, motivo, nota}]. Por persona se
   procesa PRIMERO el renglón del sueldo de hoy (el más reciente con el monto
   de la ficha: corrige la semilla) y después el resto en orden de fecha. */
create or replace function public.cargar_sueldos_historicos(
  p_filas      jsonb,
  p_actor      text default null,
  p_actor_name text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_n    integer := 0;
  v_motivo text;
begin
  if not public.is_operativo() then
    raise exception 'No tenés permiso para cargar sueldos.' using errcode = 'insufficient_privilege';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'No hay filas para cargar.' using errcode = 'check_violation';
  end if;

  for r in
    with filas as (
      select (f->>'fila')::int as fila,
             (f->>'personal_id')::uuid as personal_id,
             (f->>'fecha')::date as fecha,
             round((f->>'sueldo')::numeric, 2) as sueldo,
             nullif(btrim(f->>'motivo'), '') as motivo,
             nullif(btrim(f->>'nota'), '') as nota,
             round(coalesce(p.sueldo_base, 0)::numeric, 2) as sueldo_hoy,
             (select 1 from public.personal_sueldos s where s.personal_id = p.id and s.tipo = 'inicial' limit 1) as tiene_semilla
        from jsonb_array_elements(p_filas) f
        left join public.personal p on p.id = (f->>'personal_id')::uuid
    ), marcadas as (
      select *,
             /* El renglón del sueldo de hoy: el más reciente con el monto de la ficha. */
             (tiene_semilla = 1 and sueldo = sueldo_hoy
              and fecha = max(fecha) filter (where sueldo = sueldo_hoy) over (partition by personal_id)) as es_actual
        from filas
    )
    select * from marcadas
     order by personal_id, case when es_actual then 0 else 1 end, fecha
  loop
    v_motivo := coalesce(r.motivo, 'Registro histórico (Excel anterior al sistema)')
                || case when r.nota is null then '' else ' · ' || r.nota end;
    perform public._sueldo_historico_uno(
      r.personal_id,
      public._sueldo_historico_prev_archivo(p_filas, r.personal_id, r.fecha),
      r.sueldo, r.fecha, v_motivo, p_actor, p_actor_name, coalesce(r.es_actual, false), 'Fila ' || r.fila);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.cargar_sueldos_historicos(jsonb, text, text) from public, anon;
grant execute on function public.cargar_sueldos_historicos(jsonb, text, text) to authenticated;

/* ── 4) Quitar un renglón histórico mal cargado (solo administrador) ──── */
create or replace function public.eliminar_sueldo_historico(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
begin
  if not public.is_admin() then
    raise exception 'Quitar un renglón del historial es tarea del administrador.' using errcode = 'insufficient_privilege';
  end if;
  select tipo into v_tipo from public.personal_sueldos where id = p_id;
  if not found then
    raise exception 'Ese renglón ya no existe.';
  end if;
  if coalesce(v_tipo, '') <> 'historico' then
    raise exception 'Solo se quitan los sueldos viejos cargados a mano (tipo histórico). Los demás renglones del historial no se borran: se registra otro cambio que los corrija.'
      using errcode = 'check_violation';
  end if;
  delete from public.personal_sueldos where id = p_id and tipo = 'historico';
end $$;
revoke all on function public.eliminar_sueldo_historico(uuid) from public, anon;
grant execute on function public.eliminar_sueldo_historico(uuid) to authenticated;

/* ── 5) Linter de seguridad de Supabase (09-10) ────────────────────────────
   Funciones security definer de nómina (triggers y ayudantes) que el rol
   anónimo podía invocar por /rpc. No las llama nadie desde afuera. Ninguna
   tabla pública está sin RLS: no hay nada más que activar.                 */
revoke execute on function public.nomina_actor_actual() from public, anon;
revoke execute on function public.nomina_periodo_guard() from public, anon;
revoke execute on function public.nomina_periodo_sync_papelera() from public, anon;
revoke execute on function public.nomina_puede_administrar() from public, anon;
revoke execute on function public.nomina_renglon_guard() from public, anon;

commit;
