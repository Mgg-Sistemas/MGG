/* ============================================================
   Smoke del exportador del reporte moldeable de Compras: que las tres
   salidas puras (Excel/PDF/CSV) se arman sin lanzar con datos mínimos, y
   que el CSV blinda contra «formula injection».
   ============================================================ */
import { describe, expect, it } from 'vitest';
import {
  construirComprasExcel,
  construirComprasCsv,
  construirComprasPdf,
  type MetadatosExportacionCompras,
} from './exportarComprasMoldeable';
import { resumenCompras, CAMPOS_DETALLE_POR_AMBITO, type FilaReporteCompras } from './comprasMoldeable';

function fila(over: Partial<FilaReporteCompras> = {}): FilaReporteCompras {
  return {
    id: 'f1', ambito: 'ordenes', tipo_compra: 'orden', fecha: '2026-11-05',
    codigo: 'OC-1', departamento: 'Mina', proveedor: 'ACME', estado: 'pagada',
    estado_rotulo: 'Pagada', clase_estado: 'finalizada', categoria: '', categoria_gasto: null,
    nombre_item: '', cantidad: null, moneda_original: 'USD', monto_original: 100,
    monto_usd: 100, monto_bs: 4000, pagado_usd: 100, pagado_bs: 4000,
    ...over,
  };
}

const meta: MetadatosExportacionCompras = {
  desde: '2026-11-01', hasta: '2026-11-10', ambito: 'ordenes', agrupacion: 'detallado',
  formato: 'hibrido', mostrarUsd: true, mostrarBs: true, tasaBcv: 40,
};

const filas = [fila(), fila({ id: 'f2', departamento: 'Planta', clase_estado: 'pendiente', monto_usd: 50, monto_bs: 2000, pagado_usd: 0, pagado_bs: 0 })];
const resumen = resumenCompras(filas, [], [{ departamento: 'Mina' }], 40);
const columnas = CAMPOS_DETALLE_POR_AMBITO.ordenes;

describe('exportarComprasMoldeable (smoke)', () => {
  it('construirComprasExcel devuelve bytes legibles', async () => {
    const bytes = await construirComprasExcel(filas, resumen, columnas, meta);
    expect(bytes.byteLength).toBeGreaterThan(0);
  }, 20000);

  it('construirComprasPdf arma un documento con al menos una página', async () => {
    const doc = await construirComprasPdf(filas, resumen, columnas, meta);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('construirComprasCsv blinda las celdas con fórmula', () => {
    const peligrosa = [fila({ proveedor: '=SUM(A1:A2)', departamento: '+CMD', codigo: '-1', nombre_item: '@x' })];
    const csv = construirComprasCsv(peligrosa, columnas, meta);
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).toContain("'+CMD");
    // El código «-1» también se blinda por empezar con '-'.
    expect(csv).toContain("'-1");
  });

  it('construirComprasPdf soporta formato resumen, detallado e híbrido en portrait y landscape', async () => {
    // 1. Resumen en portrait
    const docResumen = await construirComprasPdf(filas, resumen, columnas, { ...meta, formato: 'resumen', orientacion: 'portrait' });
    expect(docResumen.getNumberOfPages()).toBeGreaterThanOrEqual(1);

    // 2. Detallado en landscape
    const docDetallado = await construirComprasPdf(filas, resumen, columnas, { ...meta, formato: 'detallado', orientacion: 'landscape' });
    expect(docDetallado.getNumberOfPages()).toBeGreaterThanOrEqual(1);

    // 3. Híbrido con compras directas, cotizaciones y top items
    const filasHibridas = [
      ...filas,
      fila({ id: 'f3', tipo_compra: 'directa', categoria_gasto: 'Repuestos', monto_usd: 80, monto_bs: 3200 }),
      fila({ id: 'f4', ambito: 'items', nombre_item: 'Filtro de Aceite', cantidad: 5, monto_usd: 120, monto_bs: 4800 }),
    ];
    const resumenHibrido = resumenCompras(filasHibridas, [], [{ departamento: 'Mina' }, { departamento: 'Planta' }], 40);
    const docHibrido = await construirComprasPdf(filasHibridas, resumenHibrido, columnas, { ...meta, formato: 'hibrido' });
    expect(docHibrido.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

});
