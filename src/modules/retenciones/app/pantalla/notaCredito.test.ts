import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../datos/puerta';
import { filaNotaCredito, puedeNotaCredito, retencionDeNota, subtituloNota, validarNotaCredito } from './notaCredito';

// Datos inventados.
const iva = (over: Partial<RetencionPracticada> = {}) => ({
  id: 'r1', tipo: 'iva', direccion: 'practicada', estado: 'registrada', anulada: false, facturaNumero: '000123', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Alfa C.A.', baseImponible: 1000, impuesto: 160, porcentaje: 75,
  moneda: 'Bs', tasa: null, ...over,
}) as RetencionPracticada;
const datos = { numero: 'NC-0001', control: '00-0001', fecha: '2026-10-10', total: '232', iva: '32' };

describe('la nota de crédito (maqueta v8-12 §4; documento_tipo, documento_afectado y afecta_a del paquete 07)', () => {
  it('se registra desde una retención de IVA practicada y vigente', () => {
    expect(puedeNotaCredito(iva())).toBe(true);
    expect(puedeNotaCredito(iva({ estado: 'declarada' }))).toBe(true);
    expect(puedeNotaCredito(iva({ anulada: true }))).toBe(false);
    expect(puedeNotaCredito(iva({ tipo: 'islr' }))).toBe(false);
    expect(puedeNotaCredito(iva({ direccion: 'recibida' }))).toBe(false);
    expect(puedeNotaCredito(iva({ facturaNumero: null }))).toBe(false);
  });
  it('el subtítulo nombra la factura afectada', () => {
    expect(subtituloNota(iva())).toBe('Afecta a la factura 000123 · Proveedor Alfa C.A. · OC-0001');
  });
  it('lo pendiente, como la maqueta; el IVA de la nota no supera el de la factura', () => {
    expect(validarNotaCredito(datos, iva())).toBeNull();
    expect(validarNotaCredito({ ...datos, numero: '', total: '0' }, iva())).toBe('Pendiente: el N° de la nota, el monto total.');
    expect(validarNotaCredito({ ...datos, iva: '' }, iva())).toBe('Pendiente: el IVA.');
    expect(validarNotaCredito({ ...datos, iva: '200' }, iva())).toBe('Pendiente: un IVA que no supere el de la factura (160,00).');
    expect(validarNotaCredito({ ...datos, total: '20', iva: '32' }, iva())).toBe('Pendiente: un IVA que no supere el monto total de la nota.');
  });
  it('la retención de la nota: el mismo % de la factura sobre su IVA; resta por su tipo de documento', () => {
    expect(retencionDeNota(32, 75)).toBe(24);
    expect(retencionDeNota(12.5, 75)).toBe(9.38);
  });
  it('la fila: tipo nota_credito, enlazada a la retención de la factura y con su número', () => {
    const f = filaNotaCredito(iva(), datos);
    expect(f).toMatchObject({
      tipo: 'iva', direccion: 'practicada', documento_tipo: 'nota_credito', afecta_a: 'r1', documento_afectado: '000123',
      factura_numero: 'NC-0001', factura_control: '00-0001', factura_fecha: '2026-10-10', contraparte_id: 'p1', contraparte_rif: 'J-00000001-0',
      base_imponible: 200, impuesto: 32, porcentaje: 75, monto_retenido: 24, moneda: 'Bs',
    });
  });
});
