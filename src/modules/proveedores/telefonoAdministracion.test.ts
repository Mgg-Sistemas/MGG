import { describe, it, expect } from 'vitest';
import { limpiarTelefonoAdministracion, telefonoAdministracionValido } from './telefonoAdministracion';

describe('teléfono de administración del proveedor (14-10-2026)', () => {
  it('acepta formatos reales', () => {
    expect(telefonoAdministracionValido('0414-1234567')).toBe(true);
    expect(telefonoAdministracionValido('+58 412 123 45 67')).toBe(true);
    expect(telefonoAdministracionValido('(0286) 923.45.67')).toBe(true);
    expect(telefonoAdministracionValido('02869234567')).toBe(true);
  });
  it('rechaza vacío, letras y muy corto', () => {
    expect(telefonoAdministracionValido('')).toBe(false);
    expect(telefonoAdministracionValido('   ')).toBe(false);
    expect(telefonoAdministracionValido('ADM-1234567')).toBe(false);
    expect(telefonoAdministracionValido('123456')).toBe(false);
    expect(telefonoAdministracionValido(null)).toBe(false);
  });
  it('limpia espacios de sobra', () => {
    expect(limpiarTelefonoAdministracion('  0414   1234567 ')).toBe('0414 1234567');
    expect(limpiarTelefonoAdministracion('')).toBeNull();
  });
});
