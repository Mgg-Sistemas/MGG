/* ============================================================
   MGG · Inventario · Export de productos por almacén
   Descarga (solo a pedido del usuario) los productos de un
   almacén en Excel y PDF. El `stock`/`precio` de cada fila ya
   vienen con los valores propios del almacén (PMP por almacén).
   ============================================================ */
import type { Producto } from '@/shared/lib/types';

interface FilaAlmacen extends Producto { _valor?: number }

function valorDe(p: FilaAlmacen): number {
  return p._valor != null ? p._valor : (Number(p.stock) || 0) * (Number(p.precio) || 0);
}

const HEADER_STYLE = {
  font: { name: 'Arial', sz: 12, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: {
    top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } }, right: { style: 'thin', color: { rgb: '000000' } },
  },
};
const TITLE_STYLE = { ...HEADER_STYLE, font: { ...HEADER_STYLE.font, sz: 14 } };

export async function descargarAlmacenExcel(almacen: string, rows: Producto[]): Promise<void> {
  const [XLSXmod, { money }] = await Promise.all([
    import('xlsx-js-style'),
    import('@/shared/lib/format'),
  ]);
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
    writeFile: (wb: unknown, name: string) => void;
  };

  const head = ['SKU', 'Producto', 'Categoría', 'Unidad', 'Stock', 'Costo unit. (PMP)', 'Valor'];
  const filas = rows.map((p) => [
    p.sku, p.nombre, p.categoria, p.unidad, Number(p.stock) || 0, Number(p.precio) || 0, valorDe(p),
  ]);
  const valorTotal = rows.reduce((a, p) => a + valorDe(p), 0);

  const aoa: unknown[][] = [
    [`INVENTARIO · ALMACÉN ${almacen.toUpperCase()} · MGG`],
    [`${rows.length} producto(s) · valor total ${money(valorTotal)}`],
    [],
    head,
    ...filas,
    [],
    ['', '', '', '', '', 'VALOR TOTAL', valorTotal],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 14 }];
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
  ];

  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c })];
  const tituloCell = cellAt(0, 0); if (tituloCell) tituloCell.s = TITLE_STYLE;
  head.forEach((_, c) => { const cell = cellAt(3, c); if (cell) cell.s = HEADER_STYLE; });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Almacén');
  XLSX.writeFile(wb, `almacen-${almacen}.xlsx`);
}

export async function descargarAlmacenPdf(almacen: string, rows: Producto[]): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { money, num, dateTime }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 60 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(`Inventario · Almacén ${almacen}`, tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`MGG · ${dateTime(new Date().toISOString())}`, tx, y + 33);
  y += 60;

  const valorTotal = rows.reduce((a, p) => a + ((p as FilaAlmacen)._valor ?? (Number(p.stock) || 0) * (Number(p.precio) || 0)), 0);

  autoTable(doc, {
    startY: y,
    head: [['SKU', 'Producto', 'Categoría', 'Unidad', 'Stock', 'Costo unit.', 'Valor']],
    body: rows.map((p) => [
      p.sku, p.nombre, p.categoria, p.unidad,
      num(Number(p.stock) || 0), money(Number(p.precio) || 0),
      money((p as FilaAlmacen)._valor ?? (Number(p.stock) || 0) * (Number(p.precio) || 0)),
    ]),
    foot: [['', '', '', '', '', 'VALOR TOTAL', money(valorTotal)]],
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 8 },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 3 },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  doc.save(`almacen-${almacen}.pdf`);
}
