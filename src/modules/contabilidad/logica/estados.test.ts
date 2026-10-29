/* Estados financieros con los datos chicos de prueba y una estructura chica con la misma forma que la
   de BD (renglones por rubro o por cuenta, signo, especial, subtotales). Los números reales los prueba
   simulacion/estadosBd.test.ts contra los esperados de BD. */
import { describe, expect, it } from 'vitest';
import { estadoDePrueba } from '../pruebas/datosPrueba';
import { ESTRUCTURA_PRUEBA as EST } from '../pruebas/estructuraPrueba';
import {
  balanceGeneral, columnasResultados, cuadraBalance, estadoConEquivalente, estadoResultados, valorDe,
  type EstructuraEF, type FuenteEstados,
} from './estados';

const e = estadoDePrueba();
const f: FuenteEstados = { comprobantes: e.cont_comprobantes, lineas: e.cont_comprobante_lineas, cuentas: e.cont_cuentas };
const ej = e.cont_ejercicios[0];

const renglones = (x: ReturnType<typeof estadoResultados>) => x.bloques.flatMap((b) => (b.tipo === 'seccion' ? b.grupos.flatMap((g) => g.renglones) : []));

describe('Estado de Resultados (estructura como dato)', () => {
  // Datos de prueba, en $: ventas 8.000; sueldos 3.000, combustible 23.100 Bs ÷ 115,50 = 200, depreciación 1.500,
  // comisión 25 reversada (neto 0); el descuadrado de octubre no entra.
  const res = estadoResultados(f, EST, { columnas: columnasResultados('acumulado', '2026-12', ej), moneda: 'USD' });

  it('cada renglón con su signo, el total de cada sección y los subtotales en la secuencia de Galac', () => {
    expect(['R-01', 'TOTAL INGRESOS', 'R-03', 'R-04', 'TOTAL EGRESOS', 'UTILIDAD BRUTA', 'RESULTADO OPERATIVO', 'R-06', 'RESULTADO DEL EJERCICIO']
      .map((k) => valorDe(res, k))).toEqual([8000, 8000, 3000, 1700, 4700, 8000, 3300, 0, 3300]);
    expect(res.bloques.map((b) => (b.tipo === 'seccion' ? b.nombre : `= ${b.etiqueta}`))).toEqual([
      'INGRESOS', 'COSTOS', '= UTILIDAD BRUTA', 'EGRESOS', '= RESULTADO OPERATIVO', 'OTROS INGRESOS Y EGRESOS', '= RESULTADO DEL EJERCICIO',
    ]);
  });

  it('«Detallar cuentas» lista las cuentas del renglón con valor (la comisión reversada da 0 y no sale)', () => {
    const det = estadoResultados(f, EST, { columnas: columnasResultados('acumulado', '2026-12', ej), moneda: 'USD', detallar: true });
    expect(renglones(det).find((x) => x.codigo === 'R-04')!.detalle.map((x) => [x.cuenta.codigo, x.valores[0]]))
      .toEqual([['6.1.02.01.001', 200], ['6.1.02.01.004', 1500]]);
    expect(renglones(det).find((x) => x.codigo === 'R-06')!.detalle).toEqual([]);
  });

  it('en Bs, el gasto en bolívares sale por su monto', () => {
    const bs = estadoResultados(f, EST, { columnas: columnasResultados('mensual', '2026-05', ej), moneda: 'VES' });
    expect(valorDe(bs, 'TOTAL EGRESOS')).toBe(23100);
  });

  it('Comparativo: el mes contra el anterior; Mes a Mes: cada mes y el total', () => {
    const comp = estadoResultados(f, EST, { columnas: columnasResultados('comparativo', '2026-04', ej), moneda: 'USD' });
    expect(comp.columnas.map((x) => x.etiqueta)).toEqual(['Marzo 2026', 'Abril 2026']);
    expect([0, 1].map((i) => valorDe(comp, 'RESULTADO DEL EJERCICIO', i))).toEqual([8000, -3000]);
    const mm = columnasResultados('mes_a_mes', '2026-03', ej);
    expect(mm.map((x) => x.etiqueta)).toEqual(['Enero 2026', 'Febrero 2026', 'Marzo 2026', 'Total']);
    expect(columnasResultados('comparativo_acumulado', '2026-04', ej).map((x) => [x.desde, x.hasta]))
      .toEqual([['2026-01-01', '2026-03-31'], ['2026-01-01', '2026-04-30']]);
  });

  it('un subtotal que nombra una sección inexistente no da cero en silencio', () => {
    const mala: EstructuraEF = { ...EST, estado_resultados: { titulo: 'x', secciones: [{ subtotal: 'UTILIDAD', de: ['VENTAS'] }] } };
    expect(() => estadoResultados(f, mala, { columnas: columnasResultados('mensual', '2026-05', ej), moneda: 'USD' }))
      .toThrow('El subtotal «UTILIDAD» suma la sección «VENTAS», que no existe antes que él en la estructura.');
  });
});

describe('Balance General (estructura como dato)', () => {
  const b = balanceGeneral(f, EST, { cortes: [{ etiqueta: 'Al 31/12/2026', hasta: '2026-12-31' }], ejercicios: e.cont_ejercicios, moneda: 'USD' });

  it('secciones, grupos y totales de la estructura, y cuadra: Activo = Pasivo + Patrimonio', () => {
    expect(b.bloques.map((x) => (x.tipo === 'seccion' ? [x.nombre, x.grupos.map((g) => g.nombre)] : null))).toEqual([
      ['ACTIVO', ['ACTIVO CORRIENTE', 'ACTIVO NO CORRIENTE']], ['PASIVO', ['PASIVO CORRIENTE', 'PASIVO NO CORRIENTE']], ['PATRIMONIO', ['PATRIMONIO']],
    ]);
    expect(b.totales.map((t) => t.etiqueta)).toEqual(['TOTAL ACTIVO', 'TOTAL PASIVO', 'TOTAL PATRIMONIO', 'TOTAL PASIVO Y PATRIMONIO']);
    expect(cuadraBalance(b)).toEqual([true]);
  });

  it('el resultado del ejercicio suma lo que sigue en las cuentas de resultado (especial)', () => {
    expect(valorDe(b, 'K-03')).toBe(3300);
    expect(valorDe(b, 'TOTAL PATRIMONIO')).toBe(50000 + 3300); // capital 50.000 + resultado
  });

  it('cuadra también en Bs y en cada corte', () => {
    const varios = balanceGeneral(f, EST, { cortes: ['2026-03-31', '2026-06-30', '2026-12-31'].map((h) => ({ etiqueta: h, hasta: h })), ejercicios: e.cont_ejercicios, moneda: 'VES' });
    expect(cuadraBalance(varios)).toEqual([true, true, true]);
  });

  it('la moneda equivalente se empareja renglón por renglón', () => {
    const filtro = { cortes: [{ etiqueta: 'x', hasta: '2026-12-31' }], ejercicios: e.cont_ejercicios, detallar: true };
    const enUsd = balanceGeneral(f, EST, { ...filtro, moneda: 'USD' });
    const enBs = balanceGeneral(f, EST, { ...filtro, moneda: 'VES' });
    const par = estadoConEquivalente(enUsd, enBs);
    expect(par.totales.map((t) => t.eq)).toEqual(enBs.totales.map((t) => t.valores));
    const k3 = (x: typeof par) => renglones(x).find((y) => y.codigo === 'K-03')!;
    expect(k3(par).eq).toEqual(k3(enBs).valores);
    expect(k3(par).valores).toEqual([3300]);
  });
});
