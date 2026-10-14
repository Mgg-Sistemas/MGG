/* ============================================================
   MGG · Choferes / Conductores · Recibo de viaje (PDF)

   Una carta por recibo: cabecera (logo, empresa, número, fecha), datos del
   chofer, la tabla de viajes (tarifa, reembolso, deducción, subtotal), el
   cuadro de totales en $ y Bs, el texto de conformidad y las firmas.

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { textoPdf, filaPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf, anchoUtilPdf } from '@/shared/lib/pdfMargen';
import { date as fmtDate } from '@/shared/lib/format';
import { definicionEmpresa, normalizarEmpresa } from '@/modules/rrhh/empresa';
import { textoConformidadViaje, nombreDeConductor, datosConductor, type ReciboCalculado } from './choferes';
import type { Conductor, PagoViaje } from './choferes.repository';

const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS: [number, number, number] = [120, 120, 120];

const usd = (v: unknown) => `$ ${(Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const bs = (v: unknown) => `Bs ${(Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* eslint-disable @typescript-eslint/no-explicit-any */

function calculoDe(p: PagoViaje): ReciboCalculado {
  return {
    tarifas_usd: p.tarifas_usd, reembolsos_usd: p.reembolsos_usd, deducciones_usd: p.deducciones_usd,
    bonos_usd: p.bonos_usd, otras_deducciones_usd: p.otras_deducciones_usd,
    devengado_usd: Math.round((p.tarifas_usd + p.reembolsos_usd + p.bonos_usd) * 100) / 100,
    total_deducciones_usd: Math.round((p.deducciones_usd + p.otras_deducciones_usd) * 100) / 100,
    neto_usd: p.neto_usd, neto_bs: p.neto_bs,
  };
}

export async function verReciboViajePdf(p: PagoViaje, c: Conductor | undefined | null): Promise<void> {
  const [{ previewPdfDoc }, { loadLogoDataUrl }, { jsPDF }, { default: autoTable }] = await Promise.all([
    import('@/shared/lib/reportPreview'), import('@/shared/lib/pdfLogo'), import('jspdf'), import('jspdf-autotable'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc: any = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const empresa = definicionEmpresa(normalizarEmpresa(c?.personal?.empresa ?? null));
  const nombre = nombreDeConductor(c);
  const datos = datosConductor(c);
  const calc = calculoDe(p);
  let y = M;

  // Cabecera
  const LOGO = 56;
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y, LOGO, LOGO); } catch { /* logo opcional */ } }
  const tx = logo ? M + LOGO + 14 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(40, 40, 40);
  doc.text(textoPdf(empresa.razonSocial), tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Recibo de Viaje · Choferes / Conductores', tx, y + 32);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(p.numero, W - M, y + 16, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(fmtDate(p.pagado_at ?? p.created_at), W - M, y + 32, { align: 'right' });
  y += Math.max(LOGO, 40) + 6;
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.5); doc.line(M, y, W - M, y);
  y += 14;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('RECIBO DE VIAJE · PAGO POR VIAJES REALIZADOS', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(textoPdf(p.estado === 'pagado' ? `Pagado${p.metodo ? ' · ' + p.metodo : ''}` : p.estado === 'anulado' ? 'ANULADO' : 'Por pagar'), W - M, y, { align: 'right' });
  y += 14;

  autoTable(doc, {
    startY: y,
    body: [
      filaPdf(['Chofer', nombre, 'Cédula', datos.cedula || '—']),
      filaPdf(['Cargo', datos.cargo || '—', 'Licencia', [c?.licencia_grado, c?.licencia_numero].filter(Boolean).join(' · ') || '—']),
      filaPdf(['Viajes', `${p.detalle.length}`, 'Tasa BCV', p.tasa ? `${p.tasa.toLocaleString('es-VE', { maximumFractionDigits: 2 })} Bs/$` : '—']),
    ],
    margin: MARGENES_TABLA_PDF, theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 2: { fontStyle: 'bold', cellWidth: 80 } },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 10;

  // Viajes
  autoTable(doc, {
    startY: y,
    head: [filaPdf(['N°', 'Fecha', 'Ruta', 'Tarifa', 'Reembolso', 'Deducción', 'Subtotal'])],
    body: p.detalle.map((l) => filaPdf([
      l.numero, fmtDate(l.fecha), l.ruta, usd(l.tarifa_usd),
      l.reembolso_usd ? usd(l.reembolso_usd) : '-', l.deduccion_usd ? `- ${usd(l.deduccion_usd)}` : '-',
      usd(l.tarifa_usd + l.reembolso_usd - l.deduccion_usd),
    ])),
    foot: [filaPdf(['', '', 'Totales', usd(calc.tarifas_usd), usd(calc.reembolsos_usd), calc.deducciones_usd ? `- ${usd(calc.deducciones_usd)}` : '-', usd(calc.tarifas_usd + calc.reembolsos_usd - calc.deducciones_usd)])],
    margin: MARGENES_TABLA_PDF, theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 8 },
    footStyles: { fillColor: [240, 240, 240], textColor: 40, fontStyle: 'bold', fontSize: 8.5 },
    styles: { fontSize: 8, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 60 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 10;

  // Totales
  const filas: string[][] = [
    ['Tarifas de los viajes', usd(calc.tarifas_usd)],
    ['(+) Reembolsos de gastos en ruta', usd(calc.reembolsos_usd)],
  ];
  if (calc.bonos_usd) filas.push(['(+) Bonos', usd(calc.bonos_usd)]);
  filas.push(['(-) Viáticos no justificados', calc.deducciones_usd ? `- ${usd(calc.deducciones_usd)}` : usd(0)]);
  if (calc.otras_deducciones_usd) filas.push([`(-) Otras deducciones${p.otras_deducciones_motivo ? ` · ${p.otras_deducciones_motivo}` : ''}`, `- ${usd(calc.otras_deducciones_usd)}`]);
  filas.push(['NETO A PAGAR', usd(calc.neto_usd)]);
  if (calc.neto_bs != null) filas.push([`Equivalente en bolívares (tasa ${p.tasa?.toLocaleString('es-VE', { maximumFractionDigits: 2 }) ?? '—'})`, bs(calc.neto_bs)]);
  autoTable(doc, {
    startY: y,
    body: filas.map((f) => filaPdf(f)),
    margin: { ...MARGENES_TABLA_PDF, left: W / 2 },
    theme: 'grid', styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold', cellWidth: 100 } },
    didParseCell: (d: any) => { if (d.row.index === filas.length - (calc.neto_bs != null ? 2 : 1)) { d.cell.styles.fillColor = [255, 243, 224]; d.cell.styles.fontStyle = 'bold'; } },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  // Conformidad
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(40, 40, 40);
  const lineas = doc.splitTextToSize(textoPdf(textoConformidadViaje(calc, p.detalle.length, nombre)), anchoUtilPdf(W)) as string[];
  if (y + 10 + lineas.length * 10 > limiteInferiorPdf(H)) { doc.addPage(); y = M; }
  doc.text(lineas, M, y + 10);
  y += 10 + lineas.length * 10;
  if (p.nota) {
    doc.setFontSize(8); doc.setTextColor(...GRIS);
    const n = doc.splitTextToSize(textoPdf(`Nota: ${p.nota}`), anchoUtilPdf(W)) as string[];
    doc.text(n, M, y + 8); y += 8 + n.length * 10;
    doc.setTextColor(40, 40, 40);
  }

  // Firmas
  const fy = limiteInferiorPdf(H) - 40;
  if (y + 16 > fy) doc.addPage();
  const colW = (anchoUtilPdf(W) - 40) / 2;
  doc.setDrawColor(120); doc.setLineWidth(0.7);
  doc.line(M, fy, M + colW, fy);
  doc.line(M + colW + 40, fy, M + colW * 2 + 40, fy);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Firma del chofer', M + colW / 2, fy + 11, { align: 'center' });
  doc.text(textoPdf(nombre), M + colW / 2, fy + 22, { align: 'center' });
  doc.text('Quien paga', M + colW + 40 + colW / 2, fy + 11, { align: 'center' });
  doc.text(textoPdf(p.pagado_por || 'Administración'), M + colW + 40 + colW / 2, fy + 22, { align: 'center' });

  previewPdfDoc(doc, `recibo-viaje-${p.numero}-${nombre}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '.pdf');
}
