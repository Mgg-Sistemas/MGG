-- ============================================================
-- Módulo: usuarios / auth
-- Archivo: 2026-11-25-webauthn-aislamiento-usuarios.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- Corrección de aislamiento de credenciales biométricas (WebAuthn).
-- Evita que la consulta masiva de RLS permita a un usuario ver
-- o eliminar los dispositivos biométricos de otros usuarios.
-- ============================================================

-- 1. Habilitar RLS estricto en webauthn_credentials
alter table public.webauthn_credentials enable row level security;

-- 2. Eliminar políticas genéricas que permitían lectura/escritura a cualquier autenticado
drop policy if exists "webauthn_credentials_read_auth" on public.webauthn_credentials;
drop policy if exists "webauthn_credentials_write_operativo" on public.webauthn_credentials;
drop policy if exists "webauthn_cred owner read" on public.webauthn_credentials;
drop policy if exists "webauthn_cred owner delete" on public.webauthn_credentials;

-- 3. Crear políticas exclusivas por dueño de la credencial (auth.uid() = user_id)
create policy "webauthn_cred owner read" on public.webauthn_credentials
  for select to authenticated using (auth.uid() = user_id);

create policy "webauthn_cred owner delete" on public.webauthn_credentials
  for delete to authenticated using (auth.uid() = user_id);

-- Nota: La inserción y actualización de credenciales se realiza únicamente
-- a través de la Edge Function 'webauthn' utilizando service_role.
