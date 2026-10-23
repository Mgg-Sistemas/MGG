import { describe, expect, it } from 'vitest';
import { armarXmlIslr, codigoConceptoSeniat, fechaSeniat, filasXmlIslr } from './xmlSeniatIslr';
import type { RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';

const base = {
  rifAgente: 'J-12345678-0',
  razonSocial: 'EMPRESA DE PRUEBA C.A.',
  periodo: '202610',
};

const ret = (over: Partial<RetencionPracticada> = {}): RetencionPracticada => ({
  id: 'r1', tipo: 'islr', direccion: 'practicada', estado: 'registrada', docKind: 'manual',
  docId: null, docCodigo: null, contraparteId: 'p1', contraparteRif: 'J-00000000-1',
  contraparteNombre: 'PROVEEDOR 1 C.A.', contraparteSujeto: 'pj_domiciliada',
  facturaNumero: '000123', facturaControl: '00-000456', facturaFecha: '2026-10-21',
  periodo: '202610', quincena: null, numeroComprobante: '0000000001',
  conceptoId: '001:pjd', conceptoNombre: 'Honorarios profesionales',
  moneda: 'Bs', tasa: null, baseImponible: 1000, alicuota: 0, impuesto: 0,
  porcentaje: 2, sustraendo: 0, montoRetenido: 20, montoBs: 20,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, declaradaPor: null, actorName: null, createdAt: '2026-10-21T12:00:00Z', updatedAt: null,
  ...over,
});

describe('XML del SENIAT (retenciones de ISLR)', () => {
  it('filasXmlIslr: solo toma practicadas de ISLR del período que no estén anuladas', () => {
    const r1 = ret({ id: '1' });
    const rAnulada = ret({ id: '2', anulada: true });
    const rOtroPeriodo = ret({ id: '3', periodo: '202611' });
    const rRecibida = ret({ id: '4', direccion: 'recibida' });
    const rIva = ret({ id: '5', tipo: 'iva' });

    const filas = filasXmlIslr([r1, rAnulada, rOtroPeriodo, rRecibida, rIva], '202610');
    expect(filas.map((r) => r.id)).toEqual(['1']);
  });

  it('formato de fecha y concepto para el SENIAT', () => {
    expect(fechaSeniat('2026-10-21')).toBe('21/10/2026');
    expect(codigoConceptoSeniat('001:pnr')).toBe('001');
    expect(codigoConceptoSeniat('22')).toBe('022');
    expect(codigoConceptoSeniat(null)).toBe('001');
  });

  it('sin operaciones: genera el XML con la etiqueta vacía', () => {
    const r = armarXmlIslr({ ...base, filas: [] });
    expect(r.lineas).toBe(0);
    expect(r.faltan).toEqual([]);
    expect(r.contenido).toContain('<RelacionRetencionesISLR RIF="J123456780" Periodo="202610" />');
  });

  it('con operaciones: genera la estructura completa con DetalleRetencion', () => {
    const r = armarXmlIslr({ ...base, filas: [ret()] });
    expect(r.lineas).toBe(1);
    expect(r.faltan).toEqual([]);
    expect(r.contenido).toContain('<RelacionRetencionesISLR RIF="J123456780" Periodo="202610">');
    expect(r.contenido).toContain('<RifRetenido>J000000001</RifRetenido>');
    expect(r.contenido).toContain('<NumeroFactura>000123</NumeroFactura>');
    expect(r.contenido).toContain('<NumeroControl>00-000456</NumeroControl>');
    expect(r.contenido).toContain('<FechaOperacion>21/10/2026</FechaOperacion>');
    expect(r.contenido).toContain('<CodigoConcepto>001</CodigoConcepto>');
    expect(r.contenido).toContain('<MontoOperacion>1000.00</MontoOperacion>');
    expect(r.contenido).toContain('<PorcentajeRetencion>2.00</PorcentajeRetencion>');
  });

  it('valida datos obligatorios faltantes', () => {
    const sinRif = armarXmlIslr({ ...base, rifAgente: '', filas: [ret({ contraparteRif: null })] });
    expect(sinRif.faltan.some((f) => f.includes('RIF de la empresa'))).toBe(true);
    expect(sinRif.faltan.some((f) => f.includes('falta el RIF del proveedor'))).toBe(true);

    const sinTasa = armarXmlIslr({ ...base, filas: [ret({ moneda: 'USD', tasa: null })] });
    expect(sinTasa.faltan.some((f) => f.includes('sin tasa de cambio'))).toBe(true);
  });
});
