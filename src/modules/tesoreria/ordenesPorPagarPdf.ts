/* ============================================================
   MGG · Tesorería · Resumen PDF de pendientes por pagar
   Segmentado: Compras directas · OC · Servicios · Servicios directos.
   Cada segmento con su TOTAL; total GENERAL en grande, con conversión
   a Bs a la tasa BCV del día. Solo por botón (vista previa).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';
import type { DirectoFila } from '@/modules/pedidos/DirectosPorPagarModal';
import { getTasaHoy, aBs, aExtranjero } from './tasas.repository';

function usd(n: number | null | undefined): string {
  return `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function bs(n: number | null | undefined): string {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const esBsMoneda = (m: string | null | undefined): boolean => /bs|ves/i.test(String(m ?? ''));

/** Una fila normalizada del reporte (sirve para OC, servicios y directos). */
interface FilaRep { codigo: string; nombre: string; detalle: string; estado: string; montoUsd: number }

export async function descargarResumenPorPagarPdf(rows: OrdenPorPagar[], directos: DirectoFila[] = []): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const tasaHoy = await getTasaHoy().catch(() => null);
  const tasa = Number(tasaHoy?.usd) || 0;
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm
  const CW = W - MARGIN * 2; // ancho útil imprimible (tabla y caja lo comparten)
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('PENDIENTES POR PAGAR', W / 2 + 28, y + 20, { align: 'center' });
  doc.setTextColor(120, 120, 120); doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(tasa > 0 ? `Tasa BCV del día: Bs ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/$${tasaHoy?.fecha ? ` · ${tasaHoy.fecha}` : ''}` : 'Sin tasa BCV disponible', W / 2 + 28, y + 36, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 58;

  const finalidadDe = (r: OrdenPorPagar): string => {
    const o = r.orden;
    const cab = (o.finalidad ?? '').trim();
    if (cab) return cab;
    const porItem = Array.from(new Set((o.items ?? []).map((it) => (it.finalidad ?? '').trim()).filter(Boolean)));
    return porItem.length ? porItem.join(' · ') : '—';
  };
  const notasDe = (r: OrdenPorPagar): string => (r.orden.notas ?? r.orden.motivo ?? '').trim() || '—';

  // ── Segmentos ──
  const ocRows = rows.filter((r) => r.orden.clase !== 'servicio');
  const servRows = rows.filter((r) => r.orden.clase === 'servicio');
  const comprasDir = directos.filter((d) => d.kind === 'compra');
  const servDir = directos.filter((d) => d.kind === 'servicio');

  const deOrden = (r: OrdenPorPagar): FilaRep => ({
    codigo: r.orden.oc_codigo ?? r.orden.codigo, nombre: r.proveedorNombre,
    detalle: [finalidadDe(r), notasDe(r)].filter((x) => x && x !== '—').join(' · ') || '—',
    estado: r.esperandoMetodo ? 'Esperando método' : 'Lista para pagar',
    montoUsd: Number(r.montoAPagar) || 0,
  });
  const deDirecto = (d: DirectoFila): FilaRep => ({
    codigo: d.codigo, nombre: d.titulo, detalle: d.detalle || '—',
    estado: 'Lista para pagar',
    // Los directos pueden estar en Bs: se convierten a $ a la tasa del día para el reporte.
    montoUsd: esBsMoneda(d.moneda) ? aExtranjero(Number(d.total) || 0, tasa) : (Number(d.total) || 0),
  });

  const segmentosDef: Array<{ titulo: string; color: [number, number, number]; filas: FilaRep[] }> = [
    { titulo: 'COMPRAS DIRECTAS', color: [37, 99, 235], filas: comprasDir.map(deDirecto) },
    { titulo: 'ÓRDENES DE COMPRA', color: [255, 138, 0], filas: ocRows.map(deOrden) },
    { titulo: 'SERVICIOS', color: [124, 92, 255], filas: servRows.map(deOrden) },
    { titulo: 'SERVICIOS DIRECTOS', color: [16, 138, 120], filas: servDir.map(deDirecto) },
  ];
  const segmentos = segmentosDef.filter((s) => s.filas.length > 0);

  const montoCol = (u: number): string[] => [usd(u), tasa > 0 ? bs(aBs(u, tasa)) : '—'];

  // Anchos fijos que suman EXACTO el ancho útil → tabla de margen a margen, simétrica.
  const wNum = 26, wCod = 74, wUsd = 88, wBs = 106;
  const wProv = Math.round((CW - (wNum + wCod + wUsd + wBs)) * 0.42);
  const wDet = CW - (wNum + wCod + wUsd + wBs) - wProv;

  for (const seg of segmentos) {
    const subtotal = seg.filas.reduce((a, f) => a + f.montoUsd, 0);
    autoTable(doc, {
      startY: y,
      head: [[{ content: seg.titulo, colSpan: 6, styles: { fillColor: seg.color, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left', fontSize: 10 } }],
             ['#', 'CÓDIGO', 'PROVEEDOR / CONCEPTO', 'DETALLE', 'MONTO $', 'MONTO Bs']],
      body: seg.filas.map((f, i) => [String(i + 1), f.codigo, f.nombre, f.detalle, ...montoCol(f.montoUsd)]),
      foot: [[{ content: `TOTAL ${seg.titulo}`, colSpan: 4, styles: { halign: 'right' } }, usd(subtotal), tasa > 0 ? bs(aBs(subtotal, tasa)) : '—']],
      styles: { fontSize: 8, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [225, 225, 225], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: seg.color, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right', fontSize: 9 },
      tableWidth: CW,
      columnStyles: {
        0: { halign: 'center', cellWidth: wNum },
        1: { halign: 'center', cellWidth: wCod },
        2: { cellWidth: wProv },
        3: { cellWidth: wDet },
        4: { halign: 'right', cellWidth: wUsd },
        5: { halign: 'right', cellWidth: wBs },
      },
      margin: { top: MARGIN, bottom: MARGIN + 70, left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error jspdf-autotable agrega lastAutoTable en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 16;
  }

  // ── TOTAL GENERAL (en grande) ──
  const totalUsd = segmentos.reduce((a, s) => a + s.filas.reduce((b, f) => b + f.montoUsd, 0), 0);
  const totalBs = tasa > 0 ? aBs(totalUsd, tasa) : 0;
  const H = doc.internal.pageSize.getHeight();
  if (y > H - 96) { doc.addPage(); y = MARGIN; }
  const boxW = CW;
  doc.setFillColor(255, 138, 0);
  doc.rect(MARGIN, y, boxW, 66, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
  doc.setFontSize(13); doc.text('TOTAL GENERAL', MARGIN + 16, y + 27);
  doc.setFontSize(24); doc.text(usd(totalUsd), MARGIN + boxW - 16, y + 28, { align: 'right' });
  doc.setFontSize(16); doc.text(tasa > 0 ? bs(totalBs) : 'Sin tasa BCV', MARGIN + boxW - 16, y + 54, { align: 'right' });
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(tasa > 0 ? `Convertido a la tasa BCV del día (Bs ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 })}/$)` : '', MARGIN + 16, y + 52);
  doc.setTextColor(0, 0, 0);
  y += 66;

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  const nTotal = rows.length + directos.length;
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${nTotal} pendiente(s) · Mineral Group Guayana C.A.`, MARGIN, H - 16);

  previewPdfDoc(doc, 'pendientes-por-pagar.pdf');
}
