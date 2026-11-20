/* ============================================================
   MGG · RRHH · Solicitud de Permiso Laboral (PDF, 20-11-2026)

   El mismo formulario, con el estilo del sistema: logo, razón social de la
   empresa elegida (MGG, GT, MTO…), raya naranja, secciones y dos firmas.
   Todo el texto pasa por textoPdf() antes de llegar a jsPDF.
   ============================================================ */
import type { jsPDF } from 'jspdf';
import { isoAVe } from '@/shared/lib/fechaVe';
import { textoPdf } from '@/shared/lib/textoPdf';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { MARGEN_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { definicionEmpresa, type DefinicionEmpresa } from './empresa';
import { contenidoSolicitudPermiso, type SolicitudPermisoForm } from './permisoLaboral';

const CIUDAD = 'Puerto Ordaz, Estado Bolívar';

function slug(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Arma el doc sin descargarlo: el repositorio lo sube al Storage. */
export async function construirSolicitudPermisoPdf(
  solicitud: SolicitudPermisoForm,
  empresa: DefinicionEmpresa | string,
): Promise<jsPDF> {
  const [{ jsPDF: Pdf }, logo] = await Promise.all([
    import('jspdf'),
    loadLogoDataUrl().catch(() => null),
  ]);
  const def = typeof empresa === 'string' ? definicionEmpresa(empresa) : empresa;
  // La misma información que valida el formulario; acá solo se pinta.
  contenidoSolicitudPermiso(solicitud, def);

  const doc = new Pdf({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const CW = anchoUtilPdf(W);
  const LIMITE = limiteInferiorPdf(H);
  let y = M;

  function salto(alto: number): void {
    if (y + alto < LIMITE - 70) return;
    doc.addPage();
    y = M;
  }
  function tituloSeccion(texto: string): void {
    salto(40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(150, 90, 0);
    doc.text(textoPdf(texto), M, y);
    y += 7;
    doc.setDrawColor(255, 138, 0); doc.setLineWidth(0.8);
    doc.line(M, y, M + Math.min(CW, 210), y);
    y += 17;
    doc.setTextColor(0);
  }
  function fila(etiqueta: string, valor: string): void {
    salto(22);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(70);
    doc.text(textoPdf(etiqueta), M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20);
    doc.text(textoPdf(valor?.trim() || '—'), M + 152, y);
    y += 19;
  }
  function parrafo(texto: string, altoLinea = 15): void {
    const lineas = doc.splitTextToSize(textoPdf(texto), CW) as string[];
    salto(lineas.length * altoLinea + 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(20);
    doc.text(lineas, M, y);
    y += lineas.length * altoLinea + 8;
  }

  // ── Membrete ──
  const LOGO = 56;
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y, LOGO, LOGO); } catch { /* logo opcional */ } }
  const tx = logo ? M + LOGO + 14 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 90, 0);
  doc.text(textoPdf(def.razonSocial), tx, y + 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  if (def.rif) doc.text(textoPdf(`RIF: ${def.rif}`), tx, y + 30);
  doc.text('Departamento de Recursos Humanos', tx, y + 44);
  doc.setTextColor(0);
  y += Math.max(LOGO, 48) + 12;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(M, y, W - M, y);
  y += 24;

  // ── Lugar y fecha de solicitud (d/mm/aaaa) ──
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  doc.text(textoPdf(`${CIUDAD} · ${isoAVe(solicitud.fecha_solicitud) || '—'}`), W - M, y, { align: 'right' });
  doc.setTextColor(0);
  y += 26;

  // ── Título ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('SOLICITUD DE PERMISO LABORAL', W / 2, y, { align: 'center' });
  y += 10;
  doc.setDrawColor(180); doc.setLineWidth(0.6);
  doc.line(W / 2 - 130, y, W / 2 + 130, y);
  y += 28;

  // ── Datos del trabajador ──
  tituloSeccion('DATOS DEL TRABAJADOR');
  const t = solicitud.trabajador;
  fila('Nombre y apellido:', `${t.nombre} ${t.apellido}`.trim());
  fila('Cédula:', t.cedula);
  fila('Cargo:', t.cargo);
  fila('Departamento:', t.departamento);
  fila('Teléfono:', t.telefono);
  y += 8;

  // ── Detalles del permiso ──
  tituloSeccion('DETALLES DEL PERMISO');
  fila('Fecha Inicio:', isoAVe(solicitud.fecha_inicio));
  fila('Fecha fin:', isoAVe(solicitud.fecha_fin));
  fila('Tiempo solicitado:', solicitud.tiempo_solicitado);
  if (solicitud.horario?.trim()) fila('Horario (si aplica):', solicitud.horario);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(70);
  doc.text('Motivo de la Ausencia:', M, y);
  y += 16;
  parrafo(solicitud.motivo);
  y += 4;

  // ── Compromiso ──
  tituloSeccion('COMPROMISO DEL TRABAJADOR');
  parrafo(solicitud.compromiso);

  // ── Firmas (se firma a mano al imprimir) ──
  salto(96);
  const fy = Math.max(y + 34, LIMITE - 58);
  doc.setDrawColor(120); doc.setLineWidth(0.7);
  doc.line(M, fy, M + 220, fy);
  doc.line(W - M - 220, fy, W - M, fy);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20);
  doc.text('Firma del trabajador', M + 110, fy + 17, { align: 'center' });
  doc.text('Firma de RRHH', W - M - 110, fy + 17, { align: 'center' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Documento generado por el sistema · RRHH', M, LIMITE);
  return doc;
}

/** Vista previa (nunca descarga sola), igual que los demás PDF del sistema. */
export async function verSolicitudPermisoPdf(
  solicitud: SolicitudPermisoForm,
  empresa: DefinicionEmpresa | string,
): Promise<void> {
  const doc = await construirSolicitudPermisoPdf(solicitud, empresa);
  const nombre = `${solicitud.trabajador.nombre}-${solicitud.trabajador.apellido}-${solicitud.fecha_inicio}`;
  previewPdfDoc(doc, `solicitud-permiso-${slug(nombre) || 'trabajador'}.pdf`);
}
