/* ============================================================
   MGG · RRHH · Exportadores del Reporte Dinámico (04-11-2026)

   Generación de salidas profesionales para la suite de reportes de RRHH:
     - Excel (.xlsx) con estilos, cabeceras institucionales, totales y ancho automático
     - PDF vectorial (jsPDF + autotable) con logo, tarjetas KPI y tabla paginada
     - CSV con BOM UTF-8 compatible con hojas de cálculo en español
   ============================================================ */

import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import type {
  AmbitoRrhh,
  FilaReporteRrhh,
  ModoAgrupacionRrhh,
  ResumenReporteRrhh,
} from './reporteRrhhDinamico';
import {
  AMBITOS_RRHH,
  CAMPOS_REPORTE_RRHH,
  fmtMonedaBs,
  fmtMonedaUsd,
  fmtNum2,
  fmtPct,
  MODOS_AGRUPACION_RRHH,
  obtenerMetricasFichaRrhh,
} from './reporteRrhhDinamico';

const COLOR_NARANJA_RGB: [number, number, number] = [255, 138, 0];
const COLOR_TINTA_RGB: [number, number, number] = [30, 41, 59];
const COLOR_BORDE_RGB: [number, number, number] = [203, 213, 225];

export interface OpcionesExportacionRrhh {
  ambito: AmbitoRrhh;
  agrupacion: ModoAgrupacionRrhh;
  columnasClaves: string[];
  empresasTexto: string;
  resumen: ResumenReporteRrhh;
  filas: FilaReporteRrhh[];
  orientacion?: 'auto' | 'vertical' | 'horizontal';
  desde?: string;
  hasta?: string;
}

/** Obtiene el texto formateado de una celda según su columna. */
export function textoCeldaRrhh(f: FilaReporteRrhh, clave: string): string {
  switch (clave) {
    case 'empresa':
      return f.empresaNombre || f.empresaKey || '—';
    case 'ficha':
      return f.ficha || '—';
    case 'nombre_completo':
      return f.nombreCompleto || '—';
    case 'cedula':
      return f.cedula || '—';
    case 'cargo':
      return f.cargo || '—';
    case 'departamento':
      return f.departamento || '—';
    case 'estado':
      return f.estado === 'activo' ? 'Activo' : 'Inactivo';
    case 'genero':
      return f.genero === 'masculino' ? 'M' : f.genero === 'femenino' ? 'F' : '—';
    case 'fecha_nacimiento':
      return f.fechaNacimiento || '—';
    case 'fecha_ingreso':
      return f.fechaIngreso || '—';
    case 'antiguedad':
      return f.antiguedadTexto || '—';
    case 'tiene_hijos':
      return f.tieneHijos ? 'Sí' : 'No';
    case 'cantidad_hijos':
      return String(f.cantidadHijos || 0);
    case 'hijos_menores':
      return String(f.hijosMenores || 0);
    case 'carga_familiar':
      return String(f.cargaFamiliar || 0);
    case 'telefono':
      return f.telefono || '—';
    case 'datos_pago':
      return f.datosPago || '—';
    case 'sueldo_base':
      return fmtMonedaUsd(f.sueldoBase);
    case 'sueldo_bs':
      return fmtMonedaBs(f.sueldoBs);
    case 'total_personas':
      return String(f.totalPersonas || 1);
    case 'masa_salarial':
      return fmtMonedaUsd(f.masaSalarialUsd ?? f.sueldoBase);
    case 'sueldo_promedio':
      return fmtMonedaUsd(f.sueldoPromedioUsd ?? f.sueldoBase);
    case 'pct_total':
      return f.pctTotal != null ? `${fmtNum2(f.pctTotal)}%` : '—';
    case 'fecha_vigencia':
      return f.fechaVigencia || '—';
    case 'sueldo_anterior':
      return f.sueldoAnterior != null ? fmtMonedaUsd(f.sueldoAnterior) : '—';
    case 'sueldo_nuevo':
      return f.sueldoNuevo != null ? fmtMonedaUsd(f.sueldoNuevo) : '—';
    case 'variacion_usd':
      return f.variacionUsd != null ? fmtMonedaUsd(f.variacionUsd) : '—';
    case 'variacion_pct':
      return f.variacionPct != null ? fmtPct(f.variacionPct) : '—';
    case 'motivo':
      return f.motivo || '—';
    case 'tipo_cambio':
      return f.tipoCambio || '—';
    case 'autor':
      return f.autor || '—';
    default:
      return String((f as unknown as Record<string, unknown>)[clave] ?? '-');
  }
}

/** Nombre de archivo normalizado. */
export function generarNombreArchivoRrhh(ambito: AmbitoRrhh, ext: 'xlsx' | 'pdf' | 'csv'): string {
  const fecha = new Date().toISOString().slice(0, 10);
  return `rrhh-${ambito.replace(/_/g, '-')}-${fecha}.${ext}`;
}

/* ───────────── Exportador a Excel (.xlsx) ───────────── */

export async function descargarRrhhExcel(op: OpcionesExportacionRrhh): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };

  const columnas = CAMPOS_REPORTE_RRHH.filter((c) => op.columnasClaves.includes(c.clave));
  const ambitoLabel = AMBITOS_RRHH.find((a) => a.id === op.ambito)?.label ?? 'Reporte';
  const agrupacionLabel = MODOS_AGRUPACION_RRHH.find((m) => m.id === op.agrupacion)?.label ?? 'Detallado';

  const cabeceras = ['N°', ...columnas.map((c) => c.etiqueta)];
  const filasDatos = op.filas.map((f, i) => [
    i + 1,
    ...columnas.map((c) => {
      const txt = textoCeldaRrhh(f, c.clave);
      if (c.formato === 'numero') return Number(txt) || 0;
      return txt;
    }),
  ]);

  const aoa: unknown[][] = [
    [`REPORTE DE RRHH · ${ambitoLabel.toUpperCase()} · MGG`],
    [`Empresas: ${op.empresasTexto} | Agrupación: ${agrupacionLabel} | ${new Date().toLocaleDateString('es-VE')}`],
    [],
    cabeceras,
    ...filasDatos,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = [{ wch: 6 }, ...columnas.map((c) => ({ wch: c.anchoExcel }))];

  const wb = XLSX.utils.book_new();
  const nombreHoja = ambitoLabel.slice(0, 30);
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja);

  previewWorkbook(XLSX, wb, generarNombreArchivoRrhh(op.ambito, 'xlsx'));
}

/* ───────────── Exportador a PDF Vectorial (.pdf) ───────────── */

export async function descargarRrhhPdf(op: OpcionesExportacionRrhh): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const columnas = CAMPOS_REPORTE_RRHH.filter((c) => op.columnasClaves.includes(c.clave));
  const anchoTotal = columnas.reduce((acc, c) => acc + c.anchoExcel, 0);
  const esHorizontal = op.orientacion === 'horizontal' || (op.orientacion === 'auto' && anchoTotal > 80);

  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
    orientation: esHorizontal ? 'landscape' : 'portrait',
  });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const logo = await loadLogoDataUrl().catch(() => null);

  let y = MARGEN_PDF;
  const LOGO_SZ = 44;
  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', MARGEN_PDF, y, LOGO_SZ, LOGO_SZ);
    } catch {
      /* logo opcional */
    }
  }

  const tx = logo ? MARGEN_PDF + LOGO_SZ + 14 : MARGEN_PDF;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(COLOR_NARANJA_RGB[0], COLOR_NARANJA_RGB[1], COLOR_NARANJA_RGB[2]);
  doc.text('MINERAL GROUP GUAYANA C.A. · RECURSOS HUMANOS', tx, y + 12);

  const ambitoLabel = AMBITOS_RRHH.find((a) => a.id === op.ambito)?.label ?? 'Reporte';
  doc.setTextColor(COLOR_TINTA_RGB[0], COLOR_TINTA_RGB[1], COLOR_TINTA_RGB[2]);
  doc.setFontSize(14);
  doc.text(`Reporte: ${ambitoLabel}`, tx, y + 28);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  const infoSub = `Empresas: ${op.empresasTexto} · Agrupación: ${op.agrupacion.toUpperCase()} · ${new Date().toLocaleDateString('es-VE')}`;
  doc.text(infoSub, tx, y + 42);

  y += LOGO_SZ + 8;
  doc.setDrawColor(COLOR_NARANJA_RGB[0], COLOR_NARANJA_RGB[1], COLOR_NARANJA_RGB[2]);
  doc.setLineWidth(1.5);
  doc.line(MARGEN_PDF, y, W - MARGEN_PDF, y);
  y += 12;

  // Tarjetas KPI ejecutivas en cabecera
  const kpis = obtenerMetricasFichaRrhh(op.resumen, op.ambito, op.columnasClaves);
  const cardW = (anchoUtilPdf(W) - (kpis.length - 1) * 8) / kpis.length;
  const cardH = 38;

  kpis.forEach((k, idx) => {
    const cx = MARGEN_PDF + idx * (cardW + 8);
    doc.setFillColor(250, 246, 240);
    doc.roundedRect(cx, y, cardW, cardH, 3, 3, 'F');
    doc.setDrawColor(k.colorRgb[0], k.colorRgb[1], k.colorRgb[2]);
    doc.setLineWidth(1);
    doc.roundedRect(cx, y, cardW, cardH, 3, 3, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(k.colorRgb[0], k.colorRgb[1], k.colorRgb[2]);
    doc.text(k.etiqueta.slice(0, 22), cx + 6, y + 11);

    doc.setFontSize(10);
    doc.setTextColor(COLOR_TINTA_RGB[0], COLOR_TINTA_RGB[1], COLOR_TINTA_RGB[2]);
    doc.text(k.valor, cx + 6, y + 24);

    if (k.sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(110);
      doc.text(k.sub.slice(0, 28), cx + 6, y + 33);
    }
  });

  y += cardH + 14;

  // Configuración de tabla
  const head = ['#', ...columnas.map((c) => c.etiqueta)];
  const body = op.filas.map((f, i) => [i + 1, ...columnas.map((c) => textoCeldaRrhh(f, c.clave))]);

  const columnStyles: Record<number, { halign?: 'left' | 'right' | 'center' }> = {
    0: { halign: 'center' },
  };
  columnas.forEach((c, idx) => {
    columnStyles[idx + 1] = { halign: c.alineacion };
  });

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    theme: 'grid',
    headStyles: {
      fillColor: COLOR_NARANJA_RGB,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
      valign: 'middle',
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 3.5,
      overflow: 'linebreak',
      valign: 'middle',
      textColor: COLOR_TINTA_RGB,
      lineColor: COLOR_BORDE_RGB,
      lineWidth: 0.5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles,
    margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 16 },
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      doc.text(`Página ${n}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
    },
  });

  previewPdfDoc(doc, generarNombreArchivoRrhh(op.ambito, 'pdf'));
}

/* ───────────── Exportador a CSV ───────────── */

export function descargarRrhhCsv(op: OpcionesExportacionRrhh): void {
  const columnas = CAMPOS_REPORTE_RRHH.filter((c) => op.columnasClaves.includes(c.clave));
  const cabeceras = ['N°', ...columnas.map((c) => `"${c.etiqueta.replace(/"/g, '""')}"`)];

  const filas = op.filas.map((f, i) => {
    const vals = columnas.map((c) => `"${textoCeldaRrhh(f, c.clave).replace(/"/g, '""')}"`);
    return [i + 1, ...vals].join(';');
  });

  const contenido = ['\uFEFF' + cabeceras.join(';'), ...filas].join('\r\n');
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = generarNombreArchivoRrhh(op.ambito, 'csv');
  a.click();
  URL.revokeObjectURL(url);
}

