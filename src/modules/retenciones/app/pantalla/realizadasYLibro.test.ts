import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../datos/puerta';
import { FILTRO_INICIAL, estadoDe, facturasRealizadas, fechaVe, filasLibro, opcionesLibro } from './realizadasYLibro';
import { quienYCuando } from './quien';

// Datos inventados.
let n = 0;
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: `r${++n}`, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Alfa', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: null, facturaFecha: '2026-10-03', periodo: '2026-10', quincena: 1,
  numeroComprobante: '20261000000011', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, actorName: 'Ana Pérez', createdAt: '2026-10-03T15:28:00', ...over,
}) as RetencionPracticada;

const libro = [
  r({ tipo: 'iva' }),
  r({ tipo: 'municipal', numeroComprobante: '0000000031' }),
  r({ tipo: 'iva', facturaNumero: '004410', facturaFecha: '2026-09-28', docCodigo: 'OC-0002', docId: 'oc-2', estado: 'declarada', contraparteNombre: 'Taller Beta' }),
  r({ tipo: 'islr', facturaNumero: '004411', facturaFecha: '2026-09-29', docId: 'oc-3', anulada: true }),
];

describe('Realizadas: una fila por factura con sus retenciones', () => {
  it('agrupa las retenciones de la misma factura y ordena por fecha, la más reciente primero', () => {
    const xs = facturasRealizadas(libro, FILTRO_INICIAL);
    expect(xs.map((x) => x.facturaNumero)).toEqual(['000123', '004411', '004410']);
    expect(xs[0].retenciones.map((x) => x.tipo)).toEqual(['iva', 'municipal']);
  });

  it('con un filtro de impuesto, la factura muestra solo esas retenciones y desaparece si no tiene ninguna', () => {
    const xs = facturasRealizadas(libro, { ...FILTRO_INICIAL, impuesto: 'municipal' });
    expect(xs).toHaveLength(1);
    expect(xs[0].retenciones.map((x) => x.tipo)).toEqual(['municipal']);
  });

  it('la búsqueda por N° de comprobante encuentra la factura entera', () => {
    const xs = facturasRealizadas(libro, { ...FILTRO_INICIAL, q: '0000000031' });
    expect(xs.map((x) => x.facturaNumero)).toEqual(['000123']);
    expect(xs[0].retenciones).toHaveLength(2);
  });
});

describe('Libro fiscal: una fila por retención', () => {
  it('filtra por estado (anulada, declarada) y por mes', () => {
    expect(filasLibro(libro, { ...FILTRO_INICIAL, estado: 'anulada' }).map((x) => x.tipo)).toEqual(['islr']);
    expect(filasLibro(libro, { ...FILTRO_INICIAL, estado: 'declarada' })).toHaveLength(1);
    expect(filasLibro(libro, { ...FILTRO_INICIAL, mes: '2026-09' })).toHaveLength(2);
  });

  it('el orden «más antiguo primero» invierte la lista', () => {
    expect(filasLibro(libro, { ...FILTRO_INICIAL, orden: 'antiguo' })[0].facturaNumero).toBe('004410');
  });

  it('las opciones de los filtros salen de lo que hay, con su cuenta', () => {
    const o = opcionesLibro(libro);
    expect(o.impuesto).toContainEqual({ valor: 'iva', texto: 'IVA', cuenta: 2 });
    expect(o.mes.map((m) => m.texto)).toEqual(['Octubre 2026', 'Septiembre 2026']);
    expect(o.estado.map((e) => e.valor)).toEqual(['registrada', 'declarada', 'anulada']);
  });
});

describe('textos de la fila', () => {
  it('estado, fecha y quién', () => {
    expect(estadoDe(libro[3])).toBe('anulada');
    expect(fechaVe('2026-10-03')).toBe('03/10/2026');
    expect(fechaVe(null)).toBe('—');
    expect(quienYCuando(libro[0])).toBe('por Ana Pérez · 03/10 15:28');
  });
});
