import { describe, it, expect } from 'vitest';
import { autorizanteDe, puedeAutorizarSalidas, NOMBRE_FIRMA, SIN_AUTORIZACION_NOMBRE } from './autorizanteSalida';

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

  it('el reparto entre cocinas no queda pendiente: no requiere autorización', () => {
    expect(autorizanteDe(null, true))
      .toEqual({ nombre: SIN_AUTORIZACION_NOMBRE, firma: false, pendiente: false });
    expect(autorizanteDe('  ', true).pendiente).toBe(false);
  });

  it('si igual la firmó alguien, manda la firma y no la marca', () => {
    expect(autorizanteDe('mineralgroupguayanaca@gmail.com', true))
      .toEqual({ nombre: 'JESUS LOZADA', firma: false, pendiente: false });
  });

  it('desde la lista de autorizados (28-10-2026) figura quien aprobó, con su nombre', () => {
    expect(autorizanteDe('mariana@gmail.com', false, { aprobadaEn: '2026-10-28T15:00:00-04:00', nombre: 'Mariana Tovar' }))
      .toEqual({ nombre: 'MARIANA TOVAR', firma: false, pendiente: false });
    // Sin nombre cargado, el correo.
    expect(autorizanteDe('mariana@gmail.com', false, { aprobadaEn: '2026-11-02T09:00:00-04:00' }).nombre).toBe('MARIANA@GMAIL.COM');
  });

  it('una aprobación de otra persona ANTES de la lista sigue a nombre de Leydis', () => {
    expect(autorizanteDe('almacenmatanzas2026@gmail.com', false, { aprobadaEn: '2026-09-10T10:00:00-04:00', nombre: 'Kelvin Peña' }))
      .toEqual({ nombre: NOMBRE_FIRMA, firma: true, pendiente: false });
  });

  it('Leydis y Jesús siguen con su nombre de siempre aunque aprueben después', () => {
    expect(autorizanteDe('jhzgcontabilidad@gmail.com', false, { aprobadaEn: '2026-10-29T10:00:00-04:00', nombre: 'Leydis' }))
      .toEqual({ nombre: NOMBRE_FIRMA, firma: true, pendiente: false });
  });
});
