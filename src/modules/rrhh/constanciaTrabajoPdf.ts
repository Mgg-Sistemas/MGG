/* ============================================================
   MGG · RRHH · Constancia de Trabajo (PDF, vista previa)
   Carta formal que certifica que el trabajador presta servicios
   en la empresa (cargo, fecha de ingreso y —opcional— sueldo).
   Se genera solo por botón, en vista previa.
   ============================================================ */
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { money } from '@/shared/lib/format';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { Personal } from '@/shared/lib/types';

const EMPRESA = 'Mineral Group Guayana C.A.';
const RIF = 'J-50221930-7';
const CIUDAD = 'Puerto Ordaz, Estado Bolívar';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'YYYY-MM-DD' → '20 de marzo de 2026' (sin sustos de zona horaria). '' si no hay fecha. */
function fechaLarga(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}
/** Fecha de emisión (hoy) en formato largo. */
function hoyLarga(): string {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export interface ConstanciaOpts {
  incluirSalario?: boolean;   // incluir el sueldo mensual en el texto (default true)
  dirigidoA?: string;         // "A quien pueda interesar" por defecto
  lugar?: string;             // lugar de emisión (default Puerto Ordaz)
}

export async function descargarConstanciaTrabajoPdf(persona: Personal, opts: ConstanciaOpts = {}): Promise<void> {
  const { incluirSalario = true, dirigidoA = 'A quien pueda interesar', lugar = CIUDAD } = opts;
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), loadLogoDataUrl().catch(() => null)]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 56.7; // 2 cm
  const CW = PAGE_W - MARGIN * 2;
  let y = MARGIN;

  // ── Encabezado: logo + empresa + RIF ──
  const LOGO = 56;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* logo opcional */ } }
  const tx = logo ? MARGIN + LOGO + 14 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20);
  doc.text(EMPRESA, tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text(`RIF: ${RIF}`, tx, y + 34);
  doc.text('Departamento de Recursos Humanos', tx, y + 48);
  doc.setTextColor(0);
  y += Math.max(LOGO, 48) + 12;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 26;

  // ── Lugar y fecha (derecha) ──
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  doc.text(`${lugar}, ${hoyLarga()}`, PAGE_W - MARGIN, y, { align: 'right' });
  y += 34;

  // ── Título ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('CONSTANCIA DE TRABAJO', PAGE_W / 2, y, { align: 'center' });
  y += 12;
  doc.setDrawColor(180); doc.setLineWidth(0.6);
  doc.line(PAGE_W / 2 - 96, y, PAGE_W / 2 + 96, y);
  y += 30;

  // ── Dirigido a ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(`${dirigidoA}:`, MARGIN, y);
  y += 26;

  // ── Cuerpo ──
  const nombre = `${persona.nombre ?? ''} ${persona.apellido ?? ''}`.trim().toUpperCase();
  const cedula = (persona.cedula ?? '').trim();
  const cargo = (persona.cargo ?? '').trim();
  const depto = (persona.departamento ?? '').trim();
  const ingreso = fechaLarga(persona.fecha_ingreso);
  const sueldoN = Number(persona.sueldo_base) || 0;

  let cuerpo = `Por medio de la presente, ${EMPRESA}, RIF ${RIF}, hace constar que el(la) ciudadano(a) ${nombre}`;
  cuerpo += cedula ? `, titular de la cédula de identidad N° ${cedula},` : ',';
  cuerpo += ' presta sus servicios en esta empresa';
  if (ingreso) cuerpo += ` desde el ${ingreso}`;
  if (cargo) cuerpo += `, desempeñando el cargo de ${cargo}`;
  if (depto) cuerpo += ` en el área de ${depto}`;
  if (incluirSalario && sueldoN > 0) cuerpo += `, devengando un sueldo mensual de ${money(sueldoN)}`;
  cuerpo += '.';

  const cierre = `Constancia que se expide a solicitud de la parte interesada, en ${lugar}, a los ${hoyLarga()}.`;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11.5);
  const LH = 18;
  doc.setLineHeightFactor(LH / 11.5); // el render y el avance de y usan el mismo interlineado
  const parrafo = doc.splitTextToSize(cuerpo, CW) as string[];
  doc.text(parrafo, MARGIN, y, { align: 'justify', maxWidth: CW });
  y += parrafo.length * LH + 20;
  const parrafo2 = doc.splitTextToSize(cierre, CW) as string[];
  doc.text(parrafo2, MARGIN, y, { align: 'justify', maxWidth: CW });
  y += parrafo2.length * LH + 8;
  doc.setLineHeightFactor(1.15); // restaurar por si acaso

  // ── Firma y sello (bloque inferior) ──
  // Se reserva un espacio en blanco (SELLO_ESPACIO) por encima de la línea de firma
  // para la firma manuscrita y el sello húmedo de la Jefa de Recursos Humanos.
  const cx = PAGE_W / 2;
  const SELLO_ESPACIO = 84;                         // alto en blanco para firma + sello
  // Ancla el bloque cerca del pie, dejando el espacio de sello sobre la línea.
  const fy = Math.min(PAGE_H - MARGIN - 52, Math.max(y + SELLO_ESPACIO + 24, PAGE_H - 170));

  // Caption tenue del recuadro de sello (guía, no imprime borde).
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(150);
  doc.text('(Espacio para firma y sello)', cx, fy - SELLO_ESPACIO + 10, { align: 'center' });
  doc.setTextColor(0);

  // Línea de firma.
  doc.setDrawColor(120); doc.setLineWidth(0.7);
  doc.line(cx - 120, fy, cx + 120, fy);
  // Cargo (sin nombre): lo firma la Jefa de Recursos Humanos.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Jefa de Recursos Humanos', cx, fy + 17, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  doc.text(`${EMPRESA} · RIF ${RIF}`, cx, fy + 31, { align: 'center' });
  doc.setTextColor(0);

  // ── Pie ──
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Documento generado por el sistema · válido con sello y firma autorizada.', MARGIN, PAGE_H - MARGIN + 18);

  const base = `constancia-trabajo-${nombre}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  previewPdfDoc(doc, `${base}.pdf`);
}
