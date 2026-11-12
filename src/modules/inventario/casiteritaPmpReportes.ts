/* ============================================================
   MGG · Los Pinos · Casiterita — Reportes del libro de promedios (fase 4)
   · Excel con el formato de las hojas «Cierre Promedio» (una por mes elegido),
     más «Resumen por mes» y «Libro» completo. Vista previa antes de descargar.
   · PDF del cierre de un mes (membrete MGG), en vista previa.
   ============================================================ */
import { previewExcelArchivo, previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { identidadEmpresa } from '@/shared/lib/empresa';
import { loadLogoPdfEmpresa, dibujarLogoPdf, anchoLogoPdf } from '@/shared/lib/pdfLogo';
import {
  ETIQUETA_TIPO, fechaTxt, filasCierrePromedio, finDeMes, kgTxt, nombreMes, numTxt, pctTxt, pmpTxt, resumenPorMes, saldoAl, usdTxt,
  type CierreMesPmp, type FilaCierreRep, type FilaLibro,
} from './casiteritaPmp';

const NARANJA = 'FFFF8A00';
const BORDE = 'FFCBD5E1';
const PROMEDIO = 'FFFFF4E6';
const SALDO = 'FFF1F5F9';
const F_KG = '#,##0.00';
const F_USD = '"$" #,##0.00';
const F_PMP = '"$" #,##0.0000';
const F_PCT = '0.00%';

const nombreHoja = (mes: string) => {
  const [y, m] = mes.split('-');
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiemb', 'Octubre', 'Noviembre', 'Diciembre'];
  return `Cierre Promedio ${meses[Number(m) - 1]}-${y.slice(2)}`.slice(0, 31);
};

export async function construirExcelLibro(filas: FilaLibro[], meses: string[], cierres: CierreMesPmp[]): Promise<ArrayBuffer> {
  const [{ default: ExcelJS }] = await Promise.all([import('exceljs')]);
  const emp = identidadEmpresa('MGG');
  const wb = new ExcelJS.Workbook();
  const borde = { style: 'thin' as const, color: { argb: BORDE } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  // ── Una hoja «Cierre Promedio» por mes ──
  for (const mes of [...meses].sort().reverse()) {
    const ws = wb.addWorksheet(nombreHoja(mes), { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 12 }, { width: 11 }, { width: 46 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 18 }, { width: 18 }];
    ws.mergeCells(1, 1, 1, 9);
    const t = ws.getCell(1, 1);
    t.value = `CIERRE DE PROMEDIOS\n${nombreMes(mes).toUpperCase()}`;
    t.font = { name: 'Arial', size: 13, bold: true, color: { argb: NARANJA } };
    t.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getRow(1).height = 34;
    ws.mergeCells(2, 1, 2, 9);
    const c = cierres.find((x) => x.mes === mes);
    const sub = ws.getCell(2, 1);
    sub.value = `${emp.nombre} · Almacén Los Pinos · casiterita${c ? ` · CERRADO por ${c.cerrado_por_name ?? '—'}` : ' · mes abierto (saldos provisionales)'}`;
    sub.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF5C6673' } };
    sub.alignment = { horizontal: 'center' };
    const cab = ws.getRow(3);
    cab.values = ['Fecha', 'Nro. Recepción', 'Descripción', 'Peso Global (kg)', '% Exportado del Inventario', 'Inventario MGG (kg)', 'Costo Promedio ($/kg)', 'Costo Total ($)', 'Resguardo (Global − MGG)'];
    cab.height = 32;
    cab.eachCell((x) => {
      x.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } };
      x.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      x.border = bordes;
    });
    ws.views = [{ state: 'frozen', ySplit: 3 }];
    for (const r of filasCierrePromedio(filas, mes)) {
      const row = ws.addRow([
        r.clase === 'promedio' ? 'PROMEDIO' : r.fecha ? fechaTxt(r.fecha) : '', r.recepcion ?? '', r.descripcion,
        r.global, r.pctExportado ?? '', r.mgg, r.costoProm ?? '', r.costoTotal, r.resguardo,
      ]);
      row.eachCell({ includeEmpty: true }, (x, col) => {
        x.font = { name: 'Arial', size: 9, bold: r.clase !== 'mov' };
        x.border = bordes;
        x.alignment = { vertical: 'middle', horizontal: col <= 2 ? 'center' : col === 3 ? 'left' : 'right', wrapText: col === 3 };
        if (col === 4 || col === 6 || col === 9) x.numFmt = F_KG;
        if (col === 5) x.numFmt = F_PCT;
        if (col === 7) x.numFmt = F_PMP;
        if (col === 8) x.numFmt = F_USD;
        if (r.clase !== 'mov') x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.clase === 'promedio' ? PROMEDIO : SALDO } };
      });
      if (r.clase === 'promedio') ws.mergeCells(row.number, 1, row.number, 3);
    }
  }

  // ── Resumen por mes ──
  const wr = wb.addWorksheet('Resumen por mes');
  wr.columns = [{ width: 18 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 14 }, { width: 10 }];
  const cr = wr.addRow(['Mes', 'Abre (global)', 'Entró (kg)', 'Salió (kg)', 'Exportado (kg)', 'Cierra (global)', 'Inventario MGG', 'Resguardo', 'Costo MGG ($)', 'PMP ($/kg)', 'Estado']);
  cr.eachCell((x) => { x.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } }; x.border = bordes; x.alignment = { horizontal: 'center', wrapText: true }; });
  for (const m of resumenPorMes(filas)) {
    const row = wr.addRow([nombreMes(m.mes), m.apertura.global, m.entradasKg, m.salidasKg, m.exportadoKg, m.cierre.global, m.cierre.mgg, m.cierre.resguardo, m.cierre.costo, m.cierre.pmp, cierres.some((c) => c.mes === m.mes) ? 'Cerrado' : 'Abierto']);
    row.eachCell({ includeEmpty: true }, (x, col) => {
      x.font = { name: 'Arial', size: 9 }; x.border = bordes;
      if (col >= 2 && col <= 8) x.numFmt = F_KG;
      if (col === 9) x.numFmt = F_USD;
      if (col === 10) x.numFmt = F_PMP;
    });
  }

  // ── Libro completo ──
  const wl = wb.addWorksheet('Libro');
  wl.columns = [{ width: 12 }, { width: 16 }, { width: 46 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 22 }];
  const cl = wl.addRow(['Fecha', 'Tipo', 'Descripción', 'Δ Global', 'Δ MGG', 'Δ Costo ($)', 'Saldo global', 'Inventario MGG', 'Resguardo', 'Costo MGG ($)', 'PMP ($/kg)', 'Cargado por']);
  cl.eachCell((x) => { x.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } }; x.border = bordes; x.alignment = { horizontal: 'center', wrapText: true }; });
  wl.views = [{ state: 'frozen', ySplit: 1 }];
  for (const f of filas) {
    const row = wl.addRow([fechaTxt(f.fecha), ETIQUETA_TIPO[f.tipo], f.descripcion, f.dG, f.dM, f.dC, f.G, f.M, f.resguardo, f.C, f.pmp, f.origen === 'excel' ? 'Excel' : f.actor_name ?? '']);
    row.eachCell({ includeEmpty: true }, (x, col) => {
      x.font = { name: 'Arial', size: 9 }; x.border = bordes;
      if ([4, 5, 7, 8, 9].includes(col)) x.numFmt = F_KG;
      if (col === 6 || col === 10) x.numFmt = F_USD;
      if (col === 11) x.numFmt = F_PMP;
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function vistaPreviaExcelLibro(filas: FilaLibro[], meses: string[], cierres: CierreMesPmp[]): Promise<void> {
  const bytes = await construirExcelLibro(filas, meses, cierres);
  const nombre = meses.length === 1 ? `cierre-promedio-casiterita-${meses[0]}` : 'libro-promedios-casiterita';
  await previewExcelArchivo(bytes, `${nombre}.xlsx`);
}

/* ───────── PDF del cierre de un mes ───────── */
export async function vistaPreviaPdfCierre(filas: FilaLibro[], mes: string, cierre: CierreMesPmp | null): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const M = 32;
  let y = M;
  const emp = identidadEmpresa('MGG');
  const logo = await loadLogoPdfEmpresa('MGG').catch(() => null);
  if (logo) dibujarLogoPdf(doc, logo, M, y, 40);
  const tx = logo ? M + anchoLogoPdf(40) + 12 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(255, 138, 0);
  doc.text(pdfSafe(`CIERRE DE PROMEDIOS · ${nombreMes(mes).toUpperCase()}`), tx, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 80, 80);
  doc.text(pdfSafe(`${emp.nombre} · RIF ${emp.rif} · Almacén Los Pinos · casiterita · ${cierre ? `cerrado por ${cierre.cerrado_por_name ?? '—'}` : 'mes abierto (saldos provisionales)'} · generado ${new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' })}`), tx, y + 28);
  y += 50;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.2); doc.line(M, y, W - M, y);
  y += 12;

  const s = saldoAl(filas, finDeMes(mes));
  const datos: Array<[string, string]> = [
    ['SALDO GLOBAL', kgTxt(s.global)], ['INVENTARIO MGG', kgTxt(s.mgg)], ['RESGUARDO', kgTxt(s.resguardo)], ['PMP', pmpTxt(s.pmp)], ['COSTO MGG', usdTxt(s.costo)],
  ];
  const gap = 8, w = (W - 2 * M - gap * 4) / 5, h = 36;
  datos.forEach(([tit, val], i) => {
    const x = M + i * (w + gap);
    doc.setFillColor(250, 250, 250); doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.6); doc.roundedRect(x, y, w, h, 4, 4, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(110, 110, 110); doc.text(pdfSafe(tit), x + 8, y + 12);
    doc.setFontSize(11); doc.setTextColor(30, 30, 30); doc.text(pdfSafe(val), x + 8, y + 28);
  });
  y += h + 12;

  const rows = filasCierrePromedio(filas, mes);
  const celda = (r: FilaCierreRep) => [
    r.clase === 'promedio' ? 'PROMEDIO' : r.fecha ? fechaTxt(r.fecha) : '', r.recepcion != null ? `#${r.recepcion}` : '', r.descripcion,
    numTxt(r.global), r.pctExportado != null ? pctTxt(r.pctExportado) : '', numTxt(r.mgg), r.costoProm != null ? pmpTxt(r.costoProm) : '',
    usdTxt(r.costoTotal), numTxt(r.resguardo),
  ].map((v) => pdfSafe(String(v)));
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['FECHA', 'RECEP.', 'DESCRIPCIÓN', 'PESO GLOBAL', '% EXPORT.', 'INV. MGG', 'COSTO PROM.', 'COSTO TOTAL', 'RESGUARDO'].map((x) => pdfSafe(x))],
    body: rows.map(celda),
    styles: { fontSize: 7, cellPadding: 2.5, lineColor: [203, 213, 225], lineWidth: 0.3, textColor: [30, 30, 30] },
    headStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', valign: 'middle' },
    columnStyles: { 0: { halign: 'center', cellWidth: 52 }, 1: { halign: 'center', cellWidth: 38 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      const r = rows[d.row.index];
      if (r?.clase === 'promedio') { d.cell.styles.fillColor = [255, 244, 230]; d.cell.styles.fontStyle = 'bold'; }
      if (r?.clase === 'saldo') { d.cell.styles.fillColor = [241, 245, 249]; d.cell.styles.fontStyle = 'bold'; }
    },
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFontSize(7); doc.setTextColor(140, 140, 140);
      doc.text(pdfSafe(`Libro de promedios · Los Pinos · página ${doc.getNumberOfPages()}`), W - M, H - 14, { align: 'right' });
    },
  });
  previewPdf(doc, `cierre-promedio-casiterita-${mes}.pdf`);
}
