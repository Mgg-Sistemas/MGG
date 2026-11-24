import { describe, expect, it } from 'vitest';
import { soloImpuestosActivos, filtrarActivos, type ImpuestosActivos } from './impuestosVista';
import type { TipoImpuesto } from '@/modules/libroFiscal/retencionesCalculo';

// Las 3 familias que hoy aparecen en «Por realizar» (mismas claves y rótulos que la pantalla).
const IMPUESTOS_PENDIENTES: { key: TipoImpuesto; label: string }[] = [
  { key: 'iva', label: 'IVA' }, { key: 'islr', label: 'ISLR' }, { key: 'municipal', label: 'ISAE' },
];

const activosDe = (pares: [TipoImpuesto, number][]): ImpuestosActivos => ({
  claves: new Set(pares.map(([k]) => k)),
  orden: new Map(pares.map(([k, o]) => [k, o])),
});

describe('impuestos visibles en las vistas', () => {
  it('sin datos (null) deja la lista fija completa y en su mismo orden', () => {
    expect(soloImpuestosActivos(IMPUESTOS_PENDIENTES, null).map((t) => t.key)).toEqual(['iva', 'islr', 'municipal']);
    expect(filtrarActivos(['iva', 'islr', 'municipal'], null)).toEqual(['iva', 'islr', 'municipal']);
  });

  it('un impuesto deshabilitado desaparece de la lista', () => {
    // IVA deshabilitado: solo quedan ISLR y Municipal.
    const activos = activosDe([['islr', 2], ['municipal', 3]]);
    expect(soloImpuestosActivos(IMPUESTOS_PENDIENTES, activos).map((t) => t.key)).toEqual(['islr', 'municipal']);
    expect(filtrarActivos(['iva', 'islr', 'municipal'], activos)).toEqual(['islr', 'municipal']);
  });

  it('con todos activos, el comportamiento es idéntico: mismos miembros y mismo orden', () => {
    const activos = activosDe([['iva', 1], ['islr', 2], ['municipal', 3]]);
    expect(soloImpuestosActivos(IMPUESTOS_PENDIENTES, activos)).toEqual(IMPUESTOS_PENDIENTES);
  });

  it('respeta el orden de la tabla', () => {
    // La tabla pone Municipal antes que ISLR.
    const activos = activosDe([['iva', 1], ['municipal', 2], ['islr', 3]]);
    expect(soloImpuestosActivos(IMPUESTOS_PENDIENTES, activos).map((t) => t.key)).toEqual(['iva', 'municipal', 'islr']);
  });

  it('no inventa impuestos: solo filtra los que ya estaban en la lista fija', () => {
    // 'regional' e 'igtf' están activos en la tabla pero no en «Por realizar»: no se agregan.
    const activos = activosDe([['iva', 1], ['islr', 2], ['municipal', 3], ['regional', 4], ['igtf', 5]]);
    expect(soloImpuestosActivos(IMPUESTOS_PENDIENTES, activos).map((t) => t.key)).toEqual(['iva', 'islr', 'municipal']);
  });
});
