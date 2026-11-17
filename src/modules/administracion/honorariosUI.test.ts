import { describe, it, expect } from 'vitest';
import { agrupaPorProfesional } from './administracionHonorarios';
import type { Gestion, Profesional } from './admin.repository';

const prof = (id: string, nombre: string): Profesional => ({ id, nombre, profesion: null, contacto: null, activo: true });
const g = (id: string, profesionalId: string | null): Gestion => ({
  id, empresaClave: 'GT', profesionalId, categoriaId: null, centroAcopioId: null, documentoId: null,
  concepto: 'Gestión ' + id, costoTotal: 100, moneda: 'USD', tasaRef: null,
  fecha: '2026-11-07', fechaPactada: null, estado: 'abierta', notaAcuerdo: null,
});

describe('agrupaPorProfesional', () => {
  it('solo incluye profesionales con gestiones, ordenados por nombre', () => {
    const profesionales = [prof('p2', 'Cont. Bea'), prof('p1', 'Abg. Ana'), prof('p3', 'Dr. Caro')];
    const gestiones = [g('g1', 'p1'), g('g2', 'p1'), g('g3', 'p2')];

    const grupos = agrupaPorProfesional(gestiones, [], profesionales);
    expect(grupos.map((x) => x.profesional.id)).toEqual(['p1', 'p2']); // p3 sin gestiones no aparece; orden por nombre
    expect(grupos[0].cuenta.lineas).toHaveLength(2);
    expect(grupos[1].cuenta.lineas).toHaveLength(1);
  });

  it('ignora gestiones de un profesional desconocido (no revienta)', () => {
    const grupos = agrupaPorProfesional([g('g1', 'fantasma')], [], [prof('p1', 'Abg. Ana')]);
    expect(grupos).toHaveLength(0);
  });
});
