import { describe, it, expect } from 'vitest';
import { esVentaACredito, resumenVentas, calcVenta, type Venta } from './ventas.repository';

const venta = (p: Partial<Venta>): Venta => ({
  id: 'v1', numero: 'FAC-2026-0001', fecha: '2026-09-07', cliente_id: null,
  cliente_nombre: 'FERRETERIA SUR', estado: 'emitida', moneda: 'USD', items: [],
  descuento: 0, iva_pct: 0, iva_monto: 0, subtotal: 0, total: 100, costo_total: 60,
  ganancia: 40, ganancia_pct: 40, pagado_monto: 0,
  created_at: '', updated_at: '', ...p,
} as Venta);

describe('condición de pago', () => {
  it('es a crédito solo si lo dice el campo', () => {
    expect(esVentaACredito(venta({ condicion_pago: 'credito' }))).toBe(true);
    expect(esVentaACredito(venta({ condicion_pago: 'contado' }))).toBe(false);
  });

  it('una factura vieja, sin el campo, cuenta como contado', () => {
    // Las emitidas antes del crédito no traen `condicion_pago`.
    expect(esVentaACredito(venta({ condicion_pago: null }))).toBe(false);
    expect(esVentaACredito(venta({ condicion_pago: undefined }))).toBe(false);
  });
});

describe('KPIs con crédito', () => {
  it('«A crédito» suma solo las de crédito vivas', () => {
    const r = resumenVentas([
      venta({ id: 'a', condicion_pago: 'credito', total: 850, estado: 'emitida' }),
      venta({ id: 'b', condicion_pago: 'credito', total: 400, estado: 'pagada' }),
      venta({ id: 'c', condicion_pago: 'contado', total: 300, estado: 'pagada' }),
    ]);
    expect(r.aCredito).toBe(1250);
    expect(r.totalVendido).toBe(1550);
  });

  it('una factura anulada no cuenta como crédito ni como venta', () => {
    const r = resumenVentas([
      venta({ id: 'a', condicion_pago: 'credito', total: 850, estado: 'anulada' }),
      venta({ id: 'b', condicion_pago: 'credito', total: 100, estado: 'emitida' }),
    ]);
    expect(r.aCredito).toBe(100);
    expect(r.totalVendido).toBe(100);
  });

  it('un borrador todavía no es una venta', () => {
    const r = resumenVentas([venta({ condicion_pago: 'credito', estado: 'borrador', total: 999 })]);
    expect(r.aCredito).toBe(0);
    expect(r.facturas).toBe(0);
  });

  it('«Por cobrar» sigue contando las emitidas sin importar la condición', () => {
    const r = resumenVentas([
      venta({ id: 'a', condicion_pago: 'credito', total: 850, estado: 'emitida' }),
      venta({ id: 'b', condicion_pago: 'contado', total: 150, estado: 'emitida' }),
    ]);
    expect(r.porCobrar).toBe(1000);
    expect(r.cobrado).toBe(0);
  });

  it('sin facturas no divide por cero', () => {
    const r = resumenVentas([]);
    expect(r).toMatchObject({ aCredito: 0, totalVendido: 0, gananciaPct: 0 });
  });
});

describe('el total que se le debe al cliente', () => {
  it('la deuda es el total con descuento e IVA, no el subtotal', () => {
    // Es el monto que va a la cuenta por cobrar: tiene que ser el cobrable.
    const t = calcVenta(
      [{ producto_id: 'p', producto_nombre: 'X', almacen: 'General', cantidad: 10, tenor_pct: 0,
         precio_unit: 100, costo_unit: 60, subtotal: 1000, costo: 600, ganancia: 400 }],
      100, 16,
    );
    expect(t.total).toBe(1044);   // (1000 − 100) + 16%
    expect(t.ganancia).toBe(300); // 900 − 600
  });
});
