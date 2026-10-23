import { describe, expect, it } from 'vitest';
import { cuandoCorto, eventosRetencion, lineaQuien } from './quienCuando';

// Datos inventados.
const base = {
  actorName: 'Persona de prueba', createdAt: '2026-10-14T13:00:00Z',
  declaradaEn: null, declaradaPor: null, anulada: false, anuladaMotivo: null, updatedAt: '2026-10-14T13:00:00Z',
};

describe('quién y cuándo, con las columnas que ya existen', () => {
  it('una registrada: quién la registró y cuándo', () => {
    expect(eventosRetencion(base)).toEqual([{ accion: 'Registró', quien: 'Persona de prueba', cuando: '2026-10-14T13:00:00Z' }]);
    expect(lineaQuien(base)).toBe('por Persona de prueba · 14/10 09:00');
  });

  it('una declarada: la última acción es la declaración, con quién la marcó', () => {
    const r = { ...base, declaradaEn: '2026-10-15T14:30:00Z', declaradaPor: 'otra@ejemplo.com' };
    expect(eventosRetencion(r).map((e) => e.accion)).toEqual(['Registró', 'Declaró']);
    expect(lineaQuien(r)).toBe('declaró · por otra@ejemplo.com · 15/10 10:30');
  });

  it('una anulada: cuándo y el motivo; la tabla no guarda quién anuló y no se inventa', () => {
    const r = { ...base, anulada: true, anuladaMotivo: 'Error de carga', updatedAt: '2026-10-16T12:00:00Z' };
    const ultima = eventosRetencion(r).at(-1);
    expect(ultima).toMatchObject({ accion: 'Anuló', quien: null, detalle: 'Error de carga' });
    expect(lineaQuien(r)).toBe('anuló · 16/10 08:00');
  });

  it('sin fecha no inventa una', () => {
    expect(cuandoCorto(null)).toBe('');
    expect(cuandoCorto('no es fecha')).toBe('');
  });
});
