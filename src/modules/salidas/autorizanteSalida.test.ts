import { describe, it, expect } from 'vitest';
import { autorizanteDe, puedeAutorizarSalidas, NOMBRE_FIRMA } from './autorizanteSalida';

describe('quién autoriza salidas y traslados', () => {
  it('solo Leydis Rengel y Jesús Lozada pueden autorizar', () => {
    expect(puedeAutorizarSalidas('jhzgcontabilidad@gmail.com')).toBe(true);
    expect(puedeAutorizarSalidas('mineralgroupguayanaca@gmail.com')).toBe(true);
    expect(puedeAutorizarSalidas('almacenmatanzas2026@gmail.com')).toBe(false);
    expect(puedeAutorizarSalidas('admin@gmail.com')).toBe(false);
    expect(puedeAutorizarSalidas(null)).toBe(false);
  });

  it('el correo se reconoce sin importar mayúsculas ni espacios', () => {
    expect(puedeAutorizarSalidas('  JHZGContabilidad@Gmail.com ')).toBe(true);
  });

  it('cuando autorizó Leydis, va su nombre y su firma escaneada', () => {
    expect(autorizanteDe('jhzgcontabilidad@gmail.com'))
      .toEqual({ nombre: NOMBRE_FIRMA, firma: true, pendiente: false });
  });

  it('cuando autorizó Jesús, va su nombre sin la firma de Leydis', () => {
    expect(autorizanteDe('mineralgroupguayanaca@gmail.com'))
      .toEqual({ nombre: 'JESUS LOZADA', firma: false, pendiente: false });
  });

  it('una aprobación vieja de otra persona figura como autorizada por Leydis, con firma', () => {
    // SAL-2026-0185: la aprobó Kelvin. El papel dice LEYDIS RENGEL.
    expect(autorizanteDe('almacenmatanzas2026@gmail.com'))
      .toEqual({ nombre: NOMBRE_FIRMA, firma: true, pendiente: false });
  });

  it('sin aprobación, dice pendiente de aprobación', () => {
    expect(autorizanteDe(null)).toEqual({ nombre: '— (pendiente de aprobación) —', firma: false, pendiente: true });
    expect(autorizanteDe('  ').pendiente).toBe(true);
  });
});
