import { describe, expect, it } from 'vitest';
import { filasAGuardar } from './minutas.repository';
import type { BorradorMinuta } from './minutaModelo';

const base: BorradorMinuta = {
  fecha: '2026-10-01', lugar: '', hora_inicio: '', objetivo: 'Revisión',
  orden_dia: ['  Presupuesto  ', '', '   '],
  participantes: [{ personal_id: null, nombre: 'Ana', cargo: 'Gerente' },
                  { personal_id: null, nombre: '', cargo: '' }],
  acuerdos: [{ responsable: '', actividad: '', fecha_compromiso: null }],
  otros_asuntos: '', proxima_fecha: null, proximos_puntos: [],
  avances: [], observaciones: '', estado: 'borrador', anexar_adjuntos_pdf: false,
};

describe('filasAGuardar', () => {
  it('descarta las filas vacías que el usuario dejó sin llenar', () => {
    const fila = filasAGuardar(base);
    expect(fila.orden_dia).toEqual(['Presupuesto']);
    expect(fila.participantes).toHaveLength(1);
    expect(fila.acuerdos).toEqual([]);
  });
  it('los textos vacíos se guardan como null, no como cadena vacía', () => {
    const fila = filasAGuardar(base);
    expect(fila.lugar).toBeNull();
    expect(fila.hora_inicio).toBeNull();
  });
  it('incluye el texto de búsqueda ya armado', () => {
    const fila = filasAGuardar(base) as { busq: string };
    expect(fila.busq).toContain('revision');
    expect(fila.busq).toContain('ana');
  });
});

describe('filasAGuardar: filas a medio llenar', () => {
  const avVacio = { actividad: '', responsable: '', fecha_programada: null, revision_fecha: null, pct_inicial: null, revision_final: '', pct_avance: null };
  it('conserva un acuerdo con solo fecha_compromiso', () => {
    const f = filasAGuardar({ ...base, acuerdos: [{ responsable: '', actividad: '', fecha_compromiso: '2026-11-01' }] });
    expect(f.acuerdos).toHaveLength(1);
  });
  it('conserva un avance con solo pct_avance 0', () => {
    const f = filasAGuardar({ ...base, avances: [{ ...avVacio, pct_avance: 0 }] });
    expect(f.avances).toHaveLength(1);
  });
  it('conserva un avance con solo una fecha', () => {
    const f = filasAGuardar({ ...base, avances: [{ ...avVacio, revision_fecha: '2026-11-01' }] });
    expect(f.avances).toHaveLength(1);
  });
  it('conserva un participante con solo cargo', () => {
    const f = filasAGuardar({ ...base, participantes: [{ personal_id: null, nombre: '', cargo: 'Gerente' }] });
    expect(f.participantes).toHaveLength(1);
  });
  it('descarta una fila totalmente vacía de cada tipo', () => {
    const f = filasAGuardar({
      ...base,
      participantes: [{ personal_id: null, nombre: ' ', cargo: '' }],
      acuerdos: [{ responsable: ' ', actividad: '', fecha_compromiso: null }],
      avances: [avVacio],
    });
    expect(f.participantes).toEqual([]);
    expect(f.acuerdos).toEqual([]);
    expect(f.avances).toEqual([]);
  });
  it('recorta los textos de las filas que sobreviven', () => {
    const f = filasAGuardar({
      ...base,
      participantes: [{ personal_id: null, nombre: ' Ana ', cargo: ' Gerente ' }],
      acuerdos: [{ responsable: ' Luis ', actividad: ' Pagar ', fecha_compromiso: null }],
      avances: [{ ...avVacio, actividad: ' Obra ', responsable: ' Eva ', revision_final: ' ok ' }],
    }) as any;
    expect(f.participantes[0]).toMatchObject({ nombre: 'Ana', cargo: 'Gerente' });
    expect(f.acuerdos[0]).toMatchObject({ responsable: 'Luis', actividad: 'Pagar' });
    expect(f.avances[0]).toMatchObject({ actividad: 'Obra', responsable: 'Eva', revision_final: 'ok' });
  });
});
