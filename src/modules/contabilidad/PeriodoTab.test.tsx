import { describe, expect, it } from 'vitest';
import { mesesAccionables } from './PeriodoTab';
import { estadoDePrueba } from './pruebas/datosPrueba';

describe('Período: uno por uno, en orden (Galac)', () => {
  const e = estadoDePrueba();
  const ej = e.cont_ejercicios[0];

  it('con todo abierto, se cierra enero y no hay nada que abrir', () => {
    expect(mesesAccionables(e.cont_periodos, ej)).toEqual({ cerrable: 'per-202601', abrible: null });
  });

  it('se cierra el primero abierto y se abre el último cerrado; el mes 13 nunca', () => {
    const periodos = e.cont_periodos.map((p) => (p.numero <= 3 || p.numero === 13 ? { ...p, estado: 'cerrado' as const } : p));
    expect(mesesAccionables(periodos, ej)).toEqual({ cerrable: 'per-202604', abrible: 'per-202603' });
  });

  it('con el ejercicio en pre-cierre o cerrado, ningún mes se toca desde Período', () => {
    expect(mesesAccionables(e.cont_periodos, { ...ej, estado: 'pre_cierre' })).toEqual({ cerrable: null, abrible: null });
  });
});
