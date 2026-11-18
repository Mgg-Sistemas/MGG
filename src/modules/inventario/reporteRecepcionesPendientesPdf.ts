/* ============================================================
   MGG · Reporte Dinámico de Pendientes por Recepcionar (PDF)
   ============================================================ */

import { previewPdf } from '@/shared/lib/reportePreview';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { money } from '@/shared/lib/format';
import type { FilaRecepcionPendiente, FiltrosRecepcionesPendientes } from './reporteRecepcionesPendientes';
import { calcularTotalesRecepciones } from './reporteRecepcionesPendientes';

export async function generarReporteRecepcionesPdf(
  filas: FilaRecepcionPendiente[],
  filtros?: FiltrosRecepcionesPendientes,
  actor?: string,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const logo = await loadLogoDataUrl().catch(() => null);
  let y = 35;

  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', 36, y - 10, 52, 52);
    } catch {
      /* ignore */
    }
  }

  // Encabezado institucional
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59);
  doc.text('MINERAL GROUP GUAYANA C.A.', 98, y + 8);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(217, 119, 6); // primary / ámbar
  doc.text('REPORTE DE MERCANCÍA PENDIENTE POR RECEPCIONAR EN ALMACÉN', 98, y + 23);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(220, 38, 38); // Rojo alerta
  doc.text('ALERTA: NO HA LLEGADO A ALMACEN - DAR STATUS', 98, y + 36);

  const ahora = new Date();
  const fechaHoraStr = `${ahora.toLocaleDateString('es-VE')} ${ahora.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Emisión: ${fechaHoraStr}${actor ? ` · Por: ${actor}` : ''}`, 98, y + 49);

  // Filtros aplicados a la derecha
  const criteriosText: string[] = [];
  if (filtros?.sede) criteriosText.push(`Sede: ${filtros.sede}`);
  if (filtros?.analista) criteriosText.push(`Analista: ${filtros.analista}`);
  if (filtros?.tipo && filtros.tipo !== 'todos') criteriosText.push(`Tipo: ${filtros.tipo === 'oc' ? 'Solo OC' : 'Solo Directos'}`);
  if (filtros?.desde || filtros?.hasta) {
    criteriosText.push(`Rango: ${filtros.desde || '—'} al ${filtros.hasta || '—'}`);
  }

  if (criteriosText.length > 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Filtros: ${criteriosText.join(' | ')}`, pageWidth - 36, y + 8, { align: 'right' });
  }

  y += 62;

  // Resumen en recuadro destacado
  const totales = calcularTotalesRecepciones(filas);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(36, y, pageWidth - 72, 28, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);

  const txtResumen = [
    `Órdenes: ${totales.totalRegistros} (${totales.totalOc} OC · ${totales.totalDirectos} Compras directas)`,
    `Total Ítems: ${totales.totalItems} (${totales.totalUnidades} und. est.)`,
    totales.totalUsd > 0 ? `Total $: ${money(totales.totalUsd, 'USD')}` : null,
    totales.totalBs > 0 ? `Total Bs: ${money(totales.totalBs, 'Bs')}` : null,
  ].filter(Boolean).join('   |   ');

  doc.text(txtResumen, 48, y + 17);

  y += 36;

  // Tabla detallada
  const body = filas.map((f, i) => [
    String(i + 1),
    `${f.codigo}\n[${f.tipoEtiqueta}]`,
    f.fechaMontadaTxt,
    f.fechaPagoTxt,
    f.analista,
    f.proveedor,
    f.almacenSugerido,
    `${f.itemsCount} ítem(s)\n(${f.unidades} und.)`,
    money(f.monto, f.moneda),
    f.estado,
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 36, right: 36, bottom: 36 },
    head: [[
      '#',
      'Código / Tipo',
      'Fecha Montada',
      'Pagó Tesorería',
      'Analista Encargado',
      'Proveedor',
      'Destino Sugerido',
      'Ítems / Und.',
      'Monto Total',
      'Estado',
    ]],
    body,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 4,
      textColor: [30, 41, 59],
      valign: 'middle',
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      1: { cellWidth: 84, fontStyle: 'bold' },
      2: { cellWidth: 70, halign: 'center' },
      3: { cellWidth: 74, halign: 'center' },
      4: { cellWidth: 95 },
      5: { cellWidth: 105 },
      6: { cellWidth: 95 },
      7: { cellWidth: 62, halign: 'center' },
      8: { cellWidth: 75, halign: 'right', fontStyle: 'bold' },
      9: { cellWidth: 60, halign: 'center' },
    },
    didDrawPage: (data) => {
      const pageNumber = data.pageNumber;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Página ${pageNumber} · Mineral Group Guayana C.A. · Documento de Control Interno`,
        pageWidth / 2,
        pageHeight - 18,
        { align: 'center' },
      );
    },
  });

  const filename = `Pendientes_Recepcionar_${ahora.toISOString().slice(0, 10)}.pdf`;
  previewPdf(doc, filename);
}
