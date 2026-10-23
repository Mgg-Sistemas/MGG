/* ============================================================
   Retenciones · Reportes: CSV, Excel y PDF

   Dibuja la TablaReporte de reportesRetenciones.ts en cada formato. Excel y
   PDF pasan por la vista previa del sistema (se descarga desde ahí). El PDF
   lleva el logo corporativo y la razón social de Parámetros.
   ============================================================ */
import { previewExcel, previewPdf } from '@/shared/lib/reportePreview';
import { getConfigRetencion } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { razonSocialAgente } from '@/modules/libroFiscal/comprobanteRetencionPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, fechaPdf, textoPdf } from '@/modules/libroFiscal/pdfComun';
import { armarCsv, formatoMonto, type Rango, type TablaReporte, type Totales } from './reportesRetenciones';

export interface CabeceraReporte {
  titulo: string;
  rango: Rango;
  /** Una línea con los filtros aplicados. */
  filtros: string;
  totales: Totales;
  registros: number;
  orientacion: 'horizontal' | 'vertical';
}

const slug = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
export const nombreArchivo = (c: CabeceraReporte) => slug(`${c.titulo}-${c.rango.desde}-a-${c.rango.hasta}`);

/** Los totales en una línea: Bs primero, luego cada moneda de origen. */
export function lineaTotales(t: Totales): string {
  const otras = t.porMoneda.map((m) => `${m.moneda === 'Bs' ? 'Bs' : '$'} ${formatoMonto(m.retenido)} (${m.registros})`).join(' · ');
  const aviso = t.sinTasa ? ` · ${t.sinTasa} sin tasa (no suman en Bs)` : '';
  return `Retenido: Bs ${formatoMonto(t.retenidoBs)}${aviso}${otras ? ` · En moneda de origen: ${otras}` : ''}`;
}

/** Descarga el CSV (UTF-8 con BOM, para que Excel lea bien los acentos). */
export function descargarCsv(t: TablaReporte, c: CabeceraReporte): void {
  if (!t.filas.length) throw new Error('No hay filas que exportar con estos filtros.');
  const blob = new Blob(['\uFEFF', armarCsv(t)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombreArchivo(c)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface AnyXLSX {
  utils: {
    aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
    encode_cell: (c: { r: number; c: number }) => string;
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
}

/** Excel con el formato del sistema: título, filtros, encabezado naranja y totales. */
export async function reporteExcel(t: TablaReporte, c: CabeceraReporte): Promise<void> {
  if (!t.filas.length) throw new Error('No hay filas que exportar con estos filtros.');
  const [XLSXModule, config] = await Promise.all([
    import('xlsx-js-style'),
    getConfigRetencion().catch(() => null),
  ]);
  const XLSX = XLSXModule as unknown as AnyXLSX;
  const empresa = config ? `${razonSocialAgente(config)}${config.rif ? ` · RIF ${config.rif}` : ''}` : 'Mineral Group Guayana';
  const ultima = t.encabezados.length;
  const aoa: unknown[][] = [
    [`${c.titulo} · ${empresa}`],
    [`Del ${fechaPdf(c.rango.desde)} al ${fechaPdf(c.rango.hasta)} · ${c.filtros} · ${c.registros} registro(s)`],
    [lineaTotales(c.totales)],
    [],
    t.encabezados,
    ...t.filas.map((f) => f.map((v) => (v == null ? '' : v))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, ultima - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, ultima - 1) } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: Math.max(0, ultima - 1) } },
  ];
  (ws as Record<string, unknown>)['!cols'] = t.encabezados.map((h, i) => ({
    wch: t.numeros.includes(i) ? 16 : Math.max(12, Math.min(40, h.length + 6)),
  }));

  const cellAt = (r: number, col: number) =>
    (ws as Record<string, { s?: unknown; t?: string; z?: string }>)[XLSX.utils.encode_cell({ r, c: col })];
  const borde = { style: 'thin', color: { rgb: 'BFC5CC' } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  const c0 = cellAt(0, 0);
  if (c0) c0.s = { font: { name: 'Arial', sz: 14, bold: true, color: { rgb: 'FF8A00' } }, alignment: { vertical: 'center', horizontal: 'left' } };
  const c1 = cellAt(1, 0);
  if (c1) c1.s = { font: { name: 'Arial', sz: 10, color: { rgb: '5C6673' } }, alignment: { vertical: 'center', horizontal: 'left' } };
  const c2 = cellAt(2, 0);
  if (c2) c2.s = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '1F2328' } }, alignment: { vertical: 'center', horizontal: 'left' } };

  t.encabezados.forEach((_, col) => {
    const cell = cellAt(4, col);
    if (cell) {
      cell.s = {
        font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: bordes,
      };
    }
  });

  t.filas.forEach((f, i) => {
    const esTotal = t.totales.includes(i);
    f.forEach((_, col) => {
      const cell = cellAt(5 + i, col);
      if (!cell) return;
      const esNum = t.numeros.includes(col);
      cell.s = {
        font: { name: 'Arial', sz: 10, bold: esTotal },
        border: bordes,
        alignment: { vertical: 'center', horizontal: esNum ? 'right' : 'left', wrapText: true },
        ...(esTotal ? { fill: { patternType: 'solid', fgColor: { rgb: 'FFF1DE' } } } : (i % 2 === 1 ? { fill: { patternType: 'solid', fgColor: { rgb: 'FAF6F0' } } } : {})),
      };
      if (esNum && cell.t === 'n') cell.z = '#,##0.00';
    });
  });

  (ws as Record<string, unknown>)['!autofilter'] = {
    ref: `A5:${XLSX.utils.encode_cell({ r: 4, c: Math.max(0, ultima - 1) })}`,
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, c.titulo.slice(0, 31));
  await previewExcel(wb, `${nombreArchivo(c)}.xlsx`);
}

/** PDF para imprimir o guardar. */
export async function reportePdf(t: TablaReporte, c: CabeceraReporte): Promise<void> {
  if (!t.filas.length) throw new Error('No hay filas que imprimir con estos filtros.');
  const [{ jsPDF }, { default: autoTable }, { loadLogoPdfDataUrl, dibujarLogoPdf }, config] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'), getConfigRetencion().catch(() => null),
  ]);
  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: c.orientacion === 'vertical' ? 'portrait' : 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const M = MARGEN_PDF;
  let y = M;
  if (logo) dibujarLogoPdf(doc, logo, M, y - 6, 56);

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(textoPdf(c.titulo.toUpperCase()), W / 2, y + 12, { align: 'center' });
  doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const empresa = config ? `${razonSocialAgente(config)}${config.rif ? ` · RIF ${config.rif}` : ''}` : 'Mineral Group Guayana';
  doc.text(textoPdf(empresa), W / 2, y + 25, { align: 'center' });
  doc.text(textoPdf(`Del ${fechaPdf(c.rango.desde)} al ${fechaPdf(c.rango.hasta)} · ${c.registros} registro(s)`), W / 2, y + 36, { align: 'center' });
  doc.setFontSize(7.5); doc.setTextColor(100, 100, 100);
  doc.text(doc.splitTextToSize(textoPdf(c.filtros), W - 2 * M - 70), W / 2, y + 47, { align: 'center' });
  y += 62;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(20, 20, 20);
  const tot = doc.splitTextToSize(textoPdf(lineaTotales(c.totales)), W - 2 * M);
  doc.text(tot, M, y);
  y += 12 * tot.length;

  autoTable(doc, {
    startY: y,
    margin: MARGENES_TABLA_PDF,
    head: [t.encabezados.map(textoPdf)],
    body: t.filas.map((f) => f.map((v, i) => (v == null ? '' : typeof v === 'number' && t.numeros.includes(i) ? formatoMonto(v) : textoPdf(v)))),
    styles: { fontSize: t.encabezados.length > 10 ? 6.5 : 7.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 246, 240] },
    columnStyles: Object.fromEntries(t.numeros.map((i) => [i, { halign: 'right' as const }])),
    didParseCell: (d) => {
      if (d.section === 'body' && t.totales.includes(d.row.index)) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = [255, 241, 222];
      }
    },
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFontSize(7); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
      doc.text(textoPdf(`Generado el ${new Date().toLocaleString('es-VE')}`), M, H - M / 2);
      doc.text(textoPdf(`Página ${doc.getCurrentPageInfo().pageNumber}`), W - M, H - M / 2, { align: 'right' });
    },
  });
  previewPdf(doc, `${nombreArchivo(c)}.pdf`);
}
