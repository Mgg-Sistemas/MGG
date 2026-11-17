-- Módulo: usuarios
-- Archivo: 2026-11-17-inactivar-usuarios-archivados-menciones.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- Propósito: Garantizar existencia de columnas de archivo y estado inactivo,
--            e inactivar y archivar usuarios históricos desvinculados
--            (Erick Flores, Jose Liendro, Mariana Tovar, Teodoro Garcia)
--            en public.usuarios para garantizar que queden deshabilitados tanto en base
--            de datos como en las sugerencias y menciones (@) del chat de órdenes.

-- 1. Garantizar columnas de archivo en public.usuarios si aún no existen
alter table public.usuarios add column if not exists apellido text;
alter table public.usuarios add column if not exists archivado_en timestamptz;
alter table public.usuarios add column if not exists archivado_por text;
alter table public.usuarios add column if not exists bloqueado boolean default false;

-- 2. Inactivar y marcar fecha de archivo para los usuarios históricos (Javier Leiva es activo en MGG)
update public.usuarios
set estado = 'inactivo',
    archivado_en = coalesce(archivado_en, now()),
    updated_at = now()
where lower(trim(email)) in (
  'analista4mgg@gmail.com',
  'analistadecomprasgt@gmail.com',
  'mariana.trabajo.gt@gmail.com',
  'marianatovar@gmail.com',
  'marianatovar1127@gmail.com',
  'admingometales@gmail.com'
) or lower(trim(concat(nombre, case when coalesce(apellido, '') <> '' then ' ' || apellido else '' end))) in (
  'erick flores',
  'jose liendro',
  'mariana tovar',
  'teodoro garcia'
);
