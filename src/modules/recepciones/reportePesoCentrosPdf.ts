/* ============================================================
   MGG · Recepciones · REPORTE PRELIMINAR DE PESO ENVIADO POR
   CENTROS DE ACOPIO (OPERACIONES) — vista previa antes de imprimir.
   Replica la 1ª hoja del Excel operativo: un bloque por centro
   (ITEM · PESO · CENTRO/procedencia · IDENTIFICACIÓN/EMBALAJE),
   un RESUMEN con el total por centro + gran total, y las firmas.
   Se muestra SIN LOGO (reporte interno de operaciones).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { loadFirmaGerenteDataUrl, loadFirmaSalidasDataUrl } from '@/shared/lib/pdfLogo';
import type { ResumenCentro, RecepcionFila } from './recepciones.repository';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const N = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** 2 decimales es-VE (miles con punto, decimales con coma). */
const n2 = (v: number | null | undefined) =>
  v == null ? '' : round2(Number(v)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ReportePesoData {
  /** Fecha del reporte (ISO). Por defecto, la de hoy. */
  fecha?: string;
  /** Nº de recepción / etiqueta (por defecto "GENERAL"). */
  referencia?: string;
  /** Totales por centro (para el RESUMEN). */
  centros: ResumenCentro[];
  /** Recepciones individuales (para los bloques por centro). */
  recepciones: RecepcionFila[];
}

const BRAND: [number, number, number] = [255, 138, 0];   // naranja del sistema
const GRIS: [number, number, number] = [240, 240, 240];

export async function descargarReportePesoCentrosPdf(data: ReportePesoData): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, firmaGerente, firmaAdm] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadFirmaGerenteDataUrl().catch(() => null),   // Jesús Lozada (Gerente General) · firma.png
    loadFirmaSalidasDataUrl().catch(() => null),    // Leydis Rengel (Gerente Administrativo) · firma2.jpeg
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const MARGIN = 42.52;                 // 1,5 cm
  const pageW = doc.internal.pageSize.getWidth();
  const fecha = data.fecha ? new Date(data.fecha) : new Date();
  const fechaVE = fecha.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // ── Encabezado (SIN LOGO) ──
  let y = MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('REPORTE PRELIMINAR DE PESO ENVIADO POR', pageW / 2, y + 6, { align: 'center' });
  doc.text('CENTROS DE ACOPIO (OPERACIONES)', pageW / 2, y + 22, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text(`FECHA: ${fechaVE}`, MARGIN, y + 42);
  doc.text(`RECEPCIÓN: ${data.referencia ?? 'GENERAL'}`, pageW - MARGIN, y + 42, { align: 'right' });
  y += 56;

  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ── Un bloque por centro (con recepciones), en el orden de `centros` ──
  const porCentro = new Map<string, RecepcionFila[]>();
  for (const r of data.recepciones) {
    const k = r.centro || '—';
    if (!porCentro.has(k)) porCentro.set(k, []);
    porCentro.get(k)!.push(r);
  }
  // Orden: primero los centros del RESUMEN (en su orden), luego cualquier extra.
  const ordenCentros = [
    ...data.centros.map((c) => c.nombre).filter((n) => porCentro.has(n)),
    ...[...porCentro.keys()].filter((k) => !data.centros.some((c) => c.nombre === k)),
  ];

  for (const centro of ordenCentros) {
    const filas = (porCentro.get(centro) ?? []).slice().sort((a, b) => a.item - b.item);
    if (!filas.length) continue;
    const totalCentro = round2(filas.reduce((a, r) => a + N(r.peso_kg), 0));
    autoTable(doc, {
      startY: y,
      head: [['ITEM', 'PESO (Kg)', centro.toUpperCase(), 'IDENTIFICACIÓN · TIPO DE EMBALAJE']],
      body: filas.map((r) => [String(r.item || ''), n2(r.peso_kg), r.procedencia || '—', r.nota || '']),
      foot: [['TOTAL', n2(totalCentro), '', '']],
      theme: 'grid',
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      footStyles: { fillColor: GRIS, textColor: 20, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 3, overflow: 'linebreak', valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 34, halign: 'center' },
        1: { cellWidth: 70, halign: 'right' },
        2: { cellWidth: 190 },
        3: { cellWidth: 'auto' },
      },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    y = finalY() + 10;
  }

  // ── RESUMEN (total por centro + gran total) ──
  const granTotal = round2(data.centros.reduce((a, c) => a + N(c.totalKg), 0));
  autoTable(doc, {
    startY: y + 4,
    head: [['RESUMEN · PESO (Kg)', 'CENTRO DE ACOPIO']],
    body: data.centros.map((c) => [n2(c.totalKg), c.nombre]),
    foot: [[n2(granTotal), 'TOTAL DE KG DE CASITERITA A RECIBIR']],
    theme: 'grid',
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 9, fontStyle: 'bold' },
    footStyles: { fillColor: [20, 20, 20], textColor: 255, fontStyle: 'bold', fontSize: 10 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 0: { cellWidth: 130, halign: 'right' }, 1: { cellWidth: 'auto' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = finalY() + 28;

  // ── FIRMA DE RESPONSABLES (2×2 líneas de firma con su rol) ──
  if (y > doc.internal.pageSize.getHeight() - 150) { doc.addPage(); y = MARGIN; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('FIRMA DE RESPONSABLES', pageW / 2, y, { align: 'center' });
  y += 34;
  const firmantes: Array<{ nombre: string; rol: string; firma: string | null }> = [
    { nombre: 'Mariana Tovar', rol: 'Analista administrativo', firma: null },
    { nombre: 'Manuel Palma', rol: 'Supervisor de Operaciones', firma: null },
    { nombre: 'Leydis Rengel', rol: 'Gerente Administrativo', firma: firmaAdm },
    { nombre: 'Jesús Lozada', rol: 'Gerente General', firma: firmaGerente },
  ];
  const colW = (pageW - MARGIN * 2) / 2;
  const lineW = colW - 40;
  for (let i = 0; i < firmantes.length; i += 2) {
    for (let j = 0; j < 2; j++) {
      const f = firmantes[i + j];
      const cx = MARGIN + colW * j + colW / 2;
      // Firma escaneada (si el firmante tiene una): se dibuja justo ENCIMA de la línea.
      if (f.firma) {
        try {
          const props = doc.getImageProperties(f.firma);
          const hImg = 32;
          let wImg = props.width && props.height ? (props.width / props.height) * hImg : 80;
          if (wImg > lineW) wImg = lineW;
          const hFinal = props.width && props.height ? (props.height / props.width) * wImg : hImg;
          doc.addImage(f.firma, props.fileType || 'PNG', cx - wImg / 2, y - hFinal - 2, wImg, hFinal);
        } catch { /* si la firma no carga, el PDF sale igual con la línea */ }
      }
      doc.setDrawColor(120); doc.setLineWidth(0.6);
      doc.line(cx - lineW / 2, y, cx + lineW / 2, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.text(f.nombre, cx, y + 14, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.text(f.rol, cx, y + 26, { align: 'center' });
    }
    y += 66;
  }

  previewPdfDoc(doc, `reporte-peso-centros-${fechaVE.replace(/\//g, '-')}.pdf`);
}
