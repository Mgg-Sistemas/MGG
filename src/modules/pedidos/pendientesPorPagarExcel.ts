/* ============================================================
   MGG · Compras · «Pendientes por pagar» (Excel) · 20-10-2026
   El mismo reporte de la pantalla, en un libro con dos hojas:
     · «Por pagar»: cada segmento con sus filas, su subtotal, el TOTAL GENERAL y,
       aparte, las CUENTAS A CRÉDITO (saldo pendiente).
     · «Resumen»: cuántas filas y cuánto suma cada segmento, en $ y en Bs.
   Los montos van como NÚMERO (se pueden sumar en Excel). Estilos del sistema,
   en pastel como el resto de reportes. Se MUESTRA en vista previa: nada se
   descarga solo.
   ============================================================ */
import { previewWorkbook } from '@/shared/lib/reportPreview';
import { COLOR_TOTAL_TEXTO } from './comprasReporte';
import { ENCABEZADO, MONEDA_FMT, SUBTITULO, TITULO, TOTAL, rgb, type Celda, type XlsxLike } from './reporteComprasExcel';
import { CREDITO_ESTILO, subtotalSegmento, usdABs, type ReportePorPagar } from './pendientesPorPagarReporte';

const COLUMNAS = 6;
const estiloBloque = (fondo: string, letra: string, alinear: 'left' | 'right') => ({
  font: { name: 'Arial', sz: 10, bold: true, color: { rgb: rgb(letra) } },
  fill: { patternType: 'solid', fgColor: { rgb: rgb(fondo) } },
  alignment: { horizontal: alinear, vertical: 'center' },
});

type Marca = { fila: number; tipo: 'titulo' | 'subtitulo' | 'encabezado' | 'grupo' | 'subtotal' | 'total'; fondo?: string; letra?: string };

async function construirLibro(rep: ReportePorPagar, tasaFecha: string | null): Promise<{ XLSX: XlsxLike; wb: unknown; nombre: string }> {
  const [XLSXmod, { dateTime }] = await Promise.all([import('xlsx-js-style'), import('@/shared/lib/format')]);
  const XLSX = XLSXmod as unknown as XlsxLike;
  const bs = (usd: number): number | '' => (rep.tasa > 0 ? usdABs(usd, rep.tasa) : '');

  // ── Hoja 1 · Por pagar ──
  const aoa: unknown[][] = [
    ['PENDIENTES POR PAGAR · MGG'],
    [`${rep.pendientes} pendiente(s)${rep.credito.length ? ` · ${rep.credito.length} a crédito` : ''} · ${dateTime(new Date().toISOString())} · ${rep.tasa > 0 ? `Tasa BCV: Bs ${rep.tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por $${tasaFecha ? ` (${tasaFecha})` : ''}` : 'Sin tasa BCV'}`],
    [],
    ['#', 'CÓDIGO', 'PROVEEDOR / CONCEPTO', 'MÉTODO DE PAGO / DATOS', 'MONTO $', 'MONTO Bs'],
  ];
  const marcas: Marca[] = [{ fila: 0, tipo: 'titulo' }, { fila: 1, tipo: 'subtitulo' }, { fila: 3, tipo: 'encabezado' }];
  for (const s of rep.segmentos) {
    marcas.push({ fila: aoa.length, tipo: 'grupo', fondo: s.pastel, letra: s.pastelTexto });
    aoa.push([`${s.emoji} ${s.titulo} · ${s.filas.length}`]);
    s.filas.forEach((f, i) => aoa.push([i + 1, f.codigo, f.nombre, f.pago, f.montoUsd, bs(f.montoUsd)]));
    const sub = subtotalSegmento(s);
    marcas.push({ fila: aoa.length, tipo: 'subtotal', fondo: s.pastel, letra: s.pastelTexto });
    aoa.push(['', '', '', `TOTAL ${s.titulo}`, sub, bs(sub)]);
  }
  if (rep.segmentos.length) {
    marcas.push({ fila: aoa.length, tipo: 'total' });
    aoa.push(['', '', '', '💰 TOTAL GENERAL', rep.totalUsd, bs(rep.totalUsd)]);
  }
  if (rep.credito.length) {
    aoa.push([]);
    marcas.push({ fila: aoa.length, tipo: 'grupo', fondo: CREDITO_ESTILO.pastel, letra: CREDITO_ESTILO.pastelTexto });
    aoa.push([`${CREDITO_ESTILO.emoji} ${CREDITO_ESTILO.titulo} · ${rep.credito.length}`]);
    marcas.push({ fila: aoa.length, tipo: 'encabezado' });
    aoa.push(['#', 'CÓDIGO', 'PROVEEDOR · ABONOS', 'MÉTODO DE PAGO / DATOS', 'SALDO $', 'SALDO Bs']);
    rep.credito.forEach((c, i) => aoa.push([i + 1, c.codigo, `${c.nombre}
Abonado $ ${c.abonado.toFixed(2)} de $ ${c.total.toFixed(2)}`, c.pago, c.saldo, bs(c.saldo)]));
    marcas.push({ fila: aoa.length, tipo: 'subtotal', fondo: CREDITO_ESTILO.pastel, letra: CREDITO_ESTILO.pastelTexto });
    aoa.push(['', '', '', 'TOTAL A CRÉDITO (saldo pendiente)', rep.creditoTotal, bs(rep.creditoTotal)]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const w = ws as Record<string, unknown>;
  const cellAt = (r: number, c: number) => (ws as Record<string, Celda>)[XLSX.utils.encode_cell({ r, c })];
  w['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 40 }, { wch: 58 }, { wch: 16 }, { wch: 18 }];
  const merges: unknown[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: COLUMNAS - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: COLUMNAS - 1 } }];
  for (const m of marcas) {
    if (m.tipo === 'grupo') {
      merges.push({ s: { r: m.fila, c: 0 }, e: { r: m.fila, c: COLUMNAS - 1 } });
      const c0 = cellAt(m.fila, 0);
      if (c0) c0.s = estiloBloque(m.fondo ?? '#ffe6cc', m.letra ?? COLOR_TOTAL_TEXTO, 'left');
      continue;
    }
    const estilo = m.tipo === 'titulo' ? TITULO
      : m.tipo === 'subtitulo' ? SUBTITULO
      : m.tipo === 'encabezado' ? ENCABEZADO
      : m.tipo === 'subtotal' ? estiloBloque(m.fondo ?? '#ffe6cc', m.letra ?? COLOR_TOTAL_TEXTO, 'right')
      : TOTAL;
    for (let c = 0; c < COLUMNAS; c++) { const cell = cellAt(m.fila, c); if (cell) cell.s = estilo; }
  }
  w['!merges'] = merges;
  // Montos (columnas E y F) con dos decimales y a la derecha; la columna # centrada.
  for (let r = 4; r < aoa.length; r++) {
    for (const c of [4, 5]) {
      const cell = cellAt(r, c);
      if (cell && typeof cell.v === 'number') { cell.z = MONEDA_FMT; cell.s = { ...(cell.s as object ?? {}), alignment: { horizontal: 'right' } }; }
    }
    const c0 = cellAt(r, 0);
    if (c0 && typeof c0.v === 'number') c0.s = { ...(c0.s as object ?? {}), alignment: { horizontal: 'center' } };
  }
  // Proveedor y MÉTODO DE PAGO / DATOS en varias líneas (cada pata del multipago y su beneficiario).
  for (const m of marcas) {
    if (m.tipo !== 'encabezado' && m.tipo !== 'titulo') continue;
  }
  for (let r = 4; r < aoa.length; r++) {
    if (marcas.some((m) => m.fila === r)) continue;
    for (const c of [2, 3]) {
      const cell = cellAt(r, c);
      if (cell && typeof cell.v === 'string') cell.s = { ...(cell.s as object ?? {}), alignment: { vertical: 'top', wrapText: true } };
    }
  }

  // ── Hoja 2 · Resumen ──
  const resumen: unknown[][] = [
    ['RESUMEN · PENDIENTES POR PAGAR · MGG'],
    [],
    ['SEGMENTO', 'FILAS', 'TOTAL $', 'TOTAL Bs'],
    ...rep.segmentos.map((s) => [`${s.emoji} ${s.titulo}`, s.filas.length, subtotalSegmento(s), bs(subtotalSegmento(s))]),
    ['💰 TOTAL GENERAL', rep.pendientes, rep.totalUsd, bs(rep.totalUsd)],
    [`${CREDITO_ESTILO.emoji} A CRÉDITO (saldo pendiente, aparte)`, rep.credito.length, rep.creditoTotal, bs(rep.creditoTotal)],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(resumen);
  const w2 = ws2 as Record<string, unknown>;
  const cell2 = (r: number, c: number) => (ws2 as Record<string, Celda>)[XLSX.utils.encode_cell({ r, c })];
  w2['!cols'] = [{ wch: 42 }, { wch: 10 }, { wch: 16 }, { wch: 18 }];
  w2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const t2 = cell2(0, 0); if (t2) t2.s = TITULO;
  for (let c = 0; c < 4; c++) { const h = cell2(2, c); if (h) h.s = ENCABEZADO; }
  const filaTotal = 3 + rep.segmentos.length;
  for (let r = 3; r < resumen.length; r++) {
    for (const c of [2, 3]) {
      const cell = cell2(r, c);
      if (cell && typeof cell.v === 'number') { cell.z = MONEDA_FMT; cell.s = { alignment: { horizontal: 'right' } }; }
    }
    if (r === filaTotal) for (let c = 0; c < 4; c++) { const cell = cell2(r, c); if (cell) cell.s = TOTAL; }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Por pagar');
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');
  return { XLSX, wb, nombre: 'pendientes-por-pagar.xlsx' };
}

/** 📊 Muestra el Excel en vista previa (con su botón de descarga). */
export async function exportarPendientesPorPagarExcel(rep: ReportePorPagar, tasaFecha: string | null): Promise<void> {
  const { XLSX, wb, nombre } = await construirLibro(rep, tasaFecha);
  previewWorkbook(XLSX, wb, nombre);
}
