/* ============================================================
   MGG · Auditoría de Usuarios · PDF (vista previa)
   Dos reportes: general (resumen por usuario) y detalle de un usuario
   (sesiones + actividad). Se abren en vista previa (previewPdfDoc).
   ============================================================ */
import { dateTime } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { fmtDuracion, duracionSesionMs, moduloDeTabla, type UserSession, type ActividadEvento } from './auditoria.repository';

const MARGIN = 42.52;

async function nuevoDoc(titulo: string, sub: string) {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl().catch(() => null),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  let y = MARGIN;
  const LOGO = 56;
  const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(titulo, TX, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Mineral Group Guayana C.A.', TX, y + 34);
  doc.setTextColor(90); doc.text(sub, TX, y + 48); doc.setTextColor(0);
  y += Math.max(LOGO, 50) + 10;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 16;
  return { doc, autoTable, y, PAGE_W };
}

function pie(doc: import('jspdf').jsPDF, texto: string) {
  const h = doc.internal.pageSize.getHeight();
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(texto, MARGIN, h - 24);
}

export interface AuditoriaFila {
  nombre: string; email: string; msConectado: number; nSesiones: number; nAcciones: number; ultima: string | null; conectado: boolean;
}
export interface AuditoriaOverviewData {
  desde: string; hasta: string; conectadosAhora: number; filas: AuditoriaFila[];
}

/** Reporte general: resumen por usuario (tiempo conectado + acciones). */
export async function descargarAuditoriaOverviewPdf(data: AuditoriaOverviewData): Promise<void> {
  const { doc, autoTable, y } = await nuevoDoc('Auditoría de Usuarios', `Período ${data.desde} → ${data.hasta} · Conectados ahora: ${data.conectadosAhora} · Generado ${dateTime(new Date().toISOString())}`);
  autoTable(doc, {
    startY: y,
    head: [['Usuario', 'Correo', 'Tiempo conectado', 'Sesiones', 'Acciones', 'Última conexión', 'Estado']],
    body: data.filas.map((f) => [
      f.nombre, f.email, fmtDuracion(f.msConectado), String(f.nSesiones), String(f.nAcciones),
      f.ultima ? dateTime(f.ultima) : '—', f.conectado ? 'Conectado' : '—',
    ]),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  pie(doc, `Auditoría de Usuarios · ${dateTime(new Date().toISOString())}`);
  previewPdfDoc(doc, `auditoria-usuarios-${data.desde}_${data.hasta}.pdf`);
}

export interface AuditoriaUsuarioData {
  nombre: string; email: string; desde: string; hasta: string;
  sesiones: UserSession[]; actividad: ActividadEvento[];
}

/** Reporte de detalle: sesiones + actividad de un usuario. */
export async function descargarAuditoriaUsuarioPdf(data: AuditoriaUsuarioData): Promise<void> {
  const msTotal = data.sesiones.reduce((a, s) => a + duracionSesionMs(s), 0);
  const { doc, autoTable } = await nuevoDoc(`Auditoría · ${data.nombre}`, `${data.email} · Período ${data.desde} → ${data.hasta} · Tiempo conectado ${fmtDuracion(msTotal)} · ${data.actividad.length} acciones`);
  // @ts-expect-error lastAutoTable lo agrega el plugin
  let y = doc.lastAutoTable?.finalY ?? 120;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Sesiones', MARGIN, y + 2);
  autoTable(doc, {
    startY: y + 8,
    head: [['Inicio', 'Fin', 'Duración']],
    body: (data.sesiones.length ? data.sesiones : []).map((s) => [
      dateTime(s.started_at), s.ended_at ? dateTime(s.ended_at) : 'En curso', fmtDuracion(duracionSesionMs(s)),
    ]),
    theme: 'grid', headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 }, columnStyles: { 2: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN, bottom: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = doc.lastAutoTable.finalY + 18;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Actividad', MARGIN, y);
  autoTable(doc, {
    startY: y + 8,
    head: [['Fecha y hora', 'Módulo', 'Acción']],
    body: data.actividad.map((a) => [dateTime(a.ts), moduloDeTabla(a.tabla).modulo, a.accion]),
    theme: 'grid', headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  pie(doc, `Auditoría · ${data.nombre} · ${dateTime(new Date().toISOString())}`);
  previewPdfDoc(doc, `auditoria-${data.email}-${data.desde}_${data.hasta}.pdf`);
}
