/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Comprobante de permuta (PDF)

   POR QUÉ EXISTE
   Una permuta no es una venta con descuento: son DOS movimientos de material
   en direcciones opuestas. Sale mercancía de la empresa y entra mercancía del
   cliente, valorada a un precio pactado. El papel tiene que mostrar las dos
   patas enfrentadas —«Material entregado» y «Material recibido»— porque si
   solo se ve una columna nadie entiende por qué el cliente pagó menos.

   LO QUE SE COBRA ES LA DIFERENCIA, NO EL TOTAL
   Es el punto donde este documento se equivoca solo si uno se descuida: parte
   del pago YA se hizo con material. Por eso el bloque de cobro trabaja sobre
   `diferencia` (`total − valor_recibido`) y nunca sobre `total`. Y la
   diferencia puede salir negativa: ahí el saldo queda a favor del cliente.

   LA REGLA FIRME
   Igual que el comprobante de venta: aquí NO se imprime lo que la empresa pagó
   por la mercancía ni el margen que le dejó. Este papel sale por la puerta.

   Comparte el encabezado, la ficha del cliente, el bloque de cobro y las
   firmas con `comprobanteVentaPdf.ts`, para que los dos documentos no
   divergan con el tiempo. Los números llegan ya cargados en `VentaCompleta`:
   aquí no se consulta la base ni se rehace ninguna cuenta.
   ============================================================ */
import { EMPRESA_NOMBRE } from '@/shared/lib/empresa';
import { loadLogoPdfDataUrl } from '@/shared/lib/pdfLogo';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { previewPdf } from '@/shared/lib/reportePreview';
import {
  MARGIN, bloqueDePago, bloqueTotales, cantidadConMedida, encabezado, fichaCliente,
  filasImpuestos, finalY, firmas, hayEspacio, montoDe, selloAnulada, tituloDocumento,
  type OpcionesComprobante,
} from './comprobanteVentaPdf';
import type { VentaCompleta } from './ventas.repository';

/** Un renglón de cualquiera de los dos bloques, ya listo para dibujar. */
type FilaBloque = [string, string, string, string];

const GUTTER = 12;
const CABECERA_OSCURA = { fillColor: [30, 41, 59] as [number, number, number], textColor: 255, fontSize: 8 };

export async function descargarComprobantePermutaPdf(
  datos: VentaCompleta, opciones: OpcionesComprobante = {},
): Promise<void> {
  const [logo, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoPdfDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const { venta, renglones, recibidos } = datos;
  const mon = montoDe(venta);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const ANCHO = (PAGE_W - MARGIN * 2 - GUTTER) / 2;

  let y = encabezado(doc, logo, tituloDocumento(venta, ' · permuta'), venta.codigo);
  y = fichaCliente(doc, autoTable, y, venta);

  /* ─── Los dos bloques, enfrentados ─────────────────────
     Se dibujan con la misma `startY` y márgenes espejados: el de la izquierda
     ocupa la mitad izquierda del ancho útil, el de la derecha la otra mitad.
     Como pueden tener distinta cantidad de renglones, la sección que sigue
     arranca debajo del MÁS ALTO de los dos. */

  const filasEntregado: FilaBloque[] = renglones.map((r) => [
    pdfSafe(r.producto_nombre) || '—',
    // Cantidad y medida juntas: «40» no dice si son litros o tambores.
    cantidadConMedida(r.cantidad, r.unidad),
    mon(r.precio_unit),
    mon(r.subtotal),
  ]);
  const filasRecibido: FilaBloque[] = recibidos.map((r) => [
    pdfSafe(r.producto_nombre) || '—',
    cantidadConMedida(r.cantidad, r.unidad),
    mon(r.valor_unit),
    mon(r.subtotal),
  ]);

  y = hayEspacio(doc, y, 120);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Material entregado', MARGIN, y);
  doc.text('Material recibido', MARGIN + ANCHO + GUTTER, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`(sale de ${EMPRESA_NOMBRE})`, MARGIN, y + 11);
  doc.text('(lo entrega el cliente como pago)', MARGIN + ANCHO + GUTTER, y + 11);
  doc.setTextColor(0);

  const startBloques = y + 18;

  /** Dibuja uno de los dos bloques y devuelve dónde termina. */
  const bloque = (
    filas: FilaBloque[], vacio: string, pieRotulo: string, pieMonto: number, aLaDerecha: boolean,
  ): number => {
    const izq = aLaDerecha ? PAGE_W - MARGIN - ANCHO : MARGIN;
    autoTable(doc, {
      startY: startBloques,
      head: [['Producto', 'Cantidad', aLaDerecha ? 'Valor unit.' : 'Precio unit.', 'Valor']],
      body: filas.length ? filas : [[vacio, '—', '—', '—']],
      foot: [[{ content: pieRotulo, colSpan: 3, styles: { halign: 'right' } }, mon(pieMonto)]],
      theme: 'striped',
      headStyles: CABECERA_OSCURA,
      footStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak', valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 58, halign: 'right' },
        2: { cellWidth: 56, halign: 'right' },
        3: { cellWidth: 58, halign: 'right' },
      },
      margin: { left: izq, right: PAGE_W - izq - ANCHO },
    });
    return finalY(doc, startBloques);
  };

  const finIzq = bloque(
    filasEntregado, 'Sin renglones', 'Subtotal', venta.subtotal, false,
  );
  const finDer = bloque(
    filasRecibido, 'No entró material', 'Valor recibido', venta.valor_recibido, true,
  );
  y = Math.max(finIzq, finDer) + 16;

  /* ─── La balanza ───────────────────────────────────────
     El IVA se discrimina aquí y no en el bloque de la izquierda porque grava el
     documento entero, no cada renglón. `diferencia` es la última línea a
     propósito: es el único número que el cliente tiene que mirar. */
  const filas: Array<[string, string]> = [
    ['Subtotal entregado', mon(venta.subtotal)],
    ...(venta.descuento > 0
      ? ([['Descuento', `- ${mon(venta.descuento)}`]] as Array<[string, string]>)
      : []),
    ...filasImpuestos(venta, mon),
    ['Total entregado', mon(venta.total)],
    ['Material recibido', `- ${mon(venta.valor_recibido)}`],
    [venta.diferencia < 0 ? 'SALDO A FAVOR' : 'DIFERENCIA', mon(Math.abs(venta.diferencia))],
  ];
  y = hayEspacio(doc, y, 30 + filas.length * 20);
  y = bloqueTotales(doc, autoTable, y, filas);

  /* ─── Qué se hizo con la diferencia ────────────────────
     Los tres tratamientos posibles. El umbral de un centavo evita que un
     redondeo haga aparecer un cobro de $0,00. */
  y = hayEspacio(doc, y, 70);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  if (venta.diferencia > 0.005) {
    doc.text(
      `El material recibido cubrió ${mon(venta.valor_recibido)} del documento. Se cobra la DIFERENCIA, no el total.`,
      MARGIN, y,
    );
    y = bloqueDePago(doc, autoTable, y + 18, venta, venta.diferencia, opciones);
  } else if (venta.diferencia < -0.005) {
    doc.text(
      `El material recibido vale ${mon(-venta.diferencia)} más que lo entregado: ese saldo queda a favor del cliente.`,
      MARGIN, y,
    );
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      'No se cobró nada por esta permuta. El saldo se salda aparte, con Tesorería.',
      MARGIN, y + 15,
    );
    doc.setTextColor(0);
    y += 30;
  } else {
    doc.text(
      'Permuta pareja: el material recibido cubrió el documento completo. No hubo nada que cobrar.',
      MARGIN, y,
    );
    y += 18;
  }

  y = selloAnulada(doc, y, venta);
  firmas(doc, y);
  previewPdf(doc, `permuta-${venta.codigo || 'sin-codigo'}.pdf`);
}
