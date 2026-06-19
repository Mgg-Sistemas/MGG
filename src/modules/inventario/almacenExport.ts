/* ============================================================
   MGG · Inventario · Export de productos por almacén
   Descarga (solo a pedido del usuario) los productos de un
   almacén en Excel y PDF. El `stock`/`precio` de cada fila ya
   vienen con los valores propios del almacén (PMP por almacén).
   ============================================================ */
import { previewWorkbook, previewPdfDoc } from '@/shared/lib/reportPreview';
import type { Almacen, Existencia, Producto } from '@/shared/lib/types';

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
  previewWorkbook(XLSX, wb, `almacen-${almacen}.xlsx`);
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
  previewPdfDoc(doc, `almacen-${almacen}.pdf`);
}

/* ============================================================
   Reporte GENERAL de inventario por almacenes y subalmacenes.
   Recorre la jerarquía sede → almacén → subalmacén y, por cada
   uno, lista sus productos (stock/costo/valor) con su subtotal.
   ============================================================ */
export async function descargarReporteAlmacenesPdf(): Promise<void> {
  const [
    { jsPDF }, { default: autoTable }, { money, num, dateTime },
    { loadLogoDataUrl }, almacenesRepo, inventarioRepo,
  ] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
    import('./almacenes.repository'),
    import('./inventario.repository'),
  ]);
  const [almacenes, existencias, productos, logo] = await Promise.all([
    almacenesRepo.listAlmacenes(),
    almacenesRepo.listExistencias(),
    inventarioRepo.listProductos(),
    loadLogoDataUrl().catch(() => null),
  ]);

  const prodById = new Map(productos.map((p) => [p.id, p]));
  // Existencias agrupadas por NOMBRE de almacén (la existencia se llavea por nombre).
  const exPorAlmacen = new Map<string, Existencia[]>();
  for (const e of existencias) {
    const arr = exPorAlmacen.get(e.almacen) ?? [];
    arr.push(e);
    exPorAlmacen.set(e.almacen, arr);
  }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const MARGIN = 42.52;
  const PAGE_H = doc.internal.pageSize.getHeight();
  let y = MARGIN;

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 60 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Inventario · Reporte por almacenes y subalmacenes', tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`MGG · ${dateTime(new Date().toISOString())}`, tx, y + 33);
  y += 60;

  const ensureSpace = (need: number) => {
    if (y + need > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN; }
  };

  let valorGeneral = 0;

  // Render de un almacén (o subalmacén) con sus productos. `nivel` indenta los subs.
  const renderAlmacen = (a: Almacen, nivel: number) => {
    const rows = (exPorAlmacen.get(a.nombre) ?? [])
      .filter((e) => (Number(e.stock) || 0) !== 0)
      .map((e) => {
        const p = prodById.get(e.producto_id);
        const stock = Number(e.stock) || 0;
        const costo = Number(e.costo_promedio) || 0;
        const valor = Math.round(stock * costo * 100) / 100;
        return {
          sku: p?.sku ?? '—', nombre: p?.nombre ?? '(producto eliminado)',
          categoria: p?.categoria ?? '—', unidad: p?.unidad ?? '', stock, costo, valor,
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const subtotal = rows.reduce((s, r) => s + r.valor, 0);
    valorGeneral += subtotal;

    ensureSpace(48);
    const indent = MARGIN + nivel * 14;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(nivel === 0 ? 12 : 10.5);
    doc.setTextColor(nivel === 0 ? 20 : 90);
    const etiqueta = nivel === 0
      ? `${a.sede ? `${a.sede} · ` : ''}${a.nombre}`
      : `↳ ${a.nombre}`;
    doc.text(etiqueta, indent, y + 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(120);
    doc.text(`${rows.length} producto(s) · valor ${money(subtotal)}`, doc.internal.pageSize.getWidth() - MARGIN, y + 12, { align: 'right' });
    doc.setTextColor(0);
    y += 20;

    if (!rows.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(140);
      doc.text('Sin existencias.', indent + 6, y + 6); doc.setTextColor(0);
      doc.setFont('helvetica', 'normal');
      y += 18;
      return;
    }

    autoTable(doc, {
      startY: y,
      head: [['SKU', 'Producto', 'Categoría', 'Unidad', 'Stock', 'Costo unit.', 'Valor']],
      body: rows.map((r) => [r.sku, r.nombre, r.categoria, r.unidad, num(r.stock), money(r.costo), money(r.valor)]),
      foot: [['', '', '', '', '', 'Subtotal', money(subtotal)]],
      theme: 'grid',
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 8 },
      footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold' },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      margin: { top: MARGIN, bottom: MARGIN, left: indent, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  };

  // Jerarquía: almacenes raíz (sin padre) ordenados por sede + nombre; debajo sus subalmacenes.
  const raices = almacenes.filter((a) => !a.parent_id)
    .sort((a, b) => (`${a.sede ?? '~'}·${a.nombre}`).localeCompare(`${b.sede ?? '~'}·${b.nombre}`));
  const hijosDe = (id: string) => almacenes.filter((a) => a.parent_id === id)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  for (const raiz of raices) {
    renderAlmacen(raiz, 0);
    for (const sub of hijosDe(raiz.id)) renderAlmacen(sub, 1);
  }

  ensureSpace(30);
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.2);
  doc.line(MARGIN, y, doc.internal.pageSize.getWidth() - MARGIN, y);
  y += 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('VALOR TOTAL DEL INVENTARIO', MARGIN, y);
  doc.text(money(valorGeneral), doc.internal.pageSize.getWidth() - MARGIN, y, { align: 'right' });

  previewPdfDoc(doc, `inventario-por-almacenes-${new Date().toISOString().slice(0, 10)}.pdf`);
}
