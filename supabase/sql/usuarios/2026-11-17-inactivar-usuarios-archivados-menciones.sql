-- Módulo: usuarios
-- Archivo: 2026-11-17-inactivar-usuarios-archivados-menciones.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- Propósito: Inactivar y archivar usuarios históricos desvinculados
--            (Erick Flores, Javier Leiva, Jose Liendro, Mariana Tovar, Teodoro Garcia)
--            en public.usuarios para garantizar que queden deshabilitados tanto en base
--            de datos como en las sugerencias y menciones (@) del chat de órdenes.

update public.usuarios
set estado = 'inactivo',
    archivado_en = coalesce(archivado_en, now()),
    updated_at = now()
where lower(trim(email)) in (
  'analista4mgg@gmail.com',
  'analista1mgg@gmail.com',
  'analistaadministrativobra@gmail.com',
  'analistadecomprasgt@gmail.com',
  'mariana.trabajo.gt@gmail.com',
  'marianatovar@gmail.com',
  'marianatovar1127@gmail.com',
  'admingometales@gmail.com'
) or lower(trim(concat(nombre, ' ', coalesce(apellido, '')))) in (
  'erick flores',
  'javier leiva',
  'jose liendro',
  'mariana tovar',
  'teodoro garcia'
);
