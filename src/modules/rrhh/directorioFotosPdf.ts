/* ============================================================
   MGG · RRHH · Directorio de fotos · PDF (una persona DEBAJO de la otra)
   Como el de La Cantera: no es una tabla, es una fila dibujada a mano con la
   foto a la izquierda y nombre, cargo y datos a la derecha. La paginación se
   vigila fila por fila. La foto ya llega recortada (data URL) o nula.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { textoPdf } from '@/shared/lib/textoPdf';
import { identidadEmpresa } from '@/shared/lib/empresa';
import { date as fmtDate } from '@/shared/lib/format';
import type { PersonaDirectorio } from './directorioFotos';

const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS: [number, number, number] = [120, 120, 120];
const GRIS_SUAVE: [number, number, number] = [170, 170, 170];
const TINTA: [number, number, number] = [40, 40, 40];
const FILA_ALTERNA: [number, number, number] = [247, 247, 247];

/** Alto de cada renglón (pt) y tamaño de la foto. */
const ALTO_FILA = 64;
const ANCHO_FOTO = 44;
const ALTO_FOTO = 54;

export interface DatosDirectorioPdf {
  personas: PersonaDirectorio[];
  empresa?: string | null;
  resumen: string;
  emitidoPor: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function verDirectorioFotosPdf(d: DatosDirectorioPdf): Promise<void> {
  const [{ jsPDF }, { loadLogoDataUrl }] = await Promise.all([import('jspdf'), import('@/shared/lib/pdfLogo')]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const LIMITE = limiteInferiorPdf(H);
  const ANCHO_UTIL = W - 2 * M;
  const emp = identidadEmpresa(d.empresa);
  const ahora = new Date();

  const encabezado = () => {
    let y = M;
    if (logo) { try { doc.addImage(logo, 'JPEG', M, y, 46, 46); } catch { /* logo opcional */ } }
    const tx = logo ? M + 56 : M;
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...TINTA);
    doc.text(textoPdf(emp.nombre), tx, y + 14);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS);
    doc.text(`RIF ${emp.rif}`, tx, y + 26);
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...NARANJA);
    doc.text('DIRECTORIO DE PERSONAL CON FOTOS', W - M, y + 14, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS);
    doc.text(textoPdf(d.resumen), W - M, y + 26, { align: 'right' });
    doc.text(`Emitido por ${textoPdf(d.emitidoPor)} · ${fmtDate(ahora.toISOString())}`, W - M, y + 37, { align: 'right' });
    y += 50;
    doc.setDrawColor(...NARANJA).setLineWidth(1.2);
    doc.line(M, y, W - M, y);
    return y + 8;
  };

  const pie = () => {
    const paginas = doc.getNumberOfPages();
    for (let i = 1; i <= paginas; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GRIS_SUAVE);
      doc.text('Documento generado por el sistema · Directorio de personal con fotos · solo para administración', M, H - M + 14);
      doc.text(`Página ${i} de ${paginas}`, W - M, H - M + 14, { align: 'right' });
    }
  };

  let y = encabezado();
  const xTexto = M + ANCHO_FOTO + 10;
  const anchoTexto = ANCHO_UTIL - ANCHO_FOTO - 10;
  const recorta = (s: string, maxW: number) => {
    let t = textoPdf(s);
    while (t.length > 3 && doc.getTextWidth(t) > maxW) t = `${t.slice(0, -2)}…`;
    return t;
  };

  d.personas.forEach((p, i) => {
    if (y + ALTO_FILA > LIMITE) { doc.addPage(); y = encabezado(); }
    if (i % 2 === 1) { doc.setFillColor(...FILA_ALTERNA); doc.rect(M, y, ANCHO_UTIL, ALTO_FILA, 'F'); }
    const fx = M + 2; const fy = y + (ALTO_FILA - ALTO_FOTO) / 2;
    if (p.fotoDataUrl) {
      try { doc.addImage(p.fotoDataUrl, 'JPEG', fx, fy, ANCHO_FOTO, ALTO_FOTO); }
      catch { /* una foto que jsPDF no lea no tumba el directorio: la fila sale sin ella */ }
    } else {
      doc.setDrawColor(...GRIS_SUAVE).setLineWidth(0.5);
      doc.rect(fx, fy, ANCHO_FOTO, ALTO_FOTO);
      doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(...GRIS_SUAVE);
      doc.text('Sin foto', fx + ANCHO_FOTO / 2, fy + ALTO_FOTO / 2 + 2, { align: 'center' });
    }
    doc.setDrawColor(...NARANJA).setLineWidth(1);
    doc.rect(fx - 1, fy - 1, ANCHO_FOTO + 2, ALTO_FOTO + 2);

    doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...TINTA);
    doc.text(recorta(p.nombre, anchoTexto), xTexto, y + 20);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GRIS);
    doc.text(recorta([p.cargo, p.departamento].filter(Boolean).join(' · ') || 'Sin cargo', anchoTexto), xTexto, y + 34);
    doc.setFontSize(7.5).setTextColor(...GRIS_SUAVE);
    const datos = [p.ficha ? `Ficha ${p.ficha}` : '', p.cedula ? `C.I. ${p.cedula}` : '', p.fechaIngreso ? `desde ${fmtDate(p.fechaIngreso)}` : ''].filter(Boolean).join(' · ');
    doc.text(recorta(datos, anchoTexto), xTexto, y + 47);
    y += ALTO_FILA;
  });

  pie();
  doc.setProperties({ title: 'Directorio de personal con fotos' });
  previewPdfDoc(doc, `Directorio de personal con fotos ${ahora.toISOString().slice(0, 10)}.pdf`);
}
