import { describe, expect, it } from 'vitest';
import { resumenVentas, saldoPorCobrar, cobradoEnCaja, efectosAnulacion, type Venta } from './ventas.repository';

const venta = (p: Partial<Venta>): Venta => ({
  id: 'v1', numero: 'FAC-2026-0001', fecha: '2026-09-18', cliente_id: null, tipo_documento: 'factura',
  cliente_nombre: 'ACME', estado: 'emitida', moneda: 'USD', items: [],
  descuento: 0, iva_pct: 0, iva_monto: 0, igtf_monto: 0, subtotal: 300, total: 300, costo_total: 200,
  ganancia: 100, ganancia_pct: 33.33, pagado_monto: 0, created_at: '', updated_at: '', ...p,
} as Venta);

describe('intercambio: lo que falta en dinero', () => {
  it('una emitida debe la diferencia que el material no cubrió', () => {
    const v = venta({ condicion_pago: 'intercambio', valor_material: 120, pagado_monto: 120 });
    expect(saldoPorCobrar(v)).toBe(180);
    expect(resumenVentas([v]).porCobrar).toBe(180);
    expect(resumenVentas([v]).materialRecibido).toBe(120);
  });

  it('cobrada la diferencia no debe nada y cuenta lo cobrado en caja', () => {
    const v = venta({ condicion_pago: 'intercambio', estado: 'pagada', valor_material: 120, cobrado_caja: 180, pagado_monto: 300, caja_mov_id: 'm1' });
    expect(saldoPorCobrar(v)).toBe(0);
    expect(cobradoEnCaja(v)).toBe(180);
  });

  it('los impuestos suman aparte y no inflan la ganancia', () => {
    const r = resumenVentas([venta({ iva_monto: 48, igtf_monto: 10.44, total: 358.44 })]);
    expect(r.impuestos).toBe(58.44);
    expect(r.gananciaPct).toBe(33.33);
  });
});

describe('anular: qué se revierte', () => {
  it('devuelve lo vendido, saca el material y devuelve la caja', () => {
    const e = efectosAnulacion(venta({
      estado: 'pagada', condicion_pago: 'intercambio', cobrado_caja: 180, caja_id: 'c1', caja_mov_id: 'm1',
      items: [{ producto_id: 'p', producto_nombre: 'ESTAÑO', almacen: 'MATANZA', cantidad: 10, unidad: 'KG', tenor_pct: 0, precio_unit: 30, costo_unit: 20, subtotal: 300, costo: 200, ganancia: 100 }],
      pago_material: [{ producto_id: 'm', producto_nombre: 'CASITERITA', almacen: 'LOS PINOS', cantidad: 50, valor: 120 }],
    }));
    expect(e.join(' ')).toMatch(/Vuelven al inventario: 10 KG ESTAÑO \(MATANZA\)/);
    expect(e.join(' ')).toMatch(/Sale del inventario el material recibido: 50 CASITERITA/);
    expect(e.join(' ')).toMatch(/Se devuelve 180 USD/);
  });

  it('un borrador no tiene nada que revertir', () => {
    expect(efectosAnulacion(venta({ estado: 'borrador' }))[0]).toMatch(/borrador/);
  });
});
