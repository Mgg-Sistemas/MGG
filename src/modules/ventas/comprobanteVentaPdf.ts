/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Comprobante de venta (PDF)

   POR QUÉ EXISTE
   Es el papel que se le entrega al cliente cuando se le vende algo: qué se
   llevó, cuánto pagó y, si quedó debiendo, cuánto. No es una factura fiscal
   (eso está fuera de alcance): es el comprobante del documento `VT-AAAA-####`.

   LA REGLA FIRME DE ESTE ARCHIVO
   Aquí NO se imprime lo que la empresa pagó por la mercancía ni el margen que
   le dejó. Son números internos de la casa y este papel sale por la puerta:
   el cliente no tiene por qué verlos. Por eso el comprobante lee solo las
   columnas de precio del documento —subtotal, descuento, IVA y total— y ni
   siquiera toca los campos internos del renglón.

   DE DÓNDE SALEN LOS NÚMEROS
   De la cabecera ya cargada (`VentaCompleta`), que la base calculó y congeló
   al confirmar con la función única de totales. Aquí no se rehace ninguna
   cuenta: el bug de «el IVA no se suma» ya volvió varias veces por tener la
   cuenta escrita en varios lados. Tampoco se va a buscar nada a la base.

   Sigue el molde de la casa: jsPDF + autotable con import perezoso (la
   librería no se carga hasta que alguien pide el PDF), logo opcional,
   `pdfSafe` para el texto y `previewPdf` al final —vista previa, se descarga
   solo si el usuario presiona Descargar.
   ============================================================ */
import { EMPRESA_NOMBRE } from '@/shared/lib/empresa';
import { quienSync } from '@/shared/lib/directorioUsuarios';
import type { jsPDF as JsPdf } from 'jspdf';
import { dateTime, montoMoneda, num } from '@/shared/lib/format';
import { loadLogoPdfDataUrl, anchoLogoPdf, dibujarLogoPdf } from '@/shared/lib/pdfLogo';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { previewPdf } from '@/shared/lib/reportePreview';
import {
  sumaPagoLegs,
  type PagoLeg, type Venta, type VentaCompleta,
} from './ventas.repository';

/** El `autoTable` de `jspdf-autotable`, que los dos comprobantes importan perezoso. */
export type AutoTable = typeof import('jspdf-autotable').default;

/** Los dos comprobantes reciben lo mismo, y los dos lo reciben ya cargado. */
export interface OpcionesComprobante {
  /**
   * Nombre de cada caja, indexado por id. Las patas de pago guardan `cajaId`
   * (un uuid) y no el nombre; el comprobante no va a la base a buscarlo, así
   * que la pantalla —que ya tiene las cajas en memoria— se lo pasa por aquí.
   * Sin este mapa la pata sale igual, solo que sin el nombre de la caja.
   */
  cajas?: Record<string, string>;
}

/* ─────────────────── Piezas compartidas con la permuta ───────────────────
   Las exporta este archivo y las usa `comprobantePermutaPdf.ts`: los dos
   documentos llevan el mismo encabezado, la misma ficha de cliente y el
   mismo bloque de cobro, y no pueden divergir con el tiempo. */

export const MARGIN = 56.69; // 2 cm por lado
const GRIS = 120;

/** `finalY` de la última tabla, que autotable cuelga del doc sin tiparlo. */
export function finalY(doc: JsPdf, siNoHubo: number): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? siNoHubo;
}

/** Salta de página si lo que viene no entra en lo que queda del papel. */
export function hayEspacio(doc: JsPdf, y: number, alto: number): number {
  if (y + alto <= doc.internal.pageSize.getHeight() - MARGIN) return y;
  doc.addPage();
  return MARGIN;
}

/** Monto en la moneda del documento: 'Bs' sale «Bs …», el resto «$ …». */
export function montoDe(venta: Venta): (n: number | null | undefined) => string {
  return (n) => montoMoneda(Number(n ?? 0), venta.moneda);
}

/** Cantidad con su medida pegada: «40» no dice si son litros o tambores. */
export function cantidadConMedida(cantidad: number, unidad: string | null): string {
  return `${num(cantidad)} ${pdfSafe(unidad?.trim() ?? '') || 'UND'}`;
}

/** Logo + título + código. Devuelve la `y` donde sigue el documento. */
export function encabezado(doc: JsPdf, logo: string | null, titulo: string, codigo: string): number {
  const PAGE_W = doc.internal.pageSize.getWidth();
  const y = MARGIN;
  const LOGO = 52;
  const tx = logo ? MARGIN + anchoLogoPdf(LOGO) + 12 : MARGIN;
  if (logo) {
    dibujarLogoPdf(doc, logo, MARGIN, y, LOGO);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(titulo, tx, y + 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(GRIS);
  doc.text(`${EMPRESA_NOMBRE} · Generado ${dateTime(new Date().toISOString())}`, tx, y + 32);
  doc.setTextColor(0);

  // El código va a la derecha y grande: es con lo que el cliente reclama.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(pdfSafe(codigo) || '—', PAGE_W - MARGIN, y + 17, { align: 'right' });

  const fin = y + Math.max(LOGO, 40) + 8;
  doc.setDrawColor(200);
  doc.line(MARGIN, fin, PAGE_W - MARGIN, fin);
  return fin + 14;
}

const ESTADOS: Record<Venta['estado'], string> = {
  borrador: 'Borrador (todavía no confirmada)',
  por_autorizar: 'Por autorizar (todavía no confirmada)',
  autorizada: 'Autorizada (todavía no confirmada)',
  confirmada: 'Confirmada (pendiente de entrega)',
  entregada: 'Entregada',
  anulada: 'ANULADA',
};

/** Ficha del cliente y del documento. Devuelve la `y` donde sigue. */
export function fichaCliente(doc: JsPdf, autoTable: AutoTable, y: number, venta: Venta): number {
  const filas: Array<[string, string]> = [
    ['Cliente', pdfSafe(venta.cliente_nombre) || '—'],
    ['RIF / C.I.', pdfSafe(venta.cliente_rif) || '—'],
    ['Fecha', dateTime(venta.created_at)],
    ['Documento', venta.documento === 'factura' ? 'Factura' : 'Nota de entrega'],
    ...(venta.documento === 'factura' && venta.numero_factura
      ? ([['Nº de factura', pdfSafe(venta.numero_factura)]] as Array<[string, string]>)
      : []),
    ...(venta.documento === 'factura' && venta.numero_control
      ? ([['Nº de control', pdfSafe(venta.numero_control)]] as Array<[string, string]>)
      : []),
    ['Condición', venta.condicion === 'credito' ? 'Crédito' : 'Contado'],
    ['Estado', ESTADOS[venta.estado] ?? venta.estado],
    ...(venta.tasa_bs
      ? ([['Tasa del día', `Bs ${num(venta.tasa_bs)} / ${pdfSafe(venta.moneda)}`]] as Array<[string, string]>)
      : []),
    ['Atendió', pdfSafe(quienSync(venta.actor_name, venta.actor)) || '—'],
    ...(venta.autorizada_por
      ? ([['Autorizó', `${pdfSafe(venta.autorizada_por)}${venta.autorizada_at ? ` · ${dateTime(venta.autorizada_at)}` : ''}`]] as Array<[string, string]>)
      : []),
    ...(venta.nota ? ([['Nota', pdfSafe(venta.nota)]] as Array<[string, string]>) : []),
    ...(venta.estado === 'anulada' && venta.motivo_anulacion
      ? ([['Motivo de la anulación', pdfSafe(venta.motivo_anulacion)]] as Array<[string, string]>)
      : []),
  ];
  autoTable(doc, {
    startY: y,
    body: filas,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 130 }, 1: { cellWidth: 'auto' } },
    margin: MARGIN,
  });
  return finalY(doc, y) + 14;
}

/** Título del documento según sea nota de entrega o factura. */
export function tituloDocumento(venta: Venta, sufijo = ''): string {
  return (venta.documento === 'factura' ? 'Factura' : 'Nota de entrega') + sufijo;
}

/**
 * Las filas de impuestos, solo las que aplican: una nota de entrega no lleva
 * ninguna, y una factura muestra el IVA y/o el IGTF según sus casillas.
 */
export function filasImpuestos(venta: Venta, mon: (n: number) => string): Array<[string, string]> {
  const filas: Array<[string, string]> = [];
  if (venta.iva_pct > 0) filas.push([`IVA ${num(venta.iva_pct)} %`, mon(venta.iva_monto)]);
  if (venta.igtf_pct > 0) filas.push([`IGTF ${num(venta.igtf_pct)} %`, mon(venta.igtf_monto)]);
  return filas;
}

/** Tabla de totales pegada al margen derecho. La última fila va resaltada. */
export function bloqueTotales(
  doc: JsPdf, autoTable: AutoTable, y: number, filas: Array<[string, string]>,
): number {
  const PAGE_W = doc.internal.pageSize.getWidth();
  const ANCHO = 260;
  const ultima = filas.length - 1;
  autoTable(doc, {
    startY: y,
    body: filas.map(([k, v], i) => {
      const st = i === ultima ? { fontStyle: 'bold' as const, fontSize: 12 } : {};
      return [{ content: k, styles: st }, { content: v, styles: st }];
    }),
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { halign: 'right', cellWidth: 150 },
      1: { halign: 'right', cellWidth: 110 },
    },
    margin: { left: PAGE_W - MARGIN - ANCHO, right: MARGIN },
  });
  return finalY(doc, y) + 14;
}

const nombreCuenta = (c: string): string =>
  c === 'juridica' ? 'Jurídica' : c === 'personal' ? 'Personal' : 'General';

/**
 * Cómo se pagó: las patas de contado (caja, cuenta, moneda, monto) o cuánto
 * quedó debiendo a crédito. `aCobrar` es SIEMPRE la diferencia del documento y
 * no el total: en una permuta parte del pago ya se hizo con material.
 */
export function bloqueDePago(
  doc: JsPdf, autoTable: AutoTable, y0: number,
  venta: Venta, aCobrar: number, opciones: OpcionesComprobante,
): number {
  const mon = montoDe(venta);
  let y = hayEspacio(doc, y0, 100);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(venta.condicion === 'credito' ? 'Queda debiendo' : 'Cómo se pagó', MARGIN, y);
  doc.setFont('helvetica', 'normal');

  if (venta.condicion === 'credito') {
    doc.setFontSize(10);
    doc.text(
      `${mon(aCobrar)} cargados a la cuenta corriente del cliente. Se abona en Tesorería, contra esa cuenta.`,
      MARGIN, y + 16,
    );
    return y + 32;
  }

  const legs: PagoLeg[] = venta.pago_legs ?? [];
  if (!legs.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(GRIS);
    doc.text('Todavía no hay cobro registrado: la venta no se ha confirmado.', MARGIN, y + 16);
    doc.setTextColor(0);
    return y + 32;
  }

  autoTable(doc, {
    startY: y + 6,
    head: [['Caja', 'Cuenta', 'Moneda', 'Monto']],
    body: legs.map((l) => [
      pdfSafe(opciones.cajas?.[l.cajaId ?? ''] ?? '') || (l.cajaId ? `Caja ${l.cajaId.slice(0, 8)}` : '—'),
      nombreCuenta(String(l.cuenta)),
      pdfSafe(l.moneda) || '—',
      montoMoneda(l.monto, l.moneda),
    ]),
    foot: [[{ content: 'Cobrado', colSpan: 3, styles: { halign: 'right' } }, mon(sumaPagoLegs(legs))]],
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 9 },
    footStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 'auto' }, 1: { cellWidth: 80 },
      2: { cellWidth: 60 }, 3: { cellWidth: 110, halign: 'right' },
    },
    margin: MARGIN,
  });
  y = finalY(doc, y) + 14;

  // Cada pata se carga en SU moneda y el documento tiene la suya. Si no cierran
  // es porque hubo pago en otra moneda: se avisa en vez de callarlo.
  if (Math.abs(sumaPagoLegs(legs) - aCobrar) >= 0.01) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(GRIS);
    doc.text(
      `A cobrar por este documento: ${mon(aCobrar)}. Cada pata se muestra en su propia moneda.`,
      MARGIN, y,
    );
    doc.setTextColor(0);
    y += 14;
  }
  return y;
}

/** El sello de anulada, para que nadie cobre dos veces con el mismo papel. */
export function selloAnulada(doc: JsPdf, y0: number, venta: Venta): number {
  if (venta.estado !== 'anulada') return y0;
  const y = hayEspacio(doc, y0, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(190, 40, 40);
  doc.text('DOCUMENTO ANULADO — no tiene validez.', MARGIN, y + 6);
  doc.setTextColor(0);
  return y + 20;
}

/** Las dos firmas del pie: quien entrega y quien recibe. */
export function firmas(doc: JsPdf, y0: number): void {
  const PAGE_W = doc.internal.pageSize.getWidth();
  const y = hayEspacio(doc, y0 + 24, 60);
  const ancho = (PAGE_W - MARGIN * 2 - 40) / 2;
  doc.setDrawColor(160);
  doc.line(MARGIN, y + 22, MARGIN + ancho, y + 22);
  doc.line(PAGE_W - MARGIN - ancho, y + 22, PAGE_W - MARGIN, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(GRIS);
  doc.text(`Entregó (${EMPRESA_NOMBRE})`, MARGIN, y + 34);
  doc.text('Recibí conforme (cliente)', PAGE_W - MARGIN - ancho, y + 34);
  doc.setTextColor(0);
}

/* ─────────────────────── El comprobante ─────────────────────── */

export async function descargarComprobanteVentaPdf(
  datos: VentaCompleta, opciones: OpcionesComprobante = {},
): Promise<void> {
  const [logo, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoPdfDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const { venta, renglones } = datos;
  const mon = montoDe(venta);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  let y = encabezado(doc, logo, tituloDocumento(venta), venta.codigo);
  y = fichaCliente(doc, autoTable, y, venta);

  // ─── Lo que se llevó el cliente ───────────────────────
  // Con CANTIDAD y MEDIDA en columnas propias: «40» a secas no dice si son 40
  // litros o 40 tambores, y quien recibe el material tiene que poder contarlo.
  autoTable(doc, {
    startY: y,
    head: [['#', 'SKU', 'Producto', 'Cant.', 'Medida', 'Precio unit.', 'Desc.', 'Subtotal']],
    body: renglones.map((r, i) => [
      String(i + 1),
      pdfSafe(r.producto_sku) || '—',
      pdfSafe(r.producto_nombre) || '—',
      num(r.cantidad),
      pdfSafe(r.unidad?.trim() ?? '') || 'UND',
      mon(r.precio_unit),
      r.descuento > 0 ? `- ${mon(r.descuento)}` : '—',
      mon(r.subtotal),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 20, halign: 'right' },
      1: { cellWidth: 54 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 44, halign: 'right' },
      4: { cellWidth: 50 },
      5: { cellWidth: 66, halign: 'right' },
      6: { cellWidth: 52, halign: 'right' },
      7: { cellWidth: 70, halign: 'right' },
    },
    margin: MARGIN,
  });
  y = finalY(doc, y) + 14;

  // ─── Totales, con los impuestos discriminados ─────────
  const filas: Array<[string, string]> = [
    ['Subtotal', mon(venta.subtotal)],
    ...(venta.descuento > 0
      ? ([['Descuento', `- ${mon(venta.descuento)}`]] as Array<[string, string]>)
      : []),
    ...filasImpuestos(venta, mon),
    ['TOTAL', mon(venta.total)],
  ];
  y = hayEspacio(doc, y, 30 + filas.length * 20);
  y = bloqueTotales(doc, autoTable, y, filas);

  // El equivalente en bolívares es un dato para el cliente, no de la
  // contabilidad: se muestra solo si la venta llevó tasa del día.
  if (venta.tasa_bs) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(GRIS);
    doc.text(
      `Equivalente informativo: ${montoMoneda(venta.total * venta.tasa_bs, 'Bs')} a la tasa del día.`,
      doc.internal.pageSize.getWidth() - MARGIN, y, { align: 'right' },
    );
    doc.setTextColor(0);
    y += 16;
  }

  // ─── Cómo se pagó ─────────────────────────────────────
  // En una venta normal `diferencia` y `total` son el mismo número; se usa
  // `diferencia` igual, que es lo que la base cobra de verdad.
  y = bloqueDePago(doc, autoTable, y, venta, venta.diferencia, opciones);
  y = selloAnulada(doc, y, venta);

  firmas(doc, y);
  previewPdf(doc, `venta-${venta.codigo || 'sin-codigo'}.pdf`);
}
