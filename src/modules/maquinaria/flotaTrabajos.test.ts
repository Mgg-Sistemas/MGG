import { describe, it, expect } from 'vitest';
import { SERVICIOS, INTERVENCIONES, ajustarIntervenciones, etiquetaServicio, intervencionesDe, trabajosDe } from './flota';

describe('¿Qué se hace? (opciones por tipo de servicio)', () => {
  it('cauchos trae cambio, reparación y caucho espichado', () => {
    expect(trabajosDe('cauchos')).toEqual(expect.arrayContaining(['Cambio de caucho', 'Reparación de caucho', 'Caucho espichado']));
  });
  it('aceite trae el cambio de aceite', () => {
    expect(trabajosDe('aceite')).toContain('Cambio de aceite de motor');
  });
  it('todos los tipos salvo «Otro» tienen opciones', () => {
    for (const s of SERVICIOS) expect(trabajosDe(s.id).length > 0).toBe(s.id !== 'otro');
  });
  it('sin tipo no hay opciones', () => {
    expect(trabajosDe(null)).toEqual([]);
  });
  it('la etiqueta suma lo marcado al tipo', () => {
    expect(etiquetaServicio('cauchos', ['Caucho espichado'])).toBe('Cauchos / neumáticos: Caucho espichado');
    expect(etiquetaServicio('cauchos', [])).toBe('Cauchos / neumáticos');
  });
});

describe('Tipo de intervención según el servicio', () => {
  it('cauchos trae cauchera y no electricidad', () => {
    expect(intervencionesDe('cauchos')).toContain('Cauchera / vulcanización');
    expect(intervencionesDe('cauchos')).not.toContain('Electricidad');
  });
  it('«Otro» y sin tipo muestran las generales', () => {
    expect(intervencionesDe('otro')).toEqual(INTERVENCIONES);
    expect(intervencionesDe(null)).toEqual(INTERVENCIONES);
  });
  it('todos los servicios tienen al menos una', () => {
    for (const s of SERVICIOS) expect(intervencionesDe(s.id).length).toBeGreaterThan(0);
  });
  it('al cambiar de servicio se quedan las que aplican o se marca la primera', () => {
    expect(ajustarIntervenciones('hidraulico', ['Mecánica', 'Electricidad'])).toEqual(['Mecánica']);
    expect(ajustarIntervenciones('cauchos', ['Electricidad'])).toEqual(['Cauchera / vulcanización']);
    expect(ajustarIntervenciones('electrico', [])).toEqual(['Electricidad']);
  });
});
