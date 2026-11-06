/* ============================================================
   Golden Touch · Tesorería · PDF resumen de pendientes por pagar
   Relación de TODO lo pendiente por pagar, POR SEGMENTOS:
     · 🛒 Compras Directas
     · 📄 Órdenes de Compra (OC)
     · 🔧 Servicios (Control de Servicio · CS)
     · 🧰 Servicios Directos
   Cada renglón en $ y su equivalente en Bs a la TASA DEL DÍA (BCV).
   Subtotal por segmento (en grande) y TOTAL GENERAL (en grande),
   ambos en $ y en Bs. Vista previa.

   MÉTODO Y DATOS DE PAGO: cada renglón dice CÓMO se le paga y A DÓNDE, para
   poder pagar con el papel en la mano sin volver a la pantalla a buscar el
   teléfono del pago móvil o el número de cuenta. Es la columna ancha y la de
   letra más grande: es el dato con el que se actúa.

   NO HAY COLUMNA DE NOTAS NI DE FINALIDAD/DETALLE. Las dos contaban QUÉ se
   compró y POR QUÉ, y se comían el ancho de la tabla. Con este papel no se
   decide qué comprar —eso ya se decidió— sino que se PAGA, y para pagar hacen
   falta cuatro cosas: a quién, cuánto, por cuál método y a qué cuenta. Lo
   demás está en la orden, a un clic en el sistema.
   Lo único de esas columnas que cambiaba el pago —un servicio que se salda
   por abonos— se dice ahora en «Estado».
     · Si Compras ya indicó el método, se muestra ese, con sus datos y
       —cuando el pago va partido en varias patas— el monto de cada una.
     · Si el documento todavía no tiene método (las compras y los servicios
       directos lo eligen recién al pagarlos), se muestran los datos que el
       proveedor tiene guardados, marcados «(registrado)». Son una referencia,
       no una instrucción: el método se decide al pagar.

   TEXTO SEGURO PARA jsPDF: todo lo que escribió una persona (proveedor,
   detalle, notas, datos de pago) pasa por `pdfSafe`. Las fuentes base de
   jsPDF dibujan Windows-1252: si UNA sola letra queda fuera —un emoji del
   catálogo de servicios, un ⚠ del propio reporte— jsPDF cambia de codificación
   y sale TODA la línea con las letras separadas una a una. Pasó con el aviso
   de cuentas a crédito.
   ============================================================ */
import type { OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';
import { previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { dibujarLogoPdf } from '@/shared/lib/pdfLogo';
import {
  cargarConLecturas, type DatosPendientesPorPagar, type SegmentoPendiente,
} from './pendientesPorPagar';

/** Bs con separador de miles VE y 2 decimales (sin prefijo). */
function bsNum(n: number): string {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Los datos (los mismos del Excel y del WhatsApp) llegan con texto crudo; aquí se sanean
 * para jsPDF. El método de pago se sanea línea por línea: `pdfSafe` recorta espacios al
 * principio y al final, y aplicado al bloque entero se comería los saltos que separan un
 * método del otro.
 */
interface FilaRep { codigo: string; proveedor: string; estado: string; pago: string; usd: number; bs: number }
interface Segmento { titulo: string; filas: FilaRep[]; subUsd: number; subBs: number }
const seguro = (seg: SegmentoPendiente): Segmento => ({
  titulo: seg.titulo,
  subUsd: seg.subUsd,
  subBs: seg.subBs,
  filas: seg.filas.map((f) => ({
    codigo: pdfSafe(f.codigo) || '—',
    proveedor: pdfSafe(f.proveedor) || '—',
    estado: f.estado,
    pago: f.pagos.map((l) => pdfSafe(l.texto)).filter(Boolean).join('\n') || '—',
    usd: f.usd,
    bs: f.bs,
  })),
});

/** Lo que llamaban Tesorería y Compras: lee los datos y abre la vista previa del PDF. */
export async function descargarOrdenesPorPagarPdf(
  rows: OrdenPorPagar[],
  opts?: { creditos?: OrdenPorPagar[] },
): Promise<void> {
  await descargarPendientesPorPagarPdf(await cargarConLecturas(rows, opts?.creditos ?? []));
}

/** Dibuja el PDF a partir de los datos ya armados (los mismos de las otras salidas). */
export async function descargarPendientesPorPagarPdf(datos: DatosPendientesPorPagar): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoPdfDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const { tasa, totUsd, totBs, totCant } = datos;
  const tasaHoy = { fecha: datos.tasaFecha };
  const segmentos = datos.segmentos.map(seguro);
  const segCredito = datos.credito ? seguro(datos.credito) : null;

  // ── Documento ──
  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 56.69; // 2 cm por lado
  let y = MARGIN;
  if (logo) { dibujarLogoPdf(doc, logo, MARGIN, y, 44); }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('PENDIENTES POR PAGAR', W / 2 + 28, y + 20, { align: 'center' });
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`GOLDEN TOUCH 1127 C.A. · Generado ${fmt.dateTime(datos.generadoEn)}`, W / 2 + 28, y + 35, { align: 'center' });
  if (tasa > 0) {
    doc.text(`Tasa BCV: Bs ${bsNum(tasa)} / $${tasaHoy?.fecha ? ' · ' + fmt.date(tasaHoy.fecha) : ''}`, W / 2 + 28, y + 48, { align: 'center' });
  }
  if (segCredito) {
    doc.setTextColor(180, 90, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    // Sin el ⚠ de antes: no existe en la fuente y arrastraba toda la línea a
    // la codificación equivocada. El aviso ya resalta por color y negrita.
    doc.text(`Incluye ${segCredito.filas.length} cuenta(s) a crédito abierta(s) · ${fmt.money(segCredito.subUsd)} (se saldan por abonos)`, W / 2 + 28, y + (tasa > 0 ? 60 : 48), { align: 'center' });
  }
  doc.setTextColor(0, 0, 0);
  y += segCredito ? 78 : 66;

  if (!segmentos.length && !segCredito) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90, 90, 90);
    doc.text('No hay pendientes por pagar.', MARGIN, y + 10);
    previewPdf(doc, `pendientes-por-pagar-${new Date().toISOString().slice(0, 10)}.pdf`);
    return;
  }
  if (!segmentos.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(90, 90, 90);
    doc.text('No hay pendientes por pagar inmediatos. Solo quedan cuentas a crédito abiertas (abajo).', MARGIN, y + 10);
    y += 24;
  }

  const drawTable = (seg: Segmento) => {
    // Título de segmento (salta de página si no cabe con al menos una fila).
    if (y > H - 120) { doc.addPage(); y = MARGIN; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 138, 0);
    doc.text(seg.titulo, MARGIN, y);
    doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(`${seg.filas.length} ítem(s)`, MARGIN + 260, y);
    doc.setTextColor(0, 0, 0);
    y += 6;

    const body = seg.filas.map((f, i) => [
      String(i + 1), f.codigo, f.proveedor, f.estado, f.pago,
      fmt.money(f.usd), tasa > 0 ? bsNum(f.bs) : '—',
    ]);
    autoTable(doc, {
      startY: y,
      head: [['ITEM', 'CÓDIGO', 'PROVEEDOR', 'ESTADO', 'MÉTODO Y DATOS DE PAGO', 'MONTO $', 'MONTO Bs']],
      body,
      foot: [['', '', '', '', 'SUBTOTAL', fmt.money(seg.subUsd), tasa > 0 ? bsNum(seg.subBs) : '—']],
      styles: { fontSize: 9, cellPadding: 4, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: [255, 244, 232], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'right', fontSize: 9 },
      tableWidth: 'auto',
      columnStyles: {
        0: { halign: 'center', cellWidth: 24 },
        1: { halign: 'center', cellWidth: 66 },
        2: { cellWidth: 140 },
        3: { halign: 'center', cellWidth: 72 },
        // Sin NOTAS ni FINALIDAD, todo el ancho sobrante queda para el método y
        // sus datos: es lo que se lee para pagar. Sin ancho fijo (se lleva el
        // resto de la tabla) y con el cuerpo más grande y en negrita.
        4: { fontSize: 10, fontStyle: 'bold', textColor: [20, 20, 20] },
        5: { halign: 'right', cellWidth: 58 },
        6: { halign: 'right', cellWidth: 68 },
      },
      margin: MARGIN,
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 16;
  };

  for (const seg of segmentos) drawTable(seg);

  // ── TOTAL GENERAL en grande ($ y su equivalente en Bs) ── (solo lo por pagar; el crédito va aparte)
  if (segmentos.length) {
    const boxH = tasa > 0 ? 76 : 48;
    if (y > H - (boxH + MARGIN)) { doc.addPage(); y = MARGIN; }
    const boxW = 340;
    const boxX = W - MARGIN - boxW;
    doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.4);
    doc.setFillColor(255, 244, 232);
    doc.roundedRect(boxX, y, boxW, boxH, 6, 6, 'FD');

    doc.setTextColor(60, 60, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`TOTAL GENERAL · ${totCant} ítem(s)`, boxX + 14, y + 22);
    doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
    doc.text(fmt.money(totUsd), boxX + boxW - 14, y + 26, { align: 'right' });

    if (tasa > 0) {
      doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
      doc.text(`Bs ${bsNum(totBs)}`, boxX + boxW - 14, y + 56, { align: 'right' });
      doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(`Convertido a la tasa BCV del día: Bs ${bsNum(tasa)} / $`, boxX + 14, y + 56);
    }
    doc.setTextColor(0, 0, 0);
    y += boxH + 20;
  }

  // ── Anexo: CUENTAS A CRÉDITO (no forman parte del total por pagar) ──
  if (segCredito) {
    if (y > H - 130) { doc.addPage(); y = MARGIN; }
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(120, 120, 120);
    doc.text('Estas compras se hicieron a crédito (cuenta abierta): NO entran en el total de arriba; se saldan por abonos en Tesorería.', MARGIN, y);
    y += 12;
    drawTable(segCredito);
  }

  previewPdf(doc, `pendientes-por-pagar-${new Date().toISOString().slice(0, 10)}.pdf`);
}


export async function descargarResumenPorPagarPdf(
  rows: OrdenPorPagar[],
  _directos: unknown[] = [],
  creditos: OrdenPorPagar[] = [],
): Promise<void> {
  return descargarOrdenesPorPagarPdf(rows, { creditos });
}
