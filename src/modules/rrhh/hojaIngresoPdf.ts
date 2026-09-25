/* ============================================================
   MGG · RRHH · Hoja de ingreso y registro de personal (PDF)

   Es un formulario EN BLANCO: se imprime y lo llena a mano la persona que
   entra, antes de que exista su ficha en el sistema. Por eso no recibe datos
   de nadie —no hay a quién consultar todavía— y por eso los campos son rayas
   y casillas, no valores.

   Son dos páginas: la hoja que llena la persona y, atrás, la lista de papeles
   que tiene que consignar en la oficina, con una casilla por renglón para que
   quien recibe vaya tildando.

   Sigue el formato que se venía usando en papel, con una diferencia: NO lleva
   el bloque de DATOS DE TRANSFERENCIA BANCARIA. Los datos de cuenta no se
   piden en la hoja de ingreso ni quedan dando vueltas en una carpeta: se
   cargan aparte, cuando la persona ya está dada de alta en la nómina.

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import { definicionEmpresa, normalizarEmpresa, type Empresa } from './empresa';
import { DOCUMENTOS_A_CONSIGNAR } from './hojaIngresoDocumentos';

const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS: [number, number, number] = [120, 120, 120];
const TINTA: [number, number, number] = [40, 40, 40];

/** Los renglones de «Datos personales», en el orden en que se piden. */
const DATOS_PERSONALES: Array<[string, string]> = [
  ['Primer apellido', 'Segundo apellido'],
  ['Primer nombre', 'Segundo nombre'],
  // La cédula y el RIF van juntos: son los dos números con los que la persona
  // figura en la nómina, y quien transcribe la hoja los copia de un tirón.
  ['Cédula de identidad', 'RIF'],
  ['Fecha de nacimiento', 'Lugar de nacimiento'],
  ['Nacionalidad', 'Estado civil'],
  ['Género', 'Grupo sanguíneo / RH'],
  ['Grado de instrucción', 'Teléfono celular'],
  ['Teléfono de habitación', 'Correo electrónico'],
  ['Cargo al que ingresa', 'Fecha de ingreso'],
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
  const H = doc.internal.pageSize.getHeight();
  const M = 42;
  const emp = definicionEmpresa(normalizarEmpresa(empresa));
  let y = M;

  /** Encabezado de página. Se repite en la segunda hoja para que suelta se
   *  sepa de dónde salió y de qué formulario es la continuación. */
  const encabezado = (titulo: string, ayuda: string) => {
    y = M;
    if (logo) { try { doc.addImage(logo, 'JPEG', M, y, 42, 42); } catch { /* el logo es opcional */ } }
    doc.setTextColor(...NARANJA); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(textoPdf(titulo), W / 2, y + 14, { align: 'center' });
    doc.setTextColor(60, 60, 60); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(textoPdf(emp.razonSocial), W / 2, y + 28, { align: 'center' });
    doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(textoPdf(ayuda), W / 2, y + 40, { align: 'center' });
    y += 58;
  };

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
    y += 28;
  };

  /** Una casilla vacía de 9 pt. Se tilda a mano. */
  const casilla = (x: number, cy: number, lado = 9) => {
    doc.setDrawColor(130, 130, 130); doc.setLineWidth(0.7);
    doc.rect(x, cy - lado + 2, lado, lado);
  };

  /* ══════════════ Página 1 · la hoja que llena la persona ══════════════ */
  encabezado('HOJA DE INGRESO Y REGISTRO DE PERSONAL', 'Llene todos los campos con letra de molde, clara y legible.');

  /* ── 1. Datos personales ── */
  seccion(1, 'Datos personales');
  for (const [a, b] of DATOS_PERSONALES) parDeCampos(a, b);
  // La dirección va sola: en dos columnas no entra una dirección de verdad.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text(textoPdf('Dirección de habitación'), M, y);
  doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.5);
  doc.line(M, y + 15, W - M, y + 15);
  doc.line(M, y + 32, W - M, y + 32);
  y += 46;

  /* ── 2. Carga familiar ── */
  seccion(2, 'Carga familiar y dependientes directos');
  autoTable(doc as any, {
    startY: y,
    head: [[textoPdf('Nombre y apellido'), textoPdf('Parentesco'), textoPdf('Fecha de nacimiento'), textoPdf('Cédula')]],
    body: Array.from({ length: FILAS_FAMILIA }, () => ['', '', '', '']),
    theme: 'grid',
    headStyles: { fillColor: [245, 245, 245], textColor: GRIS, fontSize: 7.5, fontStyle: 'bold', lineColor: [200, 200, 200], lineWidth: 0.5 },
    bodyStyles: { minCellHeight: 18, lineColor: [200, 200, 200], lineWidth: 0.5 },
    styles: { fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: 95 }, 2: { cellWidth: 105 } },
    margin: { left: M, right: M },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 18;

  /* ── 3. Condiciones de salud ── */
  seccion(3, 'Condiciones de salud');
  /**
   * Una pregunta de sí/no con su raya de detalle al lado. El detalle NO se
   * deja para el final ni en otro renglón: pegado a la casilla, quien llena la
   * hoja entiende que marcar «Sí» lo obliga a escribir a qué.
   */
  const preguntaSalud = (pregunta: string, detalle: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...TINTA);
    doc.text(textoPdf(pregunta), M, y);
    const anchoPregunta = doc.getTextWidth(textoPdf(pregunta));
    let x = M + anchoPregunta + 14;
    for (const op of ['Sí', 'No']) {
      casilla(x, y);
      doc.setFontSize(8); doc.setTextColor(...TINTA);
      doc.text(textoPdf(op), x + 13, y);
      x += 44;
    }
    doc.setFontSize(7.5); doc.setTextColor(...GRIS);
    doc.text(textoPdf(detalle), M, y + 16);
    doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.5);
    doc.line(M, y + 30, W - M, y + 30);
    y += 44;
  };
  preguntaSalud('¿Padece alguna alergia?', '¿A qué? Medicamentos, alimentos, picaduras, polvo…');
  preguntaSalud('¿Padece alguna enfermedad?', '¿Cuál? Indique también el tratamiento que recibe y con qué frecuencia');
  doc.setFontSize(7); doc.setTextColor(...GRIS);
  doc.text(
    textoPdf('Lo declarado acá se imprime en el carnet y se muestra al escanear su código QR, para que pueda ser atendido en una emergencia.'),
    M, y,
  );
  y += 14;

  /* ── 4. Contacto de emergencia ── */
  seccion(4, 'Contacto en caso de emergencia');
  parDeCampos('Nombre y apellido', 'Parentesco');
  parDeCampos('Teléfono celular', 'Teléfono fijo / trabajo');
  y += 2;

  /* ── Declaración y firma ── */
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...TINTA);
  const declaracion = 'Declaro que todos los datos aqui asentados son correctos, veridicos y actualizados, y autorizo a '
    + `${emp.razonSocial} a verificar su autenticidad. Me comprometo a informar cualquier cambio.`;
  const lineas = doc.splitTextToSize(textoPdf(declaracion), W - M * 2) as string[];
  doc.text(lineas, M, y);
  y += lineas.length * 11 + 30;

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
    W / 2, H - 30, { align: 'center' },
  );

  /* ══════════ Página 2 · los papeles que tiene que traer ══════════ */
  doc.addPage();
  encabezado('DOCUMENTOS A CONSIGNAR POR OFICINA', 'Marque cada documento al momento de recibirlo. Los marcados «(si aplica)» no le tocan a todos.');

  // Letra 12: esta hoja se llena parada en la oficina, con la carpeta en la
  // mano, y se tilda de un vistazo. A 8,5 pt entraba todo en una página pero
  // había que acercarse a leerla.
  const CUERPO = 12;
  const ANCHO_ITEM = W - M * 2 - 26;
  for (const grupo of DOCUMENTOS_A_CONSIGNAR) {
    // Ningún grupo arranca al filo de la página: si no entra el título más un
    // par de renglones, se pasa a la siguiente hoja entero.
    if (y + 70 > H - 100) { doc.addPage(); y = M; }
    doc.setTextColor(...NARANJA); doc.setFont('helvetica', 'bold'); doc.setFontSize(CUERPO + 1);
    doc.text(textoPdf(grupo.titulo.toUpperCase()), M, y);
    doc.setDrawColor(...NARANJA); doc.setLineWidth(0.6);
    doc.line(M, y + 4.5, W - M, y + 4.5);
    y += 22;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(CUERPO);
    for (const item of grupo.items) {
      const partes = doc.splitTextToSize(textoPdf(item), ANCHO_ITEM) as string[];
      const alto = Math.max(21, partes.length * 14 + 7);
      if (y + alto > H - 100) {
        doc.addPage(); y = M;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(CUERPO);
      }
      casilla(M, y + 1, 11);
      doc.setTextColor(...TINTA);
      doc.text(partes, M + 24, y);
      y += alto;
    }
    y += 10;
  }

  /* ── Pie de la segunda página: quién recibió ── */
  // Si la lista terminó pegada al borde, el pie se va a la hoja siguiente
  // entero: una firma cortada por la mitad no la firma nadie.
  if (y + 46 > H - 40) { doc.addPage(); y = M; }
  const yPie = Math.max(y + 16, H - 78);
  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.6);
  const anchoPie = 150;
  doc.line(M, yPie, M + anchoPie, yPie);
  doc.line(W / 2 - anchoPie / 2, yPie, W / 2 + anchoPie / 2, yPie);
  doc.line(W - M - anchoPie, yPie, W - M, yPie);
  doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text(textoPdf('Recibido por'), M + anchoPie / 2, yPie + 12, { align: 'center' });
  doc.text(textoPdf('Firma'), W / 2, yPie + 12, { align: 'center' });
  doc.text(textoPdf('Fecha'), W - M - anchoPie / 2, yPie + 12, { align: 'center' });
  doc.setFontSize(7);
  doc.text(
    textoPdf('Los documentos se consignan en original y copia. Los originales se devuelven una vez cotejados.'),
    W / 2, H - 30, { align: 'center' },
  );

  await previewPdfDoc(doc, 'hoja-ingreso-personal.pdf');
}
