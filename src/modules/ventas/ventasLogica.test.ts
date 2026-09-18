import { describe, expect, it } from 'vitest';
import {
  calcItem, calcVenta, impuestosAplicados, valorMaterial, porCobrarEnDinero, errorIntercambio,
  diferenciasStock, cambiosVenta, exigirMotivo, prefijoDocumento, costoUnitMaterial,
  type PagoMaterial, type VentaItem,
} from './ventasLogica';

const item = (p: Partial<VentaItem>) => calcItem({ producto_id: 'p1', producto_nombre: 'ESTAÑO', almacen: 'MATANZA', cantidad: 10, precio_unit: 30, costo_unit: 20, ...p });
const mat = (p: Partial<PagoMaterial>): PagoMaterial => ({ producto_id: 'm1', producto_nombre: 'CASITERITA', almacen: 'LOS PINOS', cantidad: 50, valor: 100, ...p });

describe('documento e impuestos', () => {
  it('la nota de entrega no lleva impuestos aunque las casillas estén marcadas', () => {
    expect(impuestosAplicados({ tipo: 'nota_entrega', aplicaIva: true, ivaPct: 16, aplicaIgtf: true, igtfPct: 3 }))
      .toEqual({ iva_pct: 0, igtf_pct: 0 });
    expect(prefijoDocumento('nota_entrega')).toBe('NE');
    expect(prefijoDocumento('factura')).toBe('FAC');
  });

  it('en la factura cada impuesto cuenta solo con su casilla', () => {
    expect(impuestosAplicados({ tipo: 'factura', aplicaIva: true, ivaPct: 16, aplicaIgtf: false, igtfPct: 3 }))
      .toEqual({ iva_pct: 16, igtf_pct: 0 });
    expect(impuestosAplicados({ tipo: 'factura', aplicaIva: false, ivaPct: 16, aplicaIgtf: true, igtfPct: 3 }))
      .toEqual({ iva_pct: 0, igtf_pct: 3 });
  });

  it('IVA sobre la base, IGTF sobre base + IVA, y la ganancia sin impuestos', () => {
    const t = calcVenta([item({})], 0, 16, 3); // base 300
    expect(t.iva_monto).toBe(48);
    expect(t.igtf_monto).toBe(10.44);          // (300 + 48) × 3 %
    expect(t.total).toBe(358.44);
    expect(t.ganancia).toBe(100);              // 300 − 200
  });
});

describe('intercambio (pago con material)', () => {
  it('suma el valor del material y deja la diferencia por cobrar', () => {
    const pagos = [mat({}), mat({ producto_id: null, producto_nombre: 'CHATARRA', valor: 50 })];
    expect(valorMaterial(pagos)).toBe(150);
    expect(porCobrarEnDinero({ total: 300, condicion_pago: 'intercambio', valor_material: 150 })).toBe(150);
    expect(porCobrarEnDinero({ total: 300, condicion_pago: 'contado' })).toBe(300);
    expect(costoUnitMaterial(mat({}))).toBe(2);
  });

  it('no deja que el material valga más que la venta', () => {
    expect(errorIntercambio(300, [mat({ valor: 301 })])).toMatch(/vale más/);
    expect(errorIntercambio(300, [mat({ valor: 300 })])).toBeNull();
    expect(errorIntercambio(300, [])).toMatch(/Agregá el material/);
    expect(errorIntercambio(300, [mat({ almacen: '' })])).toMatch(/almacén/);
  });
});

describe('editar una venta emitida: solo la diferencia', () => {
  it('más cantidad sale, menos reingresa, y lo igual no se toca', () => {
    const d = diferenciasStock(
      [item({ cantidad: 10 }), item({ producto_id: 'p2', producto_nombre: 'LINGOTE', cantidad: 4 })],
      [item({ cantidad: 12 }), item({ producto_id: 'p2', producto_nombre: 'LINGOTE', cantidad: 4 }), item({ producto_id: 'p3', producto_nombre: 'ESCORIA', cantidad: 1 })],
    );
    expect(d).toEqual([
      { producto_id: 'p1', almacen: 'MATANZA', producto_nombre: 'ESTAÑO', delta: 2 },
      { producto_id: 'p3', almacen: 'MATANZA', producto_nombre: 'ESCORIA', delta: 1 },
    ]);
  });

  it('cambiar de almacén devuelve a uno y saca del otro', () => {
    const d = diferenciasStock([item({ almacen: 'A' })], [item({ almacen: 'B' })]);
    expect(d.map((x) => [x.almacen, x.delta])).toEqual([['A', -10], ['B', 10]]);
  });
});

describe('trazabilidad', () => {
  it('describe lo que cambió', () => {
    const c = cambiosVenta(
      { cliente_nombre: 'ACME', total: 300, items: [item({})], pago_material: [mat({})] },
      { cliente_nombre: 'ACME C.A.', total: 360, items: [item({ cantidad: 12 })], pago_material: [mat({ cantidad: 60, valor: 120 })] },
    );
    expect(c).toContain('Cliente: ACME → ACME C.A.');
    expect(c).toContain('ESTAÑO: cantidad 10 → 12');
    expect(c).toContain('Material CASITERITA: 50 por 100 → 60 por 120');
    expect(c).toContain('Total: 300 → 360');
  });

  it('el motivo es obligatorio', () => {
    expect(() => exigirMotivo('  ', 'anular')).toThrow(/motivo/);
    expect(() => exigirMotivo('ok', 'anular')).toThrow(/corto/);
    expect(exigirMotivo(' Cliente devolvió ', 'anular')).toBe('Cliente devolvió');
  });
});
