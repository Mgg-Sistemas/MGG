import { describe, expect, it } from 'vitest';
import { CONFIG_RETENCION_DEFECTO, type ConfigRetencion } from './retencionesCalculo';
import type { RetencionPracticada } from './retencionesFiscal.repository';
import { partesComprobante } from './comprobanteRetencionPdf';

const empresa: ConfigRetencion = {
  ...CONFIG_RETENCION_DEFECTO,
  razonSocial: 'Mineral Group Guayana C.A.',
  rif: 'J-50221930-7',
  direccionFiscal: 'Puerto Ordaz',
  municipio: 'Caroní',
  estado: 'Bolívar',
};

const retencion = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: 'r1', tipo: 'iva', direccion: 'practicada', estado: 'registrada',
  docKind: 'manual', docId: null, docCodigo: null,
  contraparteId: null, contraparteRif: null, contraparteNombre: null, contraparteSujeto: null,
  facturaNumero: '0001', facturaControl: '00-0001', facturaFecha: '2026-10-05',
  periodo: '202610', quincena: 1, numeroComprobante: '20261000000001',
  conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null,
  anulada: false, anuladaMotivo: null, declaradaEn: null, actorName: null, createdAt: '2026-10-05T14:00:00Z',
  ...over,
});

/* El comprobante dice quién retuvo y a quién. Cuando la practicamos, el agente
   es la empresa; cuando nos la practicaron, el agente es el cliente y el sujeto
   retenido es la empresa. Con los papeles al revés el comprobante no sirve. */
describe('comprobante de retención · quién es el agente y quién el sujeto', () => {
  it('la que practicamos: el agente es la empresa y el sujeto, el proveedor', () => {
    const p = partesComprobante(retencion({
      direccion: 'practicada', contraparteNombre: 'Ferretería El Tornillo C.A.', contraparteRif: 'J-12345678-9',
    }), empresa);
    expect(p.agente[0]).toBe('Mineral Group Guayana C.A.');
    expect(p.agente).toContain('RIF: J-50221930-7');
    expect(p.sujeto[0]).toBe('Ferretería El Tornillo C.A.');
    expect(p.sujeto).toContain('RIF: J-12345678-9');
  });

  it('la que nos practicaron: el agente es el cliente y el sujeto retenido, la empresa', () => {
    const p = partesComprobante(retencion({
      direccion: 'recibida', contraparteNombre: 'Cliente Minero S.A.', contraparteRif: 'J-87654321-0',
    }), empresa);
    expect(p.agente[0]).toBe('Cliente Minero S.A.');
    expect(p.agente).toContain('RIF: J-87654321-0');
    expect(p.sujeto[0]).toBe('Mineral Group Guayana C.A.');
    expect(p.sujeto).toContain('RIF: J-50221930-7');
  });

  it('el tipo de sujeto va con el sujeto retenido, nunca con el agente', () => {
    const recibida = partesComprobante(retencion({
      tipo: 'islr', direccion: 'recibida', contraparteNombre: 'Cliente Minero S.A.', contraparteRif: 'J-87654321-0',
      contraparteSujeto: 'pj_domiciliada',
    }), empresa);
    expect(recibida.agente).not.toContain('Persona jurídica domiciliada');
    const practicada = partesComprobante(retencion({
      tipo: 'islr', direccion: 'practicada', contraparteNombre: 'Pedro Pérez', contraparteRif: 'V-12345678-9',
      contraparteSujeto: 'pn_residente',
    }), empresa);
    expect(practicada.sujeto).toContain('Persona natural residente');
  });
});
