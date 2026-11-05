import { describe, expect, it } from 'vitest';
import type { Minuta } from '@/shared/lib/types';
import { FILTROS_VACIOS, contarMinutas, filtrarMinutas, recortar } from './minutaFiltros';

const HOY = new Date('2026-10-01T16:00:00Z');

function mk(p: Partial<Minuta>): Minuta {
  return {
    id: 'x', numero: 'MIN-2026-0001', estado: 'finalizada', lugar: null, fecha: '2026-05-10',
    hora_inicio: null, objetivo: null, orden_dia: [], participantes: [], acuerdos: [],
    otros_asuntos: null, proxima_fecha: null, proximos_puntos: [], avances: [], observaciones: null,
    anexar_adjuntos_pdf: false, busq: '', creada_en: '2026-05-10T00:00:00Z', ...p,
  };
}

type Acuerdo = Minuta['acuerdos'][number];
const A = mk({ id: 'a', fecha: '2026-03-01', estado: 'borrador', busq: 'compra de camion',
  participantes: [{ personal_id: null, nombre: 'María Pérez', cargo: '' }] });
const B = mk({ id: 'b', fecha: '2026-06-15', busq: 'revision de nomina',
  acuerdos: [{ responsable: 'José Gómez', fecha_compromiso: '2026-12-01' } as Acuerdo] });
const C = mk({ id: 'c', fecha: '2025-12-20', busq: 'cierre',
  acuerdos: [{ responsable: 'Ana', fecha_compromiso: '2026-01-01' } as Acuerdo] });
const L = [A, B, C];
const ids = (r: Minuta[]) => r.map((m) => m.id);

describe('filtrarMinutas', () => {
  it('sin filtros devuelve todo', () => expect(ids(filtrarMinutas(L, FILTROS_VACIOS, HOY))).toEqual(['a', 'b', 'c']));
  it('rango de fechas inclusivo', () => {
    expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, desde: '2026-03-01', hasta: '2026-06-15' }, HOY))).toEqual(['a', 'b']);
    expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, desde: '2026-06-16' }, HOY))).toEqual([]);
  });
  it('por estado', () => expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, estado: 'borrador' }, HOY))).toEqual(['a']));
  it('persona: participante o responsable, sin acentos', () => {
    expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, persona: 'maria' }, HOY))).toEqual(['a']);
    expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, persona: 'JOSE' }, HOY))).toEqual(['b']);
  });
  it('solo con acuerdos pendientes (incluye los vencidos)', () => expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, soloPendientes: true }, HOY))).toEqual(['b', 'c']));
  it('palabra contra busq, sin acentos ni mayúsculas', () => {
    expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, palabra: 'CAMIÓN' }, HOY))).toEqual(['a']);
    expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, palabra: '  ' }, HOY))).toHaveLength(3);
  });
  it('combina filtros y tolera busq nulo', () => {
    expect(ids(filtrarMinutas([mk({ id: 'n', busq: null })], { ...FILTROS_VACIOS, palabra: 'x' }, HOY))).toEqual([]);
    expect(ids(filtrarMinutas(L, { ...FILTROS_VACIOS, estado: 'finalizada', palabra: 'nomina' }, HOY))).toEqual(['b']);
  });
});

describe('contarMinutas', () => {
  it('cuenta del año, borradores y pendientes', () => {
    expect(contarMinutas(L, HOY)).toEqual({ delAnio: 2, borradores: 1, pendientes: 2 });
  });
});

describe('contarMinutas - zona horaria', () => {
  it('31 de diciembre 23:00 en Venezuela sigue siendo el año viejo', () => {
    // 2027-01-01T03:00Z = 31/12/2026 23:00 en Caracas (UTC-4)
    const finDeAnio = new Date('2027-01-01T03:00:00Z');
    expect(contarMinutas(L, finDeAnio).delAnio).toBe(2);
  });
});

describe('recortar', () => {
  it('no toca lo corto y recorta lo largo a 60', () => {
    expect(recortar('hola')).toBe('hola');
    expect(recortar(null)).toBe('');
    const r = recortar('x'.repeat(100));
    expect(r.length).toBe(60);
    expect(r.endsWith('…')).toBe(true);
  });
});
