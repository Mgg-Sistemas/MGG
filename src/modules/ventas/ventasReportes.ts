/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Los cuatro reportes

   Son reportes INTERNOS: los lee la empresa, no el cliente. Por eso aquí SÍ van
   el costo y la ganancia, justo al revés que los comprobantes (`comprobante*Pdf`),
   donde esas dos columnas no pueden aparecer nunca.

   DOS REGLAS QUE NO SE TOCAN
   ──────────────────────────
   1) La ganancia YA ESTÁ GUARDADA Y CONGELADA en cada renglón
      (`ventas_renglones.ganancia`, escrita por `confirmar_venta` contra el costo
      promedio de ESE día). Aquí se SUMA lo guardado; jamás se recalcula contra el
      costo actual del producto. El costo promedio se mueve con cada compra: si
      se recalculara, el margen de una venta de hace seis meses cambiaría solo,
      y el reporte del mes pasado dejaría de coincidir consigo mismo.

   2) El margen % se calcula sobre la VENTA SIN IVA, no sobre el total. El IVA no
      es venta ni es ganancia: es dinero del Estado que se retiene y se entrega.
      Dividir la ganancia por un total con IVA adentro achica el margen a mentira.
        · por documento: base = total − iva_monto  (= subtotal − descuento)
        · por renglón:   `ventas_renglones.subtotal` ya viene sin IVA.

   Los cuatro terminan en `previewPdf`: se ven en pantalla y se bajan solo si el
   usuario presiona Descargar.
   ============================================================ */
import { EMPRESA_NOMBRE } from '@/shared/lib/empresa';
import type { jsPDF as JsPDFType } from 'jspdf';
import { date, dateTime, money, montoMoneda, num } from '@/shared/lib/format';
import { loadLogoPdfDataUrl, anchoLogoPdf, dibujarLogoPdf } from '@/shared/lib/pdfLogo';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { previewPdf } from '@/shared/lib/reportePreview';
import { listProductos } from '@/modules/inventario/inventario.repository';
import {
  listCuentasPorCobrar,
  type CuentaPorCobrar,
} from '@/modules/tesoreria/cuentasPorCobrar.repository';
import {
  listRenglonesDeVentas, listVentas,
  type CondicionVenta, type EstadoVenta, type TipoVenta,
  type Venta, type VentaRenglon,
} from './ventas.repository';
import { round2 } from './ventasCalculos';

/* ─────────────────────────── Tipos públicos ─────────────────────────── */

/** Ventana de tiempo del reporte. Filtra por `ventas.created_at` (fecha del documento). */
export interface RangoReporte {
  /** ISO. Inclusive. */
  desde?: string | null;
  /** ISO. Inclusive. */
  hasta?: string | null;
}

export interface FiltroVentasPeriodo extends RangoReporte {
  /** Uno o varios. Si no se pasa: `['confirmada','entregada']`. */
  estado?: EstadoVenta | EstadoVenta[] | null;
  tipo?: TipoVenta | null;
  condicion?: CondicionVenta | null;
  clienteId?: string | null;
}

/** Una fila del reporte de ganancia por producto. Importes SIN IVA. */
export interface FilaGananciaProducto {
  producto_id: string;
  sku: string;
  nombre: string;
  categoria: string;
  cantidad: number;
  venta: number;
  costo: number;
  ganancia: number;
  /** `ganancia / venta × 100`. `null` si no hubo venta (no es 0 %: es «no aplica»). */
  margenPct: number | null;
}

/** Una fila del resumen por categoría. Mismo criterio que `FilaGananciaProducto`. */
export interface FilaGananciaCategoria {
  categoria: string;
  productos: number;
  venta: number;
  costo: number;
  ganancia: number;
  margenPct: number | null;
}

/** Una fila del reporte de ganancia por cliente. Importes SIN IVA. */
export interface FilaGananciaCliente {
  clienteKey: string;
  cliente: string;
  documentos: number;
  venta: number;
  costo: number;
  ganancia: number;
  margenPct: number | null;
}

/** Una fila del reporte de cuentas por cobrar. */
export interface FilaCuentaPorCobrar {
  id: string;
  tipo: string;
  contraparte: string;
  moneda: string;
  monto: number;
  cobrado: number;
  saldo: number;
  /** Días desde que se ABRIÓ la cuenta (es corriente: acumula varias ventas). */
  antiguedadDias: number;
  desde: string;
}

/* ─────────────────────────── Utilidades ─────────────────────────── */

const MARGIN = 56.69; // 2 cm por lado
const NARANJA: [number, number, number] = [255, 138, 0];
const PIZARRA: [number, number, number] = [30, 41, 59];

const ESTADOS: Record<EstadoVenta, string> = {
  borrador: 'Borrador',
  por_autorizar: 'Por autorizar',
  autorizada: 'Autorizada',
  confirmada: 'Confirmada',
  entregada: 'Entregada',
  anulada: 'Anulada',
};

const CONDICIONES: Record<CondicionVenta, string> = {
  contado: 'Contado',
  credito: 'Crédito',
};

/**
 * Margen sobre la venta SIN IVA. Devuelve `null` —no 0— cuando no hubo venta:
 * un margen de 0 % y un «no se vendió nada» no son lo mismo, y en una columna
 * de porcentajes esa diferencia se pierde si se rellena con cero.
 */
function margenPct(ganancia: number, ventaSinIva: number): number | null {
  return ventaSinIva > 0 ? round2((ganancia / ventaSinIva) * 100) : null;
}

function pct(v: number | null): string {
  return v == null ? '—' : `${num(v)} %`;
}

/**
 * La venta sin impuestos de un documento: el total menos el IVA y el IGTF.
 * Ninguno de los dos es venta ni ganancia: si el IGTF quedara adentro, el
 * margen de una factura con IGTF saldría más chico de lo que es.
 */
function baseSinIva(v: Venta): number {
  return round2(v.total - v.iva_monto - (v.igtf_monto || 0));
}

function textoRango(r: RangoReporte): string {
  const d = r.desde ? date(r.desde) : null;
  const h = r.hasta ? date(r.hasta) : null;
  if (d && h) return `${d} — ${h}`;
  if (d) return `desde ${d}`;
  if (h) return `hasta ${h}`;
  return 'todo el histórico';
}

/** Las monedas distintas que aparecen. Sirve para avisar si se están sumando peras con manzanas. */
function monedasDe(ventas: Venta[]): string[] {
  return [...new Set(ventas.map((v) => v.moneda || 'USD'))].sort();
}

/** `lastAutoTable` lo agrega el plugin en tiempo de ejecución; el tipo de jsPDF no lo conoce. */
function finalY(doc: JsPDFType): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/** Encabezado estándar: logo, título, subtítulo y la línea naranja de marca. */
async function nuevoDoc(
  titulo: string,
  subtitulo: string,
  orientation: 'portrait' | 'landscape' = 'portrait',
) {
  const [logo, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoPdfDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation });
  const anchoPagina = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  const LOGO = 48;
  if (logo) {
    dibujarLogoPdf(doc, logo, MARGIN, y, LOGO);
  }
  const tx = logo ? MARGIN + anchoLogoPdf(LOGO) + 14 : MARGIN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(pdfSafe(titulo), tx, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70);
  doc.text(`${EMPRESA_NOMBRE} · Ventas`, tx, y + 32);
  doc.text(pdfSafe(subtitulo), tx, y + 45);
  y += Math.max(LOGO, 48) + 8;

  doc.setDrawColor(...NARANJA);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, anchoPagina - MARGIN, y);
  doc.setLineWidth(0.2);
  doc.setTextColor(20);
  y += 16;

  return { doc, autoTable, anchoPagina, y };
}

/** Notas al pie del contenido (los «cómo se leen estos números»). */
function notas(doc: JsPDFType, yInicial: number, lineas: string[]): number {
  let y = yInicial;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(110);
  for (const l of lineas) {
    if (y > doc.internal.pageSize.getHeight() - MARGIN - 30) {
      doc.addPage();
      y = MARGIN;
    }
    doc.text(pdfSafe(l), MARGIN, y);
    y += 11;
  }
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(20);
  return y;
}

function pieDePagina(doc: JsPDFType): void {
  const alto = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  doc.text(
    `Reporte interno · generado ${dateTime(new Date().toISOString())}`,
    MARGIN, alto - 22,
  );
  doc.setTextColor(20);
}

/** Mensaje cuando el filtro no devolvió nada, para no entregar un PDF con tablas vacías. */
function sinDatos(doc: JsPDFType, y: number, mensaje: string): void {
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(pdfSafe(mensaje), MARGIN, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(20);
}

const hoy = () => new Date().toISOString().slice(0, 10);

/* ═══════════════════════════════════════════════════════════════
   1 · VENTAS DEL PERÍODO
   ═══════════════════════════════════════════════════════════════ */

/**
 * Las ventas del período con su total y su ganancia, y los totales al pie.
 *
 * Por defecto lista **confirmadas y entregadas**: un borrador todavía no es una
 * venta (no movió dinero ni material) y una anulada dejó de serlo. Si el usuario
 * pide explícitamente otros estados se respetan, pero los totales del pie
 * **nunca suman las anuladas** —sumarlas mostraría una facturación que no
 * existió— y el PDF lo dice cuando alguna aparece en la lista.
 *
 * Los totales van separados por MONEDA. Sumar USD con Bs en una sola línea da un
 * número que no significa nada.
 */
export async function descargarVentasDelPeriodoPdf(filtros: FiltroVentasPeriodo = {}): Promise<void> {
  const estado = filtros.estado ?? (['confirmada', 'entregada'] as EstadoVenta[]);
  const ventas = await listVentas({
    estado,
    tipo: filtros.tipo ?? null,
    condicion: filtros.condicion ?? null,
    clienteId: filtros.clienteId ?? null,
    desde: filtros.desde ?? null,
    hasta: filtros.hasta ?? null,
  });

  const etiquetaEstados = (Array.isArray(estado) ? estado : [estado])
    .map((e) => ESTADOS[e] ?? e).join(' · ');

  const { doc, autoTable, y } = await nuevoDoc(
    'Ventas del período',
    `Período: ${textoRango(filtros)}   ·   Estado: ${etiquetaEstados}   ·   ${ventas.length} documento(s)`,
    'landscape',
  );

  if (!ventas.length) {
    sinDatos(doc, y, 'No hay ventas que cumplan con el filtro elegido.');
    pieDePagina(doc);
    previewPdf(doc, `ventas-periodo-${hoy()}.pdf`);
    return;
  }

  autoTable(doc, {
    startY: y,
    head: [['Código', 'Fecha', 'Cliente', 'Tipo', 'Condición', 'Estado', 'Total', 'Base s/IVA', 'Costo', 'Ganancia', 'Margen']],
    body: ventas.map((v) => {
      const base = baseSinIva(v);
      return [
        v.codigo,
        date(v.created_at),
        pdfSafe(v.cliente_nombre ?? '') || '—',
        `${v.tipo === 'permuta' ? 'Permuta' : 'Venta'} · ${v.documento === 'factura' ? 'Factura' : 'N. entrega'}`,
        CONDICIONES[v.condicion] ?? v.condicion,
        ESTADOS[v.estado] ?? v.estado,
        montoMoneda(v.total, v.moneda),
        montoMoneda(base, v.moneda),
        montoMoneda(v.costo_total, v.moneda),
        montoMoneda(v.ganancia_total, v.moneda),
        pct(margenPct(v.ganancia_total, base)),
      ];
    }),
    theme: 'striped',
    headStyles: { fillColor: PIZARRA, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8, cellPadding: 3.5 },
    columnStyles: {
      0: { cellWidth: 66 },
      1: { cellWidth: 62 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 46 },
      4: { cellWidth: 50 },
      5: { cellWidth: 56 },
      6: { cellWidth: 66, halign: 'right' },
      7: { cellWidth: 66, halign: 'right' },
      8: { cellWidth: 62, halign: 'right' },
      9: { cellWidth: 66, halign: 'right' },
      10: { cellWidth: 48, halign: 'right' },
    },
    margin: MARGIN,
  });

  // ─── Totales, una línea por moneda y sin las anuladas ───
  const contadas = ventas.filter((v) => v.estado !== 'anulada');
  const hayAnuladas = contadas.length !== ventas.length;

  const porMoneda = new Map<string, { docs: number; total: number; base: number; costo: number; ganancia: number }>();
  for (const v of contadas) {
    const m = v.moneda || 'USD';
    const acc = porMoneda.get(m) ?? { docs: 0, total: 0, base: 0, costo: 0, ganancia: 0 };
    acc.docs += 1;
    acc.total += v.total;
    acc.base += baseSinIva(v);
    acc.costo += v.costo_total;
    acc.ganancia += v.ganancia_total;
    porMoneda.set(m, acc);
  }

  autoTable(doc, {
    startY: finalY(doc) + 14,
    head: [['Totales por moneda', 'Documentos', 'Total', 'Base s/IVA', 'Costo', 'Ganancia', 'Margen']],
    body: [...porMoneda.entries()].map(([m, a]) => {
      const base = round2(a.base);
      const ganancia = round2(a.ganancia);
      return [
        m,
        num(a.docs),
        montoMoneda(round2(a.total), m),
        montoMoneda(base, m),
        montoMoneda(round2(a.costo), m),
        montoMoneda(ganancia, m),
        pct(margenPct(ganancia, base)),
      ];
    }),
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 9, cellPadding: 4, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 70, halign: 'right' },
      2: { cellWidth: 90, halign: 'right' },
      3: { cellWidth: 90, halign: 'right' },
      4: { cellWidth: 90, halign: 'right' },
      5: { cellWidth: 90, halign: 'right' },
      6: { cellWidth: 66, halign: 'right' },
    },
    margin: MARGIN,
  });

  notas(doc, finalY(doc) + 16, [
    'El margen se calcula sobre la venta SIN impuestos (total − IVA − IGTF). Los impuestos no son venta ni ganancia: se retienen y se entregan.',
    'La ganancia es la que quedó congelada al confirmar cada venta, contra el costo promedio de ese día. No se recalcula con el costo de hoy.',
    ...(hayAnuladas
      ? ['Hay ventas anuladas en la lista: NO se suman en los totales, porque esa facturación no existió.']
      : []),
    'Documento interno: lleva costo y ganancia. No entregarlo al cliente.',
  ]);

  pieDePagina(doc);
  previewPdf(doc, `ventas-periodo-${hoy()}.pdf`);
}

/* ═══════════════════════════════════════════════════════════════
   2 · GANANCIA POR PRODUCTO Y CATEGORÍA
   ═══════════════════════════════════════════════════════════════ */

/**
 * Agrupa renglones por producto. `venta` sale de `subtotal` (cantidad × precio −
 * descuento del renglón, ya SIN IVA) y `ganancia` de la columna guardada: no se
 * recalcula contra el costo actual.
 *
 * Este es el reporte que justifica haber guardado los renglones en tablas reales
 * en vez de un `jsonb`: agrupar por producto sobre miles de ventas es un
 * `group by` con índice, no un recorrido de documentos en el navegador.
 */
export function agruparGananciaPorProducto(
  renglones: VentaRenglon[],
  categoriaDe: (productoId: string) => string,
): FilaGananciaProducto[] {
  const mapa = new Map<string, FilaGananciaProducto>();
  for (const r of renglones) {
    const fila = mapa.get(r.producto_id) ?? {
      producto_id: r.producto_id,
      sku: r.producto_sku ?? '—',
      nombre: r.producto_nombre ?? '(producto sin nombre)',
      categoria: categoriaDe(r.producto_id),
      cantidad: 0, venta: 0, costo: 0, ganancia: 0, margenPct: null,
    };
    fila.cantidad += r.cantidad;
    fila.venta += r.subtotal;
    fila.costo += r.cantidad * r.costo_unit;
    // La ganancia GUARDADA, no una cuenta nueva: es la del día de la venta.
    fila.ganancia += r.ganancia;
    mapa.set(r.producto_id, fila);
  }
  return [...mapa.values()]
    .map((f) => {
      const venta = round2(f.venta);
      const ganancia = round2(f.ganancia);
      return {
        ...f,
        cantidad: round2(f.cantidad),
        venta, costo: round2(f.costo), ganancia,
        margenPct: margenPct(ganancia, venta),
      };
    })
    .sort((a, b) => b.ganancia - a.ganancia);
}

/** Junta las filas de producto por categoría, con el mismo criterio de margen. */
export function agruparGananciaPorCategoria(filas: FilaGananciaProducto[]): FilaGananciaCategoria[] {
  const mapa = new Map<string, FilaGananciaCategoria>();
  for (const f of filas) {
    const acc = mapa.get(f.categoria) ?? {
      categoria: f.categoria, productos: 0, venta: 0, costo: 0, ganancia: 0, margenPct: null,
    };
    acc.productos += 1;
    acc.venta += f.venta;
    acc.costo += f.costo;
    acc.ganancia += f.ganancia;
    mapa.set(f.categoria, acc);
  }
  return [...mapa.values()]
    .map((c) => {
      const venta = round2(c.venta);
      const ganancia = round2(c.ganancia);
      return { ...c, venta, costo: round2(c.costo), ganancia, margenPct: margenPct(ganancia, venta) };
    })
    .sort((a, b) => b.ganancia - a.ganancia);
}

/**
 * Qué producto y qué categoría dejan dinero, sobre las ventas ENTREGADAS del
 * período. Solo entregadas: es material que ya salió del almacén y ganancia que
 * ya se realizó. Una confirmada sin entregar todavía puede anularse.
 */
export async function descargarGananciaPorProductoPdf(rango: RangoReporte = {}): Promise<void> {
  const ventas = await listVentas({
    estado: 'entregada', desde: rango.desde ?? null, hasta: rango.hasta ?? null,
  });
  const [renglones, productos] = await Promise.all([
    listRenglonesDeVentas(ventas.map((v) => v.id)),
    listProductos().catch(() => []),
  ]);

  const catPorProducto = new Map(productos.map((p) => [p.id, (p.categoria ?? '').trim()]));
  const filas = agruparGananciaPorProducto(
    renglones,
    (id) => catPorProducto.get(id)?.trim() || '(sin categoría)',
  );
  const categorias = agruparGananciaPorCategoria(filas);
  const monedas = monedasDe(ventas);

  const { doc, autoTable, y } = await nuevoDoc(
    'Ganancia por producto y categoría',
    `Ventas entregadas   ·   Período: ${textoRango(rango)}   ·   ${ventas.length} venta(s)   ·   ${filas.length} producto(s)`,
    'landscape',
  );

  if (!filas.length) {
    sinDatos(doc, y, 'No hay ventas entregadas con renglones en el período elegido.');
    pieDePagina(doc);
    previewPdf(doc, `ganancia-por-producto-${hoy()}.pdf`);
    return;
  }

  const totalVenta = round2(filas.reduce((a, f) => a + f.venta, 0));
  const totalCosto = round2(filas.reduce((a, f) => a + f.costo, 0));
  const totalGanancia = round2(filas.reduce((a, f) => a + f.ganancia, 0));

  // ─── Resumen por categoría ───
  autoTable(doc, {
    startY: y,
    head: [['Categoría', 'Productos', 'Venta s/IVA', 'Costo', 'Ganancia', 'Margen']],
    body: categorias.map((c) => [
      pdfSafe(c.categoria),
      num(c.productos),
      money(c.venta),
      money(c.costo),
      money(c.ganancia),
      pct(c.margenPct),
    ]),
    foot: [[
      'TOTAL', num(filas.length), money(totalVenta), money(totalCosto),
      money(totalGanancia), pct(margenPct(totalGanancia, totalVenta)),
    ]],
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 8.5 },
    footStyles: { fillColor: PIZARRA, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 68, halign: 'right' },
      2: { cellWidth: 96, halign: 'right' },
      3: { cellWidth: 96, halign: 'right' },
      4: { cellWidth: 96, halign: 'right' },
      5: { cellWidth: 66, halign: 'right' },
    },
    margin: MARGIN,
  });

  // ─── Detalle por producto, de más a menos ganancia ───
  autoTable(doc, {
    startY: finalY(doc) + 16,
    head: [['#', 'SKU', 'Producto', 'Categoría', 'Cantidad', 'Venta s/IVA', 'Costo', 'Ganancia', 'Margen']],
    body: filas.map((f, i) => [
      String(i + 1),
      f.sku,
      pdfSafe(f.nombre),
      pdfSafe(f.categoria),
      num(f.cantidad),
      money(f.venta),
      money(f.costo),
      money(f.ganancia),
      pct(f.margenPct),
    ]),
    theme: 'striped',
    headStyles: { fillColor: PIZARRA, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8, cellPadding: 3.5 },
    columnStyles: {
      0: { cellWidth: 24, halign: 'right' },
      1: { cellWidth: 66 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 100 },
      4: { cellWidth: 62, halign: 'right' },
      5: { cellWidth: 80, halign: 'right' },
      6: { cellWidth: 78, halign: 'right' },
      7: { cellWidth: 80, halign: 'right' },
      8: { cellWidth: 54, halign: 'right' },
    },
    margin: MARGIN,
  });

  notas(doc, finalY(doc) + 16, [
    'Ordenado por ganancia, de mayor a menor. Solo ventas ENTREGADAS: el material ya salió y la ganancia ya se realizó.',
    'La ganancia de cada renglón es la que se congeló al confirmar la venta, contra el costo promedio de ese día. No se recalcula con el costo de hoy: si se hiciera, el margen de una venta vieja cambiaría con cada compra nueva.',
    'La columna «Venta s/IVA» es el subtotal del renglón (cantidad × precio − descuento del renglón). Sobre ella se calcula el margen.',
    'El descuento del DOCUMENTO no se reparte entre los renglones: la ganancia por producto no lo descuenta. El número exacto por documento está en «Ventas del período».',
    'Un producto sin costo cargado sale con margen del 100 %: es un aviso de ficha incompleta, no una ganancia real.',
    ...(monedas.length > 1
      ? [`Hay ventas en varias monedas (${monedas.join(', ')}) y los importes están sumados SIN convertir. Filtra por moneda para leer estos totales.`]
      : []),
  ]);

  pieDePagina(doc);
  previewPdf(doc, `ganancia-por-producto-${hoy()}.pdf`);
}

/* ═══════════════════════════════════════════════════════════════
   3 · GANANCIA POR CLIENTE
   ═══════════════════════════════════════════════════════════════ */

/**
 * Mismo criterio que por producto, agrupando por cliente. Se agrupa por
 * `cliente_id`; los documentos viejos sin ficha caen bajo su nombre congelado,
 * para que no se junten todos en un «(sin cliente)» que no dice nada.
 */
export function agruparGananciaPorCliente(
  ventas: Venta[], renglones: VentaRenglon[],
): FilaGananciaCliente[] {
  const ventaPorId = new Map(ventas.map((v) => [v.id, v]));
  const mapa = new Map<string, FilaGananciaCliente & { docs: Set<string> }>();

  for (const r of renglones) {
    const v = ventaPorId.get(r.venta_id);
    if (!v) continue;
    const nombre = (v.cliente_nombre ?? '').trim();
    const key = v.cliente_id ?? (nombre ? `nombre:${nombre.toLowerCase()}` : 'sin-cliente');
    const acc = mapa.get(key) ?? {
      clienteKey: key,
      cliente: nombre || '(sin cliente)',
      documentos: 0, venta: 0, costo: 0, ganancia: 0, margenPct: null,
      docs: new Set<string>(),
    };
    acc.docs.add(v.id);
    acc.venta += r.subtotal;
    acc.costo += r.cantidad * r.costo_unit;
    acc.ganancia += r.ganancia;
    mapa.set(key, acc);
  }

  return [...mapa.values()]
    .map(({ docs, ...f }) => {
      const venta = round2(f.venta);
      const ganancia = round2(f.ganancia);
      return {
        ...f,
        documentos: docs.size,
        venta, costo: round2(f.costo), ganancia,
        margenPct: margenPct(ganancia, venta),
      };
    })
    .sort((a, b) => b.ganancia - a.ganancia);
}

/** Qué cliente deja dinero, sobre las ventas ENTREGADAS del período. */
export async function descargarGananciaPorClientePdf(rango: RangoReporte = {}): Promise<void> {
  const ventas = await listVentas({
    estado: 'entregada', desde: rango.desde ?? null, hasta: rango.hasta ?? null,
  });
  const renglones = await listRenglonesDeVentas(ventas.map((v) => v.id));
  const filas = agruparGananciaPorCliente(ventas, renglones);
  const monedas = monedasDe(ventas);

  const { doc, autoTable, y } = await nuevoDoc(
    'Ganancia por cliente',
    `Ventas entregadas   ·   Período: ${textoRango(rango)}   ·   ${ventas.length} venta(s)   ·   ${filas.length} cliente(s)`,
  );

  if (!filas.length) {
    sinDatos(doc, y, 'No hay ventas entregadas con renglones en el período elegido.');
    pieDePagina(doc);
    previewPdf(doc, `ganancia-por-cliente-${hoy()}.pdf`);
    return;
  }

  const totalVenta = round2(filas.reduce((a, f) => a + f.venta, 0));
  const totalCosto = round2(filas.reduce((a, f) => a + f.costo, 0));
  const totalGanancia = round2(filas.reduce((a, f) => a + f.ganancia, 0));

  autoTable(doc, {
    startY: y,
    head: [['#', 'Cliente', 'Ventas', 'Venta s/IVA', 'Costo', 'Ganancia', 'Margen']],
    body: filas.map((f, i) => [
      String(i + 1),
      pdfSafe(f.cliente),
      num(f.documentos),
      money(f.venta),
      money(f.costo),
      money(f.ganancia),
      pct(f.margenPct),
    ]),
    foot: [[
      '', 'TOTAL', num(ventas.length), money(totalVenta), money(totalCosto),
      money(totalGanancia), pct(margenPct(totalGanancia, totalVenta)),
    ]],
    theme: 'striped',
    headStyles: { fillColor: PIZARRA, textColor: 255, fontSize: 8.5 },
    footStyles: { fillColor: NARANJA, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8.5, cellPadding: 4 },
    columnStyles: {
      0: { cellWidth: 24, halign: 'right' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 46, halign: 'right' },
      3: { cellWidth: 78, halign: 'right' },
      4: { cellWidth: 72, halign: 'right' },
      5: { cellWidth: 78, halign: 'right' },
      6: { cellWidth: 52, halign: 'right' },
    },
    margin: MARGIN,
  });

  notas(doc, finalY(doc) + 16, [
    'Ordenado por ganancia, de mayor a menor. Solo ventas ENTREGADAS.',
    'La ganancia es la congelada al confirmar cada venta. El margen se calcula sobre la venta SIN IVA.',
    'La columna «Ventas» cuenta documentos entregados del cliente en el período, no renglones.',
    'El total de «Ventas» es el de documentos del período: una venta sin ficha de cliente se agrupa por su nombre congelado.',
    'El descuento del documento no se reparte entre los renglones y por eso no baja esta ganancia.',
    ...(monedas.length > 1
      ? [`Hay ventas en varias monedas (${monedas.join(', ')}) y los importes están sumados SIN convertir.`]
      : []),
  ]);

  pieDePagina(doc);
  previewPdf(doc, `ganancia-por-cliente-${hoy()}.pdf`);
}

/* ═══════════════════════════════════════════════════════════════
   4 · CUENTAS POR COBRAR
   ═══════════════════════════════════════════════════════════════ */

const DIA_MS = 86_400_000;

/** Tramos de antigüedad clásicos de cobranzas. */
function tramo(dias: number): string {
  if (dias <= 30) return '0 – 30 días';
  if (dias <= 60) return '31 – 60 días';
  if (dias <= 90) return '61 – 90 días';
  return 'Más de 90 días';
}

const TRAMOS = ['0 – 30 días', '31 – 60 días', '61 – 90 días', 'Más de 90 días'];

/**
 * Convierte las cuentas de Tesorería en filas del reporte, de la más VIEJA a la
 * más nueva: en cobranza lo que importa es lo que lleva más tiempo sin cobrarse.
 */
export function filasCuentasPorCobrar(
  cuentas: CuentaPorCobrar[], ahora = Date.now(),
): FilaCuentaPorCobrar[] {
  return cuentas
    .map((c) => {
      const monto = round2(c.monto);
      const cobrado = round2(Number(c.abonado) || 0);
      const abierta = new Date(c.created_at).getTime();
      return {
        id: c.id,
        tipo: c.tipo === 'proveedor' ? 'Proveedor' : 'Cliente',
        contraparte: (c.contraparte ?? '').trim() || '(sin nombre)',
        moneda: c.moneda || 'USD',
        monto,
        cobrado,
        saldo: round2(monto - cobrado),
        antiguedadDias: Number.isFinite(abierta)
          ? Math.max(0, Math.floor((ahora - abierta) / DIA_MS))
          : 0,
        desde: c.created_at,
      };
    })
    .sort((a, b) => b.antiguedadDias - a.antiguedadDias);
}

/**
 * Lo que le deben a la empresa: cliente, monto, cobrado, saldo y antigüedad.
 *
 * OJO con la antigüedad: la cuenta por cobrar es **corriente** y acumula varias
 * ventas del mismo cliente, así que los días se cuentan desde que se ABRIÓ la
 * cuenta —la deuda más vieja que sigue viva—, no desde el último cargo. Es el
 * criterio conservador: muestra el problema más antiguo, no el más reciente.
 *
 * Los totales van por moneda: una cuenta en Bs y una en USD no se suman.
 */
export async function descargarCuentasPorCobrarPdf(
  opciones: { soloAbiertas?: boolean } = {},
): Promise<void> {
  const soloAbiertas = opciones.soloAbiertas ?? true;
  const cuentas = await listCuentasPorCobrar(soloAbiertas);
  const filas = filasCuentasPorCobrar(cuentas);

  const { doc, autoTable, y } = await nuevoDoc(
    'Cuentas por cobrar',
    `${soloAbiertas ? 'Solo cuentas abiertas' : 'Abiertas y saldadas'}   ·   ${filas.length} cuenta(s)   ·   al ${date(new Date().toISOString())}`,
  );

  if (!filas.length) {
    sinDatos(doc, y, soloAbiertas
      ? 'No hay cuentas por cobrar abiertas: no queda nada por cobrar.'
      : 'No hay cuentas por cobrar registradas.');
    pieDePagina(doc);
    previewPdf(doc, `cuentas-por-cobrar-${hoy()}.pdf`);
    return;
  }

  autoTable(doc, {
    startY: y,
    head: [['#', 'Cliente', 'Tipo', 'Desde', 'Monto', 'Cobrado', 'Saldo', 'Antigüedad']],
    body: filas.map((f, i) => [
      String(i + 1),
      pdfSafe(f.contraparte),
      f.tipo,
      date(f.desde),
      montoMoneda(f.monto, f.moneda),
      montoMoneda(f.cobrado, f.moneda),
      montoMoneda(f.saldo, f.moneda),
      `${num(f.antiguedadDias)} d`,
    ]),
    theme: 'striped',
    headStyles: { fillColor: PIZARRA, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8.5, cellPadding: 4 },
    columnStyles: {
      0: { cellWidth: 24, halign: 'right' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 54 },
      3: { cellWidth: 66 },
      4: { cellWidth: 74, halign: 'right' },
      5: { cellWidth: 74, halign: 'right' },
      6: { cellWidth: 74, halign: 'right' },
      7: { cellWidth: 58, halign: 'right' },
    },
    margin: MARGIN,
  });

  // ─── Totales por moneda ───
  const porMoneda = new Map<string, { cuentas: number; monto: number; cobrado: number; saldo: number }>();
  for (const f of filas) {
    const acc = porMoneda.get(f.moneda) ?? { cuentas: 0, monto: 0, cobrado: 0, saldo: 0 };
    acc.cuentas += 1;
    acc.monto += f.monto;
    acc.cobrado += f.cobrado;
    acc.saldo += f.saldo;
    porMoneda.set(f.moneda, acc);
  }

  autoTable(doc, {
    startY: finalY(doc) + 14,
    head: [['Totales por moneda', 'Cuentas', 'Monto', 'Cobrado', 'Saldo']],
    body: [...porMoneda.entries()].map(([m, a]) => [
      m, num(a.cuentas),
      montoMoneda(round2(a.monto), m),
      montoMoneda(round2(a.cobrado), m),
      montoMoneda(round2(a.saldo), m),
    ]),
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 9, cellPadding: 4, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 60, halign: 'right' },
      2: { cellWidth: 90, halign: 'right' },
      3: { cellWidth: 90, halign: 'right' },
      4: { cellWidth: 90, halign: 'right' },
    },
    margin: MARGIN,
  });

  // ─── Antigüedad del saldo, por tramo y moneda ───
  // La clave junta tramo y moneda, pero las partes se guardan aparte en el valor:
  // los nombres de los tramos llevan espacios y guiones («0 – 30 días»), así que
  // recomponerlos partiendo la clave sería frágil. Aquí no hay nada que parsear.
  const porTramo = new Map<string, { t: string; m: string; cuentas: number; saldo: number }>();
  for (const f of filas) {
    const t = tramo(f.antiguedadDias);
    const clave = `${TRAMOS.indexOf(t)}|${f.moneda}`;
    const acc = porTramo.get(clave) ?? { t, m: f.moneda, cuentas: 0, saldo: 0 };
    acc.cuentas += 1;
    acc.saldo += f.saldo;
    porTramo.set(clave, acc);
  }
  const filasTramo = [...porTramo.values()]
    .sort((a, b) => TRAMOS.indexOf(a.t) - TRAMOS.indexOf(b.t) || a.m.localeCompare(b.m));

  autoTable(doc, {
    startY: finalY(doc) + 14,
    head: [['Antigüedad del saldo', 'Moneda', 'Cuentas', 'Saldo']],
    body: filasTramo.map((f) => [f.t, f.m, num(f.cuentas), montoMoneda(round2(f.saldo), f.m)]),
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 60 },
      2: { cellWidth: 60, halign: 'right' },
      3: { cellWidth: 90, halign: 'right' },
    },
    margin: MARGIN,
  });

  notas(doc, finalY(doc) + 16, [
    'Ordenado de la deuda más vieja a la más nueva: en cobranza lo que apura es lo que lleva más tiempo sin cobrarse.',
    'La cuenta de un cliente es CORRIENTE: acumula varias ventas a crédito. La antigüedad se cuenta desde que se abrió la cuenta, no desde el último cargo, así que muestra la deuda más vieja que sigue viva.',
    'El detalle venta por venta de cada cuenta está en Tesorería, en los cargos de la cuenta.',
    'Las monedas no se suman entre sí: cada total va en la suya.',
  ]);

  pieDePagina(doc);
  previewPdf(doc, `cuentas-por-cobrar-${hoy()}.pdf`);
}
