-- ============================================================
-- 29/10/2026 · MGG · Corrección integral de permisos para autorizar órdenes y salidas
-- Permite que los administradores y usuarios autorizados guarden y aprueben
-- sin bloqueos por RLS, UUID vs Email o diferencias entre 'admin' y 'administrador'.
-- ============================================================

-- 1. Actualizar is_admin() para aceptar 'admin' y 'administrador'
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid()
      and lower(role) in ('admin', 'administrador')
      and estado = 'activo'
  )
  or lower(trim(coalesce(auth.jwt() ->> 'email', ''))) in (
    'admin@gmail.com',
    'mineralgroupguayanaca@gmail.com',
    'jhzgcontabilidad@gmail.com'
  );
$$;

grant execute on function public.is_admin() to authenticated, anon, service_role, public;

-- 2. Asegurar RLS en usuarios_autorizados para que el administrador pueda guardar
drop policy if exists "usuarios_autorizados read" on public.usuarios_autorizados;
create policy "usuarios_autorizados read" on public.usuarios_autorizados
  for select to authenticated using (true);

drop policy if exists "usuarios_autorizados write" on public.usuarios_autorizados;
create policy "usuarios_autorizados write" on public.usuarios_autorizados
  for all to authenticated
  using (
    (select public.is_admin())
    or (select public.puede_modulo('usuarios', 'escritura'))
    or (select public.puede_modulo('usuarios', 'full'))
  )
  with check (
    (select public.is_admin())
    or (select public.puede_modulo('usuarios', 'escritura'))
    or (select public.puede_modulo('usuarios', 'full'))
  );

grant select, insert, update, delete on public.usuarios_autorizados to authenticated;

-- 3. Sembrar usuarios autorizados iniciales con permisos completos
insert into public.usuarios_autorizados (email, aprobar_oc, aprobar_salidas, updated_by)
values
  ('admin@gmail.com', true, true, 'sistema'),
  ('jhzgcontabilidad@gmail.com', true, true, 'sistema'),
  ('mineralgroupguayanaca@gmail.com', true, true, 'sistema')
on conflict (email) do update set
  aprobar_oc = true,
  aprobar_salidas = true,
  updated_at = now();

-- 4. Actualizar puede_aprobar para verificar auth.jwt()->>'email' y tabla autorizados
create or replace function public.puede_aprobar(p_que text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_admin()
  or exists (
    select 1 from public.usuarios u
    join public.usuarios_autorizados a on a.email = lower(trim(u.email))
    where u.id = auth.uid() and u.estado = 'activo'
      and case p_que
        when 'oc' then a.aprobar_oc
        when 'salidas' then a.aprobar_salidas
        else false
      end
  )
  or exists (
    select 1 from public.usuarios_autorizados a
    where lower(trim(a.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      and case p_que
        when 'oc' then a.aprobar_oc
        when 'salidas' then a.aprobar_salidas
        else false
      end
  );
$$;

grant execute on function public.puede_aprobar(text) to authenticated, anon, service_role, public;

-- 5. Actualizar trigger salidas_solo_autorizados para usar email de JWT si usuarios no tiene fila
create or replace function public.salidas_solo_autorizados()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_email text;
begin
  if new.aprobada_por is not distinct from old.aprobada_por then return new; end if;
  if new.aprobada_por is null then return new; end if;
  if auth.uid() is null then return new; end if;

  select lower(email) into v_email from public.usuarios where id = auth.uid();
  if v_email is null then
    v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  end if;

  if not public.puede_aprobar('salidas') or lower(trim(new.aprobada_por)) <> coalesce(v_email, '') then
    raise exception 'Solo los usuarios autorizados para aprobar salidas (Usuarios > Roles y Permisos) pueden autorizar salidas y traslados.';
  end if;
  return new;
end;
$$;
