/* ============================================================
   Golden Touch · Tesorería · Excel «Pendientes por pagar»
   El mismo reporte del PDF, en Excel con los estilos del sistema en tonos
   PASTEL (los de «Compras por estado»): un bloque por segmento (Compras directas
   · OC · Servicios · Servicios directos) con subtotal, el TOTAL GENERAL y, aparte
   y fuera del total, las cuentas a crédito. Cada renglón dice a quién, cuánto
   ($ y Bs a la tasa BCV del día), en qué estado y CÓMO se le paga (método y datos).
   Vista previa antes de descargar.
   ============================================================ */
import { previewExcelArchivo } from '@/shared/lib/reportePreview';
import type { DatosPendientesPorPagar, SegmentoPendiente } from './pendientesPorPagar';

/* Paleta PASTEL (los mismos tonos de «Compras por estado»). */
const PASTEL = {
  titulo: 'FFC07E46',        // terracota suave (títulos)
  cabecera: 'FFF6D9B8',      // durazno claro (encabezado de la tabla)
  cabeceraTexto: 'FF5C3A1C', // café oscuro: legible sobre el durazno
  grupo: 'FFFBEBD8',         // arena (cabecera de cada segmento y subtotales)
  grupoTexto: 'FF8A5A2B',    // terracota oscura (texto de los bloques)
  cebra: 'FFFDF8F2',         // crema casi blanco (filas alternas)
  total: 'FFF4D2AE',         // durazno algo más cargado (fila del total)
  borde: 'FFE0D3C2',         // café muy claro (bordes)
};

const COLS = 7;
const FMT_USD = '"$" #,##0.00';
const FMT_BS = '"Bs" #,##0.00';

export async function construirPendientesPorPagarExcel(d: DatosPendientesPorPagar): Promise<ArrayBuffer> {
  const [{ default: ExcelJS }, { identidadEmpresa }] = await Promise.all([
    import('exceljs'),
    import('@/shared/lib/empresa'),
  ]);
  const emp = identidadEmpresa('MGG');
  const tasa = d.tasa;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pendientes por pagar', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  ws.columns = [
    { width: 30 }, { width: 18 }, { width: 38 }, { width: 24 }, { width: 62 }, { width: 16 }, { width: 22 },
  ];
  const borde = { style: 'thin' as const, color: { argb: PASTEL.borde } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  // ── Encabezado del documento ──
  ws.mergeCells(1, 1, 1, COLS);
  ws.mergeCells(2, 1, 2, COLS);
  ws.mergeCells(3, 1, 3, COLS);
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 18;

  const titulo = ws.getCell(1, 1);
  titulo.value = `PENDIENTES POR PAGAR · ${emp.nombre}`;
  titulo.font = { name: 'Arial', size: 14, bold: true, color: { argb: PASTEL.titulo } };
  titulo.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const subtitulo = ws.getCell(2, 1);
  subtitulo.value = 'Compras directas · Órdenes de compra · Servicios · Servicios directos · (aparte) Cuentas a crédito';
  subtitulo.font = { name: 'Arial', size: 10, color: { argb: 'FF5C6673' } };
  subtitulo.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const info = ws.getCell(3, 1);
  info.value = `${d.totCant} ítem(s) por pagar · Generado ${new Date(d.generadoEn).toLocaleString('es-VE')}` +
    (tasa > 0 ? ` · Tasa BCV: Bs ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / $` : '');
  info.font = { name: 'Arial', size: 9, color: { argb: 'FF5C6673' } };
  info.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  // ── Encabezado de la tabla ──
  const cab = ws.getRow(4);
  cab.values = ['TIPO', 'CÓDIGO', 'PROVEEDOR', 'ESTADO', 'MÉTODO Y DATOS DE PAGO', 'MONTO $', 'MONTO Bs'];
  cab.height = 24;
  cab.eachCell((c) => {
    c.font = { name: 'Arial', size: 11, bold: true, color: { argb: PASTEL.cabeceraTexto } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PASTEL.cabecera } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = bordes;
  });

  /** Sin tasa solo se conoce la moneda propia de cada renglón: la otra queda vacía (no un 0). */
  const celdaUsd = (usd: number) => (tasa > 0 || usd > 0 ? usd : '');
  const celdaBs = (bs: number) => (tasa > 0 || bs > 0 ? bs : '');

  const banda = (row: import('exceljs').Row, fondo: string) => {
    for (let c = 1; c <= COLS; c++) {
      const cell = ws.getCell(row.number, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fondo } };
      cell.border = bordes;
    }
  };

  let zebra = 0;
  const bloque = (seg: SegmentoPendiente, nota?: string) => {
    const cabGrupo = ws.addRow([]);
    cabGrupo.height = 20;
    ws.mergeCells(cabGrupo.number, 1, cabGrupo.number, COLS);
    const gc = ws.getCell(cabGrupo.number, 1);
    gc.value = `${seg.titulo} (${seg.filas.length})${nota ? ' · ' + nota : ''}`;
    gc.font = { name: 'Arial', size: 11, bold: true, color: { argb: PASTEL.grupoTexto } };
    gc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    banda(cabGrupo, PASTEL.grupo);

    for (const f of seg.filas) {
      const metodo = f.pagos.map((p) => p.texto).join('\n') || '—';
      const r = ws.addRow([seg.titulo, f.codigo, f.proveedor, f.estado, metodo, celdaUsd(f.usd), celdaBs(f.bs)]);
      // Varias patas de pago = varias líneas en la celda: la fila crece para que se lean todas.
      const lineas = Math.max(1, f.pagos.length);
      if (lineas > 1) r.height = 15 * lineas;
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.font = { name: 'Arial', size: 10, bold: col === 5 };
        c.border = bordes;
        c.alignment = {
          vertical: 'middle', wrapText: col === 3 || col === 5,
          indent: col >= 2 && col <= 5 ? 1 : 0,
          horizontal: col >= 6 ? 'right' : 'left',
        };
        if (col === 6) c.numFmt = FMT_USD;
        if (col === 7) c.numFmt = FMT_BS;
      });
      if (zebra % 2 === 1) banda(r, PASTEL.cebra);
      zebra += 1;
    }

    const st = ws.addRow(['SUBTOTAL', '', '', '', '', celdaUsd(seg.subUsd), celdaBs(seg.subBs)]);
    st.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { name: 'Arial', size: 10, bold: true, color: { argb: PASTEL.grupoTexto } };
      c.alignment = { vertical: 'middle', horizontal: col >= 6 ? 'right' : 'left', indent: col === 1 ? 1 : 0 };
      if (col === 6) c.numFmt = FMT_USD;
      if (col === 7) c.numFmt = FMT_BS;
    });
    banda(st, PASTEL.grupo);
  };

  for (const seg of d.segmentos) bloque(seg);

  // ── Total general (solo lo por pagar; el crédito va aparte) ──
  if (d.segmentos.length) {
    const tr = ws.addRow(['TOTAL GENERAL', `${d.totCant} ítem(s)`, '', '', '', celdaUsd(d.totUsd), celdaBs(d.totBs)]);
    tr.height = 24;
    tr.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { name: 'Arial', size: 11, bold: true, color: { argb: PASTEL.cabeceraTexto } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PASTEL.total } };
      c.alignment = { vertical: 'middle', horizontal: col >= 6 ? 'right' : 'left', indent: col === 1 ? 1 : 0 };
      c.border = bordes;
      if (col === 6) c.numFmt = FMT_USD;
      if (col === 7) c.numFmt = FMT_BS;
    });
  }

  // ── Anexo: cuentas a crédito (no suman al total) ──
  if (d.credito) {
    ws.addRow([]);
    bloque(d.credito, 'NO entran en el total: se saldan por abonos en Tesorería');
  }

  if (!d.segmentos.length && !d.credito) {
    const r = ws.addRow(['No hay pendientes por pagar.']);
    ws.mergeCells(r.number, 1, r.number, COLS);
    r.getCell(1).font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF5C6673' } };
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Genera el Excel del reporte y abre la vista previa (descarga solo si el usuario lo pide). */
export async function descargarPendientesPorPagarExcel(d: DatosPendientesPorPagar): Promise<void> {
  const bytes = await construirPendientesPorPagarExcel(d);
  await previewExcelArchivo(bytes, `pendientes-por-pagar-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
