/* ============================================================
   Golden Touch · Retenciones · Reportes: CSV, Excel y PDF

   Dibuja la TablaReporte de reportesRetenciones.ts en cada formato. Excel y
   PDF pasan por la vista previa del sistema (se descarga desde ahí). El PDF
   lleva el logo de Golden Touch y la razón social de Parámetros.
   ============================================================ */
import { previewExcelArchivo, previewPdf } from '@/shared/lib/reportePreview';
import { getConfigRetencion } from '@/modules/libroFiscal/retencionesFiscal.repository';
import type { ConfigRetencion } from '@/modules/libroFiscal/retencionesCalculo';
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
  const blob = new Blob(['﻿', armarCsv(t)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombreArchivo(c)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Excel con el formato de los Excel del sistema: título, filtros, encabezado naranja y totales en negrita. */
export async function reporteExcel(t: TablaReporte, c: CabeceraReporte, configEmpresa?: ConfigRetencion | null): Promise<void> {
  if (!t.filas.length) throw new Error('No hay filas que exportar con estos filtros.');
  // Multi-empresa: si viene la config de la empresa actual, su nombre/RIF encabezan el
  // reporte; si no, se lee la global (como hoy).
  const [{ default: ExcelJS }, config] = await Promise.all([
    import('exceljs'),
    configEmpresa ? Promise.resolve(configEmpresa) : getConfigRetencion().catch(() => null),
  ]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(c.titulo.slice(0, 31), {
    pageSetup: { orientation: c.orientacion === 'vertical' ? 'portrait' : 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  const n = t.encabezados.length;
  ws.columns = t.encabezados.map((h, i) => ({ width: t.numeros.includes(i) ? 16 : Math.max(12, Math.min(40, h.length + 6)) }));
  const borde = { style: 'thin' as const, color: { argb: 'FFBFC5CC' } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  const linea = (fila: number, texto: string, tam: number, color: string, negrita = false) => {
    ws.mergeCells(fila, 1, fila, Math.max(1, n));
    const cel = ws.getCell(fila, 1);
    cel.value = texto;
    cel.font = { name: 'Arial', size: tam, bold: negrita, color: { argb: color } };
    cel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  };
  const empresa = config ? `${razonSocialAgente(config)}${config.rif ? ` · RIF ${config.rif}` : ''}` : 'Golden Touch';
  linea(1, `${c.titulo} · ${empresa}`, 14, 'FFFF8A00', true);
  linea(2, `Del ${fechaPdf(c.rango.desde)} al ${fechaPdf(c.rango.hasta)} · ${c.filtros} · ${c.registros} registro(s)`, 10, 'FF5C6673');
  linea(3, lineaTotales(c.totales), 10, 'FF1F2328', true);

  const cab = ws.getRow(5);
  cab.values = t.encabezados;
  cab.height = 24;
  cab.eachCell((cel) => {
    cel.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } };
    cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cel.border = bordes;
  });
  t.filas.forEach((f, i) => {
    const r = ws.getRow(6 + i);
    r.values = f.map((v) => (v == null ? '' : v));
    const total = t.totales.includes(i);
    for (let col = 1; col <= n; col += 1) {
      const cel = r.getCell(col);
      cel.font = { name: 'Arial', size: 10, bold: total };
      cel.border = bordes;
      cel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      if (total) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1DE' } };
      else if (i % 2 === 1) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF6F0' } };
      if (t.numeros.includes(col - 1)) { cel.numFmt = '#,##0.00'; cel.alignment = { ...cel.alignment, horizontal: 'right' }; }
    }
  });
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: n } };

  const bytes = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  await previewExcelArchivo(bytes, `${nombreArchivo(c)}.xlsx`);
}

/** PDF con el logo de Golden Touch, para imprimir o guardar. */
export async function reportePdf(t: TablaReporte, c: CabeceraReporte, configEmpresa?: ConfigRetencion | null): Promise<void> {
  if (!t.filas.length) throw new Error('No hay filas que imprimir con estos filtros.');
  // Multi-empresa: la empresa actual encabeza el PDF si viene; si no, la global (como hoy).
  const [{ jsPDF }, { default: autoTable }, { loadLogoPdfDataUrl, dibujarLogoPdf }, config] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
    configEmpresa ? Promise.resolve(configEmpresa) : getConfigRetencion().catch(() => null),
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
  const empresa = config ? `${razonSocialAgente(config)}${config.rif ? ` · RIF ${config.rif}` : ''}` : 'Golden Touch';
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
