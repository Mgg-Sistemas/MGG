/* PDF y Excel de los libros (C37), sin navegador: las filas (puras) y una generación real
   con jsPDF y xlsx-js-style en Node. La vista previa se reemplaza por una que captura el
   documento: así se comprueba también que nada se descarga solo (todo pasa por la vista previa). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturas = vi.hoisted(() => ({ pdf: [] as Array<{ doc: unknown; nombre: string }>, excel: [] as Array<{ xlsx: unknown; wb: unknown; nombre: string }> }));
vi.mock('@/shared/lib/reportPreview', () => ({
  previewPdfDoc: (doc: unknown, nombre: string) => { capturas.pdf.push({ doc, nombre }); },
  previewWorkbook: (xlsx: unknown, wb: unknown, nombre: string) => { capturas.excel.push({ xlsx, wb, nombre }); },
}));
vi.mock('@/shared/lib/pdfLogo', () => ({ loadLogoDataUrl: async () => { throw new Error('sin logo en pruebas'); } }));

import {
  filasBalance, filasDiario, filasEstado, filasMayor, saldoTexto, verBalanceExcel, verBalancePdf, verDiarioPdf, verEstadoPdf, type ContextoLibro,
} from './librosExport';
import { balanceGeneral, columnasResultados, estadoResultados } from './logica/estados';
import { balanceComprobacion, libroDiario, mayorAnalitico, type FuenteInforme } from './logica/reportes';
import { estadoDePrueba } from './pruebas/datosPrueba';
import { ESTRUCTURA_PRUEBA } from './pruebas/estructuraPrueba';

const e = estadoDePrueba();
const f: FuenteInforme = { comprobantes: e.cont_comprobantes, lineas: e.cont_comprobante_lineas, cuentas: e.cont_cuentas, centros: e.cont_centros_costo, auxiliares: e.cont_auxiliares };
const ctx: ContextoLibro = { empresa: 'EMPRESA DE EJEMPLO, C.A.', titulo: 'Balance de Comprobación', rango: 'Del 01/01/2026 al 31/12/2026', moneda: 'USD', archivo: 'balance-prueba' };
const balance = balanceComprobacion(f, { desde: '2026-01-01', hasta: '2026-12-31', moneda: 'USD', nivel: 2 });

beforeEach(() => { capturas.pdf.length = 0; capturas.excel.length = 0; });

describe('filas de los libros', () => {
  it('Balance: una fila por cuenta (con sangría por nivel) y TOTALES al final', () => {
    const filas = filasBalance(balance, true);
    expect(filas[0]).toMatchObject({ tipo: 'titulo', celdas: ['1 - ACTIVO', 0, expect.any(Number), expect.any(Number), expect.any(Number)] });
    expect(filas.find((x) => x.tipo !== 'bloque' && String(x.celdas[0]).startsWith('  1.1 -'))).toBeTruthy();
    expect(filas.at(-1)).toMatchObject({ tipo: 'total', celdas: ['TOTALES', 0, balance.totales.debe, balance.totales.haber, 0] });
    expect(filasBalance(balance, false)[0]).toMatchObject({ celdas: ['ACTIVO', 0, expect.any(Number), expect.any(Number), expect.any(Number)] });
  });

  it('Mayor: por cuenta, el bloque, el Saldo Inicial, los movimientos y TOTALES', () => {
    const m = mayorAnalitico(f, { desde: '2026-02-01', hasta: '2026-12-31', moneda: 'USD', modo: 'detallado', cuentaDesde: '1.1.01.01.002', cuentaHasta: '1.1.01.01.002' });
    const filas = filasMayor(m, 'detallado');
    expect(filas.map((x) => x.tipo)).toEqual(['bloque', 'titulo', 'datos', 'total']);
    expect(filas[0]).toMatchObject({ texto: 'Cuenta Contable: 1.1.01.01.002 - CAJA PRINCIPAL USD' });
    expect(filas[2]).toMatchObject({ celdas: ['10/02/2026', '02-000002', null, 'PAGO A PROVEEDOR EJEMPLO UNO', null, null, null, 1160, 3840] });
  });

  it('Diario: cada comprobante con sus asientos y su total, y el total general', () => {
    const filas = filasDiario(libroDiario(f, '2026-07-01', '2026-07-31', 'USD'));
    expect(filas.filter((x) => x.tipo === 'bloque')).toHaveLength(2);
    expect(filas.at(-1)).toMatchObject({ tipo: 'total', celdas: ['TOTAL GENERAL · 2 comprobantes', null, null, null, 50, 50] });
  });

  it('Estado de Resultados: sección, renglones (y sus cuentas si se detallan), total de sección y subtotales', () => {
    const res = estadoResultados(f, ESTRUCTURA_PRUEBA, { columnas: columnasResultados('acumulado', '2026-12', e.cont_ejercicios[0]), moneda: 'USD', detallar: true });
    const filas = filasEstado(res, true);
    expect(filas.slice(0, 3)).toEqual([
      { tipo: 'bloque', texto: 'INGRESOS' }, { tipo: 'datos', celdas: ['Ventas', 8000] }, { tipo: 'datos', celdas: ['    4.1.01.01.001 - VENTAS DE CASITERITA', 8000] },
    ]);
    expect(filas).toContainEqual({ tipo: 'total', celdas: ['TOTAL EGRESOS', 4700] });
    expect(filas.at(-1)).toEqual({ tipo: 'total', celdas: ['RESULTADO DEL EJERCICIO', 3300] });
    expect(filasEstado(res, false)[2]).toEqual({ tipo: 'datos', celdas: ['    VENTAS DE CASITERITA', 8000] });
  });

  it('Balance General: los grupos como títulos y los totales finales', () => {
    const bg = balanceGeneral(f, ESTRUCTURA_PRUEBA, { cortes: [{ etiqueta: 'Al 31/12/2026', hasta: '2026-12-31' }], ejercicios: e.cont_ejercicios, moneda: 'USD' });
    const filas = filasEstado(bg, true);
    expect(filas.slice(0, 2)).toEqual([{ tipo: 'bloque', texto: 'ACTIVO' }, { tipo: 'titulo', celdas: ['ACTIVO CORRIENTE', null] }]);
    expect(filas.slice(-4).map((x) => (x.tipo === 'bloque' ? '' : x.celdas[0]))).toEqual(['TOTAL ACTIVO', 'TOTAL PASIVO', 'TOTAL PATRIMONIO', 'TOTAL PASIVO Y PATRIMONIO']);
  });

  it('los saldos acreedores van entre paréntesis', () => {
    expect(saldoTexto(-1500)).toBe('(1.500,00)');
    expect(saldoTexto(1500)).toBe('1.500,00');
  });
});

describe('generación real, con vista previa (nada se descarga solo)', () => {
  it('PDF del Balance: pasa por la vista previa, con su nombre y su encabezado', async () => {
    await verBalancePdf(balance, true, ctx);
    expect(capturas.pdf).toHaveLength(1);
    expect(capturas.pdf[0].nombre).toBe('balance-prueba.pdf');
    const doc = capturas.pdf[0].doc as { getNumberOfPages(): number; output(): string };
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const crudo = doc.output();
    expect(crudo).toContain('EMPRESA DE EJEMPLO');
    expect(crudo).toContain('Expresado en D');
    expect(crudo).toContain('TOTALES');
  });

  it('PDF del Estado de Resultados Mes a Mes: pasa por la vista previa, apaisado con muchas columnas', async () => {
    capturas.pdf.length = 0;
    const res = estadoResultados(f, ESTRUCTURA_PRUEBA, { columnas: columnasResultados('mes_a_mes', '2026-06', e.cont_ejercicios[0]), moneda: 'USD' });
    await verEstadoPdf(res, false, { ...ctx, titulo: 'Estado de Resultados · Mes a Mes', archivo: 'resultados-prueba' });
    expect(capturas.pdf.length).toBeGreaterThanOrEqual(1);
    const item = capturas.pdf.find((x) => x.nombre.includes('resultados-prueba')) ?? capturas.pdf[0];
    expect(item.nombre).toContain('resultados-prueba');
    const doc = item.doc as { internal: { pageSize: { getWidth: () => number; getHeight: () => number } } };
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
  });

  it('PDF del Diario: apaisado y con el total general', async () => {
    await verDiarioPdf(libroDiario(f, '2026-07-01', '2026-07-31', 'USD'), { ...ctx, titulo: 'Diario de Comprobantes', archivo: 'diario-prueba' });
    const doc = capturas.pdf[0].doc as { internal: { pageSize: { getWidth(): number; getHeight(): number } }; output(): string };
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
    expect(doc.output()).toContain('TOTAL GENERAL');
  });

  it('Excel del Balance: encabezado, columnas de Galac y saldos con formato de paréntesis', async () => {
    await verBalanceExcel(balance, true, ctx);
    expect(capturas.excel).toHaveLength(1);
    expect(capturas.excel[0].nombre).toBe('balance-prueba.xlsx');
    const wb = capturas.excel[0].wb as { SheetNames: string[]; Sheets: Record<string, Record<string, { v: unknown; z?: string }>> };
    expect(wb.SheetNames).toEqual(['Balance de Comprobación']);
    const hoja = wb.Sheets['Balance de Comprobación'];
    expect(hoja.A1.v).toBe('EMPRESA DE EJEMPLO, C.A.');
    expect(hoja.A2.v).toBe('Balance de Comprobación');
    expect(['A6', 'B6', 'C6', 'D6', 'E6'].map((k) => hoja[k].v)).toEqual(['Nombre de la Cuenta', 'Saldo Inicial', 'Monto Debe', 'Monto Haber', 'Saldo Actual']);
    expect(hoja.E7.z).toBe('#,##0.00;(#,##0.00)');
    expect(hoja.C7.z).toBe('#,##0.00');
  });
});
