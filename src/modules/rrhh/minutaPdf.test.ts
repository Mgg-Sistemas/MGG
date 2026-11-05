import { describe, expect, it } from 'vitest';
import type { Minuta } from '@/shared/lib/types';
import {
  RENGLONES_EXTRA, RENGLONES_HOJA, construirMinutaPdf, filasConRenglones, minimoFilas,
} from './minutaPdf';

const vacia = () => ({ a: '' });

describe('filasConRenglones', () => {
  it('la hoja en blanco sale con los renglones del formato de papel', () => {
    expect(filasConRenglones([], RENGLONES_HOJA.ordenDia, vacia)).toHaveLength(7);
    expect(filasConRenglones([], RENGLONES_HOJA.participantes, vacia)).toHaveLength(6);
    expect(filasConRenglones([], RENGLONES_HOJA.acuerdos, vacia)).toHaveLength(6);
    expect(filasConRenglones([], RENGLONES_HOJA.avances, vacia)).toHaveLength(4);
  });
  it('con datos cargados, agrega los renglones de cortesía al final', () => {
    const dos = [{ a: '1' }, { a: '2' }];
    const r = filasConRenglones(dos, dos.length + RENGLONES_EXTRA, vacia);
    expect(r).toHaveLength(2 + RENGLONES_EXTRA);
    expect(r[0]).toEqual({ a: '1' });
    expect(r[r.length - 1]).toEqual({ a: '' });
  });
  it('si ya hay más filas que el mínimo, no recorta ninguna', () => {
    const diez = Array.from({ length: 10 }, (_, i) => ({ a: String(i) }));
    expect(filasConRenglones(diez, 6, vacia)).toHaveLength(10);
  });
  it('una minuta muy larga conserva todas sus filas (el PDF pagina solo)', () => {
    const muchas = Array.from({ length: 120 }, (_, i) => ({ a: String(i) }));
    expect(filasConRenglones(muchas, 6, vacia)).toHaveLength(120);
  });
});

describe('RENGLONES_HOJA', () => {
  it('coincide con el formato en papel de la empresa', () => {
    expect(RENGLONES_HOJA).toEqual({
      ordenDia: 7, participantes: 6, acuerdos: 6, avances: 4, observaciones: 7,
      proximosPuntos: 7, otrosAsuntos: 7,
    });
  });
});

describe('minimoFilas', () => {
  it('es monótona en las filas cargadas y nunca baja del mínimo del papel', () => {
    for (const k of Object.keys(RENGLONES_HOJA) as (keyof typeof RENGLONES_HOJA)[]) {
      for (let n = 0; n <= 30; n++) {
        expect(minimoFilas(k, n + 1)).toBeGreaterThanOrEqual(minimoFilas(k, n));
        expect(minimoFilas(k, n)).toBeGreaterThanOrEqual(RENGLONES_HOJA[k]);
      }
    }
  });
});

const minutaBase = (parche: Partial<Minuta> = {}): Minuta => ({
  id: 'm1', numero: 'MIN-2026-001', estado: 'borrador', lugar: 'Sala de juntas',
  fecha: '2026-10-01', hora_inicio: '09:00', objetivo: 'Revisar avances',
  orden_dia: ['Presupuesto', 'Cronograma'],
  participantes: [{ personal_id: null, nombre: 'Ana Pérez', cargo: 'Gerente' }],
  acuerdos: [{ responsable: 'Ana', actividad: 'Enviar informe', fecha_compromiso: '2026-10-10' }],
  otros_asuntos: 'Nada más', proxima_fecha: '2026-10-15', proximos_puntos: ['Cierre'],
  avances: [{
    actividad: 'Obra', responsable: 'Luis', fecha_programada: '2026-10-01', revision_fecha: '2026-10-05',
    pct_inicial: 10, revision_final: 'Ok', pct_avance: 50,
  }],
  observaciones: 'Sin novedad', anexar_adjuntos_pdf: false, creada_en: '2026-10-01T00:00:00Z',
  ...parche,
});

describe('construirMinutaPdf', () => {
  it('la hoja en blanco se construye y tiene al menos una página', async () => {
    const doc = await construirMinutaPdf(null);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
  it('una minuta cargada normal se construye', async () => {
    const doc = await construirMinutaPdf(minutaBase());
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
  it('una minuta con 120 acuerdos y 120 avances se parte en varias páginas', async () => {
    const acuerdos = Array.from({ length: 120 }, (_, i) => ({
      responsable: `R${i}`, actividad: `Actividad ${i}`, fecha_compromiso: '2026-10-10',
    }));
    const avances = Array.from({ length: 120 }, (_, i) => ({
      actividad: `A${i}`, responsable: `R${i}`, fecha_programada: '2026-10-01',
      revision_fecha: '2026-10-05', pct_inicial: 10, revision_final: 'Ok', pct_avance: 50,
    }));
    const doc = await construirMinutaPdf(minutaBase({ acuerdos, avances }));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
  it('la hoja en blanco y una minuta vacía ocupan las mismas páginas', async () => {
    const blanca = await construirMinutaPdf(null);
    const vacia = await construirMinutaPdf(minutaBase({
      objetivo: null, lugar: null, hora_inicio: null, orden_dia: [], participantes: [], acuerdos: [],
      otros_asuntos: null, proxima_fecha: null, proximos_puntos: [], avances: [], observaciones: null,
    }));
    expect(vacia.getNumberOfPages()).toBe(blanca.getNumberOfPages());
  });
});

describe('minimoFilas', () => {
  it('sin filas cargadas devuelve el mínimo del papel de cada sección', () => {
    expect(minimoFilas('ordenDia', 0)).toBe(7);
    expect(minimoFilas('participantes', 0)).toBe(6);
    expect(minimoFilas('acuerdos', 0)).toBe(6);
    expect(minimoFilas('avances', 0)).toBe(4);
    expect(minimoFilas('observaciones', 0)).toBe(7);
  });
  it('con muchas filas cargadas devuelve cargadas + RENGLONES_EXTRA, en cualquier sección', () => {
    for (const k of Object.keys(RENGLONES_HOJA) as (keyof typeof RENGLONES_HOJA)[]) {
      expect(minimoFilas(k, 20)).toBe(20 + RENGLONES_EXTRA);
    }
  });
  it('la tabla nunca baja del mínimo del papel: 1 acuerdo sigue imprimiendo 6, no 3', () => {
    expect(minimoFilas('acuerdos', 1)).toBe(6);
  });
  it('con 10 acuerdos cargados imprime 12', () => {
    expect(minimoFilas('acuerdos', 10)).toBe(12);
  });
  it('cero filas cargadas da el mínimo del papel, no el extra', () => {
    expect(minimoFilas('acuerdos', 0)).not.toBe(RENGLONES_EXTRA);
  });
});
