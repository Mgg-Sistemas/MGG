import { describe, it, expect } from 'vitest';
import type { NominaRenglon } from '@/shared/lib/types';
import { alternarSeleccion, armarLote, filtrarRenglonesNomina, podarSeleccion, seleccionarVisibles } from './nominaLote';

function r(id: string, nombre: string, extra: Partial<NominaRenglon> = {}): NominaRenglon {
  return {
    id, periodo_id: 'p1', nombre, neto_usd: 100, estado: 'por_pagar',
    periodo: { codigo: 'NOM-2026-0002', tipo: 'quincena', periodo_desde: '2026-10-01', periodo_hasta: '2026-10-15', tasa_bcv: 190 },
    ...extra,
  } as NominaRenglon;
}

const cola = [
  r('a', 'ZORYS PAOLA GRILLET', { departamento: 'Administración', cargo: 'ANALISTA' }),
  r('b', 'JAIME JOSE CAMPOS', { departamento: 'ALIMENTACION', neto_usd: 250 }),
  r('c', 'HENRRY MUÑOS', { departamento: 'AREA DE FUNDICION', neto_usd: 33.33, periodo: { codigo: 'NOM-2026-0003', tipo: 'vacaciones', periodo_desde: null, periodo_hasta: null, tasa_bcv: null } }),
];

describe('Tesorería · pagar nómina: buscador', () => {
  it('busca por nombre, departamento, cargo, nómina y motivo, sin acentos', () => {
    expect(filtrarRenglonesNomina(cola, 'jaime').map((x) => x.id)).toEqual(['b']);
    expect(filtrarRenglonesNomina(cola, 'administracion').map((x) => x.id)).toEqual(['a']);
    expect(filtrarRenglonesNomina(cola, 'analista').map((x) => x.id)).toEqual(['a']);
    expect(filtrarRenglonesNomina(cola, '0003').map((x) => x.id)).toEqual(['c']);
    expect(filtrarRenglonesNomina(cola, 'vacaciones').map((x) => x.id)).toEqual(['c']);
    expect(filtrarRenglonesNomina(cola, 'muños fundicion').map((x) => x.id)).toEqual(['c']);
    expect(filtrarRenglonesNomina(cola, '')).toHaveLength(3);
    expect(filtrarRenglonesNomina(cola, 'nadie')).toHaveLength(0);
  });
});

describe('Tesorería · pagar nómina: lote', () => {
  it('en USD el monto de cada línea es el neto y el total es la suma', () => {
    const { lineas, total } = armarLote(cola, 'USD', 0);
    expect(lineas.map((l) => l.monto)).toEqual([100, 250, 33.33]);
    expect(total).toBe(383.33);
  });

  it('en Bs convierte cada neto a la tasa; sin tasa queda en cero', () => {
    const { lineas, total } = armarLote(cola.slice(0, 2), 'Bs', 190);
    expect(lineas.map((l) => l.monto)).toEqual([19000, 47500]);
    expect(total).toBe(66500);
    expect(armarLote(cola, 'Bs', 0).total).toBe(0);
  });

  it('seleccionar / desmarcar todos actúa sobre los visibles y conserva lo demás', () => {
    let sel = new Set<string>(['c']);
    sel = seleccionarVisibles(sel, cola.slice(0, 2), true);
    expect([...sel].sort()).toEqual(['a', 'b', 'c']);
    sel = seleccionarVisibles(sel, cola.slice(0, 2), false);
    expect([...sel]).toEqual(['c']);
    sel = alternarSeleccion(sel, 'c');
    expect(sel.size).toBe(0);
    sel = alternarSeleccion(sel, 'a');
    expect([...sel]).toEqual(['a']);
  });

  it('al recargar la cola se podan los ids que ya se pagaron', () => {
    const sel = new Set(['a', 'b', 'zzz']);
    expect([...podarSeleccion(sel, cola)].sort()).toEqual(['a', 'b']);
  });
});
