-- ============================================================
-- MGG · Auditoría de Usuarios por la MATRIZ de permisos (11-11-2026)
--
-- La administradora daba el módulo «Auditoría de Usuarios» desde la matriz de
-- Roles y Permisos y no lo tomaba: el menú y la página sí lo respetaban, pero la
-- consulta de actividad (RPC auditoria_actividad) solo dejaba pasar al rol
-- 'admin' y fallaba con «Solo administradores pueden consultar la auditoría».
-- Ahora decide la matriz (puede_modulo: admin, o el permiso de lectura/full del
-- módulo 'auditoria' en su rol, con el usuario activo).
-- ============================================================
do $$
declare v_def text; v_viejo text;
begin
  select pg_get_functiondef('public.auditoria_actividad'::regproc) into v_def;
  v_viejo := 'if not exists (select 1 from public.usuarios where id = auth.uid() and role = ''admin'') then';
  if position(v_viejo in v_def) > 0 then
    v_def := replace(v_def, v_viejo, 'if not public.puede_modulo(''auditoria'', ''lectura'') then');
    v_def := replace(v_def, 'Solo administradores pueden consultar la auditoría', 'No tienes permiso para consultar la auditoría (Roles y Permisos → Auditoría de Usuarios)');
    execute v_def;
  elsif position('puede_modulo(''auditoria''' in v_def) = 0 then
    raise exception 'auditoria_actividad: no se encontró el guard de admin';
  end if;
end $$;

select position('puede_modulo(''auditoria''' in pg_get_functiondef('public.auditoria_actividad'::regproc)) > 0 as por_matriz;
