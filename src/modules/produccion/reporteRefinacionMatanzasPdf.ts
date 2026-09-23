/* ============================================================
   MGG · REPORTES FORMALES DE REFINACIÓN (PDF, vista previa)

   1) Reporte Refinación Matanza: igual al de fundición, con los datos
      de refinación (crudo → refinado, dross, reactivos, rendimiento,
      pureza, costo por kg).
   2) Colada + Refinación: la cadena del estaño de punta a punta,
      casiterita → estaño bruto → lingote refinado, con el rendimiento
      de cada etapa y el global.

   Nada se descarga solo: se abre en la vista previa.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import type { ColadaReporte } from './reporteFundicionMatanzas';
import {
  filaRefinacion, totalesRefinacion, reactivosDelPeriodo, hallazgosRefinacion,
  cadenas, totalesCadena, brutoSinRefinar, hallazgosCadena,
  type RefinacionReporte,
} from './reporteRefinacionMatanzas';

const ORANGE: [number, number, number] = [255, 138, 0];
const GREY: [number, number, number] = [90, 90, 90];
const FOOT: [number, number, number] = [60, 60, 60];
const MARGIN = 42.52;

export interface OpcionesReporteRefinacion {
  lugar: string;
  supervisor: string;
  equipo: string;
  nota: string;
}

export interface OpcionesReporteCadena extends OpcionesReporteRefinacion {
  tenorPct: number;
}

const kg = (v: number | null | undefined): string =>
  v == null ? '—' : Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number | null | undefined): string => (v == null ? '—' : `${kg(v)} %`);
/**
 * Cuenta de piezas. NO redondea: la última colada rara vez llena el molde, así
 * que medio lingote es un dato real y decir «10» donde hubo 9,5 falsea el parte.
 */
const ent = (v: number | null | undefined): string =>
  (v == null ? '—' : Number(v).toLocaleString('es-VE', { maximumFractionDigits: 2 }));
const fecha = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
};
const periodo = (fs: Array<{ fecha: string }>) => {
  const f = fs.map((x) => x.fecha).filter(Boolean).sort();
  return f.length ? { desde: f[0], hasta: f[f.length - 1] } : null;
};

/**
 * Documento con encabezado MGG y las ayudas de maquetado del reporte formal.
 *
 * La orientación se pide: no todos los reportes de este archivo tienen el mismo
 * ancho. El de la cadena va VERTICAL —se archiva y se firma como los demás
 * formatos de producción— y para eso su tabla ancha se partió en dos. El de
 * refinación sigue horizontal porque su resumen tiene 17 columnas: en vertical
 * quedarían de 30 puntos cada una y no se leerían.
 */
async function lienzo(subtitulo: string, orientacion: 'portrait' | 'landscape' = 'landscape') {
  const [{ jsPDF }, { default: autoTable }, { dateTime }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: orientacion });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const ANCHO = W - MARGIN * 2;
  const T = (v: unknown): string => textoPdf(v);
  const st = { y: MARGIN };

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, st.y, 46, 46); } catch { /* opcional */ } }
  doc.setTextColor(...ORANGE); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(T('MINERAL GROUP GUAYANA C.A.'), W / 2, st.y + 16, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text(T('RIF J-50221930-7'), W / 2, st.y + 30, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0, 0, 0);
  doc.text(T('REPORTE FORMAL DE PRODUCCIÓN'), W / 2, st.y + 47, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text(T(subtitulo), W / 2, st.y + 60, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  st.y += 74;

  const finY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? st.y;
  const margin = { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN };

  function barra(texto: string): void {
    if (st.y > H - 90) { doc.addPage(); st.y = MARGIN; }
    doc.setFillColor(...ORANGE);
    doc.rect(MARGIN, st.y, ANCHO, 15, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    doc.text(T(texto), MARGIN + 5, st.y + 10.5);
    doc.setTextColor(0, 0, 0);
    st.y += 21;
  }
  function ficha(filas: Array<[string, string, string?, string?]>): void {
    // En vertical la hoja es 265 puntos más angosta: con el reparto de la
    // horizontal, etiquetas como «Estaño bruto a refinación» se parten en dos
    // líneas. Se le da más a las etiquetas y menos al valor, que es corto.
    const rot = orientacion === 'portrait';
    const wEtiqueta = ANCHO * (rot ? 0.27 : 0.2);
    const wValor = ANCHO * (rot ? 0.23 : 0.3);
    autoTable(doc, {
      startY: st.y, body: filas.map((f) => f.map((c) => T(c ?? ''))), theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: wEtiqueta }, 1: { cellWidth: wValor }, 2: { fontStyle: 'bold', cellWidth: wEtiqueta } },
      margin,
    });
    st.y = finY() + 10;
  }
  function parrafo(texto: string): void {
    const t = T(texto).trim();
    if (!t) return;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const lineas = doc.splitTextToSize(t, ANCHO);
    if (st.y + lineas.length * 11 > H - MARGIN) { doc.addPage(); st.y = MARGIN; }
    doc.text(lineas, MARGIN, st.y + 8);
    st.y += lineas.length * 11 + 8;
  }
  function tabla(opts: { head: string[]; body: string[][]; foot?: string[]; fontSize?: number; columnStyles?: Record<number, object> }): void {
    const fs = opts.fontSize ?? 7;
    autoTable(doc, {
      startY: st.y, margin, tableWidth: ANCHO,
      head: [opts.head.map(T)], body: opts.body.map((r) => r.map(T)),
      foot: opts.foot ? [opts.foot.map(T)] : undefined,
      theme: 'grid',
      headStyles: { fillColor: ORANGE, textColor: 255, fontSize: fs, halign: 'center' },
      footStyles: { fillColor: FOOT, textColor: 255, fontStyle: 'bold', fontSize: fs },
      styles: { fontSize: fs, cellPadding: 2.5, halign: 'right' },
      columnStyles: opts.columnStyles ?? {},
    });
    st.y = finY() + 14;
  }
  function firma(nombre: string, cargo: string): void {
    if (st.y > H - 110) { doc.addPage(); st.y = MARGIN; }
    st.y += 24;
    doc.setDrawColor(...GREY);
    doc.line(MARGIN, st.y, MARGIN + 200, st.y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
    doc.text(T(nombre || '—'), MARGIN, st.y + 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
    doc.text(T(cargo), MARGIN, st.y + 26);
    doc.text(T('Mineral Group Guayana C.A. · Gerencia de Producción'), MARGIN, st.y + 38);
  }
  return { doc, st, barra, ficha, parrafo, tabla, firma, emision: dateTime(new Date().toISOString()) };
}

/* ───────────── 1) Reporte Refinación Matanza ───────────── */

export async function generarReporteRefinacionMatanzas(refinaciones: RefinacionReporte[], op: OpcionesReporteRefinacion): Promise<void> {
  if (!refinaciones.length) throw new Error('Elegí al menos una refinación para el reporte.');
  const filas = refinaciones.map(filaRefinacion);
  const tot = totalesRefinacion(filas);
  const per = periodo(filas);
  const reac = reactivosDelPeriodo(filas);
  const hs = hallazgosRefinacion(filas, tot);
  const { st, barra, ficha, parrafo, tabla, firma, emision, doc } = await lienzo('Refinación de Estaño · Planta Matanzas');

  barra('IDENTIFICACIÓN DEL REPORTE');
  ficha([
    ['Lugar de refinación', op.lugar || 'Matanzas', 'Supervisor de refinación', op.supervisor || '—'],
    ['Equipo utilizado', op.equipo || '—', 'Período reportado', per ? `${fecha(per.desde)} — ${fecha(per.hasta)}` : '—'],
    ['Refinaciones incluidas', `${filas.map((f) => `#${f.refinacion_num}`).join(', ')} (${filas.length})`, 'Fecha de emisión', emision],
    ['Fuente de datos', 'Sistema MGG · reportes de refinación MGG-FR-002', '', ''],
  ]);

  barra('NOTA METODOLÓGICA');
  parrafo('El rendimiento de refinación se mide contra el estaño CRUDO cargado al crisol (refinado ÷ crudo). La merma es la masa que no aparece ni como lingote ni como dross (crudo − refinado − dross). Los reactivos se informan aparte y en kg por tonelada de crudo, para comparar consumos entre lotes de distinto tamaño. El costo por kg reparte el costo total del proceso (material + mano de obra + indirectos) sobre el estaño refinado.');
  if (op.nota.trim()) parrafo(op.nota);

  barra('RESUMEN INDIVIDUAL POR REFINACIÓN');
  tabla({
    head: ['Refin.', 'Fecha', 'Turno', 'Origen del crudo', 'Crudo (kg)', 'Pureza ini.', 'Reactivos (kg)', 'Refinado (kg)', 'Ling.', 'Peso/ling.', 'Dross (kg)', 'Merma (kg)', 'Rendim.', 'Pureza fin.', 'Temp.', 'Dur. (h)', 'Costo/kg'],
    body: filas.map((f) => [
      `#${f.refinacion_num}`, fecha(f.fecha), f.turno || '—', f.origenes.map((o) => `${o.etiqueta} (${kg(o.estano_kg)})`).join(', ') || '—',
      kg(f.crudo_kg), pct(f.pureza_inicial), kg(f.reactivos_kg), kg(f.refinado_kg), ent(f.n_lingotes), kg(f.peso_prom_lingote),
      kg(f.dross_kg), kg(f.merma_kg), pct(f.rendimiento_pct), pct(f.pureza_final),
      f.temp_colada == null ? '—' : `${f.temp_colada} °C`, f.duracion_horas == null ? '—' : kg(f.duracion_horas), kg(f.costo_kg),
    ]),
    foot: ['TOTALES', '', '', '', kg(tot.crudo_kg), '', kg(tot.reactivos_kg), kg(tot.refinado_kg), ent(tot.n_lingotes), '', kg(tot.dross_kg), kg(tot.merma_kg), pct(tot.rendimiento_pct), pct(tot.pureza_final_prom), '', kg(tot.duracion_prom_horas), kg(tot.costo_kg)],
    fontSize: 6.3,
    columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'left', cellWidth: 110 }, 8: { halign: 'center' }, 14: { halign: 'center' } },
  });

  barra('BALANCE DE MASA DEL PERÍODO');
  ficha([
    ['Refinaciones evaluadas', String(tot.refinaciones), 'Estaño crudo cargado', `${kg(tot.crudo_kg)} kg`],
    ['Estaño refinado obtenido', `${kg(tot.refinado_kg)} kg`, 'Lingotes producidos', ent(tot.n_lingotes)],
    ['Dross / escoria de refinación', `${kg(tot.dross_kg)} kg`, 'Merma', `${kg(tot.merma_kg)} kg`],
    ['Rendimiento del período', pct(tot.rendimiento_pct), 'Pureza final promedio', pct(tot.pureza_final_prom)],
    ['Costo total del proceso', kg(tot.costo_total), 'Costo por kg refinado', kg(tot.costo_kg)],
    ['Duración promedio', tot.duracion_prom_horas == null ? '—' : `${kg(tot.duracion_prom_horas)} h`, 'Reactivos consumidos', `${kg(tot.reactivos_kg)} kg`],
  ]);
  parrafo(`Crudo ${kg(tot.crudo_kg)} kg = refinado ${kg(tot.refinado_kg)} + dross ${kg(tot.dross_kg)} + merma ${kg(tot.merma_kg)} kg.`);

  if (reac.length) {
    barra('CONSUMO DE REACTIVOS');
    tabla({
      head: ['Reactivo', 'Consumo (kg)', 'kg por tonelada de crudo'],
      body: reac.map((r) => [r.nombre, kg(r.kg), kg(r.kg_por_ton)]),
      foot: ['TOTAL', kg(tot.reactivos_kg), ''],
      fontSize: 7.5,
      columnStyles: { 0: { halign: 'left' } },
    });
  }

  barra('OBSERVACIONES Y HALLAZGOS');
  hs.forEach((h) => parrafo(`•  ${h}`));
  filas.filter((f) => f.observaciones.trim()).forEach((f) => parrafo(`•  Refinación #${f.refinacion_num}: ${f.observaciones}`));
  if (!hs.length && !filas.some((f) => f.observaciones.trim())) parrafo('Sin observaciones registradas en el período.');

  firma(op.supervisor, 'Supervisor de Refinación');
  void st;
  const p = per ? `${per.desde}_${per.hasta}` : new Date().toISOString().slice(0, 10);
  previewPdfDoc(doc, `reporte-refinacion-matanzas-${p}.pdf`);
}

/* ───────────── 2) Colada + Refinación ───────────── */

export async function generarReporteColadaRefinacion(
  refinaciones: RefinacionReporte[], coladas: ColadaReporte[], todasLasRefinaciones: RefinacionReporte[], op: OpcionesReporteCadena,
): Promise<void> {
  if (!refinaciones.length) throw new Error('Elegí al menos una refinación para el reporte.');
  const filas = refinaciones.map(filaRefinacion);
  const cs = cadenas(filas, coladas, op.tenorPct);
  const tot = totalesCadena(cs);
  const per = periodo(filas);
  const pendientes = brutoSinRefinar(coladas, todasLasRefinaciones);
  const hs = hallazgosCadena(cs, tot, op.tenorPct);
  const { st, barra, ficha, parrafo, tabla, firma, emision, doc } = await lienzo('Colada + Refinación · Cadena del estaño · Planta Matanzas', 'portrait');

  barra('IDENTIFICACIÓN DEL REPORTE');
  ficha([
    ['Lugar', op.lugar || 'Matanzas', 'Supervisor', op.supervisor || '—'],
    ['Equipos', op.equipo || '—', 'Período (fecha de refinación)', per ? `${fecha(per.desde)} — ${fecha(per.hasta)}` : '—'],
    ['Refinaciones incluidas', `${filas.map((f) => `#${f.refinacion_num}`).join(', ')} (${filas.length})`, 'Fecha de emisión', emision],
    ['Tenor de Sn aplicado', pct(op.tenorPct), 'Fuente de datos', 'Sistema MGG · MGG-FR-001 y MGG-FR-002'],
  ]);

  barra('NOTA METODOLÓGICA');
  parrafo(`El reporte sigue el estaño de punta a punta: casiterita → estaño bruto (fundición) → lingote refinado (refinación). Cuando una refinación toma solo una parte de una colada, la casiterita y el Sn teórico de esa colada se le atribuyen en proporción a los kg tomados. Rendimiento de fundición = estaño bruto ÷ Sn teórico (tenor ${pct(op.tenorPct)}); rendimiento de refinación = refinado ÷ crudo; rendimiento global = refinado ÷ Sn teórico. El crudo que no viene de una colada del sistema (carga manual o segunda refinación) no tiene casiterita atrás y queda fuera del rendimiento global.`);
  if (op.nota.trim()) parrafo(op.nota);

  barra('RESUMEN DE LA CADENA');
  ficha([
    ['Casiterita atribuida', `${kg(tot.casiterita_kg)} kg`, 'Sn teórico', `${kg(tot.sn_teorico_kg)} kg`],
    ['Estaño bruto a refinación', `${kg(tot.crudo_kg)} kg`, 'de coladas del sistema', `${kg(tot.crudo_trazado_kg)} kg`],
    ['Estaño refinado', `${kg(tot.refinado_kg)} kg`, 'Dross de refinación', `${kg(tot.dross_kg)} kg`],
    ['Rendimiento fundición', pct(tot.rendimiento_fundicion_pct), 'Rendimiento refinación', pct(tot.rendimiento_refinacion_pct)],
    ['RENDIMIENTO GLOBAL', pct(tot.rendimiento_global_pct), '', ''],
  ]);

  // El detalle iba en UNA tabla de 13 columnas, que es lo que obligaba a la hoja
  // horizontal. En vertical esas 13 columnas quedan de 40 puntos y todo se parte
  // en tres líneas. Se separa en las dos mitades que la cadena ya tiene: primero
  // de dónde salió el estaño (una fila por colada de origen), después qué dio
  // cada refinación (una fila por refinación). No se pierde ningún número.
  barra('DE LA CASITERITA AL ESTAÑO BRUTO · COLADAS DE ORIGEN');
  const origenes: string[][] = [];
  cs.forEach((c) => {
    const f = c.refinacion;
    c.tramos.forEach((t, i) => {
      origenes.push([
        i === 0 ? `#${f.refinacion_num} · ${fecha(f.fecha)}` : '',
        t.etiqueta + (t.origen !== 'colada' ? ` (${t.origen === 'manual' ? 'manual' : '2ª refinación'})` : ''),
        t.fecha_colada ? fecha(t.fecha_colada) : '—',
        kg(t.casiterita_kg), kg(t.sn_teorico_kg), kg(t.estano_colada_kg), pct(t.rendimiento_fundicion_pct),
        kg(t.tomado_kg), t.fraccion == null ? '—' : `${kg(t.fraccion * 100)} %`,
      ]);
    });
    if (!c.tramos.length) origenes.push([`#${f.refinacion_num} · ${fecha(f.fecha)}`, 'sin origen registrado', '—', '—', '—', '—', '—', kg(f.crudo_kg), '—']);
  });
  tabla({
    head: ['Refinación', 'Colada de origen', 'Fecha colada', 'Casiterita atrib. (kg)', 'Sn teórico (kg)', 'Bruto colada (kg)', 'Rend. fundición', 'Tomado (kg)', '% de la colada'],
    body: origenes,
    foot: ['TOTALES', '', '', kg(tot.casiterita_kg), kg(tot.sn_teorico_kg), '', pct(tot.rendimiento_fundicion_pct), kg(tot.crudo_kg), ''],
    fontSize: 6.8,
    columnStyles: { 0: { halign: 'left', cellWidth: 68 }, 1: { halign: 'left' }, 2: { halign: 'center' } },
  });

  barra('DEL ESTAÑO BRUTO AL LINGOTE REFINADO · RESULTADO DE CADA REFINACIÓN');
  tabla({
    head: ['Refinación', 'Fecha', 'Crudo cargado (kg)', 'Refinado (kg)', 'Dross (kg)', 'Rend. refinación', 'Rend. global'],
    body: cs.map((c) => [
      `#${c.refinacion.refinacion_num}`, fecha(c.refinacion.fecha),
      kg(c.refinacion.crudo_kg), kg(c.refinacion.refinado_kg), kg(c.refinacion.dross_kg),
      pct(c.refinacion.rendimiento_pct), pct(c.rendimiento_global_pct),
    ]),
    foot: ['TOTALES', '', kg(tot.crudo_kg), kg(tot.refinado_kg), kg(tot.dross_kg), pct(tot.rendimiento_refinacion_pct), pct(tot.rendimiento_global_pct)],
    fontSize: 7.5,
    columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } },
  });

  if (pendientes.length) {
    barra('ESTAÑO BRUTO TODAVÍA SIN REFINAR');
    tabla({
      head: ['Colada', 'Fecha', 'Estaño bruto (kg)', 'Ya refinado (kg)', 'Pendiente (kg)'],
      body: pendientes.map((x) => [`#${x.colada_num}`, fecha(x.fecha), kg(x.estano_kg), kg(x.refinado_desde_kg), kg(x.pendiente_kg)]),
      foot: ['TOTAL', '', '', '', kg(pendientes.reduce((a, x) => a + x.pendiente_kg, 0))],
      fontSize: 7.5,
      columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } },
    });
  }

  barra('OBSERVACIONES Y HALLAZGOS');
  hs.forEach((h) => parrafo(`•  ${h}`));
  if (!hs.length) parrafo('Sin observaciones para el período.');

  firma(op.supervisor, 'Supervisor de Producción');
  void st;
  const p = per ? `${per.desde}_${per.hasta}` : new Date().toISOString().slice(0, 10);
  previewPdfDoc(doc, `reporte-colada-refinacion-${p}.pdf`);
}
