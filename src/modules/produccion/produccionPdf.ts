/* ============================================================
   MGG · Fundición / Refinación · Reporte PDF

   El PDF del proceso: la ficha, la CASITERITA que entró (con su
   procedencia), los materiales, los datos del proceso, los resultados,
   las observaciones y quiénes participaron. Antes solo mostraba los
   materiales y los costos, y todo lo demás —de dónde vino el mineral,
   quién trabajó la colada, qué se observó— se quedaba fuera.

   Todo el texto pasa por `textoPdf`: las fuentes estándar de jsPDF solo
   escriben Windows-1252 y un «CACO₃» rompía el renglón entero.

   Devuelve base64 para enviarlo por correo, y en pantalla se abre en
   VISTA PREVIA: nada se descarga solo (regla del sistema).
   ============================================================ */
import type { Produccion, ColadaDatos, RefinacionDatos, ColadaBigBag } from '@/shared/lib/types';
import { getProduccionConMateriales } from './produccion.repository';
import { getColada } from './colada.repository';
import { getRefinacion } from './refinacion.repository';
import { textoPdf } from '@/shared/lib/textoPdf';
import { previewPdfDoc } from '@/shared/lib/reportPreview';

const ORANGE: [number, number, number] = [255, 138, 0];

/** Lo que se junta para armar el reporte: la orden + el reporte del proceso. */
interface Detalle {
  esRefinacion: boolean;
  numero: number | null;
  fecha: string | null;
  colada: ColadaDatos | null;
  refinacion: RefinacionDatos | null;
}

async function cargarDetalle(prod: Produccion): Promise<Detalle> {
  const esRefinacion = (prod.tipo ?? 'fundicion') === 'refinacion';
  if (esRefinacion) {
    const r = await getRefinacion(prod.id).catch(() => null);
    return { esRefinacion, numero: r?.refinacion_num ?? null, fecha: r?.fecha ?? null, colada: null, refinacion: r?.datos ?? null };
  }
  const c = await getColada(prod.id).catch(() => null);
  return { esRefinacion, numero: c?.colada_num ?? null, fecha: c?.fecha ?? null, colada: c?.datos ?? null, refinacion: null };
}

async function construir(prod: Produccion, det: Detalle) {
  const [{ jsPDF }, { default: autoTable }, { date, dateTime, money, num }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  const ANCHO = doc.internal.pageSize.getWidth() - MARGIN * 2;
  let y = MARGIN;

  const T = (v: unknown): string => textoPdf(v);
  /** Valor de ficha: «—» cuando no hay dato, para que el renglón no quede mudo. */
  const V = (v: unknown): string => { const s = T(v).trim(); return s || '—'; };
  const kg = (v: unknown): string => (v == null || v === '' ? '—' : `${num(Number(v))} kg`);
  const pct = (v: unknown): string => (v == null || v === '' ? '—' : `${num(Number(v))} %`);
  const grados = (v: unknown): string => (v == null || v === '' ? '—' : `${num(Number(v))} °C`);

  const titulo = det.esRefinacion ? 'Reporte de Refinación' : 'Reporte de Fundición';
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 60 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(T(titulo), tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(T(`MGG · ${dateTime(new Date().toISOString())}`), tx, y + 33);
  y += 60;

  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text(T(`${prod.producto_nombre} · ${num(prod.cantidad)} und`), MARGIN, y); y += 16;

  /** Una barra de sección naranja, para que el reporte se lea por bloques. */
  function barra(texto: string): void {
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = MARGIN; }
    doc.setFillColor(...ORANGE);
    doc.rect(MARGIN, y, ANCHO, 15, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    doc.text(T(texto), MARGIN + 5, y + 10.5);
    doc.setTextColor(0, 0, 0);
    y += 21;
  }

  /** Ficha etiqueta/valor a dos columnas. */
  function ficha(filas: Array<[string, string, string?, string?]>): void {
    autoTable(doc, {
      startY: y,
      body: filas.map((f) => [T(f[0]), T(f[1]), T(f[2] ?? ''), T(f[3] ?? '')]),
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: ANCHO * 0.28 },
        1: { cellWidth: ANCHO * 0.22 },
        2: { fontStyle: 'bold', cellWidth: ANCHO * 0.28 },
      },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  }

  function tabla(head: string[], body: unknown[][], columnStyles?: Record<number, object>): void {
    autoTable(doc, {
      startY: y,
      head: [head.map(T)],
      body: body.map((f) => f.map(T)),
      theme: 'grid',
      headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles,
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable
    y = (doc.lastAutoTable?.finalY ?? y) + 12;
  }

  // ── FICHA DE LA ORDEN ──
  barra(det.esRefinacion ? 'REFINACIÓN' : 'FUNDICIÓN');
  const etiquetaNum = det.esRefinacion ? 'Refinación N°' : 'Colada N°';
  ficha([
    [etiquetaNum, det.numero != null ? `#${det.numero}` : '—', 'Fecha del proceso', det.fecha ? date(det.fecha) : '—'],
    ['Receta N°', prod.receta_num != null ? `#${num(prod.receta_num)}` : '—', 'Estado', prod.estado === 'finalizado' ? 'Finalizado' : 'En proceso'],
    ['Almacén destino', V(prod.almacen_destino), 'Horno utilizado', V(prod.horno)],
    ['Inicio', dateTime(prod.inicio_at), 'Fin', prod.fin_at ? dateTime(prod.fin_at) : '—'],
    ['Duración', duracion(prod.inicio_at, prod.fin_at), '', ''],
  ]);

  const d = det.colada;
  const r = det.refinacion;

  // ── CASITERITA: de dónde vino el mineral ──
  // Es lo primero que se pregunta al leer una colada y era justo lo que faltaba.
  if (d) {
    const bags: ColadaBigBag[] = (d.big_bags ?? []).filter(Boolean);
    barra('CASITERITA UTILIZADA · PROCEDENCIA');
    if (bags.length) {
      let totalKg = 0;
      let totalCosto = 0;
      const cuerpo = bags.map((b, i) => {
        const bkg = Number(b.kg) || 0;
        const tasa = Number(b.tasa) || 0;
        totalKg += bkg;
        totalCosto += bkg * tasa;
        return [
          String(i + 1),
          V(b.aliado),
          V(b.precinto),
          V(b.analisis),
          num(bkg),
          b.ley_prom == null ? '—' : `${num(Number(b.ley_prom))} %`,
          tasa ? money(tasa) : '—',
          tasa ? money(bkg * tasa) : '—',
        ];
      });
      cuerpo.push(['', 'TOTAL', '', '', num(totalKg), '', '', money(totalCosto)]);
      tabla(
        ['#', 'Procedencia / aliado', 'Precinto', 'Análisis', 'Kg', 'Ley prom.', 'Tasa $/Kg', 'Costo $'],
        cuerpo,
        { 0: { cellWidth: 18, halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
      );
      ficha([
        ['Total casiterita cargada', kg(d.total_casiterita ?? totalKg), 'Ley Sn declarada', pct(d.ley_sn)],
        ['Sn contenido (kg)', kg(d.sn_kg), 'Valor de la casiterita', money(totalCosto)],
      ]);
    } else {
      ficha([['Casiterita cargada', kg(d.total_casiterita), 'Ley Sn declarada', pct(d.ley_sn)]]);
    }
  }

  // ── Estaño crudo de origen (refinación) ──
  if (r && (r.coladas ?? []).length) {
    barra('ESTAÑO CRUDO DE ORIGEN · PROCEDENCIA');
    tabla(
      ['#', 'Origen', 'Fecha', 'Almacén', 'Kg', 'Costo $/Kg'],
      (r.coladas ?? []).map((c, i) => [
        String(i + 1),
        V(c.etiqueta || `Colada #${c.colada_num}`),
        c.fecha ? date(c.fecha) : '—',
        V(c.almacen),
        num(Number(c.estano_kg) || 0),
        money(Number(c.costo_unitario) || 0),
      ]),
      { 0: { cellWidth: 18, halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    );
  }

  // ── FUNDENTES Y MATERIALES ──
  barra('MATERIALES UTILIZADOS');
  if ((prod.materiales ?? []).length) {
    tabla(
      ['Material', 'Almacén', 'Cantidad', 'Costo unit.', 'Subtotal'],
      (prod.materiales ?? []).map((m) => [m.material_nombre, m.almacen, num(m.cantidad), money(m.costo_unitario), money(m.subtotal)]),
      { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    );
  } else {
    ficha([['Materiales', 'Sin materiales cargados', '', '']]);
  }
  if (d) {
    ficha([
      ['Coque (kg)', kg(d.coque_kg), 'Proveedor del coque', V(d.coque_proveedor)],
      ['Granulometría del coque', V(d.coque_granulometria), 'CaCO3 (kg)', kg(d.caco3_kg)],
      ['Granulometría del CaCO3', V(d.caco3_granulometria), 'Otro fundente', V(d.otro_fundente)],
    ]);
  }

  // ── PROCESO ──
  if (d) {
    barra('PROCESO DE COLADA');
    ficha([
      ['Responsable', V(d.responsable), 'Turno / jornada', V(d.turno)],
      ['Carga del horno', V(d.carga_horno), 'Homogeneización', V(d.homogeneizacion)],
      ['Inicio de carga', `${V(d.fecha_inicio_carga)} ${T(d.hora_inicio_carga ?? '')}`.trim(), 'Fin de carga', `${V(d.fecha_fin_carga)} ${T(d.hora_fin_carga ?? '')}`.trim()],
      ['Inicio del proceso', V(d.hora_inicio_proceso), 'Fin del proceso', V(d.hora_fin_proceso)],
      ['Hora de sangrado', V(d.hora_sangrado), 'Temperatura de colada', grados(d.temp_colada)],
      ['Duración de la colada', d.duracion_horas == null ? '—' : `${num(Number(d.duracion_horas))} h`, 'Jornada (h)', d.jornada_horas == null ? '—' : `${num(Number(d.jornada_horas))} h`],
    ]);
    const temps = (d.temperaturas ?? []).filter((t) => t && (t.hora || t.temp_int != null || t.temp_ext != null));
    if (temps.length) {
      tabla(
        ['Hora', 'Temp. interna', 'Temp. externa', 'Observación'],
        temps.map((t) => [V(t.hora), grados(t.temp_int), grados(t.temp_ext), T(t.obs ?? '')]),
        { 1: { halign: 'right' }, 2: { halign: 'right' } },
      );
    }
  }

  if (r) {
    barra('PROCESO DE REFINACIÓN');
    ficha([
      ['Responsable', V(r.responsable), 'Turno', V(r.turno)],
      ['Horno / olla', V(r.n_horno_olla), 'Pureza inicial', pct(r.pureza_inicial)],
      ['Método de agitación', V(r.metodo_agitacion), 'Desespumado', V(r.desespumado)],
      ['Estaño crudo (kg)', kg(r.estano_crudo_kg), 'Jornada (h)', r.jornada_horas == null ? '—' : `${num(Number(r.jornada_horas))} h`],
      ['Inicio de refinación', V(r.hora_inicio_refinacion), 'Fin de refinación', V(r.hora_fin_refinacion)],
      ['Inicio de vaciado', V(r.hora_inicio_vaciado), 'Temperatura de colada', grados(r.temp_colada)],
    ]);
    const etapas = (r.etapas ?? []).filter((e) => e && (e.etapa || e.hora || e.temp_bano != null));
    if (etapas.length) {
      tabla(
        ['Etapa', 'Hora', 'Temp. baño', 'Temp. quemador', 'Acción'],
        etapas.map((e) => [V(e.etapa), V(e.hora), grados(e.temp_bano), grados(e.temp_quemador), T(e.accion ?? '')]),
        { 2: { halign: 'right' }, 3: { halign: 'right' } },
      );
    }
  }

  // ── RESULTADOS ──
  barra('RESULTADOS');
  if (d) {
    ficha([
      ['Estaño obtenido (kg)', kg(d.estano_kg), 'N° de lingotes', d.n_lingotes == null ? '—' : String(d.n_lingotes)],
      ['Escoria generada (kg)', kg(d.escoria_kg), 'Rendimiento', pct(d.rendimiento)],
      ['Merma (kg)', kg(d.merma_kg), 'Destino / almacén', V(d.destino_almacen || prod.almacen_destino)],
    ]);
  } else if (r) {
    ficha([
      ['Estaño refinado (kg)', kg(r.estano_refinado_kg), 'N° de lingotes', r.n_lingotes == null ? '—' : String(r.n_lingotes)],
      ['Peso prom. por lingote', kg(r.peso_prom_lingote), 'N° de precinto / lote', V(r.n_precinto)],
      ['Dross / escoria (kg)', kg(r.dross_kg), 'Rendimiento', pct(r.rendimiento)],
      ['Merma (kg)', kg(r.merma_kg), 'Pureza final', pct(r.pureza_final)],
      ['Destino / almacén', V(r.destino_almacen || prod.almacen_destino), '', ''],
    ]);
  } else {
    ficha([['Producido', `${num(prod.cantidad)} und`, 'Destino / almacén', V(prod.almacen_destino)]]);
  }

  // ── COSTOS ──
  barra('COSTOS');
  ficha([
    ['Costo Total de Materiales (CTM)', money(prod.costo_material), 'Mano de obra', money(prod.mano_obra)],
    ['Costos indirectos', money(prod.costos_indirectos), 'Costo de Fundición (CP)', money(prod.costo_material + prod.mano_obra + prod.costos_indirectos)],
    ['Costo unitario (PMP)', money(prod.costo_unitario), 'Precio de venta', prod.precio_venta != null ? money(prod.precio_venta) : '—'],
    ['Posible ganancia', prod.ganancia != null ? money(prod.ganancia) : '—', '', ''],
  ]);

  // ── OBSERVACIONES ──
  const obs = T((d?.observaciones ?? r?.observaciones ?? '')).trim();
  barra('OBSERVACIONES');
  if (obs) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lineas = doc.splitTextToSize(obs, ANCHO);
    if (y + lineas.length * 12 > doc.internal.pageSize.getHeight() - MARGIN) { doc.addPage(); y = MARGIN; }
    doc.text(lineas, MARGIN, y + 8);
    y += lineas.length * 12 + 12;
  } else {
    ficha([['Observaciones', 'Sin observaciones', '', '']]);
  }

  // ── INVOLUCRADOS ──
  const inv = (d?.involucrados ?? r?.involucrados ?? []).filter(Boolean);
  barra('INVOLUCRADOS');
  if (inv.length) {
    const pares: Array<[string, string, string?, string?]> = [];
    for (let i = 0; i < inv.length; i += 2) pares.push([`${i + 1}.`, inv[i], inv[i + 1] ? `${i + 2}.` : '', inv[i + 1] ?? '']);
    autoTable(doc, {
      startY: y,
      body: pares.map((f) => [T(f[0]), T(f[1]), T(f[2] ?? ''), T(f[3] ?? '')]),
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 22, fontStyle: 'bold' }, 1: { cellWidth: ANCHO * 0.44 }, 2: { cellWidth: 22, fontStyle: 'bold' } },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable
    y = (doc.lastAutoTable?.finalY ?? y) + 12;
  } else {
    ficha([['Involucrados', 'Sin personas cargadas', '', '']]);
  }

  // ── Firmas ──
  if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = MARGIN; }
  autoTable(doc, {
    startY: y,
    head: [['ELABORADO POR', 'REVISADO POR', 'APROBADO POR']],
    body: [['\n\n\n', '\n\n\n', '\n\n\n']],
    theme: 'grid',
    headStyles: { fillColor: [70, 70, 70], textColor: 255, fontSize: 8, halign: 'center' },
    styles: { fontSize: 8, cellPadding: 3, minCellHeight: 46, halign: 'center' },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  const base = det.esRefinacion ? 'refinacion' : 'produccion';
  return { doc, filename: `${base}-${textoPdf(prod.producto_nombre).replace(/[^\w-]+/g, '_')}-${prod.id.slice(0, 8)}.pdf` };
}

function duracion(inicio: string, fin?: string | null): string {
  if (!fin) return 'En curso';
  const ms = new Date(fin).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Genera el reporte y lo abre en VISTA PREVIA (no descarga sola). */
export async function descargarProduccionPdf(id: string): Promise<void> {
  const prod = await getProduccionConMateriales(id);
  if (!prod) throw new Error('Fundición no encontrada');
  const { doc, filename } = await construir(prod, await cargarDetalle(prod));
  previewPdfDoc(doc, filename);
}

export async function obtenerProduccionPdfBase64(id: string): Promise<{ base64: string; filename: string }> {
  const prod = await getProduccionConMateriales(id);
  if (!prod) throw new Error('Fundición no encontrada');
  const { doc, filename } = await construir(prod, await cargarDetalle(prod));
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',')[1] ?? '';
  return { base64, filename };
}
