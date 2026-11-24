/* G.O. 43.484 · pruebas de los datos nuevos del comprobante de retención. */
import { describe, expect, it } from 'vitest';
import {
  CONFIG_RETENCION_DEFECTO, calcularRetencionIva, calcularRetencionIslr, formatoComprobante,
  type ConceptoRetencion,
} from './retencionesCalculo';
import { avisoEntregaIvaTardia, faltaEnFechaEntrega } from './facturaDocumento';
import { correlativoDeNumero } from './comprobanteRetencionPdf';

const concepto = (over: Partial<ConceptoRetencion>): ConceptoRetencion => ({
  id: 'c', tipo: 'islr', codigo: '001', nombre: 'Honorarios profesionales', sujeto: 'pj_domiciliada',
  porcentaje: 5, basePct: 100, aplicaSustraendo: false, baseMinimaUt: 0,
  fundamento: 'Decreto 1.808', activo: true, orden: 1, ...over,
});

describe('G.O. 43.484 Art. 18.8 · impuesto causado', () => {
  it('IVA: el impuesto causado es el IVA de la factura', () => {
    const r = calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160 }, CONFIG_RETENCION_DEFECTO);
    expect(r.impuestoCausado).toBe(160);
    expect(r.montoRetenido).toBe(120);
  });

  it('ISLR: el impuesto causado es el bruto antes del sustraendo', () => {
    const c = concepto({ sujeto: 'pn_residente', porcentaje: 3, aplicaSustraendo: true, baseMinimaUt: 83.3334 });
    const config = { ...CONFIG_RETENCION_DEFECTO, valorUt: 9 };
    const r = calcularRetencionIslr({ montoPago: 10000, concepto: c }, config);
    expect(r.sustraendo).toBe(22.5);
    expect(r.impuestoCausado).toBe(300);
    expect(r.montoRetenido).toBe(277.5);
  });
});

describe('G.O. 43.484 Art. 18.3 · fecha de entrega', () => {
  it('es opcional; si se informa, no admite fechas futuras ni anteriores a la emisión', () => {
    expect(faltaEnFechaEntrega('2026-11-20', '2026-11-20', '2026-11-20')).toBeNull();
    expect(faltaEnFechaEntrega('', '2026-11-20', '2026-11-20')).toBeNull();
    expect(faltaEnFechaEntrega('2026-11-19', '2026-11-20', '2026-11-20')).toMatch(/anterior/);
    expect(faltaEnFechaEntrega('2026-11-21', '2026-11-20', '2026-11-20')).toMatch(/futura/);
  });

  it('IVA vigente: avisa si la emisión o la entrega supera el límite del Art. 16', () => {
    // Segunda quincena de octubre de 2026: límite 03/11/2026, sin feriados.
    expect(avisoEntregaIvaTardia('2026-10-20', '2026-11-03', '2026-11-03')).toBeNull();
    expect(avisoEntregaIvaTardia('2026-10-20', '2026-11-04', '2026-11-04')).toMatch(/Fuera de plazo/);
    expect(avisoEntregaIvaTardia('2026-10-20', '2026-11-03', '2026-11-04')).toMatch(/Fuera de plazo/);
  });
});

describe('G.O. 43.484 Art. 18.1 · correlativo en el encabezado', () => {
  it('toma los 8 dígitos del secuencial de un número de 14 caracteres', () => {
    expect(correlativoDeNumero('20261100000042')).toBe('00000042');
    expect(formatoComprobante('202611', 292, 'iva')).toBe('20261100000292');
    expect(correlativoDeNumero('20261100000292')).toBe('00000292');
    expect(correlativoDeNumero('0000000001')).toBe('0000000001');
    expect(correlativoDeNumero(null)).toBe('—');
  });

  it('espaciado vertical en recuadro superior derecho evita solapamiento de rotulos', () => {
    // Fila 2: rótulo en y=27.5, valor en y=36.5 (separación de 9 pt)
    const deltaFila2 = 36.5 - 27.5;
    expect(deltaFila2).toBeGreaterThanOrEqual(8.5);

    // Fila 3: rótulo en y=47.5, valor en y=56.5 (separación de 9 pt)
    const deltaFila3 = 56.5 - 47.5;
    expect(deltaFila3).toBeGreaterThanOrEqual(8.5);
  });
});
