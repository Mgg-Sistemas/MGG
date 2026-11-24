import { describe, it, expect } from 'vitest';
import type { RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { mensajeRetencion, datosMensajeDeRetenciones } from './mensajeRetencion';

const linea = (p: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: 'r1', tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc',
  docId: 'o1', docCodigo: 'OC-0001', contraparteId: null, contraparteRif: 'J-12345678-9',
  contraparteNombre: 'Proveedor C.A.', contraparteSujeto: null, facturaNumero: '0001', facturaControl: '00-001',
  facturaFecha: '2026-10-15', periodo: '202610', quincena: 2, numeroComprobante: null, conceptoId: null,
  conceptoNombre: null, moneda: 'Bs', tasa: null, baseImponible: 1000, alicuota: 16, impuesto: 160,
  porcentaje: 75, sustraendo: 0, montoRetenido: 120, montoBs: 120, facturaTotal: 1160,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, declaradaPor: null, actorName: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: null,
  ...p,
});

describe('mensajeRetencion', () => {
  it('una retención: agente, proveedor, OC, factura, retenido y pago pendiente', () => {
    const d = datosMensajeDeRetenciones([linea({})], { empresaAgente: 'Golden Touch', aplicables: ['iva'] });
    const txt = mensajeRetencion(d);
    expect(txt).toContain('RETENCIÓN REGISTRADA');
    expect(txt).toContain('Golden Touch');
    expect(txt).toContain('Proveedor C.A.');
    expect(txt).toContain('OC-0001');
    expect(txt).toContain('N° Factura:* 0001');
    expect(txt).toContain('IVA: Bs 120,00');
    expect(txt).toContain('Tesorería:* Por pagar');
  });

  it('varias retenciones de la misma factura en un mensaje, con no aplicadas y pago con monto', () => {
    const lineas = [linea({ tipo: 'iva', montoBs: 120 }), linea({ id: 'r2', tipo: 'islr', montoRetenido: 30, montoBs: 30 })];
    const d = datosMensajeDeRetenciones(lineas, {
      empresaAgente: 'Golden Touch', aplicables: ['iva', 'islr', 'municipal'],
      pagada: true, montoPagado: 1010, monedaPago: 'Bs',
    });
    const txt = mensajeRetencion(d);
    expect(txt).toContain('IVA: Bs 120,00');
    expect(txt).toContain('ISLR: Bs 30,00');
    expect(txt).toContain('Retenido (total):* Bs 150,00');
    expect(txt).toContain('No aplicadas:* ISAE');
    expect(txt).toContain('Tesorería:* ✓ Pagada: Bs 1.010,00');
  });

  it('en dólares sin Bs usa la moneda de la línea', () => {
    const d = datosMensajeDeRetenciones([linea({ moneda: 'USD', montoBs: null, montoRetenido: 15, facturaTotal: 100 })], { empresaAgente: 'GT' });
    const txt = mensajeRetencion(d);
    expect(txt).toContain('Monto total:* $ 100,00');
    expect(txt).toContain('IVA: $ 15,00');
  });
});
