/* ============================================================
   MGG · Inventario · PDF del Resumen de actividad
   Vista previa (previewPdfDoc) + envío por correo (Edge Function).
   ============================================================ */
import { dateTime, money, num } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { ResumenInventarioMovs } from './inventarioResumen.repository';

export interface ResumenAlmacenFila {
  nombre: string;
  esSub: boolean;
  valor: number;
  unidades: number;
  items: number;
}

export interface ResumenInventarioFull {
  desde: string;
  hasta: string;
  totalInventario: number;
  almacenes: ResumenAlmacenFila[];
  movs: ResumenInventarioMovs;
}

const MARGIN = 42.52; // 1,5 cm

async function construirDoc(data: ResumenInventarioFull) {
  const [{ jsPDF }, { default: autoTable }, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl().catch(() => null),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  const LOGO_SIZE = 56;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE); } catch { /* logo opcional */ } }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Resumen de Inventario', TEXT_X, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Mineral Group Guayana C.A. · Período ${data.desde} → ${data.hasta}`, TEXT_X, y + 36);
  doc.text(`Generado ${dateTime(new Date().toISOString())}`, TEXT_X, y + 50);
  y += Math.max(LOGO_SIZE, 50) + 10;

  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 18;
  doc.setLineWidth(0.5);
  doc.setDrawColor(180);

  // KPIs
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Indicadores', MARGIN, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    body: [
      ['Valor total del inventario', money(data.totalInventario)],
      ['Productos nuevos (entraron)', `${num(data.movs.nuevos.count)}  ·  ${money(data.movs.nuevos.total)}`],
      ['Salidas', `${num(data.movs.salidas.count)}  ·  ${money(data.movs.salidas.total)}`],
      ['Traslados', `${num(data.movs.traslados.count)}  ·  ${money(data.movs.traslados.total)}`],
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 240 }, 1: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  // Almacenes y subalmacenes
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Total por almacén y subalmacén', MARGIN, y);
  autoTable(doc, {
    startY: y + 6,
    head: [['Almacén', 'Productos', 'Unidades', 'Valor']],
    body: data.almacenes.map((a) => [
      (a.esSub ? '    › ' : '') + a.nombre,
      num(a.items),
      num(a.unidades),
      money(a.valor),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8, cellPadding: 3 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  // Detalle de movimientos por grupo
  const grupos: Array<[string, ResumenInventarioMovs['salidas']]> = [
    ['Productos nuevos', data.movs.nuevos],
    ['Salidas', data.movs.salidas],
    ['Traslados', data.movs.traslados],
  ];
  for (const [titulo, g] of grupos) {
    if (!g.items.length) continue;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const yTit = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
    doc.text(`${titulo} (${g.count})`, MARGIN, yTit);
    autoTable(doc, {
      startY: yTit + 6,
      head: [['Fecha', 'SKU', 'Producto', 'Cant.', 'Almacén', 'Destino', 'Valor']],
      body: g.items.map((it) => [
        dateTime(it.at),
        it.sku ?? '—',
        it.nombre ?? '—',
        `${num(it.cantidad)} ${it.unidad ?? ''}`.trim(),
        it.almacen ?? '—',
        it.destino ?? '—',
        money(it.valor),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 8 },
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      columnStyles: { 3: { halign: 'right' }, 6: { halign: 'right' } },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
  }

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Documento auto-generado · Resumen de Inventario · ${dateTime(new Date().toISOString())}`, MARGIN, pageH - 24);
  return doc;
}

export async function descargarResumenInventarioPdf(data: ResumenInventarioFull): Promise<void> {
  const doc = await construirDoc(data);
  previewPdfDoc(doc, `resumen-inventario-${data.desde}_${data.hasta}.pdf`);
}

export async function enviarResumenInventarioPorCorreo(data: ResumenInventarioFull, destinos: string[]): Promise<string[]> {
  const { supabase } = await import('@/shared/lib/supabase');
  const doc = await construirDoc(data);
  const base64 = doc.output('datauristring').split(',')[1] ?? '';
  const { data: res, error } = await supabase.functions.invoke<{ ok: true; destinatarios: string[] } | { error: string }>('enviar-reporte', {
    body: {
      pdf_base64: base64,
      nombre_archivo: `resumen-inventario-${data.desde}_${data.hasta}.pdf`,
      asunto: `Resumen de Inventario · ${data.desde} → ${data.hasta}`,
      mensaje: `Resumen de Inventario del período ${data.desde} al ${data.hasta}.`,
      to_emails: destinos,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!res || 'error' in res) throw new Error((res as { error?: string })?.error || 'Respuesta inválida');
  return res.destinatarios;
}
