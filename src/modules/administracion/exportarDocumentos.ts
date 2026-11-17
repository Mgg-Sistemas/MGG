/* ============================================================
   Golden Touch · Administración · Exportación de Documentos y Permisos
   (PDF / Excel / CSV / WhatsApp)
   (04/11/2026)

   Módulo de exportación fiel y profesional para la permisología minera y
   legal de Administración:
     - PDF (jsPDF + autotable): Membrete oficial multiempresa, título centrado
       en grande, barra de 4 KPIs con acentos de color, sección de tarjetas
       ejecutivas con acento lateral (#ff8a00), y tabla de inventario legal.
     - Excel (xlsx-js-style): Hoja «Resumen Ejecutivo» con KPIs y carpetas,
       y hoja «Detalle Documentos» con formato condicional de estatus.
     - CSV: Plano UTF-8 con BOM y delimitador ';' para hojas de cálculo.
     - WhatsApp: Alerta y resumen de cumplimiento minero/laboral listo para enviar.
   ============================================================ */

import { previewExcel, previewPdf } from '@/shared/lib/reportePreview';
import { loadLogoPdfEmpresa, dibujarLogoPdf } from '@/shared/lib/pdfLogo';
import type {
  FilaReporteDoc,
  GrupoReporteDoc,
  ResumenReporteDoc,
  ModoAgrupacionDoc,
} from './reporteDocumentosMoldeable';
import {
  STATUS_VENCIMIENTO_LABEL,
} from './admin.repository';

const NARANJA: [number, number, number] = [255, 138, 0];
const VERDE: [number, number, number] = [16, 185, 129];
const AMARILLO: [number, number, number] = [245, 158, 11];
const ROJO: [number, number, number] = [239, 68, 68];
const PURPURA: [number, number, number] = [168, 85, 247];
const TINTA: [number, number, number] = [15, 23, 42];
const GRIS_SUAVE: [number, number, number] = [248, 250, 252];
const BORDE: [number, number, number] = [226, 232, 240];

export interface OpcionesExportarDocsPdf {
  filas: FilaReporteDoc[];
  grupos: GrupoReporteDoc[];
  resumen: ResumenReporteDoc;
  columnas: string[];
  tituloRango: string;
  periodoLabel: string;
  empresaNombre?: string | null;
  empresaClave?: string | null;
  modoAgrupacion?: ModoAgrupacionDoc;
  orientacion?: 'landscape' | 'portrait';
  formatoPresentacion?: 'fichas' | 'tabla';
  incluirTarjetas?: boolean;
  incluirDetalle?: boolean;
  incluirResumen?: boolean;
}

/* ───────────── Generación de PDF profesional ───────────── */

export async function descargarDocumentosPdf(opts: OpcionesExportarDocsPdf): Promise<void> {
  const {
    filas,
    grupos,
    resumen,
    tituloRango,
    periodoLabel,
    empresaNombre,
    empresaClave,
    orientacion = 'landscape',
    formatoPresentacion = 'fichas',
    incluirTarjetas = true,
    incluirDetalle = true,
    incluirResumen = true,
  } = opts;

  const [logo, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoPdfEmpresa(empresaClave).catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const esLandscape = orientacion === 'landscape';
  const doc = new jsPDF(orientacion === 'landscape' ? 'l' : 'p', 'pt', 'letter');
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = esLandscape ? 36 : 30;
  let y = MARGIN;

  // 1. Membrete oficial
  const logoH = esLandscape ? 34 : 30;
  if (logo) {
    dibujarLogoPdf(doc, logo, MARGIN, y, logoH);
  }

  // Título de la empresa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(esLandscape ? 13 : 12);
  doc.setTextColor(...TINTA);
  const nombreCia = (empresaNombre || 'MINERAL GROUP GUAYANA C.A.').toUpperCase();
  const encabezadoCia = `${nombreCia} · CONTROL DE DOCUMENTOS Y PERMISOS`;
  doc.text(encabezadoCia, logo ? MARGIN + 105 : MARGIN, y + 14);

  // Subtítulo del período y alcance
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Cumplimiento Legal, Permisología y Control de Caducidades · ${periodoLabel}`, logo ? MARGIN + 105 : MARGIN, y + 26);

  // Fecha de emisión a la derecha
  const hoyStr = new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  doc.setFontSize(7.5);
  doc.text(`Emitido: ${hoyStr}`, PAGE_W - MARGIN, y + 14, { align: 'right' });
  doc.text(`${resumen.totalDocs} documento(s) en reporte`, PAGE_W - MARGIN, y + 26, { align: 'right' });

  y += logoH + 10;

  // 2. TÍTULO CENTRADO EN GRANDE (Fiel a los requerimientos de Combustible y Tesorería)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(esLandscape ? 13 : 12);
  doc.setTextColor(...NARANJA);
  doc.text(tituloRango.toUpperCase(), PAGE_W / 2, y, { align: 'center' });
  y += 14;

  // 3. TARJETAS HERO DE KPIS (4 bloques con acento superior de color)
  if (incluirResumen) {
    const kpiCount = 4;
    const gap = 8;
    const totalGap = gap * (kpiCount - 1);
    const kpiW = (PAGE_W - MARGIN * 2 - totalGap) / kpiCount;
    const kpiH = 44;

    const kpis = [
      {
        lbl: 'TOTAL DOCUMENTOS',
        val: `${resumen.totalDocs}`,
        sub: `${resumen.cumplimientoPct}% cumplimiento legal`,
        color: NARANJA,
      },
      {
        lbl: 'VIGENTES AL DÍA',
        val: `${resumen.vigentes}`,
        sub: `${resumen.noVence} permanentes (sin venc.)`,
        color: VERDE,
      },
      {
        lbl: 'POR VENCER (<=30D)',
        val: `${resumen.porVencer}`,
        sub: 'Planificar renovación oportuna',
        color: AMARILLO,
      },
      {
        lbl: 'VENCIDOS / EN TRÁMITE',
        val: `${resumen.vencidos + resumen.vencidosEnTramite}`,
        sub: `${resumen.vencidos} caducados · ${resumen.vencidosEnTramite} en trámite`,
        color: resumen.vencidos > 0 ? ROJO : PURPURA,
      },
    ];

    kpis.forEach((kpi, idx) => {
      const kx = MARGIN + idx * (kpiW + gap);

      // Fondo de la tarjeta
      doc.setFillColor(...GRIS_SUAVE);
      doc.setDrawColor(...BORDE);
      doc.setLineWidth(0.75);
      doc.roundedRect(kx, y, kpiW, kpiH, 4, 4, 'FD');

      // Barra de acento superior
      doc.setFillColor(...kpi.color);
      doc.rect(kx + 1, y + 1, kpiW - 2, 3, 'F');

      // Etiqueta
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.lbl, kx + 7, y + 14);

      // Valor
      doc.setFontSize(12);
      doc.setTextColor(...TINTA);
      doc.text(kpi.val, kx + 7, y + 28);

      // Subtítulo
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.sub, kx + 7, y + 38);
    });

    y += kpiH + 12;
  }

  // 4. SECCIÓN DE TARJETAS EJECUTIVAS (si se eligió Fichas o incluirTarjetas)
  if (incluirTarjetas && formatoPresentacion === 'fichas' && grupos.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TINTA);
    doc.text('STATUS PUNTUAL POR CARPETA / GRUPO', MARGIN, y);
    y += 10;

    const cardsCols = esLandscape ? 3 : 2;
    const cardGap = 8;
    const cardW = (PAGE_W - MARGIN * 2 - cardGap * (cardsCols - 1)) / cardsCols;
    const cardH = 50;

    grupos.forEach((g, idx) => {
      // Paginación si excede
      if (y + cardH > PAGE_H - MARGIN - 30) {
        doc.addPage();
        y = MARGIN;
      }

      const col = idx % cardsCols;
      const cx = MARGIN + col * (cardW + cardGap);
      const cy = y;

      // Caja de tarjeta con borde naranja fiel
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...NARANJA);
      doc.setLineWidth(1.2);
      doc.roundedRect(cx, cy, cardW, cardH, 4, 4, 'FD');

      // Barra vertical de acento izquierdo (fiel al PDF de combustible)
      doc.setFillColor(...NARANJA);
      doc.rect(cx + 1, cy + 1, 4, cardH - 2, 'F');

      // Título de la tarjeta
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...TINTA);
      const titCorto = g.tituloGrupo.length > 28 ? `${g.tituloGrupo.substring(0, 26)}…` : g.tituloGrupo;
      doc.text(`${g.icono} ${titCorto}`, cx + 10, cy + 13);

      // Badge de estatus a la derecha
      doc.setFontSize(6.5);
      if (g.vencidos > 0) {
        doc.setTextColor(...ROJO);
        doc.text(`🔴 ${g.vencidos} Vencido(s)`, cx + cardW - 8, cy + 13, { align: 'right' });
      } else if (g.vencidosEnTramite > 0) {
        doc.setTextColor(...PURPURA);
        doc.text(`🟣 ${g.vencidosEnTramite} En Trámite`, cx + cardW - 8, cy + 13, { align: 'right' });
      } else if (g.porVencer > 0) {
        doc.setTextColor(...AMARILLO);
        doc.text(`🟡 ${g.porVencer} Por Vencer`, cx + cardW - 8, cy + 13, { align: 'right' });
      } else {
        doc.setTextColor(...VERDE);
        doc.text('🟢 100% Al Día', cx + cardW - 8, cy + 13, { align: 'right' });
      }

      // Detalle de conteos
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(`Total: ${g.totalDocs} doc(s) · Vigentes: ${g.vigentes}`, cx + 10, cy + 26);

      // Cumplimiento y advertencia
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      const advTxt = g.vencidos > 0
        ? `⚠️ Requiere renovación inmediata`
        : g.vencidosEnTramite > 0
        ? `Trámite activo ante ente oficial`
        : `Sin riesgos legales detectados`;
      doc.text(advTxt, cx + 10, cy + 39);

      // Actualizar Y tras completar una fila de columnas
      if (col === cardsCols - 1 || idx === grupos.length - 1) {
        y += cardH + cardGap;
      }
    });

    y += 8;
  }

  // 5. INVENTARIO DETALLADO DE DOCUMENTOS Y PERMISOS (Tabla Autotable)
  if (incluirDetalle && filas.length > 0) {
    if (y > PAGE_H - MARGIN - 80) {
      doc.addPage();
      y = MARGIN;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TINTA);
    doc.text('1. Inventario y Control de Vencimientos de Documentos', MARGIN, y);
    y += 8;

    const cabeceras = [
      'Carpeta',
      'Documento / Trámite',
      'Socio / Titular',
      'N° Registro',
      'F. Emisión',
      'F. Vence',
      'Días Rest.',
      'Estado Legal',
      'Observación / Trámite',
    ];

    const cuerpo = filas.map((f) => {
      const cNom = f.carpetaNombre;
      const docNom = f.nombre;
      const socio = f.socioNombre || '—';
      const reg = f.numeroRegistro || '—';
      const fEmis = f.fechaEmision || '—';
      const fVenc = f.fechaVencimiento || 'No Vence';
      const dRest =
        f.diasRestantes === null
          ? '—'
          : f.diasRestantes < 0
          ? `${f.diasRestantes} d`
          : `+${f.diasRestantes} d`;
      const stLbl = STATUS_VENCIMIENTO_LABEL[f.statusVencimiento] || f.statusVencimiento;
      const obs = f.notaTramite || (f.entidadEmisora ? `Ente: ${f.entidadEmisora}` : '—');

      return [cNom, docNom, socio, reg, fEmis, fVenc, dRest, stLbl, obs];
    });

    autoTable(doc, {
      startY: y,
      head: [cabeceras],
      body: cuerpo,
      margin: { left: MARGIN, right: MARGIN },
      theme: 'grid',
      styles: {
        fontSize: esLandscape ? 7 : 6.5,
        cellPadding: 3,
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [...NARANJA],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: esLandscape ? 7.5 : 7,
      },
      columnStyles: {
        0: { cellWidth: esLandscape ? 90 : 75 },
        1: { cellWidth: esLandscape ? 120 : 95, fontStyle: 'bold' },
        2: { cellWidth: esLandscape ? 85 : 70 },
        3: { cellWidth: esLandscape ? 75 : 60 },
        4: { cellWidth: esLandscape ? 55 : 45, halign: 'center' },
        5: { cellWidth: esLandscape ? 55 : 45, halign: 'center' },
        6: { cellWidth: esLandscape ? 45 : 38, halign: 'center', fontStyle: 'bold' },
        7: { cellWidth: esLandscape ? 80 : 65, halign: 'center' },
        8: { cellWidth: 'auto' },
      },
      didParseCell(data) {
        // Colorear status y días restantes
        if (data.section === 'body') {
          const rowData = filas[data.row.index];
          if (data.column.index === 6 || data.column.index === 7) {
            if (rowData.statusVencimiento === 'vencido') {
              data.cell.styles.textColor = [...ROJO];
              data.cell.styles.fontStyle = 'bold';
            } else if (rowData.statusVencimiento === 'vencido_en_tramite') {
              data.cell.styles.textColor = [...PURPURA];
              data.cell.styles.fontStyle = 'bold';
            } else if (rowData.statusVencimiento === 'por_vencer') {
              data.cell.styles.textColor = [...AMARILLO];
              data.cell.styles.fontStyle = 'bold';
            } else if (rowData.statusVencimiento === 'vigente') {
              data.cell.styles.textColor = [...VERDE];
            }
          }
        }
      },
    });
  }

  // 6. Pie de página en todas las hojas
  const totalPaginas = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);

    const txtPie = `Mineral Group Guayana C.A. · Sistema de Gestión y Control Administrativo · Página ${p} de ${totalPaginas}`;
    doc.text(txtPie, PAGE_W / 2, PAGE_H - 14, { align: 'center' });
  }

  // Nombre de archivo con fecha y empresa
  const slugEmpresa = (empresaNombre || 'GT').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 15);
  const slugFecha = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `Reporte_Documentos_${slugEmpresa}_${slugFecha}.pdf`;

  previewPdf(doc, nombreArchivo);
}

/* ───────────── Generación de Excel profesional ───────────── */

export async function descargarDocumentosExcel(opts: {
  filas: FilaReporteDoc[];
  grupos: GrupoReporteDoc[];
  resumen: ResumenReporteDoc;
  periodoLabel: string;
  empresaNombre?: string | null;
}): Promise<void> {
  const { filas, grupos, resumen, periodoLabel, empresaNombre } = opts;

  const XLSX = await import('xlsx-js-style');

  const estiloTitulo = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 },
    fill: { fgColor: { rgb: 'FF8A00' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };

  const estiloCabecera = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
    fill: { fgColor: { rgb: '1E293B' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };

  // Hoja 1: Resumen de Carpetas y KPIs
  const ws1Data: unknown[][] = [
    [`MINERAL GROUP GUAYANA C.A. - CONTROL DE DOCUMENTOS Y PERMISOS`],
    [`Empresa: ${empresaNombre || 'Todas las empresas'} | Período: ${periodoLabel}`],
    [],
    ['KPIs DE CUMPLIMIENTO LEGAL'],
    ['Total Documentos', resumen.totalDocs],
    ['Documentos Vigentes', resumen.vigentes],
    ['Permanentes (Sin Vencimiento)', resumen.noVence],
    ['Por Vencer (Próximos 30 días)', resumen.porVencer],
    ['Caducados / Vencidos', resumen.vencidos],
    ['Vencidos en Trámite', resumen.vencidosEnTramite],
    ['% Cumplimiento Global', `${resumen.cumplimientoPct}%`],
    [],
    ['ESTATUS POR CARPETA / GRUPO'],
    ['Carpeta / Trámite', 'Total Docs', 'Vigentes', 'Por Vencer', 'Vencidos', 'En Trámite', '% Cumplimiento'],
  ];

  grupos.forEach((g) => {
    ws1Data.push([
      g.tituloGrupo,
      g.totalDocs,
      g.vigentes,
      g.porVencer,
      g.vencidos,
      g.vencidosEnTramite,
      `${g.cumplimientoPct}%`,
    ]);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);

  // Ancho de columnas Hoja 1
  ws1['!cols'] = [
    { wch: 35 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
  ];

  // Aplicar estilos Hoja 1
  if (ws1['A1']) ws1['A1'].s = estiloTitulo;
  if (ws1['A4']) ws1['A4'].s = { font: { bold: true, sz: 10 } };
  if (ws1['A13']) ws1['A13'].s = { font: { bold: true, sz: 10 } };

  // Fila cabecera tabla carpetas (fila 14 -> index 13)
  const colsLetras = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  colsLetras.forEach((letra) => {
    const celda = ws1[`${letra}14`];
    if (celda) celda.s = estiloCabecera;
  });

  // Hoja 2: Detalle de Documentos
  const ws2Data: unknown[][] = [
    [
      'Empresa',
      'Carpeta',
      'Documento / Trámite',
      'Tipo Legal',
      'Socio / Titular',
      'Entidad Emisora',
      'N° Radicado / Registro',
      'Fecha Emisión',
      'Fecha Vencimiento',
      'Días Restantes',
      'Estado Legal',
      'Observación / Trámite',
    ],
  ];

  filas.forEach((f) => {
    ws2Data.push([
      f.empresaNombre,
      f.carpetaNombre,
      f.nombre,
      f.tipoNombre,
      f.socioNombre || '—',
      f.entidadEmisora || '—',
      f.numeroRegistro || '—',
      f.fechaEmision || '—',
      f.fechaVencimiento || 'No Vence',
      f.diasRestantes !== null ? f.diasRestantes : '—',
      STATUS_VENCIMIENTO_LABEL[f.statusVencimiento] || f.statusVencimiento,
      f.notaTramite || '—',
    ]);
  });

  const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);

  // Columnas Hoja 2
  ws2['!cols'] = [
    { wch: 22 },
    { wch: 26 },
    { wch: 32 },
    { wch: 18 },
    { wch: 22 },
    { wch: 20 },
    { wch: 20 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 35 },
  ];

  // Estilo cabecera Hoja 2
  const colsDetalle = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  colsDetalle.forEach((letra) => {
    const celda = ws2[`${letra}1`];
    if (celda) celda.s = estiloCabecera;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Resumen Cumplimiento');
  XLSX.utils.book_append_sheet(wb, ws2, 'Detalle Documentos');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const slugEmp = (empresaNombre || 'GT').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 15);
  const slugF = new Date().toISOString().slice(0, 10);
  previewExcel(blob, `Reporte_Documentos_${slugEmp}_${slugF}.xlsx`);
}

/* ───────────── Generación de CSV plano con BOM UTF-8 ───────────── */

export function descargarDocumentosCsv(filas: FilaReporteDoc[], empresaNombre?: string | null): void {
  const cabeceras = [
    'Empresa',
    'Carpeta',
    'Documento',
    'Tipo',
    'Socio',
    'Entidad Emisora',
    'Numero Registro',
    'Fecha Emision',
    'Fecha Vencimiento',
    'Dias Restantes',
    'Estado Legal',
    'Observacion',
  ];

  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const lineas: string[] = [cabeceras.map(escapeCsv).join(';')];

  filas.forEach((f) => {
    lineas.push(
      [
        f.empresaNombre,
        f.carpetaNombre,
        f.nombre,
        f.tipoNombre,
        f.socioNombre || '',
        f.entidadEmisora || '',
        f.numeroRegistro || '',
        f.fechaEmision || '',
        f.fechaVencimiento || 'No Vence',
        f.diasRestantes !== null ? f.diasRestantes : '',
        STATUS_VENCIMIENTO_LABEL[f.statusVencimiento] || f.statusVencimiento,
        f.notaTramite || '',
      ]
        .map(escapeCsv)
        .join(';'),
    );
  });

  const csvContent = '\uFEFF' + lineas.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug = (empresaNombre || 'GT').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 15);
  a.download = `Reporte_Documentos_${slug}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ───────────── Generador de Mensaje de WhatsApp ───────────── */

export function generarTextoWhatsappDocs(opts: {
  filas: FilaReporteDoc[];
  grupos: GrupoReporteDoc[];
  resumen: ResumenReporteDoc;
  periodoLabel: string;
  empresaNombre?: string | null;
}): string {
  const { filas, grupos, resumen, periodoLabel, empresaNombre } = opts;

  const fechaHoy = new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const lineas: string[] = [
    `📋 *MINERAL GROUP GUAYANA C.A. · CONTROL DE DOCUMENTOS Y PERMISOLOGÍA*`,
    `🏢 *Empresa:* ${empresaNombre || 'Todas las empresas'}`,
    `📅 *Fecha de Corte:* ${fechaHoy}`,
    `🎯 *Alcance:* ${periodoLabel}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 *RESUMEN DE CUMPLIMIENTO LEGAL*`,
    `• Total Documentos: *${resumen.totalDocs}*`,
    `• Cumplimiento: *${resumen.cumplimientoPct}% al día*`,
    `• 🟢 Vigentes / Permanentes: *${resumen.vigentes + resumen.noVence}*`,
    `• 🟡 Por Vencer (próx. 30d): *${resumen.porVencer}*`,
    `• 🔴 Caducados: *${resumen.vencidos}*`,
    `• 🟣 Vencidos en Trámite: *${resumen.vencidosEnTramite}*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  // Alerta de documentos críticos si existen
  const criticos = filas.filter(
    (f) =>
      f.statusVencimiento === 'vencido' ||
      f.statusVencimiento === 'vencido_en_tramite' ||
      (f.statusVencimiento === 'por_vencer' && f.diasRestantes !== null && f.diasRestantes <= 15),
  );

  if (criticos.length > 0) {
    lineas.push(``, `🚨 *ATENCIÓN INMEDIATA / ALERTAS CRÍTICAS:*`);
    criticos.slice(0, 10).forEach((c) => {
      const icon =
        c.statusVencimiento === 'vencido'
          ? '🔴'
          : c.statusVencimiento === 'vencido_en_tramite'
          ? '🟣'
          : '⚡';
      const dr =
        c.diasRestantes === null
          ? ''
          : c.diasRestantes < 0
          ? `(Venció hace ${Math.abs(c.diasRestantes)}d)`
          : `(Vence en ${c.diasRestantes}d)`;
      lineas.push(`${icon} *${c.nombre}* ${dr}`);
      if (c.socioNombre) lineas.push(`   └ Titular: ${c.socioNombre}`);
      if (c.notaTramite) lineas.push(`   └ Trámite: ${c.notaTramite}`);
    });
    if (criticos.length > 10) {
      lineas.push(`   _...y ${criticos.length - 10} más en el informe oficial._`);
    }
    lineas.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }

  // Desglose por carpeta
  lineas.push(``, `📁 *ESTATUS POR CARPETA:*`);
  grupos.forEach((g) => {
    const icon = g.vencidos > 0 ? '🔴' : g.porVencer > 0 ? '🟡' : '🟢';
    lineas.push(`${icon} *${g.tituloGrupo}:* ${g.totalDocs} doc(s) · ${g.cumplimientoPct}% al día`);
  });

  lineas.push(
    ``,
    `_Generado automáticamente desde Mineral Group Guayana C.A. - Sistema Integral de Gestión Minera y Administrativa._`,
  );

  return lineas.join('\n');
}
