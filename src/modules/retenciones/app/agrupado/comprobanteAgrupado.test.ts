import { describe, expect, it } from 'vitest';
import { lineasAgrupado, quincenaDe, subtituloAgrupado, validarAgrupado, type ItemAgrupado } from './comprobanteAgrupado';

// Datos inventados.
const it0 = (over: Partial<ItemAgrupado> = {}): ItemAgrupado => ({
  clave: 'd1:iva', impuesto: 'iva', proveedorId: 'p1', proveedorNombre: 'Proveedor Alfa C.A.', rif: 'J-00000001-0', factura: '000123', fecha: '2026-10-05',
  moneda: 'Bs', base: 1000, iva: 160, pct: 75, retenido: 120, registrada: false, ...over,
});

describe('el comprobante agrupado (maqueta v8 abrirAgrupado y v8-12 §3; M1)', () => {
  it('la quincena: hasta el 15 es la 1.ª', () => {
    expect(quincenaDe('2026-10-15')).toBe('2026-10-1');
    expect(quincenaDe('2026-10-16')).toBe('2026-10-2');
  });
  it('se puede: IVA, mismo proveedor, quincena y moneda, sin registrar y con el interruptor encendido', () => {
    expect(validarAgrupado([it0(), it0({ clave: 'd2:iva', factura: '000124', fecha: '2026-10-10' })], true)).toBeNull();
  });
  it('lo que no se puede, en un solo mensaje como la maqueta', () => {
    const xs = [it0(), it0({ clave: 'd2:islr', impuesto: 'islr', proveedorId: 'p2', fecha: '2026-10-20', moneda: 'USD', registrada: true })];
    expect(validarAgrupado(xs, false)).toBe(
      'No se puede agrupar: las retenciones seleccionadas son de impuestos distintos; las facturas son de proveedores distintos; las facturas son de períodos distintos (quincena); '
      + 'hay retenciones ya registradas en la selección; el comprobante agrupado está apagado (Ajustes avanzados › IVA › Interruptores propios); solo el IVA se agrupa; '
      + 'las facturas tienen monedas distintas. Un comprobante agrupa facturas del mismo proveedor, impuesto y período.',
    );
    expect(validarAgrupado([], true)).toBe('No se puede agrupar: no hay facturas seleccionadas.');
  });
  it('las líneas por fecha, con su total', () => {
    const l = lineasAgrupado([it0({ fecha: '2026-10-10', factura: 'B' }), it0({ fecha: '2026-10-02', factura: 'A', base: 500, iva: 80, retenido: 60 })]);
    expect(l.lineas.map((x) => x.factura)).toEqual(['A', 'B']);
    expect(l.total).toEqual({ base: 1500, iva: 240, retenido: 180 });
  });
  it('el subtítulo', () => {
    expect(subtituloAgrupado([it0(), it0({ clave: 'd2:iva' })])).toBe('IVA · Proveedor Alfa C.A. · 2 factura(s)');
  });
});
