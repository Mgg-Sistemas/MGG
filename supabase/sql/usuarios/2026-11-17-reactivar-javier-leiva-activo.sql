-- ============================================================
-- Módulo: usuarios
-- Archivo: 2026-11-17-reactivar-javier-leiva-activo.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- Propósito: Reactivar a Javier Leiva (analista1mgg@gmail.com) como usuario activo
--            en MGG, asegurando que su estado sea 'activo', sin fecha de archivo
--            ni bloqueo, para que participe normalmente en las menciones del chat
--            y en las operaciones de Compras.
-- ============================================================

update public.usuarios
set estado = 'activo',
    archivado_en = null,
    archivado_por = null,
    bloqueado = false,
    updated_at = now()
where lower(trim(email)) in (
  'analista1mgg@gmail.com',
  'analistaadministrativobra@gmail.com'
) or lower(trim(concat(nombre, case when coalesce(apellido, '') <> '' then ' ' || apellido else '' end))) = 'javier leiva';
