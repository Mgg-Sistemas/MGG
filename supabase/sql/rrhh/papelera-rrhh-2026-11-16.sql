-- ============================================================
-- Módulo: rrhh
-- Archivo: papelera-rrhh-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

create or replace function public.puede_vaciar_papelera(p_modulo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios u
    left join public.roles_permisos r on r.role = u.role
    where u.id = auth.uid() and u.estado = 'activo'
      and (u.role = 'admin' or (
        r.permisos -> p_modulo -> 'vaciar_papelera' = 'true'::jsonb
        and (r.permisos -> p_modulo -> 'escritura' = 'true'::jsonb
          or r.permisos -> p_modulo -> 'full' = 'true'::jsonb)
      ))
  );
$$;

revoke execute on function public.puede_vaciar_papelera(text) from public, anon;
grant execute on function public.puede_vaciar_papelera(text) to authenticated;

-- Conserva el flujo que limpia un período activo incompleto durante la carga.
-- La guardia existente sigue evaluando las nóminas activas y pagadas.
drop policy if exists nomina_vaciado_autorizado on public.nomina_periodos;
create policy nomina_vaciado_autorizado on public.nomina_periodos
  as restrictive for delete to authenticated
  using (eliminado_en is null or (select public.puede_vaciar_papelera('rrhh')));

create or replace function public.nomina_vaciar_papelera(p_empresa text, p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cantidad integer;
begin
  if not public.puede_vaciar_papelera('rrhh') then
    raise exception 'Falta el permiso Vaciar papelera en Recursos Humanos' using errcode = '42501';
  end if;

  delete from public.nomina_periodos p
   where p.empresa = p_empresa and p.id = any(p_ids) and p.eliminado_en is not null
     and p.estado <> 'pagada'
     and not exists (select 1 from public.nomina_renglones r where r.periodo_id = p.id and r.estado = 'pagada');
  get diagnostics cantidad = row_count;
  return cantidad;
end;
$$;

revoke execute on function public.nomina_vaciar_papelera(text, uuid[]) from public, anon;
grant execute on function public.nomina_vaciar_papelera(text, uuid[]) to authenticated;

commit;
