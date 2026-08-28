/* ============================================================
   MGG · Salidas / Traslados · Reportes PDF
   Comprobantes de salida/traslado de material y de salida de
   dinero. Se descargan SOLO al hacer clic (regla del sistema).
   ============================================================ */
import type { Movimiento, MovimientoCaja, SolicitudSalida } from '@/shared/lib/types';
import { cargarPersonasPorEmail, personaDe } from '@/shared/lib/personas';
import { previewPdfDoc } from '@/shared/lib/reportPreview';

async function nuevoDoc(titulo: string) {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }, personas] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
    cargarPersonasPorEmail().catch(() => new Map<string, string>()),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 60 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(titulo, tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`MGG · ${fmt.dateTime(new Date().toISOString())}`, tx, y + 33);
  y += 60;
  return { doc, autoTable, fmt, MARGIN, y, personas };
}

/** Comprobante de salida o traslado de material. */
export async function descargarSalidaMaterialPdf(mov: Movimiento, esTraslado: boolean): Promise<void> {
  const { doc, autoTable, fmt, MARGIN, y, personas } = await nuevoDoc(esTraslado ? 'Comprobante de Traslado' : 'Comprobante de Salida');
  const prod = mov.producto;
  const cant = Math.abs(Number(mov.delta) || 0);
  const precio = Number(mov.precio_unitario) || 0;
  const ficha: Array<[string, string]> = [
    ['Producto', prod ? `${prod.sku} — ${prod.nombre}` : '—'],
    ['Almacén origen', mov.almacen || '—'],
    [esTraslado ? 'Almacén destino' : 'Dirigido a', mov.destino || '—'],
    ['Cantidad', `${fmt.num(cant)} ${prod?.unidad ?? ''}`.trim()],
    ['Precio unitario', precio ? fmt.money(precio) : '—'],
    ['Precio total', precio ? fmt.money(precio * cant) : '—'],
    ['Fecha de entrega', mov.fecha_entrega ? fmt.date(mov.fecha_entrega) : '—'],
    ...(mov.consumo_interno ? [['Consumo interno', 'Sí'] as [string, string]] : []),
    ['Motivo / detalle', mov.detalle || '—'],
    ...(mov.nota_entrega ? [['Nota de entrega', mov.nota_entrega] as [string, string]] : []),
    ['Registrado por', personaDe(mov.actor, personas, mov.actor_name)],
    ['Fecha de registro', fmt.dateTime(mov.at)],
  ];
  autoTable(doc, {
    startY: y, body: ficha, theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  previewPdfDoc(doc, `${esTraslado ? 'traslado' : 'salida'}-${(prod?.sku ?? 'material')}-${mov.id.slice(0, 8)}.pdf`);
}

/** Igual que el comprobante de salida/traslado pero devuelve el PDF en base64
 *  (para adjuntarlo en un correo vía Edge Function). No descarga nada. */
export async function obtenerSalidaMaterialPdfBase64(
  mov: Movimiento,
  esTraslado: boolean,
): Promise<{ base64: string; filename: string }> {
  const { doc, autoTable, fmt, MARGIN, y, personas } = await nuevoDoc(esTraslado ? 'Comprobante de Traslado' : 'Comprobante de Salida');
  const prod = mov.producto;
  const cant = Math.abs(Number(mov.delta) || 0);
  const precio = Number(mov.precio_unitario) || 0;
  const ficha: Array<[string, string]> = [
    ['Producto', prod ? `${prod.sku} — ${prod.nombre}` : '—'],
    ['Almacén origen', mov.almacen || '—'],
    [esTraslado ? 'Almacén destino' : 'Dirigido a', mov.destino || '—'],
    ['Cantidad', `${fmt.num(cant)} ${prod?.unidad ?? ''}`.trim()],
    ['Precio unitario', precio ? fmt.money(precio) : '—'],
    ['Precio total', precio ? fmt.money(precio * cant) : '—'],
    ['Fecha de entrega', mov.fecha_entrega ? fmt.date(mov.fecha_entrega) : '—'],
    ...(mov.consumo_interno ? [['Consumo interno', 'Sí'] as [string, string]] : []),
    ['Motivo / detalle', mov.detalle || '—'],
    ...(mov.nota_entrega ? [['Nota de entrega', mov.nota_entrega] as [string, string]] : []),
    ['Registrado por', personaDe(mov.actor, personas, mov.actor_name)],
    ['Fecha de registro', fmt.dateTime(mov.at)],
  ];
  autoTable(doc, {
    startY: y, body: ficha, theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',')[1] ?? '';
  return { base64, filename: `${esTraslado ? 'traslado' : 'salida'}-${(prod?.sku ?? 'material')}-${mov.id.slice(0, 8)}.pdf` };
}

/** Comprobante de salida de dinero (anticipo). */
export async function descargarSalidaDineroPdf(mov: MovimientoCaja): Promise<void> {
  const { doc, autoTable, fmt, MARGIN, y, personas } = await nuevoDoc('Comprobante de Salida de Dinero');
  const ficha: Array<[string, string]> = [
    ['Caja', mov.caja ? `${mov.caja.nombre} (${mov.caja.moneda})` : '—'],
    ['Dirigido a', mov.destino || '—'],
    ['Motivo', mov.motivo || '—'],
    ['Monto', `${fmt.money(Number(mov.monto) || 0)} ${mov.moneda}`],
    ['Estado', mov.estado_mineral === 'conciliada' ? 'Conciliada con mineral' : 'Pendiente de recepción'],
    ['Registrado por', personaDe(mov.actor, personas, mov.actor_name)],
    ['Fecha', fmt.dateTime(mov.at)],
  ];
  if (mov.estado_mineral === 'conciliada') {
    ficha.push(
      ['— Mineral recibido —', ''],
      ['Mineral', mov.mineral_producto_nombre || '—'],
      ['Total entrante', `${fmt.num(Number(mov.mineral_cantidad) || 0)} ${mov.mineral_unidad ?? ''}`.trim()],
      ['Costo por unidad', mov.mineral_costo_unit != null ? fmt.money(Number(mov.mineral_costo_unit)) : '—'],
      ['Descripción', mov.mineral_descripcion || '—'],
    );
  }
  autoTable(doc, {
    startY: y, body: ficha, theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160 } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  previewPdfDoc(doc, `salida-dinero-${mov.id.slice(0, 8)}.pdf`);
}

/** Comprobante de traslado de dinero entre cajas (incluye nota de entrega). */
export async function descargarTrasladoDineroPdf(mov: MovimientoCaja): Promise<void> {
  const { doc, autoTable, fmt, MARGIN, y, personas } = await nuevoDoc('Comprobante de Traslado de Dinero');
  const ficha: Array<[string, string]> = [
    ['Caja origen', mov.caja ? `${mov.caja.nombre} (${mov.caja.moneda})` : '—'],
    ['Caja destino', mov.destino || '—'],
    ['Monto', `${fmt.money(Number(mov.monto) || 0)} ${mov.moneda}`],
    ['Motivo', mov.motivo || '—'],
    ...(mov.nota_entrega ? [['Nota de entrega', mov.nota_entrega] as [string, string]] : []),
    ['Registrado por', personaDe(mov.actor, personas, mov.actor_name)],
    ['Fecha', fmt.dateTime(mov.at)],
  ];
  autoTable(doc, {
    startY: y, body: ficha, theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160 } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  previewPdfDoc(doc, `traslado-dinero-${mov.id.slice(0, 8)}.pdf`);
}

/* ============================================================
   ORDEN DE SALIDA (formato formal con firmas, estilo OP/OC)
   Para salidas y traslados de MATERIAL. Indica el material, el
   solicitante, el motivo, quién autorizó, y deja las líneas de
   firma de "Solicitado/Creado por" y "Autorizado por".
   ============================================================ */
const SOL_ESTADO_TXT: Record<string, string> = {
  por_aprobar: 'Por aprobar',
  aprobada: 'Aprobada',
  ejecutada: 'Ejecutada',
  cancelada: 'Cancelada',
};

export async function descargarOrdenSalidaPdf(sol: SolicitudSalida): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, pdfLogo, personas] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
    cargarPersonasPorEmail().catch(() => new Map<string, string>()),
  ]);
  const logo = await pdfLogo.loadLogoDataUrl().catch(() => null);
  // Firma de Leydi Rengel (solo en Salidas/Traslados), para el bloque "Autorizado por".
  const firmaSalidas = await pdfLogo.loadFirmaSalidasDataUrl().catch(() => null);

  const esTraslado = sol.scope === 'traslado';
  // Las salidas y traslados los AUTORIZA siempre Leydis Rengel (autorizadora fija):
  // el documento muestra su nombre y su firma en el bloque "Autorizado por".
  const AUTORIZA_SALIDAS = 'Leydis Rengel';
  const autorizoEmail = sol.ejecutada_por || sol.aprobada_por;
  const creo = personaDe(sol.actor, personas, sol.actor_name || sol.solicitante);

  // Líneas de la "factura": el detalle multi-producto si existe, si no la cabecera.
  const lineas = (sol.items && sol.items.length)
    ? sol.items
    : [{ producto_id: sol.producto_id ?? '', producto_nombre: sol.producto_nombre, cantidad: Number(sol.cantidad) || 0, precio_unit: sol.precio_unit, unidad: null, almacen: sol.almacen_origen }];
  const totalGeneral = lineas.reduce((a, it) => a + (Number(it.precio_unit) || 0) * (Number(it.cantidad) || 0), 0);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  // ── Encabezado: logo + título + N° ──
  const LOGO = 60;
  const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text(esTraslado ? 'ORDEN DE TRASLADO' : 'ORDEN DE SALIDA', TX, y + 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`N° ${sol.num_usuario != null ? String(sol.num_usuario).padStart(3, '0') : sol.codigo}${sol.actor_name ? ` · ${sol.actor_name}` : ''}  ·  ${esTraslado ? 'Traslado de material' : 'Salida de material'}  ·  ${sol.codigo}`, TX, y + 38);
  doc.text(`Emitida: ${fmt.dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 38, { align: 'right' });
  y += Math.max(LOGO, 42) + 8;

  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 18;
  doc.setLineWidth(0.5); doc.setDrawColor(180);

  // ── Emisor (izq.) + Datos de la orden (der.), estilo factura ──
  const colDatosX = MARGIN + (PAGE_W - MARGIN * 2) * 0.52;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Mineral Group Guayana C.A.', MARGIN, y);
  doc.text('Sistema de Gestión de Inventarios', MARGIN, y + 12);

  // Datos a la derecha (label en negrita + valor)
  const datos: Array<[string, string]> = [
    ['Solicitado por', sol.solicitante || creo || '—'],
    [esTraslado ? 'Almacén destino' : 'Dirigido a', (esTraslado ? sol.almacen_destino : sol.destino) || '—'],
    ...(sol.chofer ? [['Chofer / responsable', `${sol.chofer}${sol.chofer_cedula ? ` · C.I. ${sol.chofer_cedula}` : ''}`] as [string, string]] : []),
    ...(sol.vehiculo ? [['Vehículo', `${sol.vehiculo}${sol.vehiculo_placa ? ` · ${sol.vehiculo_placa}` : ''}`] as [string, string]] : []),
    ['Fecha de solicitud', fmt.dateTime(sol.created_at)],
    ...(sol.fecha_entrega ? [['Fecha de entrega', fmt.date(sol.fecha_entrega)] as [string, string]] : []),
    ...(sol.consumo_interno ? [['Consumo interno', 'Sí'] as [string, string]] : []),
    // Cerrada sin descontar (mov_ref manual_externo) no es lo mismo que Ejecutada: el papel debe decirlo.
    ['Estado', sol.estado === 'ejecutada' && sol.mov_ref === 'manual_externo'
      ? (sol.scope === 'traslado' ? 'Cerrada sin mover stock' : 'Cerrada sin descontar')
      : (SOL_ESTADO_TXT[sol.estado] ?? sol.estado)],
    ['Autorizado por', autorizoEmail ? AUTORIZA_SALIDAS.toUpperCase() : '— (pendiente de aprobación) —'],
  ];
  let dy = y;
  doc.setFontSize(9);
  // El valor se ENVUELVE dentro del margen derecho (antes valores largos como el
  // vehículo se salían de la hoja): se corta al ancho disponible y avanza por línea.
  const valX = colDatosX + 108;
  const valW = PAGE_W - MARGIN - valX;
  datos.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, colDatosX, dy);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(v, valW);
    doc.text(lines, valX, dy);
    dy += Math.max(13, lines.length * 11);
  });
  y = Math.max(y + 38, dy) + 6;

  // ── Tabla de ítems (factura) ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('DETALLE', MARGIN, y);
  y += 6;
  const head = [['#', 'Producto', esTraslado ? 'Sale de' : 'Almacén', 'Cant.', 'Precio USD', 'Total USD']];
  const body = lineas.map((it, i) => {
    const c = Number(it.cantidad) || 0;
    const p = Number(it.precio_unit) || 0;
    const u = it.unidad ? ` ${it.unidad}` : '';
    const obs = (it as { observacion?: string | null }).observacion;
    return [
      String(i + 1),
      obs ? `${it.producto_nombre || '—'}\nObs: ${obs}` : (it.producto_nombre || '—'),
      it.almacen || sol.almacen_origen || '—',
      `${fmt.num(c)}${u}`,
      p ? fmt.money(p) : '—',
      p ? fmt.money(p * c) : '—',
    ];
  });
  autoTable(doc, {
    startY: y, head, body, theme: 'striped',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', fontSize: 9.5 },
    styles: { fontSize: 9.5, cellPadding: 4 },
    columnStyles: {
      0: { cellWidth: 24, halign: 'right' },
      2: { cellWidth: 110 },
      3: { halign: 'right', cellWidth: 64 },
      4: { halign: 'right', cellWidth: 74 },
      5: { halign: 'right', cellWidth: 80 },
    },
    foot: [['', '', '', '', 'TOTAL', `${fmt.money(totalGeneral)} USD`]],
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold', halign: 'right', fontSize: 10 },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 18;

  // ── Observaciones / Notas ──
  const obs: string[] = [];
  if (sol.direccion_despacho) obs.push(`Origen (despacho): ${sol.direccion_despacho}`);
  if (sol.direccion_destino) obs.push(`Destino (dirección): ${sol.direccion_destino}`);
  if (sol.motivo) obs.push(`Motivo: ${sol.motivo}`);
  if (sol.nota_entrega) obs.push(`Nota de entrega: ${sol.nota_entrega}`);
  if (sol.consumo_interno) obs.push('Consumo interno: el material se queda dentro de la empresa.');
  if (obs.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('OBSERVACIONES / NOTAS', MARGIN, y);
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const wrapped = doc.splitTextToSize(obs.join('\n'), PAGE_W - MARGIN * 2);
    doc.text(wrapped, MARGIN, y);
    y += wrapped.length * 12;
  }

  // ── Firmas al pie ──
  // Se ubican al pie de la página, pero si la tabla es larga y el contenido
  // llega hasta abajo, se bajan debajo del contenido o saltan a una nueva página
  // (evita que la firma/el bloque se solape con los ítems).
  const needTop = 52;  // espacio sobre la línea (firma)
  const needBot = 34;  // espacio bajo la línea (etiquetas + nombre)
  let fy = PAGE_H - MARGIN - needBot;          // posición preferida (pie de página)
  if (y + needTop > fy) {                       // el contenido invade la zona de firmas
    if (y + needTop + needBot <= PAGE_H - MARGIN) {
      fy = y + needTop;                          // cabe justo debajo del contenido
    } else {
      doc.addPage();                             // no cabe: nueva página
      fy = MARGIN + needTop;
    }
  }
  const colW = (PAGE_W - MARGIN * 2 - 40) / 2;
  const cxAutoriza = MARGIN + colW + 40 + colW / 2;
  // Firma de Leydis Rengel (Salidas/Traslados) sobre la línea de "Autorizado por",
  // en tamaño mediano. Solo cuando la orden ya está autorizada/ejecutada.
  if (firmaSalidas && autorizoEmail) {
    try {
      const sw = 150, sh = 52;  // mediano (proporción de firma2)
      doc.addImage(firmaSalidas, 'JPEG', cxAutoriza - sw / 2, fy - sh + 8, sw, sh);
    } catch { /* firma opcional */ }
  }
  doc.setDrawColor(120); doc.setLineWidth(0.7);
  doc.line(MARGIN, fy, MARGIN + colW, fy);
  doc.line(MARGIN + colW + 40, fy, MARGIN + colW * 2 + 40, fy);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Solicitado / Creado por', MARGIN + colW / 2, fy + 14, { align: 'center' });
  doc.text('Autorizado por', cxAutoriza, fy + 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text(creo || '—', MARGIN + colW / 2, fy + 27, { align: 'center' });
  doc.text(autorizoEmail ? AUTORIZA_SALIDAS : '— (pendiente) —', cxAutoriza, fy + 27, { align: 'center' });

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(`Documento auto-generado · ${sol.codigo} · ${fmt.dateTime(new Date().toISOString())}`, MARGIN, PAGE_H - 24);

  previewPdfDoc(doc, `orden-${esTraslado ? 'traslado' : 'salida'}-${sol.codigo}.pdf`);
}
