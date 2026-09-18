/* Ventas (18-09-2026): autorización previa. Solo Leydis Rengel y Jesús Lozada
   autorizan (misma regla que Salidas/Traslados).
   Flujo: borrador → por_aprobar → aprobada → emitida → pagada · anulada. */
alter table public.ventas
  add column if not exists enviada_por text,
  add column if not exists enviada_en timestamptz,
  add column if not exists aprobada_por text,
  add column if not exists aprobada_en timestamptz;

alter table public.ventas drop constraint if exists ventas_estado_check;
alter table public.ventas add constraint ventas_estado_check
  check (estado in ('borrador','por_aprobar','aprobada','emitida','pagada','anulada'));

create or replace function public.ventas_solo_autorizados()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_email text;
begin
  -- Mantenimiento (sin usuario de la app): no se bloquea.
  if auth.uid() is null then return new; end if;
  select lower(email) into v_email from public.usuarios where id = auth.uid();

  -- Quién autoriza: solo ellos dos, y a su propio nombre.
  if new.aprobada_por is distinct from old.aprobada_por and new.aprobada_por is not null then
    if coalesce(v_email, '') not in ('jhzgcontabilidad@gmail.com', 'mineralgroupguayanaca@gmail.com')
       or lower(new.aprobada_por) <> coalesce(v_email, '') then
      raise exception 'Solo Leydis Rengel o Jesús Lozada pueden autorizar ventas.';
    end if;
  end if;

  -- No se emite (ni se cobra) una venta que no fue autorizada.
  if new.estado in ('emitida', 'pagada') and old.estado in ('borrador', 'por_aprobar') then
    raise exception 'La venta necesita la autorización de Leydis Rengel o Jesús Lozada antes de emitirse.';
  end if;
  if new.estado = 'aprobada' and new.aprobada_por is null then
    raise exception 'Una venta autorizada tiene que decir quién la autorizó.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ventas_solo_autorizados on public.ventas;
create trigger trg_ventas_solo_autorizados
  before update on public.ventas
  for each row execute function public.ventas_solo_autorizados();

-- Tampoco se crea una venta ya autorizada o emitida saltándose el paso.
create or replace function public.ventas_nace_en_borrador()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and new.estado <> 'borrador' then
    raise exception 'Una venta nueva nace en borrador y pasa por autorización.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ventas_nace_en_borrador on public.ventas;
create trigger trg_ventas_nace_en_borrador
  before insert on public.ventas
  for each row execute function public.ventas_nace_en_borrador();
