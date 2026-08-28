import { supabase } from '@/shared/lib/supabase';
import { dateTime, money, num } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import type { Almacen, Existencia, Movimiento, Producto } from '@/shared/lib/types';
import { desglosePorSede } from './stockPorAlmacen';
import { TIPOS_MOVIMIENTO } from './movimientos.repository';

interface Data {
  producto: Producto;
  movimientos: Movimiento[];
  existencias: Existencia[];
  almacenes: Pick<Almacen, 'nombre' | 'sede'>[];
}

async function cargar(productoId: string): Promise<Data> {
  const [{ data: producto, error: pe }, { data: movs, error: me }, { data: exs }, { data: alms }] = await Promise.all([
    supabase.from('productos').select('*').eq('id', productoId).single(),
    supabase.from('movimientos').select('*').eq('producto_id', productoId).order('at', { ascending: false }).limit(500),
    // Dónde está el stock (sede → almacén): el papel debe decir lo mismo que el modal.
    supabase.from('existencias').select('*').eq('producto_id', productoId),
    supabase.from('almacenes').select('nombre, sede'),
  ]);
  if (pe || !producto) throw pe ?? new Error('Producto no encontrado');
  if (me) throw me;
  return {
    producto: producto as Producto, movimientos: (movs ?? []) as Movimiento[],
    existencias: (exs ?? []) as Existencia[], almacenes: (alms ?? []) as Pick<Almacen, 'nombre' | 'sede'>[],
  };
}

export async function descargarProductoPdf(productoId: string): Promise<void> {
  const [{ producto, movimientos, existencias, almacenes }, logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    cargar(productoId),
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const totalIn = movimientos.filter((m) => m.delta > 0).reduce((a, m) => a + m.delta, 0);
  const totalOut = movimientos.filter((m) => m.delta < 0).reduce((a, m) => a + Math.abs(m.delta), 0);
  const valor = (producto.stock ?? 0) * (producto.precio ?? 0);

  // Costo inicial = costo del movimiento más antiguo que registró un costo.
  let costoInicial: number | null = null;
  {
    const crono = [...movimientos].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    for (const m of crono) {
      if (m.costo_promedio != null || m.precio_unitario != null) {
        costoInicial = m.costo_promedio ?? m.precio_unitario ?? null;
        break;
      }
    }
  }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  const LOGO_SIZE = 56;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE); } catch { /* logo opcional */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Trazabilidad de producto', TEXT_X, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Mineral Group Guayana C.A. · Generado ${dateTime(new Date().toISOString())}`, TEXT_X, y + 36);
  y += Math.max(LOGO_SIZE, 36) + 10;

  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 18;
  doc.setLineWidth(0.5);
  doc.setDrawColor(180);

  // Ficha del producto
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`${producto.sku} · ${producto.nombre}`, MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const ficha: Array<[string, string]> = [
    ['Categoría', producto.categoria],
    ['Unidad', producto.unidad],
    ['Almacén principal (catálogo)', producto.almacen],
    ['Estado', producto.estado],
    ['Receta de fundición', producto.receta_fundicion ?? '—'],
    ['En proceso de fundición', producto.en_fundicion ? 'Sí' : 'No'],
    ['Stock total (todas las sedes)', num(producto.stock)],
    ['Stock mínimo', num(producto.stock_min)],
    ['Costo inicial', costoInicial != null ? money(costoInicial) : '—'],
    ['Precio UND', money(producto.precio)],
    ['Costo base (PMP) actual', money(producto.precio_promedio ?? producto.precio)],
    ['Valor en inventario', money(valor)],
    ['Total entradas históricas (todas las sedes)', num(totalIn)],
    ['Total salidas históricas (todas las sedes)', num(totalOut)],
    ['Creado', dateTime(producto.created_at)],
    ['Última actualización', producto.updated_at ? dateTime(producto.updated_at) : '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: ficha,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 200 }, 1: { cellWidth: 'auto' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  // Dónde está el stock: una fila por almacén con stock, agrupada por sede.
  const desglose = desglosePorSede(existencias, almacenes, null);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Stock por sede y almacén', MARGIN, y);
  y += 4;
  if (!desglose.sedes.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text('Sin stock en ningún almacén.', MARGIN, y + 14);
    y += 28;
  } else {
    autoTable(doc, {
      startY: y + 4,
      head: [['Sede', 'Almacén', 'Stock', 'PMP del almacén', 'Valor']],
      body: [
        ...desglose.sedes.flatMap((sd) => sd.almacenes.map((a) => [sd.etiqueta, a.almacen, num(a.stock), money(a.costo), money(a.stock * a.costo)])),
        ['Suma por almacén', 'todas las sedes', num(desglose.total), '', ''],
      ],
      theme: 'grid',
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  }

  // Movimientos
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Movimientos (${movimientos.length})`, MARGIN, y);
  y += 4;

  if (!movimientos.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text('Sin movimientos registrados.', MARGIN, y + 14);
  } else {
    autoTable(doc, {
      startY: y + 4,
      head: [['Fecha', 'Tipo', 'Almacén', 'Δ', 'Saldo', 'Costo unit.', 'PMP', 'Ref.', 'Detalle']],
      body: movimientos.map((m) => [
        dateTime(m.at),
        TIPOS_MOVIMIENTO[m.tipo]?.label ?? m.tipo,
        m.almacen?.trim() ? m.almacen : '(sin almacén)',
        (m.delta > 0 ? '+' : '') + num(m.delta),
        num(m.stock_despues),
        m.precio_unitario != null ? money(m.precio_unitario) : '—',
        m.costo_promedio != null ? money(m.costo_promedio) : '—',
        m.ref_codigo ?? '—',
        m.detalle ?? '',
      ]),
      theme: 'grid',
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: {
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
      },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    // Saldo y PMP son del almacén de cada línea; las recepciones de compra no registran
    // almacén y llevan el saldo y el PMP de TODAS las sedes. El papel debe decirlo.
    const yNota = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text('Saldo y PMP corresponden al almacén de cada línea. En las líneas «(sin almacén)» (recepciones de compra) son el saldo y el PMP de todas las sedes.', MARGIN, yNota, { maxWidth: PAGE_W - 2 * MARGIN });
    doc.setTextColor(0);
  }

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Documento auto-generado · ${producto.sku} · ${dateTime(new Date().toISOString())}`,
    MARGIN,
    pageH - 24,
  );

  doc.save(`trazabilidad-${producto.sku}.pdf`);
}
