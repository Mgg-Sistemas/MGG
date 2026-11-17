-- ============================================================
-- Módulo: usuarios
-- Archivo: 2026-11-17-reactivar-javier-leiva-activo.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- Propósito: Garantizar que Javier Leiva (analista1mgg@gmail.com)
--            conserve estado 'activo' en public.usuarios sin depender de
--            columnas opcionales como 'bloqueado'.
-- ============================================================

update public.usuarios
set estado = 'activo'
where lower(trim(email)) in (
  'analista1mgg@gmail.com',
  'analistaadministrativobra@gmail.com'
) or lower(trim(nombre)) like '%javier leiva%';
