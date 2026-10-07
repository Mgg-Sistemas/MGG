/* ============================================================
   MGG · Asignaciones · Autorización de circulación (PDF · vista previa)

   La asignación de un vehículo es la autorización para que esa persona
   transite en él. Este es el papel que se lleva en el vehículo: datos de
   la empresa, del conductor y del vehículo, la vigencia y dos firmas A
   MANO (por la empresa / el conductor). Mismo estilo que los demás PDF.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import { date as fmtDate } from '@/shared/lib/format';
import { MARGEN_PDF, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { EMISOR_NOTA } from '@/modules/documentacion/notaEnvio';
import type { Asignacion, Personal } from '@/shared/lib/types';
import type { VehiculoBase } from './vehiculos';
import { labelTipoVehiculo, normalizarPlaca } from './vehiculos';

const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS: [number, number, number] = [120, 120, 120];
const TINTA: [number, number, number] = [30, 30, 30];

export async function verAutorizacionVehiculoPdf(a: Asignacion, persona: Personal | null, v: VehiculoBase | null): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl().catch(() => null),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  let y = M;

  // Encabezado del sistema.
  const LOGO = 58;
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y, LOGO, LOGO); } catch { /* opcional */ } }
  const tx = logo ? M + LOGO + 16 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 90, 0);
  doc.text(textoPdf(EMISOR_NOTA.razonSocial), tx, y + 14);
  doc.setTextColor(20); doc.setFontSize(16);
  doc.text(textoPdf('Autorización de circulación'), tx, y + 36);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
  doc.text(textoPdf(`RIF ${EMISOR_NOTA.rif} · ${EMISOR_NOTA.domicilio}`), tx, y + 52, { maxWidth: W - M - tx });
  doc.setTextColor(0);
  y += LOGO + 14;
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.5); doc.line(M, y, W - M, y);
  y += 22;

  const nombre = persona ? `${persona.nombre} ${persona.apellido ?? ''}`.trim() : '—';
  const cedula = persona?.cedula ?? '—';
  const cargo = persona?.cargo ?? '';
  const vigencia = a.autorizacion_hasta ? `hasta el ${fmtDate(a.autorizacion_hasta)}` : 'mientras el vehículo esté asignado a su persona';
  const descVehiculo = v
    ? [`${v.marca ?? ''} ${v.modelo ?? ''}`.trim(), v.anio ? `año ${v.anio}` : '', v.color ? `color ${v.color}` : '', `placa ${normalizarPlaca(v.placa)}`].filter(Boolean).join(', ')
    : a.descripcion;

  // Cuerpo.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...TINTA);
  const parrafo = `${EMISOR_NOTA.razonSocial}, inscrita en el Registro de Información Fiscal bajo el N° ${EMISOR_NOTA.rif}, `
    + `por medio de la presente AUTORIZA al ciudadano(a) ${nombre.toUpperCase()}, titular de la cédula de identidad N° ${cedula}`
    + `${cargo ? `, quien se desempeña como ${cargo}` : ''}, a conducir y transitar en el vehículo ${descVehiculo}, `
    + `asignado a su persona desde el ${fmtDate(a.fecha_asignacion)}, ${vigencia}.`;
  const lineas = doc.splitTextToSize(textoPdf(parrafo), W - 2 * M) as string[];
  doc.text(lineas, M, y, { lineHeightFactor: 1.5 });
  y += lineas.length * 10.5 * 1.5 + 14;

  // Datos del conductor y del vehículo, en dos tablas.
  const bw = (W - 2 * M - 14) / 2;
  const tabla = (x: number, titulo: string, filas: Array<[string, string]>) => {
    autoTable(doc, {
      startY: y, tableWidth: bw, margin: { left: x, right: W - x - bw },
      head: [[{ content: titulo, colSpan: 2 }]], body: filas.map(([k, v2]) => [k, v2 || '—']),
      theme: 'grid',
      headStyles: { fillColor: NARANJA, textColor: 255, fontStyle: 'bold', fontSize: 8.5, halign: 'left', lineColor: [60, 60, 60], lineWidth: 0.75 },
      styles: { fontSize: 8.5, cellPadding: 4, lineColor: [60, 60, 60], lineWidth: 0.75, textColor: 20, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 82, fontStyle: 'bold', fillColor: [246, 246, 246] } },
    });
    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  };
  const y1 = tabla(M, 'CONDUCTOR AUTORIZADO', [
    ['Nombre', nombre], ['Cédula', cedula], ['Cargo', cargo], ['Departamento', persona?.departamento ?? ''],
  ]);
  const y2 = tabla(M + bw + 14, 'VEHÍCULO', [
    ['Tipo', v ? labelTipoVehiculo(v.tipo) : ''], ['Marca / modelo', v ? `${v.marca ?? ''} ${v.modelo ?? ''}`.trim() : a.descripcion],
    ['Año / color', v ? [v.anio ? String(v.anio) : '', v.color ?? ''].filter(Boolean).join(' · ') : ''],
    ['Placa', v ? normalizarPlaca(v.placa) : (a.serial ?? '')],
    ['Serial carrocería', v?.serial_carroceria ?? ''], ['Serial motor', v?.serial_motor ?? ''],
  ]);
  y = Math.max(y1, y2) + 16;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...TINTA);
  const cond = 'El conductor se compromete a usar el vehículo únicamente para las labores de la empresa, a cumplir las normas de tránsito, '
    + 'a mantenerlo en buen estado y a devolverlo cuando la empresa lo requiera. Esta autorización pierde vigencia al registrarse la devolución del vehículo.'
    + (a.observaciones ? ` Observaciones: ${a.observaciones}` : '');
  const condL = doc.splitTextToSize(textoPdf(cond), W - 2 * M) as string[];
  doc.text(condL, M, y, { lineHeightFactor: 1.4 });
  y += condL.length * 9 * 1.4 + 10;
  doc.setFontSize(8.5); doc.setTextColor(...GRIS);
  doc.text(textoPdf(`Emitida el ${fmtDate(new Date().toISOString())} · Asignación del ${fmtDate(a.fecha_asignacion)}`), M, y);

  // Firmas a mano.
  const fy = Math.max(y + 90, limiteInferiorPdf(H) - 46);
  const ancho = (W - 2 * M - 40) / 2;
  doc.setDrawColor(...GRIS); doc.setLineWidth(0.6);
  doc.line(M, fy, M + ancho, fy);
  doc.line(W - M - ancho, fy, W - M, fy);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(20);
  doc.text(textoPdf('Por la empresa'), M + ancho / 2, fy + 13, { align: 'center' });
  doc.text(textoPdf(nombre), W - M - ancho / 2, fy + 13, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
  doc.text(textoPdf('Firma y sello'), M + ancho / 2, fy + 25, { align: 'center' });
  doc.text(textoPdf(`Conductor autorizado · C.I. ${cedula}`), W - M - ancho / 2, fy + 25, { align: 'center' });

  previewPdfDoc(doc, `autorizacion-vehiculo-${v ? normalizarPlaca(v.placa) : 'asignacion'}.pdf`);
}
