/* ============================================================
   MGG · RRHH · Solicitud de Permiso Laboral (PDF, 20-11-2026)

   Formato corporativo oficial de permisos laborales: membrete con logo,
   razón social de la empresa elegida (MGG, GT, MTO…), fecha y ciudad,
   tablas estructuradas de datos del trabajador y detalles del permiso,
   compromiso del trabajador debidamente justificado y firmas con nombre,
   apellido y cédula de identidad del solicitante.
   Todo el texto pasa por textoPdf() antes de llegar a jsPDF.
   ============================================================ */
import type { jsPDF } from 'jspdf';
import { isoAVe } from '@/shared/lib/fechaVe';
import { textoPdf } from '@/shared/lib/textoPdf';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { definicionEmpresa, type DefinicionEmpresa } from './empresa';
import { COMPROMISO_TRABAJADOR, contenidoSolicitudPermiso, type SolicitudPermisoForm } from './permisoLaboral';

const CIUDAD = 'Puerto Ordaz, Estado Bolívar';

const NARANJA: [number, number, number] = [217, 83, 30];        // #d9531e
const NARANJA_VIVO: [number, number, number] = [255, 138, 0];   // #ff8a00
const NARANJA_FONDO: [number, number, number] = [255, 251, 245];// #fffbf5
const BORDE_AMBER: [number, number, number] = [254, 215, 170];  // #fed7aa
const GRIS_TEXTO: [number, number, number] = [100, 116, 139];   // #64748b
const TINTA: [number, number, number] = [15, 23, 42];           // #0f172a
const BORDE: [number, number, number] = [226, 232, 240];        // #e2e8f0
const FONDO_ENCABEZADO: [number, number, number] = [248, 250, 252]; // #f8fafc

function slug(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Arma el doc sin descargarlo: el repositorio lo sube al Storage o lo previsualiza. */
export async function construirSolicitudPermisoPdf(
  solicitud: SolicitudPermisoForm,
  empresa: DefinicionEmpresa | string,
): Promise<jsPDF> {
  const [{ jsPDF: Pdf }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl().catch(() => null),
  ]);
  const def = typeof empresa === 'string' ? definicionEmpresa(empresa) : empresa;

  // Validación de consistencia del contenido
  contenidoSolicitudPermiso(solicitud, def);

  const doc = new Pdf({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const CW = anchoUtilPdf(W);
  const LIMITE = limiteInferiorPdf(H);
  let y = M;

  function salto(alto: number): void {
    if (y + alto < LIMITE - 60) return;
    doc.addPage();
    y = M;
  }

  function tituloSeccion(texto: string): void {
    salto(32);
    // Fondo gris suave con borde sutil
    doc.setFillColor(...FONDO_ENCABEZADO);
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.6);
    doc.roundedRect(M, y, CW, 19, 2, 2, 'FD');

    // Barra vertical naranja izquierda
    doc.setFillColor(...NARANJA_VIVO);
    doc.rect(M, y, 3.5, 19, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...NARANJA);
    doc.text(textoPdf(texto), M + 10, y + 13);
    y += 24;
  }

  // ── Membrete corporativo ──
  const LOGO_SIZE = 48;
  if (logo) {
    try { doc.addImage(logo, 'JPEG', M, y - 2, LOGO_SIZE, LOGO_SIZE); } catch { /* logo opcional */ }
  }
  const tx = logo ? M + LOGO_SIZE + 14 : M;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...NARANJA);
  doc.text(textoPdf(def.razonSocial), tx, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS_TEXTO);
  if (def.rif) doc.text(textoPdf(`RIF: ${def.rif}`), tx, y + 25);
  doc.text('Departamento de Recursos Humanos', tx, y + 37);

  // Ubicación y fecha a la derecha del membrete
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS_TEXTO);
  doc.text(textoPdf(CIUDAD), W - M, y + 12, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...TINTA);
  doc.text(textoPdf(`Fecha: ${isoAVe(solicitud.fecha_solicitud) || '—'}`), W - M, y + 25, { align: 'right' });

  y += Math.max(LOGO_SIZE, 42) + 8;
  doc.setDrawColor(...NARANJA_VIVO);
  doc.setLineWidth(1.5);
  doc.line(M, y, W - M, y);
  y += 18;

  // ── Título del documento ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...TINTA);
  doc.text('SOLICITUD DE PERMISO LABORAL', W / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(...NARANJA_VIVO);
  doc.setLineWidth(1.2);
  doc.line(W / 2 - 110, y, W / 2 + 110, y);
  y += 18;

  // ── 1. Datos del trabajador (tabla estructurada de 4 columnas) ──
  tituloSeccion('DATOS DEL TRABAJADOR');
  const t = solicitud.trabajador;
  const nombreCompleto = `${t.nombre ?? ''} ${t.apellido ?? ''}`.trim().toUpperCase() || '—';
  const cedula = t.cedula?.trim() || '—';
  const cargo = t.cargo?.trim() || '—';
  const depto = t.departamento?.trim() || '—';
  const telefono = t.telefono?.trim() || '—';

  const filasTrabajador: any[][] = [
    [
      'Nombre y apellido:',
      { content: nombreCompleto, styles: { fontStyle: 'bold', textColor: TINTA } },
      'Cédula de identidad:',
      { content: cedula, styles: { fontStyle: 'bold', textColor: TINTA } },
    ],
    [
      'Cargo actual:',
      cargo,
      'Departamento / Área:',
      depto,
    ],
    [
      'Teléfono de contacto:',
      telefono,
      'Empresa / Nómina:',
      def.razonSocial,
    ],
  ];

  autoTable(doc as any, {
    startY: y,
    body: filasTrabajador.map((fila) => fila.map((c: any) => typeof c === 'string' ? textoPdf(c) : { ...c, content: textoPdf(c.content) })),
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 4.5, bottom: 4.5, left: 6, right: 6 },
      textColor: TINTA,
      lineColor: BORDE,
      lineWidth: 0.5,
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: 105, fillColor: FONDO_ENCABEZADO, textColor: GRIS_TEXTO, fontStyle: 'bold' },
      1: { cellWidth: 145 },
      2: { cellWidth: 110, fillColor: FONDO_ENCABEZADO, textColor: GRIS_TEXTO, fontStyle: 'bold' },
      3: { cellWidth: 'auto' },
    },
    margin: MARGENES_TABLA_PDF,
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 14;

  // ── 2. Detalles del permiso (tabla estructurada) ──
  tituloSeccion('DETALLES DEL PERMISO');
  const fInicio = isoAVe(solicitud.fecha_inicio) || '—';
  const fFin = isoAVe(solicitud.fecha_fin) || '—';
  const tiempo = solicitud.tiempo_solicitado?.trim() || '—';
  const horario = solicitud.horario?.trim() || 'Jornada completa habitual';

  const filasPermiso: any[][] = [
    [
      'Fecha de inicio:',
      { content: fInicio, styles: { fontStyle: 'bold' } },
      'Fecha de culminación:',
      { content: fFin, styles: { fontStyle: 'bold' } },
    ],
    [
      'Tiempo solicitado:',
      { content: tiempo, styles: { fontStyle: 'bold', textColor: NARANJA } },
      'Horario específico:',
      horario,
    ],
    [
      'Motivo de la ausencia:',
      {
        content: solicitud.motivo?.trim() || '—',
        colSpan: 3,
        styles: { cellPadding: { top: 6, bottom: 6, left: 6, right: 6 } },
      },
    ],
  ];

  autoTable(doc as any, {
    startY: y,
    body: filasPermiso.map((fila) => fila.map((c: any) => typeof c === 'string' ? textoPdf(c) : { ...c, content: textoPdf(c.content) })),
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 4.5, bottom: 4.5, left: 6, right: 6 },
      textColor: TINTA,
      lineColor: BORDE,
      lineWidth: 0.5,
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: 105, fillColor: FONDO_ENCABEZADO, textColor: GRIS_TEXTO, fontStyle: 'bold' },
      1: { cellWidth: 145 },
      2: { cellWidth: 110, fillColor: FONDO_ENCABEZADO, textColor: GRIS_TEXTO, fontStyle: 'bold' },
      3: { cellWidth: 'auto' },
    },
    margin: MARGENES_TABLA_PDF,
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 14;

  // ── 3. Compromiso del trabajador (justificado y enmarcado) ──
  tituloSeccion('COMPROMISO DEL TRABAJADOR');
  const textoCompromiso = textoPdf(solicitud.compromiso || COMPROMISO_TRABAJADOR);
  const anchoCompromiso = CW - 24;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const lineasCompromiso = doc.splitTextToSize(textoCompromiso, anchoCompromiso) as string[];
  const altoLineas = 13.5;
  const altoBox = Math.max(48, lineasCompromiso.length * altoLineas + 18);

  salto(altoBox + 10);
  // Tarjeta con fondo cálido suave y borde sutil
  doc.setFillColor(...NARANJA_FONDO);
  doc.setDrawColor(...BORDE_AMBER);
  doc.setLineWidth(0.6);
  doc.roundedRect(M, y, CW, altoBox, 3, 3, 'FD');

  // Franja vertical naranja de acento
  doc.setFillColor(...NARANJA_VIVO);
  doc.rect(M, y, 3.5, altoBox, 'F');

  // Párrafo de compromiso justificado
  doc.setTextColor(...TINTA);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setLineHeightFactor(altoLineas / 9);
  doc.text(lineasCompromiso, M + 12, y + 14, { align: 'justify', maxWidth: anchoCompromiso });
  doc.setLineHeightFactor(1.15);

  y += altoBox + 20;

  // ── 4. Firmas: Trabajador (con nombre, apellido y cédula) y RRHH ──
  salto(95);
  const fy = Math.max(y + 36, LIMITE - 66);
  const colW = 200;
  const xIzq = M + 24;
  const xDer = W - M - colW - 24;
  const cIzq = xIzq + colW / 2;
  const cDer = xDer + colW / 2;

  // Líneas de firma
  doc.setDrawColor(148, 163, 184); // #94a3b8
  doc.setLineWidth(0.8);
  doc.line(xIzq, fy, xIzq + colW, fy);
  doc.line(xDer, fy, xDer + colW, fy);

  // Firma Trabajador
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...TINTA);
  doc.text('Firma del trabajador', cIzq, fy + 14, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(textoPdf(nombreCompleto), cIzq, fy + 26, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRIS_TEXTO);
  const cedulaTexto = t.cedula?.trim() ? `C.I. ${t.cedula.trim()}` : 'C.I.: —';
  doc.text(textoPdf(cedulaTexto), cIzq, fy + 37, { align: 'center' });

  // Firma RRHH
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...TINTA);
  doc.text('Firma de RRHH', cDer, fy + 14, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Departamento de Recursos Humanos', cDer, fy + 26, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRIS_TEXTO);
  doc.text(textoPdf(def.razonSocial), cDer, fy + 37, { align: 'center' });

  // ── Pie de página sutil ──
  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.5);
  doc.line(M, LIMITE - 8, W - M, LIMITE - 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS_TEXTO);
  doc.text(textoPdf(`Documento oficial generado por el sistema · RRHH · ${def.razonSocial}`), M, LIMITE + 3);
  doc.text(textoPdf(`Puerto Ordaz · Solicitud de Permiso Laboral`), W - M, LIMITE + 3, { align: 'right' });

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
