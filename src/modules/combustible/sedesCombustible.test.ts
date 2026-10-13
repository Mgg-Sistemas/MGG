import { describe, it, expect } from 'vitest';
import { SEDE_POR_DEFECTO, resumenTanquesPorSede, sedeDe, tanquesDeSede } from './sedesCombustible';

describe('sedeDe · sede de un tanque o combustible', () => {
  it('devuelve la sede guardada, recortada', () => {
    expect(sedeDe({ sede: ' LOS PINOS ' })).toBe('LOS PINOS');
  });
  it('sin sede (legado) cae en Matanzas', () => {
    expect(sedeDe({ sede: null })).toBe(SEDE_POR_DEFECTO);
    expect(sedeDe({ sede: '' })).toBe('MATANZAS');
    expect(sedeDe({})).toBe('MATANZAS');
  });
});

describe('tanquesDeSede / resumenTanquesPorSede · el teléfono pide la sede primero (13-10)', () => {
  const tanques = [
    { id: 'a', sede: 'LOS PINOS', litros: 100 },
    { id: 'b', sede: 'LOS PINOS', litros: 50.5 },
    { id: 'c', sede: null, litros: 20 },
    { id: 'd', sede: 'MATANZAS', litros: 0 },
  ];
  it('filtra por sede, con los legados en Matanzas', () => {
    expect(tanquesDeSede(tanques, 'LOS PINOS').map((t) => t.id)).toEqual(['a', 'b']);
    expect(tanquesDeSede(tanques, 'MATANZAS').map((t) => t.id)).toEqual(['c', 'd']);
  });
  it('resume tanques y litros por sede, en el orden de las sedes', () => {
    expect(resumenTanquesPorSede([{ clave: 'LOS PINOS' }, { clave: 'MATANZAS' }, { clave: 'OTRA' }], tanques)).toEqual([
      { clave: 'LOS PINOS', nTanques: 2, litros: 150.5 },
      { clave: 'MATANZAS', nTanques: 2, litros: 20 },
      { clave: 'OTRA', nTanques: 0, litros: 0 },
    ]);
  });
});
