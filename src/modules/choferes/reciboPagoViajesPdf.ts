/* ============================================================
   MGG · Choferes / Conductores · Recibo de Pago de Viajes (PDF)

   Genera recibos formales de pago de viajes para firma del chofer:
   - Rango de fechas (período de liquidación).
   - Datos del conductor (nombre, cédula, nómina fija).
   - Datos de vehículo(s): si usó un solo vehículo o varios.
   - Resumen cuantitativo: total viajes, largos, cortos, internos y monto en $.
   - Desglose de rutas, movimientos y tarifas.
   - Declaración de conformidad y línea de firma del conductor.
   - Soporta emisión individual o por lote (un recibo por chofer).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { date as fmtDate } from '@/shared/lib/format';
import type { GrupoChoferNomina } from './nominaViajesPdf';
import type { Conductor, VehiculoFlota } from './choferes.repository';

const usd = (n: number | null | undefined) =>
  `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface ReciboPagoViajesOpts {
  grupos: GrupoChoferNomina[];
  fechaDesde?: string | null;
  fechaHasta?: string | null;
  fechaPago?: string | null;
  conductoresMap?: Map<string, Conductor>;
  flotaMap?: Map<string, VehiculoFlota>;
}

export async function generarReciboPagoViajesPdf(opts: ReciboPagoViajesOpts): Promise<void> {
  const { grupos, fechaDesde, fechaHasta, fechaPago, conductoresMap, flotaMap } = opts;
  if (!grupos.length) return;

  const [logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 40;
  const CONTENT_W = PAGE_W - 2 * MARGIN;

  const fPagoTxt = fmtDate(fechaPago || new Date().toISOString().slice(0, 10));
  const periodoTxt = fechaDesde && fechaHasta
    ? `Del ${fmtDate(fechaDesde)} al ${fmtDate(fechaHasta)}`
    : fechaHasta
    ? `Hasta el ${fmtDate(fechaHasta)}`
    : 'Todos los viajes pendientes';

  grupos.forEach((g, gIdx) => {
    if (gIdx > 0) doc.addPage();
    let y = MARGIN;

    // ── Encabezado y Logo ──
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, 42, 42);
      } catch { /* opcional */ }
    }
    const tx = logoDataUrl ? MARGIN + 48 : MARGIN;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(24, 43, 73);
    doc.text('MINERAL GROUP GUAYANA, C.A.', tx, y + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(110, 120, 135);
    doc.text('RIF: J-50143878-0 · SISTEMA DE GESTIÓN Y CONTROL DE LOGÍSTICA', tx, y + 23);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(255, 138, 0);
    doc.text('COMPROBANTE DE PAGO DE VIAJES', tx, y + 36);

    // Meta derecha
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(50, 60, 75);
    doc.text(`FECHA DE PAGO: ${fPagoTxt}`, PAGE_W - MARGIN, y + 12, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(`PERÍODO: ${periodoTxt}`, PAGE_W - MARGIN, y + 24, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 160, 90);
    doc.text('ESTADO: SALDADO / PAGADO', PAGE_W - MARGIN, y + 36, { align: 'right' });

    y += 50;

    // ── Caja de Datos del Conductor y Vehículo(s) ──
    const cond = conductoresMap?.get(g.choferId);
    const cedula = cond?.personal?.cedula || cond?.cedula || '—';
    const tlf = cond?.personal?.telefono || cond?.telefono || '—';

    // Análisis de vehículos utilizados
    const vehiculosSet = new Set<string>();
    g.filas.forEach((f) => {
      const v = (f.vehiculo || '').trim();
      if (v && v !== '—') vehiculosSet.add(v);
    });
    const listaVehiculos = Array.from(vehiculosSet);

    let textoVehiculo = '—';
    if (listaVehiculos.length === 1) {
      const vUnico = listaVehiculos[0];
      const infoFlota = flotaMap ? Array.from(flotaMap.values()).find((vf) => vf.placa === vUnico) : null;
      textoVehiculo = infoFlota
        ? `${vUnico} (${infoFlota.marca || ''} ${infoFlota.modelo || ''})`.trim()
        : vUnico;
    } else if (listaVehiculos.length > 1) {
      textoVehiculo = `${listaVehiculos.join(', ')} (${listaVehiculos.length} vehículos)`;
    }

    doc.setFillColor(245, 248, 252);
    doc.setDrawColor(215, 225, 238);
    doc.roundedRect(MARGIN, y, CONTENT_W, 44, 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(24, 43, 73);
    doc.text('CONDUCTOR:', MARGIN + 10, y + 15);
    doc.text('CÉDULA / RIF:', MARGIN + 10, y + 32);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    doc.text(g.nombre.toUpperCase(), MARGIN + 75, y + 15);
    doc.text(cedula, MARGIN + 75, y + 32);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(24, 43, 73);
    doc.text('NÓMINA FIJA:', MARGIN + 210, y + 15);
    doc.text('TELÉFONO:', MARGIN + 210, y + 32);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    doc.text(g.nominaFija || 'MGG', MARGIN + 275, y + 15);
    doc.text(tlf, MARGIN + 275, y + 32);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(24, 43, 73);
    doc.text(listaVehiculos.length > 1 ? 'VEHÍCULOS:' : 'VEHÍCULO:', MARGIN + 360, y + 15);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    const txtVehSplit = doc.splitTextToSize(textoVehiculo, CONTENT_W - 370) as string[];
    doc.text(txtVehSplit, MARGIN + 420, y + 15);

    y += 52;

    // ── Resumen Cuantitativo de Viajes (Kpis) ──
    const totLargos = g.filas
      .filter((f) => f.observaciones === 'VIAJE LARGO')
      .reduce((a, f) => a + f.viajes, 0);
    const montoLargos = g.filas
      .filter((f) => f.observaciones === 'VIAJE LARGO')
      .reduce((a, f) => a + f.totalPagar, 0);

    const totCortos = g.filas
      .filter((f) => f.observaciones === 'VIAJE CORTO')
      .reduce((a, f) => a + f.viajes, 0);
    const montoCortos = g.filas
      .filter((f) => f.observaciones === 'VIAJE CORTO')
      .reduce((a, f) => a + f.totalPagar, 0);

    const totInternos = g.filas
      .filter((f) => f.observaciones === 'VIAJE INTERNO')
      .reduce((a, f) => a + f.viajes, 0);
    const montoInternos = g.filas
      .filter((f) => f.observaciones === 'VIAJE INTERNO')
      .reduce((a, f) => a + f.totalPagar, 0);

    const totalViajesChofer = g.filas.reduce((a, f) => a + f.viajes, 0);

    autoTable(doc, {
      startY: y,
      head: [[
        'TOTAL VIAJES',
        'VIAJES LARGOS',
        'VIAJES CORTOS',
        'VIAJES INTERNOS',
        'TOTAL A PAGAR ($)',
      ]],
      body: [[
        `${totalViajesChofer} viajes`,
        `${totLargos} (${usd(montoLargos)})`,
        `${totCortos} (${usd(montoCortos)})`,
        `${totInternos} (${usd(montoInternos)})`,
        usd(g.totalGeneral),
      ]],
      theme: 'grid',
      styles: { fontSize: 8, halign: 'center', cellPadding: 3.5 },
      headStyles: { fillColor: [36, 58, 94], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        4: { fontStyle: 'bold', textColor: [217, 119, 6], fontSize: 9.5 },
      },
      margin: { left: MARGIN, right: MARGIN },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

    // ── Tabla de Rutas y Desglose ──
    const multiVehiculo = listaVehiculos.length > 1;
    const bodyRows = g.filas.map((f, i) => {
      const base = [
        String(i + 1),
        fmtDate(f.fecha),
        f.movimiento,
        f.proviene,
        f.destino,
        f.observaciones,
      ];
      if (multiVehiculo) base.push(f.vehiculo);
      base.push(String(f.viajes), usd(f.monto), usd(f.totalPagar));
      return base;
    });

    const headCols = ['#', 'FECHA', 'MOVIMIENTO / CARGA', 'ORIGEN', 'DESTINO', 'TIPO'];
    if (multiVehiculo) headCols.push('VEHÍCULO');
    headCols.push('VIAJES', 'MONTO', 'TOTAL $');

    autoTable(doc, {
      startY: y,
      head: [headCols],
      body: bodyRows,
      foot: [[
        { content: 'TOTAL GENERAL LIQUIDADO:', colSpan: multiVehiculo ? 7 : 6, styles: { halign: 'right', fontStyle: 'bold' } },
        { content: String(totalViajesChofer), styles: { halign: 'center', fontStyle: 'bold' } },
        { content: '' },
        { content: usd(g.totalGeneral), styles: { halign: 'right', fontStyle: 'bold', textColor: [217, 119, 6] } },
      ]],
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 2.5, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [24, 43, 73], textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 6.8 },
      footStyles: { fillColor: [245, 230, 200], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 16, halign: 'center' },
        1: { cellWidth: 50, halign: 'center' },
        [multiVehiculo ? 7 : 6]: { cellWidth: 32, halign: 'center' },
        [multiVehiculo ? 8 : 7]: { cellWidth: 46, halign: 'right' },
        [multiVehiculo ? 9 : 8]: { cellWidth: 55, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: MARGIN, right: MARGIN },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

    // Verificar si queda espacio para la conformidad y las firmas (mínimo 100 pt)
    if (y + 110 > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN + 20;
    }

    // ── Texto de Conformidad ──
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(40, 50, 65);
    const textoConformidad = `Certifico haber recibido a mi entera satisfacción la cantidad de ${usd(g.totalGeneral)} (dólares de los Estados Unidos de América) en concepto de pago de ${totalViajesChofer} viaje(s) realizados durante el período indicado (${periodoTxt}), no quedando pendiente ninguna diferencia económica por este concepto. Firmo en señal de conformidad.`;
    const confLines = doc.splitTextToSize(textoConformidad, CONTENT_W) as string[];
    doc.text(confLines, MARGIN, y);

    y += confLines.length * 10 + 26;

    // ── Líneas de Firmas ──
    const sigBoxW = (CONTENT_W - 40) / 2;

    // Firma Chofer (Izquierda)
    const xChofer = MARGIN;
    doc.setDrawColor(120, 130, 145);
    doc.line(xChofer + 15, y, xChofer + sigBoxW - 15, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(24, 43, 73);
    doc.text('FIRMA DEL CONDUCTOR', xChofer + sigBoxW / 2, y + 12, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(60, 70, 80);
    doc.text(g.nombre.toUpperCase(), xChofer + sigBoxW / 2, y + 23, { align: 'center' });
    doc.text(`C.I. / RIF: ${cedula}`, xChofer + sigBoxW / 2, y + 33, { align: 'center' });
    doc.text(`Fecha: ____ / ____ / ________`, xChofer + sigBoxW / 2, y + 43, { align: 'center' });

    // Firma Empresa (Derecha)
    const xEmpresa = MARGIN + sigBoxW + 40;
    doc.line(xEmpresa + 15, y, xEmpresa + sigBoxW - 15, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(24, 43, 73);
    doc.text('ADMINISTRACIÓN / TESORERÍA', xEmpresa + sigBoxW / 2, y + 12, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(60, 70, 80);
    doc.text('MINERAL GROUP GUAYANA, C.A.', xEmpresa + sigBoxW / 2, y + 23, { align: 'center' });
    doc.text('Sello y Firma Autorizada', xEmpresa + sigBoxW / 2, y + 33, { align: 'center' });
    doc.text(`Fecha: ${fPagoTxt}`, xEmpresa + sigBoxW / 2, y + 43, { align: 'center' });
  });

  const nombreDoc = grupos.length === 1
    ? `recibo-pago-viajes-${grupos[0].nombre.toLowerCase().replace(/\s+/g, '-')}-${fechaHasta || 'corte'}.pdf`
    : `recibos-pago-viajes-lote-${fechaHasta || 'corte'}.pdf`;

  previewPdfDoc(doc, nombreDoc);
}
