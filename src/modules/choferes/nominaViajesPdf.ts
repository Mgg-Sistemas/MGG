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
  const MARGIN = MARGEN_PDF;
  let y = MARGIN;

  // Logo
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, 40, 40); } catch { /* opcional */ }
  }
  const tx = logoDataUrl ? MARGIN + 48 : MARGIN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 138, 0);
  doc.text('MINERAL GROUP GUAYANA, C.A.', tx, y + 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text('NÓMINA DE VIAJES DE CHOFERES Y CAMIONES', tx, y + 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(110);
  const subtitulo = [
    opts.fechaHasta ? `Viajes hasta: ${fmtDate(opts.fechaHasta)}` : 'Todos los viajes',
    opts.filtroChofer ? `Chofer: ${opts.filtroChofer}` : 'Todos los choferes',
    `Emitido el ${fmtDate(new Date().toISOString())}`,
  ].join(' · ');
  doc.text(subtitulo, tx, y + 40);
  y += 52;

  let totalGeneralEmpresa = 0;
  let totalPagadoEmpresa = 0;
  let totalPendienteEmpresa = 0;

  for (let gIdx = 0; gIdx < opts.grupos.length; gIdx++) {
    const g = opts.grupos[gIdx];
    totalGeneralEmpresa += g.totalGeneral;
    totalPagadoEmpresa += g.totalPagado;
    totalPendienteEmpresa += g.totalPendiente;

    // Encabezado del conductor
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(`CONDUCTOR: ${g.nombre.toUpperCase()} · NÓMINA FIJA: ${g.nominaFija || 'MGG'}`, MARGIN, y + 10);
    y += 16;

    const bodyRows = g.filas.map((f) => [
      f.fecha,
      f.nombre,
      f.nominaFija,
      f.vehiculo,
      f.movimiento,
      f.proviene,
      f.destino,
      String(f.viajes),
      usd(f.monto),
      usd(f.totalPagar),
      `${f.observaciones}${f.pagado ? ` · PAGADO (${fmtDate(f.fechaPago || '')})` : ''}`,
    ]);

    autoTable(doc, {
      startY: y,
      head: [[
        'FECHA', 'NOMBRE Y APELLIDO', 'NÓMINA FIJA', 'VEHÍCULO', 'EQUIPO / MOVIMIENTO',
        'PROVIENE', 'DESTINO', 'VIAJES', 'MONTO', 'TOTAL A PAGAR', 'OBSERVACIONES',
      ]],
      body: bodyRows,
      foot: [
        [
          '', '', '', '', '', '',
          'TOTAL A PAGAR CONDUCTOR',
          String(g.filas.reduce((acc, x) => acc + x.viajes, 0)),
          '',
          usd(g.totalGeneral),
          `Pagado: ${usd(g.totalPagado)} | Debe: ${usd(g.totalPendiente)}`,
        ],
      ],
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [24, 43, 73], textColor: 255, fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: [245, 230, 200], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 55, halign: 'center' },
        7: { cellWidth: 40, halign: 'center' },
        8: { cellWidth: 50, halign: 'right' },
        9: { cellWidth: 65, halign: 'right', fontStyle: 'bold' },
        10: { cellWidth: 120 },
      },
      margin: MARGENES_TABLA_PDF,
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
    if (y + 60 > doc.internal.pageSize.getHeight() - MARGIN && gIdx < opts.grupos.length - 1) {
      doc.addPage();
      y = MARGIN;
    }
  }

  // Cuadro final consolidado si hay más de 1 conductor
  if (opts.grupos.length > 1) {
    autoTable(doc, {
      startY: y,
      body: [
        ['TOTAL GENERAL CONSOLIDADO', usd(totalGeneralEmpresa)],
        ['TOTAL PAGADO', usd(totalPagadoEmpresa)],
        ['TOTAL PENDIENTE POR PAGAR', usd(totalPendienteEmpresa)],
      ],
      theme: 'plain',
      styles: { fontSize: 9.5, fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'right' }, 1: { halign: 'right', textColor: [255, 138, 0] } },
      margin: MARGENES_TABLA_PDF,
    });
  }

  previewPdfDoc(doc, `nomina-viajes-choferes-${opts.fechaHasta || 'completa'}.pdf`);
}
