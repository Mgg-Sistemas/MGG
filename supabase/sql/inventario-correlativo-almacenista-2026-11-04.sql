-- ============================================================
-- MGG · Inventario · teléfono · código y correlativo POR ALMACENISTA (04-11-2026)
--
-- Pedido de la administradora: «cada almacenista tenga su propio código de
-- salidas y traslados y su propio correlativo». Salidas SAT-ISNER-0001,
-- traslados TRA-ISNER-0001 (el nombre de quien la registra; sin nombre, el
-- inicio del correo). Las salidas viejas (SAT-0002…) conservan su número.
-- El contador vive en inv_tel_correlativos y solo lo toca la función.
-- Idempotente.
-- ============================================================
create table if not exists public.inv_tel_correlativos (
  actor text not null,
  tipo text not null check (tipo in ('salida', 'traslado')),
  ultimo integer not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (actor, tipo)
);
alter table public.inv_tel_correlativos enable row level security;
revoke all on public.inv_tel_correlativos from anon, authenticated, public;
grant all on public.inv_tel_correlativos to service_role;
drop policy if exists "inv_tel_correlativos read propio" on public.inv_tel_correlativos;
create policy "inv_tel_correlativos read propio" on public.inv_tel_correlativos for select to authenticated
  using (actor = (select lower(coalesce(auth.jwt()->>'email', ''))));

create or replace function public.inv_tel_reservar_codigo_usuario(p_tipo text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(nullif(auth.jwt()->>'email', ''), ''));
  v_nombre text;
  v_pref text;
  v_n integer;
begin
  if not public.inv_tel_puede_escribir() then
    raise exception 'No tienes permiso de escritura en Inventario.' using errcode = '42501';
  end if;
  if p_tipo not in ('salida', 'traslado') then raise exception 'Tipo inválido.' using errcode = '23514'; end if;
  if v_email = '' then raise exception 'Sin usuario.' using errcode = '42501'; end if;
  select nombre into v_nombre from public.usuarios where lower(email) = v_email limit 1;
  -- Primer nombre en mayúsculas, sin acentos ni símbolos; sin nombre, el inicio del correo.
  v_pref := upper(regexp_replace(translate(split_part(btrim(coalesce(v_nombre, '')), ' ', 1),
    'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^A-Za-z0-9]', '', 'g'));
  if v_pref = '' then v_pref := upper(left(regexp_replace(split_part(v_email, '@', 1), '[^A-Za-z0-9]', '', 'g'), 8)); end if;
  insert into public.inv_tel_correlativos (actor, tipo, ultimo) values (v_email, p_tipo, 1)
  on conflict (actor, tipo) do update set ultimo = public.inv_tel_correlativos.ultimo + 1, actualizado_en = now()
  returning ultimo into v_n;
  return (case when p_tipo = 'salida' then 'SAT-' else 'TRA-' end) || v_pref || '-' || lpad(v_n::text, 4, '0');
end $$;
revoke all on function public.inv_tel_reservar_codigo_usuario(text) from public, anon;
grant execute on function public.inv_tel_reservar_codigo_usuario(text) to authenticated;

select (select relrowsecurity from pg_class where oid = 'public.inv_tel_correlativos'::regclass) as rls,
       (select count(*) from pg_proc where proname = 'inv_tel_reservar_codigo_usuario') as fn;
