/* Movimientos de Auxiliares (Informes > Informes de Movimientos de Cuentas, photo_55): el mayor por
   tercero. Sobre los datos de prueba, se le pone un auxiliar a renglones conocidos de la caja. */
import { describe, expect, it } from 'vitest';
import { estadoDePrueba } from '../pruebas/datosPrueba';
import { filasAuxiliares } from '../librosExport';
import { auxiliaresConEquivalente, movimientosAuxiliares, type FuenteInforme } from './reportes';
import type { ContAuxiliar } from '../tipos';

const aux = (id: string, tipo: ContAuxiliar['tipo'], codigo: string): ContAuxiliar =>
  ({ id, tipo, codigo, nombre: `TERCERO ${codigo}`, rif: null, origen_tabla: null, origen_id: null, activo: true });

function fuente(): { f: FuenteInforme; antes: number; despues: number } {
  const e = estadoDePrueba();
  const comp = new Map(e.cont_comprobantes.map((c) => [c.id, c]));
  const caja = e.cont_cuentas.find((c) => c.codigo === '1.1.01.01.002')!;
  const deCaja = e.cont_comprobante_lineas
    .filter((l) => l.cuenta_id === caja.id && comp.get(l.comprobante_id)?.estado === 'contabilizado')
    .sort((a, b) => comp.get(a.comprobante_id)!.fecha.localeCompare(comp.get(b.comprobante_id)!.fecha));
  const antes = deCaja.find((l) => comp.get(l.comprobante_id)!.fecha < '2026-02-01')!;
  const despues = deCaja.find((l) => comp.get(l.comprobante_id)!.codigo === '02-000002')!;
  const lineas = e.cont_comprobante_lineas.map((l) => (l === antes || l === despues ? { ...l, auxiliar_id: 'a-1' } : { ...l, auxiliar_id: null }));
  return {
    f: {
      comprobantes: e.cont_comprobantes, lineas, cuentas: e.cont_cuentas, centros: e.cont_centros_costo,
      auxiliares: [aux('a-1', 'proveedor', 'P001'), aux('a-2', 'cliente', 'C001')],
    },
    antes: antes.debe_usd - antes.haber_usd,
    despues: despues.debe_usd - despues.haber_usd,
  };
}

describe('Movimientos de Auxiliares', () => {
  it('saldo inicial antes del rango, los renglones del rango con su cuenta y el saldo corrido', () => {
    const { f, antes, despues } = fuente();
    const r = movimientosAuxiliares(f, { desde: '2026-02-01', hasta: '2026-12-31', moneda: 'USD' });
    expect(r).toHaveLength(1);
    const [a] = r;
    expect(a.auxiliar.codigo).toBe('P001');
    expect(a.saldoInicial).toBe(antes);
    expect(a.movimientos).toEqual([expect.objectContaining({ comprobante: '02-000002', cuenta: '1.1.01.01.002', saldo: antes + despues })]);
    expect(a.saldoFinal).toBe(antes + despues);
    expect(a.debe - a.haber).toBe(despues);
  });

  it('el tercero sin movimientos en el rango solo sale si se piden los que tienen saldo inicial', () => {
    const { f } = fuente();
    const filtro = { desde: '2026-11-01', hasta: '2026-12-31', moneda: 'USD' as const };
    expect(movimientosAuxiliares(f, filtro)).toHaveLength(0);
    const [a] = movimientosAuxiliares(f, { ...filtro, incluirSinMovimiento: true });
    expect(a.movimientos).toHaveLength(0);
    expect(a.saldoFinal).toBe(a.saldoInicial);
  });

  it('filtra por tipo y por código Desde/Hasta', () => {
    const { f } = fuente();
    const base = { desde: '2026-01-01', hasta: '2026-12-31', moneda: 'USD' as const };
    expect(movimientosAuxiliares(f, { ...base, tipo: 'cliente' })).toHaveLength(0);
    expect(movimientosAuxiliares(f, { ...base, tipo: 'proveedor' })).toHaveLength(1);
    expect(movimientosAuxiliares(f, { ...base, auxiliarDesde: 'P002' })).toHaveLength(0);
  });

  it('el equivalente en Bs viaja en eq, renglón por renglón', () => {
    const { f } = fuente();
    const filtro = { desde: '2026-02-01', hasta: '2026-12-31', moneda: 'USD' as const };
    const [a] = auxiliaresConEquivalente(movimientosAuxiliares(f, filtro), movimientosAuxiliares(f, { ...filtro, moneda: 'VES' }));
    const [ves] = movimientosAuxiliares(f, { ...filtro, moneda: 'VES' });
    expect(a.eq).toMatchObject({ saldoInicial: ves.saldoInicial, saldoFinal: ves.saldoFinal });
    expect(a.movimientos[0].eq?.saldo).toBe(ves.movimientos[0].saldo);
  });

  it('en PDF y Excel: bloque del tercero, saldo inicial, renglones y TOTALES', () => {
    const { f } = fuente();
    const filas = filasAuxiliares(movimientosAuxiliares(f, { desde: '2026-02-01', hasta: '2026-12-31', moneda: 'USD' }));
    expect(filas.map((x) => x.tipo)).toEqual(['bloque', 'titulo', 'datos', 'total']);
    expect(filas[0]).toMatchObject({ texto: 'Auxiliar: Proveedor P001 - TERCERO P001' });
  });
});
