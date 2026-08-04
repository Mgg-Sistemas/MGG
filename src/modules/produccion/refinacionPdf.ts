/* ============================================================
   MGG · Reporte de Refinación de Lingotes de Estaño — PDF formal MGG-FR-002.
   Replica el formato en papel (barras naranja por sección, ficha de dos
   columnas, tabla de etapas, firmas). Solo por botón (vista previa).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { Produccion, ProduccionRefinacion } from '@/shared/lib/types';
import { getProduccionConMateriales } from './produccion.repository';
import { getRefinacion } from './refinacion.repository';

const ORANGE: [number, number, number] = [214, 90, 24];
const GREY: [number, number, number] = [90, 90, 90];

function kg(n: number | null | undefined): string {
  return n == null ? '—' : `${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })} kg`;
}
function txt(s: string | null | undefined): string { return (s ?? '').toString().trim() || '—'; }
function tempC(n: number | null | undefined): string { return n == null ? '—' : `${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 })} °C`; }
function pct(n: number | null | undefined): string { return n == null ? '—' : `${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })} %`; }
/** Número (hasta 2 decimales, es-VE) sin unidad; '—' si viene null. */
function n2(n: number | null | undefined): string { return n == null ? '—' : `${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })}`; }
/** Porcentaje de `part` sobre `total` (0–100 %); '—' si el total no es positivo. */
function pctOf(part: number, total: number): string { return total > 0 ? `${(part / total * 100).toLocaleString('es-VE', { maximumFractionDigits: 2 })} %` : '—'; }
function fmtFecha(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : txt(iso);
}

async function construir(prod: Produccion, ref: ProduccionRefinacion | null) {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const d = ref?.datos ?? {};
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  const CW = W - MARGIN * 2;
  let y = MARGIN;

  // ── Encabezado ──
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  doc.setTextColor(...ORANGE); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('REPORTE DE REFINACIÓN', W / 2, y + 16, { align: 'center' });
  doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text('DE LINGOTES DE ESTAÑO', W / 2, y + 30, { align: 'center' });
  doc.setFontSize(7.5); doc.setTextColor(0, 0, 0);
  const codBox = [
    ['CÓDIGO', 'MGG-FR-002'], ['VERSIÓN', '01'],
    ['EMISIÓN', '17-07-2026'], ['LOTE N°', ref ? String(ref.refinacion_num) : '—'],
  ];
  autoTable(doc, {
    startY: y, margin: { left: W - MARGIN - 150, right: MARGIN },
    body: codBox, theme: 'grid', tableWidth: 150,
    styles: { fontSize: 7, cellPadding: 1.6 },
    columnStyles: { 0: { fillColor: ORANGE, textColor: 255, fontStyle: 'bold', cellWidth: 62 }, 1: { cellWidth: 88 } },
  });
  y += 56;

  const barra = (texto: string) => {
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = MARGIN; }
    doc.setFillColor(...ORANGE); doc.rect(MARGIN, y, CW, 17, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(texto, MARGIN + 8, y + 12);
    doc.setTextColor(0, 0, 0);
    y += 17 + 4;
  };
  const ficha = (rows: Array<[string, string, string?, string?]>) => {
    autoTable(doc, {
      startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: CW,
      body: rows.map((r) => [r[0], r[1], r[2] ?? '', r[3] ?? '']),
      theme: 'plain', styles: { fontSize: 8.5, cellPadding: 2.5, valign: 'middle' },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: CW * 0.24 }, 1: { cellWidth: CW * 0.26 },
        2: { fontStyle: 'bold', cellWidth: CW * 0.24 }, 3: { cellWidth: CW * 0.26 },
      },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  };

  // ── IDENTIFICACIÓN DEL LOTE / PROCESO ──
  barra('IDENTIFICACIÓN DEL LOTE / PROCESO');
  const coladas = d.coladas ?? [];
  const origen = coladas.length ? coladas.map((c) => c.etiqueta ?? `#${c.colada_num || 's/n'}`).join(', ') : '—';
  ficha([
    ['Lote de Refinación N°', ref ? String(ref.refinacion_num) : '—', 'Fecha de proceso', ref ? fmtFecha(ref.fecha) : '—'],
    ['Turno', txt(d.turno), 'N° Horno / Olla', txt(d.n_horno_olla)],
    ['Responsable', txt(d.responsable), 'Origen del material', origen],
  ]);

  // ── ENTRADA DE MATERIAS PRIMAS Y REACTIVOS ──
  barra('ENTRADA DE MATERIAS PRIMAS Y REACTIVOS DE REFINACIÓN');
  ficha([
    ['Estaño crudo cargado', kg(d.estano_crudo_kg), 'Pureza inicial estimada', pct(d.pureza_inicial)],
  ]);
  // Reactivos = materiales consumidos que NO son estaño crudo.
  const reactivos = (prod.materiales ?? []).filter((m) => !/estaño (crudo|a refinar)/i.test(m.material_nombre));
  // Composición de la mezcla al 100 %: estaño crudo + reactivos.
  const crudoKg = d.estano_crudo_kg != null
    ? Number(d.estano_crudo_kg)
    : coladas.reduce((s, c) => s + (Number(c.estano_kg) || 0), 0);
  const almacenesCrudo = Array.from(new Set(coladas.map((c) => c.almacen).filter(Boolean))).join(', ') || '—';
  const totalMezcla = crudoKg + reactivos.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
  const compBody: Array<[string, string, string, string]> = [
    ['Estaño crudo cargado', almacenesCrudo, n2(crudoKg), pctOf(crudoKg, totalMezcla)],
    ...reactivos.map((m) => [
      m.material_nombre, txt(m.almacen), n2(Number(m.cantidad)), pctOf(Number(m.cantidad) || 0, totalMezcla),
    ] as [string, string, string, string]),
  ];
  autoTable(doc, {
    startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: CW,
    head: [['Material / reactivo', 'Almacén', 'Cantidad (kg)', '% de la mezcla']],
    body: compBody,
    foot: [['TOTAL', '', n2(totalMezcla), '100,00 %']],
    theme: 'grid',
    headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 8 },
    footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 3 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
  });
  // @ts-expect-error lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 10;

  // ── PARÁMETROS DE OPERACIÓN ──
  barra('PARÁMETROS DE OPERACIÓN Y PROCESO');
  ficha([
    ['Método de agitación', txt(d.metodo_agitacion), 'Sistema de desespumado', txt(d.desespumado)],
  ]);

  // ── CONTROL DE TEMPERATURA Y ETAPAS ──
  barra('CONTROL DE TEMPERATURA Y ETAPAS');
  const etapas = d.etapas ?? [];
  autoTable(doc, {
    startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: CW,
    head: [['N°', 'Hora', 'T. baño', 'T. quemador', 'Acción operativa / reactivo']],
    body: etapas.length
      ? etapas.map((et, i) => [String(i + 1), txt(et.hora), tempC(et.temp_bano), tempC(et.temp_quemador), txt(et.accion || et.etapa)])
      : [['—', '', '', '', '']],
    theme: 'grid',
    headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 26, halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });
  // @ts-expect-error lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 10;

  // ── TIEMPOS DE COLADA Y MOLDEO ──
  barra('TIEMPOS DE COLADA Y MOLDEO DE LINGOTES');
  ficha([
    ['Hora inicio de refinación', txt(d.hora_inicio_refinacion), 'Hora fin de refinación', txt(d.hora_fin_refinacion)],
    ['Hora inicio de vaciado', txt(d.hora_inicio_vaciado), 'Temp. de colada', tempC(d.temp_colada)],
    ['Tiempo total de proceso (h)', d.tiempo_total_horas == null ? '—' : `${d.tiempo_total_horas} h`, '', ''],
  ]);

  // ── RESULTADOS Y BALANCE DE MASA ──
  barra('RESULTADOS DE PRODUCCIÓN Y BALANCE DE MASA');
  ficha([
    ['Estaño refinado obtenido', kg(d.estano_refinado_kg), 'N° de lingotes producidos', d.n_lingotes == null ? '—' : String(d.n_lingotes)],
    ['Peso promedio por lingote', kg(d.peso_prom_lingote), 'N° de precinto / lote final', txt(d.n_precinto)],
    ['Dross / escoria de refinación', kg(d.dross_kg), 'Rendimiento del proceso', pct(d.rendimiento)],
    ['Pureza final estimada', pct(d.pureza_final), 'Merma', kg(d.merma_kg)],
    ['Destino / almacén de custodia', txt(d.destino_almacen || prod.almacen_destino), '', ''],
  ]);

  // ── OBSERVACIONES ──
  barra('OBSERVACIONES / INCIDENCIAS');
  ficha([['Observaciones', txt(d.observaciones), '', '']]);

  // ── PERSONAL INVOLUCRADO ──
  const inv = (d.involucrados ?? []).filter(Boolean);
  if (inv.length) {
    barra('PERSONAL INVOLUCRADO EN LA OPERACIÓN');
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

  return { doc, filename: `refinacion-${ref?.refinacion_num ?? 's-n'}-${prod.id.slice(0, 8)}.pdf` };
}

/** Genera y muestra (vista previa) el reporte de refinación MGG-FR-002 de una orden. */
export async function descargarRefinacionPdf(produccionId: string): Promise<void> {
  const [prod, ref] = await Promise.all([getProduccionConMateriales(produccionId), getRefinacion(produccionId)]);
  if (!prod) throw new Error('Refinación no encontrada');
  const { doc, filename } = await construir(prod, ref);
  previewPdfDoc(doc, filename);
}
