/* ============================================================
   MGG · Control de Maquinaria · Generador Excel y PDF (tipo RRHH)
   Genera los archivos Excel y PDF con las columnas elegidas por el
   usuario y con agrupación opcional por EMPRESA / PROPIETARIO.
   ============================================================ */
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { camposElegidosMaquinaria, tablaExportMaquinaria } from './exportarMaquinaria';
import type { InfoEquipo } from './MaquinariaPage';
import { supabase } from '@/shared/lib/supabase';

const HEADER_STYLE = {
  font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  },
};

const GRUPO_EMPRESA_STYLE = {
  font: { name: 'Arial', sz: 12, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: '1E293B' } }, // Slate oscuro elegante
  alignment: { horizontal: 'left', vertical: 'center' },
  border: HEADER_STYLE.border,
};

const TITLE_STYLE = { font: { name: 'Arial', sz: 14, bold: true } };

const CELDA_STYLE = {
  font: { name: 'Arial', sz: 10 },
  alignment: { vertical: 'center', wrapText: true },
  border: HEADER_STYLE.border,
};

const hoyTxt = () => new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const nombreArchivo = (ext: string) => `control-maquinaria-${new Date().toISOString().slice(0, 10)}.${ext}`;

export type OrientacionPdf = 'auto' | 'vertical' | 'horizontal';

/**
 * Genera y descarga el archivo Excel con las columnas elegidas
 * y agrupación por empresa/propietario si se solicitó.
 */
export async function descargarMaquinariaExcel(
  equipos: MaquinariaEquipo[],
  keys: string[],
  infoMap?: Map<string, InfoEquipo>,
  titulo = 'Equipos',
  agruparPorEmpresa = false,
): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };

  const { head, filas, grupos } = tablaExportMaquinaria(equipos, keys, infoMap, agruparPorEmpresa);
  const cols = camposElegidosMaquinaria(keys);
  const ultimaCol = Math.max(0, head.length - 1);

  const aoa: unknown[][] = [
    [`CONTROL DE MAQUINARIA Y VEHÍCULOS · ${titulo.toUpperCase()} · MGG`],
    [`${equipos.length} equipo(s) · ${hoyTxt()}${agruparPorEmpresa ? ` · Agrupado por Empresa (${grupos.length} empresas)` : ''}`],
    [],
  ];

  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ultimaCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ultimaCol } },
  ];

  const filasConEstilo: { r: number; tipo: 'header' | 'empresa' | 'celda' }[] = [];

  if (agruparPorEmpresa && grupos.length > 0) {
    for (const g of grupos) {
      const rowEmpresa = aoa.length;
      aoa.push([`🏢 EMPRESA / PROPIETARIO: ${g.empresa.toUpperCase()} (${g.equipos.length} equipos)`]);
      merges.push({ s: { r: rowEmpresa, c: 0 }, e: { r: rowEmpresa, c: ultimaCol } });
      filasConEstilo.push({ r: rowEmpresa, tipo: 'empresa' });

      const rowHead = aoa.length;
      aoa.push(head);
      filasConEstilo.push({ r: rowHead, tipo: 'header' });

      for (const f of g.filas) {
        const rowCelda = aoa.length;
        aoa.push(f);
        filasConEstilo.push({ r: rowCelda, tipo: 'celda' });
      }
      aoa.push([]); // Espacio entre empresas
    }
  } else {
    const rowHead = aoa.length;
    aoa.push(head);
    filasConEstilo.push({ r: rowHead, tipo: 'header' });

    for (const f of filas) {
      const rowCelda = aoa.length;
      aoa.push(f);
      filasConEstilo.push({ r: rowCelda, tipo: 'celda' });
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = [{ wch: 6 }, ...cols.map((c) => ({ wch: c.ancho }))];
  (ws as Record<string, unknown>)['!merges'] = merges;

  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c })];
  const tCell = cellAt(0, 0);
  if (tCell) tCell.s = TITLE_STYLE;

  for (const item of filasConEstilo) {
    if (item.tipo === 'empresa') {
      const cell = cellAt(item.r, 0);
      if (cell) cell.s = GRUPO_EMPRESA_STYLE;
    } else if (item.tipo === 'header') {
      head.forEach((_, c) => {
        const cell = cellAt(item.r, c);
        if (cell) cell.s = HEADER_STYLE;
      });
    } else if (item.tipo === 'celda') {
      head.forEach((_, c) => {
        const cell = cellAt(item.r, c);
        if (cell) cell.s = { ...CELDA_STYLE, ...(c === 0 ? { alignment: { horizontal: 'center', vertical: 'center' } } : {}) };
      });
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Maquinaria');
  await previewWorkbook(wb, nombreArchivo('xlsx'));
}

/**
 * Construye el documento jsPDF con formato estándar MGG y soporte para
 * agrupación por empresa/propietario.
 */
export async function construirMaquinariaPdfDoc(
  equipos: MaquinariaEquipo[],
  keys: string[],
  infoMap?: Map<string, InfoEquipo>,
  titulo = 'Equipos',
  orientacion: OrientacionPdf = 'auto',
  agruparPorEmpresa = false,
) {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);

  const campos = camposElegidosMaquinaria(keys);
  const { head, filas, grupos } = tablaExportMaquinaria(equipos, keys, infoMap, agruparPorEmpresa);

  const anchoTotal = 6 + campos.reduce((a, c) => a + c.ancho, 0);
  const horizontal = orientacion === 'horizontal' || (orientacion === 'auto' && anchoTotal > 95);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: horizontal ? 'landscape' : 'portrait' });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const util = anchoUtilPdf(W);
  const ptPorCaracter = util / anchoTotal;
  const letra = Math.max(6, Math.min(9.5, Math.round(ptPorCaracter * 1.6 * 2) / 2));
  const relleno = letra >= 8.5 ? 5 : letra >= 7 ? 3.5 : 2.5;

  const logo = await loadLogoDataUrl().catch(() => null);

  // Encabezado
  let y = MARGEN_PDF;
  const LOGO = 52;
  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', MARGEN_PDF, y, LOGO, LOGO);
    } catch {
      /* logo opcional */
    }
  }
  const tx = logo ? MARGEN_PDF + LOGO + 14 : MARGEN_PDF;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(150, 90, 0);
  doc.text('MINERAL GROUP GUAYANA C.A.', tx, y + 14);

  doc.setTextColor(20);
  doc.setFontSize(15);
  doc.text(`Control de Maquinaria y Vehículos · ${titulo}`, tx, y + 34);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(
    `${equipos.length} equipo(s) · ${hoyTxt()}${agruparPorEmpresa ? ` · Agrupado por Empresa (${grupos.length})` : ''}`,
    tx,
    y + 50,
  );
  doc.setTextColor(0);

  y += LOGO + 12;
  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1.5);
  doc.line(MARGEN_PDF, y, W - MARGEN_PDF, y);
  y += 14;

  const columnStyles: Record<number, { cellWidth: number; halign?: 'right' | 'center' }> = {
    0: { cellWidth: util * (6 / anchoTotal), halign: 'center' },
  };
  campos.forEach((c, i) => {
    columnStyles[i + 1] = { cellWidth: util * (c.ancho / anchoTotal) };
  });

  const piePagina = () => {
    const n = doc.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${n}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
    doc.setTextColor(0);
  };

  if (agruparPorEmpresa && grupos.length > 0) {
    let currentY = y;
    for (const g of grupos) {
      // Si queda poco espacio para la tabla del grupo, saltar página
      if (currentY > H - 120) {
        doc.addPage();
        currentY = MARGEN_PDF + 15;
      }

      // Título de la empresa
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(20);
      doc.setFillColor(245, 245, 245);
      doc.rect(MARGEN_PDF, currentY - 2, util, 18, 'F');
      doc.text(`🏢 EMPRESA: ${g.empresa.toUpperCase()} (${g.equipos.length} equipos)`, MARGEN_PDF + 6, currentY + 11);
      currentY += 24;

      autoTable(doc, {
        startY: currentY,
        head: [head],
        body: g.filas.map((f) => f.map((v) => String(v))),
        theme: 'grid',
        headStyles: {
          fillColor: [255, 138, 0],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: letra,
          halign: 'center',
          valign: 'middle',
          lineColor: [60, 60, 60],
          lineWidth: 0.75,
        },
        styles: {
          fontSize: letra,
          cellPadding: relleno,
          overflow: 'linebreak',
          valign: 'middle',
          lineColor: [60, 60, 60],
          lineWidth: 0.75,
          textColor: 20,
        },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles,
        margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 14 },
        didDrawPage: piePagina,
      });

      // @ts-expect-error autoTable añade lastAutoTable
      currentY = (doc.lastAutoTable?.finalY ?? currentY) + 20;
    }
  } else {
    autoTable(doc, {
      startY: y,
      head: [head],
      body: filas.map((f) => f.map((v) => String(v))),
      theme: 'grid',
      headStyles: {
        fillColor: [255, 138, 0],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: letra,
        halign: 'center',
        valign: 'middle',
        lineColor: [60, 60, 60],
        lineWidth: 0.75,
      },
      styles: {
        fontSize: letra,
        cellPadding: relleno,
        overflow: 'linebreak',
        valign: 'middle',
        lineColor: [60, 60, 60],
        lineWidth: 0.75,
        textColor: 20,
      },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      columnStyles,
      margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 14 },
      didDrawPage: piePagina,
    });
  }

  return doc;
}

/**
 * Descarga el archivo PDF interactivo
 */
export async function descargarMaquinariaPdf(
  equipos: MaquinariaEquipo[],
  keys: string[],
  infoMap?: Map<string, InfoEquipo>,
  titulo = 'Equipos',
  orientacion: OrientacionPdf = 'auto',
  agruparPorEmpresa = false,
): Promise<void> {
  const doc = await construirMaquinariaPdfDoc(equipos, keys, infoMap, titulo, orientacion, agruparPorEmpresa);
  previewPdfDoc(doc, nombreArchivo('pdf'));
}

/**
 * Envía el PDF generado por correo electrónico
 */
export async function enviarMaquinariaCorreo(
  equipos: MaquinariaEquipo[],
  keys: string[],
  infoMap: Map<string, InfoEquipo> | undefined,
  destinos: string[],
  titulo = 'Equipos',
  orientacion: OrientacionPdf = 'auto',
  agruparPorEmpresa = false,
): Promise<{ destinatarios: string[] }> {
  const doc = await construirMaquinariaPdfDoc(equipos, keys, infoMap, titulo, orientacion, agruparPorEmpresa);
  const base64 = doc.output('datauristring').split(',')[1] ?? '';

  const { data, error } = await supabase.functions.invoke<{ ok: true; destinatarios: string[] } | { error: string }>(
    'enviar-reporte',
    {
      body: {
        pdf_base64: base64,
        nombre_archivo: nombreArchivo('pdf'),
        asunto: `Control de Maquinaria · ${titulo}`,
        mensaje: `Se adjunta el reporte de Control de Maquinaria y Vehículos (${equipos.length} equipos)${agruparPorEmpresa ? ' agrupado por empresa' : ''}.`,
        to_emails: destinos,
      },
    },
  );

  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}
