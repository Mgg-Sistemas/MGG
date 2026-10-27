/* ============================================================
   MGG · Cocina · PDF del Control de distribución (EOQ)
   Resumen de todos los víveres + el registro diario de los que se movieron.
   Solo en vista previa, por botón: nunca se descarga solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { filaPdf, textoPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { etiquetaEstado, tieneDescuadre, totalesDistribucion, type ParametrosEoq, type ResumenDistribucion } from './distribucionEoq';

function num(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}
function fmtDia(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
/** El emoji del semáforo no existe en las fuentes del PDF: va en texto. */
function estadoTexto(e: ResumenDistribucion['estado']): string {
  return etiquetaEstado(e).replace(/^\S+\s/, '');
}
/** «12 (−2)»: lo que dice el libro y, si no cuadra con el inventario, la diferencia (inventario − libro). */
export function libroTexto(i: Pick<ResumenDistribucion, 'libro' | 'diferencia'>): string {
  if (!tieneDescuadre(i)) return num(i.libro);
  const d = i.diferencia as number;
  return `${num(i.libro)} (${d > 0 ? '+' : '−'}${num(Math.abs(d))})`;
}

export interface CabeceraDistribucion {
  cocina: string;
  mercado: number;
  desde: string;
  /** Día del cierre. `null` mientras el mercado está abierto: se cierra a mano, no hay fecha prevista. */
  hasta: string | null;
  /** De dónde sale el «stock», ya con preposición («de La Esperanza», «del almacén al cierre»). `null` si no se pudo leer el inventario. */
  fuente: string | null;
  params: ParametrosEoq;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function verDistribucionPdf(items: ResumenDistribucion[], cab: CabeceraDistribucion): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = MARGEN_PDF; // 2 cm
  const ANCHO = anchoUtilPdf(W);
  const LIMITE = limiteInferiorPdf(doc.internal.pageSize.getHeight());
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(textoPdf('CONTROL DE DISTRIBUCIÓN · MODELO EOQ'), W / 2, y + 18, { align: 'center' });
  doc.setTextColor(40, 40, 40); doc.setFontSize(11);
  doc.text(textoPdf(`Comedor industrial · Cocina: ${cab.cocina}`), W / 2, y + 34, { align: 'center' });
  doc.setTextColor(90, 90, 90); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  // «al» en vez de la flecha «→»: la helvetica de jsPDF no la tiene (salía «!'» y abría el renglón letra por letra).
  // Un mercado abierto no tiene fecha de fin: se cierra a mano cuando la administradora decide.
  doc.text(
    textoPdf(cab.hasta
      ? `Mercado #${cab.mercado} · del ${fmtDia(cab.desde)} al ${fmtDia(cab.hasta)}`
      : `Mercado #${cab.mercado} · desde el ${fmtDia(cab.desde)} · en curso`),
    W / 2, y + 48, { align: 'center' },
  );
  doc.setTextColor(0, 0, 0);
  y += 62;

  const t = totalesDistribucion(items);
  doc.setFontSize(9.5); doc.setFont('helvetica', 'bold');
  // Se parte al ancho útil para que no pase del margen derecho.
  const resumen = doc.splitTextToSize(
    textoPdf(`Víveres: ${t.viveres}   ·   Por reponer: ${t.reordenar}   ·   En alerta: ${t.alerta}   ·   Descuadrados: ${t.descuadrados}   ·   Consumido: ${num(t.consumoTotal)}   ·   Mermas: ${num(t.mermas)}`),
    ANCHO,
  ) as string[];
  doc.text(resumen, MARGIN, y);
  y += (resumen.length - 1) * 12;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 90); doc.setFontSize(8.5);
  const parametros = doc.splitTextToSize(
    textoPdf(`Parámetros de compra: ordenar $ ${num(cab.params.costoOrden)} · almacenar $ ${num(cab.params.costoAlmacenar)} por unidad/año · entrega ${num(cab.params.leadTimeDias)} días`),
    ANCHO,
  ) as string[];
  doc.text(parametros, MARGIN, y + 12);
  y += 12 + (parametros.length - 1) * 10;
  // De dónde sale cada número: sin esto, «stock 10» y «libro 12» parecen un error.
  const fuente = doc.splitTextToSize(
    textoPdf(cab.fuente
      ? `Stock = inventario real ${cab.fuente}. Libro = lo que el mercado dice que queda; entre paréntesis la diferencia (inventario − libro).`
      : 'Stock = lo que el mercado dice que queda (no se pudo leer el inventario del almacén).'),
    ANCHO,
  ) as string[];
  doc.text(fuente, MARGIN, y + 10);
  doc.setTextColor(0, 0, 0);
  y += 20 + (fuente.length - 1) * 10;

  const orden = [...items].sort((a, b) => {
    const peso = (e: ResumenDistribucion['estado']) => (e === 'REORDENAR' ? 0 : e === 'ALERTA' ? 1 : 2);
    return peso(a.estado) - peso(b.estado) || b.consumoTotal - a.consumoTotal || a.nombre.localeCompare(b.nombre, 'es');
  });

  autoTable(doc, {
    startY: y + 6,
    head: [filaPdf(['VÍVER', 'UNIDAD', 'STOCK', 'LIBRO', 'CONSUMO', 'PROM./DÍA', 'RATIO x COM.', 'D ANUAL', 'LOTE EOQ', 'REORDEN', 'CICLO', 'ESTADO'])],
    body: orden.length
      ? orden.map((i) => filaPdf([
        `${i.nombre} (${i.sku})`, i.unidad, num(i.stock), libroTexto(i), num(i.consumoTotal), num(i.promedioDia),
        i.ratioPromedio ? i.ratioPromedio.toFixed(3) : '—',
        num(i.demandaAnual), i.eoq ? num(i.eoq) : '—', i.puntoReorden ? num(i.puntoReorden) : '—',
        i.cicloDias ? `${i.cicloDias} d` : '—', estadoTexto(i.estado),
      ]))
      : [filaPdf(['Sin víveres en el mercado', '', '', '', '', '', '', '', '', '', '', ''])],
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 150 }, 2: { halign: 'right', fontStyle: 'bold' }, 3: { halign: 'right' }, 4: { halign: 'right' },
      5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right', fontStyle: 'bold' },
      9: { halign: 'right' }, 10: { halign: 'right' },
    },
    margin: MARGENES_TABLA_PDF,
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  // Registro diario de cada víver que se movió: la hoja de la planilla, una por víver.
  for (const i of orden.filter((x) => x.filas.length)) {
    if (y > LIMITE - 80) { doc.addPage(); y = MARGIN; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(textoPdf(`Registro diario · ${i.nombre} (${i.unidad})`), MARGIN, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(
      textoPdf(`Stock ${num(i.stock)} · libro ${libroTexto(i)} · consumo ${num(i.consumoTotal)} (${num(i.promedioDia)}/día) · comensales ${num(i.comensales)} · ${estadoTexto(i.estado)}`),
      MARGIN, y + 11,
    );
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: y + 18,
      head: [filaPdf(['FECHA', 'TURNO', 'INV. INICIAL', 'ENTRADAS', 'SALIDAS', 'TEÓRICO', 'MERMA', 'FÍSICO', 'COMENSALES', 'RATIO', 'ESTADO'])],
      body: i.filas.map((f) => filaPdf([
        fmtDia(f.fecha), f.turno, num(f.invInicial), num(f.entradas), num(f.salidas), num(f.teorico),
        f.mermas ? num(f.mermas) : '—', num(f.fisico), num(f.comensales), f.ratio ? f.ratio.toFixed(3) : '—', estadoTexto(f.estado),
      ])),
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [235, 235, 235], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: {
        2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
        6: { halign: 'right' }, 7: { halign: 'right', fontStyle: 'bold' }, 8: { halign: 'right' }, 9: { halign: 'right' },
      },
      margin: MARGENES_TABLA_PDF,
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // La nota va en el último renglón dentro del margen; si la última tabla llegó hasta ahí, pasa de página.
  if (y > LIMITE - 9) doc.addPage();
  doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
  doc.text(
    textoPdf('Lote EOQ = raíz de (2 × demanda anual × costo de ordenar ÷ costo de almacenar). Reorden = consumo de los días de entrega. El estado se mide con el stock del almacén, no con el libro.'),
    MARGIN, LIMITE, { maxWidth: ANCHO },
  );

  await previewPdfDoc(doc, `distribucion-${cab.cocina}-mercado-${cab.mercado}.pdf`);
}
