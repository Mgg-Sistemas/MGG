/* ============================================================
   MGG · Servicio Directo · Comprobante PDF
   Se abre en VISTA PREVIA SOLO al hacer clic (regla del sistema).
   Muestra TODOS los servicios con cantidad y precio.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { cargarPersonasPorEmail, personaDe } from '@/shared/lib/personas';
import type { ServicioDirecto } from './serviciosDirectos.repository';

export async function descargarServicioDirectoPdf(servicio: ServicioDirecto): Promise<void> {
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
  doc.text('Comprobante de Servicio Directo', tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`MGG · ${fmt.dateTime(new Date().toISOString())}`, tx, y + 33);
  y += 60;

  const items = servicio.items ?? [];
  // Moneda del servicio ($ o Bs): los montos del PDF se muestran en esta moneda.
  const moneda = servicio.moneda === 'Bs' ? 'Bs' : 'USD';
  const mc = (n: number) => {
    const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
  };
  const totalGasto = servicio.gasto != null ? Number(servicio.gasto) : items.reduce((a, it) => a + (Number(it.gasto) || 0), 0);
  const equipos = Array.from(new Set(items.map((it) => it.equipo_nombre).filter(Boolean) as string[])).join(' · ')
    || servicio.equipo_nombre || '—';

  const ficha: Array<[string, string]> = [
    ...(servicio.codigo ? [['Código', servicio.codigo] as [string, string]] : []),
    ['Equipo / vehículo', equipos],
    ['Proveedor / taller', servicio.proveedor_nombre || '—'],
    ...(servicio.solicitante ? [['Unidad solicitante', servicio.solicitante] as [string, string]] : []),
    ...(servicio.solicitante_persona ? [['Quién lo solicita', servicio.solicitante_persona] as [string, string]] : []),
    ['Estado', servicio.estado === 'finalizada' ? 'Finalizada (pagada)' : 'En proceso'],
    ['Gasto total', totalGasto > 0 ? mc(totalGasto) : '—'],
    ...(servicio.pago_externo ? [['Pago a externo', 'Sí — reintegrar a la persona externa'] as [string, string]] : []),
    ['Generó', personaDe(servicio.actor, personas, servicio.actor_name)],
    ['Fecha de creación', fmt.dateTime(servicio.created_at)],
    ['Fecha de pago', servicio.finalizada_at ? fmt.dateTime(servicio.finalizada_at) : '—'],
    ['Factura', servicio.adjunto_nombre || '—'],
  ];
  autoTable(doc, {
    startY: y, body: ficha, theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160 } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // Detalle de servicios: categoría, subcategoría, cantidad, costo unitario y precio.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Servicios realizados', MARGIN, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [['Categoría', 'Subcategoría', 'Detalle', 'Cantidad', 'Costo unit.', 'Precio']],
    body: items.map((it) => {
      const cant = Number(it.cantidad) || 0;
      const g = it.gasto != null ? Number(it.gasto) : null;
      const cu = g != null && cant > 0 ? g / cant : null;
      return [
        it.servicio_categoria || '—',
        it.servicio_tipo || '—',
        it.descripcion || '—',
        fmt.num(cant),
        cu != null ? mc(cu) : '—',
        g != null ? mc(g) : '—',
      ];
    }),
    foot: [['', '', '', '', 'TOTAL', totalGasto > 0 ? mc(totalGasto) : '—']],
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  const pageW = doc.internal.pageSize.getWidth();
  let blockY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Bloque de texto con título (reintegro / nota). Avanza el cursor `blockY`.
  const bloqueTexto = (titulo: string, texto: string) => {
    blockY += 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(titulo, MARGIN, blockY);
    blockY += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const lineas = doc.splitTextToSize(texto, pageW - MARGIN * 2) as string[];
    doc.text(lineas, MARGIN, blockY);
    blockY += lineas.length * 12;
  };

  // Pago a externo (si aplica): lo pagó una persona externa y MGG debe reintegrarle.
  if (servicio.pago_externo) {
    bloqueTexto('Pago a externo — reintegrar el dinero',
      servicio.pago_externo_datos?.trim() || 'Lo pagó una persona externa; Tesorería le reintegra al pagar.');
  }

  // Nota / motivo del servicio (si la cargó el analista).
  if (servicio.nota?.trim()) bloqueTexto('Nota / motivo', servicio.nota.trim());

  previewPdfDoc(doc, `servicio-directo-${(servicio.codigo ?? servicio.id.slice(0, 8))}.pdf`);
}
