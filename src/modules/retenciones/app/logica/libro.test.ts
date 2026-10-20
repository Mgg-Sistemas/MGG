import { describe, expect, it } from 'vitest';
import { filasLibro, resumenPorMoneda, type RetencionParaLibro } from './libro';

// Datos ficticios
const ret = (over: Partial<RetencionParaLibro> = {}): RetencionParaLibro => ({
  id: 'r1', tipo: 'iva', direccion: 'practicada', estado: 'registrada', origen: 'mgg',
  proveedor: 'Proveedor de prueba', rif: 'J-00000000-0', factura: '000123', control: '00-000123', fecha: '2026-10-05', tramo: 1,
  base: 1000, impuesto: 160, total: 1160, exento: 0, porcentaje: 75, retenido: 120, numero: '20261000000001',
  moneda: 'Bs', tasa: null, tipoDocumento: 'factura', facturaAfectada: null, lineas: null, ...over,
});

describe('las filas del Libro', () => {
  it('una retención en Bs pasa tal cual, como factura', () => {
    const [f] = filasLibro([ret()]);
    expect(f).toMatchObject({ base: 1000, impuesto: 160, total: 1160, retenido: 120, moneda: 'Bs', tipoDoc: 'FC', anulada: false });
  });

  it('en USD con tasa, pasa a Bs con la tasa de la retención y guarda la moneda original', () => {
    const [f] = filasLibro([ret({ moneda: 'USD', tasa: 40, base: 100, impuesto: 16, total: 116, retenido: 12 })]);
    expect(f).toMatchObject({ base: 4000, impuesto: 640, total: 4640, retenido: 480, moneda: 'Bs', monedaOriginal: 'USD', tasa: 40 });
  });

  it('en USD sin tasa, se queda en USD (no se suma con los Bs)', () => {
    const [f] = filasLibro([ret({ moneda: 'USD', tasa: null, retenido: 12 })]);
    expect(f).toMatchObject({ retenido: 12, moneda: 'USD', sinTasa: true });
  });

  it('la nota de crédito resta: base, IVA, total y retenido en negativo, con su factura afectada', () => {
    const [f] = filasLibro([ret({ tipoDocumento: 'nota_credito', factura: 'NC-000045', facturaAfectada: '000123', base: 200, impuesto: 32, total: 232, retenido: 24 })]);
    expect(f).toMatchObject({ tipoDoc: 'NC', base: -200, impuesto: -32, total: -232, retenido: -24, facturaAfectada: '000123' });
  });

  it('una retención con varias líneas da una fila por línea, cada una con su % y su monto', () => {
    const filas = filasLibro([ret({
      tipo: 'islr', retenido: 1600, lineas: [
        { clave: '002', descripcion: 'Honorarios (ejemplo)', base: 30000, porcentaje: 3, monto: 900 },
        { clave: '004', descripcion: 'Comisiones (ejemplo)', base: 14000, porcentaje: 5, monto: 700 },
      ],
    })]);
    expect(filas.map((f) => [f.concepto, f.base, f.porcentaje, f.retenido])).toEqual([['002', 30000, 3, 900], ['004', 14000, 5, 700]]);
  });

  it('las líneas en USD también pasan a Bs', () => {
    const filas = filasLibro([ret({ tipo: 'municipal', moneda: 'USD', tasa: 40, lineas: [{ clave: '3.3.29', descripcion: 'x', base: 60, porcentaje: 2.5, monto: 1.5 }] })]);
    expect(filas[0]).toMatchObject({ base: 2400, retenido: 60 });
  });

  it('una anulada se marca como anulada', () => {
    expect(filasLibro([ret({ estado: 'anulada' })])[0].anulada).toBe(true);
  });
});

describe('el resumen del Libro, por moneda', () => {
  const filas = filasLibro([
    ret({ id: 'a', retenido: 120 }),
    ret({ id: 'b', retenido: 50, estado: 'declarada' }),
    ret({ id: 'c', retenido: 30, origen: 'otro_sistema' }),
    ret({ id: 'd', retenido: 999, estado: 'anulada' }),
    ret({ id: 'e', retenido: 12, moneda: 'USD', tasa: null }),
    ret({ id: 'f', retenido: 40, direccion: 'recibida' }),
  ]);

  it('sin lo gestionado en otro sistema (por defecto): no lo suma', () => {
    const r = resumenPorMoneda(filas, { incluirOtroSistema: false });
    const bs = r.find((x) => x.moneda === 'Bs')?.resumen;
    expect(bs).toMatchObject({ porEnterar: 120, enterado: 50, aFavor: 40, anulados: 1 });
    expect(r.find((x) => x.moneda === 'USD')?.resumen.porEnterar).toBe(12);
  });

  it('con el interruptor encendido, suma lo gestionado en otro sistema', () => {
    const bs = resumenPorMoneda(filas, { incluirOtroSistema: true }).find((x) => x.moneda === 'Bs')?.resumen;
    expect(bs?.porEnterar).toBe(150);
  });
});
