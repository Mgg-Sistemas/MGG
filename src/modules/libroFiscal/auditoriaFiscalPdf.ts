/* ============================================================
   MGG · Retenciones · Exportación de Auditoría Fiscal en PDF
   Genera el reporte formal en formato PDF (apaisado, carta)
   con membrete corporativo, KPIs de control y la traza
   completa de eventos auditados según los filtros activos.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { MARGEN_PDF, MARGENES_TABLA_PDF, textoPdf, filaPdf } from './pdfComun';
import type { EventoAuditoriaFiscal, ResumenAuditoria } from './auditoriaRetenciones.repository';
import { EMPRESA_NOMBRE, EMPRESA_RIF } from '@/shared/lib/empresa';

export interface FiltrosAuditoriaPdf {
  tipo?: string;
  impuesto?: string;
  desde?: string;
  hasta?: string;
  texto?: string;
}

function formatFechaHoraVE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'America/Caracas',
  }).format(d);
}

function formatoMonto(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function exportarAuditoriaFiscalPdf(
  eventos: EventoAuditoriaFiscal[],
  resumen: ResumenAuditoria,
  filtros: FiltrosAuditoriaPdf = {},
): Promise<void> {
  if (!eventos.length) {
    throw new Error('No hay eventos de auditoría para exportar.');
  }

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  let y = M - 15;

  // ── 1. Membrete superior ──
  const logoSize = 38;
  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', M, y, logoSize, logoSize);
    } catch {
      /* si falla la decodificación, el documento continúa sin imagen */
    }
  }

  const headerLeft = logo ? M + logoSize + 12 : M;
  doc.setTextColor(30, 41, 59); // slate-800
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(textoPdf('AUDITORÍA FISCAL DE RETENCIONES'), headerLeft, y + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text(textoPdf(`${EMPRESA_NOMBRE} · RIF ${EMPRESA_RIF}`), headerLeft, y + 26);
  doc.text(textoPdf('Trazabilidad de emisiones, anulaciones, declaraciones de período, reaperturas y decisiones'), headerLeft, y + 37);

  // Fecha y hora en el extremo derecho
  const ahoraStr = new Intl.DateTimeFormat('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Caracas',
  }).format(new Date());
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(textoPdf(`Emisión: ${ahoraStr}`), W - M, y + 14, { align: 'right' });
  doc.text(textoPdf(`Registros: ${eventos.length}`), W - M, y + 26, { align: 'right' });

  y += 48;

  // ── 2. Filtros activos ──
  const chipsFiltro: string[] = [];
  if (filtros.tipo) chipsFiltro.push(`Acción: ${filtros.tipo.toUpperCase()}`);
  if (filtros.impuesto) chipsFiltro.push(`Impuesto: ${filtros.impuesto}`);
  if (filtros.desde || filtros.hasta) {
    chipsFiltro.push(`Rango: ${filtros.desde ? formatFechaHoraVE(filtros.desde) : 'inicio'} al ${filtros.hasta ? formatFechaHoraVE(filtros.hasta) : 'cierre'}`);
  }
  if (filtros.texto) chipsFiltro.push(`Búsqueda: "${filtros.texto}"`);

  const lineaFiltros = chipsFiltro.length > 0
    ? `Filtros aplicados: ${chipsFiltro.join(' · ')}`
    : 'Alcance: Todos los eventos registrados sin restricciones';

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(textoPdf(lineaFiltros), M, y);
  y += 12;

  // ── 3. Tarjetas Resumen (KPIs) ──
  const kpis: { label: string; valor: number; color: [number, number, number] }[] = [
    { label: 'TOTAL EVENTOS', valor: resumen.total, color: [59, 130, 246] },
    { label: 'EMISIONES', valor: resumen.emisiones, color: [34, 197, 94] },
    { label: 'ANULACIONES', valor: resumen.anulaciones, color: [239, 68, 68] },
    { label: 'CIERRES (DECL.)', valor: resumen.cierres, color: [59, 130, 246] },
    { label: 'REAPERTURAS', valor: resumen.reaperturas, color: [245, 158, 11] },
    { label: '«NO APLICA»', valor: resumen.noAplica, color: [139, 92, 246] },
  ];

  const gap = 6;
  const anchoKpi = (W - 2 * M - gap * (kpis.length - 1)) / kpis.length;
  const altoKpi = 28;

  kpis.forEach((kpi, idx) => {
    const kX = M + idx * (anchoKpi + gap);
    // Fondo de tarjeta
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.7);
    doc.roundedRect(kX, y, anchoKpi, altoKpi, 3, 3, 'FD');

    // Borde acentuado superior
    doc.setFillColor(...kpi.color);
    doc.rect(kX + 3, y, anchoKpi - 6, 2, 'F');

    // Etiqueta
    doc.setFontSize(6.2);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text(textoPdf(kpi.label), kX + 6, y + 11);

    // Número
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...kpi.color);
    doc.text(String(kpi.valor), kX + 6, y + 23);
  });

  y += altoKpi + 10;

  // ── 4. Tabla de Traza Fiscal ──
  /* eslint-disable @typescript-eslint/no-explicit-any */
  autoTable(doc as any, {
    startY: y,
    margin: MARGENES_TABLA_PDF,
    head: [
      filaPdf([
        'Fecha y Hora',
        'Acción',
        'Imp.',
        'Referencia / N°',
        'Factura',
        'Sujeto / Proveedor',
        'Monto Retenido',
        'Responsable',
        'Motivo / Justificación',
      ]),
    ],
    body: eventos.map((e) => {
      const montoStr = e.monto?.retenidoBs != null
        ? `${formatoMonto(e.monto.retenidoBs)} Bs`
        : e.monto?.retenido != null
          ? `${formatoMonto(e.monto.retenido)} ${e.monto.moneda ?? 'Bs'}`
          : '—';

      const sujetoStr = e.contraparte?.nombre
        ? `${e.contraparte.nombre}${e.contraparte.rif ? `\n(${e.contraparte.rif})` : ''}`
        : '—';

      const motivoStr = e.motivo || e.detalle || '—';

      return filaPdf([
        formatFechaHoraVE(e.fechaIso),
        e.tipo.toUpperCase(),
        e.impuesto ?? '—',
        e.referencia || '—',
        e.documentoFiscal?.factura || '—',
        sujetoStr,
        montoStr,
        e.usuario || '—',
        motivoStr,
      ]);
    }),
    styles: {
      fontSize: 6.8,
      cellPadding: 3,
      overflow: 'linebreak',
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7.2,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 72 },                           // Fecha y Hora
      1: { cellWidth: 58, fontStyle: 'bold' },         // Acción
      2: { cellWidth: 42 },                           // Impuesto
      3: { cellWidth: 75, font: 'courier' },           // Referencia
      4: { cellWidth: 55 },                           // Factura
      5: { cellWidth: 105 },                          // Sujeto
      6: { cellWidth: 68, halign: 'right' },          // Monto
      7: { cellWidth: 85 },                           // Responsable
      8: { cellWidth: 'auto' },                       // Motivo
    },
    didDrawPage: (data: any) => {
      // Pie de página en cada hoja
      doc.setFontSize(6.8);
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'normal');
      doc.text(
        textoPdf('Documento de control fiscal y trazabilidad tributaria interna · Mineral Group Guayana C.A.'),
        M,
        H - 18,
      );
      doc.text(
        textoPdf(`Página ${data.pageNumber}`),
        W - M,
        H - 18,
        { align: 'right' },
      );
    },
  });

  const fechaArchivo = new Date().toISOString().slice(0, 10);
  previewPdfDoc(doc, `auditoria-retenciones-${fechaArchivo}.pdf`);
}
