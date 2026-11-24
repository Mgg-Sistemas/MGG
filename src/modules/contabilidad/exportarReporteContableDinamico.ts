/* ============================================================
   Golden Touch · Contabilidad · Exportador del Reporte Dinámico
   (18/11/2026)

   Exportación a PDF y Excel del Reporte Dinámico de Contabilidad:
     - 4 ámbitos: Asientos y Movimientos, Plan de Cuentas,
       Balances y Saldos, Períodos y Cierres.
     - Membrete institucional, logo corporativo y colores de marca.
     - Formato Bimoneda estricto (VES y USD) y verificación de cuadre.
     - Selección dinámica de columnas y opciones de salida (resumen,
       detallado o híbrido).
     - Preview interactivo: NADA se descarga solo.
   ============================================================ */

import { previewExcelArchivo, previewPdf } from '@/shared/lib/reportePreview';
import { anchoLogoPdf, dibujarLogoPdf, loadLogoPdfEmpresa } from '@/shared/lib/pdfLogo';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import {
  ETIQUETA_MODO_CONTABLE,
  obtenerCamposPorAmbito,
  type FilaReporteContable,
  type ReporteContableGenerado,
} from './logica/reporteContableDinamico';

const NARANJA: [number, number, number] = [255, 138, 0];
const TINTA: [number, number, number] = [15, 23, 42];

const fmtBs = (v: number | null | undefined) =>
  v == null ? '—' : `Bs ${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtUsd = (v: number | null | undefined) =>
  v == null ? '—' : `$ ${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFecha = (f: string) => {
  const [y, m, d] = (f || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : f || '—';
};

function obtenerValorCelda(f: FilaReporteContable, clave: string): string {
  switch (clave) {
    case 'fecha': return fmtFecha(f.fecha);
    case 'comprobante': return f.comprobante || '—';
    case 'tipo': return f.tipo || '—';
    case 'origen': return f.origen || '—';
    case 'referencia': return f.referencia || '—';
    case 'descripcion': return f.descripcion || '—';
    case 'cuenta_codigo': return f.cuenta_codigo || '—';
    case 'cuenta_nombre': return f.cuenta_nombre || '—';
    case 'centro': return f.centro || '—';
    case 'auxiliar': return f.auxiliar || '—';
    case 'moneda': return f.moneda || '—';
    case 'debe_ves': return f.debe_ves > 0 ? fmtNum(f.debe_ves) : '—';
    case 'haber_ves': return f.haber_ves > 0 ? fmtNum(f.haber_ves) : '—';
    case 'debe_usd': return f.debe_usd > 0 ? fmtNum(f.debe_usd) : '—';
    case 'haber_usd': return f.haber_usd > 0 ? fmtNum(f.haber_usd) : '—';
    case 'saldo_ves': return fmtNum(f.saldo_ves);
    case 'saldo_usd': return fmtNum(f.saldo_usd);

    // Plan de Cuentas:
    case 'nivel': return String(f.nivel ?? '—');
    case 'clase': return f.clase || '—';
    case 'naturaleza': return f.naturaleza || '—';
    case 'es_monetaria': return f.es_monetaria || '—';
    case 'exige_centro': return f.exige_centro || '—';
    case 'exige_auxiliar': return f.exige_auxiliar || '—';
    case 'tipo_auxiliar': return f.tipo_auxiliar || '—';
    case 'activa': return f.activa || '—';
    case 'padre_codigo': return f.padre_codigo || '—';

    // Balances:
    case 'saldo_inicial_ves': return fmtNum(f.saldo_inicial_ves ?? 0);
    case 'saldo_final_ves': return fmtNum(f.saldo_final_ves ?? 0);
    case 'saldo_inicial_usd': return fmtNum(f.saldo_inicial_usd ?? 0);
    case 'saldo_final_usd': return fmtNum(f.saldo_final_usd ?? 0);

    // Períodos:
    case 'ejercicio': return f.ejercicio || '—';
    case 'periodo_numero': return String(f.periodo_numero ?? '—');
    case 'periodo_nombre': return f.periodo_nombre || '—';
    case 'periodo_estado': return f.periodo_estado || '—';
    case 'fecha_inicio': return fmtFecha(f.fecha_inicio || '');
    case 'fecha_fin': return fmtFecha(f.fecha_fin || '');
    case 'fecha_cierre': return f.fecha_cierre ? fmtFecha(f.fecha_cierre) : '—';
    case 'cerrado_por': return f.cerrado_por || '—';
    case 'diferencial_aj_ves': return f.diferencial_aj_ves ? fmtNum(f.diferencial_aj_ves) : '—';
    case 'diferencial_aj_usd': return f.diferencial_aj_usd ? fmtNum(f.diferencial_aj_usd) : '—';
    case 'comprobantes_count': return String(f.comprobantes_count ?? 0);
    default:
      return '—';
  }
}

/* ───────────── Exportación a PDF ───────────── */

export async function exportarReporteContablePdf(
  reporte: ReporteContableGenerado,
  formato: 'resumen' | 'detallado' | 'hibrido' = 'hibrido',
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const ambito = reporte.config.ambito ?? 'asientos';
  const esLandscape = formato !== 'resumen';
  const doc = new jsPDF({
    orientation: esLandscape ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  let y = margin;

  const empNombre = (reporte.config.empresaNombre || 'GOLDEN TOUCH 1127, C.A.').toUpperCase();
  const empRif = reporte.config.empresaRif ? `RIF: ${reporte.config.empresaRif}` : '';
  const empClave = reporte.config.empresaClave || 'GT';

  // 1. Logo corporativo
  let logoH = 0;
  try {
    const logoImg = await loadLogoPdfEmpresa(empClave);
    if (logoImg) {
      dibujarLogoPdf(doc, logoImg, margin, y, 34);
      logoH = 34;
    }
  } catch { /* continuar sin logo */ }

  const logoW = anchoLogoPdf(34);
  const textX = logoH > 0 ? margin + logoW + 10 : margin;

  // 2. Encabezado institucional
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TINTA);
  doc.text(pdfSafe(empNombre), textX, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  if (empRif) doc.text(pdfSafe(empRif), textX, y + 21);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...NARANJA);

  let tituloPrincipal = 'REPORTE DINÁMICO DE CONTABILIDAD';
  let subtituloInfo = '';

  if (ambito === 'cuentas') {
    tituloPrincipal = 'REPORTE DINÁMICO · PLAN DE CUENTAS';
    subtituloInfo = `Catálogo General de Cuentas | Total Cuentas: ${reporte.resumen.totalCuentas ?? reporte.filas.length}`;
  } else if (ambito === 'balances') {
    tituloPrincipal = 'REPORTE DINÁMICO · BALANCES Y SALDOS';
    subtituloInfo = `Período: ${fmtFecha(reporte.config.desde)} al ${fmtFecha(reporte.config.hasta)} | Nivel de Corte: ${reporte.config.nivelBalance ?? 3}`;
  } else if (ambito === 'periodos') {
    tituloPrincipal = 'REPORTE DINÁMICO · PERÍODOS Y CIERRES';
    subtituloInfo = `Auditoría Mensual de Ejercicios y Cierres | Meses: ${reporte.filas.length}`;
  } else {
    tituloPrincipal = 'REPORTE DINÁMICO · ASIENTOS Y MOVIMIENTOS';
    subtituloInfo = `Período: ${fmtFecha(reporte.config.desde)} al ${fmtFecha(reporte.config.hasta)} | Agrupación: ${ETIQUETA_MODO_CONTABLE[reporte.config.agrupacion]}`;
  }

  doc.text(tituloPrincipal, textX, y + (empRif ? 33 : 24));

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(pdfSafe(subtituloInfo), textX, y + (empRif ? 44 : 35));

  y += Math.max(logoH, empRif ? 50 : 42) + 12;

  // 3. Resumen Ejecutivo y KPIs
  if (formato === 'resumen' || formato === 'hibrido') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TINTA);
    doc.text('RESUMEN GENERAL Y TOTALES DE CONTROL', margin, y);
    y += 8;

    let kpiHead = ['Métrica de Control', 'Valor Principal', 'Referencia / Detalle', 'Estado'];
    let kpiBody: string[][] = [];

    if (ambito === 'cuentas') {
      kpiHead = ['Métrica del Plan', 'Cantidad', 'Porcentaje / Detalle', 'Estado'];
      const total = reporte.resumen.totalCuentas || reporte.filas.length || 1;
      kpiBody = [
        ['Total Cuentas Catalogadas', fmtNum(reporte.resumen.totalCuentas ?? reporte.filas.length), '100%', 'Estructura activa'],
        ['Cuentas Activas', fmtNum(reporte.resumen.cuentasActivas ?? 0), `${Math.round(((reporte.resumen.cuentasActivas ?? 0) / total) * 100)}%`, 'Disponibles para asientos'],
        ['Cuentas Inactivas', fmtNum(reporte.resumen.cuentasInactivas ?? 0), `${Math.round(((reporte.resumen.cuentasInactivas ?? 0) / total) * 100)}%`, 'Históricas'],
        ['Cuentas de Movimiento (Imputables)', fmtNum(reporte.resumen.cuentasMovimiento ?? 0), `${Math.round(((reporte.resumen.cuentasMovimiento ?? 0) / total) * 100)}%`, 'Nivel transaccional'],
      ];
    } else if (ambito === 'balances') {
      kpiHead = ['Métrica de Balance', 'VES (Bolívares)', 'USD (Dólares)', 'Estado'];
      const cuadreTxt = reporte.resumen.cuadra ? 'CUADRADO (Partida Doble)' : `DESCUADRE (Bs ${fmtBs(reporte.resumen.diferenciaVes)})`;
      kpiBody = [
        ['Total Saldo Inicial', fmtBs(reporte.resumen.totalSaldoInicialVes), fmtUsd(reporte.resumen.totalSaldoInicialUsd), 'Saldos al inicio'],
        ['Total Movimientos Debe', fmtBs(reporte.resumen.totalDebeVes), fmtUsd(reporte.resumen.totalDebeUsd), 'Cargos del período'],
        ['Total Movimientos Haber', fmtBs(reporte.resumen.totalHaberVes), fmtUsd(reporte.resumen.totalHaberUsd), 'Abonos del período'],
        ['Total Saldo Final Acumulado', fmtBs(reporte.resumen.totalSaldoFinalVes), fmtUsd(reporte.resumen.totalSaldoFinalUsd), cuadreTxt],
      ];
    } else if (ambito === 'periodos') {
      kpiHead = ['Control de Períodos', 'Cantidad / Monto Bs', 'Monto USD', 'Estado'];
      kpiBody = [
        ['Meses del Ejercicio', String(reporte.filas.length), '12 Meses + Cierre', 'Registrados en el sistema'],
        ['Meses Abiertos', String(reporte.resumen.mesesAbiertos ?? 0), '—', 'Permiten operaciones'],
        ['Meses Cerrados', String(reporte.resumen.mesesCerrados ?? 0), '—', 'Bloqueados con foto de saldos'],
        ['Diferencial Cambiario AJ Acumulado', fmtBs(reporte.resumen.totalDiferencialAjVes), fmtUsd(reporte.resumen.totalDiferencialAjUsd), 'Ajuste de tasa al cierre'],
        ['Comprobantes Totales Emitidos', fmtNum(reporte.resumen.totalComprobantes), '—', 'Volumen procesado'],
      ];
    } else {
      const cuadreTxt = reporte.resumen.cuadra ? 'CUADRADO (Partida Doble Exacta)' : `DESCUADRADO (Dif Bs: ${fmtBs(reporte.resumen.diferenciaVes)})`;
      kpiBody = [
        ['Total Comprobantes', fmtNum(reporte.resumen.totalComprobantes), '—', 'Registrados en el rango'],
        ['Total Asientos / Renglones', fmtNum(reporte.resumen.totalAsientos), '—', 'Líneas contables evaluadas'],
        ['Total Debe (Cargos)', fmtBs(reporte.resumen.totalDebeVes), fmtUsd(reporte.resumen.totalDebeUsd), 'Suma total cargada'],
        ['Total Haber (Abonos)', fmtBs(reporte.resumen.totalHaberVes), fmtUsd(reporte.resumen.totalHaberUsd), 'Suma total abonada'],
        ['Diferencia / Estado', fmtBs(reporte.resumen.diferenciaVes), fmtUsd(reporte.resumen.diferenciaUsd), cuadreTxt],
      ];
    }

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: { fillColor: NARANJA, textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: TINTA },
      head: [kpiHead],
      body: kpiBody,
    });

    const lastTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
    y = (lastTable?.finalY ?? y) + 14;
  }

  // 4. Detalle de Registros y Agrupaciones
  if (formato === 'detallado' || formato === 'hibrido') {
    const camposDisponibles = obtenerCamposPorAmbito(ambito);
    const colsVisibles = camposDisponibles.filter((c) => reporte.config.columnasVisibles.includes(c.clave));
    const headRow = colsVisibles.map((c) => c.etiqueta);

    const bodyRows: Array<string[]> = [];

    for (const g of reporte.grupos) {
      if (reporte.config.agrupacion !== 'detallado' && ambito === 'asientos') {
        const headerGrupo = [`>> ${g.etiqueta.toUpperCase()}`];
        for (let i = 1; i < colsVisibles.length; i++) headerGrupo.push('');
        bodyRows.push(headerGrupo);
      }

      for (const f of g.filas) {
        const row = colsVisibles.map((col) => obtenerValorCelda(f, col.clave));
        bodyRows.push(row);
      }

      if (reporte.config.agrupacion !== 'detallado' && ambito === 'asientos') {
        const subtotalRow = colsVisibles.map((col) => {
          if (col.clave === 'cuenta_nombre' || col.clave === 'descripcion') return 'SUBTOTAL:';
          if (col.clave === 'debe_ves') return fmtNum(g.debe_ves);
          if (col.clave === 'haber_ves') return fmtNum(g.haber_ves);
          if (col.clave === 'debe_usd') return fmtNum(g.debe_usd);
          if (col.clave === 'haber_usd') return fmtNum(g.haber_usd);
          return '';
        });
        bodyRows.push(subtotalRow);
      }
    }

    // Fila final de totales (para asientos o balances)
    if (ambito === 'asientos' || ambito === 'balances') {
      const totalRow = colsVisibles.map((col) => {
        if (col.clave === 'cuenta_nombre' || col.clave === 'descripcion') return 'TOTAL GENERAL:';
        if (col.clave === 'debe_ves') return fmtNum(reporte.resumen.totalDebeVes);
        if (col.clave === 'haber_ves') return fmtNum(reporte.resumen.totalHaberVes);
        if (col.clave === 'debe_usd') return fmtNum(reporte.resumen.totalDebeUsd);
        if (col.clave === 'haber_usd') return fmtNum(reporte.resumen.totalHaberUsd);
        return '';
      });
      bodyRows.push(totalRow);
    }

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: { fillColor: NARANJA, textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 6.8, textColor: TINTA },
      columnStyles: colsVisibles.reduce<Record<number, { halign: 'left' | 'right' | 'center' }>>((acc, c, idx) => {
        acc[idx] = { halign: c.alineacion };
        return acc;
      }, {}),
      head: [headRow],
      body: bodyRows as unknown as string[][],
    });
  }

  // 5. Pie de página institucional en todas las hojas
  const totalPaginas = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(148, 163, 184);

    const txtPie = `${empNombre} · Sistema Contable VEN-NIF · Página ${p} de ${totalPaginas}`;
    doc.text(pdfSafe(txtPie), pageW / 2, pageH - 18, { align: 'center' });
  }

  const nombreArchivo = `Reporte-Contable-${ambito.toUpperCase()}-${empClave}-${reporte.config.desde}-al-${reporte.config.hasta}.pdf`;
  previewPdf(doc, nombreArchivo);
}

/* ───────────── Exportación a Excel ───────────── */

export async function exportarReporteContableExcel(
  reporte: ReporteContableGenerado,
  _formato: 'resumen' | 'detallado' | 'hibrido' = 'hibrido',
): Promise<void> {
  const XLSX = await import('xlsx-js-style');

  const ambito = reporte.config.ambito ?? 'asientos';
  const camposDisponibles = obtenerCamposPorAmbito(ambito);
  const colsVisibles = camposDisponibles.filter((c) => reporte.config.columnasVisibles.includes(c.clave));
  const empNombre = (reporte.config.empresaNombre || 'GOLDEN TOUCH 1127, C.A.').toUpperCase();
  const empClave = reporte.config.empresaClave || 'GT';

  const wb = XLSX.utils.book_new();
  const wsData: Array<Array<string | number>> = [];

  // Encabezado institucional
  wsData.push([empNombre]);
  wsData.push([`REPORTE DINÁMICO DE CONTABILIDAD · ${ambito.toUpperCase()}`]);
  wsData.push([`Período: ${reporte.config.desde} al ${reporte.config.hasta} | Empresa: ${empClave}`]);
  wsData.push([]);

  // Fila de encabezados de columna
  wsData.push(colsVisibles.map((c) => c.etiqueta));

  // Filas de datos
  for (const f of reporte.filas) {
    const row = colsVisibles.map((col) => {
      switch (col.formato) {
        case 'moneda':
        case 'moneda_bs': {
          const val = (f as unknown as Record<string, unknown>)[col.clave];
          return typeof val === 'number' ? val : 0;
        }
        case 'numero': {
          const val = (f as unknown as Record<string, unknown>)[col.clave];
          return typeof val === 'number' ? val : 0;
        }
        default:
          return obtenerValorCelda(f, col.clave);
      }
    });
    wsData.push(row);
  }

  // Fila de Totales si aplica
  if (ambito === 'asientos' || ambito === 'balances') {
    const filaTotal = colsVisibles.map((col) => {
      if (col.clave === 'cuenta_nombre' || col.clave === 'descripcion' || col.clave === 'comprobante') return 'TOTAL GENERAL:';
      if (col.clave === 'debe_ves') return reporte.resumen.totalDebeVes;
      if (col.clave === 'haber_ves') return reporte.resumen.totalHaberVes;
      if (col.clave === 'debe_usd') return reporte.resumen.totalDebeUsd;
      if (col.clave === 'haber_usd') return reporte.resumen.totalHaberUsd;
      return '';
    });
    wsData.push(filaTotal);
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = colsVisibles.map((c) => ({ wch: Math.max(c.anchoExcel, 12) }));

  XLSX.utils.book_append_sheet(wb, ws, `Reporte-${ambito.toUpperCase()}`);

  const wbout = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const nombreArchivo = `Reporte-Contable-${ambito.toUpperCase()}-${empClave}-${reporte.config.desde}-al-${reporte.config.hasta}.xlsx`;
  previewExcelArchivo(wbout, nombreArchivo);
}
