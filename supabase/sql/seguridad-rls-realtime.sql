/* Seguridad y realtime (18-09-2026).
   - RLS: todas las tablas de public ya lo tienen. Los respaldos *_2026_09 y webauthn_challenges quedan
     SIN políticas a propósito (solo service_role / Edge Function webauthn).
   - Funciones SECURITY DEFINER: nadie sin sesión (anon) puede ejecutarlas por /rest/v1/rpc; quedan para
     authenticated y service_role. Los triggers no dependen de este permiso.
   - search_path fijo en las funciones que lo tenían mutable.
   - Realtime: categorias_gasto y recepcion_procedencias las escucha la app pero no estaban publicadas.
     user_sessions y tasa_snapshot siguen FUERA a propósito (tablas calientes). */
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;

  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_updated_at', 'renombrar_categoria_proveedor', '_acopio_sync_producto', '_trg_sync_martillos', '_trg_martillo_gasto')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;

  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categorias_gasto') then
    alter publication supabase_realtime add table public.categorias_gasto;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recepcion_procedencias') then
    alter publication supabase_realtime add table public.recepcion_procedencias;
  end if;
end $$;

select json_build_object(
  'tablas_sin_rls', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'definer_ejecutables_por_anon', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')),
  'definer_ejecutables_por_authenticated', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')),
  'publicadas', (select count(*) from pg_publication_tables where pubname = 'supabase_realtime'),
  'nuevas_en_realtime', (select json_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('categorias_gasto', 'recepcion_procedencias'))
);
