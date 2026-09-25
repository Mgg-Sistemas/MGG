-- ─────────────────────────────────────────────────────────────
-- Usuarios · Archivo de usuarios inactivos
--
-- Deshabilitar y archivar son dos pasos distintos: un usuario
-- deshabilitado sigue a la vista en la tabla de Usuarios (puede
-- ser algo temporal); archivarlo lo saca de esa lista y lo guarda
-- en su propio apartado («🗂 Archivados»), donde se puede buscar,
-- desarchivar (vuelve deshabilitado) o habilitar (vuelve con
-- acceso y se desarchiva solo).
--
-- Archivado = archivado_en con fecha; null = visible en la lista.
-- Solo se archivan usuarios con estado 'inactivo' (lo exige el
-- front con .eq('estado','inactivo') en el UPDATE). No borra nada
-- y es 100% reversible.
-- ─────────────────────────────────────────────────────────────

alter table public.usuarios
  add column if not exists archivado_en  timestamptz,
  add column if not exists archivado_por text;

comment on column public.usuarios.archivado_en is
  'Archivado: fecha en que salió de la lista principal de Usuarios (null = visible). Solo se archivan deshabilitados; habilitar desarchiva.';
comment on column public.usuarios.archivado_por is
  'Correo de quien archivó al usuario.';
