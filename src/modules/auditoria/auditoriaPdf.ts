/* ============================================================
   MGG · Auditoría de Usuarios · PDF (vista previa)
   Dos reportes: general (resumen por usuario) y detalle de un usuario
   (sesiones + actividad). Se abren en vista previa (previewPdfDoc).
   ============================================================ */
import { dateTime } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { fmtDuracion, duracionSesionMs, moduloDeTabla, queHizo, type UserSession, type ActividadEvento } from './auditoria.repository';

const MARGIN = MARGEN_PDF; // 2 cm por lado
/** Línea reservada sobre el margen inferior para el pie de página. */
const ALTO_PIE = 14;
/** Márgenes de las tablas: 2 cm y, abajo, además el renglón del pie. */
const MARGENES_TABLA = { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + ALTO_PIE };

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
  // El subtítulo se parte para no pasar del margen derecho (2 cm).
  const subLineas = doc.splitTextToSize(sub, PAGE_W - MARGIN - TX) as string[];
  doc.setTextColor(90); doc.text(subLineas, TX, y + 48); doc.setTextColor(0);
  y += Math.max(LOGO, 50 + (subLineas.length - 1) * 12) + 10;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 16;
  return { doc, autoTable, y, PAGE_W };
}

function pie(doc: import('jspdf').jsPDF, texto: string) {
  const h = doc.internal.pageSize.getHeight();
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(texto, MARGIN, limiteInferiorPdf(h));
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
    margin: MARGENES_TABLA,
  });
  pie(doc, `Auditoría de Usuarios · ${dateTime(new Date().toISOString())}`);
  previewPdfDoc(doc, `auditoria-usuarios-${data.desde}_${data.hasta}.pdf`);
}

export interface AuditoriaMovimientosUsuario {
  nombre: string; email: string; msConectado: number; eventos: ActividadEvento[];
}
export interface AuditoriaMovimientosData {
  desde: string; hasta: string; usuarios: AuditoriaMovimientosUsuario[];
}

/** Reporte POR USUARIO con TODOS los movimientos (fecha y hora · módulo · acción). */
export async function descargarAuditoriaMovimientosPdf(data: AuditoriaMovimientosData): Promise<void> {
  const totalMov = data.usuarios.reduce((a, u) => a + u.eventos.length, 0);
  const { doc, autoTable, y, PAGE_W } = await nuevoDoc('Auditoría · Movimientos por Usuario', `Período ${data.desde} → ${data.hasta} · ${data.usuarios.length} usuario(s) · ${totalMov} movimiento(s) · Generado ${dateTime(new Date().toISOString())}`);
  let cursorY = y;
  const usuarios = data.usuarios.filter((u) => u.eventos.length > 0);
  if (!usuarios.length) {
    doc.setFontSize(11); doc.text('Sin movimientos en el período.', MARGIN, cursorY + 10);
  }
  usuarios.forEach((u, idx) => {
    // Encabezado del usuario (con salto de página si no cabe).
    if (idx > 0 && cursorY > limiteInferiorPdf(doc.internal.pageSize.getHeight()) - 80) { doc.addPage(); cursorY = MARGIN + 10; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20);
    doc.text(`${u.nombre}`, MARGIN, cursorY + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(`${u.email} · ${fmtDuracion(u.msConectado)} conectado · ${u.eventos.length} movimiento(s)`, MARGIN, cursorY + 18);
    doc.setTextColor(0);
    doc.setDrawColor(230); doc.setLineWidth(0.5); doc.line(MARGIN, cursorY + 24, PAGE_W - MARGIN, cursorY + 24);
    autoTable(doc, {
      startY: cursorY + 30,
      head: [['Fecha y hora', 'Módulo', 'Acción', 'Qué']],
      body: u.eventos.map((a) => [dateTime(a.ts), moduloDeTabla(a.tabla).modulo, a.accion, queHizo(a)]),
      theme: 'grid', headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 8.5 },
      styles: { fontSize: 8, cellPadding: 2.5 },
      margin: MARGENES_TABLA,
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    cursorY = doc.lastAutoTable.finalY + 24;
  });
  pie(doc, `Auditoría · Movimientos por Usuario · ${dateTime(new Date().toISOString())}`);
  previewPdfDoc(doc, `auditoria-movimientos-${data.desde}_${data.hasta}.pdf`);
}

export interface AuditoriaUsuarioData {
  nombre: string; email: string; desde: string; hasta: string;
  sesiones: UserSession[]; actividad: ActividadEvento[];
}

/** Reporte de detalle: sesiones + actividad de un usuario. */
export async function descargarAuditoriaUsuarioPdf(data: AuditoriaUsuarioData): Promise<void> {
  const msTotal = data.sesiones.reduce((a, s) => a + duracionSesionMs(s), 0);
  const { doc, autoTable, y: yInicio } = await nuevoDoc(`Auditoría · ${data.nombre}`, `${data.email} · Período ${data.desde} → ${data.hasta} · Tiempo conectado ${fmtDuracion(msTotal)} · ${data.actividad.length} acciones`);
  // Arranca debajo del encabezado (con el margen de 2 cm ya no cabe en un valor fijo).
  let y = yInicio;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Sesiones', MARGIN, y + 2);
  autoTable(doc, {
    startY: y + 8,
    head: [['Inicio', 'Fin', 'Duración']],
    body: (data.sesiones.length ? data.sesiones : []).map((s) => [
      dateTime(s.started_at), s.ended_at ? dateTime(s.ended_at) : 'En curso', fmtDuracion(duracionSesionMs(s)),
    ]),
    theme: 'grid', headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 }, columnStyles: { 2: { halign: 'right' } },
    margin: MARGENES_TABLA,
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = doc.lastAutoTable.finalY + 18;
  // Que el título no quede solo al filo de la hoja.
  if (y + 40 > limiteInferiorPdf(doc.internal.pageSize.getHeight()) - ALTO_PIE) { doc.addPage(); y = MARGIN + 10; }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Actividad', MARGIN, y);
  autoTable(doc, {
    startY: y + 8,
    head: [['Fecha y hora', 'Módulo', 'Acción', 'Qué']],
    body: data.actividad.map((a) => [dateTime(a.ts), moduloDeTabla(a.tabla).modulo, a.accion, queHizo(a)]),
    theme: 'grid', headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 },
    margin: MARGENES_TABLA,
  });
  pie(doc, `Auditoría · ${data.nombre} · ${dateTime(new Date().toISOString())}`);
  previewPdfDoc(doc, `auditoria-${data.email}-${data.desde}_${data.hasta}.pdf`);
}
