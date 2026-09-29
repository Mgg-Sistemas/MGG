/* ============================================================
   MGG · Control de Alimentación (Cocina) · Reporte PDF
   Resumen de consumo + detalle de comidas. Solo por botón (vista previa).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { CocinaComida } from '@/shared/lib/types';
import { labelTipoComida, resumirComidas } from './cocina.repository';
import { totalesDeViveres, kardexDetallado, ETIQUETA_CLASE, type FilaViver } from './movimientoViveres';

function money(n: number | null | undefined): string {
  return `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function num(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}

export async function descargarReporteCocinaPdf(
  comidas: CocinaComida[],
  rangoLabel: string,
  /** Movimiento de víveres del período. Sin esto el PDF sale como antes. */
  movViveres: FilaViver[] = [],
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('CONTROL DE ALIMENTACIÓN (COCINA)', W / 2 + 28, y + 20, { align: 'center' });
  doc.setTextColor(90, 90, 90); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(rangoLabel, W / 2 + 28, y + 36, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 56;

  const r = resumirComidas(comidas);
  // Tarjetas-resumen (texto)
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text(
    `Platos: ${num(r.platos)}   ·   Consumo total: ${money(r.valor)}   ·   Promedio por plato: ${money(r.promedioPorPlato)}`,
    MARGIN, y,
  );
  y += 14;

  // Top víveres consumidos
  if (r.topViveres.length) {
    autoTable(doc, {
      startY: y + 6,
      head: [['VÍVERES MÁS CONSUMIDOS', 'CANTIDAD', 'VALOR $']],
      body: r.topViveres.slice(0, 15).map((v) => [`${v.nombre} (${v.sku})`, num(v.cantidad), money(v.valor)]),
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 360 }, 1: { halign: 'right', cellWidth: 160 }, 2: { halign: 'right', cellWidth: 120 } },
      margin: { left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = doc.lastAutoTable.finalY + 14;
  }

  /* Movimiento de víveres: lo que había, lo que se comió, lo que salió por
     Inventario y lo que queda. Es la tabla que se firma: el resto del reporte
     dice cuánto se gastó, esta dice de dónde salió y qué sobró. */
  if (movViveres.length) {
    const t = totalesDeViveres(movViveres);
    autoTable(doc, {
      startY: y,
      head: [['VÍVER', 'UNIDAD', 'HABÍA', 'ENTRÓ', 'TRASLADOS', 'COMIDO', 'SALIDAS / AJUSTES', 'QUEDA']],
      body: movViveres.map((f) => [
        `${f.nombre} (${f.sku})`, f.unidad || '—',
        num(f.habia), f.entradas ? num(f.entradas) : '—', f.traslados ? num(f.traslados) : '—',
        f.consumido ? num(f.consumido) : '—', f.salidas ? num(f.salidas) : '—', num(f.queda),
      ]),
      foot: [['TOTAL', '', num(t.habia), num(t.entradas), num(t.traslados), num(t.consumido), num(t.salidas), num(t.queda)]],
      styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 200 }, 1: { cellWidth: 62 },
        2: { halign: 'right', cellWidth: 62 }, 3: { halign: 'right', cellWidth: 62 },
        4: { halign: 'right', cellWidth: 66 }, 5: { halign: 'right', cellWidth: 66 },
        6: { halign: 'right', cellWidth: 92 }, 7: { halign: 'right', cellWidth: 62 },
      },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      didDrawPage: () => { /* la tabla puede pasar de página: autoTable repite el encabezado */ },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
    doc.text(
      'Había + Entró ± Traslados − Comido − Salidas/ajustes = Queda. «Había» se reconstruye desde el stock actual hacia atrás. Los totales mezclan unidades: sirven para cuadrar, no como cantidad.',
      MARGIN, y,
    );
    doc.setTextColor(0, 0, 0);
    y += 16;

    /* EL DETALLE: cada movimiento de cada víver, agrupado por víver y en orden
       cronológico dentro de cada uno, que es como se lee un kardex —se sigue el
       saldo hacia adelante—. La tabla de arriba dice CUÁNTO; esta dice cuándo,
       de qué tipo, por qué y quién. Incluye las salidas y ajustes de Inventario,
       que son los que hay que poder explicar. */
    const detalle = kardexDetallado(movViveres);
    if (detalle.length) {
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 138, 0);
      doc.text('DETALLE · MOVIMIENTO POR MOVIMIENTO', MARGIN, y + 10);
      doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');
      y += 16;
      autoTable(doc, {
        startY: y,
        head: [['VÍVER', 'FECHA', 'QUÉ FUE', 'TIPO', 'CANTIDAD', 'MOTIVO', 'QUIÉN']],
        body: detalle.map((r) => [
          `${r.nombre} (${r.sku})`, fmt.dateTime(r.at), ETIQUETA_CLASE[r.clase], r.tipo,
          `${r.delta > 0 ? '+' : ''}${num(r.delta)} ${r.unidad}`.trim(),
          r.motivo ?? '—', r.actor ?? '—',
        ]),
        styles: { fontSize: 7, cellPadding: 2.5, overflow: 'linebreak' },
        headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
        // La fila se pinta según lo que sea: la comida es lo normal, la
        // salida/ajuste es lo que hay que mirar.
        didParseCell: (d) => {
          if (d.section !== 'body') return;
          const r = detalle[d.row.index];
          if (r?.clase === 'salida') d.cell.styles.fillColor = [255, 244, 230];
        },
        columnStyles: {
          0: { cellWidth: 150 }, 1: { cellWidth: 86 }, 2: { cellWidth: 68 }, 3: { cellWidth: 56 },
          4: { halign: 'right', cellWidth: 82 }, 5: { cellWidth: 160 }, 6: { cellWidth: 72 },
        },
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      });
      // @ts-expect-error lastAutoTable lo agrega el plugin
      y = doc.lastAutoTable.finalY + 14;
    }
  }

  // Detalle de comidas
  autoTable(doc, {
    startY: y,
    head: [['N°', 'FECHA · HORA', 'COMIDA', 'PLATOS', 'VÍVERES', 'VALOR $', 'PROM./PLATO']],
    body: comidas.map((c) => [
      c.codigo,
      fmt.dateTime(c.at),
      labelTipoComida(c.tipo_comida),
      num(c.platos),
      (c.items ?? []).map((it) => `${it.nombre} ×${num(it.cantidad)}`).join(', '),
      money(c.valor_total),
      money(Number(c.platos) > 0 ? c.valor_total / Number(c.platos) : 0),
    ]),
    foot: [['', '', '', num(r.platos), '', money(r.valor), money(r.promedioPorPlato)]],
    styles: { fontSize: 7.5, cellPadding: 3, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 70 }, 1: { cellWidth: 110 }, 2: { cellWidth: 70 },
      3: { halign: 'right', cellWidth: 50 }, 4: { cellWidth: 240 },
      5: { halign: 'right', cellWidth: 90 }, 6: { halign: 'right', cellWidth: 77 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${comidas.length} comida(s) · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, 'cocina-consumo.pdf');
}
