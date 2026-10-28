-- Actualizar usuarios_autorizados para usar email text primary key, con firma text (dataURL transparente)
-- igual que en Golden Touch.

-- Migrar tabla
drop table if exists public.usuarios_autorizados cascade;

create table public.usuarios_autorizados (
  email           text primary key,
  aprobar_oc      boolean not null default false,
  aprobar_salidas boolean not null default false,
  firma           text,
  firma_w         integer,
  firma_h         integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

create or replace function public.usuarios_autorizados_email_lower()
returns trigger language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;

drop trigger if exists trg_usuarios_autorizados_email_lower on public.usuarios_autorizados;
create trigger trg_usuarios_autorizados_email_lower before insert or update on public.usuarios_autorizados
  for each row execute function public.usuarios_autorizados_email_lower();

alter table public.usuarios_autorizados enable row level security;
drop policy if exists "usuarios_autorizados read" on public.usuarios_autorizados;
create policy "usuarios_autorizados read" on public.usuarios_autorizados
  for select to authenticated using (true);

drop policy if exists "usuarios_autorizados write" on public.usuarios_autorizados;
create policy "usuarios_autorizados write" on public.usuarios_autorizados
  for all to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('usuarios', 'full')))
  with check ((select public.is_admin()) or (select public.puede_modulo('usuarios', 'full')));

grant select, insert, update, delete on public.usuarios_autorizados to authenticated;

-- Inicializar con LEYDIS RENGEL y JESUS LOZADA como en la imagen
insert into public.usuarios_autorizados (email, aprobar_oc, aprobar_salidas, updated_by)
values
  ('jhzgcontabilidad@gmail.com', true, true, 'sistema'),
  ('mineralgroupguayanaca@gmail.com', true, true, 'sistema')
on conflict (email) do nothing;

-- Función helper: ¿puede aprobar? El admin siempre puede. Los demás si están en la tabla con la opción activa.
create or replace function public.puede_aprobar(p_que text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_admin() or exists (
    select 1 from public.usuarios u
    join public.usuarios_autorizados a on a.email = lower(trim(u.email))
    where u.id = auth.uid() and u.estado = 'activo'
      and case p_que
        when 'oc' then a.aprobar_oc
        when 'salidas' then a.aprobar_salidas
        else false
      end
  );
$$;
grant execute on function public.puede_aprobar(text) to authenticated, anon, service_role, public;

-- Trigger salidas
create or replace function public.salidas_solo_autorizados()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_email text;
begin
  if new.aprobada_por is not distinct from old.aprobada_por then return new; end if;
  if new.aprobada_por is null then return new; end if;
  if auth.uid() is null then return new; end if;

  select lower(email) into v_email from public.usuarios where id = auth.uid();
  if not public.puede_aprobar('salidas') or lower(new.aprobada_por) <> coalesce(v_email, '') then
    raise exception 'Solo los usuarios autorizados para aprobar salidas (Usuarios > Roles y Permisos) pueden autorizar salidas y traslados.';
  end if;
  return new;
end;
$$;

-- Trigger anular OC
create or replace function public.ordenes_anular_solo_gerente()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  if new.estado is not distinct from old.estado then return new; end if;
  if new.estado not in ('anulada', 'cancelada') then return new; end if;
  if old.estado not in ('confirmada_metodo', 'oc_aprobada', 'pagada', 'por_recibir', 'cuenta_abierta', 'oc_emitida') then return new; end if;
  if auth.uid() is null then return new; end if;
  select role into v_role from public.usuarios where id = auth.uid();
  if coalesce(v_role, '') = 'admin' or public.puede_aprobar('oc') then
    return new;
  end if;
  raise exception 'Esta OC ya fue aprobada: solo un usuario autorizado para aprobar órdenes de compra puede anularla o cancelarla.'
    using errcode = 'P0001';
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='usuarios_autorizados') then
    execute 'alter publication supabase_realtime add table public.usuarios_autorizados';
  end if;
end $$;
