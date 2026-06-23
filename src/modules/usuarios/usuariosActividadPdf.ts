/* ============================================================
   MGG · Usuarios · PDF del Resumen de Actividad
   Vista previa (previewPdfDoc) + envío por correo (Edge Function).
   ============================================================ */
import { dateTime } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';

export interface ActividadFila {
  nombre: string;
  email: string;
  sesiones: number;
  minutos: number;
  ultima: string;
  conectado: boolean;
}

export interface ActividadPdfData {
  desde: string;
  hasta: string;
  conectadosAhora: number;
  filas: ActividadFila[];
}

const MARGIN = 42.52; // 1,5 cm

/** Minutos → "Xh Ym" (o "Ym" si <1h). */
export function fmtDuracionMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
}

async function construirDoc(data: ActividadPdfData) {
  const [{ jsPDF }, { default: autoTable }, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl().catch(() => null),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  const LOGO_SIZE = 56;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE); } catch { /* logo opcional */ } }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Resumen de Actividad de Usuarios', TEXT_X, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Mineral Group Guayana C.A. · Período ${data.desde} → ${data.hasta}`, TEXT_X, y + 36);
  doc.text(`Conectados ahora: ${data.conectadosAhora} · Generado ${dateTime(new Date().toISOString())}`, TEXT_X, y + 50);
  y += Math.max(LOGO_SIZE, 50) + 10;

  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 16;

  autoTable(doc, {
    startY: y,
    head: [['Usuario', 'Correo', 'Sesiones', 'Tiempo total', 'Última conexión', 'Estado']],
    body: data.filas.map((f) => [
      f.nombre,
      f.email,
      String(f.sesiones),
      fmtDuracionMin(f.minutos),
      dateTime(f.ultima),
      f.conectado ? 'Conectado' : '—',
    ]),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Documento auto-generado · Resumen de Actividad · ${dateTime(new Date().toISOString())}`, MARGIN, pageH - 24);
  return doc;
}

export async function descargarActividadPdf(data: ActividadPdfData): Promise<void> {
  const doc = await construirDoc(data);
  previewPdfDoc(doc, `resumen-actividad-${data.desde}_${data.hasta}.pdf`);
}

export async function enviarActividadPorCorreo(data: ActividadPdfData, destinos: string[]): Promise<string[]> {
  const { supabase } = await import('@/shared/lib/supabase');
  const doc = await construirDoc(data);
  const base64 = doc.output('datauristring').split(',')[1] ?? '';
  const { data: res, error } = await supabase.functions.invoke<{ ok: true; destinatarios: string[] } | { error: string }>('enviar-reporte', {
    body: {
      pdf_base64: base64,
      nombre_archivo: `resumen-actividad-${data.desde}_${data.hasta}.pdf`,
      asunto: `Resumen de Actividad de Usuarios · ${data.desde} → ${data.hasta}`,
      mensaje: `Resumen de actividad (sesiones y tiempo de conexión) del ${data.desde} al ${data.hasta}.`,
      to_emails: destinos,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!res || 'error' in res) throw new Error((res as { error?: string })?.error || 'Respuesta inválida');
  return res.destinatarios;
}
