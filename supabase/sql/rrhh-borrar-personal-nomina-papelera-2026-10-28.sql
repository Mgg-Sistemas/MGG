-- ============================================================
-- RRHH · borrar una persona que tiene renglones en una nómina en la papelera (28-10-2026)
--
-- Al eliminar una ficha de `personal`, la FK de `nomina_renglones.personal_id`
-- (ON DELETE SET NULL) hace un UPDATE del renglón. La guardia `nomina_renglon_guard`
-- rechazaba ese UPDATE cuando la nómina está en la papelera o pagada, así que el
-- front decía «No se pudo eliminar» (FELIPE ALGUERA, ficha 034, con un renglón en
-- NOM-2026-0002 que está en la papelera).
--
-- Regla: el ÚNICO cambio que se deja pasar en esos casos es el que hace la base
-- al borrar a la persona: `personal_id` pasa a NULL y nada más cambia. El renglón
-- conserva sus montos y el nombre guardado; la nómina sigue intocable.
-- ============================================================
create or replace function public.nomina_renglon_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_per record;
  v_pid uuid := coalesce(new.periodo_id, old.periodo_id);
  v_solo_baja_persona boolean;
begin
  select id, codigo, estado, eliminado_en into v_per
    from public.nomina_periodos where id = v_pid;

  -- Si el período ya no está (borrado en cascada), no hay nada que proteger.
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if v_per.estado = 'pagada' then
      raise exception 'La nómina % está cerrada (pagada en su totalidad): no se le agregan renglones.', v_per.codigo
        using errcode = 'check_violation';
    end if;
    if v_per.eliminado_en is not null then
      raise exception 'La nómina % está en la papelera: recuperala antes de agregarle renglones.', v_per.codigo
        using errcode = 'check_violation';
    end if;
    new.eliminado_en := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Baja definitiva de la persona (FK ON DELETE SET NULL): solo cambia personal_id → null.
    v_solo_baja_persona := new.personal_id is null and old.personal_id is not null
      and (to_jsonb(new) - 'personal_id') = (to_jsonb(old) - 'personal_id');
    if v_solo_baja_persona then
      return new;
    end if;
    if v_per.estado = 'pagada' and coalesce(current_setting('nomina.bypass_cerrada', true), '') <> '1' then
      raise exception 'La nómina % está cerrada (pagada en su totalidad): sus renglones no se modifican.', v_per.codigo
        using errcode = 'check_violation';
    end if;
    -- El único cambio permitido mientras está en la papelera es el espejo de eliminado_en.
    if v_per.eliminado_en is not null
       and (to_jsonb(new) - 'eliminado_en') <> (to_jsonb(old) - 'eliminado_en') then
      raise exception 'La nómina % está en la papelera: no se pueden pagar ni modificar sus renglones.', v_per.codigo
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_per.estado = 'pagada' then
      raise exception 'La nómina % está cerrada (pagada en su totalidad): sus renglones no se borran.', v_per.codigo
        using errcode = 'check_violation';
    end if;
    if not public.nomina_puede_administrar() then
      raise exception 'Los renglones no se borran sueltos: eliminá la nómina completa (va a la papelera).'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  return null;
end;
$function$;

-- Ensayo (se revierte): borrar la ficha 034 ya no choca con la guardia.
begin;
delete from public.personal where id = '2c4d9cb1-2634-4aa6-81a1-41e3c4bd746b';
select 'ensayo ok: la ficha se puede borrar' as resultado;
rollback;
