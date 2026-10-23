/* ============================================================
   MGG · Choferes / Conductores · Recibo de Pago de Viajes (PDF)

   Genera recibos formales de pago de viajes para firma del chofer:
   - Rango de fechas (período de liquidación).
   - Datos del conductor (nombre, cédula, nómina fija).
   - Datos de vehículo(s): si usó un solo vehículo o varios.
   - Resumen cuantitativo: 5 KPIs con franja de color (viajes, largos, cortos, internos, total $).
   - Desglose de rutas, movimientos y tarifas.
   - Declaración de conformidad.
   - Firma del conductor única, centrada en el medio y ubicada abajo.
   - Soporta emisión individual o por lote (un recibo por chofer).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { date as fmtDate, formatoCI } from '@/shared/lib/format';
import { textoPdf } from '@/shared/lib/textoPdf';
import type { GrupoChoferNomina } from './nominaViajesPdf';
import type { Conductor, VehiculoFlota } from './choferes.repository';

const usd = (n: number | null | undefined) =>
  `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const NARANJA: [number, number, number] = [217, 83, 30]; // #d9531e
const VERDE: [number, number, number] = [39, 174, 96];
const AZUL: [number, number, number] = [41, 128, 185];
const PURPURA: [number, number, number] = [142, 68, 173];
const TINTA: [number, number, number] = [24, 43, 73];
const GRIS: [number, number, number] = [100, 110, 125];
const BORDE: [number, number, number] = [226, 232, 240];
const FONDO_CARD: [number, number, number] = [255, 255, 255];
const FONDO_BANNER: [number, number, number] = [254, 252, 248];

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
    doc.setTextColor(...TINTA);
    doc.text('MINERAL GROUP GUAYANA, C.A.', tx, y + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(110, 120, 135);
    doc.text('RIF: J-50143878-0 · SISTEMA DE GESTIÓN Y CONTROL DE LOGÍSTICA', tx, y + 23);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...NARANJA);
    doc.text('COMPROBANTE DE PAGO DE VIAJES', tx, y + 36);

    // Meta derecha
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(50, 60, 75);
    doc.text(`FECHA DE PAGO: ${fPagoTxt}`, PAGE_W - MARGIN, y + 12, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(`PERÍODO: ${periodoTxt}`, PAGE_W - MARGIN, y + 24, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...VERDE);
    doc.text('ESTADO: SALDADO / PAGADO', PAGE_W - MARGIN, y + 36, { align: 'right' });

    y += 46;

    // Línea divisoria decorativa
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 10;

    // ── 5 Cajas Resumen (KPI Cards) ──
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

    const gapKpi = 6;
    const anchoKpi = (CONTENT_W - 4 * gapKpi) / 5;
    const altoKpi = 40;

    const kpiCards: Array<{
      label: string;
      valor: string;
      topColor: [number, number, number];
      valColor: [number, number, number];
    }> = [
      { label: 'TOTAL VIAJES', valor: `${totalViajesChofer} viajes`, topColor: AZUL, valColor: TINTA },
      { label: 'VIAJES LARGOS', valor: `${totLargos} (${usd(montoLargos)})`, topColor: NARANJA, valColor: TINTA },
      { label: 'VIAJES CORTOS', valor: `${totCortos} (${usd(montoCortos)})`, topColor: VERDE, valColor: TINTA },
      { label: 'VIAJES INTERNOS', valor: `${totInternos} (${usd(montoInternos)})`, topColor: PURPURA, valColor: TINTA },
      { label: 'TOTAL A PAGAR', valor: usd(g.totalGeneral), topColor: NARANJA, valColor: NARANJA },
    ];

    kpiCards.forEach((c, idx) => {
      const xKpi = MARGIN + idx * (anchoKpi + gapKpi);
      doc.setDrawColor(...BORDE);
      doc.setLineWidth(0.6);
      doc.setFillColor(...FONDO_CARD);
      doc.roundedRect(xKpi, y, anchoKpi, altoKpi, 3, 3, 'FD');

      // Franja de color superior
      doc.setFillColor(...c.topColor);
      doc.rect(xKpi + 2, y, anchoKpi - 4, 2.5, 'F');

      // Rótulo
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(...GRIS);
      doc.text(textoPdf(c.label), xKpi + anchoKpi / 2, y + 13, { align: 'center' });

      // Cifra
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(c.label === 'TOTAL A PAGAR' ? 10.5 : 9.5);
      doc.setTextColor(...c.valColor);
      doc.text(textoPdf(c.valor), xKpi + anchoKpi / 2, y + 29, { align: 'center' });
    });

    y += altoKpi + 10;

    // ── Banner Card del Conductor y Vehículo(s) ──
    const cond = conductoresMap?.get(g.choferId);
    const cedula = formatoCI(cond?.personal?.cedula || cond?.cedula);
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

    const bannerH = 38;
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.6);
    doc.setFillColor(...FONDO_BANNER);
    doc.roundedRect(MARGIN, y, CONTENT_W, bannerH, 3, 3, 'FD');

    // Franja vertical naranja
    doc.setFillColor(...NARANJA);
    doc.rect(MARGIN, y, 4, bannerH, 'F');

    // Fila 1: Conductor (izq) y Monto liquidado (der)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(...GRIS);
    doc.text('CONDUCTOR:', MARGIN + 12, y + 13);

    doc.setFontSize(9.5);
    doc.setTextColor(...TINTA);
    doc.text(textoPdf(g.nombre.toUpperCase()), MARGIN + 72, y + 13);

    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text('LIQUIDADO:', PAGE_W - MARGIN - 72, y + 13, { align: 'right' });
    doc.setFontSize(9.5);
    doc.setTextColor(...NARANJA);
    doc.text(textoPdf(usd(g.totalGeneral)), PAGE_W - MARGIN - 10, y + 13, { align: 'right' });

    // Fila 2: Cédula, nómina fija, teléfono y vehículo
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(70, 80, 95);
    const detalleLinea = `C.I. / RIF: ${cedula}   ·   Nómina: ${g.nominaFija || 'MGG'}   ·   Teléfono: ${tlf}   ·   Vehículo(s): ${textoVehiculo}`;
    const detalleCorto = doc.splitTextToSize(detalleLinea, CONTENT_W - 24)[0];
    doc.text(textoPdf(detalleCorto), MARGIN + 12, y + 28);

    y += bannerH + 12;

    // ── Tabla de Rutas y Desglose ──
    const multiVehiculo = listaVehiculos.length > 1;
    const bodyRows = g.filas.map((f, i) => {
      const base = [
        String(i + 1),
        fmtDate(f.fecha),
        f.movimiento || '—',
        f.proviene || '—',
        f.destino || '—',
        f.observaciones || '—',
      ];
      if (multiVehiculo) base.push(f.vehiculo || '—');
      base.push(String(f.viajes), usd(f.monto), usd(f.totalPagar));
      return base.map((c) => textoPdf(c));
    });

    const headCols = ['#', 'FECHA', 'MOVIMIENTO / CARGA', 'ORIGEN', 'DESTINO', 'TIPO'];
    if (multiVehiculo) headCols.push('VEHÍCULO');
    headCols.push('VIAJES', 'MONTO', 'TOTAL $');

    autoTable(doc, {
      startY: y,
      head: [headCols.map((c) => textoPdf(c))],
      body: bodyRows,
      foot: [
        [
          { content: 'TOTAL GENERAL LIQUIDADO:', colSpan: multiVehiculo ? 7 : 6, styles: { halign: 'right', fontStyle: 'bold' } },
          { content: String(totalViajesChofer), styles: { halign: 'center', fontStyle: 'bold' } },
          { content: '' },
          { content: usd(g.totalGeneral), styles: { halign: 'right', fontStyle: 'bold', textColor: NARANJA } },
        ],
        ...(g.totalPendiente > 0 ? [[
          { content: 'SALDO PENDIENTE (PASA AL SIGUIENTE CIERRE):', colSpan: multiVehiculo ? 8 : 7, styles: { halign: 'right' as const, fontStyle: 'bold' as const, textColor: [200, 30, 30] as [number, number, number] } },
          { content: usd(g.totalPendiente), styles: { halign: 'right' as const, fontStyle: 'bold' as const, textColor: [200, 30, 30] as [number, number, number] } },
        ]] : []),
      ],
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 2.8,
        valign: 'middle',
        overflow: 'linebreak',
        lineColor: BORDE,
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: NARANJA,
        textColor: 255,
        fontStyle: 'bold',
        halign: 'center',
        fontSize: 7,
      },
      alternateRowStyles: {
        fillColor: [253, 253, 254],
      },
      footStyles: {
        fillColor: [254, 243, 235],
        textColor: [20, 20, 20],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 16, halign: 'center' },
        1: { cellWidth: 52, halign: 'center' },
        [multiVehiculo ? 7 : 6]: { cellWidth: 32, halign: 'center' },
        [multiVehiculo ? 8 : 7]: { cellWidth: 46, halign: 'right' },
        [multiVehiculo ? 9 : 8]: { cellWidth: 55, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: MARGIN, right: MARGIN },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

    // ── Texto de Conformidad ──
    const espacioNecesarioFirma = 110;
    if (y + espacioNecesarioFirma > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN + 20;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(70, 80, 95);
    const textoConformidad = `Certifico haber recibido a mi entera satisfacción la cantidad de ${usd(g.totalGeneral)} en concepto de liquidación de ${totalViajesChofer} viaje(s) realizados durante el período indicado (${periodoTxt}), no quedando pendiente ninguna diferencia económica por este concepto. Firmo en señal de plena conformidad.`;
    const confLines = doc.splitTextToSize(textoConformidad, CONTENT_W) as string[];
    doc.text(confLines, MARGIN, y);

    y += confLines.length * 10 + 20;

    // ── Firma del Conductor: Justo al medio y abajo ──
    // Se ubica abajo en la página aprovechando el pie si hay espacio
    const yFirma = Math.max(y + 30, PAGE_H - MARGIN - 65);
    const xCentro = PAGE_W / 2;
    const lineaW = 220;

    doc.setDrawColor(120, 130, 145);
    doc.setLineWidth(0.8);
    doc.line(xCentro - lineaW / 2, yFirma, xCentro + lineaW / 2, yFirma);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...TINTA);
    doc.text('FIRMA DEL CONDUCTOR', xCentro, yFirma + 12, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(50, 60, 75);
    doc.text(textoPdf(g.nombre.toUpperCase()), xCentro, yFirma + 23, { align: 'center' });
    doc.text(textoPdf(`C.I. / RIF: ${cedula}`), xCentro, yFirma + 34, { align: 'center' });
    doc.text('Fecha de recepción: ____ / ____ / ________', xCentro, yFirma + 45, { align: 'center' });
  });

  const nombreDoc = grupos.length === 1
    ? `recibo-pago-viajes-${grupos[0].nombre.toLowerCase().replace(/\s+/g, '-')}-${fechaHasta || 'corte'}.pdf`
    : `recibos-pago-viajes-lote-${fechaHasta || 'corte'}.pdf`;

  previewPdfDoc(doc, nombreDoc);
}
