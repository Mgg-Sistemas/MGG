-- ============================================================
-- MGG & Golden Touch · Activación y Verificación de RLS en Todas las Tablas (30-10-2026)
-- Idempotente: se puede correr varias veces de forma segura en Supabase SQL Editor.
--
-- Objetivos:
-- 1. Habilitar RLS en absolutamente todas las tablas del esquema public.
-- 2. Revocar acceso anónimo (anon / public) en tablas del sistema.
-- 3. Otorgar permisos base a usuarios autenticados (authenticated) y service_role.
-- 4. Garantizar que ninguna tabla quede bloqueada (con RLS activo pero 0 políticas):
--    - Tablas de negocio: lectura para autenticados y escritura para personal operativo activo (is_operativo).
--    - Tablas históricas/respaldos (respaldo_*, _bkp_*, etc.): lectura para autenticados, sin escritura.
--    - webauthn_challenges: protegida intencionalmente sin políticas para clientes (solo service_role/Edge Functions).
-- ============================================================

begin;

-- ───────── 1. Verificación / actualización de funciones de seguridad ─────────
create or replace function public.is_operativo() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and estado = 'activo');
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and estado = 'activo');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and role = 'admin' and estado = 'activo');
$$;

revoke execute on function public.is_operativo() from anon, public;
grant  execute on function public.is_operativo() to authenticated, service_role;

revoke execute on function public.is_staff() from anon, public;
grant  execute on function public.is_staff() to authenticated, service_role;

revoke execute on function public.is_admin() from anon, public;
grant  execute on function public.is_admin() to authenticated, service_role;

-- ───────── 2. Habilitación de RLS y creación de políticas necesarias ─────────
do $$
declare
  r record;
  pol_count int;
  es_respaldo boolean;
begin
  for r in (
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  ) loop

    -- A. Habilitar RLS en la tabla
    execute format('alter table public.%I enable row level security', r.tablename);

    -- B. Permisos base de PostgreSQL
    execute format('revoke all on public.%I from anon, public', r.tablename);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tablename);
    execute format('grant all on public.%I to service_role', r.tablename);

    -- C. Evaluar si es tabla reservada / desafío criptográfico (webauthn)
    if r.tablename in ('webauthn_challenges') then
      -- Se deja intencionalmente cerrada para clientes directos
      continue;
    end if;

    -- D. Evaluar si es tabla de respaldo / histórica
    es_respaldo := (
      r.tablename ~ '(_respaldo|^respaldo_|^_bkp_|_2026_|_previas|_desactivados|_borrados|_unificad|_conteo_|_historico)'
      or r.tablename in (
        'fusiones_existencias_previas_2026_09',
        'almacenes_desactivados_2026_09',
        'proveedores_categorias_respaldo_2026_09_18',
        'almacenes_borrados_2026_09',
        'productos_hogar_repuntado_2026_09',
        'reclasificacion_general_2026_09',
        'duplicados_desactivados_2026_09',
        'fusiones_duplicados_2026_09',
        'unidades_unificadas_2026_09',
        'existencias_sembradas_2026_09',
        'prefijos_categoria_2026_09',
        'nombres_sellados_2026_09',
        'consolidacion_matanza_2026_09',
        'nombres_reparados_2026_09',
        'toallin_unificado_2026_09',
        'casiterita_detalle_respaldo_2026_09_16',
        'compras_moneda_corregida_2026_09',
        'cocina_doble_descuento_2026_09',
        'cocina_conteo_pinos_2026_09_21',
        'retenciones_esqueleto_2026_09'
      )
    );

    if es_respaldo then
      -- Tabla de respaldo: lectura para usuarios autenticados
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = r.tablename and cmd = 'SELECT'
      ) then
        execute format(
          'create policy %I on public.%I for select to authenticated using (true)',
          'respaldo_read_auth', r.tablename
        );
      end if;
      continue;
    end if;

    -- E. Tablas operativas: verificar que tengan políticas de lectura y escritura
    -- Si la tabla no tiene ninguna política de SELECT o ALL, agregarla
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = r.tablename and (cmd = 'SELECT' or cmd = 'ALL')
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using ((select auth.role()) = ''authenticated'')',
        r.tablename || '_read_auth', r.tablename
      );
    end if;

    -- Si la tabla no tiene ninguna política de modificación (ALL, INSERT o UPDATE), agregarla
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = r.tablename and (cmd in ('ALL', 'INSERT', 'UPDATE'))
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using ((select public.is_operativo())) with check ((select public.is_operativo()))',
        r.tablename || '_write_operativo', r.tablename
      );
    end if;

  end loop;
end $$;

commit;

-- ───────── 3. Verificación final de estado de RLS ─────────
select
  coalesce(string_agg(c.relname, ', ') filter (where not c.relrowsecurity), 'ninguna') as sin_rls,
  coalesce(string_agg(c.relname, ', ') filter (
    where c.relrowsecurity
      and c.relname <> 'webauthn_challenges'
      and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) = 0
  ), 'ninguna') as rls_sin_politicas,
  count(*) filter (where c.relrowsecurity) as tablas_con_rls_activo,
  count(*) as total_tablas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
