-- ============================================================
-- MGG · Una sola recepción por orden de compra (11-11-2026)
--
-- OC-2026-0182 (SP-2026-0180-1) la recibieron dos personas: CARLOS a las
-- 08:37 y NAZARET a las 09:17. La pantalla de la segunda seguía mostrando la
-- orden pendiente y la recepción confiaba en esa copia vieja: las 14 entradas
-- de inventario se cargaron dos veces.
--
-- El front ahora aparta la orden en la base ANTES de mover stock (update
-- condicional `recibida_en is null`). Esto es el respaldo en la base, para
-- cualquier pantalla vieja o camino que se salte ese paso:
--   1) La fecha de recepción de una orden no se puede pisar con otra.
--   2) No entra al inventario una recepción de una orden que ya recibió otra
--      persona, o que se recibió hace más de 15 minutos.
-- ============================================================

create or replace function public.guard_orden_recibida_una_vez()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.recibida_en is not null and new.recibida_en is not null
     and new.recibida_en is distinct from old.recibida_en then
    raise exception 'Esta orden YA fue recibida por % el %. No se puede recibir dos veces.',
      coalesce(old.recibida_por, 'otro usuario'),
      to_char(old.recibida_en at time zone 'America/Caracas', 'DD-MM-YYYY HH12:MI AM');
  end if;
  return new;
end $$;

drop trigger if exists trg_orden_recibida_una_vez on public.ordenes;
create trigger trg_orden_recibida_una_vez
  before update of recibida_en on public.ordenes
  for each row execute function public.guard_orden_recibida_una_vez();

create or replace function public.guard_movimientos_recepcion_unica()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_en timestamptz; v_por text; v_otro text;
begin
  if new.tipo <> 'entrada' or coalesce(new.ref_tipo, '') <> 'orden' or new.ref_id is null then
    return new;
  end if;
  select o.recibida_en, o.recibida_por into v_en, v_por
    from public.ordenes o where o.id::text = new.ref_id::text;
  -- Otra persona ya cargó al inventario esta misma orden.
  select coalesce(m.actor_name, m.actor) into v_otro
    from public.movimientos m
   where m.ref_tipo = 'orden' and m.tipo = 'entrada' and m.ref_id = new.ref_id
     and m.actor is distinct from new.actor
   limit 1;
  if v_otro is not null then
    raise exception 'Esta orden YA fue recibida por %. No se volvió a cargar al inventario.', v_otro;
  end if;
  -- La orden ya figura recibida por otra persona, o hace rato (pantalla vieja).
  if v_en is not null and (v_por is distinct from new.actor or v_en < now() - interval '15 minutes') then
    raise exception 'Esta orden YA fue recibida por % el %. No se volvió a cargar al inventario.',
      coalesce(v_por, 'otro usuario'),
      to_char(v_en at time zone 'America/Caracas', 'DD-MM-YYYY HH12:MI AM');
  end if;
  return new;
end $$;

revoke all on function public.guard_movimientos_recepcion_unica() from public, anon;

drop trigger if exists trg_movimientos_recepcion_unica on public.movimientos;
create trigger trg_movimientos_recepcion_unica
  before insert on public.movimientos
  for each row execute function public.guard_movimientos_recepcion_unica();

select tgname from pg_trigger where tgname in ('trg_orden_recibida_una_vez', 'trg_movimientos_recepcion_unica');
