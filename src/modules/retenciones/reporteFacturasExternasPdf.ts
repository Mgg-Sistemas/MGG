/* ============================================================
   MGG · Retenciones · Reporte Fiscal de Facturas por Empresa (29-10-2026)

   Emite el reporte en PDF de las facturas externas para la empresa seleccionada
   (Golden Touch, MineriaTs / MTO, etc.) utilizando sus datos fiscales reales
   (Razón Social, RIF, Domicilio Fiscal y condición de agente/contribuyente especial),
   sin alterar ni mezclar la contabilidad de Mineral Group Guayana.
   ============================================================ */

import { previewPdf } from '@/shared/lib/reportePreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, textoPdf } from '@/modules/libroFiscal/pdfComun';
import type { DatosFiscalesEmpresa } from './empresasFiscales.repository';
import type { FacturaExterna } from './facturasExternas.repository';
import { ETIQUETA_ESTADO_FACTURA } from './mensajeFacturaWhatsapp';

export async function exportarReporteFiscalFacturasPdf(
  empresa: DatosFiscalesEmpresa,
  facturas: FacturaExterna[],
  filtrosDesc = 'Todas las facturas registradas'
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const M = MARGEN_PDF;
  let y = M;

  // Encabezado Fiscal
  doc.setTextColor(255, 138, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(textoPdf(empresa.razonSocial.toUpperCase()), W / 2, y + 10, { align: 'center' });

  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(textoPdf(`RIF: ${empresa.rif || 'Sin RIF registrado'} · Código: ${empresa.codigo}`), W / 2, y + 23, { align: 'center' });

  if (empresa.direccionFiscal) {
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    const dir = doc.splitTextToSize(textoPdf(`Domicilio Fiscal: ${empresa.direccionFiscal}`), W - 2 * M);
    doc.text(dir, W / 2, y + 35, { align: 'center' });
    y += 10 * dir.length;
  }

  y += 40;

  // Título del Reporte
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(textoPdf('REPORTE FISCAL DE FACTURAS Y COMPRAS EXTERNAS'), W / 2, y, { align: 'center' });

  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(textoPdf(`Criterio: ${filtrosDesc} · Total facturas: ${facturas.length}`), W / 2, y, { align: 'center' });

  // Totales
  let totalUsd = 0;
  let totalBs = 0;
  for (const f of facturas) {
    if (f.moneda === 'USD') totalUsd += f.montoTotal;
    else totalBs += f.montoTotal;
  }

  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  const resumen = `Monto Total USD: $ ${totalUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}   |   Monto Total Bs: Bs. ${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  doc.text(textoPdf(resumen), M, y);

  y += 10;

  // Tabla
  const encabezados = ['N° Factura', 'N° Control', 'Proveedor', 'RIF', 'Fecha', 'Monto Total', 'Estatus'];
  const filas = facturas.map((f) => [
    textoPdf(f.numeroFactura),
    textoPdf(f.numeroControl || '—'),
    textoPdf(f.proveedorNombre),
    textoPdf(f.proveedorRif),
    f.fechaFactura,
    `${f.moneda === 'USD' ? '$' : 'Bs.'} ${f.montoTotal.toFixed(2)}`,
    textoPdf(ETIQUETA_ESTADO_FACTURA[f.estado] || f.estado),
  ]);

  autoTable(doc, {
    startY: y + 8,
    margin: MARGENES_TABLA_PDF,
    head: [encabezados],
    body: filas,
    styles: { fontSize: 7.5, cellPadding: 3.5, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 65, fontStyle: 'bold' },
      1: { cellWidth: 60 },
      2: { cellWidth: 160 },
      3: { cellWidth: 70 },
      4: { cellWidth: 60 },
      5: { cellWidth: 70, halign: 'right' },
      6: { cellWidth: 70, halign: 'center' },
    },
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.setFont('helvetica', 'normal');
      doc.text(textoPdf(`Emitido por Retenciones & Libro Fiscal · ${new Date().toLocaleDateString('es-VE')}`), M, H - M / 2);
      doc.text(textoPdf(`Página ${doc.getCurrentPageInfo().pageNumber}`), W - M, H - M / 2, { align: 'right' });
    },
  });

  const slug = empresa.codigo.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await previewPdf(doc, `reporte-fiscal-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

