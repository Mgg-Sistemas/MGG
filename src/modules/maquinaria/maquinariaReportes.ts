/* ============================================================
   Golden Touch · Control de Maquinaria · reportes
   PDF, Excel y correo del registro de equipos. Mantiene el
   encabezado/estilos estándar (logo, naranja, margen 1.5 cm).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { previewPdf, previewExcel } from '@/shared/lib/reportePreview';
import { anchoLogoPdf, dibujarLogoPdf } from '@/shared/lib/pdfLogo';

const NOMBRE = 'control-maquinaria';
const fmtNum = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('es-VE', { maximumFractionDigits: 2 }));

async function construirEquiposDoc(rows: MaquinariaEquipo[]) {
  const [{ dateTime }, { loadLogoPdfDataUrl }, { jsPDF }, { default: autoTable }] = await Promise.all([
    import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'), import('jspdf'), import('jspdf-autotable'),
  ]);
  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 56.69; // 2 cm por lado
  let y = MARGIN;

  if (logo) { dibujarLogoPdf(doc, logo, MARGIN, y, 46); }
  const tx = logo ? MARGIN + anchoLogoPdf(46) + 12 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Control de Maquinaria y Vehículos · Equipos', tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`MINERAL GROUP GUAYANA C.A. · ${dateTime(new Date().toISOString())} · ${rows.length} equipo(s)`, PAGE_W - MARGIN, y + 16, { align: 'right' });
  y += 54;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 12;

  autoTable(doc, {
    startY: y,
    head: [['Equipo', 'Tipo', 'Propietario', 'Status', 'Ubicación', 'Marca', 'Modelo', 'Serial', 'Comb.', 'Mantt. (h)']],
    body: rows.map((e) => [
      e.equipo, e.tipo ?? '—', e.propietario ?? '—', e.status, e.ubicacion ?? '—',
      e.marca ?? '—', e.modelo ?? '—', e.serial ?? '—', e.combustible ?? '—', fmtNum(e.mantenimiento_cada_hrs),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [255, 138, 0], textColor: 255 },
    styles: { fontSize: 8, cellPadding: 3 },
    margin: MARGIN,
  });
  return doc;
}

export async function descargarEquiposPdf(rows: MaquinariaEquipo[]): Promise<void> {
  previewPdf(await construirEquiposDoc(rows), `${NOMBRE}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function enviarEquiposPorCorreo(rows: MaquinariaEquipo[], destinos: string[]): Promise<{ destinatarios: string[] }> {
  const base64 = (await construirEquiposDoc(rows)).output('datauristring').split(',')[1] ?? '';
  const { data, error } = await supabase.functions.invoke<{ ok: true; destinatarios: string[] } | { error: string }>('enviar-reporte', {
    body: {
      modulo: 'maquinaria',
      pdf_base64: base64,
      nombre_archivo: `${NOMBRE}-${new Date().toISOString().slice(0, 10)}.pdf`,
      asunto: 'Control de Maquinaria y Vehículos · Equipos',
      mensaje: `Registro de equipos de maquinaria (${rows.length}).`,
      to_emails: destinos,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}

export async function descargarEquiposExcel(rows: MaquinariaEquipo[]): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
    writeFile: (wb: unknown, name: string) => void;
  };
  const HEADER_STYLE = {
    font: { name: 'Arial', sz: 12, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
    alignment: { horizontal: 'left', vertical: 'center' },
  };
  const head = ['Equipo', 'Tipo', 'Propietario', 'Status', 'Ubicación', 'Año', 'Marca', 'Modelo', 'Color', 'Serial', 'Placa', 'Combustible', 'Litros', 'Mantt. (h)', 'Combustible vinculado'];
  const filas = rows.map((e) => [
    e.equipo, e.tipo ?? '', e.propietario ?? '', e.status, e.ubicacion ?? '', e.anio ?? '',
    e.marca ?? '', e.modelo ?? '', e.color ?? '', e.serial ?? '', e.placa ?? '',
    e.combustible ?? '', e.litros_consume ?? '', e.mantenimiento_cada_hrs ?? '', e.combustible_equipo ?? '',
  ]);
  const aoa: unknown[][] = [
    [`CONTROL DE MAQUINARIA · MINERAL GROUP GUAYANA C.A.`],
    [`${rows.length} equipo(s)`],
    [],
    head,
    ...filas,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = head.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: head.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: head.length - 1 } },
  ];
  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c })];
  const titulo = cellAt(0, 0); if (titulo) titulo.s = { ...HEADER_STYLE, font: { ...HEADER_STYLE.font, sz: 14 } };
  head.forEach((_, c) => { const cell = cellAt(3, c); if (cell) cell.s = HEADER_STYLE; });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Equipos');
  previewExcel(wb, `${NOMBRE}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
