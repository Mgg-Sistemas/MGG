/* ============================================================
   MGG · Cocina · PDF de Cierre de Mercado (21 días)
   Consumos por ítem + LO QUE QUEDA (remanente que arrastra al próximo mercado).
   Se usa para vista previa/descarga y para enviarlo por correo (base64).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { CierreSnapshot, MercadoCocina } from './mercados.repository';

function money(n: number | null | undefined): string {
  return `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function num(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}
function fmtDia(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

/* eslint-disable @typescript-eslint/no-explicit-any */
async function construir(cocinaNombre: string, mercado: MercadoCocina, snap: CierreSnapshot) {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
    import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('CIERRE DE MERCADO', W / 2 + 24, y + 18, { align: 'center' });
  doc.setTextColor(40, 40, 40); doc.setFontSize(11);
  doc.text(`🍳 ${cocinaNombre}`, W / 2 + 24, y + 34, { align: 'center' });
  doc.setTextColor(90, 90, 90); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Mercado #${mercado.numero} · ${fmtDia(mercado.fecha_inicio)} → ${fmtDia(mercado.fecha_fin)}`, W / 2 + 24, y + 48, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 66;

  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text(
    `Platos: ${num(snap.totales.platos)}   ·   Consumo total: ${money(snap.totales.valor)}   ·   Entradas del período: ${money(snap.totales.entradasValor)}`,
    MARGIN, y,
  );
  y += 12;

  // Consumos por ítem
  autoTable(doc, {
    startY: y + 6,
    head: [['CONSUMIDO POR ÍTEM', 'CANTIDAD', 'VALOR $']],
    body: snap.consumos.length
      ? snap.consumos.map((v) => [`${v.nombre} (${v.sku})`, `${num(v.cantidad)} ${v.unidad}`, money(v.valor)])
      : [['Sin consumos en el período', '', '']],
    styles: { fontSize: 8.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 320 }, 1: { halign: 'right' }, 2: { halign: 'right' } },
    foot: [['TOTAL', '', money(snap.totales.valor)]],
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // LO QUE QUEDA (remanente) — resaltado en verde
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 130, 60);
  doc.text('LO QUE QUEDA (pasa al próximo mercado)', MARGIN, y);
  doc.setTextColor(0, 0, 0);
  autoTable(doc, {
    startY: y + 6,
    head: [['VÍVER', 'DISPONIBLE PARA EL PRÓXIMO MERCADO']],
    body: snap.remanente.length
      ? snap.remanente.map((v) => [`${v.nombre} (${v.sku})`, `${num(v.cantidad)} ${v.unidad}`])
      : [['Sin remanente', '—']],
    styles: { fontSize: 8.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [46, 160, 80], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 320 }, 1: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // Entradas del período
  if (snap.entradas.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Entradas del período', MARGIN, y);
    autoTable(doc, {
      startY: y + 6,
      head: [['VÍVER', 'CANTIDAD', 'VALOR $']],
      body: snap.entradas.map((v) => [`${v.nombre} (${v.sku})`, `${num(v.cantidad)} ${v.unidad}`, money(v.valor)]),
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 320 }, 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as any).lastAutoTable.finalY + 12;
  }

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);
  return doc;
}

/** Nombre de archivo sugerido para el PDF del cierre. */
export function nombreArchivoCierre(cocinaNombre: string, mercado: MercadoCocina): string {
  const slug = cocinaNombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  return `cierre-mercado-${slug}-${mercado.numero}.pdf`;
}

/** Abre el PDF del cierre en vista previa (descarga). */
export async function descargarCierrePdf(cocinaNombre: string, mercado: MercadoCocina, snap: CierreSnapshot): Promise<void> {
  const doc = await construir(cocinaNombre, mercado, snap);
  previewPdfDoc(doc, nombreArchivoCierre(cocinaNombre, mercado));
}

/** Devuelve el PDF del cierre como base64 (sin prefijo data URI) para enviarlo por correo. */
export async function cierrePdfBase64(cocinaNombre: string, mercado: MercadoCocina, snap: CierreSnapshot): Promise<string> {
  const doc = await construir(cocinaNombre, mercado, snap);
  const dataUri = doc.output('datauristring');
  return dataUri.split(',', 2)[1] ?? '';
}
