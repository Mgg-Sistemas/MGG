import { describe, expect, it } from 'vitest';
import { generarPendientes, notaPendiente, type GastoGenerable } from './administracionGenerar';

const g = (p: Partial<GastoGenerable>): GastoGenerable => ({
  id: 'gf1', empresaClave: 'GT', concepto: 'Agua', monto: 100, moneda: 'USD',
  categoriaGastoId: null, periodicidad: 'mensual', diaVencimiento: 5, vigenteDesde: '2026-09-01', estado: 'activo', ...p,
});
const hasta = new Date(2026, 10, 15); // 2026-11-15

describe('generarPendientes', () => {
  it('crea un pendiente por período desde vigenteDesde hasta el corte', () => {
    const nuevos = generarPendientes([g({})], [], hasta);
    expect(nuevos.map((n) => n.periodo)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(nuevos[0]).toMatchObject({ gastoFijoId: 'gf1', estadoPago: 'pendiente', origen: 'generado', moneda: 'USD', monto: 100 });
    expect(nuevos[0].fecha).toBe('2026-09-05');
  });

  it('no duplica los que ya existen (idempotente)', () => {
    const existentes = [{ gastoFijoId: 'gf1', periodo: '2026-09' }, { gastoFijoId: 'gf1', periodo: '2026-10' }];
    const nuevos = generarPendientes([g({})], existentes, hasta);
    expect(nuevos.map((n) => n.periodo)).toEqual(['2026-11']);
    // correrlo otra vez sumando el nuevo → ya no genera nada
    expect(generarPendientes([g({})], [...existentes, { gastoFijoId: 'gf1', periodo: '2026-11' }], hasta)).toEqual([]);
  });

  it('ignora los suspendidos', () => {
    expect(generarPendientes([g({ estado: 'suspendido' })], [], hasta)).toEqual([]);
  });

  it('varias empresas/gastos, ordenado por fecha', () => {
    const nuevos = generarPendientes([
      g({ id: 'a', concepto: 'Agua', diaVencimiento: 20, vigenteDesde: '2026-11-01' }),
      g({ id: 'b', empresaClave: 'MTO', concepto: 'Luz', diaVencimiento: 3, vigenteDesde: '2026-11-01' }),
    ], [], hasta);
    expect(nuevos.map((n) => n.fecha)).toEqual(['2026-11-03', '2026-11-20']);
    expect(nuevos.map((n) => n.empresaClave)).toEqual(['MTO', 'GT']);
  });

  it('es determinista', () => {
    expect(generarPendientes([g({})], [], hasta)).toEqual(generarPendientes([g({})], [], hasta));
  });

  it('la nota del pendiente', () => {
    expect(notaPendiente('Golden Touch', 'Noviembre 2026')).toBe('Gasto fijo · Golden Touch · Noviembre 2026');
  });
});
