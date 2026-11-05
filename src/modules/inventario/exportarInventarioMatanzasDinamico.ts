/* ============================================================
   MGG · Inventario · Exportadores del Reporte Dinámico · Matanzas (04-11-2026)

   Generación de salidas profesionales para el Centro de Fundición Matanzas:
     - Excel (.xlsx) con estilos, cabeceras institucionales, totales y ancho automático
     - PDF vectorial (jsPDF + autotable) con logo, tarjetas KPI reactivas y tabla paginada
     - CSV con BOM UTF-8 compatible con hojas de cálculo en español
   ============================================================ */

import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf } from '@/shared/lib/pdfMargen';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import type {
  AmbitoInventarioMatanzas,
  CampoColumnaMatanzas,
  FilaReporteMatanzas,
  ModoAgrupacionMatanzas,
  ResumenReporteMatanzas,
} from './reporteInventarioMatanzasDinamico';
import {
  AMBITOS_INVENTARIO_MATANZAS,
  CAMPOS_REPORTE_MATANZAS,
  formatearCeldaMatanzas,
  obtenerMetricasFichaMatanzas,
} from './reporteInventarioMatanzasDinamico';

const COLOR_NARANJA_RGB: [number, number, number] = [255, 138, 0];
const COLOR_TINTA_RGB: [number, number, number] = [30, 41, 59];
const COLOR_BORDE_RGB: [number, number, number] = [203, 213, 225];

export interface OpcionesExportacionMatanzas {
  ambito: AmbitoInventarioMatanzas;
  agrupacion: ModoAgrupacionMatanzas;
  columnasClaves: string[];
  subalmacenesTexto: string;
  resumen: ResumenReporteMatanzas;
  filas: FilaReporteMatanzas[];
  orientacion?: 'auto' | 'vertical' | 'horizontal';
  desde?: string;
  hasta?: string;
}

/** Obtiene la definición de un campo del catálogo según su clave. */
function encontrarCampo(clave: string): CampoColumnaMatanzas {
  return (
    CAMPOS_REPORTE_MATANZAS.find((c) => c.clave === clave) ?? {
      clave,
      etiqueta: clave.toUpperCase(),
      anchoExcel: 16,
      alineacion: 'left',
      formato: 'texto',
      ambitos: ['stock'],
    }
  );
}

/* ───────────── 1. Exportador Excel (.xlsx) ───────────── */

export async function descargarInventarioMatanzasExcel(opts: OpcionesExportacionMatanzas): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };

  const ambitoMeta = AMBITOS_INVENTARIO_MATANZAS.find((a) => a.id === opts.ambito);
  const camposSel = opts.columnasClaves.map(encontrarCampo);

  const ESTILO_TITULO = {
    font: { name: 'Arial', sz: 14, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
    alignment: { horizontal: 'left', vertical: 'center' },
  };

  const ESTILO_SUBTITULO = {
    font: { name: 'Arial', sz: 9, italic: true, color: { rgb: '475569' } },
    alignment: { horizontal: 'left', vertical: 'center' },
  };

  const ESTILO_KPI_HEADER = {
    font: { name: 'Arial', sz: 8, bold: true, color: { rgb: '64748B' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'CBD5E1' } },
      bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
      left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      right: { style: 'thin', color: { rgb: 'CBD5E1' } },
    },
  };

  const ESTILO_KPI_VALOR = {
    font: { name: 'Arial', sz: 11, bold: true, color: { rgb: '0F172A' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'CBD5E1' } },
      bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
      left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      right: { style: 'thin', color: { rgb: 'CBD5E1' } },
    },
  };

  const ESTILO_TH = {
    font: { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: '0F172A' } },
      bottom: { style: 'medium', color: { rgb: 'FF8A00' } },
      left: { style: 'thin', color: { rgb: '334155' } },
      right: { style: 'thin', color: { rgb: '334155' } },
    },
  };

  const ESTILO_TD_BASE = {
    font: { name: 'Arial', sz: 9, color: { rgb: '1E293B' } },
    border: {
      bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
      left: { style: 'thin', color: { rgb: 'F1F5F9' } },
      right: { style: 'thin', color: { rgb: 'F1F5F9' } },
    },
  };

  const ESTILO_TOTALES = {
    font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '0F172A' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'E2E8F0' } },
    border: {
      top: { style: 'medium', color: { rgb: 'FF8A00' } },
      bottom: { style: 'double', color: { rgb: '0F172A' } },
    },
  };

  const aoa: unknown[][] = [];

  // Fila 0: Título principal
  aoa.push([`MINERAL GROUP GUAYANA · REPORTE DINÁMICO DE INVENTARIO · MATANZAS`]);
  // Fila 1: Ámbito y Subalmacenes
  aoa.push([`Ámbito: ${ambitoMeta?.label || opts.ambito.toUpperCase()} · Subalmacenes: ${opts.subalmacenesTexto}`]);
  // Fila 2: Metadatos de fecha y tasa BCV
  const ahora = new Date().toLocaleString('es-VE');
  aoa.push([`Generado: ${ahora} · Tasa BCV: ${opts.resumen.tasaBcv} Bs/$ · Registros: ${opts.filas.length}`]);
  aoa.push([]); // Fila 3 vacía

  // Tarjetas KPI Reactivas en filas 4 y 5
  const kpis = obtenerMetricasFichaMatanzas(opts.resumen, opts.ambito, opts.columnasClaves);
  const kpiHeadersRow: string[] = [];
  const kpiValuesRow: string[] = [];
  for (const k of kpis) {
    kpiHeadersRow.push(k.etiqueta);
    kpiValuesRow.push(k.valor);
  }
  aoa.push(kpiHeadersRow);
  aoa.push(kpiValuesRow);
  aoa.push([]); // Fila 6 vacía

  // Cabecera de la tabla de datos (Fila 7)
  const filaHeaderTabla = aoa.length;
  aoa.push(camposSel.map((c) => c.etiqueta));

  // Filas de datos
  for (const f of opts.filas) {
    const filaDato = camposSel.map((c) => {
      const raw = f[c.clave];
      if (raw == null || raw === '') return '—';
      if (c.formato === 'numero' || c.formato === 'peso_kg' || c.formato === 'moneda' || c.formato === 'moneda_bs' || c.formato === 'porcentaje') {
        const num = Number(raw);
        return Number.isFinite(num) ? num : String(raw);
      }
      return String(raw);
    });
    aoa.push(filaDato);
  }

  // Fila de totales o pie de tabla
  const filaTotales = camposSel.map((c, idx) => {
    if (idx === 0) return 'TOTALES / RESUMEN';
    if (c.clave === 'stock' || c.clave === 'cantidad' || c.clave === 'deficit') {
      return opts.resumen.totalUnidades;
    }
    if (c.clave === 'valor_usd' || c.clave === 'costo_total') {
      return opts.resumen.valuacionTotalUsd;
    }
    if (c.clave === 'valor_bs') {
      return opts.resumen.valuacionTotalBs;
    }
    if (c.clave === 'peso_seco') {
      return opts.resumen.pesoSecoKg;
    }
    if (c.clave === 'peso_puro_sn') {
      return opts.resumen.pesoPuroSnKg;
    }
    return '';
  });
  aoa.push(filaTotales);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Anchos de columna
  (ws as Record<string, unknown>)['!cols'] = camposSel.map((c) => ({
    wch: Math.max(c.anchoExcel, c.etiqueta.length + 3),
  }));

  // Merges en cabecera
  const ultimaColIdx = Math.max(camposSel.length - 1, 3);
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ultimaColIdx } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ultimaColIdx } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: ultimaColIdx } },
  ];

  // Aplicar estilos celda por celda
  const cellAt = (r: number, c: number) =>
    (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c })];

  const tCell = cellAt(0, 0);
  if (tCell) tCell.s = ESTILO_TITULO;
  const sCell = cellAt(1, 0);
  if (sCell) sCell.s = ESTILO_SUBTITULO;
  const mCell = cellAt(2, 0);
  if (mCell) mCell.s = ESTILO_SUBTITULO;

  // Estilos de tarjetas KPI
  for (let c = 0; c < kpiHeadersRow.length; c++) {
    const kh = cellAt(4, c);
    if (kh) kh.s = ESTILO_KPI_HEADER;
    const kv = cellAt(5, c);
    if (kv) kv.s = ESTILO_KPI_VALOR;
  }

  // Estilos de encabezados de la tabla
  for (let c = 0; c < camposSel.length; c++) {
    const th = cellAt(filaHeaderTabla, c);
    if (th) th.s = ESTILO_TH;
  }

  // Estilos de celdas de datos
  const totalFilasDatos = opts.filas.length;
  for (let r = 0; r < totalFilasDatos; r++) {
    const rIdx = filaHeaderTabla + 1 + r;
    const esPar = r % 2 === 0;
    const bg = esPar ? { rgb: 'FFFFFF' } : { rgb: 'F8FAFC' };

    for (let c = 0; c < camposSel.length; c++) {
      const td = cellAt(rIdx, c);
      if (td) {
        const campo = camposSel[c];
        td.s = {
          ...ESTILO_TD_BASE,
          fill: { patternType: 'solid', fgColor: bg },
          alignment: {
            horizontal: campo.alineacion,
            vertical: 'center',
          },
        };
      }
    }
  }

  // Estilo fila de totales
  const rTotalesIdx = filaHeaderTabla + 1 + totalFilasDatos;
  for (let c = 0; c < camposSel.length; c++) {
    const tdTot = cellAt(rTotalesIdx, c);
    if (tdTot) {
      tdTot.s = {
        ...ESTILO_TOTALES,
        alignment: {
          horizontal: camposSel[c].alineacion,
          vertical: 'center',
        },
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario Matanzas');

  const stamp = new Date().toISOString().slice(0, 10);
  previewWorkbook(XLSX, wb, `reporte-inventario-matanzas-${opts.ambito}-${stamp}.xlsx`);
}

/* ───────────── 2. Exportador PDF Vectorial ───────────── */

export async function descargarInventarioMatanzasPdf(opts: OpcionesExportacionMatanzas): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl().catch(() => null),
  ]);

  // Selección de orientación: vertical u horizontal según cantidad de columnas
  const orientacion =
    opts.orientacion === 'vertical'
      ? 'portrait'
      : opts.orientacion === 'horizontal'
      ? 'landscape'
      : opts.columnasClaves.length > 7
      ? 'landscape'
      : 'portrait';

  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
    orientation: orientacion,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margen = MARGEN_PDF;
  const margenTabla = MARGENES_TABLA_PDF;
  let y = margen;

  // Cabecera institucional: Logo + Título
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', margen, y - 8, 38, 38);
    } catch {
      /* opcional */
    }
  }

  const xTexto = logoDataUrl ? margen + 48 : margen;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(COLOR_NARANJA_RGB[0], COLOR_NARANJA_RGB[1], COLOR_NARANJA_RGB[2]);
  doc.text('MINERAL GROUP GUAYANA', xTexto, y + 4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(COLOR_TINTA_RGB[0], COLOR_TINTA_RGB[1], COLOR_TINTA_RGB[2]);
  const ambitoMeta = AMBITOS_INVENTARIO_MATANZAS.find((a) => a.id === opts.ambito);
  doc.text(`REPORTE DINÁMICO DE INVENTARIO · MATANZAS · ${ambitoMeta?.label.toUpperCase()}`, xTexto, y + 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Subalmacenes: ${opts.subalmacenesTexto} | BCV: ${opts.resumen.tasaBcv} Bs/$ | Fecha: ${new Date().toLocaleString('es-VE')}`,
    xTexto,
    y + 28,
  );

  y += 42;

  // Tarjetas KPI Reactivas en Cabecera
  const kpis = obtenerMetricasFichaMatanzas(opts.resumen, opts.ambito, opts.columnasClaves);
  const totalKpis = kpis.length;
  const utilWidth = anchoUtilPdf(pageWidth);
  const kpiGap = 8;
  const kpiWidth = (utilWidth - kpiGap * (totalKpis - 1)) / totalKpis;
  const kpiHeight = 36;

  kpis.forEach((k, idx) => {
    const kx = margen + idx * (kpiWidth + kpiGap);
    // Borde de la tarjeta
    doc.setDrawColor(COLOR_BORDE_RGB[0], COLOR_BORDE_RGB[1], COLOR_BORDE_RGB[2]);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(kx, y, kpiWidth, kpiHeight, 3, 3, 'FD');

    // Etiqueta
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(k.colorRgb[0], k.colorRgb[1], k.colorRgb[2]);
    doc.text(k.etiqueta, kx + 6, y + 10);

    // Valor principal
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(COLOR_TINTA_RGB[0], COLOR_TINTA_RGB[1], COLOR_TINTA_RGB[2]);
    doc.text(k.valor, kx + 6, y + 22);

    // Subtítulo
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(100, 116, 139);
    doc.text(k.sub.slice(0, 32), kx + 6, y + 31);
  });

  y += kpiHeight + 12;

  // Tabla AutoTable
  const camposSel = opts.columnasClaves.map(encontrarCampo);
  const headTable = [camposSel.map((c) => c.etiqueta)];
  const bodyTable = opts.filas.map((f) =>
    camposSel.map((c) => formatearCeldaMatanzas(f[c.clave], c.formato, c.clave)),
  );

  autoTable(doc, {
    startY: y,
    margin: margenTabla,
    head: headTable,
    body: bodyTable,
    styles: {
      fontSize: opts.columnasClaves.length > 9 ? 6.5 : 7.5,
      cellPadding: 3,
      textColor: [30, 41, 59],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didDrawPage: (data) => {
      // Pie de página con numeración
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      const str = `Página ${data.pageNumber} | Mineral Group Guayana · Matanzas`;
      doc.text(str, pageWidth / 2, pageHeight - 16, { align: 'center' });
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  previewPdfDoc(doc, `reporte-inventario-matanzas-${opts.ambito}-${stamp}.pdf`);
}

/* ───────────── 3. Exportador CSV con BOM UTF-8 ───────────── */

export function descargarInventarioMatanzasCsv(opts: OpcionesExportacionMatanzas): void {
  const camposSel = opts.columnasClaves.map(encontrarCampo);

  const escapeCsv = (v: unknown): string => {
    if (v == null) return '""';
    const s = String(v).replace(/"/g, '""');
    return `"${s}"`;
  };

  const lineas: string[] = [];

  // Encabezados
  lineas.push(camposSel.map((c) => escapeCsv(c.etiqueta)).join(';'));

  // Filas
  for (const f of opts.filas) {
    const filaStr = camposSel.map((c) => {
      const val = formatearCeldaMatanzas(f[c.clave], c.formato, c.clave);
      return escapeCsv(val);
    });
    lineas.push(filaStr.join(';'));
  }

  // BOM UTF-8 para compatibilidad absoluta con Microsoft Excel en español
  const csvContent = '\uFEFF' + lineas.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `reporte-inventario-matanzas-${opts.ambito}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

