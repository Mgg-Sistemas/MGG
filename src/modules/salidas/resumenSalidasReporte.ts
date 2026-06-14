/* ============================================================
   MGG · Salidas · Reporte del Resumen por Unidad Solicitante
   Toma las salidas de material EJECUTADAS y arma el gasto por
   unidad solicitante (gerencia/área). Cada salida vale
   cantidad × precio unitario del inventario (PMP). Exporta a
   PDF, Excel y por correo (Edge Function `enviar-reporte`), solo
   a pedido del usuario (nunca automático).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface SalidaResumenRow {
  fecha: string;        // ISO de la ejecución de la salida
  unidad: string;       // unidad solicitante (destino)
  solicitante: string;  // quién la solicitó
  producto: string;
  cantidad: number;
  unidadMedida?: string | null;
  precioUnit: number;   // $ por unidad (PMP del inventario)
  valor: number;        // cantidad × precioUnit
}

export interface SalidaResumenGrupo {
  unidad: string;
  valor: number;        // $ total de la unidad
  cantidad: number;     // unidades sacadas
  movs: number;         // nº de salidas
}

export interface ResumenSalidasMeta {
  desde?: string;
  hasta?: string;
}

const FUNCTION_SLUG = 'enviar-reporte';

function rangoLabel(meta: ResumenSalidasMeta): string {
  if (meta.desde && meta.hasta) return `Del ${meta.desde} al ${meta.hasta}`;
  if (meta.desde) return `Desde ${meta.desde}`;
  if (meta.hasta) return `Hasta ${meta.hasta}`;
  return 'Todas las fechas';
}

const money = (n: number) => `$ ${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numero = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });

/* ───────────── PDF ───────────── */

async function construirDoc(grupos: SalidaResumenGrupo[], rows: SalidaResumenRow[], meta: ResumenSalidasMeta) {
  const [{ jsPDF }, { default: autoTable }, { dateTime }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm
  let y = MARGIN;

  const LOGO = 56;
  const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* logo opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('RESUMEN DE SALIDAS POR UNIDAD SOLICITANTE', TX, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text(rangoLabel(meta), TX, y + 32);
  doc.text(`Generado: ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 32, { align: 'right' });
  y += Math.max(LOGO, 40) + 8;

  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 14;

  const valorTotal = grupos.reduce((a, g) => a + g.valor, 0);
  const movsTotal = grupos.reduce((a, g) => a + g.movs, 0);

  doc.setFontSize(9);
  doc.text('Mineral Group Guayana C.A. · Sistema de Gestión de Inventarios', MARGIN, y);
  doc.text(`Total: ${money(valorTotal)} · ${movsTotal} salida(s)`, PAGE_W - MARGIN, y, { align: 'right' });
  y += 6;

  // Resumen por unidad.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Gasto por unidad solicitante', MARGIN, y + 14); y += 16;
  autoTable(doc, {
    startY: y,
    head: [['Unidad solicitante', 'Salidas', 'Cantidad', 'Valor ($)']],
    body: grupos.map((g) => [g.unidad, String(g.movs), numero(g.cantidad), money(g.valor)]),
    foot: [['TOTAL', String(movsTotal), '', money(valorTotal)]],
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' } },
  });
  // @ts-expect-error lastAutoTable lo añade el plugin en runtime.
  y = (doc.lastAutoTable?.finalY ?? y) + 16;

  // Detalle de movimientos.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Detalle de salidas', MARGIN, y); y += 4;
  autoTable(doc, {
    startY: y + 4,
    head: [['Fecha / hora', 'Unidad', 'Solicitante', 'Producto', 'Cant.', 'Valor ($)']],
    body: rows.map((r) => [
      dateTime(r.fecha), r.unidad, r.solicitante, r.producto,
      `${numero(r.cantidad)}${r.unidadMedida ? ` ${r.unidadMedida}` : ''}`, money(r.valor),
    ]),
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
  });

  return doc;
}

const NOMBRE_PDF = 'resumen-salidas-por-unidad.pdf';

export async function descargarResumenSalidasPdf(grupos: SalidaResumenGrupo[], rows: SalidaResumenRow[], meta: ResumenSalidasMeta): Promise<void> {
  const doc = await construirDoc(grupos, rows, meta);
  doc.save(NOMBRE_PDF);
}

async function obtenerResumenSalidasBase64(grupos: SalidaResumenGrupo[], rows: SalidaResumenRow[], meta: ResumenSalidasMeta): Promise<{ base64: string; nombre: string }> {
  const doc = await construirDoc(grupos, rows, meta);
  const dataUri = doc.output('datauristring');
  return { base64: dataUri.split(',')[1] ?? '', nombre: NOMBRE_PDF };
}

/* ───────────── Excel ───────────── */

const HEADER_STYLE = {
  font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

export async function descargarResumenSalidasExcel(grupos: SalidaResumenGrupo[], rows: SalidaResumenRow[], meta: ResumenSalidasMeta): Promise<void> {
  const [XLSXmod, { dateTime }] = await Promise.all([
    import('xlsx-js-style'),
    import('@/shared/lib/format'),
  ]);
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
    writeFile: (wb: unknown, name: string) => void;
  };

  const valorTotal = grupos.reduce((a, g) => a + g.valor, 0);
  const movsTotal = grupos.reduce((a, g) => a + g.movs, 0);

  // Hoja 1 · Resumen por unidad.
  const headRes = ['Unidad solicitante', 'Salidas', 'Cantidad', 'Valor ($)'];
  const aoaRes: unknown[][] = [
    ['RESUMEN DE SALIDAS POR UNIDAD SOLICITANTE · MGG'],
    [rangoLabel(meta)],
    [],
    headRes,
    ...grupos.map((g) => [g.unidad, g.movs, g.cantidad, g.valor]),
    [],
    ['TOTAL', movsTotal, '', valorTotal],
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(aoaRes);
  (wsRes as Record<string, unknown>)['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 16 }];
  (wsRes as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
  ];
  headRes.forEach((_, c) => { const cell = (wsRes as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r: 3, c })]; if (cell) cell.s = HEADER_STYLE; });

  // Hoja 2 · Detalle.
  const headDet = ['Fecha / hora', 'Unidad solicitante', 'Solicitante', 'Producto', 'Cantidad', 'Unidad', 'Precio unit. ($)', 'Valor ($)'];
  const aoaDet: unknown[][] = [
    headDet,
    ...rows.map((r) => [dateTime(r.fecha), r.unidad, r.solicitante, r.producto, r.cantidad, r.unidadMedida ?? '', r.precioUnit, r.valor]),
  ];
  const wsDet = XLSX.utils.aoa_to_sheet(aoaDet);
  (wsDet as Record<string, unknown>)['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 26 }, { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 14 }];
  headDet.forEach((_, c) => { const cell = (wsDet as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r: 0, c })]; if (cell) cell.s = HEADER_STYLE; });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsRes, 'Por unidad');
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalle');
  XLSX.writeFile(wb, 'resumen-salidas-por-unidad.xlsx');
}

/* ───────────── Correo ───────────── */

export async function enviarResumenSalidasPorCorreo(
  grupos: SalidaResumenGrupo[], rows: SalidaResumenRow[], meta: ResumenSalidasMeta, destinos?: string[] | string,
): Promise<{ destinatarios: string[] }> {
  const { base64, nombre } = await obtenerResumenSalidasBase64(grupos, rows, meta);
  const lista = Array.isArray(destinos) ? destinos : destinos ? [destinos] : [];
  const { data, error } = await supabase.functions.invoke<
    { ok: true; destinatarios: string[] } | { error: string }
  >(FUNCTION_SLUG, {
    body: {
      pdf_base64: base64,
      nombre_archivo: nombre,
      asunto: 'Resumen de salidas por unidad solicitante',
      mensaje: `Resumen de gasto de material por unidad solicitante. ${rangoLabel(meta)}.`,
      to_emails: lista,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}
