/* ============================================================
   MGG · Delivery · PDF (31/10/2026 · con reportes)

   · «Reporte de Delivery» (el Histórico de MGG, ahora con el resumen):
     rango + estado + motorizado → totales por estado, resumen por
     motorizado, tiempo promedio de entrega y la lista de pedidos.
   · «Pedidos por delivery» (MGG): cuántos lleva cada uno y su promedio.
   · «Reporte del pedido» (GT, 31/10): un pedido con sus pasos y horas,
     almacén, nota, fotos y productos.
   Formato de los PDF de GT: logo horizontal (dibujarLogoPdf), márgenes de
   2 cm, «impreso por» con nombre y apellido. Se abren en la vista previa del
   sistema (previewPdf): nada se descarga solo.
   02/11/2026: con el origen (OC pagada / retiro en Almacén Los Pinos): el
   general trae la columna «Origen» y el filtro; el del pedido rotula SP,
   «Retirar en», «Entregado a» y las fotos «al retirar en Almacén».
   ============================================================ */
import type { jsPDF as JsPDF } from 'jspdf';
import { previewPdf } from '@/shared/lib/reportePreview';
import { cargarImagenDesdeBlob } from '@/shared/lib/comprimirImagen';
import { dibujarLogoPdf, anchoLogoPdf } from '@/shared/lib/pdfLogo';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { textoPdf } from '@/shared/lib/textoPdf';
import { quienSync } from '@/shared/lib/directorioUsuarios';
import { supabase } from '@/shared/lib/supabase';
import {
  ALMACEN_RETIRO, ORIGEN_DELIVERY, etiquetaEstado, fechaHoraVE, montoTxt, rotuloFotos,
  type FotoDelivery, type PedidoDelivery,
} from './delivery';
import { urlFotoDelivery } from './delivery.repository';
import { duracionTxt, totalesResumen, type FilaHistorialDelivery, type ResumenDelivery } from './deliveryPanel';
import {
  detallePedido, resumenReporte, textoFiltros, type FiltroEstadoDelivery, type FiltroOrigenDelivery,
} from './deliveryReporte';

const M = MARGEN_PDF;
const ALTO_PIE = 14;
const MARGENES_TABLA = { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + ALTO_PIE };
const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS: [number, number, number] = [110, 110, 110];
const CAJA_LOGO = 44;

/** Quien imprime: el usuario con sesión, con nombre y apellido. */
async function impresoPor(): Promise<string> {
  try {
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email ?? '';
    return email ? quienSync(null, email) : '';
  } catch {
    return '';
  }
}

async function nuevoDoc(titulo: string, sub: string, apaisado: boolean) {
  const [{ jsPDF }, { default: autoTable }, { loadLogoPdfDataUrl }, imprime] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'), impresoPor(),
  ]);
  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: apaisado ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  let y = M;
  const TX = logo ? M + anchoLogoPdf(CAJA_LOGO) + 14 : M;
  if (logo) dibujarLogoPdf(doc, logo, M, y, CAJA_LOGO);
  doc.setTextColor(...NARANJA); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(textoPdf(titulo), TX, y + 14);
  doc.setTextColor(...GRIS); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const subLineas = doc.splitTextToSize(textoPdf(`MINERAL GROUP GUAYANA C.A. · ${sub}`), W - M - TX) as string[];
  doc.text(subLineas, TX, y + 28);
  const yImp = y + 28 + subLineas.length * 11;
  doc.text(textoPdf(`Impreso${imprime ? ` por ${imprime}` : ''} el ${fechaHoraVE(new Date().toISOString())}`), TX, yImp);
  doc.setTextColor(0, 0, 0);
  y = Math.max(y + CAJA_LOGO, yImp) + 8;
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.5); doc.line(M, y, W - M, y); y += 16;
  return { doc, autoTable, y, W };
}

/** Pie con el número de página en todas las hojas. */
function pies(doc: JsPDF, texto: string) {
  const n = doc.getNumberOfPages();
  const h = doc.internal.pageSize.getHeight();
  const w = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(textoPdf(texto), M, limiteInferiorPdf(h));
    doc.text(`Página ${i} de ${n}`, w - M, limiteInferiorPdf(h), { align: 'right' });
  }
  doc.setTextColor(0);
}

const HEAD = { fillColor: NARANJA, textColor: 255, fontSize: 8.5 } as const;
const FOOT = { fillColor: [245, 245, 245] as [number, number, number], textColor: 20, fontStyle: 'bold' as const, fontSize: 8.5 };
const finTabla = (doc: JsPDF, porDefecto: number) =>
  ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? porDefecto);

/* ───────────── Reporte general (Histórico) ───────────── */

/** El reporte del histórico filtrado: resumen, por delivery y la lista de pedidos. */
export async function pdfHistorialDelivery(data: {
  desde: string; hasta: string; repartidor?: string | null; estado?: FiltroEstadoDelivery | null;
  origen?: FiltroOrigenDelivery | null; filas: FilaHistorialDelivery[];
}): Promise<void> {
  const generado = fechaHoraVE(new Date().toISOString());
  const { doc, autoTable, y } = await nuevoDoc('Reporte de Delivery', `${textoFiltros(data)} · ${data.filas.length} pedido(s)`, true);
  const r = resumenReporte(data.filas);

  autoTable(doc, {
    startY: y,
    head: [['Pedidos', 'De Compras (OC)', `Retiros ${ALMACEN_RETIRO}`, 'Entregados', 'En camino', 'Aceptados', 'Cancelados', 'Tiempo promedio de entrega']],
    body: [[String(r.total), String(r.porOrigen.compra), String(r.porOrigen.almacen), String(r.porEstado.entregado), String(r.porEstado.en_ruta),
      String(r.porEstado.aceptado), String(r.porEstado.cancelado), duracionTxt(r.minutosPromedio)].map(textoPdf)],
    theme: 'grid', headStyles: HEAD, styles: { fontSize: 9, cellPadding: 4, halign: 'center' }, margin: MARGENES_TABLA,
  });

  if (r.porDelivery.length) {
    const t = totalesResumen(r.porDelivery);
    autoTable(doc, {
      startY: finTabla(doc, y) + 14,
      head: [['Delivery', 'Entregados', 'Cancelados', 'En curso', 'Total', 'Tiempo promedio']],
      body: r.porDelivery.map((x) => [x.repartidor, String(x.entregados), String(x.cancelados), String(x.enCurso),
        String(x.entregados + x.cancelados + x.enCurso), duracionTxt(x.minutosPromedio)].map(textoPdf)),
      foot: [['Total', String(t.entregados), String(t.cancelados), String(t.enCurso),
        String(t.entregados + t.cancelados + t.enCurso), duracionTxt(t.minutosPromedio)].map(textoPdf)],
      theme: 'grid', headStyles: HEAD, footStyles: FOOT, styles: { fontSize: 8.5, cellPadding: 3 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      margin: MARGENES_TABLA,
    });
  }

  autoTable(doc, {
    startY: finTabla(doc, y) + 14,
    head: [['Tomado', 'Origen', 'OC / SP', 'Proveedor', 'Delivery', 'Estado', 'En camino', 'Entregado / Cancelado', 'Tiempo', 'Almacén / Entregado a / Motivo', 'Fotos', 'Monto']],
    body: data.filas.length
      ? data.filas.map((f) => [
        fechaHoraVE(f.fecha), ORIGEN_DELIVERY[f.origen]?.corto ?? 'Compras', f.oc, f.proveedor, f.repartidor, etiquetaEstado(f.estado, f.origen, f.motivo_cancel),
        fechaHoraVE(f.en_ruta_en) || '—',
        fechaHoraVE(f.estado === 'cancelado' ? f.cancelado_en : f.entregado_en) || '—',
        duracionTxt(f.minutos),
        (f.estado === 'cancelado' ? f.motivo_cancel : [f.almacen_entrega, f.nota_entrega].filter(Boolean).join(' · ')) || '—',
        String(f.fotos ?? 0),
        f.origen === 'almacen' ? '—' : montoTxt(f.total, f.moneda),
      ].map((x) => textoPdf(String(x))))
      : [[{ content: 'No hay pedidos tomados con esos filtros.', colSpan: 12, styles: { halign: 'center' as const } }]],
    theme: 'grid',
    headStyles: HEAD,
    styles: { fontSize: 7.4, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: { 8: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' } },
    margin: MARGENES_TABLA,
  });
  pies(doc, `Reporte de Delivery · ${generado}`);
  previewPdf(doc, `delivery-reporte-${data.desde}_${data.hasta}.pdf`);
}

/* ───────────── Por delivery (MGG) ───────────── */

/** Cuántos pedidos lleva cada delivery en el rango. */
export async function pdfPorDelivery(data: { desde: string; hasta: string; resumen: ResumenDelivery[] }): Promise<void> {
  const generado = fechaHoraVE(new Date().toISOString());
  const { doc, autoTable, y } = await nuevoDoc('Pedidos por delivery', textoFiltros(data), false);
  const t = totalesResumen(data.resumen);
  autoTable(doc, {
    startY: y,
    head: [['Delivery', 'Entregados', 'Cancelados', 'En curso', 'Total', 'Tiempo promedio']],
    body: data.resumen.map((r) => [
      r.repartidor, String(r.entregados), String(r.cancelados), String(r.enCurso),
      String(r.entregados + r.cancelados + r.enCurso), duracionTxt(r.minutosPromedio),
    ].map((x) => textoPdf(x))),
    foot: [['Total', String(t.entregados), String(t.cancelados), String(t.enCurso),
      String(t.entregados + t.cancelados + t.enCurso), duracionTxt(t.minutosPromedio)].map(textoPdf)],
    theme: 'grid',
    headStyles: { ...HEAD, fontSize: 9 },
    footStyles: { ...FOOT, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: MARGENES_TABLA,
  });
  pies(doc, `Pedidos por delivery · ${generado}`);
  previewPdf(doc, `delivery-por-repartidor-${data.desde}_${data.hasta}.pdf`);
}

/* ───────────── Anexo fotográfico (GT) ───────────── */

const LADO_FOTO_DELIVERY_PDF = 1400;

interface FotoCargadaPdf {
  data: string;
  w: number;
  h: number;
  filename: string;
}

async function fotoDeliveryParaPdf(f: FotoDelivery, urlPrevia?: string): Promise<FotoCargadaPdf | null> {
  try {
    const url = urlPrevia || await urlFotoDelivery(f.path);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const img = await cargarImagenDesdeBlob(await res.blob());
    const escala = Math.min(1, LADO_FOTO_DELIVERY_PDF / Math.max(img.width, img.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * escala));
    canvas.height = Math.max(1, Math.round(img.height * escala));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if ('close' in img && typeof img.close === 'function') img.close();
      return null;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if ('close' in img && typeof img.close === 'function') img.close();
    return {
      data: canvas.toDataURL('image/jpeg', 0.85),
      w: canvas.width,
      h: canvas.height,
      filename: f.filename,
    };
  } catch {
    return null;
  }
}

async function dibujarSeccionesFotosPdf(
  doc: JsPDF,
  yInicial: number,
  p: PedidoDelivery,
  urls?: Record<string, string>,
): Promise<number> {
  const [recibo, entrega] = await Promise.all([
    Promise.all((p.fotos_recibo ?? []).map((f) => fotoDeliveryParaPdf(f, urls?.[f.path]))),
    Promise.all((p.fotos_entrega ?? []).map((f) => fotoDeliveryParaPdf(f, urls?.[f.path]))),
  ]);
  const grupos: Array<{ titulo: string; originales: number; fotos: FotoCargadaPdf[] }> = [
    { titulo: rotuloFotos(p.origen, 'recibo'), originales: p.fotos_recibo?.length ?? 0, fotos: recibo.filter((x): x is FotoCargadaPdf => x !== null) },
    { titulo: rotuloFotos(p.origen, 'entrega'), originales: p.fotos_entrega?.length ?? 0, fotos: entrega.filter((x): x is FotoCargadaPdf => x !== null) },
  ].filter((g) => g.originales > 0);

  if (!grupos.length) return yInicial;

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const limiteY = H - M - ALTO_PIE;
  const GAP = 12;
  const colW = (W - 2 * M - GAP) / 2;
  const ALTO_CAJA = 205;
  let y = yInicial;

  for (const g of grupos) {
    const altoMinimoGrupo = 20 + (g.fotos.length ? ALTO_CAJA : 16);
    if (y + altoMinimoGrupo > limiteY) {
      doc.addPage();
      y = M;
    }
    doc.setFillColor(...NARANJA);
    doc.rect(M, y - 8, 3, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(35, 35, 35);
    doc.text(textoPdf(`${g.titulo.toUpperCase()} (${g.originales})`), M + 8, y + 1);
    y += 10;

    if (!g.fotos.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...GRIS);
      doc.text(textoPdf('No se pudieron descargar las imágenes.'), M, y + 8);
      y += 20;
      continue;
    }

    g.fotos.forEach((f, i) => {
      const col = i % 2;
      if (col === 0 && i > 0) y += ALTO_CAJA + GAP;
      if (col === 0 && y + ALTO_CAJA > limiteY) {
        doc.addPage();
        y = M;
      }
      const x = M + col * (colW + GAP);
      doc.setDrawColor(220, 224, 230);
      doc.setLineWidth(0.6);
      doc.rect(x, y, colW, ALTO_CAJA);
      const maxW = colW - 8;
      const maxH = ALTO_CAJA - 8;
      const r = Math.min(maxW / Math.max(f.w, 1), maxH / Math.max(f.h, 1));
      const w = Math.max(1, f.w * r);
      const h = Math.max(1, f.h * r);
      try {
        doc.addImage(f.data, 'JPEG', x + (colW - w) / 2, y + (ALTO_CAJA - h) / 2, w, h);
      } catch {
        /* una imagen ilegible no frena el documento */
      }
    });
    y += ALTO_CAJA + 16;
  }

  doc.setTextColor(0, 0, 0);
  return y;
}

/* ───────────── Un pedido (GT) ───────────── */

/** Reporte de UN pedido: datos, pasos con hora, almacén, nota, productos y anexo fotográfico. */
export async function pdfPedidoDelivery(p: PedidoDelivery, urls?: Record<string, string>): Promise<void> {
  const d = detallePedido(p, quienSync);
  const retiro = d.origen === 'almacen';
  const generado = fechaHoraVE(new Date().toISOString());
  const { doc, autoTable, y } = await nuevoDoc(
    retiro ? `Retiro en Almacén · ${d.oc}` : `Reporte del pedido ${d.oc}`,
    `Delivery · ${retiro ? `Retiro en ${ALMACEN_RETIRO} · ` : ''}${d.estado}${d.urgente ? ' · URGENTE' : ''}`, false,
  );

  const datos: Array<[string, string]> = retiro ? [
    ['Solicitud de pedido', d.oc],
    ['Origen', `Retiro en ${ALMACEN_RETIRO}`],
    ['Estado', d.estado + (d.urgente ? ' (urgente)' : '')],
    ['Delivery', d.motorizado],
    ...(d.analista ? [['Revisó en Almacén', d.analista] as [string, string]] : []),
    [p.estado === 'entregado' ? 'Entregado a' : 'Entregar a', d.almacen],
    ['Tiempo de entrega', d.tiempo],
    ...(d.motivoCancel ? [['Motivo de cancelación', d.motivoCancel] as [string, string]] : []),
    ['Nota de entrega', d.nota ?? '—'],
    ['Fotos', `${d.fotosRecibo} al retirar en Almacén · ${d.fotosEntrega} de la entrega`],
  ] : [
    ['Orden de compra', d.oc],
    ['Estado', d.estado + (d.urgente ? ' (urgente)' : '')],
    ['Proveedor', d.proveedor],
    ...(d.direccion ? [['Dirección', d.direccion] as [string, string]] : []),
    ...(d.telefonoProveedor ? [['Teléfono del proveedor', d.telefonoProveedor] as [string, string]] : []),
    ['Delivery', d.motorizado],
    ...(d.analista ? [['Analista de Compras', d.analista] as [string, string]] : []),
    ['Almacén de entrega', d.almacen],
    ['Monto de la OC', d.monto],
    ['Tiempo de entrega', d.tiempo],
    ...(d.motivoCancel ? [['Motivo de cancelación', d.motivoCancel] as [string, string]] : []),
    ['Nota de entrega', d.nota ?? '—'],
    ['Fotos', `${d.fotosRecibo} al recibir del proveedor · ${d.fotosEntrega} de la entrega`],
  ];
  autoTable(doc, {
    startY: y,
    body: datos.map(([a, b]) => [textoPdf(a), textoPdf(b)]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150, fillColor: [248, 248, 248] } },
    margin: MARGENES_TABLA,
  });

  autoTable(doc, {
    startY: finTabla(doc, y) + 14,
    head: [['Paso', 'Fecha y hora']],
    body: d.pasos.length ? d.pasos.map((x) => [textoPdf(x.paso), textoPdf(x.hora)])
      : [[{ content: 'Todavía no lo ha tomado ningún delivery.', colSpan: 2, styles: { halign: 'center' as const } }]],
    theme: 'grid', headStyles: HEAD, styles: { fontSize: 9, cellPadding: 4 }, margin: MARGENES_TABLA,
  });

  if (d.productos.length) {
    autoTable(doc, {
      startY: finTabla(doc, y) + 14,
      head: [['Producto', 'Cantidad']],
      body: d.productos.map((x) => [textoPdf(x.nombre), textoPdf(x.cantidad)]),
      theme: 'grid', headStyles: HEAD, styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 1: { halign: 'right', cellWidth: 110 } }, margin: MARGENES_TABLA,
    });
  }

  if ((p.fotos_recibo?.length ?? 0) + (p.fotos_entrega?.length ?? 0) > 0) {
    await dibujarSeccionesFotosPdf(doc, finTabla(doc, y) + 20, p, urls);
  }

  pies(doc, `${retiro ? 'Retiro en Almacén' : 'Reporte del pedido'} ${d.oc} · ${generado}`);
  previewPdf(doc, `delivery-${retiro ? 'retiro-' : ''}${d.oc}.pdf`);
}

/** Registro fotográfico del pedido en PDF institucional (se abre en `Vista previa`). */
export async function pdfFotosDelivery(p: PedidoDelivery, urls?: Record<string, string>): Promise<void> {
  const d = detallePedido(p, quienSync);
  const retiro = d.origen === 'almacen';
  const generado = fechaHoraVE(new Date().toISOString());
  const { doc, autoTable, y } = await nuevoDoc(
    `Fotos · ${d.oc}`,
    `Delivery · ${retiro ? `Retiro en ${ALMACEN_RETIRO} · ` : ''}${d.estado}${d.urgente ? ' · URGENTE' : ''}`,
    false,
  );

  const resumen: Array<[string, string]> = [
    [retiro ? 'Solicitud de pedido' : 'Orden de compra', d.oc],
    [retiro ? 'Origen' : 'Proveedor', retiro ? `Retiro en ${ALMACEN_RETIRO}` : d.proveedor],
    ['Delivery', d.motorizado],
    [retiro ? (p.estado === 'entregado' ? 'Entregado a' : 'Entregar a') : 'Almacén de entrega', d.almacen],
    ...(p.entregado_en ? [['Fecha de entrega', fechaHoraVE(p.entregado_en)] as [string, string]] : []),
    ...(d.nota ? [['Nota de entrega', d.nota] as [string, string]] : []),
  ];

  autoTable(doc, {
    startY: y,
    body: resumen.map(([a, b]) => [textoPdf(a), textoPdf(b)]),
    theme: 'grid',
    styles: { fontSize: 8.8, cellPadding: 3.5, overflow: 'linebreak' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 145, fillColor: [248, 248, 248] } },
    margin: MARGENES_TABLA,
  });

  await dibujarSeccionesFotosPdf(doc, finTabla(doc, y) + 18, p, urls);
  pies(doc, `Fotos · ${d.oc} · ${generado}`);
  previewPdf(doc, `fotos-delivery-${retiro ? 'retiro-' : ''}${d.oc}.pdf`);
}
