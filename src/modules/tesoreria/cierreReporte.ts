/* ============================================================
   MGG · Tesorería · Reporte de Cierre de mes (PDF / Excel)
   Toma el snapshot del cierre (ingresos, gastos, resultado, CxC,
   CxP y saldos disponibles) y arma un reporte descargable. Solo
   se descarga cuando el usuario aprieta el botón (nunca automático).
   ============================================================ */
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import type { CellHookData } from 'jspdf-autotable';
import type { ReporteCierre } from './cierres.repository';

function montoStr(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

/** Convierte un Record<moneda, monto> en filas [moneda, montoStr]. */
function filasMoneda(rec: Record<string, number>): string[][] {
  const ent = Object.entries(rec).filter(([, v]) => Math.abs(Number(v) || 0) > 0.0001);
  if (!ent.length) return [['—', '—']];
  return ent.sort((a, b) => a[0].localeCompare(b[0])).map(([mon, v]) => [mon, montoStr(v, mon)]);
}

const MES_LARGO = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export function periodoLargo(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number);
  return `${MES_LARGO[m] ?? periodo} ${y}`;
}

async function construirDoc(r: ReporteCierre) {
  const [logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;

  if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'PNG', MARGIN, y, 90, 36); } catch { /* logo opcional */ } }
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('CIERRE DE MES', PAGE_W - MARGIN, y + 14, { align: 'right' });
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(periodoLargo(r.periodo), PAGE_W - MARGIN, y + 30, { align: 'right' });
  y += 54;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(2);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 16;

  doc.setFontSize(9); doc.setTextColor(110);
  doc.text(`Período: ${r.desde} a ${r.hasta}  ·  ${r.movimientos} movimiento(s)`, MARGIN, y);
  doc.setTextColor(0); y += 10;

  const seccion = (titulo: string, body: string[][]) => {
    autoTable(doc, {
      startY: y + 8,
      head: [[titulo, '']],
      body,
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 200 }, 1: { halign: 'right' } },
      margin: { left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = doc.lastAutoTable.finalY;
  };

  seccion('INGRESOS (entradas)', filasMoneda(r.ingresos));
  seccion('GASTOS (egresos)', filasMoneda(r.gastos));
  seccion('RESULTADO DEL MES (ingresos − gastos)', filasMoneda(r.resultado));
  seccion('CUENTAS POR COBRAR (abiertas)', filasMoneda(r.cxc));
  seccion('CUENTAS POR PAGAR (abiertas)', filasMoneda(r.cxp));

  const saldosBody = r.saldos.length
    ? r.saldos.map((s) => [`${s.caja}${s.cuenta && s.cuenta !== 'general' ? ` · ${s.cuenta}` : ''}`, montoStr(s.saldo, s.moneda)])
    : [['—', '—']];
  autoTable(doc, {
    startY: y + 8,
    head: [['SALDOS DISPONIBLES (por caja / moneda)', '']],
    body: saldosBody,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 320 }, 1: { halign: 'right' } },
    // Saldos negativos en rojo.
    didParseCell: (data: CellHookData) => {
      if (data.section === 'body' && data.column.index === 1 && typeof data.cell.raw === 'string' && data.cell.raw.includes('-')) {
        data.cell.styles.textColor = [197, 48, 48];
      }
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  return doc;
}

export async function descargarCierrePdf(r: ReporteCierre): Promise<void> {
  (await construirDoc(r)).save(`Cierre-${r.periodo}.pdf`);
}

export async function descargarCierreExcel(r: ReporteCierre): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: { aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>; encode_cell: (c: { r: number; c: number }) => string; book_new: () => unknown; book_append_sheet: (wb: unknown, ws: unknown, name: string) => void };
    writeFile: (wb: unknown, name: string) => void;
  };
  const HEADER = { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } } };
  const TITLE = { font: { name: 'Arial', sz: 14, bold: true } };

  const bloque = (titulo: string, rec: Record<string, number>): unknown[][] => {
    const filas = filasMoneda(rec);
    return [[titulo, ''], ...filas, []];
  };

  const aoa: unknown[][] = [
    [`CIERRE DE MES · ${periodoLargo(r.periodo)}`],
    [`Período ${r.desde} a ${r.hasta} · ${r.movimientos} movimiento(s)`],
    [],
    ...bloque('INGRESOS (entradas)', r.ingresos),
    ...bloque('GASTOS (egresos)', r.gastos),
    ...bloque('RESULTADO DEL MES', r.resultado),
    ...bloque('CUENTAS POR COBRAR (abiertas)', r.cxc),
    ...bloque('CUENTAS POR PAGAR (abiertas)', r.cxp),
    ['SALDOS DISPONIBLES', ''],
    ...(r.saldos.length
      ? r.saldos.map((s) => [`${s.caja}${s.cuenta && s.cuenta !== 'general' ? ` · ${s.cuenta}` : ''} (${s.moneda})`, s.saldo])
      : [['—', '—']]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = [{ wch: 42 }, { wch: 18 }];
  const cellAt = (rr: number, cc: number) => (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r: rr, c: cc })];
  const t = cellAt(0, 0); if (t) t.s = TITLE;
  // Resaltar los encabezados de bloque (primera celda con texto en mayúscula seguido de filas).
  aoa.forEach((row, ri) => {
    const v = row[0];
    if (typeof v === 'string' && /^(INGRESOS|GASTOS|RESULTADO|CUENTAS|SALDOS)/.test(v)) {
      const c = cellAt(ri, 0); if (c) c.s = HEADER;
      const c2 = cellAt(ri, 1); if (c2) c2.s = HEADER;
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cierre');
  XLSX.writeFile(wb, `Cierre-${r.periodo}.xlsx`);
}
