-- ============================================================
-- MGG · Permiso de Respaldo por Matriz de Roles (30-10-2026)
--
-- El respaldo de la base de datos se gobierna por la matriz de permisos
-- (clave 'respaldo' en roles_permisos.permisos), sin tocar el rol admin:
--   1. El rol 'admin' sigue siendo superusuario incondicional (is_admin()).
--   2. Los demás roles (ej. Analista de Sistemas) pueden respaldar si tienen
--      marcada la casilla de Respaldo en Usuarios → Roles y Permiso.
--   3. Se permite a los usuarios autorizados asentar la fecha en public.config
--      ('backup.ultimo') para que el chequeo de caducidad funcione sin error RLS,
--      acotado estrictamente a esa clave por principio de menor privilegio.
-- ============================================================

begin;

-- 1. Actualización de dump_database_sql(): admin incondicional o permiso 'respaldo'
create or replace function public.dump_database_sql()
returns text
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $func$
declare
  t record;
  piece text;
  out text := '';
begin
  if current_user <> 'postgres' and not exists (
    select 1 from public.usuarios u
    where u.id = auth.uid() and u.estado = 'activo'
      and (u.role = 'admin' or public.puede_modulo('respaldo', 'lectura'))
  ) then
    raise exception 'Solo un administrador o usuario autorizado puede generar el respaldo de datos.';
  end if;

  out := '-- MGG-Inventario · Respaldo de DATOS · ' || now()::text || chr(10)
       || '-- Restaurar sobre el esquema base (supabase/schema.sql).' || chr(10) || chr(10);
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  loop
    out := out || '-- ===== ' || t.table_name || ' =====' || chr(10);
    execute format($q$
      select coalesce(string_agg(
        'INSERT INTO public.%1$I (' ||
        (select string_agg(quote_ident(key), ', ' order by key) from jsonb_each(to_jsonb(x))) ||
        ') VALUES (' ||
        (select string_agg(
           case
             when value is null or jsonb_typeof(value) = 'null' then 'NULL'
             when jsonb_typeof(value) in ('number','boolean')   then value #>> '{}'
             when jsonb_typeof(value) in ('object','array')      then quote_literal(value::text) || '::jsonb'
             else quote_literal(value #>> '{}')
           end, ', ' order by key) from jsonb_each(to_jsonb(x))) ||
        ') ON CONFLICT DO NOTHING;', chr(10)), '')
      from public.%1$I x
    $q$, t.table_name) into piece;
    out := out || piece || chr(10) || chr(10);
  end loop;
  return out;
end;
$func$;

revoke all on function public.dump_database_sql() from public, anon;
grant execute on function public.dump_database_sql() to authenticated;

-- 2. Permiso para asentar fecha de último respaldo en public.config
drop policy if exists "config write modulo" on public.config;
create policy "config write modulo" on public.config for all
  using ((select public.is_admin())
         or (select public.puede_modulo('tesoreria','escritura'))
         or (select public.puede_modulo('pedidos','escritura'))
         or ((select public.puede_modulo('respaldo','lectura')) and key = 'backup.ultimo'))
  with check ((select public.is_admin())
         or (select public.puede_modulo('tesoreria','escritura'))
         or (select public.puede_modulo('pedidos','escritura'))
         or ((select public.puede_modulo('respaldo','lectura')) and key = 'backup.ultimo'));

commit;
