-- ============================================================
-- MGG · Pantallas de teléfono por rol (13-10-2026, traído de Golden Touch)
--
-- Cada pantalla de teléfono (surtidor, comidas) se da POR ROL en
-- Usuarios → Roles y Permisos, aparte del permiso del módulo. Se guarda como
-- lista en roles_permisos.vistas_telefono. La marca «solo teléfono» sigue en
-- custom_roles.solo_telefono.
--
-- YA APLICADO el 13-10-2026 (columna + semilla). Queda aquí como registro;
-- es idempotente.
-- ============================================================
alter table public.roles_permisos
  add column if not exists vistas_telefono jsonb not null default '[]'::jsonb;

comment on column public.roles_permisos.vistas_telefono is
  'Pantallas de teléfono dadas al rol: ["surtidor","comidas"]. Abrirlas exige además lectura en su módulo.';

-- Semilla: los dos roles de teléfono que ya existían conservan su pantalla.
update public.roles_permisos
   set vistas_telefono = '["surtidor"]'::jsonb, updated_at = now(), updated_by = 'sistema · pantallas de teléfono 13-10-2026'
 where role = 'combustible' and vistas_telefono = '[]'::jsonb;
update public.roles_permisos
   set vistas_telefono = '["comidas"]'::jsonb, updated_at = now(), updated_by = 'sistema · pantallas de teléfono 13-10-2026'
 where role = 'cocina' and vistas_telefono = '[]'::jsonb;

-- Cotejo
select role, vistas_telefono from public.roles_permisos where vistas_telefono <> '[]'::jsonb order by role;
