/* ============================================================
   Golden Touch · Control de Maquinaria · PDFs de Flota y Servicio
   · Ficha técnico-operativa del equipo: identificación (tablas
     pareadas), observaciones, registro fotográfico e historial de
     servicio, con pastilla de estado y «Página X de Y».
   · Orden de servicio: datos generales, trabajo, repuestos con su
     origen (inventario / compra), solicitudes vinculadas y firmas.
   Se abren en la vista previa del sistema (previewPdf).
   ============================================================ */
import { quienSync } from '@/shared/lib/directorioUsuarios';
import type { jsPDF as JsPDF } from 'jspdf';
import { previewPdf } from '@/shared/lib/reportePreview';
import { identidadEmpresa } from '@/shared/lib/empresa';
import { loadLogoPdfEmpresa, dibujarLogoPdf, anchoLogoPdf } from '@/shared/lib/pdfLogo';
import { num as fmtNum, date as fmtDate } from '@/shared/lib/format';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import type { FotoEquipo, LavadoEquipo, OrdenServicio } from './flota.repository';
import { fotosOrdenConUrl } from './osFotos.repository';
import { ESTADOS_EQUIPO, ORDEN_ESTADOS, URGENCIAS, estadoEfectivo, servicioPorId, etiquetaServicio, type EstadoEquipo } from './flota';

type AutoTable = (doc: JsPDF, opts: Record<string, unknown>) => void;

const M = 14;                     // margen (mm)
const BORDE: [number, number, number] = [203, 213, 225];
const FONDO_ETIQUETA: [number, number, number] = [241, 245, 249];
const NARANJA: [number, number, number] = [255, 138, 0];
const TINTA: [number, number, number] = [30, 41, 59];

const TONO_RGB: Record<string, [number, number, number]> = {
  success: [22, 163, 74], danger: [220, 38, 38], warning: [217, 119, 6], primary: [234, 88, 12],
  info: [37, 99, 235], wait: [124, 58, 237], retired: [100, 116, 139],
};

async function cargarPdf(): Promise<{ jsPDF: typeof JsPDF; autoTable: AutoTable }> {
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable: at.default as unknown as AutoTable };
}

const finalY = (doc: JsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

/** Membrete: logo, título, subtítulo y pastilla de estado. Devuelve la Y siguiente. */
async function encabezado(doc: JsPDF, titulo: string, subtitulo: string, estado: EstadoEquipo | null): Promise<number> {
  const W = doc.internal.pageSize.getWidth();
  const logo = await loadLogoPdfEmpresa().catch(() => null);
  const caja = 20;
  if (logo) dibujarLogoPdf(doc, logo, M, 10, caja);
  const x0 = M + (logo ? anchoLogoPdf(caja) + 6 : 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NARANJA);
  doc.text(titulo, x0, 18);
  doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(subtitulo, x0, 24);
  if (estado) {
    const e = ESTADOS_EQUIPO[estado];
    const txt = e.label.toUpperCase();
    doc.setFontSize(8);
    const w = doc.getTextWidth(txt) + 8;
    doc.setFillColor(...(TONO_RGB[e.tono] ?? TONO_RGB.info));
    doc.roundedRect(W - M - w, 13, w, 7, 3.5, 3.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(txt, W - M - w / 2, 17.8, { align: 'center' });
  }
  doc.setDrawColor(...NARANJA); doc.setLineWidth(0.6);
  doc.line(M, 32, W - M, 32);
  doc.setTextColor(...TINTA);
  return 39;
}

function seccion(doc: JsPDF, y: number, titulo: string): number {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...FONDO_ETIQUETA);
  doc.rect(M, y - 4.5, W - 2 * M, 7, 'F');
  doc.setFillColor(...NARANJA);
  doc.rect(M, y - 4.5, 1.2, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...TINTA);
  doc.text(titulo, M + 4, y);
  return y + 6;
}

function pies(doc: JsPDF, ref: string): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const id = identidadEmpresa();
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BORDE); doc.setLineWidth(0.3);
    doc.line(M, H - 13, W - M, H - 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
    doc.text(`${id.nombre} · RIF ${id.rif} · ${ref}`, M, H - 8.5);
    doc.text(`Página ${i} de ${n}`, W - M, H - 8.5, { align: 'right' });
  }
}

function tablaPar(doc: JsPDF, autoTable: AutoTable, x: number, y: number, ancho: number, filas: [string, string][]): number {
  if (!filas.length) return y;
  autoTable(doc, {
    startY: y, margin: { left: x }, tableWidth: ancho, body: filas, theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.4, lineColor: BORDE, lineWidth: 0.25, textColor: TINTA, valign: 'middle' },
    columnStyles: { 0: { cellWidth: ancho * 0.42, fillColor: FONDO_ETIQUETA, fontStyle: 'bold', textColor: [51, 65, 85] } },
  });
  return finalY(doc);
}

async function urlADataUrl(url: string): Promise<{ data: string; tipo: 'JPEG' | 'PNG' } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    const tipo = blob.type.includes('png') ? 'PNG' : blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'JPEG' : null;
    if (!tipo) return null; // webp/gif: jsPDF no los dibuja de forma fiable
    const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
    return { data, tipo };
  } catch { return null; }
}

const v = (x: unknown) => (x == null || x === '' ? '' : String(x));
const nombreArchivo = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

export interface DatosFicha {
  horometro: number | null;
  km: number | null;
  restantesHrs: number | null;
  restantesKm: number | null;
  /** Último surtido de Combustible, ya en palabras («09/10/2026 · 180 L · Tanque 2»). */
  ultimoSurtido: string | null;
}

/** Ficha técnico-operativa del equipo. */
export async function fichaEquipoPdf(e: MaquinariaEquipo, datos: DatosFicha, ordenes: OrdenServicio[], fotos: FotoEquipo[], lavados: LavadoEquipo[] = []): Promise<void> {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const col = (W - 2 * M - 6) / 2;
  const estado = estadoEfectivo(e);
  let n = 0;
  const sec = (y: number, t: string) => seccion(doc, y, `${++n}. ${t}`);

  let y = await encabezado(doc, 'FICHA TÉCNICO-OPERATIVA', `${e.equipo}${e.tipo ? ` · ${e.tipo.toUpperCase()}` : ''}`, estado);

  y = sec(y, 'IDENTIFICACIÓN DEL EQUIPO');
  const izq: [string, string][] = ([
    ['Equipo / denominación', `${e.equipo}${e.tipo ? ` / ${e.tipo}` : ''}`], ['Marca', v(e.marca)], ['Modelo', v(e.modelo)],
    ['Año', v(e.anio)], ['Color', v(e.color)], ['Propietario', v(e.propietario)],
  ] as [string, string][]).filter(([, x]) => x);
  const der: [string, string][] = ([
    ['Serial / PIN', v(e.serial)], ['Placa', v(e.placa)], ['Motor (modelo)', v(e.motor_modelo)], ['Motor (serial)', v(e.motor_serial)],
    ['Combustible', v(e.combustible)], ['Estado operativo', `${ESTADOS_EQUIPO[estado].label}${e.estado_nota ? ` (${e.estado_nota})` : ''}`],
  ] as [string, string][]).filter(([, x]) => x);
  y = Math.max(tablaPar(doc, autoTable, M, y, col, izq), tablaPar(doc, autoTable, M + col + 6, y, col, der)) + 4;

  const opIzq: [string, string][] = ([
    ['Ubicación', v(e.ubicacion)], ['Status (registro)', v(e.status)], ['Grupo de mantenimiento', v(e.grupo_mantenimiento)],
    ['Vínculo en Combustible', v(e.combustible_equipo)],
  ] as [string, string][]).filter(([, x]) => x);
  const opDer: [string, string][] = ([
    ['Horómetro vigente', datos.horometro != null ? `${fmtNum(datos.horometro)} h` : ''],
    ['Kilometraje vigente', datos.km != null ? `${fmtNum(datos.km)} km` : ''],
    ['Próximo servicio (h)', datos.restantesHrs != null ? `${datos.restantesHrs <= 0 ? `vencido ${fmtNum(Math.abs(datos.restantesHrs))}` : `faltan ${fmtNum(datos.restantesHrs)}`} h (cada ${fmtNum(e.mantenimiento_cada_hrs)} h)` : ''],
    ['Próximo servicio (km)', datos.restantesKm != null ? `${datos.restantesKm <= 0 ? `vencido ${fmtNum(Math.abs(datos.restantesKm))}` : `faltan ${fmtNum(datos.restantesKm)}`} km (cada ${fmtNum(e.mantenimiento_cada_km)} km)` : ''],
    ['Consumo esperado', e.litros_consume != null ? `${fmtNum(e.litros_consume)} L` : ''],
    ['Último surtido', datos.ultimoSurtido ?? ''],
  ] as [string, string][]).filter(([, x]) => x);
  y = Math.max(tablaPar(doc, autoTable, M, y, col, opIzq), tablaPar(doc, autoTable, M + col + 6, y, col, opDer)) + 8;

  const docs: [string, boolean][] = [['Documento físico', e.doc_fisico], ['Ficha de mantenimiento', e.ficha_mantt], ['Documentos en Drive', e.doc_drive], ['Especificaciones técnicas', e.esp_tecnicas], ['Revisión de mina', e.revision_mina]];
  const obs = [e.notas ? `Notas: ${e.notas}` : '', `Documentación: ${docs.map(([k, ok]) => `${k} ${ok ? '✓' : '✗'}`).join(' · ').replace(/✓/g, 'sí').replace(/✗/g, 'no')}`].filter(Boolean);
  y = sec(y, 'OBSERVACIONES Y DOCUMENTACIÓN');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...TINTA);
  const lineas = obs.flatMap((t) => doc.splitTextToSize(`•  ${t}`, W - 2 * M - 10) as string[]);
  const alto = 6 + lineas.length * 4.4;
  doc.setFillColor(255, 251, 235); doc.setDrawColor(253, 230, 138); doc.setLineWidth(0.3);
  doc.rect(M, y, W - 2 * M, alto, 'FD');
  doc.setFillColor(245, 158, 11); doc.rect(M, y, 1.2, alto, 'F');
  doc.text(lineas, M + 5, y + 5);
  y += alto + 9;

  // Registro fotográfico (imágenes de los documentos del equipo), de dos en dos.
  const imgs = (await Promise.all(fotos.slice(0, 4).map(async (f) => ({ f, img: await urlADataUrl(f.url) })))).filter((x) => x.img);
  if (imgs.length) {
    const alto = 55;
    if (y + 12 + alto > H - 20) { doc.addPage(); y = 20; }
    y = sec(y, 'REGISTRO FOTOGRÁFICO');
    for (let i = 0; i < imgs.length; i += 2) {
      if (y + alto + 8 > H - 20) { doc.addPage(); y = 20; }
      for (const [k, it] of [imgs[i], imgs[i + 1]].entries()) {
        if (!it?.img) continue;
        const x = M + k * (col + 6);
        doc.setDrawColor(...BORDE); doc.rect(x, y, col, alto);
        try { doc.addImage(it.img.data, it.img.tipo, x + 1, y + 1, col - 2, alto - 2, undefined, 'FAST'); } catch { /* imagen opcional */ }
        doc.setFontSize(7.5); doc.setTextColor(71, 85, 105);
        doc.text(it.f.nombre, x + col / 2, y + alto + 4, { align: 'center' });
      }
      y += alto + 9;
    }
  }

  if (ordenes.length) {
    if (y + 30 > H - 20) { doc.addPage(); y = 20; }
    y = sec(y, 'HISTORIAL DE SERVICIO');
    autoTable(doc, {
      startY: y, margin: { left: M, right: M },
      head: [['Orden', 'Fecha', 'Servicio', 'Descripción', 'Estado']],
      body: ordenes.map((o) => [o.codigo, fmtDate(o.created_at), etiquetaServicio(o.tipo, o.trabajos), o.descripcion ?? '', ORDEN_ESTADOS[o.estado]?.label ?? o.estado]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2.2, lineColor: BORDE, lineWidth: 0.25, textColor: TINTA },
      headStyles: { fillColor: NARANJA, textColor: [26, 14, 0], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 22 }, 2: { cellWidth: 38 }, 4: { cellWidth: 28 } },
    });
  }

  if (lavados.length) {
    let yl = ordenes.length ? finalY(doc) + 10 : y;
    if (yl + 30 > H - 20) { doc.addPage(); yl = 20; }
    yl = sec(yl, 'HISTORIAL DE LAVADOS');
    autoTable(doc, {
      startY: yl, margin: { left: M, right: M },
      head: [['Fecha', 'Lavado', 'Lo realizó', 'Lectura', 'Nota']],
      body: lavados.slice(0, 40).map((l) => [fmtDate(l.fecha), l.tipo, l.responsable ?? '',
        [l.horometro != null ? `${fmtNum(l.horometro)} h` : '', l.kilometraje != null ? `${fmtNum(l.kilometraje)} km` : ''].filter(Boolean).join(' · '), l.nota ?? '']),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2.2, lineColor: BORDE, lineWidth: 0.25, textColor: TINTA },
      headStyles: { fillColor: NARANJA, textColor: [26, 14, 0], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 30 }, 2: { cellWidth: 38 }, 3: { cellWidth: 32 } },
    });
  }

  pies(doc, `Ficha ${e.equipo}${e.serial ? ` · PIN ${e.serial}` : e.placa ? ` · Placa ${e.placa}` : ''}`);
  previewPdf(doc, `${nombreArchivo(`Ficha tecnica ${e.equipo}`)}.pdf`);
}

/** PDF de la orden de servicio. */
export async function ordenServicioPdf(
  o: OrdenServicio, e: MaquinariaEquipo,
  vinculos: { salida: { codigo: string; estado: string } | null; compra: { codigo: string; estado: string } | null },
): Promise<void> {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const s = servicioPorId(o.tipo);
  const est = ORDEN_ESTADOS[o.estado];
  const estadoEquipo: EstadoEquipo | null = o.estado === 'repuestos' ? 'repuestos' : o.estado === 'realizada' ? 'operativa' : o.estado === 'anulada' ? null : 'taller';

  let y = await encabezado(doc, `ORDEN DE SERVICIO ${o.codigo}`, `${(s?.label ?? o.tipo).toUpperCase()} · ${(est?.label ?? o.estado).toUpperCase()}`, estadoEquipo);

  y = seccion(doc, y, '1. DATOS GENERALES');
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: 'grid',
    body: [
      ['Equipo', `${e.equipo}${e.tipo ? ` · ${e.tipo}` : ''}`, 'Fecha', fmtDate(o.created_at)],
      ['Marca / modelo', [e.marca, e.modelo].filter(Boolean).join(' ') || '—', 'Urgencia', URGENCIAS.find((u) => u.id === o.urgencia)?.label ?? o.urgencia],
      ['Serial / placa', [e.serial, e.placa].filter(Boolean).join(' · ') || '—', 'Realiza', o.origen === 'interno' ? 'Taller propio' : 'Proveedor externo'],
      ['Ubicación', e.ubicacion ?? '—', 'Responsable', o.responsable ?? 'Por asignar'],
      ['Horómetro / km', [o.horometro != null ? `${fmtNum(o.horometro)} h` : '', o.kilometraje != null ? `${fmtNum(o.kilometraje)} km` : ''].filter(Boolean).join(' · ') || '—', 'Intervención', o.intervenciones.join(', ') || '—'],
      ['Qué se hace', { content: o.trabajos?.length ? o.trabajos.join(', ') : '—', colSpan: 3 }],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.4, lineColor: BORDE, lineWidth: 0.25, textColor: TINTA },
    columnStyles: { 0: { fillColor: FONDO_ETIQUETA, fontStyle: 'bold', cellWidth: 32 }, 2: { fillColor: FONDO_ETIQUETA, fontStyle: 'bold', cellWidth: 28 } },
  });
  y = finalY(doc) + 9;

  y = seccion(doc, y, '2. DESCRIPCIÓN DEL PROBLEMA Y TRABAJO');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...TINTA);
  const texto = [o.descripcion || s?.label || '', o.nota_cierre ? `Cierre: ${o.nota_cierre}` : ''].filter(Boolean).join('\n');
  const lineas = doc.splitTextToSize(texto, W - 2 * M - 8) as string[];
  const alto = 8 + lineas.length * 4.6;
  doc.setDrawColor(...BORDE); doc.roundedRect(M, y, W - 2 * M, alto, 1.5, 1.5, 'S');
  doc.text(lineas, M + 4, y + 6.5);
  y += alto + 9;

  y = seccion(doc, y, '3. REPUESTOS Y MATERIALES');
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: 'grid',
    head: [['Repuesto', 'Cant.', 'Unidad', 'Del inventario', 'A compra', 'Origen']],
    body: o.repuestos.length
      ? o.repuestos.map((r) => [r.nombre, fmtNum(r.cantidad), r.unidad, fmtNum(r.desde_inventario), fmtNum(r.a_comprar), r.origen === 'stock' ? 'Inventario' : r.origen === 'parcial' ? 'Mixto' : r.producto_id ? 'Compra' : 'Compra (pieza nueva)'])
      : [['Sin repuestos (solo mano de obra)', '', '', '', '', '']],
    styles: { fontSize: 8.5, cellPadding: 2.4, lineColor: BORDE, lineWidth: 0.25, textColor: TINTA },
    headStyles: { fillColor: NARANJA, textColor: [26, 14, 0], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'center', cellWidth: 14 }, 2: { cellWidth: 16 }, 3: { halign: 'center', cellWidth: 26 }, 4: { halign: 'center', cellWidth: 20 }, 5: { cellWidth: 32 } },
  });
  y = finalY(doc) + 6;

  doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(146, 64, 14);
  if (vinculos.salida) { doc.text(`Solicitud de salida de inventario: ${vinculos.salida.codigo} · ${vinculos.salida.estado.replace(/_/g, ' ')}`, M, y); y += 5; }
  if (vinculos.compra) { doc.text(`Solicitud de servicio (compra): ${vinculos.compra.codigo} · ${vinculos.compra.estado.replace(/_/g, ' ')}`, M, y); y += 5; }

  // 4. Registro fotográfico (las fotos de la orden, hasta 4, de dos en dos y sin deformar).
  const fotosOs = await fotosOrdenConUrl(o.id).catch(() => [] as { nombre: string; url: string }[]);
  const imgsOs = (await Promise.all(fotosOs.map((f) => urlADataUrl(f.url)))).filter((x): x is { data: string; tipo: 'JPEG' | 'PNG' } => !!x);
  if (imgsOs.length) {
    const colF = (W - 2 * M - 6) / 2;
    const altoF = 62;
    y += 4;
    if (y + 12 + altoF > H - 20) { doc.addPage(); y = 20; }
    y = seccion(doc, y, '4. REGISTRO FOTOGRÁFICO');
    for (let i = 0; i < imgsOs.length; i += 2) {
      if (y + altoF + 8 > H - 20) { doc.addPage(); y = 20; }
      [imgsOs[i], imgsOs[i + 1]].forEach((img, k) => {
        if (!img) return;
        const x = M + k * (colF + 6);
        doc.setDrawColor(...BORDE); doc.setLineWidth(0.25); doc.rect(x, y, colF, altoF);
        try {
          const p = doc.getImageProperties(img.data);
          const esc = Math.min((colF - 2) / p.width, (altoF - 2) / p.height);
          const w = p.width * esc; const h = p.height * esc;
          doc.addImage(img.data, img.tipo, x + (colF - w) / 2, y + (altoF - h) / 2, w, h, undefined, 'FAST');
        } catch { /* una foto que no se puede dibujar no tumba el PDF */ }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105);
        doc.text(`Foto ${i + k + 1}`, x + colF / 2, y + altoF + 4, { align: 'center' });
      });
      y += altoF + 9;
    }
  }

  y = Math.max(y + 18, H - 50);
  if (y > H - 30) { doc.addPage(); y = 60; }
  const fw = (W - 2 * M - 16) / 3;
  ['Elaborado por', 'Jefe de taller', 'Recibido conforme'].forEach((t, i) => {
    const x = M + i * (fw + 8);
    doc.setDrawColor(100, 116, 139); doc.line(x, y, x + fw, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(51, 65, 85);
    doc.text(t, x + fw / 2, y + 4.5, { align: 'center' });
  });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
  doc.text(`Creada por ${quienSync(o.actor_name, o.created_by) || '—'}`, M, y + 10);

  pies(doc, `${o.codigo} · ${e.equipo}`);
  previewPdf(doc, `${nombreArchivo(`${o.codigo} ${e.equipo}`)}.pdf`);
}

/** Un listado de los submódulos (órdenes, estados, lavados, repuestos) en PDF. */
export interface ListadoFlota {
  titulo: string;
  /** Filtros aplicados, en palabras («Estado: abiertas · Desde 01/10/2026»). */
  subtitulo: string;
  encabezados: string[];
  filas: (string | number | null)[][];
  /** Anchos relativos de las columnas (se reparten en el ancho útil). */
  anchos?: number[];
  archivo: string;
}

/** PDF apaisado con el membrete y el pie del sistema (logo, «Página X de Y»). */
export async function listadoFlotaPdf(l: ListadoFlota): Promise<void> {
  if (!l.filas.length) throw new Error('No hay filas que exportar con estos filtros.');
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  let y = await encabezado(doc, l.titulo, l.subtitulo, null);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
  doc.text(`${l.filas.length} registro(s) · generado ${new Date().toLocaleString('es-VE')}`, M, y);
  y += 4;
  const util = W - 2 * M;
  const total = (l.anchos ?? l.encabezados.map(() => 1)).reduce((a, b) => a + b, 0);
  const columnStyles: Record<number, { cellWidth: number }> = {};
  (l.anchos ?? []).forEach((a, i) => { columnStyles[i] = { cellWidth: (a / total) * util }; });
  autoTable(doc, {
    startY: y, margin: { left: M, right: M, bottom: 18 }, theme: 'grid',
    head: [l.encabezados],
    body: l.filas.map((f) => f.map((c) => (c == null ? '' : typeof c === 'number' ? fmtNum(c) : c))),
    styles: { fontSize: 7.8, cellPadding: 1.8, lineColor: BORDE, lineWidth: 0.25, textColor: TINTA, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: NARANJA, textColor: [26, 14, 0], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 246, 240] },
    columnStyles,
  });
  pies(doc, l.titulo.toLowerCase().replace(/^./, (c) => c.toUpperCase()));
  previewPdf(doc, `${nombreArchivo(l.archivo)}.pdf`);
}
