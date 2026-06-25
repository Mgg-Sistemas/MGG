import type { jsPDF as jsPDFType } from 'jspdf';
import { supabase } from '@/shared/lib/supabase';
import { dateTime, money, num } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type {
  EvaluacionRecepcion,
  OfertaProveedor,
  Orden,
  Proveedor,
} from '@/shared/lib/types';

interface TrazabilidadData {
  orden: Orden;
  proveedorFinal: Proveedor | null;
  proveedoresPorId: Map<string, Proveedor>;
  ofertas: OfertaProveedor[];
  evaluacion: EvaluacionRecepcion | null;
  /** email → nombre, para mostrar quién aprobó/confirmó (no el correo crudo). */
  nombrePorEmail: Map<string, string>;
}

async function cargarTrazabilidad(ordenId: string): Promise<TrazabilidadData> {
  const [{ data: orden, error: oe }, { data: ofertas, error: ofe }, { data: evals, error: ee }] = await Promise.all([
    supabase.from('ordenes').select('*').eq('id', ordenId).single(),
    supabase.from('ofertas_proveedor').select('*').eq('orden_id', ordenId).order('precio_total'),
    supabase.from('evaluaciones_recepcion').select('*').eq('orden_id', ordenId).maybeSingle(),
  ]);
  if (oe || !orden) throw oe ?? new Error('Orden no encontrada');
  if (ofe) throw ofe;
  if (ee) throw ee;

  const provIds = new Set<string>();
  if (orden.proveedor_id) provIds.add(orden.proveedor_id);
  (ofertas ?? []).forEach((o) => provIds.add(o.proveedor_id));
  let proveedoresPorId = new Map<string, Proveedor>();
  if (provIds.size) {
    const { data: provs } = await supabase
      .from('proveedores')
      .select('*')
      .in('id', Array.from(provIds));
    (provs ?? []).forEach((p: Proveedor) => proveedoresPorId.set(p.id, p));
  }

  // Resolvemos los correos de quienes intervinieron (aprobó / confirmó / creó OC)
  // a su nombre, para no mostrar el correo crudo en el PDF.
  const emails = Array.from(new Set(
    [orden.aprobada_por, orden.oc_aprobada_por, orden.oc_creada_por, orden.solicitante_email]
      .filter((e): e is string => !!e),
  ));
  const nombrePorEmail = new Map<string, string>();
  if (emails.length) {
    const { data: us } = await supabase.from('usuarios').select('email, nombre, apellido').in('email', emails);
    (us ?? []).forEach((u: { email?: string; nombre?: string; apellido?: string }) => {
      const nom = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim();
      if (u.email && nom) nombrePorEmail.set(u.email, nom);
    });
  }

  return {
    orden: orden as Orden,
    proveedorFinal: orden.proveedor_id ? proveedoresPorId.get(orden.proveedor_id) ?? null : null,
    proveedoresPorId,
    ofertas: (ofertas ?? []) as OfertaProveedor[],
    evaluacion: (evals ?? null) as EvaluacionRecepcion | null,
    nombrePorEmail,
  };
}

interface BuildResult {
  doc: jsPDFType;
  codigo: string;
  filename: string;
}

async function buildTrazabilidadPdf(ordenId: string): Promise<BuildResult> {
  const [data, logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    cargarTrazabilidad(ordenId),
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const { orden, proveedorFinal, proveedoresPorId, ofertas, evaluacion, nombrePorEmail } = data;
  // email → nombre (o el propio correo si no está en usuarios).
  const quien = (email?: string | null) => (email ? nombrePorEmail.get(email) ?? email : '—');

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  // ─── Header ────────────────────────────────────────────
  const LOGO_SIZE = 56;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE);
    } catch {
      /* logo opcional: ignorar si falla */
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Trazabilidad de orden de pedido', TEXT_X, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `Mineral Group Guayana C.A. · Generado ${dateTime(new Date().toISOString())}`,
    TEXT_X,
    y + 36,
  );
  y += Math.max(LOGO_SIZE, 36) + 10;

  doc.setDrawColor(200);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 16;

  // ─── 1. Solicitud ──────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`1. Solicitud · ${orden.codigo}`, MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const filasSolicitud: Array<[string, string]> = [
    ['Unidad solicitante', orden.solicitante ?? '—'],
    ['Solicitante', orden.ci_solicitante ?? '—'],
    ['Correo', orden.solicitante_email],
    ['Fecha de solicitud', dateTime(orden.created_at)],
    ['Estado actual', orden.estado],
    ['Clasificación', orden.clasificacion?.length ? orden.clasificacion.join(' · ') : '—'],
    ['Aprobada por', orden.aprobada_en ? quien(orden.aprobada_por) : '— (pendiente)'],
    ['Fecha de aprobación', orden.aprobada_en ? dateTime(orden.aprobada_en) : '—'],
    ['Nota', orden.notas ?? '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: filasSolicitud,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 140 }, 1: { cellWidth: 'auto' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // ─── 2. Ítems solicitados ──────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.text('2. Ítems solicitados', MARGIN, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [['SKU', 'Producto', 'Categoría', 'Subcategoría', 'Cantidad', 'Precio unit.', 'Subtotal']],
    body: orden.items.map((it) => [
      it.sku,
      it.nombre,
      it.servicio_categoria?.trim() || '—',
      it.servicio_tipo?.trim() || '—',
      num(it.cantidad),
      money(it.precio),
      money(it.cantidad * it.precio),
    ]),
    foot: [['', '', '', '', '', 'TOTAL', money(orden.total)]],
    theme: 'grid',
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // ─── 3. Ofertas de proveedores ─────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.text(`3. Ofertas de proveedores (${ofertas.length})`, MARGIN, y);
  y += 6;
  if (!ofertas.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text('Sin ofertas registradas.', MARGIN, y + 12);
    y += 28;
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Proveedor', 'Precio total', 'Entrega prom.', 'Estado', 'Score']],
      body: ofertas.map((of) => [
        proveedoresPorId.get(of.proveedor_id)?.razon_social ?? '—',
        money(of.precio_total),
        of.fecha_entrega_prometida ?? '—',
        of.estado,
        of.score_calculado != null ? `${(of.score_calculado * 100).toFixed(0)}` : '—',
      ]),
      theme: 'grid',
      headStyles: { fillColor: [230, 230, 230], textColor: 20 },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 1: { halign: 'right' }, 4: { halign: 'right' } },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }

  // ─── 4. Orden de compra (proveedor aceptado) ───────────
  doc.setFont('helvetica', 'bold');
  doc.text(`4. Orden de compra${orden.oc_codigo ? ` · ${orden.oc_codigo}` : ''}`, MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  const ofertaAceptada = ofertas.find((o) => o.estado === 'aceptada');
  const ocEvento = orden.historial?.find((h) => h.evento === 'oc_emitida');
  const documentosOc = ocEvento?.documentos ?? [];
  const filasOrden: Array<[string, string]> = [
    ['N° de orden de compra', orden.oc_codigo ?? '—'],
    ['Proveedor adjudicado', proveedorFinal?.razon_social ?? '—'],
    ['RIF', proveedorFinal?.rif ?? '—'],
    ['Contacto', proveedorFinal?.contacto ?? '—'],
    ['Total de la orden', money(orden.total)],
    ['Almacén destino', orden.almacen_destino ?? '—'],
    ['OC confirmada por', orden.oc_aprobada_en ? quien(orden.oc_aprobada_por) : '—'],
    ['Fecha de confirmación', orden.oc_aprobada_en ? dateTime(orden.oc_aprobada_en) : '—'],
    ['Fecha de entrega prometida', ofertaAceptada?.fecha_entrega_prometida ?? '—'],
    ['Condiciones de pago', ofertaAceptada?.condiciones_pago ?? '—'],
    ['Documentos de la OC', documentosOc.length ? documentosOc.join(' · ') : '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: filasOrden,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180 }, 1: { cellWidth: 'auto' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // ─── 5. Recepción ──────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.text('5. Recepción de mercancía', MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  const recibida = orden.historial?.find((h) => h.evento === 'recibida');
  // Una orden recibida puede luego finalizarse; en ambos estados sigue "recibida".
  const fueRecibida = ['recibida', 'finalizada'].includes(orden.estado) || !!recibida;
  const filasRecepcion: Array<[string, string]> = [
    ['Estado', fueRecibida ? 'Recibida' : 'Aún no recibida'],
    ['Fecha de recepción', recibida ? dateTime(recibida.at) : '—'],
    ['Recibida por', recibida?.actor ?? '—'],
    ['Calidad evaluada', evaluacion ? `${evaluacion.calidad} / 5` : '—'],
    ['Puntualidad', evaluacion ? (
      evaluacion.puntualidad_dias === 0
        ? 'En fecha prometida'
        : evaluacion.puntualidad_dias > 0
          ? `${evaluacion.puntualidad_dias} días adelantado`
          : `${Math.abs(evaluacion.puntualidad_dias)} días atrasado`
    ) : '—'],
    ['Comentario', evaluacion?.comentario ?? '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: filasRecepcion,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180 }, 1: { cellWidth: 'auto' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  // ─── Footer ────────────────────────────────────────────
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Documento auto-generado · Orden ${orden.codigo} · ${dateTime(new Date().toISOString())}`,
    MARGIN,
    pageH - 24,
  );

  return { doc, codigo: orden.codigo, filename: `trazabilidad-${orden.codigo}.pdf` };
}

/** Descarga el PDF al disco del usuario. */
export async function descargarTrazabilidadPdf(ordenId: string): Promise<void> {
  const { doc, filename } = await buildTrazabilidadPdf(ordenId);
  previewPdfDoc(doc, filename);
}

/** Devuelve el PDF como base64 (sin el prefijo data URI). Útil para enviarlo
 *  por correo desde la Edge Function. */
export async function obtenerTrazabilidadPdfBase64(
  ordenId: string,
): Promise<{ base64: string; codigo: string; filename: string }> {
  const { doc, codigo, filename } = await buildTrazabilidadPdf(ordenId);
  // jsPDF.output('datauristring') retorna `data:application/pdf;filename=...;base64,JVBE...`
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',', 2)[1] ?? '';
  return { base64, codigo, filename };
}
