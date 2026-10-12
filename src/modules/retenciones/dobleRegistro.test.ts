import { describe, expect, it } from 'vitest';
import {
  mensajeDobleRegistro, normalizarFactura, normalizarRif, retencionYaRegistrada, type ClaveRetencion,
} from './dobleRegistro';

// Datos inventados: ningún proveedor ni factura real.
const previa = (over: Partial<ClaveRetencion & { anulada: boolean; id: string }> = {}) => ({
  id: 'r-1', direccion: 'practicada' as const, tipo: 'iva' as const,
  contraparteRif: 'J-00000001-0', facturaNumero: '000123', anulada: false, ...over,
});
const nueva = (over: Partial<ClaveRetencion> = {}): ClaveRetencion => ({
  direccion: 'practicada', tipo: 'iva', contraparteRif: 'J-00000001-0', facturaNumero: '000123', ...over,
});

describe('una sola retención de cada impuesto por factura', () => {
  it('la misma factura, el mismo impuesto y la misma dirección: ya está registrada', () => {
    expect(retencionYaRegistrada([previa()], nueva())?.id).toBe('r-1');
  });

  it('reconoce la factura aunque el RIF o el número vengan escritos distinto', () => {
    expect(retencionYaRegistrada([previa()], nueva({ contraparteRif: 'j00000001 0', facturaNumero: '123' }))?.id).toBe('r-1');
  });

  it('la anulada no cuenta', () => {
    expect(retencionYaRegistrada([previa({ anulada: true })], nueva())).toBeNull();
  });

  it('otro impuesto, otra dirección, otra factura u otro proveedor: no choca', () => {
    expect(retencionYaRegistrada([previa()], nueva({ tipo: 'islr' }))).toBeNull();
    expect(retencionYaRegistrada([previa()], nueva({ direccion: 'recibida' }))).toBeNull();
    expect(retencionYaRegistrada([previa()], nueva({ facturaNumero: '124' }))).toBeNull();
    expect(retencionYaRegistrada([previa()], nueva({ contraparteRif: 'J-00000002-0' }))).toBeNull();
  });

  it('el IGTF no entra: es una percepción por pago', () => {
    expect(retencionYaRegistrada([previa({ tipo: 'igtf' })], nueva({ tipo: 'igtf' }))).toBeNull();
  });

  it('sin RIF o sin N° de factura no se puede reconocer la factura: no bloquea', () => {
    expect(retencionYaRegistrada([previa({ contraparteRif: null })], nueva({ contraparteRif: null }))).toBeNull();
    expect(retencionYaRegistrada([previa({ facturaNumero: '' })], nueva({ facturaNumero: '' }))).toBeNull();
  });

  it('normaliza RIF y factura', () => {
    expect(normalizarRif(' j-00.000.001-0 ')).toBe('J000000010');
    expect(normalizarFactura('00-0123 ')).toBe('123');
  });

  it('el aviso nombra la retención que ya existe', () => {
    const m = mensajeDobleRegistro({ ...nueva(), contraparteNombre: 'Proveedor de prueba', numeroComprobante: '20260900000001' });
    expect(m).toContain('000123');
    expect(m).toContain('Proveedor de prueba');
    expect(m).toContain('20260900000001');
    expect(m).toContain('anulá la anterior');
  });
});
