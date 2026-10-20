-- MGG · Permisos del módulo Usuarios por la matriz de Roles y Permisos (17-10-2026)
--
-- Síntoma reportado por la administradora: roles con «full control» (p. ej. ANALISTA DE
-- SISTEMAS) no podían hacer nada en Usuarios. Causa: las políticas de usuarios,
-- roles_permisos, custom_roles y config eran solo para el rol admin; el front mostraba los
-- botones según la matriz y la base rechazaba todo en silencio. Además, un usuario que no
-- fuera admin solo leía su propia fila de usuarios, por lo que la lista salía vacía y el
-- resto del sistema mostraba correos en vez de nombres.
--
-- Regla nueva (la base obedece la matriz):
--   usuarios        leer: todo usuario activo (is_staff). escribir: admin, o Usuarios
--                   escritura/full, pero nunca sobre filas admin ni para poner rol admin.
--   roles_permisos  escribir: admin, o Usuarios full (salvo la fila del rol admin).
--   custom_roles    escribir: admin, o Usuarios full (salvo el rol admin).
--   config          escribir: admin, o escritura en Tesorería o en Pedidos.
-- Se revoca el acceso del rol anon a las cuatro tablas. Sin borrar datos.

begin;

-- usuarios ------------------------------------------------------------------
revoke all on public.usuarios from anon;
drop policy if exists "usuarios read staff" on public.usuarios;
create policy "usuarios read staff" on public.usuarios for select
  using ((select public.is_staff()));
drop policy if exists "usuarios escritura modulo" on public.usuarios;
create policy "usuarios escritura modulo" on public.usuarios for all
  using ((select public.is_admin())
         or ((select public.puede_modulo('usuarios','escritura')) and role is distinct from 'admin'))
  with check ((select public.is_admin())
         or ((select public.puede_modulo('usuarios','escritura')) and role is distinct from 'admin'));

-- roles_permisos ------------------------------------------------------------
revoke all on public.roles_permisos from anon;
drop policy if exists "roles_permisos_admin_write" on public.roles_permisos;
drop policy if exists "roles_permisos write modulo" on public.roles_permisos;
create policy "roles_permisos write modulo" on public.roles_permisos for all
  using ((select public.is_admin())
         or ((select public.puede_modulo('usuarios','full')) and role <> 'admin'))
  with check ((select public.is_admin())
         or ((select public.puede_modulo('usuarios','full')) and role <> 'admin'));

-- custom_roles --------------------------------------------------------------
revoke all on public.custom_roles from anon;
drop policy if exists "custom_roles_write_admin" on public.custom_roles;
drop policy if exists "custom_roles write modulo" on public.custom_roles;
create policy "custom_roles write modulo" on public.custom_roles for all
  using ((select public.is_admin())
         or ((select public.puede_modulo('usuarios','full')) and key <> 'admin'))
  with check ((select public.is_admin())
         or ((select public.puede_modulo('usuarios','full')) and key <> 'admin'));

-- config --------------------------------------------------------------------
revoke all on public.config from anon;
drop policy if exists "config write admin" on public.config;
drop policy if exists "config write modulo" on public.config;
create policy "config write modulo" on public.config for all
  using ((select public.is_admin())
         or (select public.puede_modulo('tesoreria','escritura'))
         or (select public.puede_modulo('pedidos','escritura')))
  with check ((select public.is_admin())
         or (select public.puede_modulo('tesoreria','escritura'))
         or (select public.puede_modulo('pedidos','escritura')));

commit;
