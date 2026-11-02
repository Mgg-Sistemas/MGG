/* ============================================================
   MGG · Almacén · PDF de la Solicitud de Pedido (02-11-2026)

   La administradora pidió ver las SP «en formato PDF vista previa»: qué se
   pidió, quién, para dónde y, si almacén ya la revisó (o la está revisando),
   qué respondió cada sede, quién confirmó y cuándo, el reparto (lo que entrega
   cada almacén y lo que va a Compras), los traslados y la nota de almacén.

   Se abre en la vista previa del sistema (previewPdfDoc): nada se descarga
   solo, el archivo sale únicamente con el botón Descargar del visor. Mismo
   molde que deliveryPdf.ts (logo, raya naranja, autoTable, pie con páginas).

   Las filas se arman en funciones puras (abajo, exportadas) para probarlas
   sin jsPDF: ver solicitudPedidoPdf.test.ts.
   ============================================================ */
import type { ItemOrden, Orden } from '@/shared/lib/types';
import { dateTime, statusBadge } from '@/shared/lib/format';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { quienSolicita } from './quienSolicita';
import {
  cantidadSolicitada, disponibleAcotado, estadoSedes, etiquetaSede, fmtCant, marcaDeSede, repartoRenglon,
  resumenRevision, SEDES_REVISION_ALMACEN, seRevisa, trasladosDeSolicitud, type ItemRevision,
} from './revisionAlmacen';

export interface OpcionesPdfSp {
  /** Nombre de la persona a partir del correo (useNombreUsuario: `nombreDe(null, correo)`). */
  nombre?: (correo: string) => string;
}

const texto = (v: unknown): string => String(v ?? '').trim();

function esObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function nombreDe(correo: string | null | undefined, opts?: OpcionesPdfSp): string {
  const c = texto(correo);
  if (!c) return '';
  return texto(opts?.nombre?.(c)) || c;
}

/* ── Filas puras ── */

/**
 * ¿El renglón va al PDF? Los desmarcados en la SP (`comprar === false`) no se
 * piden y quedan afuera; pero al cerrar la revisión la base deja `comprar=false`
 * en lo que almacén atiende completo, y eso SÍ va (lo marcó alguna sede).
 */
export function renglonEnPdf(it: ItemOrden): boolean {
  if (seRevisa(it)) return true;
  const r = it as ItemRevision;
  return esObjeto(r.almacen_sedes) || esObjeto(r.almacen_origenes) || it.cantidad_almacen != null;
}

/** ¿Hay algo de la revisión de almacén para mostrar (cerrada o en curso)? */
export function tieneRevision(o: Orden): boolean {
  if (o.revisada_almacen_en) return true;
  return estadoSedes(o).some((e) => e.confirmada || e.revisados > 0);
}

/** Ficha de la SP: [etiqueta, valor]. Lo vacío no sale. */
export function fichaSolicitudPedido(o: Orden): Array<[string, string]> {
  const filas: Array<[string, string]> = [];
  filas.push(['Fecha', dateTime(o.created_at)]);
  filas.push(['Solicitante', [texto(o.solicitante), texto(quienSolicita(o))].filter(Boolean).join(' — ') || '—']);
  if (texto(o.sede_destino)) filas.push(['Se necesita en', etiquetaSede(o.sede_destino)]);
  const finalidad = texto(o.finalidad) || texto(o.motivo);
  if (finalidad) filas.push(['Finalidad', finalidad]);
  if (o.urgente) filas.push(['Urgente', 'Sí']);
  filas.push(['Estado', statusBadge(o.estado).label]);
  if (texto(o.notas)) filas.push(['Notas', texto(o.notas)]);
  return filas;
}

/** Lo que respondió una sede en un renglón, en palabras cortas. */
function respuestaSede(it: ItemOrden, sede: string, cerrada: boolean): string {
  const m = marcaDeSede(it, sede);
  if (!m?.revisado) return cerrada ? '—' : 'sin responder';
  return m.disponible > 0 ? fmtCant(disponibleAcotado(it, m.disponible)) : 'no hay';
}

/**
 * Tabla de productos. Sin revisión: #, producto, cantidad, unidad. Con revisión
 * (cerrada o en curso), además lo que respondió cada sede y lo que va a Compras
 * (este último solo cuando ya se sabe: SP cerrada o todas las sedes respondieron
 * el renglón).
 */
export function tablaProductosSp(o: Orden): { head: string[]; body: string[][] } {
  const conRev = tieneRevision(o);
  const cerrada = !!o.revisada_almacen_en;
  const head = ['#', 'Producto', 'Cantidad', 'Unidad'];
  if (conRev) head.push(...SEDES_REVISION_ALMACEN.map((s) => s.etiqueta), 'A Compras');
  const body = (o.items ?? []).filter(renglonEnPdf).map((it, i) => {
    const fila = [String(i + 1), texto(it.nombre) || '(sin nombre)', fmtCant(cantidadSolicitada(it)), texto(it.unidad) || '—'];
    if (conRev) {
      for (const s of SEDES_REVISION_ALMACEN) fila.push(respuestaSede(it, s.sede, cerrada));
      const sabido = cerrada || SEDES_REVISION_ALMACEN.every((s) => marcaDeSede(it, s.sede)?.revisado);
      fila.push(sabido ? fmtCant(repartoRenglon(it, o.sede_destino).falta) : '—');
    }
    return fila;
  });
  return { head, body };
}

/** Cómo va (o cómo quedó) cada sede: [sede, estado, quién confirmó, cuándo, nota]. */
export function filasSedesSp(o: Orden, opts?: OpcionesPdfSp): string[][] {
  return estadoSedes(o).map((e) => [
    e.etiqueta,
    e.confirmada ? 'Confirmó' : e.revisados > 0 ? `En curso (${e.revisados}/${e.total})` : 'Pendiente',
    e.confirmada ? nombreDe(e.confirmacion?.confirmada_por, opts) || '—' : '—',
    e.confirmada ? dateTime(e.confirmacion?.confirmada_en) : '—',
    texto(e.confirmacion?.nota) || '—',
  ]);
}

/** El reparto de una SP cerrada: [origen, producto, cantidad]; lo que entrega cada almacén y lo que va a Compras. */
export function filasRepartoSp(o: Orden): string[][] {
  const { falta, porSede = [] } = resumenRevision(o.items ?? [], o.sede_destino);
  const filas: string[][] = [];
  const und = (u: string) => (texto(u) ? ` ${texto(u)}` : '');
  for (const e of porSede) {
    for (const r of e.renglones) filas.push([`Entrega ${e.etiqueta}`, r.nombre, `${fmtCant(r.cantidad)}${und(r.unidad)}`]);
  }
  for (const r of falta) filas.push(['Va a Compras', r.nombre, `${fmtCant(r.cantidad)}${und(r.unidad)}`]);
  return filas;
}

/** Traslados entre almacenes por la SP: [ruta, productos, estado]. */
export function filasTrasladosSp(o: Orden, opts?: OpcionesPdfSp): string[][] {
  return trasladosDeSolicitud(o).map((t) => [
    `${t.etiqueta} → ${t.etiquetaDestino}`,
    t.renglones.map((r) => `${r.nombre} ${fmtCant(r.cantidad)}${r.unidad ? ` ${r.unidad}` : ''}`).join(' · '),
    t.hecho ? ['Hecho', nombreDe(t.hecho.por, opts), dateTime(t.hecho.en)].filter(Boolean).join(' · ') : 'Pendiente',
  ]);
}

/* ── El documento ── */

const MARGIN = MARGEN_PDF;
const ALTO_PIE = 14;
const MARGENES_TABLA = { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + ALTO_PIE };
const NARANJA: [number, number, number] = [255, 138, 0];

type Doc = import('jspdf').jsPDF;
const finalY = (doc: Doc) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? MARGIN;
const safeFilas = (rows: string[][]) => rows.map((r) => r.map((x) => pdfSafe(x)));

/** Título de sección entre tablas; si no cabe, pasa a la hoja siguiente. */
function seccion(doc: Doc, titulo: string, y: number): number {
  const h = doc.internal.pageSize.getHeight();
  let yy = y;
  if (yy + 60 > limiteInferiorPdf(h) - ALTO_PIE) { doc.addPage(); yy = MARGIN; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
  doc.text(pdfSafe(titulo), MARGIN, yy + 10);
  doc.setFont('helvetica', 'normal');
  return yy + 16;
}

/** Pie con el número de página en todas las hojas. */
function pies(doc: Doc, pie: string) {
  const n = doc.getNumberOfPages();
  const h = doc.internal.pageSize.getHeight();
  const w = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(pdfSafe(pie), MARGIN, limiteInferiorPdf(h));
    doc.text(`Página ${i} de ${n}`, w - MARGIN, limiteInferiorPdf(h), { align: 'right' });
  }
  doc.setTextColor(0);
}

/** Abre la SP en la vista previa de PDF del sistema. */
export async function verSolicitudPedidoPdf(orden: Orden, opts?: OpcionesPdfSp): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }, { previewPdfDoc }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'), import('@/shared/lib/reportPreview'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const generado = dateTime(new Date().toISOString());
  const productos = tablaProductosSp(orden);
  const conRev = tieneRevision(orden);
  // Con las columnas de cada sede la tabla pide la hoja acostada.
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: conRev ? 'landscape' : 'portrait' });
  const PAGE_W = doc.internal.pageSize.getWidth();

  // ─── Encabezado ────────────────────────────────────────
  let y = MARGIN;
  const LOGO = 56;
  const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(pdfSafe(`Solicitud de Pedido ${orden.codigo}`), TX, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Mineral Group Guayana C.A.', TX, y + 34);
  doc.setTextColor(90);
  doc.text(pdfSafe(`${orden.urgente ? 'URGENTE · ' : ''}${statusBadge(orden.estado).label} · Generado ${generado}`), TX, y + 48);
  doc.setTextColor(0);
  y += LOGO + 10;
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 16;

  // ─── Ficha ─────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    body: fichaSolicitudPedido(orden).map(([k, v]) => [pdfSafe(k), pdfSafe(v)]),
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 120 } },
    margin: MARGENES_TABLA,
  });

  // ─── Productos ─────────────────────────────────────────
  let cy = seccion(doc, `Productos solicitados (${productos.body.length})`, finalY(doc) + 14);
  const derecha = { halign: 'right' as const };
  const colsNum: Record<number, { halign: 'right'; cellWidth?: number }> = { 0: { ...derecha, cellWidth: 26 }, 2: { ...derecha, cellWidth: 64 } };
  if (conRev) for (let i = 4; i < productos.head.length; i++) colsNum[i] = { ...derecha, cellWidth: 70 };
  autoTable(doc, {
    startY: cy,
    head: [productos.head.map((h) => pdfSafe(h))],
    body: productos.body.length ? safeFilas(productos.body) : [['', 'Sin productos', ...productos.head.slice(2).map(() => '')]],
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    columnStyles: { ...colsNum, 3: { cellWidth: 70 } },
    margin: MARGENES_TABLA,
  });

  if (conRev) {
    // ─── Revisión de almacén por sede ────────────────────
    cy = seccion(doc, 'Revisión de almacén', finalY(doc) + 14);
    autoTable(doc, {
      startY: cy,
      head: [['Sede', 'Estado', 'Confirmó', 'Fecha', 'Nota']],
      body: safeFilas(filasSedesSp(orden, opts)),
      theme: 'grid',
      headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 100 }, 3: { cellWidth: 130 } },
      margin: MARGENES_TABLA,
    });
  }

  if (orden.revisada_almacen_en) {
    // ─── Reparto: lo que entrega cada almacén y lo que va a Compras ──
    const reparto = filasRepartoSp(orden);
    if (reparto.length) {
      cy = seccion(doc, 'Reparto', finalY(doc) + 14);
      autoTable(doc, {
        startY: cy,
        head: [['Origen', 'Producto', 'Cantidad']],
        body: safeFilas(reparto),
        theme: 'grid',
        headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: 140 }, 2: { cellWidth: 100, halign: 'right' } },
        margin: MARGENES_TABLA,
      });
    }

    const traslados = filasTrasladosSp(orden, opts);
    if (traslados.length) {
      cy = seccion(doc, 'Traslados entre almacenes', finalY(doc) + 14);
      autoTable(doc, {
        startY: cy,
        head: [['Traslado', 'Productos', 'Estado']],
        body: safeFilas(traslados),
        theme: 'grid',
        headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: 140 }, 2: { cellWidth: 170 } },
        margin: MARGENES_TABLA,
      });
    }

    const nota = texto(orden.nota_almacen);
    if (nota) {
      cy = seccion(doc, 'Nota de almacén', finalY(doc) + 14);
      autoTable(doc, {
        startY: cy,
        body: [[pdfSafe(nota)]],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3, overflow: 'linebreak' },
        margin: MARGENES_TABLA,
      });
    }
  }

  pies(doc, `Solicitud de Pedido ${orden.codigo} · ${generado}`);
  previewPdfDoc(doc, `${orden.codigo.replace(/[^\w-]+/g, '_')}.pdf`);
}
