/* ============================================================
   MGG · Sección "ANÁLISIS QUÍMICO DE LABORATORIO" para los reportes de
   producción (colada MGG-FR-001 y refinación MGG-FR-002). Metales en filas,
   una columna por lectura (A, B, C…), agrupadas por procedencia, PROM por metal.
   Se dibuja solo si la orden tiene análisis. Devuelve la nueva `y`.
   ============================================================ */
import type { jsPDF } from 'jspdf';
import type { RecepcionMineral, RecepcionAnalisis, ValorMineral } from '@/modules/recepciones/recepciones.repository';

type AutoTable = (doc: jsPDF, options: Record<string, unknown>) => void;

/** Etiqueta de columna de lectura: 0→A, 25→Z, 26→AA… */
function colLetra(i: number): string {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
/** Lee una lectura de laboratorio (valores guardados como { prom } o legado {a,b,c}). */
function lecturaNum(v: ValorMineral | null | undefined): number | null {
  if (v == null) return null;
  if (v.prom != null && Number.isFinite(Number(v.prom))) return Number(v.prom);
  const xs = [v.a, v.b, v.c].filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function n2(n: number | null | undefined): string { return n == null ? '—' : `${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })}`; }
function txt(s: string | null | undefined): string { return (s ?? '').toString().trim() || '—'; }

export interface AnalisisPdfCtx {
  analisis: RecepcionAnalisis[];
  minerales: RecepcionMineral[];
  y: number;
  MARGIN: number;
  CW: number;
  ORANGE: [number, number, number];
  GREY: [number, number, number];
}

/** Dibuja la sección de análisis químico. No hace nada (devuelve la `y` sin cambios)
 *  si la orden no tiene análisis cargados. */
export function renderAnalisisQuimicoPdf(doc: jsPDF, autoTable: AutoTable, ctx: AnalisisPdfCtx): number {
  const { analisis, minerales, MARGIN, CW, ORANGE, GREY } = ctx;
  let y = ctx.y;
  if (!analisis.length || !minerales.length) return y;

  // Barra de sección naranja.
  if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = MARGIN; }
  doc.setFillColor(...ORANGE); doc.rect(MARGIN, y, CW, 17, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text('ANÁLISIS QUÍMICO DE LABORATORIO', MARGIN + 8, y + 12);
  doc.setTextColor(0, 0, 0);
  y += 21;

  // Agrupa por procedencia, preservando el orden por N° de análisis.
  const SIN = 'SIN PROCEDENCIA';
  const orden: string[] = [];
  const porProc = new Map<string, RecepcionAnalisis[]>();
  for (const a of [...analisis].sort((x, z) => x.n_analisis - z.n_analisis)) {
    const key = (a.procedencia ?? '').trim().toUpperCase() || SIN;
    if (!porProc.has(key)) { porProc.set(key, []); orden.push(key); }
    porProc.get(key)!.push(a);
  }

  for (const proc of orden) {
    const lecturas = porProc.get(proc)!;
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = MARGIN; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...ORANGE);
    doc.text(`${proc}  ·  ${lecturas.length} lectura${lecturas.length === 1 ? '' : 's'}`, MARGIN + 2, y + 2);
    doc.setTextColor(0, 0, 0);
    y += 8;
    const head = ['Metal', ...lecturas.map((_, k) => colLetra(k)), 'PROM (%)'];
    const numerosRow = ['#  (nºs)', ...lecturas.map((l) => txt(l.numeros)), ''];
    const filas = minerales.map((m) => {
      const vals = lecturas.map((l) => lecturaNum(l.valores?.[m.clave]));
      const presentes = vals.filter((v): v is number => v != null);
      const prom = presentes.length ? presentes.reduce((a, b) => a + b, 0) / presentes.length : null;
      return [m.nombre, ...vals.map((v) => (v == null ? '—' : n2(v))), prom == null ? '—' : n2(prom)];
    });
    autoTable(doc, {
      startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: CW,
      head: [head], body: [numerosRow, ...filas],
      theme: 'grid',
      headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 7, halign: 'center' },
      styles: { fontSize: 7, cellPadding: 2, halign: 'center' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 110 }, [head.length - 1]: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (data: { section: string; row: { index: number }; cell: { styles: Record<string, unknown> } }) => {
        if (data.section === 'body' && data.row.index === 0) { data.cell.styles.fontStyle = 'italic'; data.cell.styles.textColor = GREY; }
      },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
  }
  return y;
}
