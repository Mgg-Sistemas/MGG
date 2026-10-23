/* ============================================================
   MGG · Choferes / Conductores · Nómina de viajes de choferes (PDF)

   Replica el formato de la planilla física / Excel:
   FECHA | NOMBRE Y APELLIDO | NÓMINA FIJA | VEHÍCULO | EQUIPOS/MOVIMIENTOS |
   PROVIENE | DESTINO | CANTIDAD VIAJES | MONTO | TOTAL A PAGAR | OBSERVACIONES
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { MARGEN_PDF, MARGENES_TABLA_PDF } from '@/shared/lib/pdfMargen';
import { date as fmtDate } from '@/shared/lib/format';

export interface FilaNominaViaje {
  fecha: string;
  nombre: string;
  nominaFija: string;
  vehiculo: string;
  movimiento: string;
  proviene: string;
  destino: string;
  viajes: number;
  monto: number;
  totalPagar: number;
  observaciones: string;
  pagado: boolean;
  fechaPago: string | null;
  viaje?: any;
}

export interface GrupoChoferNomina {
  choferId: string;
  nombre: string;
  nominaFija: string;
  filas: FilaNominaViaje[];
  totalGeneral: number;
  totalPagado: number;
  totalPendiente: number;
}

const NARANJA: [number, number, number] = [217, 83, 30]; // #d9531e
const GRIS: [number, number, number] = [100, 116, 139];   // #64748b
const TINTA: [number, number, number] = [15, 23, 42];     // #0f172a
const ROJO: [number, number, number] = [220, 38, 38];     // #dc2626
const VERDE: [number, number, number] = [22, 163, 74];    // #16a34a
const AZUL: [number, number, number] = [59, 130, 246];    // #3b82f6
const AMBER: [number, number, number] = [245, 158, 11];   // #f59e0b
const BORDE: [number, number, number] = [226, 232, 240];  // #e2e8f0
const FONDO_CARD: [number, number, number] = [255, 255, 255];
const FONDO_BANNER: [number, number, number] = [254, 252, 248];

const usd = (n: number) => `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generarNominaViajesPdf(opts: {
  grupos: GrupoChoferNomina[];
  fechaHasta?: string | null;
  filtroChofer?: string | null;
}): Promise<void> {
  const [logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = MARGEN_PDF;
  let y = MARGIN;

  // Encabezado con logo y título centrado naranja
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y - 2, 42, 42); } catch { /* opcional */ }
  }

  doc.setTextColor(...NARANJA);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('NÓMINA DE VIAJES · PLANILLA OFICIAL', W / 2, y + 12, { align: 'center' });

  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('MINERAL GROUP GUAYANA, C.A. · Transporte y Flota de Choferes', W / 2, y + 25, { align: 'center' });

  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  const subtitulo = [
    opts.fechaHasta ? `Corte de viajes al: ${fmtDate(opts.fechaHasta)}` : 'Todos los viajes',
    opts.filtroChofer ? `Conductor: ${opts.filtroChofer}` : `${opts.grupos.length} conductores`,
    `Emitido el ${fmtDate(new Date().toISOString())}`,
  ].join(' · ');
  doc.text(subtitulo, W / 2, y + 36, { align: 'center' });

  // Línea sutil divisoria
  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y + 43, W - MARGIN, y + 43);
  y += 50;

  // Totales consolidados de la planilla
  const totalGeneralEmpresa = opts.grupos.reduce((acc, g) => acc + g.totalGeneral, 0);
  const totalPagadoEmpresa = opts.grupos.reduce((acc, g) => acc + g.totalPagado, 0);
  const totalPendienteEmpresa = opts.grupos.reduce((acc, g) => acc + g.totalPendiente, 0);
  const totalViajesEmpresa = opts.grupos.reduce((acc, g) => acc + g.filas.reduce((a, f) => a + f.viajes, 0), 0);
  const cantConductores = opts.grupos.length;

  // 5 Tarjetas métricas superiores con franja de color
  const gap = 8;
  const anchoCaja = (anchoUtilPdf(W) - (4 * gap)) / 5;
  const altoCaja = 40;

  const cajas: Array<{ label: string; valor: string; topColor: [number, number, number]; valColor: [number, number, number] }> = [
    { label: 'TOTAL GENERAL', valor: usd(totalGeneralEmpresa), topColor: NARANJA, valColor: TINTA },
    { label: 'TOTAL PAGADO', valor: usd(totalPagadoEmpresa), topColor: VERDE, valColor: VERDE },
    { label: 'PENDIENTE', valor: usd(totalPendienteEmpresa), topColor: ROJO, valColor: totalPendienteEmpresa > 0 ? ROJO : VERDE },
    { label: 'TOTAL VIAJES', valor: `${totalViajesEmpresa} viajes`, topColor: AZUL, valColor: TINTA },
    { label: 'CONDUCTORES', valor: `${cantConductores} choferes`, topColor: AMBER, valColor: AMBER },
  ];

  cajas.forEach((c, i) => {
    const x = MARGIN + i * (anchoCaja + gap);
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.6);
    doc.setFillColor(...FONDO_CARD);
    doc.roundedRect(x, y, anchoCaja, altoCaja, 3, 3, 'FD');

    // Banda superior de color
    doc.setFillColor(...c.topColor);
    doc.rect(x + 2, y, anchoCaja - 4, 2.5, 'F');

    // Rótulo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...GRIS);
    doc.text(textoPdf(c.label), x + anchoCaja / 2, y + 13, { align: 'center' });

    // Cifra
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...c.valColor);
    doc.text(textoPdf(c.valor), x + anchoCaja / 2, y + 30, { align: 'center' });
  });

  y += altoCaja + 12;

  // Bloque por cada conductor
  for (let gIdx = 0; gIdx < opts.grupos.length; gIdx++) {
    const g = opts.grupos[gIdx];
    const totalViajesChofer = g.filas.reduce((a, f) => a + f.viajes, 0);

    // Vehículos utilizados por este chofer
    const vehSet = new Set<string>();
    g.filas.forEach((f) => { if (f.vehiculo && f.vehiculo !== '—') vehSet.add(f.vehiculo); });
    const vehTxt = Array.from(vehSet).join(', ') || 'Sin vehículo';

    // Salto de página si el bloque queda muy abajo
    if (y + 90 > H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }

    // Banner del conductor con franja naranja izquierda
    const altoBanner = 30;
    const anchoBanner = anchoUtilPdf(W);

    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.6);
    doc.setFillColor(...FONDO_BANNER);
    doc.roundedRect(MARGIN, y, anchoBanner, altoBanner, 3, 3, 'FD');

    // Franja vertical naranja
    doc.setFillColor(...NARANJA);
    doc.rect(MARGIN, y, 4, altoBanner, 'F');

    // Nombre del conductor
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...TINTA);
    doc.text(textoPdf(g.nombre.toUpperCase()), MARGIN + 10, y + 12);

    // Totales a la derecha
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...NARANJA);
    const txtDerecha = `Total: ${usd(g.totalGeneral)}  ·  Pendiente: ${usd(g.totalPendiente)}`;
    doc.text(textoPdf(txtDerecha), W - MARGIN - 8, y + 12, { align: 'right' });

    // Sub-datos: nómina fija, vehículos, viajes
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    const datosConductor = [
      `Nómina Fija: ${g.nominaFija || 'MGG'}`,
      `Vehículo(s): ${vehTxt}`,
      `Registros: ${g.filas.length}`,
      `Total viajes: ${totalViajesChofer}`,
    ].join(' · ');
    doc.text(textoPdf(datosConductor), MARGIN + 10, y + 23);

    y += altoBanner + 6;

    // Filas de la tabla para este conductor
    const bodyRows = g.filas.map((f) => [
      f.fecha,
      f.vehiculo,
      f.movimiento,
      f.proviene,
      f.destino,
      String(f.viajes),
      usd(f.monto),
      usd(f.totalPagar),
      f.observaciones,
      f.pagado ? `✅ Pagado${f.fechaPago ? ` (${f.fechaPago.slice(8, 10)}/${f.fechaPago.slice(5, 7)})` : ''}` : '⏳ Por pagar',
    ]);

    autoTable(doc, {
      startY: y,
      head: [[
        'FECHA',
        'VEHÍCULO',
        'EQUIPO / MOVIMIENTO',
        'ORIGEN (PROVIENE)',
        'DESTINO',
        'VIAJES',
        'PRECIO ($)',
        'TOTAL A PAGAR',
        'TIPO DE VIAJE',
        'ESTADO PAGO',
      ]],
      body: bodyRows,
      foot: [
        [
          { content: `TOTAL A PAGAR ${g.nombre.toUpperCase()}`, colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
          { content: String(totalViajesChofer), styles: { halign: 'center', fontStyle: 'bold' } },
          { content: '' },
          { content: usd(g.totalGeneral), styles: { halign: 'right', fontStyle: 'bold' } },
          { content: `Pagado: ${usd(g.totalPagado)} · Pendiente: ${usd(g.totalPendiente)}`, colSpan: 2, styles: { halign: 'left', fontSize: 7, fontStyle: 'bold' } },
        ],
      ],
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 2.2, valign: 'middle', overflow: 'linebreak' },
      headStyles: {
        fillColor: NARANJA,
        textColor: 255,
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle',
        fontSize: 6.8,
        lineColor: [200, 70, 20],
        lineWidth: 0.5,
      },
      footStyles: {
        fillColor: [254, 243, 235],
        textColor: TINTA,
        fontStyle: 'bold',
        lineColor: BORDE,
        lineWidth: 0.5,
      },
      bodyStyles: {
        lineColor: BORDE,
        lineWidth: 0.4,
      },
      columnStyles: {
        0: { cellWidth: 55, halign: 'center' },
        1: { cellWidth: 65, halign: 'center' },
        2: { cellWidth: 105 },
        3: { cellWidth: 95 },
        4: { cellWidth: 95 },
        5: { cellWidth: 38, halign: 'center' },
        6: { cellWidth: 55, halign: 'right' },
        7: { cellWidth: 68, halign: 'right', fontStyle: 'bold' },
        8: { cellWidth: 85, halign: 'center' },
        9: { cellWidth: 70, halign: 'center' },
      },
      didParseCell: (data) => {
        if (data.section === 'body') {
          if (data.column.index === 7) {
            data.cell.styles.textColor = NARANJA;
            data.cell.styles.fontStyle = 'bold';
          }
          if (data.column.index === 9) {
            const texto = String(data.cell.raw ?? '');
            if (texto.includes('Pagado')) {
              data.cell.styles.textColor = VERDE;
              data.cell.styles.fontStyle = 'bold';
            } else {
              data.cell.styles.textColor = ROJO;
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
      margin: MARGENES_TABLA_PDF,
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }

  await previewPdfDoc(doc, `nomina-viajes-choferes-${opts.fechaHasta || 'completa'}.pdf`);
}
