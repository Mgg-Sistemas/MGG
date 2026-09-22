/* ============================================================
   MGG · RRHH · El sueldo solo se cambia con un motivo — 22/09/2026

   Un historial que el código puede saltear no es un historial. Si el sueldo
   se puede pisar con un `update` común, tarde o temprano alguien lo pisa —
   desde otra pantalla, desde un script, desde el panel de Supabase — y el
   historial queda mintiendo.

   Así que la regla vive en la BASE, no en el formulario:

   · Un UPDATE que cambie `sueldo_base` se RECHAZA, salvo que venga por
     `cambiar_sueldo_personal(...)`, que exige el motivo.
   · Esa función escribe el renglón del historial y cambia el sueldo EN LA
     MISMA TRANSACCIÓN: no existe un sueldo cambiado sin su renglón, ni un
     renglón de un cambio que no ocurrió.
   · Al crear una ficha con sueldo, el renglón inicial se escribe solo.

   Los updates que NO tocan el sueldo (activar, cambiar el teléfono, cargar el
   RIF) pasan como siempre: la guarda mira el sueldo, no la fila entera.
   ============================================================ */
begin;

/* ── 1) El renglón inicial, al crear la ficha ─────────────────────────── */
create or replace function public.personal_sueldo_inicial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.sueldo_base, 0) > 0 then
    insert into public.personal_sueldos
          (personal_id, sueldo_anterior, sueldo_nuevo, vigente_desde, motivo, tipo, actor, actor_name)
    values (new.id, 0, new.sueldo_base,
            coalesce(new.fecha_ingreso, current_date),
            'Sueldo con el que se creó la ficha.', 'inicial', new.created_by, null);
  end if;
  return new;
end $$;

drop trigger if exists trg_personal_sueldo_inicial on public.personal;
create trigger trg_personal_sueldo_inicial
  after insert on public.personal
  for each row execute function public.personal_sueldo_inicial();

/* ── 2) La guarda: no se pisa el sueldo por la puerta de atrás ────────── */
create or replace function public.personal_sueldo_guarda()
returns trigger
language plpgsql
as $$
begin
  if new.sueldo_base is distinct from old.sueldo_base
     and coalesce(current_setting('app.sueldo_autorizado', true), '') <> 'si' then
    raise exception
      'El sueldo no se cambia con un update: usá cambiar_sueldo_personal(), que exige el motivo y deja el historial. (de % a %)',
      old.sueldo_base, new.sueldo_base
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_personal_sueldo_guarda on public.personal;
create trigger trg_personal_sueldo_guarda
  before update on public.personal
  for each row execute function public.personal_sueldo_guarda();

/* ── 3) La única puerta: cambiar el sueldo con su motivo ──────────────── */
create or replace function public.cambiar_sueldo_personal(
  p_personal_id   uuid,
  p_sueldo_nuevo  numeric,
  p_motivo        text,
  p_tipo          text default null,
  p_vigente_desde date default null,
  p_actor         text default null,
  p_actor_name    text default null
)
returns public.personal
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior numeric;
  v_nuevo    numeric := round(coalesce(p_sueldo_nuevo, 0)::numeric, 2);
  v_motivo   text    := btrim(coalesce(p_motivo, ''));
  v_fila     public.personal;
begin
  if not public.is_operativo() then
    raise exception 'No tenés permiso para cambiar sueldos.' using errcode = 'insufficient_privilege';
  end if;
  if v_nuevo < 0 then
    raise exception 'El sueldo no puede ser negativo.' using errcode = 'check_violation';
  end if;

  /* El candado evita que dos personas cambien el mismo sueldo a la vez y que
     el historial termine diciendo que vino de un valor que ya no era. */
  select sueldo_base into v_anterior
    from public.personal where id = p_personal_id for update;
  if not found then
    raise exception 'No existe esa persona en el personal.';
  end if;
  v_anterior := round(coalesce(v_anterior, 0)::numeric, 2);

  /* Sin cambio no se escribe historial: guardar la ficha sin tocar el sueldo
     no es un cambio de sueldo. */
  if v_anterior = v_nuevo then
    select * into v_fila from public.personal where id = p_personal_id;
    return v_fila;
  end if;

  if length(v_motivo) < 4 then
    raise exception 'El sueldo cambió: hay que decir por qué. Escribí el motivo, queda en el historial.'
      using errcode = 'check_violation';
  end if;

  insert into public.personal_sueldos
        (personal_id, sueldo_anterior, sueldo_nuevo, vigente_desde, motivo, tipo, actor, actor_name)
  values (p_personal_id, v_anterior, v_nuevo,
          coalesce(p_vigente_desde, current_date),
          v_motivo, nullif(btrim(coalesce(p_tipo, '')), ''), p_actor, p_actor_name);

  /* La llave que abre la guarda del punto 2. Es LOCAL: vale solo dentro de
     esta transacción, así que ningún otro update se cuela con ella puesta. */
  perform set_config('app.sueldo_autorizado', 'si', true);
  update public.personal set sueldo_base = v_nuevo where id = p_personal_id
    returning * into v_fila;
  perform set_config('app.sueldo_autorizado', '', true);

  return v_fila;
end $$;

revoke all on function public.cambiar_sueldo_personal(uuid, numeric, text, text, date, text, text) from public, anon;
grant execute on function public.cambiar_sueldo_personal(uuid, numeric, text, text, date, text, text) to authenticated;

commit;

/* Prueba de la guarda: este update TIENE que fallar. */
do $$
declare v_id uuid; v_actual numeric;
begin
  select id, sueldo_base into v_id, v_actual from public.personal limit 1;
  if v_id is null then raise notice 'No hay personal para probar la guarda.'; return; end if;
  begin
    update public.personal set sueldo_base = coalesce(v_actual, 0) + 1 where id = v_id;
    raise exception 'LA GUARDA NO FUNCIONA: el update pasó sin motivo.';
  exception when check_violation then
    raise notice 'OK: la guarda rechazó el update directo del sueldo.';
  end;
end $$;

select count(*) as renglones from public.personal_sueldos;
