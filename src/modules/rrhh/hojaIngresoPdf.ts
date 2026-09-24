/* ============================================================
   MGG · RRHH · Hoja de ingreso y registro de personal (PDF)

   Es un formulario EN BLANCO: se imprime y lo llena a mano la persona que
   entra, antes de que exista su ficha en el sistema. Por eso no recibe datos
   de nadie —no hay a quién consultar todavía— y por eso los campos son rayas
   y casillas, no valores.

   Sigue el formato que se venía usando en papel, con una diferencia: NO lleva
   el bloque de DATOS DE TRANSFERENCIA BANCARIA. Los datos de cuenta no se
   piden en la hoja de ingreso ni quedan dando vueltas en una carpeta: se
   cargan aparte, cuando la persona ya está dada de alta en la nómina.

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import { definicionEmpresa, normalizarEmpresa, type Empresa } from './empresa';

const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS: [number, number, number] = [120, 120, 120];
const TINTA: [number, number, number] = [40, 40, 40];

/** Los renglones de «Datos personales», en el orden en que se piden. */
const DATOS_PERSONALES: Array<[string, string]> = [
  ['Primer apellido', 'Segundo apellido'],
  ['Primer nombre', 'Segundo nombre'],
  ['Cédula de identidad', 'Fecha de nacimiento'],
  ['Nacionalidad', 'Lugar de nacimiento'],
  ['Estado civil', 'Género'],
  ['Grupo sanguíneo / RH', 'Nivel de estudios'],
  ['Teléfono celular', 'Teléfono de habitación'],
  ['Correo electrónico', 'Cargo al que ingresa'],
];

/** Cuántas filas en blanco lleva la carga familiar. Cinco cubre a casi todos y
 *  deja la hoja en una sola página; quien tenga más agrega al dorso. */
const FILAS_FAMILIA = 5;

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function verHojaIngresoPdf(empresa?: Empresa): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const M = 42;
  const emp = definicionEmpresa(normalizarEmpresa(empresa));
  let y = M;

  /* ── Encabezado ── */
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y, 42, 42); } catch { /* el logo es opcional */ } }
  doc.setTextColor(...NARANJA); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(textoPdf('HOJA DE INGRESO Y REGISTRO DE PERSONAL'), W / 2, y + 14, { align: 'center' });
  doc.setTextColor(60, 60, 60); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(textoPdf(emp.razonSocial), W / 2, y + 28, { align: 'center' });
  doc.setFontSize(8); doc.setTextColor(...GRIS);
  doc.text(textoPdf('Llene todos los campos con letra de molde, clara y legible.'), W / 2, y + 40, { align: 'center' });
  y += 58;

  /** Título de sección, con su raya naranja. */
  const seccion = (n: number, titulo: string) => {
    doc.setTextColor(...NARANJA); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(textoPdf(`${n}. ${titulo.toUpperCase()}`), M, y);
    doc.setDrawColor(...NARANJA); doc.setLineWidth(0.8);
    doc.line(M, y + 4, W - M, y + 4);
    y += 16;
  };

  /**
   * Un renglón con dos campos: el rótulo chico arriba y la raya para escribir
   * abajo. La raya va separada del rótulo para que la letra de molde entre sin
   * pisarlo: en el formato viejo se escribía encima del texto impreso.
   */
  const parDeCampos = (izq: string, der: string) => {
    const ancho = (W - M * 2 - 18) / 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
    doc.text(textoPdf(izq), M, y);
    if (der) doc.text(textoPdf(der), M + ancho + 18, y);
    doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.5);
    doc.line(M, y + 15, M + ancho, y + 15);
    if (der) doc.line(M + ancho + 18, y + 15, W - M, y + 15);
    y += 30;
  };

  /* ── 1. Datos personales ── */
  seccion(1, 'Datos personales');
  for (const [a, b] of DATOS_PERSONALES) parDeCampos(a, b);
  // La dirección va sola: en dos columnas no entra una dirección de verdad.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text(textoPdf('Dirección de habitación'), M, y);
  doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.5);
  doc.line(M, y + 15, W - M, y + 15);
  doc.line(M, y + 33, W - M, y + 33);
  y += 48;

  /* ── 2. Carga familiar ── */
  seccion(2, 'Carga familiar y dependientes directos');
  autoTable(doc as any, {
    startY: y,
    head: [[textoPdf('Nombre y apellido'), textoPdf('Parentesco'), textoPdf('Fecha de nacimiento'), textoPdf('Cédula')].map((x) => x)],
    body: Array.from({ length: FILAS_FAMILIA }, () => ['', '', '', '']),
    theme: 'grid',
    headStyles: { fillColor: [245, 245, 245], textColor: GRIS, fontSize: 7.5, fontStyle: 'bold', lineColor: [200, 200, 200], lineWidth: 0.5 },
    bodyStyles: { minCellHeight: 20, lineColor: [200, 200, 200], lineWidth: 0.5 },
    styles: { fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: 95 }, 2: { cellWidth: 105 } },
    margin: { left: M, right: M },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 22;

  /* ── 3. Contacto de emergencia ── */
  seccion(3, 'Contacto en caso de emergencia');
  parDeCampos('Nombre y apellido', 'Parentesco');
  parDeCampos('Teléfono celular', 'Teléfono fijo / trabajo');
  y += 4;

  /* ── Declaración y firma ── */
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...TINTA);
  const declaracion = 'Declaro que todos los datos aqui asentados son correctos, veridicos y actualizados, y autorizo a '
    + `${emp.razonSocial} a verificar su autenticidad. Me comprometo a informar cualquier cambio.`;
  const lineas = doc.splitTextToSize(textoPdf(declaracion), W - M * 2) as string[];
  doc.text(lineas, M, y);
  y += lineas.length * 11 + 34;

  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.6);
  const anchoFirma = 190;
  doc.line(M, y, M + anchoFirma, y);
  doc.line(W - M - anchoFirma, y, W - M, y);
  doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text(textoPdf('Firma del trabajador'), M + anchoFirma / 2, y + 12, { align: 'center' });
  doc.text(textoPdf('Fecha de entrega'), W - M - anchoFirma / 2, y + 12, { align: 'center' });

  /* ── Pie: para qué NO sirve esta hoja ── */
  doc.setFontSize(7); doc.setTextColor(...GRIS);
  doc.text(
    textoPdf('Los datos bancarios no se piden en esta hoja: se cargan en el sistema una vez dada de alta la ficha.'),
    W / 2, doc.internal.pageSize.getHeight() - 30, { align: 'center' },
  );

  await previewPdfDoc(doc, 'hoja-ingreso-personal.pdf');
}
