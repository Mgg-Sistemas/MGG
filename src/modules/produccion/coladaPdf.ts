/* ============================================================
   MGG · Reporte de Colada — PDF formal MGG-FR-001
   Horno de fundición primaria. Replica el formato en papel (barras
   naranja por sección, ficha de dos columnas, firmas). Solo por botón.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { ColadaBigBag, Produccion, ProduccionColada } from '@/shared/lib/types';
import { getProduccionConMateriales } from './produccion.repository';
import { getColada, fmtJornada } from './colada.repository';

const ORANGE: [number, number, number] = [214, 90, 24];
const GREY: [number, number, number] = [90, 90, 90];

function kg(n: number | null | undefined): string {
  return n == null || n === '' as unknown as number ? '—' : `${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })} kg`;
}
function txt(s: string | null | undefined): string { return (s ?? '').toString().trim() || '—'; }
function tempC(n: number | null | undefined): string { return n == null ? '—' : `${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 })} °C`; }
/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (sin sustos de zona horaria). */
function fmtFecha(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : txt(iso);
}

async function construir(prod: Produccion, colada: ProduccionColada | null) {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const d = colada?.datos ?? {};
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  const CW = W - MARGIN * 2;
  let y = MARGIN;

  // ── Encabezado ──
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  doc.setTextColor(...ORANGE); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('REPORTE DE COLADA', W / 2, y + 16, { align: 'center' });
  doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text('HORNO DE FUNDICIÓN PRIMARIA', W / 2, y + 30, { align: 'center' });
  // Caja de código (arriba-derecha)
  doc.setFontSize(7.5); doc.setTextColor(0, 0, 0);
  const codBox = [
    ['CÓDIGO', 'MGG-FR-001'], ['VERSIÓN', '01'],
    ['EMISIÓN', '21-05-2026'], ['COLADA N°', colada ? String(colada.colada_num) : '—'],
  ];
  autoTable(doc, {
    startY: y, margin: { left: W - MARGIN - 150, right: MARGIN },
    body: codBox, theme: 'grid', tableWidth: 150,
    styles: { fontSize: 7, cellPadding: 1.6 },
    columnStyles: { 0: { fillColor: ORANGE, textColor: 255, fontStyle: 'bold', cellWidth: 62 }, 1: { cellWidth: 88 } },
  });
  y += 56;

  // Helper: barra de sección naranja.
  const barra = (texto: string) => {
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = MARGIN; }
    doc.setFillColor(...ORANGE); doc.rect(MARGIN, y, CW, 17, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(texto, MARGIN + 8, y + 12);
    doc.setTextColor(0, 0, 0);
    y += 17 + 4;
  };
  // Helper: ficha de dos pares por fila [k1,v1,k2,v2].
  const ficha = (rows: Array<[string, string, string?, string?]>) => {
    autoTable(doc, {
      startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: CW,
      body: rows.map((r) => [r[0], r[1], r[2] ?? '', r[3] ?? '']),
      theme: 'plain', styles: { fontSize: 8.5, cellPadding: 2.5, valign: 'middle' },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: CW * 0.22 }, 1: { cellWidth: CW * 0.28 },
        2: { fontStyle: 'bold', cellWidth: CW * 0.22 }, 3: { cellWidth: CW * 0.28 },
      },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  };

  // ── IDENTIFICACIÓN ──
  barra('IDENTIFICACIÓN');
  ficha([
    ['Colada N°', colada ? String(colada.colada_num) : '—', 'Fecha', colada ? fmtFecha(colada.fecha) : '—'],
    ['Jornada laboral', d.jornada_horas != null ? fmtJornada(d.jornada_horas) : txt(d.turno), 'Responsable de colada', txt(d.responsable)],
  ]);

  // ── MATERIAS PRIMAS ──
  barra('MATERIAS PRIMAS');
  const bags = (d.big_bags ?? []) as ColadaBigBag[];
  const bagRows: Array<[string, string, string?, string?]> = bags.map((b, i) => [
    `Big Bag ${i + 1} (kg)`, kg(b.kg), `N° Precinto ${i + 1}`, txt(b.precinto),
  ]);
  ficha([
    ...bagRows,
    ['Total Casiterita (kg)', kg(d.total_casiterita), 'Ley de Sn / Tenor (%)', d.ley_sn == null ? '—' : `${d.ley_sn} %  (${kg(d.sn_kg)} Sn)`],
    ['Coque (kg)', kg(d.coque_kg), 'Proveedor de coque', txt(d.coque_proveedor)],
    ['Granulometría coque', txt(d.coque_granulometria), 'Otro fundente', `${txt(d.otro_fundente)}${d.otro_fundente_kg != null ? ` · ${kg(d.otro_fundente_kg)}` : ''}`],
    ['CaCO₃ ' + (d.caco3_tipo ? `(${d.caco3_tipo})` : ''), kg(d.caco3_kg), 'Granulometría CaCO₃ (malla)', txt(d.caco3_granulometria)],
  ]);

  // ── PROCESO ──
  barra('PROCESO');
  ficha([
    ['Modo de homogeneización', txt(d.homogeneizacion), 'Modo de carga al horno', txt(d.carga_horno)],
  ]);

  // ── TEMPERATURAS Y TIEMPOS — CARGA ──
  barra('TEMPERATURAS Y TIEMPOS — CARGA');
  ficha([
    ['Temp. int. al abrir', tempC(d.temp_int_abrir), 'Temp. ext. al abrir', tempC(d.temp_ext_abrir)],
    ['Inicio de carga', d.fecha_inicio_carga ? `${fmtFecha(d.fecha_inicio_carga)} ${d.hora_inicio_carga ?? ''}`.trim() : txt(d.hora_inicio_carga),
      'Fin de carga', d.fecha_fin_carga ? `${fmtFecha(d.fecha_fin_carga)} ${d.hora_fin_carga ?? ''}`.trim() : txt(d.hora_fin_carga)],
    ['Temp. int. al cerrar', tempC(d.temp_int_cerrar), 'Temp. ext. al cerrar', tempC(d.temp_ext_cerrar)],
  ]);

  // ── CONTROL DE TEMPERATURA (cada ~1 h) ──
  barra('CONTROL DE TEMPERATURA DEL PROCESO (CADA ~1 H)');
  const temps = d.temperaturas ?? [];
  autoTable(doc, {
    startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: CW,
    head: [['N°', 'Hora', 'Temp. interna', 'Temp. externa', 'Observación / acción']],
    body: temps.length
      ? temps.map((t, i) => [String(i + 1), txt(t.hora), tempC(t.temp_int), tempC(t.temp_ext), txt(t.obs)])
      : [['—', '', '', '', '']],
    theme: 'grid',
    headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 26, halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });
  // @ts-expect-error lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 10;

  // ── SANGRADO Y TIEMPOS DE COLADA ──
  barra('SANGRADO Y TIEMPOS DE COLADA');
  ficha([
    ['Hora inicio del proceso', txt(d.hora_inicio_proceso), 'Hora fin del proceso', txt(d.hora_fin_proceso)],
    ['Hora de sangrado', txt(d.hora_sangrado), 'Temp. de colada', tempC(d.temp_colada)],
    ['Duración total de la colada (h)', d.duracion_horas == null ? '—' : `${d.duracion_horas} h`, '', ''],
  ]);

  // ── RESULTADOS ──
  barra('RESULTADOS');
  ficha([
    ['Estaño obtenido (kg)', kg(d.estano_kg), 'N° de lingotes', d.n_lingotes == null ? '—' : String(d.n_lingotes)],
    ['Escoria generada (kg)', kg(d.escoria_kg), 'Rendimiento (%)', d.rendimiento == null ? '—' : `${d.rendimiento} %`],
    ['Destino / almacén', txt(d.destino_almacen || prod.almacen_destino), '', ''],
  ]);

  // ── OBSERVACIONES ──
  barra('OBSERVACIONES');
  ficha([
    ['Merma (kg)', kg(d.merma_kg), '', ''],
    ['Observaciones', txt(d.observaciones), '', ''],
  ]);

  // ── INVOLUCRADOS ──
  const inv = (d.involucrados ?? []).filter(Boolean);
  if (inv.length) {
    barra('INVOLUCRADOS');
    const pares: Array<[string, string, string?, string?]> = [];
    for (let i = 0; i < inv.length; i += 2) pares.push([`${i + 1}.`, inv[i], `${i + 2}.`, inv[i + 1] ?? '']);
    ficha(pares);
  }

  // ── Firmas ──
  if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = MARGIN; }
  y += 6;
  autoTable(doc, {
    startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: CW,
    head: [['ELABORADO POR', 'REVISADO POR', 'APROBADO POR']],
    body: [['\n\n\n', '\n\n\n', '\n\n\n']],
    theme: 'grid',
    headStyles: { fillColor: [70, 70, 70], textColor: 255, fontSize: 8, halign: 'center' },
    styles: { fontSize: 8, cellPadding: 3, minCellHeight: 46, halign: 'center' },
  });

  return { doc, filename: `colada-${colada?.colada_num ?? 's-n'}-${prod.id.slice(0, 8)}.pdf` };
}

/** Genera y muestra (vista previa) el reporte de colada MGG-FR-001 de una orden. */
export async function descargarColadaPdf(produccionId: string): Promise<void> {
  const [prod, colada] = await Promise.all([getProduccionConMateriales(produccionId), getColada(produccionId)]);
  if (!prod) throw new Error('Fundición no encontrada');
  const { doc, filename } = await construir(prod, colada);
  previewPdfDoc(doc, filename);
}
