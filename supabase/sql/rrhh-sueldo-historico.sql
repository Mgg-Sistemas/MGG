/* ============================================================
   MGG · RRHH · Sueldos viejos: cargar el histórico del Excel — 09/10/2026

   El historial de sueldos (`personal_sueldos`) arrancó el 22-09-2026 con un
   renglón «inicial» por persona. Lo de antes (los aumentos de 2023, 2024,
   2025…) está en un Excel y la administradora quiere verlo en el sistema:
   «en qué año cambió su sueldo».

   Esta es la SEGUNDA puerta al historial, y es más angosta que la primera:
   · NO toca `personal.sueldo_base`: el sueldo de hoy sigue siendo el de hoy.
   · El renglón tiene que regir ANTES del renglón que puso el sueldo actual
     (el más reciente que no sea «historico»). Si fuera igual o posterior,
     estaría afirmando otro sueldo, y eso es `cambiar_sueldo_personal`.
   · Nunca a futuro. No dos renglones con la misma vigencia para la misma
     persona. Montos no negativos (0 vale: no cobraba).
   · Queda marcado tipo 'historico', así en pantalla, PDF y Excel se ve que
     fue una carga manual y no una decisión tomada en el sistema.
   · Como es una carga de datos (y los Excel traen errores de tipeo), el
     ADMINISTRADOR puede quitar un renglón 'historico'. Los demás tipos siguen
     siendo intocables: la política de la tabla no da delete, y la función
     solo borra 'historico'.
   ============================================================ */
begin;

/* ── 1) Cargar un sueldo viejo ─────────────────────────────────────────── */
create or replace function public.registrar_sueldo_historico(
  p_personal_id    uuid,
  p_sueldo_anterior numeric,
  p_sueldo_nuevo   numeric,
  p_vigente_desde  date,
  p_motivo         text,
  p_actor          text default null,
  p_actor_name     text default null
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
  v_vig_actual date;
  v_fila     public.personal_sueldos;
begin
  if not public.is_operativo() then
    raise exception 'No tenés permiso para cargar sueldos.' using errcode = 'insufficient_privilege';
  end if;
  if p_vigente_desde is null then
    raise exception 'Indicá desde cuándo rigió ese sueldo.' using errcode = 'check_violation';
  end if;
  if p_vigente_desde > current_date then
    raise exception 'Un sueldo viejo no puede regir a futuro.' using errcode = 'check_violation';
  end if;
  if v_nuevo < 0 or v_anterior < 0 then
    raise exception 'El sueldo no puede ser negativo.' using errcode = 'check_violation';
  end if;
  if length(v_motivo) < 4 then
    raise exception 'Escribí el motivo o de dónde sale el dato: queda en el historial.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.personal where id = p_personal_id) then
    raise exception 'No existe esa persona en el personal.';
  end if;

  /* Candado por persona: dos cargas a la vez no se pisan. */
  perform pg_advisory_xact_lock(hashtext('personal_sueldos:' || p_personal_id::text));

  /* La vigencia del sueldo de HOY: el renglón real más reciente. */
  select max(vigente_desde) into v_vig_actual
    from public.personal_sueldos
   where personal_id = p_personal_id and coalesce(tipo, '') <> 'historico';
  if v_vig_actual is not null and p_vigente_desde >= v_vig_actual then
    raise exception 'Esa fecha (%) es igual o posterior a la vigencia del sueldo actual (%). Los sueldos viejos van antes; para cambiar el sueldo de hoy usá «cambiar sueldo» en la ficha.',
      to_char(p_vigente_desde, 'DD/MM/YYYY'), to_char(v_vig_actual, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.personal_sueldos where personal_id = p_personal_id and vigente_desde = p_vigente_desde) then
    raise exception 'Ya hay un renglón que rige desde el %. Si quedó mal, el administrador lo puede quitar y volver a cargar.',
      to_char(p_vigente_desde, 'DD/MM/YYYY')
      using errcode = 'unique_violation';
  end if;

  insert into public.personal_sueldos
        (personal_id, sueldo_anterior, sueldo_nuevo, vigente_desde, motivo, tipo, actor, actor_name)
  values (p_personal_id, v_anterior, v_nuevo, p_vigente_desde, v_motivo, 'historico', p_actor, p_actor_name)
  returning * into v_fila;
  return v_fila;
end $$;

revoke all on function public.registrar_sueldo_historico(uuid, numeric, numeric, date, text, text, text) from public, anon;
grant execute on function public.registrar_sueldo_historico(uuid, numeric, numeric, date, text, text, text) to authenticated;

/* ── 2) Quitar un renglón histórico mal cargado (solo administrador) ──── */
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

commit;
