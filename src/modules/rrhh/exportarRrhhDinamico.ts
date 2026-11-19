/* ============================================================
   MGG · RRHH · Exportadores del Reporte Dinámico (04-11-2026)

   Generación de salidas profesionales para la suite de reportes de RRHH:
     - Excel (.xlsx) con estilos, cabeceras institucionales, totales y ancho automático
     - PDF vectorial (jsPDF + autotable) con logo, tarjetas KPI y tabla paginada
     - CSV con BOM UTF-8 compatible con hojas de cálculo en español
   ============================================================ */

import { previewPdfDoc, previewTexto, previewWorkbook } from '@/shared/lib/reportPreview';
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
  porcentajeSueldoBs,
} from './reporteRrhhDinamico';
import { GRADOS_INSTRUCCION, PARENTESCOS } from './fichaPersonal';
import {
  formatearCampoAnchoFijo,
  type CamposCargaMasivaFila,
  type ParametrosCargaMasivaNomina,
} from './cargaMasivaNomina';

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
  tasaBcvTexto?: string;
  paramsCargaMasiva?: ParametrosCargaMasivaNomina;
}

/** Obtiene el texto formateado de una celda según su columna. */
export function textoCeldaRrhh(f: FilaReporteRrhh, clave: string): string {
  if (clave.startsWith('cm_')) {
    return f.cargaMasiva?.[clave as keyof CamposCargaMasivaFila] ?? '';
  }
  switch (clave) {
    case 'empresa':
      return f.empresaNombre || f.empresaKey || '—';
    case 'ficha':
      return f.ficha || '—';
    case 'nombre_completo':
      return f.nombreCompleto || '—';
    case 'cedula':
      return f.cedula || '—';
    case 'rif':
      return f.rif || '—';
    case 'nacionalidad':
      return f.nacionalidad || '—';
    case 'cargo':
      return f.cargo || '—';
    case 'departamento':
      return f.departamento || '—';
    case 'estado':
      return f.estado === 'activo' ? 'Activo' : 'Inactivo';
    case 'genero':
      return f.genero === 'masculino' ? 'M' : f.genero === 'femenino' ? 'F' : '—';
    case 'estado_civil':
      return f.estadoCivil ? f.estadoCivil.charAt(0).toUpperCase() + f.estadoCivil.slice(1) : '—';
    case 'fecha_nacimiento':
      return f.fechaNacimiento || '—';
    case 'edad':
      return f.edad != null ? `${f.edad} años` : '—';
    case 'grupo_sanguineo':
      return f.grupoSanguineo || '—';
    case 'fecha_ingreso':
      return f.fechaIngreso || '—';
    case 'antiguedad':
      return f.antiguedadTexto || '—';
    case 'carnet_vence':
      return f.carnetVence || '—';
    case 'grado_instruccion':
      if (!f.gradoInstruccion) return '—';
      return (
        GRADOS_INSTRUCCION.find((x) => x.key === f.gradoInstruccion)?.label ??
        f.gradoInstruccion.charAt(0).toUpperCase() + f.gradoInstruccion.slice(1)
      );
    case 'titulo_obtenido':
      return f.tituloObtenido || '—';
    case 'telefono':
      return f.telefono || '—';
    case 'correo':
      return f.correo || '—';
    case 'direccion':
      return f.direccion || '—';
    case 'contacto_emergencia':
      return f.contactoEmergencia || '—';
    case 'contacto_emergencia_parentesco':
      if (!f.contactoEmergenciaParentesco) return '—';
      return (
        PARENTESCOS.find((x) => x.key === f.contactoEmergenciaParentesco)?.label ??
        f.contactoEmergenciaParentesco
      );
    case 'contacto_emergencia_tlf':
      return f.contactoEmergenciaTlf || '—';
    case 'alergias':
      return f.alergias || '—';
    case 'enfermedades':
      return f.enfermedades || '—';
    case 'trabajo_anterior':
      return f.trabajoAnterior || '—';
    case 'tiene_hijos':
      return f.tieneHijos ? 'Sí' : 'No';
    case 'cantidad_hijos':
      return String(f.cantidadHijos || 0);
    case 'hijos_menores':
      return String(f.hijosMenores || 0);
    case 'carga_familiar':
      return String(f.cargaFamiliar || 0);
    case 'detalle_familiares':
      return f.detalleFamiliares || '—';
    case 'datos_pago':
      return f.datosPago || '—';
    case 'sueldo_base':
      return fmtMonedaUsd(f.sueldoBase);
    case 'sueldo_bs':
      return fmtMonedaBs(f.sueldoBs);
    case 'sueldo_bs_20':
      return fmtMonedaBs(porcentajeSueldoBs(f.sueldoBs, 0.2));
    case 'sueldo_bs_80':
      return fmtMonedaBs(porcentajeSueldoBs(f.sueldoBs, 0.8));
    case 'sueldo_bs_100':
      return fmtMonedaBs(porcentajeSueldoBs(f.sueldoBs, 1));
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
export function generarNombreArchivoRrhh(ambito: AmbitoRrhh, ext: 'xlsx' | 'pdf' | 'csv' | 'txt'): string {
  const fecha = new Date().toISOString().slice(0, 10);
  return `rrhh-${ambito.replace(/_/g, '-')}-${fecha}.${ext}`;
}

/* ───────────── Constructores Puros de Contenido (Excel / CSV / TXT) ───────────── */

export function construirDatosExcelCargaMasiva(op: OpcionesExportacionRrhh): {
  cabecerasModelo: string[];
  filasModelo: string[][];
  anchosModelo: number[];
  cabecerasControl: string[];
  filasControl: (string | number)[][];
} {
  const columnas = CAMPOS_REPORTE_RRHH.filter((c) => op.columnasClaves.includes(c.clave));
  const cabecerasModelo = columnas.map((c) => c.cabeceraModelo ?? c.etiqueta);
  const filasModelo = op.filas.map((f) => columnas.map((c) => textoCeldaRrhh(f, c.clave)));
  const anchosModelo = columnas.map((c) => c.anchoExcel);

  const cabecerasControl = [
    'Correlativo',
    'Ficha',
    'Colaborador',
    'Tipo Doc.',
    'Cédula (15 díg.)',
    'Cargo',
    'Cód. Cargo',
    'Cód. Profesión',
    'Cód. Educación',
    'Oficina',
    'Tipo Cuenta',
    'Sueldo Base ($)',
    'Sueldo Básico (Bs)',
    'Sueldo 15 Dígitos',
  ];

  const filasControl: (string | number)[][] = op.filas.map((f) => [
    f.cargaMasiva?.cm_02_correlativo ?? '',
    f.ficha ?? '—',
    f.nombreCompleto,
    f.cargaMasiva?.cm_03_tipo_doc ?? 'V',
    f.cargaMasiva?.cm_04_cedula ?? '',
    f.cargo,
    f.cargaMasiva?.cm_41_tipo_cargo ?? '',
    f.cargaMasiva?.cm_33_profesion ?? '',
    f.cargaMasiva?.cm_32_nivel_educacion ?? '',
    f.cargaMasiva?.cm_42_oficina_principal ?? '',
    f.cargaMasiva?.cm_38_tipo_cuenta ?? '',
    f.sueldoBase,
    f.sueldoBsCargaMasiva ?? 0,
    f.cargaMasiva?.cm_39_sueldo_basico ?? '',
  ]);

  return { cabecerasModelo, filasModelo, anchosModelo, cabecerasControl, filasControl };
}

/** Genera el contenido CSV (UTF-8 con BOM, separado por `;`). */
export function generarContenidoCsvRrhh(op: OpcionesExportacionRrhh): string {
  const columnas = CAMPOS_REPORTE_RRHH.filter((c) => op.columnasClaves.includes(c.clave));

  if (op.ambito === 'carga_masiva_nomina') {
    const cabeceras = columnas.map((c) => `"${(c.cabeceraModelo ?? c.etiqueta).replace(/"/g, '""')}"`);
    const filas = op.filas.map((f) =>
      columnas.map((c) => `"${textoCeldaRrhh(f, c.clave).replace(/"/g, '""')}"`).join(';'),
    );
    return ['\uFEFF' + cabeceras.join(';'), ...filas].join('\r\n');
  }

  const cabeceras = ['N°', ...columnas.map((c) => `"${c.etiqueta.replace(/"/g, '""')}"`)];
  const filas = op.filas.map((f, i) => {
    const vals = columnas.map((c) => `"${textoCeldaRrhh(f, c.clave).replace(/"/g, '""')}"`);
    return [i + 1, ...vals].join(';');
  });
  return ['\uFEFF' + cabeceras.join(';'), ...filas].join('\r\n');
}

/**
 * Genera el contenido TXT:
 *  - En `carga_masiva_nomina`: formato plano bancario de ancho fijo sin comillas ni encabezados
 *    (idéntico a la macro `ExportText` del modelo oficial `1-FORMATO CARGA MASIVA-MONEDA NACIONAL`).
 *  - En los demás ámbitos: texto tabulado con encabezados.
 */
export function generarContenidoTxtRrhh(op: OpcionesExportacionRrhh): string {
  const columnas = CAMPOS_REPORTE_RRHH.filter((c) => op.columnasClaves.includes(c.clave));

  if (op.ambito === 'carga_masiva_nomina') {
    return op.filas
      .map((f) => columnas.map((c) => formatearCampoAnchoFijo(textoCeldaRrhh(f, c.clave), c.anchoExcel)).join(''))
      .join('\r\n');
  }

  const cabeceras = ['N°', ...columnas.map((c) => c.etiqueta)].join('\t');
  const filas = op.filas.map((f, i) =>
    [i + 1, ...columnas.map((c) => textoCeldaRrhh(f, c.clave))].join('\t'),
  );
  return [cabeceras, ...filas].join('\r\n');
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

  if (op.ambito === 'carga_masiva_nomina') {
    const { cabecerasModelo, filasModelo, anchosModelo, cabecerasControl, filasControl } =
      construirDatosExcelCargaMasiva(op);

    // Hoja 1: MODELO (formato bancario puro con celdas de texto `@` para preservar ceros a la izquierda)
    const wsModelo = XLSX.utils.aoa_to_sheet([cabecerasModelo, ...filasModelo]);
    wsModelo['!cols'] = anchosModelo.map((wch) => ({ wch: Math.max(wch, 6) }));

    const headerStyle = {
      font: { name: 'Arial', sz: 9, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '1E293B' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
        left: { style: 'thin', color: { rgb: 'CBD5E1' } },
        right: { style: 'thin', color: { rgb: 'CBD5E1' } },
      },
    };
    const textCellStyle = {
      font: { name: 'Consolas', sz: 9.5 },
      numFmt: '@',
      alignment: { vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
        left: { style: 'thin', color: { rgb: 'E2E8F0' } },
        right: { style: 'thin', color: { rgb: 'E2E8F0' } },
      },
    };

    cabecerasModelo.forEach((_, c) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      const cell = wsModelo[addr] as Record<string, unknown> | undefined;
      if (cell) cell.s = headerStyle;
    });

    filasModelo.forEach((fila, rIdx) => {
      fila.forEach((val, cIdx) => {
        const addr = XLSX.utils.encode_cell({ r: rIdx + 1, c: cIdx });
        wsModelo[addr] = {
          t: 's',
          v: String(val ?? ''),
          z: '@',
          s: textCellStyle,
        };
      });
    });

    // Hoja 2: RESUMEN CONTROL (verificación administrativa legible en $ y Bs)
    const totalUsd = op.filas.reduce((a, f) => a + (f.sueldoBase || 0), 0);
    const totalBs = op.filas.reduce((a, f) => a + (f.sueldoBsCargaMasiva || 0), 0);
    const aoaControl: unknown[][] = [
      ['CARGA MASIVA - NÓMINA (MONEDA NACIONAL) · CONTROL INTERNO · MGG'],
      [`Empresas: ${op.empresasTexto} | Registros: ${op.filas.length} | ${new Date().toLocaleDateString('es-VE')}`],
      ...(op.tasaBcvTexto ? [[op.tasaBcvTexto]] : []),
      [],
      cabecerasControl,
      ...filasControl,
      ['TOTALES', '', `${op.filas.length} trabajadores`, '', '', '', '', '', '', '', '', totalUsd, totalBs, ''],
    ];
    const wsControl = XLSX.utils.aoa_to_sheet(aoaControl);
    wsControl['!cols'] = [
      { wch: 12 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 18 },
      { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
      { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 18 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsModelo, 'MODELO');
    XLSX.utils.book_append_sheet(wb, wsControl, 'RESUMEN CONTROL');
    previewWorkbook(XLSX, wb, generarNombreArchivoRrhh(op.ambito, 'xlsx'));
    return;
  }

  const columnas = CAMPOS_REPORTE_RRHH.filter((c) => op.columnasClaves.includes(c.clave));
  const ambitoLabel = AMBITOS_RRHH.find((a) => a.id === op.ambito)?.label ?? 'Reporte';
  const agrupacionLabel = MODOS_AGRUPACION_RRHH.find((m) => m.id === op.agrupacion)?.label ?? 'Detallado';

  const cabeceras = ['N°', ...columnas.map((c) => c.etiqueta)];
  const filasDatos = op.filas.map((f, i) => [
    i + 1,
    ...columnas.map((c) => {
      const txt = textoCeldaRrhh(f, c.clave);
      if (c.formato === 'numero') return txt === '—' ? '—' : Number(txt) || 0;
      return txt;
    }),
  ]);

  const aoa: unknown[][] = [
    [`REPORTE DE RRHH · ${ambitoLabel.toUpperCase()} · MGG`],
    [`Empresas: ${op.empresasTexto} | Agrupación: ${agrupacionLabel} | ${new Date().toLocaleDateString('es-VE')}`],
    ...(op.tasaBcvTexto ? [[op.tasaBcvTexto]] : []),
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

  if (op.tasaBcvTexto) {
    if (op.tasaBcvTexto.startsWith('AVISO')) {
      doc.setTextColor(COLOR_NARANJA_RGB[0], COLOR_NARANJA_RGB[1], COLOR_NARANJA_RGB[2]);
    }
    doc.text(op.tasaBcvTexto, tx, y + 54);
    doc.setTextColor(100);
  }

  y += LOGO_SZ + (op.tasaBcvTexto ? 22 : 8);
  doc.setDrawColor(COLOR_NARANJA_RGB[0], COLOR_NARANJA_RGB[1], COLOR_NARANJA_RGB[2]);
  doc.setLineWidth(1.5);
  doc.line(MARGEN_PDF, y, W - MARGEN_PDF, y);
  y += 12;

  // Tarjetas KPI ejecutivas en cabecera
  const kpis = obtenerMetricasFichaRrhh(op.resumen, op.ambito, op.columnasClaves, op.paramsCargaMasiva);
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

  const columnStyles: Record<number, { halign?: 'left' | 'right' | 'center'; cellWidth?: 'wrap' | 'auto' | number }> = {
    0: { halign: 'center', cellWidth: 'wrap' },
  };
  columnas.forEach((c, idx) => {
    columnStyles[idx + 1] = {
      halign: c.alineacion,
      ...(op.ambito === 'carga_masiva_nomina' && c.anchoExcel <= 15 ? { cellWidth: 'wrap' as const } : {}),
    };
  });

  const muchasCols = columnas.length > 14;
  const mediaCols = columnas.length > 10;
  const idxNombre = columnas.findIndex((c) => c.clave === 'nombre_completo');
  const idxCorr = columnas.findIndex((c) => c.clave === 'cm_02_correlativo');
  const idxApellido = columnas.findIndex((c) => c.clave === 'cm_05_primer_apellido');

  let repeatCols: number | number[] | undefined;
  if (muchasCols) {
    if (op.ambito === 'carga_masiva_nomina') {
      const fijos = [0];
      if (idxCorr >= 0) fijos.push(idxCorr + 1);
      if (idxApellido >= 0) fijos.push(idxApellido + 1);
      repeatCols = fijos;
    } else {
      repeatCols = idxNombre >= 0 ? [0, idxNombre + 1] : 0;
    }
  }

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    theme: 'grid',
    horizontalPageBreak: muchasCols,
    horizontalPageBreakRepeat: repeatCols,
    headStyles: {
      fillColor: COLOR_NARANJA_RGB,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: muchasCols ? 6.8 : mediaCols ? 7.2 : 8,
      halign: 'center',
      valign: 'middle',
    },
    styles: {
      fontSize: muchasCols ? 6.5 : mediaCols ? 7 : 7.5,
      cellPadding: muchasCols ? 2.5 : mediaCols ? 3 : 3.5,
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

/* ───────────── Exportador a CSV y TXT ───────────── */

export function descargarRrhhCsv(op: OpcionesExportacionRrhh): void {
  const contenido = generarContenidoCsvRrhh(op);
  previewTexto(contenido, generarNombreArchivoRrhh(op.ambito, 'csv'), 'CSV', 'text/csv;charset=utf-8;');
}

export function descargarRrhhTxt(op: OpcionesExportacionRrhh): void {
  const contenido = generarContenidoTxtRrhh(op);
  previewTexto(contenido, generarNombreArchivoRrhh(op.ambito, 'txt'), 'TXT', 'text/plain;charset=utf-8;');
}

