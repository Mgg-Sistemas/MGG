/* Usuarios autorizados para aprobar (28-10-2026).

   Quién aprueba Órdenes de Compra y Órdenes de Salida deja de estar escrito en el
   código (Leydis Rengel / Jesús Lozada / admin) y pasa a una lista que se maneja en
   Usuarios > Roles y Permisos > «Usuarios autorizados para:». Cada usuario de la lista
   puede tener: Aprobar órdenes de compra, Aprobar salidas, o ambas. Además se le carga
   su firma escaneada, que se estampa en las órdenes que apruebe.

   Lo ya aprobado NO se toca: `aprobada_por` / `oc_aprobada_por` quedan como están.
   La lista arranca con quienes aprueban hoy, así nada cambia el día del despliegue:
     · OC:      Leydis Rengel + los administradores (como hasta ahora).
     · Salidas: Leydis Rengel + Jesús Lozada (como hasta ahora). */

create table if not exists public.usuarios_autorizados (
  usuario_id      uuid primary key references public.usuarios(id) on delete cascade,
  aprobar_oc      boolean not null default false,
  aprobar_salidas boolean not null default false,
  firma_path      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

alter table public.usuarios_autorizados enable row level security;

drop policy if exists "usuarios_autorizados read" on public.usuarios_autorizados;
create policy "usuarios_autorizados read" on public.usuarios_autorizados
  for select to authenticated using (true);

drop policy if exists "usuarios_autorizados write" on public.usuarios_autorizados;
create policy "usuarios_autorizados write" on public.usuarios_autorizados
  for all to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('usuarios', 'full')))
  with check ((select public.is_admin()) or (select public.puede_modulo('usuarios', 'full')));

/* ¿El usuario de la sesión puede aprobar? p_que: 'oc' | 'salidas'. */
create or replace function public.puede_aprobar(p_que text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.usuarios_autorizados a
    join public.usuarios u on u.id = a.usuario_id
    where a.usuario_id = auth.uid() and u.estado = 'activo'
      and case p_que when 'oc' then a.aprobar_oc when 'salidas' then a.aprobar_salidas else false end
  );
$$;
grant execute on function public.puede_aprobar(text) to authenticated;

-- Semilla: quienes aprueban hoy.
insert into public.usuarios_autorizados (usuario_id, aprobar_oc, aprobar_salidas, updated_by)
select u.id,
       (lower(u.email) = 'jhzgcontabilidad@gmail.com' or u.role = 'admin'),
       lower(u.email) in ('jhzgcontabilidad@gmail.com', 'mineralgroupguayanaca@gmail.com'),
       'migracion-2026-10-28'
from public.usuarios u
where lower(u.email) in ('jhzgcontabilidad@gmail.com', 'mineralgroupguayanaca@gmail.com') or u.role = 'admin'
on conflict (usuario_id) do nothing;

/* Salidas y traslados: aprueba quien esté autorizado en la lista, a su propio nombre. */
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

/* OC ya confirmada: la anula o cancela un administrador o quien esté autorizado a aprobar OC. */
create or replace function public.ordenes_anular_solo_gerente()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  if new.estado is not distinct from old.estado then return new; end if;
  if new.estado not in ('anulada', 'cancelada') then return new; end if;
  if old.estado not in ('confirmada_metodo', 'oc_aprobada', 'pagada', 'por_recibir', 'cuenta_abierta', 'oc_emitida') then return new; end if;
  if auth.uid() is null then return new; end if; -- mantenimiento
  select role into v_role from public.usuarios where id = auth.uid();
  if coalesce(v_role, '') = 'admin' or public.puede_aprobar('oc') then
    return new;
  end if;
  raise exception 'Esta OC ya fue aprobada: solo un usuario autorizado para aprobar órdenes de compra puede anularla o cancelarla.'
    using errcode = 'P0001';
end $$;

/* Firmas escaneadas de los autorizados (bucket privado). */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('firmas-usuarios', 'firmas-usuarios', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "firmas-usuarios read" on storage.objects;
create policy "firmas-usuarios read" on storage.objects
  for select to authenticated using (bucket_id = 'firmas-usuarios');

drop policy if exists "firmas-usuarios write" on storage.objects;
create policy "firmas-usuarios write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'firmas-usuarios' and ((select public.is_admin()) or (select public.puede_modulo('usuarios', 'full'))));

drop policy if exists "firmas-usuarios update" on storage.objects;
create policy "firmas-usuarios update" on storage.objects
  for update to authenticated
  using (bucket_id = 'firmas-usuarios' and ((select public.is_admin()) or (select public.puede_modulo('usuarios', 'full'))));

drop policy if exists "firmas-usuarios delete" on storage.objects;
create policy "firmas-usuarios delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'firmas-usuarios' and ((select public.is_admin()) or (select public.puede_modulo('usuarios', 'full'))));

-- Tiempo real para que el panel y los permisos se refresquen solos.
do $$ begin
  alter publication supabase_realtime add table public.usuarios_autorizados;
exception when duplicate_object then null; end $$;

select u.email, a.aprobar_oc, a.aprobar_salidas
from public.usuarios_autorizados a join public.usuarios u on u.id = a.usuario_id;
