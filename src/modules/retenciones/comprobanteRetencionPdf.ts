/* ============================================================
   MGG · Comprobante de retención (Venezuela)

   El comprobante de retención de IVA que manda la Providencia SNAT/2025/000054:
   número de comprobante AAAAMM + 8 dígitos, período fiscal, datos del agente y
   del sujeto retenido, la factura que lo origina, la base, el impuesto, el
   porcentaje y el monto retenido.

   El mismo formato sirve para ISLR, municipal y timbre: cambia el encabezado y
   la columna del impuesto, no la estructura.

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf, anchoUtilPdf } from '@/shared/lib/pdfMargen';
import { labelImpuesto, labelPeriodo, labelSujeto, type ConfigRetencion } from './retencionesCalculo';
import type { RetencionPracticada } from './retencionesFiscal.repository';

function monto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
}
function fecha(iso: string | null | undefined): string {
  const s = String(iso ?? '').slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

/** Las dos partes del comprobante, renglón por renglón: el agente que retiene y el sujeto retenido. */
export function partesComprobante(r: RetencionPracticada, config: ConfigRetencion): { agente: string[]; sujeto: string[] } {
  const empresa = [
    config.razonSocial || 'Mineral Group Guayana C.A.',
    `RIF: ${config.rif || '—'}`,
    config.direccionFiscal || '',
    [config.municipio, config.estado].filter(Boolean).join(' · '),
  ].filter(Boolean);
  const contraparte = [r.contraparteNombre || '—', `RIF: ${r.contraparteRif || '—'}`];
  // Nos la practicaron: el agente es quien nos retuvo y el sujeto retenido es la empresa.
  if (r.direccion === 'recibida') return { agente: contraparte, sujeto: empresa };
  const sujeto = r.contraparteSujeto ? [...contraparte, labelSujeto(r.contraparteSujeto)] : contraparte;
  return { agente: empresa, sujeto };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function verComprobanteRetencionPdf(r: RetencionPracticada, config: ConfigRetencion): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = MARGEN_PDF;
  const LIMITE = limiteInferiorPdf(doc.internal.pageSize.getHeight());
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  // ── Encabezado ──
  doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  const titulo = r.tipo === 'iva'
    ? 'COMPROBANTE DE RETENCIÓN DE IVA'
    : r.tipo === 'islr'
    ? 'COMPROBANTE DE RETENCIÓN DE IMPUESTO SOBRE LA RENTA'
    : r.tipo === 'isae'
    ? 'COMPROBANTE DE RETENCIÓN DE IMPUESTO DE ACTIVIDADES ECONÓMICAS (ISAE)'
    : `COMPROBANTE DE ${labelImpuesto(r.tipo).toUpperCase()}`;
  doc.text(textoPdf(titulo), W / 2, y + 16, { align: 'center' });

  doc.setTextColor(60, 60, 60); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  const subtitulo = r.tipo === 'iva'
    ? 'Providencia Administrativa SNAT/2015/0049 · Gaceta Oficial N° 40.720 (Retenciones de IVA)'
    : r.tipo === 'islr'
    ? 'Decreto N° 1.808 · Gaceta Oficial N° 36.203 · Reglamento Parcial de la Ley de ISLR en materia de Retenciones'
    : r.tipo === 'isae'
    ? 'Ordenanza Municipal sobre Agentes de Retención del Impuesto sobre Actividades Económicas'
    : 'Ley de Impuesto a las Grandes Transacciones Financieras · Gaceta Oficial N° 6.687 Ext.';
  doc.text(textoPdf(subtitulo), W / 2, y + 29, { align: 'center' });
  y += 44;

  // ── El número y el período: lo primero que mira el SENIAT ──
  doc.setDrawColor(20, 20, 20); doc.setLineWidth(1);
  doc.rect(MARGIN, y, W - MARGIN * 2, 34);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(70, 70, 70);
  doc.text(textoPdf('N° DE COMPROBANTE'), MARGIN + 10, y + 13);
  doc.text(textoPdf('PERÍODO FISCAL'), MARGIN + 230, y + 13);
  doc.text(textoPdf('FECHA DE EMISIÓN'), MARGIN + 400, y + 13);
  doc.setFontSize(11); doc.setTextColor(20, 20, 20);
  doc.text(textoPdf(r.numeroComprobante ?? '—'), MARGIN + 10, y + 28);
  doc.setFontSize(9.5);
  const per = r.quincena ? `${labelPeriodo(r.periodo)} · ${r.quincena}.ª quincena` : labelPeriodo(r.periodo);
  doc.text(textoPdf(per), MARGIN + 230, y + 28);
  doc.text(textoPdf(fecha(r.createdAt)), MARGIN + 400, y + 28);
  y += 44;

  // ── Agente y sujeto retenido ──
  doc.setTextColor(0, 0, 0);
  const partes = partesComprobante(r, config);
  autoTable(doc, {
    startY: y,
    head: [[textoPdf('AGENTE DE RETENCIÓN'), textoPdf('SUJETO RETENIDO')]],
    body: [[textoPdf(partes.agente.join('\n')), textoPdf(partes.sujeto.join('\n'))]],
    styles: { fontSize: 8.5, cellPadding: 6, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [235, 235, 235], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 0: { cellWidth: (W - MARGIN * 2) / 2 }, 1: { cellWidth: (W - MARGIN * 2) / 2 } },
    margin: MARGENES_TABLA_PDF,
  });
  y = (doc as any).lastAutoTable.finalY + 12;

  // ── La operación según marco tributario (PA 049 / PA 071 / Dcto 1808) ──
  const esIva = r.tipo === 'iva';
  const esIslr = r.tipo === 'islr';
  const totalDoc = (r.baseImponible || 0) + (r.impuesto || 0);

  let cabecera: string[];
  let fila: string[];
  let columnasNumericasDesde = 3;

  if (esIva) {
    cabecera = ['OPER.', 'FACTURA', 'FECHA', 'N° CONTROL', 'TOTAL FACTURA', 'BASE IMPONIBLE', 'ALÍCUOTA', 'IVA FACTURA', '% RET.', 'IVA RETENIDO'];
    columnasNumericasDesde = 4;
    fila = [
      '01',
      r.facturaNumero || r.docCodigo || '—',
      fecha(r.facturaFecha),
      r.facturaControl || '—',
      monto(totalDoc, r.moneda),
      monto(r.baseImponible, r.moneda),
      r.alicuota ? `${r.alicuota}%` : '—',
      monto(r.impuesto, r.moneda),
      `${r.porcentaje}%`,
      monto(r.montoRetenido, r.moneda),
    ];
  } else if (esIslr) {
    cabecera = ['OPER.', 'DOCUMENTO', 'FECHA', 'N° CONTROL', 'CONCEPTO', 'BASE IMPONIBLE', 'SUSTRAENDO', '% RET.', 'MONTO RETENIDO'];
    columnasNumericasDesde = 5;
    fila = [
      '01',
      r.facturaNumero || r.docCodigo || '—',
      fecha(r.facturaFecha),
      r.facturaControl || '—',
      r.conceptoNombre || 'Retención ISLR',
      monto(r.baseImponible, r.moneda),
      r.sustraendo ? monto(r.sustraendo, r.moneda) : '—',
      `${r.porcentaje}%`,
      monto(r.montoRetenido, r.moneda),
    ];
  } else {
    cabecera = ['OPER.', 'DOCUMENTO', 'FECHA', 'N° CONTROL', 'CONCEPTO / ACTIVIDAD', 'BASE IMPONIBLE', '% RET.', 'MONTO RETENIDO'];
    columnasNumericasDesde = 5;
    fila = [
      '01',
      r.facturaNumero || r.docCodigo || '—',
      fecha(r.facturaFecha),
      r.facturaControl || '—',
      r.conceptoNombre || labelImpuesto(r.tipo),
      monto(r.baseImponible, r.moneda),
      `${r.porcentaje}%`,
      monto(r.montoRetenido, r.moneda),
    ];
  }

  autoTable(doc, {
    startY: y,
    head: [cabecera.map((h) => textoPdf(h))],
    body: [fila.map((c) => textoPdf(c))],
    styles: { fontSize: 7, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [225, 225, 225], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 6.8 },
    columnStyles: Object.fromEntries(
      cabecera.map((_, i) => [i, { halign: i >= columnasNumericasDesde ? ('right' as const) : i === 0 ? ('center' as const) : ('left' as const) }])
    ),
    margin: MARGENES_TABLA_PDF,
  });
  y = (doc as any).lastAutoTable.finalY + 12;

  // ── El total, grande: alineado a la derecha con formato contable ──
  const cajaTotalW = 230;
  const cajaTotalX = W - MARGIN - cajaTotalW;
  doc.setDrawColor(20, 20, 20); doc.setFillColor(245, 245, 245);
  doc.rect(cajaTotalX, y, cajaTotalW, 28, 'FD');
  doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.text(textoPdf('TOTAL RETENIDO:'), cajaTotalX + 10, y + 18);
  doc.setFontSize(11);
  doc.text(textoPdf(monto(r.montoRetenido, r.moneda)), cajaTotalX + cajaTotalW - 10, y + 18, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 40;

  if (r.anulada) {
    doc.setTextColor(200, 40, 40); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(textoPdf(`ANULADO · ${r.anuladaMotivo ?? ''}`), MARGIN, y);
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');
    y += 20;
  }

  // ── Firmas ──
  doc.setFontSize(8); doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.5);
  const anchoFirma = (W - MARGIN * 2 - 40) / 2;
  doc.line(MARGIN, y + 40, MARGIN + anchoFirma, y + 40);
  doc.line(MARGIN + anchoFirma + 40, y + 40, W - MARGIN, y + 40);
  doc.text(textoPdf('Por el agente de retención'), MARGIN, y + 52);
  doc.text(textoPdf('Recibido por el sujeto retenido'), MARGIN + anchoFirma + 40, y + 52);

  // ── Pie ──
  doc.setFontSize(7); doc.setTextColor(120, 120, 120);
  const pie = esIva
    ? 'El comprobante se entrega al proveedor dentro de los plazos de la Providencia. El número no se reusa: una retención anulada conserva el suyo.'
    : 'Comprobante de retención. El número no se reusa: una retención anulada conserva el suyo.';
  doc.text(textoPdf(pie), MARGIN, LIMITE - 22, { maxWidth: anchoUtilPdf(W) });
  doc.text(textoPdf(`Emitido por ${r.actorName ?? '—'} · Mineral Group Guayana C.A.`), MARGIN, LIMITE);

  await previewPdfDoc(doc, `retencion-${r.tipo}-${r.numeroComprobante ?? r.id.slice(0, 8)}.pdf`);
}
