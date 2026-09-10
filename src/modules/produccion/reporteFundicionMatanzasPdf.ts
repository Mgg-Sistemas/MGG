/* ============================================================
   MGG · REPORTE FORMAL DE PRODUCCIÓN · Fundición Matanzas (PDF)

   El reporte que firma la Gerencia de Producción: qué se cargó, qué
   salió, cuánto rindió cada colada y cada ciclo de escoria, y qué
   queda por recuperar. Se arma con las coladas que el usuario eligió
   y el tenor que declaró.

   Se abre en VISTA PREVIA: nada se descarga solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import {
  filaColada, agruparPorCiclo, totalesPeriodo, periodoDe, hallazgos,
  type ColadaReporte,
} from './reporteFundicionMatanzas';

const ORANGE: [number, number, number] = [255, 138, 0];
const GREY: [number, number, number] = [90, 90, 90];
const FOOT: [number, number, number] = [60, 60, 60];

/** Lo que el usuario declara en el diálogo y el sistema no guarda. */
export interface OpcionesReporte {
  /** Tenor de Sn aplicado a todas las coladas del reporte (%). */
  tenorPct: number;
  /** Cuántas coladas entran en cada ciclo de recuperación de escoria. */
  coladasPorCiclo: number;
  lugar: string;
  supervisor: string;
  equipo: string;
  fuente: string;
  nota: string;
}

const kg = (v: number | null | undefined): string =>
  v == null ? '—' : `${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null | undefined): string =>
  v == null ? '—' : `${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
const ent = (v: number | null | undefined): string => (v == null ? '—' : String(Math.round(Number(v))));
const fecha = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
};

export async function generarReporteFundicionMatanzas(
  coladas: ColadaReporte[],
  op: OpcionesReporte,
): Promise<void> {
  if (!coladas.length) throw new Error('Elegí al menos una colada para el reporte.');

  const [{ jsPDF }, { default: autoTable }, { dateTime }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);

  const filas = coladas.map((c) => filaColada(c, op.tenorPct));
  const grupos = agruparPorCiclo(filas, op.coladasPorCiclo);
  const tot = totalesPeriodo(filas);
  const per = periodoDe(filas);
  const hs = hallazgos(filas, grupos, tot, op.tenorPct);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 42.52;
  const ANCHO = W - MARGIN * 2;
  let y = MARGIN;
  const T = (v: unknown): string => textoPdf(v);

  // ── Encabezado ──
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  doc.setTextColor(...ORANGE); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(T('MINERAL GROUP GUAYANA C.A.'), W / 2, y + 16, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text(T('RIF J-50221930-7'), W / 2, y + 30, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0, 0, 0);
  doc.text(T('REPORTE FORMAL DE PRODUCCIÓN'), W / 2, y + 47, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text(T('Fundición de Casiterita · Planta Matanzas'), W / 2, y + 60, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 74;

  function barra(texto: string): void {
    if (y > H - 90) { doc.addPage(); y = MARGIN; }
    doc.setFillColor(...ORANGE);
    doc.rect(MARGIN, y, ANCHO, 15, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    doc.text(T(texto), MARGIN + 5, y + 10.5);
    doc.setTextColor(0, 0, 0);
    y += 21;
  }

  function ficha(filasF: Array<[string, string, string?, string?]>): void {
    autoTable(doc, {
      startY: y,
      body: filasF.map((f) => f.map((c) => T(c ?? ''))),
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: ANCHO * 0.2 }, 1: { cellWidth: ANCHO * 0.3 },
        2: { fontStyle: 'bold', cellWidth: ANCHO * 0.2 },
      },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  }

  function parrafo(texto: string, negrita = false): void {
    const t = T(texto).trim();
    if (!t) return;
    doc.setFont('helvetica', negrita ? 'bold' : 'normal'); doc.setFontSize(8.5);
    const lineas = doc.splitTextToSize(t, ANCHO);
    if (y + lineas.length * 11 > H - MARGIN) { doc.addPage(); y = MARGIN; }
    doc.text(lineas, MARGIN, y + 8);
    y += lineas.length * 11 + 8;
  }

  // ── 1. Identificación ──
  barra('IDENTIFICACIÓN DEL REPORTE');
  ficha([
    ['Lugar de fundición', op.lugar || 'Matanzas', 'Supervisor de fundición', op.supervisor || '—'],
    ['Equipo utilizado', op.equipo || '—', 'Período reportado', per ? `${fecha(per.desde)} — ${fecha(per.hasta)}` : '—'],
    ['Coladas incluidas', `${filas.map((f) => `#${f.colada_num}`).join(', ')} (${filas.length})`, 'Fecha de emisión', dateTime(new Date().toISOString())],
    ['Tenor de Sn aplicado', pct(op.tenorPct), 'Ciclo de recuperación', `cada ${op.coladasPorCiclo} colada(s)`],
    ['Fuente de datos', op.fuente || 'Sistema MGG · reportes de colada MGG-FR-001', '', ''],
  ]);

  // ── 2. Nota metodológica ──
  barra('NOTA METODOLÓGICA');
  parrafo(`El rendimiento se mide contra el estaño TEÓRICO de la casiterita cargada, aplicando un tenor fijo de ${pct(op.tenorPct)} a todas las coladas del período. Un tenor más alto que la ley real de laboratorio produce rendimientos más conservadores. La recuperación de escoria se ejecuta cada ${op.coladasPorCiclo} colada(s), por lo que el rendimiento real del proceso se calcula agrupado por ciclo: una colada sin escoria propia parece peor de lo que fue, y la siguiente mejor.`);
  if (op.nota.trim()) parrafo(op.nota);

  // ── 3. Resumen individual por colada ──
  barra('RESUMEN INDIVIDUAL POR COLADA');
  autoTable(doc, {
    startY: y, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, tableWidth: ANCHO,
    head: [['Colada', 'Fecha', 'Turno', 'Casiterita (kg)', 'Tenor', 'Sn teórico (kg)', 'Coque (kg)', 'Caliza (kg)', 'Mezcla (kg)', 'Estaño (kg)', 'Ling.', 'Peso/ling.', 'Escoria (kg)', 'Merma (kg)', 'Rendim.', 'Temp.', 'Dur. (h)'].map(T)],
    body: filas.map((f) => [
      `#${f.colada_num}`, fecha(f.fecha), f.turno || '—',
      kg(f.casiterita_kg), pct(op.tenorPct), kg(f.sn_teorico_kg),
      kg(f.coque_kg), kg(f.caliza_kg), kg(f.mezcla_kg),
      kg(f.estano_kg), ent(f.n_lingotes), kg(f.peso_prom_lingote),
      kg(f.escoria_kg), kg(f.merma_kg), pct(f.rendimiento_pct),
      f.temp_colada == null ? '—' : `${f.temp_colada} °C`,
      f.duracion_horas == null ? '—' : kg(f.duracion_horas),
    ].map(T)),
    foot: [['TOTALES', '', '', kg(tot.casiterita_kg), '', kg(tot.sn_teorico_kg), kg(tot.coque_kg), kg(tot.caliza_kg), kg(tot.mezcla_kg), kg(tot.estano_kg), ent(tot.n_lingotes), '', kg(tot.escoria_kg), '', pct(tot.rendimiento_pct), '', kg(tot.duracion_prom_horas)].map(T)],
    theme: 'grid',
    headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 6.5, halign: 'center' },
    footStyles: { fillColor: FOOT, textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
    styles: { fontSize: 6.5, cellPadding: 2.5, halign: 'right' },
    columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' }, 2: { halign: 'center' }, 10: { halign: 'center' }, 15: { halign: 'center' } },
  });
  // @ts-expect-error lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  // ── 4. Rendimiento por ciclo de escoria ──
  barra('RENDIMIENTO AGRUPADO POR CICLO DE ESCORIA');
  autoTable(doc, {
    startY: y, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, tableWidth: ANCHO,
    head: [['Ciclo', 'Casiterita (kg)', 'Sn teórico (kg)', 'Estaño obtenido (kg)', 'Escoria (kg)', 'Sn recuperable XRF (kg)', 'Estaño potencial (kg)', 'Rendim. real', 'Rendim. potencial'].map(T)],
    body: grupos.map((g) => [
      g.etiqueta, kg(g.casiterita_kg), kg(g.sn_teorico_kg), kg(g.estano_kg),
      kg(g.escoria_kg), kg(g.sn_recuperable_kg), kg(g.estano_potencial_kg),
      pct(g.rendimiento_pct), pct(g.rendimiento_potencial_pct),
    ].map(T)),
    theme: 'grid',
    headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 7.5, halign: 'center' },
    styles: { fontSize: 7.5, cellPadding: 3, halign: 'right' },
    columnStyles: { 0: { halign: 'left', cellWidth: ANCHO * 0.22 } },
  });
  // @ts-expect-error lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  // ── 5. Totales del período ──
  barra('TOTALES DEL PERÍODO');
  ficha([
    ['Coladas evaluadas', String(tot.coladas), 'Casiterita utilizada', `${kg(tot.casiterita_kg)} kg`],
    ['Sn teórico total', `${kg(tot.sn_teorico_kg)} kg`, 'Estaño en bruto obtenido', `${kg(tot.estano_kg)} kg`],
    ['Escoria generada', `${kg(tot.escoria_kg)} kg`, 'Sn recuperable de escoria (XRF)', `${kg(tot.sn_recuperable_kg)} kg`],
    ['Merma de estaño', `${kg(tot.merma_kg)} kg`, 'Lingotes producidos', ent(tot.n_lingotes)],
    ['Rendimiento del período', pct(tot.rendimiento_pct), 'Rendimiento potencial', pct(tot.rendimiento_potencial_pct)],
    ['Duración promedio del ciclo', tot.duracion_prom_horas == null ? '—' : `${kg(tot.duracion_prom_horas)} h`, '', ''],
  ]);
  parrafo(`La merma del período se mide en ESTAÑO: Sn teórico − (estaño obtenido + Sn recuperable de la escoria) = ${kg(tot.sn_teorico_kg)} − (${kg(tot.estano_kg)} + ${kg(tot.sn_recuperable_kg)}) = ${kg(tot.merma_kg)} kg. Se resta solo el contenido de estaño de la escoria, no su masa total, que incluye hierro, tántalo y niobio.`);

  // ── 6. Análisis de escorias ──
  const conEscoria = filas.filter((f) => f.escoria_kg > 0);
  if (conEscoria.length) {
    barra('ANÁLISIS DE ESCORIAS · RECUPERACIÓN ADICIONAL (XRF)');
    autoTable(doc, {
      startY: y, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, tableWidth: ANCHO,
      head: [['Colada', 'Muestra N°', 'Masa de escoria (kg)', 'Sn (%) XRF', 'Sn recuperable (kg)'].map(T)],
      body: conEscoria.map((f) => [
        `#${f.colada_num}`, f.muestra_escoria || '—', kg(f.escoria_kg),
        f.sn_escoria_pct == null ? 'sin ensayo' : pct(f.sn_escoria_pct),
        kg(f.sn_recuperable_kg),
      ].map(T)),
      foot: [['TOTAL', '', kg(tot.escoria_kg), '', kg(tot.sn_recuperable_kg)].map(T)],
      theme: 'grid',
      headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 7.5, halign: 'center' },
      footStyles: { fillColor: FOOT, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      styles: { fontSize: 7.5, cellPadding: 3, halign: 'right' },
      columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } },
    });
    // @ts-expect-error lastAutoTable
    y = (doc.lastAutoTable?.finalY ?? y) + 14;
  }

  // ── 7. Observaciones y hallazgos ──
  barra('OBSERVACIONES Y HALLAZGOS');
  hs.forEach((h) => parrafo(`•  ${h}`));
  const obs = filas.filter((f) => f.observaciones.trim());
  obs.forEach((f) => parrafo(`•  Colada #${f.colada_num}: ${f.observaciones}`));
  if (!hs.length && !obs.length) parrafo('Sin observaciones registradas en el período.');

  // ── Firma ──
  if (y > H - 110) { doc.addPage(); y = MARGIN; }
  y += 24;
  doc.setDrawColor(...GREY);
  doc.line(MARGIN, y, MARGIN + 200, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
  doc.text(T(op.supervisor || '—'), MARGIN, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
  doc.text(T('Supervisor de Fundición'), MARGIN, y + 26);
  doc.text(T('Mineral Group Guayana C.A. · Gerencia de Producción'), MARGIN, y + 38);

  const p = per ? `${per.desde}_${per.hasta}` : new Date().toISOString().slice(0, 10);
  previewPdfDoc(doc, `reporte-fundicion-matanzas-${p}.pdf`);
}
