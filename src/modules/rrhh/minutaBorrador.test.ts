import { describe, expect, it } from 'vitest';
import type { Minuta } from '@/shared/lib/types';
import { borradorDesdeMinuta, filaTieneContenido, participanteDesdePersonal } from './minutaBorrador';
import { hoyVE } from './minutaModelo';

const minuta: Minuta = {
  id: 'm1', numero: 'MIN-2026-0001', estado: 'finalizada', lugar: null,
  fecha: '2026-09-30', hora_inicio: null, objetivo: 'Avances', orden_dia: [],
  participantes: [{ personal_id: 'p1', nombre: 'Ana Pérez', cargo: 'Gerente' }],
  acuerdos: [], otros_asuntos: null, proxima_fecha: null, proximos_puntos: [],
  avances: [], observaciones: null, anexar_adjuntos_pdf: true, creada_en: '2026-09-30T10:00:00Z',
};

describe('hoyVE', () => {
  it('a las 8 p. m. en Caracas sigue siendo el mismo día', () => {
    expect(hoyVE(new Date('2026-10-02T00:30:00Z'))).toBe('2026-10-01');
  });
});

describe('borradorDesdeMinuta', () => {
  it('una minuta nueva arranca en borrador, con la fecha de hoy y una fila vacía por lista', () => {
    const b = borradorDesdeMinuta(null, new Date('2026-10-01T15:00:00Z'));
    expect(b.fecha).toBe('2026-10-01');
    expect(b.estado).toBe('borrador');
    expect(b.anexar_adjuntos_pdf).toBe(false);
    expect(b.orden_dia).toEqual(['']);
    expect(b.proximos_puntos).toEqual(['']);
    expect(b.participantes).toHaveLength(1);
    expect(b.acuerdos).toHaveLength(1);
    expect(b.avances).toHaveLength(1);
    expect(b.avances[0].pct_avance).toBeNull();
  });
  it('una minuta existente conserva sus datos y cambia los nulos por texto vacío', () => {
    const b = borradorDesdeMinuta(minuta);
    expect(b.fecha).toBe('2026-09-30');
    expect(b.estado).toBe('finalizada');
    expect(b.anexar_adjuntos_pdf).toBe(true);
    expect(b.lugar).toBe('');
    expect(b.objetivo).toBe('Avances');
    expect(b.participantes).toEqual(minuta.participantes);
  });
  it('las listas vacías de una minuta guardada vuelven con una fila para escribir', () => {
    const b = borradorDesdeMinuta(minuta);
    expect(b.orden_dia).toEqual(['']);
    expect(b.acuerdos).toHaveLength(1);
  });
  it('no comparte filas con la minuta original', () => {
    const b = borradorDesdeMinuta(minuta);
    b.participantes[0].nombre = 'Otro';
    expect(minuta.participantes[0].nombre).toBe('Ana Pérez');
  });
});

describe('participanteDesdePersonal', () => {
  it('copia nombre completo y cargo como texto', () => {
    expect(participanteDesdePersonal({ id: 'p1', nombre: 'Ana', apellido: 'Pérez', cargo: 'Gerente' }))
      .toEqual({ personal_id: 'p1', nombre: 'Ana Pérez', cargo: 'Gerente' });
  });
  it('sin apellido ni cargo no deja «undefined» ni espacios sobrantes', () => {
    expect(participanteDesdePersonal({ id: 'p2', nombre: 'Luis', apellido: null, cargo: null }))
      .toEqual({ personal_id: 'p2', nombre: 'Luis', cargo: '' });
  });
});

describe('filaTieneContenido', () => {
  it('una fila en blanco no tiene contenido', () => {
    expect(filaTieneContenido(['', '  ', null, undefined])).toBe(false);
  });
  it('un solo campo con texto basta', () => {
    expect(filaTieneContenido(['', 'Comprar sillas', null])).toBe(true);
  });
  it('un porcentaje en 0 cuenta como contenido', () => {
    expect(filaTieneContenido(['', null, 0])).toBe(true);
  });
  it('una fecha cuenta como contenido', () => {
    expect(filaTieneContenido(['', '2026-10-05'])).toBe(true);
  });
});
