/* ============================================================
   Golden Touch · Administración · Exportación de Reportes (PDF / Excel / CSV)
   (04/11/2026)

   Módulo de exportación profesional para el reporte dinámico de
   Administración. Compatible con los estándares de Tesorería y Combustible:
     - PDF (jsPDF + autotable): Membrete oficial multiempresa, título centrado
       en grande con fechas explícitas, barra y tarjetas de KPIs, dualidad
       Fichas Ejecutivas (borde naranja) vs Tabla Tabular, y paginación.
     - Excel (xlsx-js-style): Hoja «Resumen Ejecutivo» y hoja «Detalle»,
       cabeceras con estilo corporativo, celdas numéricas formateadas y totales.
     - CSV: Plano UTF-8 con BOM y delimitador ';' compatible con Excel en Windows.
     - WhatsApp: Formato enriquecido para compartir por mensajería.
   ============================================================ */

import { previewExcel, previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { loadLogoPdfEmpresa, dibujarLogoPdf } from '@/shared/lib/pdfLogo';
import type {
  FilaReporteAdmin,
  ResumenReporteAdmin,
  CampoColumnaAdmin,
  ModoAgrupacionAdmin,
} from './reporteAdministracionMoldeable';
import {
  CAMPOS_REPORTE_ADMIN,
  ETIQUETA_MODO_ADMIN,
  esColumnaAplicableModoAdmin,
  ESTADO_PAGO_LABEL,
  ORIGEN_LABEL,
  fmtMontoUsd,
  fmtMontoBs,
  fmtMontoNum,
  obtenerMetricasFichaAdmin,
  r2,
} from './reporteAdministracionMoldeable';

const NARANJA: [number, number, number] = [255, 138, 0];
const VERDE: [number, number, number] = [16, 185, 129];
const AZUL: [number, number, number] = [56, 189, 248];
const PURPURA: [number, number, number] = [168, 85, 247];
const TINTA: [number, number, number] = [15, 23, 42];
const GRIS_SUAVE: [number, number, number] = [248, 250, 252];
const BORDE: [number, number, number] = [226, 232, 240];

export interface OpcionesExportarAdminPdf {
  filas: FilaReporteAdmin[];
  resumen: ResumenReporteAdmin;
  columnas: string[];
  tituloRango: string;
  periodoLabel: string;
  empresaNombre?: string | null;
  empresaClave?: string | null;
  modoAgrupacion?: ModoAgrupacionAdmin;
  orientacion?: 'landscape' | 'portrait';
  formatoPresentacion?: 'fichas' | 'tabla';
  incluirTarjetas?: boolean;
  incluirMovimientos?: boolean;
  incluirResumen?: boolean;
  mostrarUsd: boolean;
  mostrarBs: boolean;
  kpisSimplificados?: boolean;
}

/* ───────────── Generación de PDF profesional ───────────── */

export async function descargarAdministracionPdf(opts: OpcionesExportarAdminPdf): Promise<void> {
  const {
    filas,
    resumen,
    columnas,
    tituloRango,
    periodoLabel,
    empresaNombre,
    empresaClave,
    modoAgrupacion = 'categoria',
    orientacion = 'landscape',
    formatoPresentacion = 'fichas',
    incluirTarjetas = true,
    incluirMovimientos = true,
    incluirResumen = true,
    mostrarUsd = true,
    mostrarBs = true,
    kpisSimplificados = false,
  } = opts;

  const [logo, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoPdfEmpresa(empresaClave).catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const esLandscape = orientacion === 'landscape';
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: orientacion });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = esLandscape ? 36 : 30;
  let y = MARGIN;

  // 1. Membrete oficial
  const logoH = esLandscape ? 34 : 30;
  if (logo) {
    dibujarLogoPdf(doc, logo, MARGIN, y, logoH);
  }

  // Título superior derecho (Emisión y conteo)
  const ahoraStr = new Date().toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.text(`Emitido: ${ahoraStr}`, PAGE_W - MARGIN, y + 10, { align: 'right' });
  doc.text(`${filas.length} registro(s) en reporte`, PAGE_W - MARGIN, y + 22, { align: 'right' });

  // 2. Título principal centrado en grande (como solicitó el usuario)
  y += logoH + 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 138, 0);
  doc.text('MINERAL GROUP GUAYANA C.A. · ADMINISTRACIÓN Y GASTOS FIJOS', PAGE_W / 2, y, { align: 'center' });

  y += 16;
  doc.setFontSize(15);
  doc.setTextColor(...TINTA);
  doc.text(tituloRango, PAGE_W / 2, y, { align: 'center' });

  y += 13;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  const subTit = `${periodoLabel}${empresaNombre ? ` · ${empresaNombre}` : ''} · Agrupación: ${ETIQUETA_MODO_ADMIN[modoAgrupacion]}`;
  doc.text(subTit, PAGE_W / 2, y, { align: 'center' });

  y += 16;

  // 3. Tarjetas Resumen de KPIs en cabecera
  if (incluirResumen) {
    const kpiY = y;
    const cardGap = 8;
    const nKpis = kpisSimplificados ? 2 : 4;
    const cardW = (PAGE_W - 2 * MARGIN - (nKpis - 1) * cardGap) / nKpis;
    const cardH = 46;

    interface KpiBox {
      lbl: string;
      val: string;
      sub: string;
      color: [number, number, number];
    }

    const kpiList: KpiBox[] = [];

    if (kpisSimplificados) {
      if (mostrarUsd) {
        kpiList.push({
          lbl: 'TOTAL USD ($)',
          val: fmtMontoUsd(resumen.totalUsd),
          sub: `${resumen.totalOperaciones} operaciones`,
          color: VERDE,
        });
      }
      if (mostrarBs) {
        kpiList.push({
          lbl: 'TOTAL BOLÍVARES (BS)',
          val: fmtMontoBs(resumen.totalBs),
          sub: `Tasa: ${fmtMontoNum(resumen.tasaPromedioPonderada, 2)} $/Bs`,
          color: NARANJA,
        });
      }
    } else {
      kpiList.push({
        lbl: 'TOTAL EN DÓLARES',
        val: mostrarUsd ? fmtMontoUsd(resumen.totalUsd) : '—',
        sub: `Pagado: ${fmtMontoUsd(resumen.totalPagadoUsd)}`,
        color: VERDE,
      });
      kpiList.push({
        lbl: 'TOTAL EN BOLÍVARES',
        val: mostrarBs ? fmtMontoBs(resumen.totalBs) : '—',
        sub: `Pagado: ${fmtMontoBs(resumen.totalPagadoBs)}`,
        color: NARANJA,
      });
      kpiList.push({
        lbl: 'TASA PONDERADA',
        val: `${fmtMontoNum(resumen.tasaPromedioPonderada, 2)} $/Bs`,
        sub: `Ref. BCV: ${fmtMontoNum(resumen.tasaBcvReferencia, 2)}`,
        color: AZUL,
      });
      kpiList.push({
        lbl: 'OPERACIONES',
        val: `${resumen.totalOperaciones}`,
        sub: `Pendientes: ${resumen.totalPendienteUsd > 0 ? fmtMontoUsd(resumen.totalPendienteUsd) : '0'}`,
        color: PURPURA,
      });
    }

    kpiList.forEach((kpi, idx) => {
      const kX = MARGIN + idx * (cardW + cardGap);
      // Fondo tarjeta
      doc.setFillColor(...GRIS_SUAVE);
      doc.setDrawColor(...BORDE);
      doc.setLineWidth(0.75);
      doc.roundedRect(kX, kpiY, cardW, cardH, 4, 4, 'FD');

      // Línea de acento superior
      doc.setFillColor(...kpi.color);
      doc.roundedRect(kX, kpiY, cardW, 2.5, 1, 1, 'F');

      // Etiqueta
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.lbl, kX + cardW / 2, kpiY + 13, { align: 'center' });

      // Valor
      doc.setFontSize(11);
      doc.setTextColor(...kpi.color);
      doc.text(kpi.val, kX + cardW / 2, kpiY + 28, { align: 'center' });

      // Subtítulo
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.sub, kX + cardW / 2, kpiY + 39, { align: 'center' });
    });

    y += cardH + 16;
  }

  // 4. Presentación Fichas Ejecutivas (si está activo)
  if (formatoPresentacion === 'fichas' && incluirTarjetas && filas.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...TINTA);
    doc.text(pdfSafe(`Fichas Ejecutivas Resumen · Por ${ETIQUETA_MODO_ADMIN[modoAgrupacion]}`), MARGIN, y);
    y += 10;

    const cols = esLandscape ? 2 : 1;
    const fGap = 8;
    const fWidth = (PAGE_W - 2 * MARGIN - (cols - 1) * fGap) / cols;
    const innerW = fWidth - 16;

    // Calcular la cantidad máxima de métricas que puede tener una ficha en el reporte
    const maxMetricas = Math.max(
      ...filas.map((f) => obtenerMetricasFichaAdmin(f, columnas, { mostrarUsd, mostrarBs }).length),
      1,
    );
    const colsPorFila = esLandscape
      ? (maxMetricas <= 3 ? Math.max(1, maxMetricas) : maxMetricas === 4 ? 4 : 3)
      : (maxMetricas <= 4 ? Math.max(1, maxMetricas) : 4);
    const numFilasMetricas = Math.ceil(maxMetricas / colsPorFila);
    const haySubAlguna = filas.some((f) => Boolean(f.subtitulo?.trim() || f.periodo?.trim()));
    const altoHeader = haySubAlguna ? 34 : 28;
    const altoFilaMetrica = 25;
    const fHeight = altoHeader + numFilasMetricas * altoFilaMetrica + 8;

    for (let i = 0; i < filas.length; i += cols) {
      if (y + fHeight > PAGE_H - MARGIN - 20) {
        doc.addPage();
        y = MARGIN;
      }

      for (let c = 0; c < cols; c++) {
        const idx = i + c;
        if (idx >= filas.length) break;
        const f = filas[idx];
        const fX = MARGIN + c * (fWidth + fGap);

        // Fondo tarjeta ejecutiva
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(255, 138, 0); // Borde naranja característico
        doc.setLineWidth(1.2);
        doc.roundedRect(fX, y, fWidth, fHeight, 4, 4, 'FD');

        // Borde izquierdo de acento
        doc.setFillColor(...NARANJA);
        doc.rect(fX, y + 1, 3.5, fHeight - 2, 'F');

        // Badge superior derecho: % del total (si está en columnas)
        if (columnas.includes('pct_total') && f.pctDelTotal != null) {
          const badgeTxt = `${f.pctDelTotal.toFixed(1)}%`;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.2);
          doc.setFillColor(255, 247, 237);
          doc.setDrawColor(...NARANJA);
          doc.setLineWidth(0.5);
          const bW = doc.getTextWidth(badgeTxt) + 8;
          doc.roundedRect(fX + fWidth - bW - 8, y + 6, bW, 12, 3, 3, 'FD');
          doc.setTextColor(...NARANJA);
          doc.text(badgeTxt, fX + fWidth - bW - 4, y + 14.5);
        }

        // Título de la ficha
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...TINTA);
        const titFicha = doc.splitTextToSize(pdfSafe(f.titulo || f.concepto || f.empresaNombre), fWidth - 55);
        doc.text(titFicha[0] || '—', fX + 10, y + 14);

        // Subtítulo
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(100, 116, 139);
        const sub = pdfSafe(`${f.subtitulo || f.periodo || ''}${f.totalOperaciones != null ? ` · ${f.totalOperaciones} op.` : ''}`);
        doc.text(sub, fX + 10, y + 24);

        // Separador interior
        const sepY = y + (haySubAlguna ? 30 : 25);
        doc.setDrawColor(...BORDE);
        doc.setLineWidth(0.5);
        doc.line(fX + 8, sepY, fX + fWidth - 8, sepY);

        // Métricas dinámicas según las columnas marcadas
        const metricas = obtenerMetricasFichaAdmin(f, columnas, { mostrarUsd, mostrarBs });
        const myBase = sepY + 9;
        const colW = innerW / colsPorFila;
        const maxTextW = colW - 6;

        metricas.forEach((m, mIdx) => {
          const filaIdx = Math.floor(mIdx / colsPorFila);
          const colEnFila = mIdx % colsPorFila;
          const mx = fX + 8 + colW * colEnFila;
          const my = myBase + filaIdx * altoFilaMetrica;

          // Etiqueta
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5.8);
          doc.setTextColor(71, 85, 105);
          let lblTxt = pdfSafe(m.etiqueta);
          if (doc.getTextWidth(lblTxt) > maxTextW) {
            while (lblTxt.length > 3 && doc.getTextWidth(lblTxt + '…') > maxTextW) {
              lblTxt = lblTxt.slice(0, -1);
            }
            lblTxt += '…';
          }
          doc.text(lblTxt, mx, my);

          // Valor
          doc.setFont('helvetica', 'bold');
          let valSize = 8.2;
          doc.setFontSize(valSize);
          doc.setTextColor(...m.colorRgb);
          let valTxt = pdfSafe(m.valor);
          while (doc.getTextWidth(valTxt) > maxTextW && valSize > 6.0) {
            valSize -= 0.3;
            doc.setFontSize(valSize);
          }
          if (doc.getTextWidth(valTxt) > maxTextW) {
            while (valTxt.length > 3 && doc.getTextWidth(valTxt + '…') > maxTextW) {
              valTxt = valTxt.slice(0, -1);
            }
            valTxt += '…';
          }
          doc.text(valTxt, mx, my + 8.5);

          // Subtítulo
          if (m.sub) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(5.4);
            doc.setTextColor(148, 163, 184);
            let subTxt = pdfSafe(m.sub);
            if (doc.getTextWidth(subTxt) > maxTextW) {
              while (subTxt.length > 3 && doc.getTextWidth(subTxt + '…') > maxTextW) {
                subTxt = subTxt.slice(0, -1);
              }
              subTxt += '…';
            }
            doc.text(subTxt, mx, my + 14.5);
          }
        });
      }

      y += fHeight + fGap;
    }

    y += 10;
  }

  // 5. Presentación Tabular / Detalle de Movimientos
  if ((formatoPresentacion === 'tabla' || incluirMovimientos) && filas.length > 0) {
    if (formatoPresentacion === 'fichas') {
      // Salto de página para el detalle si ya imprimió fichas
      doc.addPage();
      y = MARGIN;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...TINTA);
    doc.text(
      modoAgrupacion === 'detallado'
        ? 'Libro Detallado de Movimientos Administrativos'
        : `Detalle por ${ETIQUETA_MODO_ADMIN[modoAgrupacion]}`,
      MARGIN,
      y,
    );
    y += 8;

    // Resolver columnas a mostrar
    const colDefs = columnas
      .map((cKey) => CAMPOS_REPORTE_ADMIN.find((c) => c.clave === cKey))
      .filter((c): c is CampoColumnaAdmin => Boolean(c))
      .filter((c) => {
        if (c.clave === 'monto_usd' && !mostrarUsd) return false;
        if (c.clave === 'monto_bs' && !mostrarBs) return false;
        if (modoAgrupacion !== 'detallado' && !esColumnaAplicableModoAdmin(c.clave, modoAgrupacion)) return false;
        return true;
      });

    const headers = colDefs.map((c) => c.etiqueta);

    const body = filas.map((f) => {
      return colDefs.map((col) => {
        switch (col.clave) {
          case 'fecha':
            return f.fecha || '—';
          case 'empresa':
            return f.empresaNombre || f.empresaClave || '—';
          case 'operaciones':
            return `${f.totalOperaciones ?? 1} ops`;
          case 'concepto':
            return f.titulo || f.concepto || '—';
          case 'categoria':
            return f.categoriaNombre || 'Sin categoría';
          case 'proveedor':
            return f.proveedorNombre || 'Sin proveedor';
          case 'periodo':
            return f.periodo || '—';
          case 'estado':
            return ESTADO_PAGO_LABEL[f.estadoPago] || f.estadoPago;
          case 'origen':
            return ORIGEN_LABEL[f.origen] || f.origen;
          case 'moneda_orig':
            return f.monedaOriginal;
          case 'monto_orig':
            return fmtMontoNum(f.montoOriginal, 2);
          case 'monto_usd':
            return fmtMontoUsd(f.montoUsd);
          case 'monto_bs':
            return fmtMontoBs(f.montoBs);
          case 'tasa':
            return fmtMontoNum(f.tasaAplicada, 2);
          case 'pct_total':
            return f.pctDelTotal != null ? `${f.pctDelTotal.toFixed(1)}%` : '—';
          default:
            return '—';
        }
      });
    });

    // Fila de totales al pie de la tabla
    const totalRow = colDefs.map((col, cIdx) => {
      if (cIdx === 0) return 'TOTAL CONSOLIDADO';
      if (col.clave === 'operaciones') return `${resumen.totalOperaciones} ops`;
      if (col.clave === 'monto_usd') return fmtMontoUsd(resumen.totalUsd);
      if (col.clave === 'monto_bs') return fmtMontoBs(resumen.totalBs);
      if (col.clave === 'pct_total') return '100.0%';
      if (col.clave === 'tasa') return `${fmtMontoNum(resumen.tasaPromedioPonderada, 2)} $/Bs`;
      return '';
    });
    body.push(totalRow);

    const columnStyles: Record<number, { halign: 'left' | 'center' | 'right' }> = {};
    colDefs.forEach((c, idx) => {
      columnStyles[idx] = { halign: c.alineacion };
    });

    autoTable(doc, {
      startY: y,
      head: [headers],
      body,
      margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + 16 },
      theme: 'plain',
      styles: {
        fontSize: esLandscape ? 7.2 : 6.8,
        cellPadding: esLandscape ? 3.5 : 2.8,
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [255, 138, 0],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
      },
      alternateRowStyles: {
        fillColor: [250, 250, 250],
      },
      columnStyles,
      didParseCell: (data) => {
        // Estilo destacado a la fila final de totales
        if (data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.textColor = [15, 23, 42];
        }
      },
    });
  }

  // 6. Pie de página institucional y numeración en todas las hojas
  const totalPaginas = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);

    // Borde separador inferior
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, PAGE_H - MARGIN + 6, PAGE_W - MARGIN, PAGE_H - MARGIN + 6);

    doc.text(
      'Mineral Group Guayana C.A. · Sistema de Gestión Administrativa',
      MARGIN,
      PAGE_H - MARGIN + 16,
    );
    doc.text(
      `Página ${i} de ${totalPaginas}`,
      PAGE_W - MARGIN,
      PAGE_H - MARGIN + 16,
      { align: 'right' },
    );
  }

  const filename = `reporte-admin-${new Date().toISOString().slice(0, 10)}.pdf`;
  previewPdf(doc, filename);
}

/* ───────────── Generación de Excel estilizado ───────────── */

export async function descargarAdministracionExcel(opts: {
  filas: FilaReporteAdmin[];
  resumen: ResumenReporteAdmin;
  columnas: string[];
  tituloRango: string;
  periodoLabel: string;
  empresaNombre?: string | null;
  modoAgrupacion?: ModoAgrupacionAdmin;
  mostrarUsd: boolean;
  mostrarBs: boolean;
}): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  const {
    filas,
    resumen,
    columnas,
    tituloRango,
    periodoLabel,
    empresaNombre,
    modoAgrupacion = 'categoria',
    mostrarUsd,
    mostrarBs,
  } = opts;

  type Celda = string | number | null;

  // ── HOJA 1: RESUMEN EJECUTIVO ──
  const resumenRows: Celda[][] = [
    ['MINERAL GROUP GUAYANA C.A. · REPORTE ADMINISTRATIVO'],
    [tituloRango],
    [`Alcance: ${periodoLabel}${empresaNombre ? ` · ${empresaNombre}` : ''}`],
    [`Generado: ${new Date().toLocaleString('es-VE')}`],
    [],
    ['INDICADOR CLAVE (KPI)', 'VALOR CONSOLIDADO', 'NOTAS'],
    ['Total en Dólares ($)', mostrarUsd ? resumen.totalUsd : 0, 'USD equivalente'],
    ['Total en Bolívares (Bs)', mostrarBs ? resumen.totalBs : 0, 'Moneda nacional'],
    ['Tasa Ponderada Promedio', resumen.tasaPromedioPonderada, 'Bs por 1 USD'],
    ['Total de Movimientos / Operaciones', resumen.totalOperaciones, 'Registros procesados'],
    ['Total Pagado ($ USD)', resumen.totalPagadoUsd, 'Operaciones liquidadas'],
    ['Total Pendiente ($ USD)', resumen.totalPendienteUsd, 'Compromisos abiertos'],
    [],
    [`DESGLOSE POR ${ETIQUETA_MODO_ADMIN[modoAgrupacion].toUpperCase()}`, 'MONTO ($ USD)', 'MONTO (BS)', 'OPERACIONES', '% PARTICIPACIÓN'],
  ];

  const filaInicioGrupos = resumenRows.length;
  filas.forEach((f) => {
    resumenRows.push([
      f.titulo || f.concepto || f.empresaNombre,
      f.montoUsd,
      f.montoBs,
      f.totalOperaciones ?? 1,
      f.pctDelTotal != null ? f.pctDelTotal / 100 : 0,
    ]);
  });

  resumenRows.push([
    'TOTAL GENERAL',
    resumen.totalUsd,
    resumen.totalBs,
    resumen.totalOperaciones,
    1.0,
  ]);

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  wsResumen['!cols'] = [{ wch: 38 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];

  // ── HOJA 2: DETALLE DE MOVIMIENTOS ──
  const colDefs = columnas
    .map((cKey) => CAMPOS_REPORTE_ADMIN.find((c) => c.clave === cKey))
    .filter((c): c is CampoColumnaAdmin => Boolean(c))
    .filter((c) => {
      if (c.clave === 'monto_usd' && !mostrarUsd) return false;
      if (c.clave === 'monto_bs' && !mostrarBs) return false;
      if (modoAgrupacion !== 'detallado' && !esColumnaAplicableModoAdmin(c.clave, modoAgrupacion)) return false;
      return true;
    });

  const detalleHeaders = colDefs.map((c) => c.etiqueta);
  const detalleRows: Celda[][] = [detalleHeaders];

  filas.forEach((f) => {
    const row = colDefs.map((col) => {
      switch (col.clave) {
        case 'fecha':
          return f.fecha;
        case 'empresa':
          return f.empresaNombre || f.empresaClave;
        case 'operaciones':
          return f.totalOperaciones ?? 1;
        case 'concepto':
          return f.titulo || f.concepto;
        case 'categoria':
          return f.categoriaNombre;
        case 'proveedor':
          return f.proveedorNombre;
        case 'periodo':
          return f.periodo;
        case 'estado':
          return ESTADO_PAGO_LABEL[f.estadoPago] || f.estadoPago;
        case 'origen':
          return ORIGEN_LABEL[f.origen] || f.origen;
        case 'moneda_orig':
          return f.monedaOriginal;
        case 'monto_orig':
          return f.montoOriginal;
        case 'monto_usd':
          return f.montoUsd;
        case 'monto_bs':
          return f.montoBs;
        case 'tasa':
          return f.tasaAplicada;
        case 'pct_total':
          return f.pctDelTotal != null ? f.pctDelTotal / 100 : 0;
        default:
          return null;
      }
    });
    detalleRows.push(row);
  });

  const wsDetalle = XLSX.utils.aoa_to_sheet(detalleRows);
  wsDetalle['!cols'] = colDefs.map((c) => ({ wch: c.anchoExcel }));

  // Aplicar formato de cabecera naranja en Hoja Resumen y Hoja Detalle
  const estiloHeader = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: 'FF8A00' } },
    alignment: { horizontal: 'center' },
  };

  for (let c = 0; c < 5; c += 1) {
    const celdaKpi = wsResumen[XLSX.utils.encode_cell({ r: 5, c })];
    if (celdaKpi) (celdaKpi as { s?: unknown }).s = estiloHeader;

    const celdaGrp = wsResumen[XLSX.utils.encode_cell({ r: filaInicioGrupos - 1, c })];
    if (celdaGrp) (celdaGrp as { s?: unknown }).s = estiloHeader;
  }

  for (let c = 0; c < colDefs.length; c += 1) {
    const celdaDet = wsDetalle[XLSX.utils.encode_cell({ r: 0, c })];
    if (celdaDet) (celdaDet as { s?: unknown }).s = estiloHeader;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen Ejecutivo');
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Movimientos');

  const filename = `reporte-admin-${new Date().toISOString().slice(0, 10)}.xlsx`;
  previewExcel(wb, filename);
}

/* ───────────── Generación de CSV plano con BOM ───────────── */

export function descargarAdministracionCsv(opts: {
  filas: FilaReporteAdmin[];
  columnas: string[];
  mostrarUsd: boolean;
  mostrarBs: boolean;
  modoAgrupacion?: ModoAgrupacionAdmin;
}): void {
  const { filas, columnas, mostrarUsd, mostrarBs, modoAgrupacion } = opts;

  const colDefs = columnas
    .map((cKey) => CAMPOS_REPORTE_ADMIN.find((c) => c.clave === cKey))
    .filter((c): c is CampoColumnaAdmin => Boolean(c))
    .filter((c) => {
      if (c.clave === 'monto_usd' && !mostrarUsd) return false;
      if (c.clave === 'monto_bs' && !mostrarBs) return false;
      if (modoAgrupacion && modoAgrupacion !== 'detallado' && !esColumnaAplicableModoAdmin(c.clave, modoAgrupacion)) return false;
      return true;
    });

  const header = colDefs.map((c) => `"${c.etiqueta}"`).join(';');
  const rows = filas.map((f) => {
    return colDefs
      .map((col) => {
        let v: string | number = '';
        switch (col.clave) {
          case 'fecha':
            v = f.fecha;
            break;
          case 'empresa':
            v = f.empresaNombre || f.empresaClave;
            break;
          case 'operaciones':
            v = f.totalOperaciones ?? 1;
            break;
          case 'concepto':
            v = f.titulo || f.concepto;
            break;
          case 'categoria':
            v = f.categoriaNombre;
            break;
          case 'proveedor':
            v = f.proveedorNombre;
            break;
          case 'periodo':
            v = f.periodo;
            break;
          case 'estado':
            v = ESTADO_PAGO_LABEL[f.estadoPago] || f.estadoPago;
            break;
          case 'origen':
            v = ORIGEN_LABEL[f.origen] || f.origen;
            break;
          case 'moneda_orig':
            v = f.monedaOriginal;
            break;
          case 'monto_orig':
            v = f.montoOriginal;
            break;
          case 'monto_usd':
            v = r2(f.montoUsd);
            break;
          case 'monto_bs':
            v = r2(f.montoBs);
            break;
          case 'tasa':
            v = r2(f.tasaAplicada);
            break;
          case 'pct_total':
            v = f.pctDelTotal != null ? `${f.pctDelTotal.toFixed(1)}%` : '';
            break;
          default:
            v = '';
        }
        const s = String(v ?? '').replace(/"/g, '""');
        return `"${s}"`;
      })
      .join(';');
  });

  const csvContent = `\uFEFF${[header, ...rows].join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-admin-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ───────────── Texto formateado para WhatsApp ───────────── */

export function generarTextoWhatsappAdmin(opts: {
  filas: FilaReporteAdmin[];
  resumen: ResumenReporteAdmin;
  tituloRango: string;
  empresaNombre?: string | null;
  periodoLabel: string;
  modoAgrupacion: ModoAgrupacionAdmin;
  mostrarUsd: boolean;
  mostrarBs: boolean;
}): string {
  const {
    filas,
    resumen,
    tituloRango,
    empresaNombre,
    periodoLabel,
    modoAgrupacion,
    mostrarUsd,
    mostrarBs,
  } = opts;

  const lines: string[] = [
    `🏢 *MINERAL GROUP GUAYANA C.A.*`,
    `📋 *${tituloRango}*`,
    `📅 Alcance: ${periodoLabel}${empresaNombre ? ` · ${empresaNombre}` : ''}`,
    `📊 Agrupado por: ${ETIQUETA_MODO_ADMIN[modoAgrupacion]}`,
    '',
    `*RESUMEN CONSOLIDADO:*`,
  ];

  if (mostrarUsd && !mostrarBs) {
    lines.push(`💰 Total consolidado: *${fmtMontoUsd(resumen.totalUsd)}*`);
  } else if (mostrarBs && !mostrarUsd) {
    lines.push(`💰 Total consolidado: *${fmtMontoBs(resumen.totalBs)}*`);
  } else {
    lines.push(`💰 Total consolidado: *${fmtMontoUsd(resumen.totalUsd)}*  (Bs ${fmtMontoNum(resumen.totalBs, 2)})`);
  }

  if (resumen.tasaPromedioPonderada > 0) {
    lines.push(`📈 Tasa ref: *${fmtMontoNum(resumen.tasaPromedioPonderada, 2)} $/Bs*`);
  }
  lines.push(`🔢 Movimientos: *${resumen.totalOperaciones}*`);

  const partesEstado: string[] = [];
  if (resumen.totalPagadoUsd > 0) {
    partesEstado.push(`✅ Pagado: *${mostrarUsd ? fmtMontoUsd(resumen.totalPagadoUsd) : fmtMontoBs(resumen.totalPagadoBs)}*`);
  }
  if (resumen.totalPendienteUsd > 0) {
    partesEstado.push(`⏳ Pendiente: *${mostrarUsd ? fmtMontoUsd(resumen.totalPendienteUsd) : fmtMontoBs(resumen.totalPendienteBs)}*`);
  }
  if (partesEstado.length > 0) {
    lines.push(partesEstado.join(' · '));
  }

  lines.push('');
  lines.push(`*DESGLOSE (${ETIQUETA_MODO_ADMIN[modoAgrupacion].toUpperCase()}):*`);

  const topFilas = filas.slice(0, 20);
  topFilas.forEach((f, idx) => {
    const tit = f.titulo || f.concepto || f.empresaNombre;
    let montoFmt = '';
    if (mostrarUsd && !mostrarBs) {
      montoFmt = `*${fmtMontoUsd(f.montoUsd)}*`;
    } else if (mostrarBs && !mostrarUsd) {
      montoFmt = `*${fmtMontoBs(f.montoBs)}*`;
    } else {
      montoFmt = `*${fmtMontoUsd(f.montoUsd)}* (${fmtMontoBs(f.montoBs)})`;
    }
    const pct = f.pctDelTotal != null ? ` · ${f.pctDelTotal.toFixed(1)}%` : '';
    lines.push(`${idx + 1}. *${tit}* — ${montoFmt}${pct}`);

    // Subdetalles organizados en segunda línea sangrada
    const subdetalles: string[] = [];
    if (f.categoriaNombre && f.categoriaNombre !== tit) subdetalles.push(`📁 ${f.categoriaNombre}`);
    if (f.proveedorNombre && f.proveedorNombre !== tit) subdetalles.push(`👤 ${f.proveedorNombre}`);
    if (f.empresaNombre && f.empresaNombre !== tit && modoAgrupacion !== 'empresa') subdetalles.push(`🏢 ${f.empresaNombre}`);
    if (f.estadoPago) {
      subdetalles.push(f.estadoPago === 'pagado' ? '✅ Pagado' : f.estadoPago === 'pendiente' ? '⏳ Pendiente' : '❌ Anulado');
    }
    if (subdetalles.length > 0) {
      lines.push(`   ${subdetalles.join(' · ')}`);
    }
  });

  if (filas.length > 20) {
    lines.push(`_... y ${filas.length - 20} registro(s) más._`);
  }

  lines.push('');
  lines.push(`_Generado automáticamente desde Sistema Mineral Group Guayana C.A._`);

  return lines.join('\n');
}
