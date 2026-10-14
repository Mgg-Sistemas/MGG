-- ============================================================
-- MGG · Seguridad de accesos (14-10-2026) · responde al informe del 13-10
-- de observaciones fuera del módulo de retenciones (puntos 1, 2, 3, 6, 8 y 10).
-- LO CORRE LA ADMINISTRADORA en el SQL editor (el MCP negó la migración).
-- Idempotente: se puede correr más de una vez. No borra datos de negocio.
-- ============================================================

-- ───────── 1. Las cuentas inactivas pierden el acceso ─────────
-- Las funciones de permiso exigen usuarios.estado = 'activo' (antes bastaba con existir en usuarios).
-- Con esto, una cuenta desactivada deja de leer y escribir aunque conserve una sesión abierta.
create or replace function public.is_operativo() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and estado = 'activo');
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and estado = 'activo');
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and role = 'admin' and estado = 'activo');
$$;

-- Permiso por módulo según la matriz de Roles y Permisos (admin siempre; «full» implica escritura).
create or replace function public.puede_modulo(p_modulo text, p_nivel text default 'escritura') returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.usuarios u
    left join public.roles_permisos r on r.role = u.role
    where u.id = auth.uid() and u.estado = 'activo'
      and (u.role = 'admin'
        or coalesce((r.permisos -> p_modulo ->> p_nivel)::boolean, false)
        or coalesce((r.permisos -> p_modulo ->> 'full')::boolean, false))
  );
$$;
revoke execute on function public.puede_modulo(text, text) from anon, public;
grant execute on function public.puede_modulo(text, text) to authenticated;

-- Para cerrar de inmediato las sesiones de las cuentas inactivas, la administradora las
-- bloquea desde el panel de Supabase → Authentication → Users (acción «Ban user» o
-- «Sign out user»). Con las funciones de arriba, aunque la sesión siga abierta, ya no accede.

-- ───────── 2. Bucket compras-oc ─────────
-- Leer y subir: cualquier usuario activo. Reemplazar y borrar: solo el administrador o quien subió el archivo.
drop policy if exists oc_obj_read on storage.objects;
create policy oc_obj_read on storage.objects for select using (bucket_id = 'compras-oc' and (select public.is_operativo()));
drop policy if exists oc_obj_insert on storage.objects;
create policy oc_obj_insert on storage.objects for insert with check (bucket_id = 'compras-oc' and (select public.is_operativo()));
drop policy if exists oc_obj_update on storage.objects;
create policy oc_obj_update on storage.objects for update
  using (bucket_id = 'compras-oc' and ((select public.is_admin()) or owner = auth.uid()))
  with check (bucket_id = 'compras-oc' and ((select public.is_admin()) or owner = auth.uid()));
drop policy if exists oc_obj_delete on storage.objects;
create policy oc_obj_delete on storage.objects for delete using (bucket_id = 'compras-oc' and ((select public.is_admin()) or owner = auth.uid()));

-- ───────── 3. Proveedores: escribe quien tiene el módulo ─────────
-- Insertar: Proveedores o Pedidos (el alta rápida desde una compra o servicio directo).
-- Editar y borrar: solo Proveedores. Leer: todos los registrados (como antes).
drop policy if exists "proveedores write staff" on public.proveedores;
drop policy if exists "proveedores insert modulo" on public.proveedores;
create policy "proveedores insert modulo" on public.proveedores for insert
  with check ((select public.puede_modulo('proveedores', 'escritura')) or (select public.puede_modulo('pedidos', 'escritura')));
drop policy if exists "proveedores update modulo" on public.proveedores;
create policy "proveedores update modulo" on public.proveedores for update
  using ((select public.puede_modulo('proveedores', 'escritura'))) with check ((select public.puede_modulo('proveedores', 'escritura')));
drop policy if exists "proveedores delete modulo" on public.proveedores;
create policy "proveedores delete modulo" on public.proveedores for delete using ((select public.puede_modulo('proveedores', 'escritura')));

-- ───────── 8. RIF único sin importar puntos, guiones o espacios ─────────
create unique index if not exists proveedores_rif_normalizado_unico
  on public.proveedores ((regexp_replace(upper(rif), '[^A-Z0-9]', '', 'g'))) where rif is not null and btrim(rif) <> '';

-- ───────── 10. Tabla esqueleto sin uso: queda solo de lectura ─────────
drop policy if exists "retenciones_esqueleto_2026_09 write op" on public.retenciones_esqueleto_2026_09;
drop policy if exists retenciones_write on public.retenciones_esqueleto_2026_09;
revoke insert, update, delete on public.retenciones_esqueleto_2026_09 from authenticated, anon;

-- ───────── 6. Auditoría reconoce las anulaciones de compras directas ─────────
-- La función de Auditoría busca el par anulada_por / anulada_en; la tabla guardaba anulada_at.
alter table public.compras_directas add column if not exists anulada_en timestamptz generated always as (anulada_at) stored;

-- Cotejo rápido después de correrlo:
-- select proname, pg_get_functiondef(oid) like '%estado = ''activo''%' as exige_activo from pg_proc where proname in ('is_operativo','is_staff','is_admin');
-- select policyname, cmd from pg_policies where tablename = 'proveedores';
-- select policyname, cmd from pg_policies where schemaname = 'storage' and policyname like 'oc_obj_%';
