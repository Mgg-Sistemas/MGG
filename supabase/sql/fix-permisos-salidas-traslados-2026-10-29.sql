-- ============================================================
-- 29/10/2026 · MGG · Corrección de permisos para aprobar salidas y traslados
-- Asegura que usuarios en public.usuarios_autorizados y admins puedan aprobar
-- tanto por public.usuarios como por auth.jwt()->>'email'.
-- ============================================================

-- 1. Actualizar puede_aprobar para verificar auth.jwt()->>'email'
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

-- 2. Actualizar trigger salidas_solo_autorizados para usar email de JWT si usuarios no tiene fila
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
