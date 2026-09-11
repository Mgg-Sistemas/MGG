import { describe, it, expect } from 'vitest';
import { autorizanteDe, CORREO_FIRMA, NOMBRE_FIRMA } from './autorizanteSalida';

const PERSONAS: Record<string, string> = {
  'jhzgcontabilidad@gmail.com': 'LEYDIS RENGEL',
  'almacenmatanzas2026@gmail.com': 'Kelvin Peña',
  'mineralgroupguayanaca@gmail.com': 'Jesus Lozada',
};
const nombre = (c: string) => PERSONAS[c.toLowerCase()] ?? '';

describe('quién firma «Autorizado por»', () => {
  it('cuando aprobó la dueña de la firma, va su nombre y su firma', () => {
    expect(autorizanteDe(CORREO_FIRMA, null, nombre))
      .toEqual({ nombre: NOMBRE_FIRMA, firma: true, pendiente: false });
  });

  it('cuando aprobó otra persona, va SU nombre y la línea queda para firmar a mano', () => {
    // El caso de los 102 documentos de Kelvin.
    expect(autorizanteDe('almacenmatanzas2026@gmail.com', null, nombre))
      .toEqual({ nombre: 'KELVIN PEÑA', firma: false, pendiente: false });
  });

  it('sin aprobación, el papel lo dice y no lleva firma', () => {
    expect(autorizanteDe(null, null, nombre))
      .toEqual({ nombre: '— (pendiente de aprobación) —', firma: false, pendiente: true });
    expect(autorizanteDe('', '  ', nombre).pendiente).toBe(true);
  });

  it('manda quien aprobó, no quien ejecutó', () => {
    const a = autorizanteDe('almacenmatanzas2026@gmail.com', 'mineralgroupguayanaca@gmail.com', nombre);
    expect(a.nombre).toBe('KELVIN PEÑA');
  });

  it('si se cerró sin aprobación, queda el nombre de quien la cerró', () => {
    const a = autorizanteDe(null, 'mineralgroupguayanaca@gmail.com', nombre);
    expect(a).toEqual({ nombre: 'JESUS LOZADA', firma: false, pendiente: false });
  });

  it('un correo sin ficha se imprime tal cual, sin inventar un nombre', () => {
    expect(autorizanteDe('alguien@nuevo.com', null, nombre).nombre).toBe('ALGUIEN@NUEVO.COM');
  });

  it('el correo de la firma se reconoce sin importar mayúsculas', () => {
    expect(autorizanteDe('JHZGContabilidad@Gmail.com', null, nombre).firma).toBe(true);
  });
});
