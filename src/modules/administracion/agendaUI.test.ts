import { describe, it, expect } from 'vitest';
import { resumenAgenda, textoDiasRestantes, type ItemAgenda } from './administracionAgenda';

describe('textoDiasRestantes (derivado de diasRestantes, coherente con el aviso)', () => {
  it('vencido, hoy, por venir y sin fecha', () => {
    expect(textoDiasRestantes(-5)).toBe('Vencido hace 5 d');
    expect(textoDiasRestantes(0)).toBe('Vence hoy');
    expect(textoDiasRestantes(45)).toBe('Vence en 45 d');
    expect(textoDiasRestantes(null)).toBe('Sin fecha');
  });
});

const item = (status: ItemAgenda['status']): ItemAgenda => ({
  origen: 'documento', id: Math.random().toString(36), empresaClave: 'GT', centroAcopioId: null,
  responsable: null, titulo: 'x', fecha: null, status, diasRestantes: null, prioridad: null,
});

describe('resumenAgenda', () => {
  it('cuenta vencidos (incluye en trámite), por vencer y vigentes', () => {
    const r = resumenAgenda([
      item('vencido'), item('vencido_en_tramite'), item('por_vencer'),
      item('vigente'), item('vigente'), item('no_vence'),
    ]);
    expect(r).toEqual({ vencidos: 2, porVencer: 1, vigentes: 2 });
  });
});
