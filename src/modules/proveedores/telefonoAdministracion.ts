/* ============================================================
   MGG · Proveedores · Teléfono de administración del proveedor (14-10-2026)
   Es un teléfono (no un número de control): se valida con lo mínimo para no
   rechazar formatos reales de Venezuela y del exterior: al menos 7 dígitos y
   solo dígitos, +, espacios, guiones, puntos y paréntesis.
   ============================================================ */

export function telefonoAdministracionValido(valor: string | null | undefined): boolean {
  const v = (valor ?? '').trim();
  if (!v) return false;
  if (!/^\+?[\d\s().-]+$/.test(v)) return false;
  return (v.match(/\d/g) ?? []).length >= 7;
}

/** Deja el teléfono como se escribió, sin espacios de sobra. */
export function limpiarTelefonoAdministracion(valor: string | null | undefined): string | null {
  const v = (valor ?? '').trim().replace(/\s+/g, ' ');
  return v || null;
}
