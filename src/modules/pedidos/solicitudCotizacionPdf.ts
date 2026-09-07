/* ============================================================
   MGG · Compras · PDF de la solicitud aprobada (para cotizar)
   Lo que se le manda al proveedor ANTES de que haya ofertas: qué se
   pide, en qué medida y cuánto, con la columna de precio EN BLANCO
   para que la complete. Sale del detalle de la orden mientras está
   aprobada / asignada, que es cuando todavía no hay nada cargado.
   Solo por botón: nunca se descarga solo.
   ============================================================ */
import type { Orden } from '@/shared/lib/types';

export interface FilaSolicitud {
  n: string;
  sku: string;
  nombre: string;
  medida: string;
  cantidad: string;
}

const texto = (v: unknown): string => String(v ?? '').trim();

/** Cantidad sin decimales de relleno: 2 y no «2,00»; 0,5 se respeta. */
function cantidadTexto(v: unknown): string {
  const n = Number(v) || 0;
  return n.toLocaleString('es-VE', { maximumFractionDigits: 3 });
}

/**
 * Los renglones que se cotizan. Se dejan afuera los marcados como «no
 * comprar»: están en la orden pero no se le piden al proveedor.
 */
export function filasSolicitud(orden: Pick<Orden, 'items'>): FilaSolicitud[] {
  return (orden.items ?? [])
    .filter((it) => it.comprar !== false)
    .map((it, i) => ({
      n: String(i + 1),
      sku: texto(it.sku) || '—',
      nombre: texto(it.nombre) || '(sin nombre)',
      medida: texto(it.unidad) || '—',
      cantidad: cantidadTexto(it.cantidad),
    }));
}

/**
 * Descripción de la solicitud: motivo y finalidad, sin repetir. En muchas
 * órdenes viejas los dos campos traen el MISMO texto y se imprimía dos veces.
 */
export function descripcionSolicitud(orden: Pick<Orden, 'motivo' | 'finalidad'>): string {
  const motivo = texto(orden.motivo);
  const finalidad = texto(orden.finalidad);
  if (!finalidad || finalidad.toUpperCase() === motivo.toUpperCase()) return motivo;
  if (!motivo) return finalidad;
  return `${motivo}\n${finalidad}`;
}

export async function descargarSolicitudCotizacionPdf(orden: Orden): Promise<void> {
  const [{ dateTime }, { loadLogoDataUrl }, { previewPdfDoc }, { jsPDF }, { default: autoTable }] =
    await Promise.all([
      import('@/shared/lib/format'),
      import('@/shared/lib/pdfLogo'),
      import('@/shared/lib/reportPreview'),
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;

  // ─── Encabezado ────────────────────────────────────────
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 58 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Mineral Group Guayana C.A.', tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Solicitud de cotización', tx, y + 32);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(orden.codigo, PAGE_W - MARGIN, y + 16, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Fecha: ${dateTime(orden.created_at)}`, PAGE_W - MARGIN, y + 32, { align: 'right' });
  y += 60;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 18;

  // ─── Quién pide ────────────────────────────────────────
  const persona = texto(orden.solicitante_persona) || texto(orden.ci_solicitante)
    || texto(orden.solicitante_email) || '—';
  doc.setFontSize(10);
  const dato = (etiqueta: string, valor: string) => {
    doc.setFont('helvetica', 'bold'); doc.text(`${etiqueta}:`, MARGIN, y);
    doc.setFont('helvetica', 'normal'); doc.text(valor, MARGIN + 110, y);
    y += 15;
  };
  dato('Unidad solicitante', texto(orden.solicitante) || '—');
  dato('Solicitante', persona);

  // ─── Descripción y nota ────────────────────────────────
  const anchoTexto = PAGE_W - MARGIN * 2 - 110;
  const parrafo = (etiqueta: string, cuerpo: string) => {
    if (!cuerpo) return;
    doc.setFont('helvetica', 'bold'); doc.text(`${etiqueta}:`, MARGIN, y);
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(cuerpo, anchoTexto) as string[];
    doc.text(lineas, MARGIN + 110, y);
    y += Math.max(15, lineas.length * 12 + 3);
  };
  parrafo('Descripción', descripcionSolicitud(orden));
  parrafo('Nota', texto(orden.notas));
  y += 8;

  // ─── Lo que se cotiza ──────────────────────────────────
  const filas = filasSolicitud(orden);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(`Materiales solicitados (${filas.length})`, MARGIN, y);
  y += 10;

  autoTable(doc, {
    startY: y,
    head: [['#', 'SKU', 'MATERIAL', 'MEDIDA', 'CANT.', 'PRECIO UNIT.', 'TOTAL']],
    body: filas.map((f) => [f.n, f.sku, f.nombre, f.medida, f.cantidad, '', '']),
    theme: 'grid',
    headStyles: { fillColor: [230, 230, 230], textColor: 20, fontSize: 8.5 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: {
      0: { cellWidth: 22, halign: 'right' },
      1: { cellWidth: 62 },
      3: { cellWidth: 58 },
      4: { cellWidth: 42, halign: 'right' },
      // Las dos últimas van vacías a propósito: las completa el proveedor.
      5: { cellWidth: 68 },
      6: { cellWidth: 68 },
    },
    margin: { top: MARGIN, bottom: MARGIN + 40, left: MARGIN, right: MARGIN },
  });

  const finTabla = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  y = finTabla + 24;

  // ─── Para que el proveedor complete ────────────────────
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 130) { doc.addPage(); y = MARGIN; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('A completar por el proveedor', MARGIN, y);
  y += 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const mitad = (PAGE_W - MARGIN * 2 - 20) / 2;
  for (const [izq, der] of [
    ['Proveedor', 'RIF'],
    ['Validez de la oferta', 'Tiempo de entrega'],
    ['Condición de pago', 'Total cotizado'],
  ] as const) {
    doc.text(`${izq}:`, MARGIN, y);
    doc.setDrawColor(170); doc.setLineWidth(0.5);
    doc.line(MARGIN + 92, y + 2, MARGIN + mitad, y + 2);
    doc.text(`${der}:`, MARGIN + mitad + 20, y);
    doc.line(MARGIN + mitad + 112, y + 2, PAGE_W - MARGIN, y + 2);
    y += 22;
  }

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(
    `Documento auto-generado · ${dateTime(new Date().toISOString())} · Los precios los completa el proveedor.`,
    MARGIN, pageH - 24,
  );

  previewPdfDoc(doc, `${orden.codigo.replace(/[^\w.-]+/g, '_')}-cotizar.pdf`);
}
