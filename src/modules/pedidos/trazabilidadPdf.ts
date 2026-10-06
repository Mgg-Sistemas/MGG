import type { jsPDF as jsPDFType } from 'jspdf';
import { supabase } from '@/shared/lib/supabase';
import { dateTime, money, num } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoMarcaRecepcion } from './marcaRecibida';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import type {
  EvaluacionRecepcion,
  OfertaProveedor,
  Orden,
  Proveedor,
} from '@/shared/lib/types';

interface TrazabilidadData {
  orden: Orden;
  proveedorFinal: Proveedor | null;
  proveedoresPorId: Map<string, Proveedor>;
  ofertas: OfertaProveedor[];
  evaluacion: EvaluacionRecepcion | null;
  /** email → nombre, para mostrar quién aprobó/confirmó (no el correo crudo). */
  nombrePorEmail: Map<string, string>;
}

async function cargarTrazabilidad(ordenId: string): Promise<TrazabilidadData> {
  const [{ data: orden, error: oe }, { data: ofertas, error: ofe }, { data: evals, error: ee }] = await Promise.all([
    supabase.from('ordenes').select('*').eq('id', ordenId).single(),
    supabase.from('ofertas_proveedor').select('*').eq('orden_id', ordenId).order('precio_total'),
    supabase.from('evaluaciones_recepcion').select('*').eq('orden_id', ordenId).maybeSingle(),
  ]);
  if (oe || !orden) throw oe ?? new Error('Orden no encontrada');
  if (ofe) throw ofe;
  if (ee) throw ee;

  const provIds = new Set<string>();
  if (orden.proveedor_id) provIds.add(orden.proveedor_id);
  (ofertas ?? []).forEach((o) => provIds.add(o.proveedor_id));
  const proveedoresPorId = new Map<string, Proveedor>();
  if (provIds.size) {
    const { data: provs } = await supabase
      .from('proveedores')
      .select('*')
      .in('id', Array.from(provIds));
    (provs ?? []).forEach((p: Proveedor) => proveedoresPorId.set(p.id, p));
  }

  // Resolvemos los correos de quienes intervinieron (aprobó / confirmó / creó OC)
  // a su nombre, para no mostrar el correo crudo en el PDF.
  const emails = Array.from(new Set(
    [orden.aprobada_por, orden.oc_aprobada_por, orden.oc_creada_por, orden.solicitante_email]
      .filter((e): e is string => !!e),
  ));
  const nombrePorEmail = new Map<string, string>();
  if (emails.length) {
    const { data: us } = await supabase.from('usuarios').select('email, nombre, apellido').in('email', emails);
    (us ?? []).forEach((u: { email?: string; nombre?: string; apellido?: string }) => {
      const nom = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim();
      if (u.email && nom) nombrePorEmail.set(u.email, nom);
    });
  }

  return {
    orden: orden as Orden,
    proveedorFinal: orden.proveedor_id ? proveedoresPorId.get(orden.proveedor_id) ?? null : null,
    proveedoresPorId,
    ofertas: (ofertas ?? []) as OfertaProveedor[],
    evaluacion: (evals ?? null) as EvaluacionRecepcion | null,
    nombrePorEmail,
  };
}

interface BuildResult {
  doc: jsPDFType;
  codigo: string;
  filename: string;
}

async function buildTrazabilidadPdf(ordenId: string): Promise<BuildResult> {
  const [data, logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    cargarTrazabilidad(ordenId),
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const { orden, proveedorFinal, proveedoresPorId, ofertas, evaluacion, nombrePorEmail } = data;
  // email → nombre (o el propio correo si no está en usuarios).
  const quien = (email?: string | null) => (email ? nombrePorEmail.get(email) ?? email : '—');

  // Un pedido de SERVICIO habla de "orden/solicitud de servicio", no de "pedido/compra".
  // Detectamos por clase; respaldo por prefijo de código (SV-) para órdenes viejas.
  const esServicio = orden.clase === 'servicio' || (orden.codigo ?? '').toUpperCase().startsWith('SV-');
  const L = {
    docTitulo: `Trazabilidad de orden de ${esServicio ? 'servicio' : 'pedido'}`,
    solicitud: esServicio ? 'Solicitud de servicio' : 'Solicitud',
    items: esServicio ? 'Servicios solicitados' : 'Ítems solicitados',
    orden: esServicio ? 'Orden de servicio' : 'Orden de compra',
    nOrden: esServicio ? 'N° de orden de servicio' : 'N° de orden de compra',
    recepcion: esServicio ? 'Recepción del servicio' : 'Recepción de mercancía',
  };

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = MARGEN_PDF; // 2 cm (margen uniforme en todos los lados)
  const pageH = doc.internal.pageSize.getHeight();
  // El pie va en la última línea del marco; el contenido le deja 14 pt.
  const LIMITE_TEXTO = limiteInferiorPdf(pageH) - 14;
  const MARGEN_TABLAS = { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 14 };
  let y = MARGIN;
  // Antes de un título suelto: si no cabe `alto` dentro del marco, página nueva.
  const asegurarEspacio = (alto: number) => {
    if (y + alto > LIMITE_TEXTO) { doc.addPage(); y = MARGIN + 10; }
  };

  // ─── Header ────────────────────────────────────────────
  const LOGO_SIZE = 56;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE);
    } catch {
      /* logo opcional: ignorar si falla */
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(L.docTitulo, TEXT_X, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `Mineral Group Guayana C.A. · Generado ${dateTime(new Date().toISOString())}`,
    TEXT_X,
    y + 36,
  );
  y += Math.max(LOGO_SIZE, 36) + 10;

  doc.setDrawColor(200);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 16;

  // ─── 1. Solicitud ──────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`1. ${L.solicitud} · ${orden.codigo}`, MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const filasSolicitud: Array<[string, string]> = [
    ['Unidad solicitante', orden.solicitante ?? '—'],
    ['Solicitante', orden.ci_solicitante ?? '—'],
    ['Correo', orden.solicitante_email],
    ['Fecha de solicitud', dateTime(orden.created_at)],
    ['Estado actual', orden.estado],
    ['Clasificación', orden.clasificacion?.length ? orden.clasificacion.join(' · ') : '—'],
    ['Aprobada por', orden.aprobada_en ? quien(orden.aprobada_por) : '— (pendiente)'],
    ['Fecha de aprobación', orden.aprobada_en ? dateTime(orden.aprobada_en) : '—'],
    ['Nota', orden.notas ?? '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: filasSolicitud,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 140 }, 1: { cellWidth: 'auto' } },
    margin: MARGEN_TABLAS,
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // ─── 2. Ítems solicitados ──────────────────────────────
  doc.setFont('helvetica', 'bold');
  asegurarEspacio(30);
  doc.text(`2. ${L.items}`, MARGIN, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [['SKU', 'Producto', 'Categoría', 'Subcategoría', 'Cantidad', 'Precio unit.', 'Subtotal']],
    body: orden.items.map((it) => [
      it.sku,
      it.nombre,
      it.servicio_categoria?.trim() || '—',
      it.servicio_tipo?.trim() || '—',
      num(it.cantidad),
      money(it.precio),
      money(it.cantidad * it.precio),
    ]),
    foot: (() => {
      const descObt = Number(orden.descuento_obtenido) || 0;
      const subtotalItems = orden.items.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio) || 0), 0);
      return descObt > 0
        ? [
          ['', '', '', '', '', 'Subtotal', money(subtotalItems)],
          ['', '', '', '', '', 'Descuento obtenido', `- ${money(descObt)}`],
          ['', '', '', '', '', 'TOTAL', money(orden.total)],
        ]
        : [['', '', '', '', '', 'TOTAL', money(orden.total)]];
    })(),
    theme: 'grid',
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    margin: MARGEN_TABLAS,
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // ─── 3. Ofertas de proveedores ─────────────────────────
  doc.setFont('helvetica', 'bold');
  asegurarEspacio(30);
  doc.text(`3. Ofertas de proveedores (${ofertas.length})`, MARGIN, y);
  y += 6;
  if (!ofertas.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text('Sin ofertas registradas.', MARGIN, y + 12);
    y += 28;
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Proveedor', 'Precio total', 'Entrega prom.', 'Estado', 'Score']],
      body: ofertas.map((of) => [
        proveedoresPorId.get(of.proveedor_id)?.razon_social ?? '—',
        money(of.precio_total),
        of.fecha_entrega_prometida ?? '—',
        of.estado,
        of.score_calculado != null ? `${(of.score_calculado * 100).toFixed(0)}` : '—',
      ]),
      theme: 'grid',
      headStyles: { fillColor: [230, 230, 230], textColor: 20 },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 1: { halign: 'right' }, 4: { halign: 'right' } },
      margin: MARGEN_TABLAS,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }

  // ─── 4. Orden de compra (proveedor aceptado) ───────────
  doc.setFont('helvetica', 'bold');
  asegurarEspacio(30);
  doc.text(`4. ${L.orden}${orden.oc_codigo ? ` · ${orden.oc_codigo}` : ''}`, MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  const ofertaAceptada = ofertas.find((o) => o.estado === 'aceptada');
  const ocEvento = orden.historial?.find((h) => h.evento === 'oc_emitida');
  const documentosOc = ocEvento?.documentos ?? [];
  const filasOrden: Array<[string, string]> = [
    [L.nOrden, orden.oc_codigo ?? '—'],
    ['Proveedor adjudicado', proveedorFinal?.razon_social ?? '—'],
    ['RIF', proveedorFinal?.rif ?? '—'],
    ['Contacto', proveedorFinal?.contacto ?? '—'],
    ...((Number(orden.descuento_obtenido) || 0) > 0
      ? [['Descuento obtenido', `- ${money(Number(orden.descuento_obtenido) || 0)}`]] as Array<[string, string]>
      : []),
    ['Total de la orden', money(orden.total)],
    ['Almacén destino', orden.almacen_destino ?? '—'],
    ['OC confirmada por', orden.oc_aprobada_en ? quien(orden.oc_aprobada_por) : '—'],
    ['Fecha de confirmación', orden.oc_aprobada_en ? dateTime(orden.oc_aprobada_en) : '—'],
    ['Fecha de entrega prometida', ofertaAceptada?.fecha_entrega_prometida ?? '—'],
    ['Condiciones de pago', ofertaAceptada?.condiciones_pago ?? '—'],
    ['Documentos de la OC', documentosOc.length ? documentosOc.join(' · ') : '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: filasOrden,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180 }, 1: { cellWidth: 'auto' } },
    margin: MARGEN_TABLAS,
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // ─── 5. Recepción ──────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  asegurarEspacio(30);
  doc.text(`5. ${L.recepcion}`, MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  const recibida = orden.historial?.find((h) => h.evento === 'recibida');
  // Una orden recibida puede luego finalizarse; en ambos estados sigue "recibida".
  const fueRecibida = ['recibida', 'finalizada'].includes(orden.estado) || !!recibida;
  const filasRecepcion: Array<[string, string]> = [
    ['Estado', fueRecibida ? 'Recibida' : 'Aún no recibida'],
    ['Fecha de recepción', recibida ? dateTime(recibida.at) : '—'],
    ['Recibida por', recibida?.actor ?? '—'],
    ['Calidad evaluada', evaluacion ? `${evaluacion.calidad} / 5` : '—'],
    ['Puntualidad', evaluacion ? (
      evaluacion.puntualidad_dias === 0
        ? 'En fecha prometida'
        : evaluacion.puntualidad_dias > 0
          ? `${evaluacion.puntualidad_dias} días adelantado`
          : `${Math.abs(evaluacion.puntualidad_dias)} días atrasado`
    ) : '—'],
    ['Comentario', evaluacion?.comentario ?? '—'],
  ];
  // Renglones que llegaron con otra marca que la pedida, con la nota del almacenista.
  const marcasDistintas = orden.items
    .map((it) => ({ it, txt: textoMarcaRecepcion(it) }))
    .filter((x): x is { it: typeof x.it; txt: string } => !!x.txt)
    .map(({ it, txt }) => `${it.nombre}: ${txt}${it.nota_marca ? ` (${it.nota_marca})` : ''}`);
  if (marcasDistintas.length) filasRecepcion.push(['Marcas distintas', marcasDistintas.join('\n')]);
  autoTable(doc, {
    startY: y,
    body: filasRecepcion,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180 }, 1: { cellWidth: 'auto' } },
    margin: MARGEN_TABLAS,
  });

  /* ─── 6. Despiece ───────────────────────────────────────
     Una RES EN CANAL no entra al inventario como res: entra convertida en
     cortes. El PDF de la compra tiene que decir en qué se convirtió y a qué
     almacén fue cada kilo, o la traza se corta justo donde importa. */
  const conDespiece = (orden.items ?? []).filter((it) => it.despiece);
  for (const it of conDespiece) {
    const d = it.despiece as NonNullable<typeof it.despiece>;
    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 22;
    if (y > LIMITE_TEXTO - 170) { doc.addPage(); y = MARGIN + 10; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text(`6. Despiece de ${it.nombre}`, MARGIN, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    const lineasLlegada = doc.splitTextToSize(
      `Llegaron ${d.kg_recibidos} kg. El costo se reparte entre los kilos útiles, así que la merma encarece el corte: ${money(d.costo_por_kg)}/kg.`,
      anchoUtilPdf(PAGE_W),
    ) as string[];
    doc.text(lineasLlegada, MARGIN, y);
    // Si el texto ocupa más de una línea, la tabla arranca debajo (no encima).
    y += 16 + (lineasLlegada.length - 1) * 11;
    doc.setTextColor(20);

    /* Rendimiento de la res. Los % se recalculan si la recepción es vieja y no
       los guardó: un PDF de hace un mes tiene que salir igual de completo. */
    const kgRec = Number(d.kg_recibidos) || 0;
    const pctDe = (kg: number) => (kgRec > 0 ? Math.round(((Number(kg) || 0) / kgRec) * 10000) / 100 : 0);
    const kgUtiles = Math.round((d.cortes ?? []).reduce((a, c) => a + (Number(c.kg) || 0), 0) * 100) / 100;
    const pctUtiles = d.pct_utiles ?? pctDe(kgUtiles);
    const pctMerma = d.pct_merma ?? pctDe(d.merma_kg ?? 0);

    autoTable(doc, {
      startY: y,
      head: [['Corte obtenido', 'Kg', '% de la res', '$/kg', 'Subtotal']],
      body: (d.cortes ?? []).map((c) => [
        c.nombre, String(c.kg), `${c.pct ?? pctDe(c.kg)} %`, money(c.costo_unitario), money(c.subtotal),
      ]),
      foot: [
        ['CARNE CONSUMIBLE (total de cortes)', String(kgUtiles), `${pctUtiles} %`, '', money(d.costo_total)],
        ['DESPERDICIO / MERMA (no entra a ningún almacén)', String(d.merma_kg ?? 0), `${pctMerma} %`, '', money(d.costo_merma ?? 0)],
        ['TOTAL RECIBIDO', String(kgRec), `${Math.round((pctUtiles + pctMerma) * 100) / 100} %`, '', money(d.costo_total)],
      ],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      margin: MARGEN_TABLAS,
    });

    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    const lineasRend = doc.splitTextToSize(
      `Rendimiento de la res: de ${kgRec} kg comprados se pueden cocinar ${kgUtiles} kg (${pctUtiles} %) y se pierden ${d.merma_kg ?? 0} kg (${pctMerma} %) como merma. El costo de la merma ya está repartido en el $/kg de cada corte.`,
      anchoUtilPdf(PAGE_W),
    ) as string[];
    // Si el párrafo de rendimiento no cabe dentro del marco, página nueva.
    asegurarEspacio(lineasRend.length * 10 + 4);
    doc.text(lineasRend, MARGIN, y);
    y += lineasRend.length * 10;
    doc.setTextColor(20);

    const reparto = d.por_almacen ?? [];
    if (reparto.length) {
      // Debajo del párrafo de rendimiento (no encima: antes se pisaban).
      y += 8;
      autoTable(doc, {
        startY: y,
        head: [['Entró a', 'Cortes', 'Kg']],
        body: reparto.map((r) => [
          r.almacen,
          r.cortes.map((c) => `${c.kg} kg ${c.nombre}`).join(', '),
          String(Math.round(r.cortes.reduce((a, c) => a + (Number(c.kg) || 0), 0) * 10000) / 10000),
        ]),
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [55, 55, 55], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 150 }, 2: { halign: 'right', cellWidth: 60 } },
        margin: MARGEN_TABLAS,
      });
    }
  }

  // ─── Footer ────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Documento auto-generado · Orden ${orden.codigo} · ${dateTime(new Date().toISOString())}`,
    MARGIN,
    limiteInferiorPdf(pageH),
  );

  return { doc, codigo: orden.codigo, filename: `trazabilidad-${orden.codigo}.pdf` };
}

/** Descarga el PDF al disco del usuario. */
export async function descargarTrazabilidadPdf(ordenId: string): Promise<void> {
  const { doc, filename } = await buildTrazabilidadPdf(ordenId);
  previewPdfDoc(doc, filename);
}

/** Devuelve el PDF como base64 (sin el prefijo data URI). Útil para enviarlo
 *  por correo desde la Edge Function. */
export async function obtenerTrazabilidadPdfBase64(
  ordenId: string,
): Promise<{ base64: string; codigo: string; filename: string }> {
  const { doc, codigo, filename } = await buildTrazabilidadPdf(ordenId);
  // jsPDF.output('datauristring') retorna `data:application/pdf;filename=...;base64,JVBE...`
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',', 2)[1] ?? '';
  return { base64, codigo, filename };
}
