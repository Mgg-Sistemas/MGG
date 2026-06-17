import { supabase } from '@/shared/lib/supabase';
import { dateTime, money, num } from '@/shared/lib/format';
import { loadLogoDataUrl, loadFirmaGerenteDataUrl } from '@/shared/lib/pdfLogo';
import type { OfertaProveedor, Orden, Proveedor } from '@/shared/lib/types';

interface OcData {
  ordenes: Orden[];      // 1+ OPs que comparten la misma OC
  orden: Orden;          // la "principal" (referencia)
  proveedor: Proveedor | null;
  ofertaAceptada: OfertaProveedor | null;
  /** Todas las ofertas de la orden (para mostrar la del proveedor que desistió). */
  ofertas: OfertaProveedor[];
  /** Proveedores referenciados por id (oferentes / desistidos). */
  proveedoresMap: Map<string, Proveedor>;
}

async function cargarDatosOc(ordenId: string): Promise<OcData> {
  const { data: orden, error: oe } = await supabase
    .from('ordenes')
    .select('*')
    .eq('id', ordenId)
    .single();
  if (oe || !orden) throw oe ?? new Error('Orden no encontrada');

  // Solo la orden seleccionada (no se consolidan hermanas en el PDF).
  const ordenes: Orden[] = [orden as Orden];

  let proveedor: Proveedor | null = null;
  if (orden.proveedor_id) {
    const { data: prov } = await supabase
      .from('proveedores')
      .select('*')
      .eq('id', orden.proveedor_id)
      .maybeSingle();
    proveedor = (prov ?? null) as Proveedor | null;
  }

  // Todas las ofertas de la orden (la aceptada + las descartadas, incluida la
  // del proveedor que desistió).
  const { data: ofertasData } = await supabase
    .from('ofertas_proveedor')
    .select('*')
    .eq('orden_id', ordenId);
  const ofertas = (ofertasData ?? []) as OfertaProveedor[];
  const ofertaAceptada = ofertas.find((of) => of.estado === 'aceptada') ?? null;

  // Proveedores referenciados (oferentes + el que desistió en el historial).
  const provIds = new Set<string>();
  ofertas.forEach((of) => of.proveedor_id && provIds.add(of.proveedor_id));
  ((orden as Orden).historial ?? []).forEach((h) => {
    const pid = (h as { proveedorAnteriorId?: string }).proveedorAnteriorId;
    if (pid) provIds.add(pid);
  });
  const proveedoresMap = new Map<string, Proveedor>();
  if (provIds.size) {
    const { data: provs } = await supabase
      .from('proveedores')
      .select('*')
      .in('id', Array.from(provIds));
    (provs ?? []).forEach((p) => proveedoresMap.set((p as Proveedor).id, p as Proveedor));
  }

  return {
    ordenes,
    orden: orden as Orden,
    proveedor,
    ofertaAceptada,
    ofertas,
    proveedoresMap,
  };
}

export async function descargarOrdenCompraPdf(ordenId: string): Promise<void> {
  const [{ ordenes, orden, proveedor, ofertaAceptada, ofertas, proveedoresMap }, logoDataUrl, firmaDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    cargarDatosOc(ordenId),
    loadLogoDataUrl().catch(() => null),
    loadFirmaGerenteDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const esConsolidada = ordenes.length > 1;
  const totalGeneral = ordenes.reduce((a, o) => a + Number(o.total ?? 0), 0);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  const LOGO_SIZE = 60;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE);
    } catch {
      /* logo opcional */
    }
  }
  const ocLabel = orden.oc_codigo ?? orden.codigo;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('ORDEN DE COMPRA', TEXT_X, y + 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(
    esConsolidada
      ? `N° ${ocLabel}  ·  Consolida ${ordenes.length} OPs`
      : `N° ${ocLabel}  ·  Ref. pedido: ${orden.codigo}`,
    TEXT_X,
    y + 38,
  );
  doc.text(
    `Emitida: ${dateTime(orden.oc_emitida_en ?? new Date().toISOString())}`,
    PAGE_W - MARGIN,
    y + 38,
    { align: 'right' },
  );
  // Sello ORDEN URGENTE (si la orden —o alguna de las consolidadas— está marcada).
  const esUrgente = esConsolidada ? ordenes.some((o) => o.urgente) : !!orden.urgente;
  if (esUrgente) {
    const txt = 'ORDEN URGENTE';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    const tw = doc.getTextWidth(txt);
    const bx = PAGE_W - MARGIN - tw - 16; const by = y + 48; const bh = 16;
    doc.setFillColor(239, 68, 68);
    doc.roundedRect(bx, by, tw + 16, bh, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(txt, bx + 8, by + 11.5);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
  }
  y += Math.max(LOGO_SIZE, 42) + (esUrgente ? 22 : 8);

  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 18;
  doc.setLineWidth(0.5);
  doc.setDrawColor(180);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('EMISOR', MARGIN, y);
  doc.text('PROVEEDOR', PAGE_W / 2, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const emisorLines = [
    'Mineral Group Guayana C.A.',
    'Sistema de Gestión de Inventarios',
  ];
  const provLines = [
    proveedor?.razon_social ?? '—',
    proveedor?.rif ? `RIF: ${proveedor.rif}` : '',
    proveedor?.contacto ? `Contacto: ${proveedor.contacto}` : '',
    proveedor?.email ?? '',
    proveedor?.telefono ?? '',
    proveedor?.direccion ?? '',
  ].filter(Boolean);
  emisorLines.forEach((t, i) => doc.text(t, MARGIN, y + i * 12));
  provLines.forEach((t, i) => doc.text(t, PAGE_W / 2, y + i * 12));
  y += Math.max(emisorLines.length, provLines.length) * 12 + 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CONDICIONES', MARGIN, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const documentosOc = orden.historial?.find((h) => h.evento === 'oc_emitida')?.documentos ?? [];
  const clasificacion = orden.clasificacion ?? [];
  const cond: Array<[string, string]> = [
    ['Clasificación', clasificacion.length ? clasificacion.join(' · ') : '—'],
    ['Fecha de entrega prometida', ofertaAceptada?.fecha_entrega_prometida ?? '—'],
    ['Condiciones de pago', ofertaAceptada?.condiciones_pago ?? '—'],
    ['Documentos', documentosOc.length ? documentosOc.join(' · ') : '—'],
    ['Aprobada por', orden.aprobada_por ?? '—'],
    ['Aprobada el', orden.aprobada_en ? dateTime(orden.aprobada_en) : '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: cond,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180 }, 1: { cellWidth: 'auto' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  // ─── Desistimientos de proveedor (datos del proveedor + su oferta) ───
  const historial = orden.historial ?? [];
  if (historial.some((h) => h.evento === 'desistida_proveedor')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('DESISTIMIENTOS DE PROVEEDOR', MARGIN, y);
    y += 10;

    let primero = true;
    historial.forEach((h, i) => {
      if (h.evento !== 'desistida_proveedor') return;

      // Evento "oferta_aceptada" inmediatamente anterior: trae proveedor, precio y
      // score del proveedor que estaba elegido cuando desistió (fallback robusto
      // cuando la orden no guardó `proveedorAnteriorId`).
      const prevAccept = historial
        .slice(0, i)
        .reverse()
        .find((e) => e.evento === 'oferta_aceptada') as
        | { proveedorId?: string; precio?: number; score?: number }
        | undefined;

      const pid = (h as { proveedorAnteriorId?: string }).proveedorAnteriorId ?? prevAccept?.proveedorId ?? null;
      const prov = pid ? proveedoresMap.get(pid) ?? null : null;
      const oferta = pid ? ofertas.find((of) => of.proveedor_id === pid) ?? null : null;

      // Valores de la oferta, con respaldo en el historial / total de la orden.
      const precioTotal = oferta?.precio_total ?? prevAccept?.precio ?? (orden.total != null ? Number(orden.total) : null);
      const score = oferta?.score_calculado ?? prevAccept?.score ?? null;

      if (!primero) y += 8;
      primero = false;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(20);
      doc.text(prov ? prov.razon_social : 'Proveedor (sin datos)', MARGIN, y + 4);
      y += 8;

      const filas: Array<[string, string]> = [
        ['RIF', prov?.rif ?? '—'],
        ['Contacto', prov?.contacto ?? '—'],
        ['Teléfono', prov?.telefono ?? '—'],
        ['Email', prov?.email ?? '—'],
        ['Oferta · Precio total', precioTotal != null ? money(precioTotal) : '—'],
        ['Oferta · Score', score != null ? num(score) : '—'],
        ['Oferta · Entrega prometida', oferta?.fecha_entrega_prometida ? dateTime(oferta.fecha_entrega_prometida) : '—'],
        ['Oferta · Condiciones de pago', oferta?.condiciones_pago ?? '—'],
        ['Desistió (fecha y hora)', dateTime(h.at)],
        ['Motivo', (h as { motivo?: string }).motivo ?? '—'],
        ['Registró', h.actor ?? '—'],
      ];
      autoTable(doc, {
        startY: y,
        body: filas,
        theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 3 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 170, fillColor: [244, 244, 244] }, 1: { cellWidth: 'auto' } },
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
    });
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(esConsolidada ? `ÍTEMS · ${ordenes.length} órdenes consolidadas` : 'ÍTEMS', MARGIN, y);
  y += 6;

  ordenes.forEach((o, idx) => {
    if (esConsolidada) {
      if (idx > 0) y += 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(o.codigo, MARGIN, y + 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Solicitante: ${o.ci_solicitante ?? o.solicitante ?? o.solicitante_email}`,
        PAGE_W - MARGIN,
        y + 12,
        { align: 'right' },
      );
      doc.setTextColor(0);
      y += 18;
    }

    autoTable(doc, {
      startY: y,
      head: [['SKU', 'Descripción', 'Área', 'Cantidad', 'Precio unit.', 'Subtotal']],
      body: o.items.map((it) => [
        it.sku,
        it.nombre,
        it.area?.trim() || '—',
        num(it.cantidad),
        money(it.precio),
        money(it.cantidad * it.precio),
      ]),
      foot: [['', '', '', '', esConsolidada ? `Subtotal ${o.codigo}` : 'TOTAL', money(o.total)]],
      theme: 'grid',
      headStyles: { fillColor: [255, 138, 0], textColor: 255 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  });

  if (esConsolidada) {
    autoTable(doc, {
      startY: y + 4,
      body: [['TOTAL GENERAL DE LA OC', money(totalGeneral)]],
      theme: 'plain',
      styles: { fontSize: 11, fontStyle: 'bold', cellPadding: 6 },
      columnStyles: { 0: { halign: 'right' }, 1: { halign: 'right', textColor: [255, 138, 0] } },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  }
  y += 20;

  const pageH = doc.internal.pageSize.getHeight();
  const FOOTER_RESERVA = 100; // espacio reservado para firmas + pie

  if (orden.notas) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const split = doc.splitTextToSize(orden.notas, PAGE_W - MARGIN * 2);
    const altoNotas = 12 + split.length * 11 + 16;
    // Si las notas + el pie no caben en la página, saltamos a una nueva.
    if (y + altoNotas > pageH - FOOTER_RESERVA) {
      doc.addPage();
      y = MARGIN;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Notas / observaciones', MARGIN, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(split, MARGIN, y);
    y += split.length * 11 + 16;
  }

  // Garantizar que el pie no se solape con el contenido: si no hay espacio, nueva página.
  if (y > pageH - FOOTER_RESERVA) {
    doc.addPage();
    y = MARGIN;
  }

  // Firma del Gerente General: se inserta abajo a la izquierda cuando la OC ya fue
  // aprobada por él (oc_aprobada en adelante). Sobre la línea "Firma autorizada · MGG".
  const aprobadaPorGG = !!(orden.oc_aprobada_por || orden.oc_aprobada_en)
    || ['oc_aprobada', 'pagada', 'oc_emitida', 'recibida', 'finalizada', 'por_recibir', 'cuenta_abierta'].includes(orden.estado);
  if (firmaDataUrl && aprobadaPorGG) {
    try {
      const fw = 120, fh = 50;
      doc.addImage(firmaDataUrl, 'PNG', MARGIN + 6, pageH - 80 - fh + 6, fw, fh, undefined, 'FAST');
    } catch { /* firma opcional */ }
  }

  doc.setDrawColor(180);
  doc.line(MARGIN, pageH - 80, MARGIN + 200, pageH - 80);
  doc.line(PAGE_W - MARGIN - 200, pageH - 80, PAGE_W - MARGIN, pageH - 80);
  doc.setFontSize(9);
  doc.text(aprobadaPorGG ? 'Firma autorizada · Gerente General' : 'Firma autorizada · MGG', MARGIN, pageH - 66);
  doc.text('Recibido por proveedor', PAGE_W - MARGIN, pageH - 66, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Documento auto-generado · ${orden.codigo} · ${dateTime(new Date().toISOString())}`,
    MARGIN,
    pageH - 24,
  );

  doc.save(`${ocLabel}.pdf`);
}
