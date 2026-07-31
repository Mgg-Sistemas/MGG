import { supabase } from '@/shared/lib/supabase';
import { dateTime, money, num } from '@/shared/lib/format';
import { loadLogoDataUrl, loadFirmaGerenteDataUrl, loadFirmaSalidasDataUrl } from '@/shared/lib/pdfLogo';

/** Correo de la Jefa de Administración (LEYDIS RENGEL): si confirmó ella la OC,
 *  el PDF muestra SU firma (firma2.jpeg) en vez de la del Gerente General. */
const EMAIL_JEFA_ADMIN = 'jhzgcontabilidad@gmail.com';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { descuentoEfectivo } from './ofertas.repository';
import type { OfertaDetalle, OfertaProveedor, Orden, Proveedor } from '@/shared/lib/types';

interface OcData {
  ordenes: Orden[];      // 1+ OPs que comparten la misma OC
  orden: Orden;          // la "principal" (referencia)
  proveedor: Proveedor | null;
  ofertaAceptada: OfertaProveedor | null;
  /** Todas las ofertas de la orden (para mostrar la del proveedor que desistió). */
  ofertas: OfertaProveedor[];
  /** Proveedores referenciados por id (oferentes / desistidos). */
  proveedoresMap: Map<string, Proveedor>;
  /** email (minúscula) → "Nombre Apellido" del usuario, para mostrar personas en vez del correo. */
  personaMap: Map<string, string>;
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

  // Usuarios → mostrar "Nombre Apellido" en vez del correo en quien aprueba/confirma.
  const personaMap = new Map<string, string>();
  const { data: usuarios } = await supabase.from('usuarios').select('email, nombre, apellido');
  (usuarios ?? []).forEach((u) => {
    const email = (u.email as string | null)?.toLowerCase();
    if (!email) return;
    const nom = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim();
    personaMap.set(email, nom || email);
  });

  return {
    ordenes,
    orden: orden as Orden,
    proveedor,
    ofertaAceptada,
    ofertas,
    proveedoresMap,
    personaMap,
  };
}

export async function descargarOrdenCompraPdf(ordenId: string): Promise<void> {
  const [{ ordenes, orden, proveedor, ofertaAceptada, ofertas, proveedoresMap, personaMap }, logoDataUrl, firmaDataUrl, firmaLeydisDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    cargarDatosOc(ordenId),
    loadLogoDataUrl().catch(() => null),
    loadFirmaGerenteDataUrl().catch(() => null),
    loadFirmaSalidasDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const esConsolidada = ordenes.length > 1;
  const totalGeneral = ordenes.reduce((a, o) => a + Number(o.total ?? 0), 0);
  // Servicio → "ORDEN DE SERVICIO" (detección por clase, respaldo por prefijo SV-).
  const esServicio = orden.clase === 'servicio' || (orden.codigo ?? '').toUpperCase().startsWith('SV-');

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
  doc.text(esServicio ? 'ORDEN DE SERVICIO' : 'ORDEN DE COMPRA', TEXT_X, y + 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(
    esConsolidada
      ? `N° ${ocLabel}  ·  Consolida ${ordenes.length} OPs`
      : `N° ${ocLabel}  ·  Ref. ${esServicio ? 'solicitud' : 'pedido'}: ${orden.codigo}`,
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
  // Cada columna respeta su ancho: el emisor a la izquierda y el proveedor en la
  // mitad derecha. Sin esto, una dirección larga se sale del margen derecho.
  const COL_R_X = PAGE_W / 2;
  const anchoColIzq = COL_R_X - MARGIN - 14;          // izquierda: del margen al centro (con holgura)
  const anchoColDer = (PAGE_W - MARGIN) - COL_R_X;    // derecha: del centro al margen derecho
  const envolver = (lineas: string[], ancho: number): string[] =>
    lineas.flatMap((t) => doc.splitTextToSize(String(t), ancho) as string[]);
  const emisorWrap = envolver(emisorLines, anchoColIzq);
  const provWrap = envolver(provLines, anchoColDer);
  emisorWrap.forEach((t, i) => doc.text(t, MARGIN, y + i * 12));
  provWrap.forEach((t, i) => doc.text(t, COL_R_X, y + i * 12));
  y += Math.max(emisorWrap.length, provWrap.length) * 12 + 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CONDICIONES', MARGIN, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const documentosOc = orden.historial?.find((h) => h.evento === 'oc_emitida')?.documentos ?? [];
  const clasificacion = orden.clasificacion ?? [];
  // Unidad solicitante = depto/unidad que pide (orden.solicitante); Solicitante = la persona.
  const unidadSolicitante = orden.solicitante?.trim() || '—';
  const solicitante = orden.ci_solicitante?.trim() || orden.solicitante_email || '—';
  // Correo → "Nombre Apellido" (analistas y gerente). Si no hay usuario, queda el correo.
  const persona = (email?: string | null) => {
    const e = email?.trim();
    if (!e) return '—';
    return personaMap.get(e.toLowerCase()) || e;
  };
  // Finalidad = la de los ítems (cada producto dice para qué se pide), unificada.
  const finalidadOrden = Array.from(new Set((orden.items ?? []).map((it) => it.finalidad?.trim()).filter(Boolean) as string[])).join(' · ')
    || orden.finalidad?.trim() || '—';
  const cond: Array<[string, string]> = [
    ['Unidad solicitante', unidadSolicitante],
    ['Solicitante', solicitante],
    ['Fecha de solicitud', orden.created_at ? dateTime(orden.created_at) : '—'],
    ['Finalidad', finalidadOrden],
    ['Notas', orden.notas?.trim() || '—'],
    ['Clasificación', clasificacion.length ? clasificacion.join(' · ') : '—'],
    ['Fecha de entrega prometida', ofertaAceptada?.fecha_entrega_prometida ?? '—'],
    ['Condiciones de pago', ofertaAceptada?.condiciones_pago ?? '—'],
    ['Documentos', documentosOc.length ? documentosOc.join(' · ') : '—'],
    ['Aprobada por (analista)', persona(orden.aprobada_por)],
    ['Aprobada el', orden.aprobada_en ? dateTime(orden.aprobada_en) : '—'],
    ['OC confirmada por (gerente)', persona(orden.oc_aprobada_por)],
    ['OC confirmada el', orden.oc_aprobada_en ? dateTime(orden.oc_aprobada_en) : '—'],
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

  // ─── Datos de la oferta elegida: técnicos + logística + precio BCV/efectivo ───
  // Snapshot guardado en la orden al elegir, con respaldo en la oferta aceptada.
  const detalleOferta: OfertaDetalle | null = ofertaAceptada?.detalle ?? orden.oferta_detalle ?? null;
  // El `total` de la orden ya viene con el descuento; el BCV original sale de la oferta
  // aceptada o del snapshot `oferta_precio_bcv` (no de `total`, que ya es el efectivo).
  const precioBcv = ofertaAceptada?.precio_total ?? orden.oferta_precio_bcv ?? (orden.total != null ? Number(orden.total) : null);
  const precioEfe = ofertaAceptada?.precio_efectivo ?? orden.oferta_precio_efectivo ?? null;
  const ahorro = descuentoEfectivo(precioBcv, precioEfe);
  const labLog = (v?: string | null) => v === 'incluido' ? 'Incluido en el precio' : v === 'por_cuenta' ? 'Por cuenta del comprador' : null;
  const tecnFilas: Array<[string, string]> = ([
    ['Marca', detalleOferta?.marca], ['Modelo', detalleOferta?.modelo], ['Procedencia', detalleOferta?.procedencia],
    ['Materiales', detalleOferta?.materiales], ['Dimensiones', detalleOferta?.dimensiones],
    ['Peso', detalleOferta?.peso], ['Nivel de calidad', detalleOferta?.calidad],
    ['Flete', labLog(detalleOferta?.logistica?.flete)], ['Transporte', labLog(detalleOferta?.logistica?.transporte)],
    ['Embalaje', labLog(detalleOferta?.logistica?.embalaje)], ['Seguros', labLog(detalleOferta?.logistica?.seguros)],
  ] as Array<[string, string | null | undefined]>).filter(([, v]) => v && String(v).trim()).map(([k, v]) => [k, String(v)] as [string, string]);
  // Precio según forma de pago (siempre que haya descuento por efectivo).
  if (ahorro && precioBcv != null && precioEfe != null) {
    tecnFilas.push(
      ['Precio total (BCV)', money(precioBcv)],
      ['Precio en divisa efectivo', money(precioEfe)],
      ['Ahorro por pago en efectivo', `${money(ahorro.diferencia)}  (−${ahorro.pct.toFixed(2)}%)`],
    );
  }
  // Descuento OBTENIDO (negociado): subtotal − descuento = total a pagar.
  const descObt = Number(orden.descuento_obtenido) || 0;
  if (descObt > 0) {
    const subtotalOc = Math.round(((Number(orden.total) || 0) + descObt) * 100) / 100;
    tecnFilas.push(
      ['Subtotal', money(subtotalOc)],
      ['Descuento obtenido', `− ${money(descObt)}`],
      ['Total a pagar (con descuento)', money(Number(orden.total) || 0)],
    );
  }
  if (tecnFilas.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('DATOS DE LA OFERTA ELEGIDA', MARGIN, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      body: tecnFilas,
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180, fillColor: [244, 244, 244] }, 1: { cellWidth: 'auto' } },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  }

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
      head: [['SKU', 'Descripción', 'Marca / Modelo', 'Categoría', 'Subcategoría', 'Cantidad', 'Precio unit.', 'Subtotal']],
      // Marca/Modelo en su propia columna: solo aparece poblada cuando el usuario la cargó en la oferta.
      body: o.items.map((it) => [
        it.sku,
        it.nombre,
        [it.marca, it.modelo].filter(Boolean).join(' · ') || '—',
        it.servicio_categoria?.trim() || '—',
        it.servicio_tipo?.trim() || '—',
        num(it.cantidad),
        money(it.precio),
        money(it.cantidad * it.precio),
      ]),
      foot: [['', '', '', '', '', '', esConsolidada ? `Subtotal ${o.codigo}` : 'TOTAL', money(o.total)]],
      theme: 'grid',
      headStyles: { fillColor: [255, 138, 0], textColor: 255 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
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

  // Firma de quien AUTORIZÓ la OC: se inserta abajo a la izquierda cuando la OC ya
  // fue confirmada (oc_aprobada en adelante). Si la confirmó la Jefa de Administración
  // (LEYDIS RENGEL) se estampa SU firma (firma2.jpeg); si no, la del Gerente General.
  const aprobadaPorGG = !!(orden.oc_aprobada_por || orden.oc_aprobada_en)
    || ['oc_aprobada', 'pagada', 'oc_emitida', 'recibida', 'finalizada', 'por_recibir', 'cuenta_abierta'].includes(orden.estado);
  const aproboJefaAdmin = (orden.oc_aprobada_por ?? '').toLowerCase() === EMAIL_JEFA_ADMIN;
  const firmaMostrar = aproboJefaAdmin ? firmaLeydisDataUrl : firmaDataUrl;
  const firmaFmt = aproboJefaAdmin ? 'JPEG' : 'PNG';
  const firmaLabel = aproboJefaAdmin ? 'Firma autorizada · Jefa de Administración' : 'Firma autorizada · Gerente General';
  if (firmaMostrar && aprobadaPorGG) {
    try {
      const fw = 120, fh = 50;
      doc.addImage(firmaMostrar, firmaFmt, MARGIN + 6, pageH - 80 - fh + 6, fw, fh, undefined, 'FAST');
    } catch { /* firma opcional */ }
  }

  doc.setDrawColor(180);
  doc.line(MARGIN, pageH - 80, MARGIN + 200, pageH - 80);
  doc.line(PAGE_W - MARGIN - 200, pageH - 80, PAGE_W - MARGIN, pageH - 80);
  doc.setFontSize(9);
  doc.text(aprobadaPorGG ? firmaLabel : 'Firma autorizada · MGG', MARGIN, pageH - 66);
  doc.text('Recibido por proveedor', PAGE_W - MARGIN, pageH - 66, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Documento auto-generado · ${orden.codigo} · ${dateTime(new Date().toISOString())}`,
    MARGIN,
    pageH - 24,
  );

  // Vista previa directa (no depende del parche global de jsPDF.save): muestra el
  // visor con botón Descargar, evitando que el navegador baje el archivo de una.
  previewPdfDoc(doc, `${ocLabel}.pdf`);
}
