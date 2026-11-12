import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { Orden } from '@/shared/lib/types';
import { armarFila } from './conciliacion';
import { construirConciliacionExcel } from './conciliacionExcel';

const oc = (p: Record<string, unknown>): Orden => ({
  id: 'o1', codigo: 'SP-1', oc_codigo: 'OC-2026-0001', estado: 'pagada', total: 100, moneda: 'USD',
  items: [], historial: [], oc_creada_en: '2026-11-10T12:00:00Z', ...p,
} as unknown as Orden);

describe('conciliación · Excel', () => {
  it('lleva encabezado, montos numéricos y TOTAL combinado antes del primer monto', async () => {
    const filas = [
      armarFila({ orden: oc({ id: 'a', pagada_en: '2026-11-10T15:00:00Z' }), proveedor: 'ACME', tasaPago: 40, tasaHoy: 45 }, 1),
      armarFila({ orden: oc({ id: 'b', total: 50 }), proveedor: 'BETA', tasaPago: 40, tasaHoy: 45 }, 2),
    ];
    const bytes = await construirConciliacionExcel(filas, { columnas: ['item', 'codigo', 'proveedor', 'monto_usd', 'monto_bs', 'estado'], conTarjetas: false });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.worksheets[0];
    let cab = 0;
    ws.eachRow((r, n) => { if (r.getCell(1).value === 'ÍTEM') cab = n; });
    expect(cab).toBeGreaterThan(0);
    expect(ws.getRow(cab).getCell(4).value).toBe('MONTO $');
    expect(ws.getRow(cab + 1).getCell(4).value).toBe(100);
    const tot = ws.getRow(cab + 3);
    expect(tot.getCell(1).value).toBe('TOTAL');
    expect(tot.getCell(4).value).toBe(150);
    expect(tot.getCell(5).value).toBe(6250);
  });
});
