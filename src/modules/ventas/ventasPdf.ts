/* ============================================================
   MGG · Ventas · PDF (siempre en vista previa, nunca descarga directa)
   · Documento de la venta: Factura o Nota de entrega.
   · Reporte de ventas del período (con impuestos, material y ganancia).
   · Ficha de trazabilidad de una venta (historial completo).
   ============================================================ */
import type { Venta } from './ventas.repository';
import { nombreDocumento, nombreCondicion, costoUnitMaterial } from './ventasLogica';

const MARGIN = 42.52;
const fmt = (v: number | null | undefined) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function base() {
  const [{ dateTime, date }, { loadLogoDataUrl }, { previewPdfDoc }, { jsPDF }, { default: autoTable }] = await Promise.all([
    import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'), import('@/shared/lib/reportPreview'),
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  return { dateTime, date, previewPdfDoc, jsPDF, autoTable, logo };
}

type Doc = import('jspdf').jsPDF;
const finalY = (doc: Doc) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

function encabezado(doc: Doc, logo: string | null, titulo: string, derecha: string[]): number {
  const PAGE_W = doc.internal.pageSize.getWidth();
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 58 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(0);
  doc.text('Mineral Group Guayana C.A.', tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(titulo, tx, y + 32);
  derecha.forEach((t, i) => {
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 13 : 9);
    doc.text(t, PAGE_W - MARGIN, y + 16 + (i === 0 ? 0 : 4 + i * 12), { align: 'right' });
  });
  y += 62;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  return y + 16;
}

function marcaAnulada(doc: Doc) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState();
  doc.setTextColor(220, 38, 38); doc.setFont('helvetica', 'bold'); doc.setFontSize(90);
  doc.text('ANULADA', W / 2, H / 2, { align: 'center', angle: 30 });
  doc.restoreGraphicsState();
  doc.setTextColor(0);
}

/* ───────────── Documento: Factura / Nota de entrega ───────────── */

export async function verDocumentoVentaPdf(v: Venta): Promise<void> {
  const { dateTime, date, previewPdfDoc, jsPDF, autoTable, logo } = await base();
  const m = v.moneda || 'USD';
  const tipo = nombreDocumento(v.tipo_documento);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const PAGE_W = doc.internal.pageSize.getWidth();

  let y = encabezado(doc, logo, tipo, [v.numero, `Fecha: ${date(v.fecha)}`, `Pago: ${nombreCondicion(v.condicion_pago)}`]);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Cliente:', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(v.cliente_nombre || 'Cliente ocasional', MARGIN + 46, y); y += 14;
  if (v.vendedor) { doc.text(`Vendedor: ${v.vendedor}`, MARGIN, y); y += 14; }
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Producto', 'Cant.', 'Tenor %', `Precio (${m})`, `Subtotal (${m})`]],
    body: (v.items ?? []).map((it) => [
      it.producto_nombre, `${fmt(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ''}`, it.tenor_pct ? `${fmt(it.tenor_pct)}%` : '—',
      fmt(it.precio_unit), fmt(it.subtotal),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [255, 138, 0], textColor: 20 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    styles: { fontSize: 9, cellPadding: 4 },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY(doc) + 12;

  // Totales: los impuestos solo aparecen si aplican (la nota de entrega no lleva).
  const filas: [string, string][] = [['Subtotal', `${m} ${fmt(v.subtotal)}`]];
  if (Number(v.descuento) > 0) filas.push(['Descuento', `- ${m} ${fmt(v.descuento)}`]);
  if (Number(v.iva_monto) > 0) filas.push([`IVA (${fmt(v.iva_pct)}%)`, `${m} ${fmt(v.iva_monto)}`]);
  if (Number(v.igtf_monto) > 0) filas.push([`IGTF (${fmt(v.igtf_pct)}%)`, `${m} ${fmt(v.igtf_monto)}`]);
  filas.push(['TOTAL', `${m} ${fmt(v.total)}`]);
  const iTotal = filas.length - 1;
  autoTable(doc, {
    startY: y, body: filas, theme: 'plain', tableWidth: 240,
    margin: { left: PAGE_W - MARGIN - 240, right: MARGIN },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    didParseCell: (d) => { if (d.row.index === iTotal) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 12; } },
  });
  y = finalY(doc) + 16;

  // Pago en material (intercambio).
  const mat = v.pago_material ?? [];
  if (v.condicion_pago === 'intercambio' && mat.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Pago recibido en material', MARGIN, y); y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Material', 'Cantidad', 'Almacén', `Valor (${m})`, `Valor/u (${m})`]],
      body: mat.map((p) => [p.producto_nombre, `${fmt(p.cantidad)}${p.unidad ? ` ${p.unidad}` : ''}`, p.almacen, fmt(p.valor), fmt(costoUnitMaterial(p))]),
      theme: 'grid', headStyles: { fillColor: [60, 60, 60], textColor: 255 },
      columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      styles: { fontSize: 9, cellPadding: 3 }, margin: { left: MARGIN, right: MARGIN },
    });
    y = finalY(doc) + 8;
    const dif = Math.max(0, Number(v.total) - (Number(v.valor_material) || 0));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Material recibido: ${m} ${fmt(v.valor_material)} · Diferencia en dinero: ${m} ${fmt(dif)}`, MARGIN, y); y += 16;
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
  if (v.nota) { doc.text(doc.splitTextToSize(`Nota: ${v.nota}`, PAGE_W - 2 * MARGIN), MARGIN, y); y += 14; }
  if (v.estado === 'anulada') {
    doc.setTextColor(220, 38, 38);
    doc.text(`ANULADA el ${v.anulada_en ? dateTime(v.anulada_en) : '—'}${v.motivo_anulacion ? ` · Motivo: ${v.motivo_anulacion}` : ''}`, MARGIN, y); y += 12;
    doc.setTextColor(120);
  }
  doc.text(`Generado: ${dateTime(new Date().toISOString())}`, MARGIN, y);

  // Firmas de recibido (sobre todo para la nota de entrega).
  const H = doc.internal.pageSize.getHeight();
  const fy = Math.max(y + 60, H - 110);
  if (fy < H - 40) {
    doc.setDrawColor(150); doc.setLineWidth(0.5); doc.setTextColor(60); doc.setFontSize(9);
    doc.line(MARGIN, fy, MARGIN + 190, fy); doc.text('Entregado por', MARGIN, fy + 12);
    doc.line(PAGE_W - MARGIN - 190, fy, PAGE_W - MARGIN, fy); doc.text('Recibido conforme (cliente)', PAGE_W - MARGIN - 190, fy + 12);
  }
  if (v.estado === 'anulada') marcaAnulada(doc);

  previewPdfDoc(doc, `${v.numero}.pdf`);
}

/* ───────────── Reporte de ventas del período ───────────── */

export async function verReporteVentasPdf(input: { ventas: Venta[]; desde: string; hasta: string; filtro: string }): Promise<void> {
  const { dateTime, date, previewPdfDoc, jsPDF, autoTable, logo } = await base();
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  let y = encabezado(doc, logo, 'Reporte de ventas', [`${date(input.desde)} → ${date(input.hasta)}`, input.filtro, `Generado ${dateTime(new Date().toISOString())}`]);

  const vivas = input.ventas.filter((v) => v.estado !== 'anulada' && v.estado !== 'borrador');
  const sum = (f: (v: Venta) => number) => vivas.reduce((a, v) => a + (f(v) || 0), 0);
  autoTable(doc, {
    startY: y,
    head: [['N°', 'Fecha', 'Documento', 'Cliente', 'Pago', 'Estado', 'Base', 'IVA', 'IGTF', 'Total', 'Material', 'Costo', 'Ganancia']],
    body: input.ventas.map((v) => [
      v.numero, date(v.fecha), nombreDocumento(v.tipo_documento), v.cliente_nombre || '—', nombreCondicion(v.condicion_pago), v.estado,
      fmt(Number(v.subtotal) - Number(v.descuento)), fmt(v.iva_monto), fmt(v.igtf_monto), `${v.moneda} ${fmt(v.total)}`,
      Number(v.valor_material) > 0 ? fmt(v.valor_material) : '—', fmt(v.costo_total), fmt(v.ganancia),
    ]),
    foot: [['', '', '', '', '', 'Vigentes', fmt(sum((v) => Number(v.subtotal) - Number(v.descuento))), fmt(sum((v) => Number(v.iva_monto))),
      fmt(sum((v) => Number(v.igtf_monto))), fmt(sum((v) => Number(v.total))), fmt(sum((v) => Number(v.valor_material))),
      fmt(sum((v) => Number(v.costo_total))), fmt(sum((v) => Number(v.ganancia)))]],
    theme: 'striped',
    headStyles: { fillColor: [255, 138, 0], textColor: 20, fontSize: 8 },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 7.5, cellPadding: 3 },
    columnStyles: Object.fromEntries([6, 7, 8, 9, 10, 11, 12].map((i) => [i, { halign: 'right' }])),
    didParseCell: (d) => { if (d.section === 'body' && input.ventas[d.row.index]?.estado === 'anulada') d.cell.styles.textColor = [200, 40, 40]; },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY(doc) + 18;

  // Por producto (solo vigentes).
  const porProd = new Map<string, { cant: number; venta: number; ganancia: number }>();
  vivas.forEach((v) => (v.items ?? []).forEach((it) => {
    const k = it.producto_nombre || '—';
    const cur = porProd.get(k) ?? { cant: 0, venta: 0, ganancia: 0 };
    cur.cant += Number(it.cantidad) || 0; cur.venta += Number(it.subtotal) || 0; cur.ganancia += Number(it.ganancia) || 0;
    porProd.set(k, cur);
  }));
  if (porProd.size) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = MARGIN; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Por producto (vigentes)', MARGIN, y); y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Cantidad', 'Vendido', 'Ganancia']],
      body: [...porProd.entries()].sort((a, b) => b[1].venta - a[1].venta).map(([k, x]) => [k, fmt(x.cant), fmt(x.venta), fmt(x.ganancia)]),
      theme: 'grid', headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 3 }, tableWidth: 420,
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: MARGIN, right: MARGIN },
    });
  }
  previewPdfDoc(doc, `reporte-ventas-${input.desde}_${input.hasta}.pdf`);
}

/* ───────────── Ficha de trazabilidad ───────────── */

const ACCION: Record<string, string> = { creada: 'Creada', editada: 'Editada', emitida: 'Emitida', cobrada: 'Cobrada', anulada: 'Anulada' };

export async function verTrazabilidadVentaPdf(v: Venta): Promise<void> {
  const { dateTime, date, previewPdfDoc, jsPDF, autoTable, logo } = await base();
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  let y = encabezado(doc, logo, `Trazabilidad · ${nombreDocumento(v.tipo_documento)}`, [v.numero, `Fecha: ${date(v.fecha)}`, `Estado: ${v.estado}`]);

  autoTable(doc, {
    startY: y,
    body: [
      ['Cliente', v.cliente_nombre || 'Cliente ocasional', 'Forma de pago', nombreCondicion(v.condicion_pago)],
      ['Total', `${v.moneda} ${fmt(v.total)}`, 'Cobrado', `${v.moneda} ${fmt(v.pagado_monto)}`],
      ['Creada por', v.actor_name || v.created_by || '—', 'Emitida', v.emitida_en ? `${dateTime(v.emitida_en)} · ${v.emitida_por ?? ''}` : '—'],
      ...(v.estado === 'anulada' ? [['Anulada', v.anulada_en ? dateTime(v.anulada_en) : '—', 'Motivo', v.motivo_anulacion || '—']] : []),
    ],
    theme: 'plain', styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 2: { fontStyle: 'bold', cellWidth: 90 } },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY(doc) + 14;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Historial', MARGIN, y); y += 6;
  const hist = [...(v.historial ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  autoTable(doc, {
    startY: y,
    head: [['Fecha y hora', 'Acción', 'Usuario', 'Detalle / cambios', 'Motivo']],
    body: hist.length ? hist.map((e) => [
      dateTime(e.at), ACCION[e.accion] ?? e.accion, e.actor_name || e.actor,
      [e.detalle, ...(e.cambios ?? [])].filter(Boolean).join('\n') || '—', e.motivo || '—',
    ]) : [['—', 'Sin historial', '', '', '']],
    theme: 'grid', headStyles: { fillColor: [255, 138, 0], textColor: 20, fontSize: 8.5 },
    styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
    columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 55 }, 2: { cellWidth: 85 }, 4: { cellWidth: 110 } },
    margin: { left: MARGIN, right: MARGIN },
  });
  if (v.estado === 'anulada') marcaAnulada(doc);
  previewPdfDoc(doc, `trazabilidad-${v.numero}.pdf`);
}
