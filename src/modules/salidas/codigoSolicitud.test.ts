import { describe, it, expect } from 'vitest';
import { siguienteCodigo, prefijoCodigo } from './codigoSolicitud';

describe('código correlativo de salidas y traslados', () => {
  it('sigue al mayor usado aunque falte uno en el medio', () => {
    // Traslados: 0001, 0002, 0003, 0005, 0006 (se borró la 0004). Contando daba 0006.
    expect(siguienteCodigo('TRA', 2026, 'TRA-2026-0006')).toBe('TRA-2026-0007');
  });

  it('el primero del año arranca en 0001', () => {
    expect(siguienteCodigo('SAL', 2027, null)).toBe('SAL-2027-0001');
  });

  it('prefijo según el tipo de solicitud', () => {
    expect(prefijoCodigo('traslado')).toBe('TRA');
    expect(prefijoCodigo('salida')).toBe('SAL');
  });
});
