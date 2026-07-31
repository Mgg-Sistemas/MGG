/* ============================================================
   MGG · Recepciones · Resumen por recepción (PDF con vista previa)
   Replica el formato de la hoja de recepción: pesos (Centro de Acopio →
   Recibidos por Ops → Secos → neto final), mermas con su %, y el Tenor Sn
   con sus lecturas + Kg Neto de Sn. Todo se toma de los datos ya cargados.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import {
  netoPorProcedenciaGrupo, catLado, esRecepcionCompartida, SOCIO_COMPARTIDO,
  type RecepcionGrupo, type Recepcion, type RecepcionPesaje, type RecepcionAnalisis, type RecepcionMineral,
  type RecepcionConciliacion, type RecepcionTotales,
} from './recepciones.repository';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const N = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** 2 decimales, es-VE (miles con punto, decimales con coma). */
const n2 = (v: number | null | undefined) =>
  v == null ? '—' : round2(Number(v)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number | null | undefined) => (v == null ? '—' : `${n2(v)}%`);

/** Lee una lectura del lab tolerando datos viejos {a,b,c} o nuevos {prom} — igual que la grilla. */
const lecturaNum = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') {
    const o = v as { a?: number | null; b?: number | null; c?: number | null; prom?: number | null };
    if (o.prom != null && Number.isFinite(Number(o.prom))) return Number(o.prom);
    const xs = [o.a, o.b, o.c].filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }
  return null;
};

export interface ResumenRecepcionData {
  grupo: RecepcionGrupo;
  recepciones: Recepcion[];
  pesajes: RecepcionPesaje[];
  analisis: RecepcionAnalisis[];
  minerales: RecepcionMineral[];
  conciliaciones: RecepcionConciliacion[];
  totales: RecepcionTotales[];
}

export async function descargarResumenRecepcionPdf(data: ResumenRecepcionData): Promise<void> {
  const { grupo, recepciones, pesajes, analisis, minerales, conciliaciones, totales } = data;
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);

  // ── Agregados (todo desde los datos existentes) ──
  const sum = <T,>(arr: T[], f: (x: T) => unknown) => arr.reduce((a, x) => a + N(f(x)), 0);

  const centroAcopio = round2(sum(recepciones, (r) => r.peso_kg));                       // Σ saldo del cierre
  const recibidosOps = round2(pesajes.length ? sum(pesajes, (p) => p.total_neto_humedo) : centroAcopio);
  const netoSecos = round2(pesajes.length ? sum(pesajes, (p) => p.total_neto_seco) : recibidosOps);

  // Merma "no llegó": la última conciliación si existe; si no, la diferencia Recibidos − Centro.
  const conc = conciliaciones[conciliaciones.length - 1] ?? null;
  const mermaNoLlego = conc?.kg_no_llego != null ? round2(N(conc.kg_no_llego)) : round2(recibidosOps - centroAcopio);
  const pctNoLlego = conc?.pct_no_llego != null ? round2(N(conc.pct_no_llego))
    : recibidosOps ? round2((mermaNoLlego / recibidosOps) * 100) : 0;

  // Merma humedad = neto húmedo − neto seco (de los pesajes).
  const mermaHumedad = round2(recibidosOps - netoSecos);
  const pctHumedad = recibidosOps ? round2((mermaHumedad / recibidosOps) * 100) : 0;

  // Merma Fe: no hay una merma en Kg dedicada; el neto final = neto seco (menos merma Fe si la hubiera).
  const mermaFe = 0;
  const pctFe = 0;
  const netoFinal = round2(netoSecos - mermaFe);

  // Bolsas / big bags (de los pesajes).
  const bigbags = pesajes.flatMap((p) => p.bigbags ?? []);
  const cantBolsas = bigbags.length;
  const cantBigbags = bigbags.filter((b) => catLado(b, 'h') === 'bigbag').reduce((a, b) => a + (N(b.cant) || 1), 0);

  // Tenor del mineral principal (Sn / Estaño): cada análisis = una lectura (columna).
  // Se lee con lecturaNum (prioriza {prom}, tolera {a,b,c}) igual que la grilla del lab,
  // y el promedio = media de todas las lecturas presentes (idéntico a la columna PROM.).
  const mineralSn = minerales.find((m) => /sn/i.test(m.clave) || /sn/i.test(m.nombre) || /esta[ñn]o/i.test(m.nombre))
    ?? minerales[0] ?? null;
  const analisisOrd = [...analisis].sort((a, b) => a.n_analisis - b.n_analisis);
  const tenorNombre = mineralSn?.nombre ?? 'Sn';

  // Encabezado.
  const numero = totales[totales.length - 1]?.numero ?? conc?.numero ?? recepciones[0]?.item ?? null;
  const fecha = recepciones[0]?.fecha ?? totales[totales.length - 1]?.fecha ?? new Date().toISOString();
  const procedencias = Array.from(new Set(recepciones.map((r) => (r.procedencia || '').trim()).filter(Boolean)));
  const procedencia = procedencias.join(' · ') || grupo.nombre.replace(/^RECEPCIÓN\s+/i, '');
  const obs0 = recepciones.map((r) => r.nota).filter(Boolean).join(' · ');

  // ── Documento ──
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('RESUMEN DE RECEPCIÓN', W / 2 + 24, y + 18, { align: 'center' });
  doc.setTextColor(20, 20, 20); doc.setFontSize(10);
  doc.text(`RECEPCIÓN N° ${numero ?? '—'}   ·   ${fmt.date(fecha)}`, W / 2 + 24, y + 36, { align: 'center' });
  doc.setTextColor(90, 90, 90); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Procedencia C/A: ${procedencia}`, W / 2 + 24, y + 50, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 68;

  // Tabla principal (Concepto · Kg · Observaciones). La fila "finales" resaltada.
  const FINAL_ROW = 'Kg neto finales seco y limpio';
  autoTable(doc, {
    startY: y,
    head: [['CONCEPTO', 'KG', 'OBSERVACIONES']],
    body: [
      ['Kg neto Centro de Acopio', n2(centroAcopio), `Cantidad de bolsas: ${cantBolsas}${obs0 ? ` · ${obs0}` : ''}`],
      ['Merma no llegó', n2(mermaNoLlego), pct(pctNoLlego)],
      ['Kg neto Recibidos por Ops', n2(recibidosOps), cantBigbags ? `Se recepcionó en ${cantBigbags} big bags` : ''],
      ['Merma humedad', n2(mermaHumedad), pct(pctHumedad)],
      ['Kg neto Secos', n2(netoSecos), 'Si el material viene seco se repite el paso de Ops'],
      ['Merma Fe', n2(mermaFe), pct(pctFe)],
      [FINAL_ROW, n2(netoFinal), 'Si el material viene sin Fe y limpio se repite el paso de Ops'],
    ],
    styles: { fontSize: 10, cellPadding: 5, valign: 'middle' },
    headStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 230, fontStyle: 'bold' },
      1: { cellWidth: 110, halign: 'right', fontStyle: 'bold' },
      2: { cellWidth: 190, fontSize: 8, textColor: [90, 90, 90] },
    },
    margin: { left: MARGIN, right: MARGIN },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.raw && (h.row.raw as string[])[0] === FINAL_ROW) {
        h.cell.styles.fillColor = [255, 244, 214]; // resaltado (crema)
      }
    },
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = doc.lastAutoTable.finalY + 18;

  // ── Desglose POR PROCEDENCIA (neto húmedo/seco + merma H2O + tenor + Kg Sn) ──
  const procNetoH = netoPorProcedenciaGrupo(pesajes, 'h');
  const procNetoS = netoPorProcedenciaGrupo(pesajes, 's');
  const procs = Array.from(new Set([...procNetoH.keys(), ...procNetoS.keys()])).sort((a, b) => a.localeCompare(b));
  // Tenor promedio del mineral principal SÓLO sobre las lecturas de esa procedencia.
  const tenorDeProc = (proc: string): number | null => {
    if (!mineralSn) return null;
    const ls = analisisOrd
      .filter((a) => (a.procedencia ?? '').trim().toUpperCase() === proc)
      .map((a) => lecturaNum(a.valores?.[mineralSn.clave]))
      .filter((x): x is number => x != null);
    return ls.length ? round2(ls.reduce((a, b) => a + b, 0) / ls.length) : null;
  };
  if (procs.length) {
    const bodyProc = procs.map((p) => {
      const h = round2(N(procNetoH.get(p)));
      const s = round2(N(procNetoS.get(p)));
      const merma = round2(h - s);
      const tn = tenorDeProc(p);
      const kgSn = tn != null ? round2((s * tn) / 100) : null;
      return [p, n2(h), n2(s), n2(merma), tn != null ? `${n2(tn)} %` : '—', kgSn != null ? n2(kgSn) : '—'];
    });
    const tH = round2(procs.reduce((a, p) => a + N(procNetoH.get(p)), 0));
    const tS = round2(procs.reduce((a, p) => a + N(procNetoS.get(p)), 0));
    autoTable(doc, {
      startY: y,
      head: [['PROCEDENCIA', 'NETO HÚMEDO', 'NETO SECO', 'MERMA H₂O', `TENOR ${tenorNombre.toUpperCase()}`, `KG ${tenorNombre.toUpperCase()}`]],
      body: bodyProc,
      foot: [['TOTAL', n2(tH), n2(tS), n2(round2(tH - tS)), '', '']],
      styles: { fontSize: 9, cellPadding: 4, halign: 'right', valign: 'middle' },
      headStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 8 },
      footStyles: { fillColor: [255, 244, 214], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 120 } },
      margin: { left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = doc.lastAutoTable.finalY + 18;
  }

  // Tenor + Kg Neto de Sn — SEPARADO POR PROCEDENCIA (aliado / centro).
  // Cada procedencia = una fila con TODAS sus lecturas químicas y su PROMEDIO propio.
  // Kg Neto de Sn de la fila = neto seco de esa procedencia × su tenor promedio ÷ 100.
  const lectPorProc = new Map<string, number[]>();
  if (mineralSn) {
    for (const a of analisisOrd) {
      const v = lecturaNum(a.valores?.[mineralSn.clave]);
      if (v == null) continue;
      const proc = (a.procedencia ?? '').trim().toUpperCase() || 'SIN PROCEDENCIA';
      if (!lectPorProc.has(proc)) lectPorProc.set(proc, []);
      lectPorProc.get(proc)!.push(v);
    }
  }
  const procLect = Array.from(lectPorProc.keys()).sort((a, b) => a.localeCompare(b));
  const promProc = (p: string): number | null => {
    const xs = lectPorProc.get(p) ?? [];
    return xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const kgSnProc = (p: string): number => {
    const prom = promProc(p);
    const seco = round2(N(procNetoS.get(p)));
    return prom != null ? round2((seco * prom) / 100) : 0;
  };
  const nLect = Math.max(1, ...procLect.map((p) => lectPorProc.get(p)!.length));
  const lectHead = Array.from({ length: nLect }, (_, i) => `LECTURA ${i + 1}`);
  const bodyLect = procLect.length
    ? procLect.map((p) => {
        const xs = lectPorProc.get(p) ?? [];
        const cells = Array.from({ length: nLect }, (_, i) => (xs[i] != null ? n2(xs[i]) : '—'));
        const prom = promProc(p);
        return [p, ...cells, prom != null ? `${n2(prom)} %` : '—', n2(kgSnProc(p))];
      })
    : [['—', ...Array(nLect).fill('—'), '—', '—']];
  const kgSnTotal = round2(procLect.reduce((a, p) => a + kgSnProc(p), 0));
  const chico = nLect > 4; // con muchas lecturas achicamos la fuente para que quepan
  autoTable(doc, {
    startY: y,
    head: [[`TENOR ${tenorNombre.toUpperCase()}`, ...lectHead, 'PROMEDIO', `KG ${tenorNombre.toUpperCase()}`]],
    body: bodyLect,
    foot: [[`Kg Neto de ${tenorNombre} (total)`, ...Array(nLect).fill(''), '', n2(kgSnTotal)]],
    styles: { fontSize: chico ? 8 : 10, cellPadding: chico ? 4 : 5, halign: 'right', valign: 'middle' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center', fontSize: chico ? 7 : 9 },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: chico ? 90 : 150 } },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = doc.lastAutoTable.finalY + 8;

  // ── DESGLOSE DE KG TOTAL — SOLO recepciones COMPARTIDAS ("EL BURRO": NAVIL / AUTANA) ──
  // Presentación 50/50 (MGG ↔ socio): la casiterita entra completa; la tasa (un ratio) no
  // cambia, solo se divide el total en dos mitades. Toma los totales del costo final.
  const totDesglose = totales[totales.length - 1] ?? null;
  if (esRecepcionCompartida(grupo.nombre) && totDesglose) {
    const kgTot = round2(N(totDesglose.total_sno2_final));
    const valorTot = round2(N(totDesglose.total_moneda_final));
    const tasaTxt = totDesglose.tasa_final != null ? `$ ${n2(N(totDesglose.tasa_final))}` : '—';
    autoTable(doc, {
      startY: y + 10,
      head: [['DESGLOSE DE KG TOTAL', 'KG', 'TASA', 'VALOR', 'SOCIO']],
      body: [
        ['50%', n2(round2(kgTot / 2)), tasaTxt, n2(round2(valorTot / 2)), 'MGG'],
        ['50%', n2(round2(kgTot / 2)), tasaTxt, n2(round2(valorTot / 2)), SOCIO_COMPARTIDO],
      ],
      foot: [['100%', n2(kgTot), tasaTxt, n2(valorTot), 'TOTAL']],
      styles: { fontSize: 9, cellPadding: 4, halign: 'right', valign: 'middle' },
      headStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 8 },
      footStyles: { fillColor: [255, 244, 214], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 150 }, 4: { halign: 'left', fontStyle: 'bold' } },
      margin: { left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = doc.lastAutoTable.finalY + 8;
  }

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(
    `Kg Neto de ${tenorNombre} por procedencia = neto seco × su tenor promedio ÷ 100 · Total = ${n2(kgSnTotal)}.`,
    MARGIN, y + 4,
  );
  doc.text(
    `Generado ${fmt.dateTime(new Date().toISOString())} · ${grupo.nombre} · Mineral Group Guayana C.A.`,
    MARGIN, doc.internal.pageSize.getHeight() - 16,
  );

  previewPdfDoc(doc, `resumen-recepcion-${numero ?? grupo.nombre}`.replace(/\s+/g, '-') + '.pdf');
}
