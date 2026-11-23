/* ============================================================
   Mineral Group Guayana · Proveedores · Descargar la lista en PDF y Excel

   Permite elegir qué datos salen (casillas de selección) y la orientación
   de la hoja (automática, vertical u horizontal).
   Sale la lista que se está viendo (con los filtros de la pantalla).
   Ambos formatos abren en vista previa.
   ============================================================ */
import type { Proveedor } from '@/shared/lib/types';
import { previewExcelArchivo, previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import type {
  CampoReporteProveedor,
  FilaReporteProveedor,
  ResumenReporteProveedor,
} from './proveedoresMoldeable';
import { numeroColumnaProveedor, obtenerMetricasFichaProveedor, textoColumnaProveedor } from './proveedoresMoldeable';

export type OrientacionHoja = 'auto' | 'vertical' | 'horizontal';

/**
 * Datos ya procesados por el motor moldeable (proveedoresMoldeable). Cuando se
 * pasa, el PDF/Excel sale agrupado por la dimensión elegida, con sección de
 * KPIs, en vez del listado plano por campos de `claves`.
 */
export interface DatosMoldeableProveedor {
  filas: FilaReporteProveedor[];
  columnas: CampoReporteProveedor[];
  resumen?: ResumenReporteProveedor;
  /** Nombre de la dimensión de agrupación («Por categoría»); vacío = detallado. */
  agrupacionEtiqueta?: string;
}

export interface OpcionesReporteProveedores {
  /** Cómo se filtró la lista («Activos · Categoría Ferretería»); vacío = sin filtro. */
  filtro?: string;
  /** ISO del momento en que se genera. Ahora, si no se pasa. */
  generadoEn?: string;
  /** Claves de los campos a incluir. Si no se pasa o está vacío, salen todos. */
  claves?: string[];
  /** Orientación forzada o automática según el peso de las columnas. */
  orientacion?: OrientacionHoja;
  /** Presentación del PDF moldeable: «fichas» (tarjetas) o «tabla». Por defecto, fichas. */
  formatoPresentacion?: 'fichas' | 'tabla';
  /** Reporte moldeable (agrupación + KPIs). Si viene, manda sobre `claves`. */
  moldeable?: DatosMoldeableProveedor;
}

export interface CampoProveedor {
  clave: string;
  etiqueta: string;
  /** Ancho relativo de la columna (Excel en caracteres; el PDF lo reparte). */
  ancho: number;
  valor: (p: Proveedor) => string;
}

const ORIGEN: Record<string, string> = { nacional: 'Nacional', internacional: 'Internacional' };
const txt = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/** Catálogo de campos disponibles para exportar, en el orden predeterminado. */
export const CAMPOS_PROVEEDOR: CampoProveedor[] = [
  { clave: 'rif', etiqueta: 'RIF', ancho: 16, valor: (p) => txt(p.rif) },
  { clave: 'razon_social', etiqueta: 'Razón social', ancho: 36, valor: (p) => txt(p.razon_social) },
  { clave: 'contacto', etiqueta: 'Contacto', ancho: 22, valor: (p) => txt(p.contacto) },
  { clave: 'telefono', etiqueta: 'Teléfono', ancho: 16, valor: (p) => txt(p.telefono) },
  { clave: 'email', etiqueta: 'Correo', ancho: 26, valor: (p) => txt(p.email) },
  { clave: 'direccion', etiqueta: 'Dirección', ancho: 32, valor: (p) => txt(p.direccion) },
  { clave: 'categorias', etiqueta: 'Categorías', ancho: 26, valor: (p) => (p.categorias ?? []).map(txt).filter(Boolean).join(', ') },
  { clave: 'origen', etiqueta: 'Origen', ancho: 14, valor: (p) => ORIGEN[p.origen] ?? txt(p.origen) },
  { clave: 'numero_administracion', etiqueta: 'N° administración', ancho: 18, valor: (p) => txt(p.numero_administracion) },
  { clave: 'estado', etiqueta: 'Estado', ancho: 11, valor: (p) => (p.estado === 'activo' ? 'Activo' : 'Inactivo') },
];

/** Campos marcados por defecto al abrir el diálogo por primera vez. */
export const CAMPOS_POR_DEFECTO = [
  'rif',
  'razon_social',
  'contacto',
  'telefono',
  'email',
  'categorias',
  'estado',
];

/** Retorna los campos elegidos en el orden del catálogo. Si claves está vacío/no definido, retorna todos. */
export function camposElegidos(claves?: string[]): CampoProveedor[] {
  if (!claves || !claves.length) return CAMPOS_PROVEEDOR;
  const set = new Set(claves);
  const seleccion = CAMPOS_PROVEEDOR.filter((c) => set.has(c.clave));
  return seleccion.length ? seleccion : CAMPOS_PROVEEDOR;
}

/** Calcula la orientación final (portrait o landscape). */
export function orientacionFinal(claves: string[], elegida: OrientacionHoja = 'auto'): 'portrait' | 'landscape' {
  if (elegida === 'vertical') return 'portrait';
  if (elegida === 'horizontal') return 'landscape';
  const campos = camposElegidos(claves);
  const anchoTotal = campos.reduce((a, c) => a + c.ancho, 0);
  return anchoTotal > 85 || campos.length > 5 ? 'landscape' : 'portrait';
}

/** Tamaño de fuente para que las columnas entren en el ancho útil del PDF (entre 6 y 9 pt). */
export function letraQueEntra(util: number, anchoTotal: number): number {
  if (anchoTotal <= 0) return 9;
  return Math.max(6, Math.min(9, Math.floor((util / anchoTotal) * 2 * 2) / 2));
}

/** dd/mm/aaaa hh:mm (hora de Venezuela) del momento de generación. */
export function momentoGeneracion(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

/** Una fila lista para escribir (texto plano; retrocompatibilidad con tests). */
export interface FilaProveedor {
  rif: string;
  razon: string;
  contacto: string;
  telefono: string;
  email: string;
  direccion: string;
  categorias: string;
  origen: string;
  numeroAdm: string;
  estado: string;
}

export function filasProveedores(lista: readonly Proveedor[]): FilaProveedor[] {
  return lista.map((p) => ({
    rif: txt(p.rif),
    razon: txt(p.razon_social),
    contacto: txt(p.contacto),
    telefono: txt(p.telefono),
    email: txt(p.email),
    direccion: txt(p.direccion),
    categorias: (p.categorias ?? []).map(txt).filter(Boolean).join(', '),
    origen: ORIGEN[p.origen] ?? txt(p.origen),
    numeroAdm: txt(p.numero_administracion),
    estado: p.estado === 'activo' ? 'Activo' : 'Inactivo',
  }));
}

/** Encabezados y filas basados en los campos elegidos, ordenados por razón social. */
export function tablaProveedores(lista: readonly Proveedor[], claves?: string[]): { encabezados: string[]; filas: string[][] } {
  const campos = camposElegidos(claves);
  const orden = [...lista].sort((a, b) =>
    (a.razon_social ?? '').localeCompare(b.razon_social ?? '', 'es', { sensitivity: 'base' })
  );
  return {
    encabezados: campos.map((c) => c.etiqueta),
    filas: orden.map((p) => campos.map((c) => c.valor(p))),
  };
}

/* Paleta PASTEL (la de «Compras por estado»). */
const PASTEL_PDF: Record<'titulo' | 'cabecera' | 'cabeceraTexto' | 'cebra', [number, number, number]> = {
  titulo: [192, 126, 70],
  cabecera: [246, 217, 184],
  cabeceraTexto: [92, 58, 28],
  cebra: [253, 248, 242],
};

export async function construirProveedoresPdf(
  lista: readonly Proveedor[],
  logo: string | null,
  op: OpcionesReporteProveedores = {},
): Promise<import('jspdf').jsPDF> {
  if (op.moldeable) return construirProveedoresPdfMoldeable(op.moldeable, logo, op);
  const [{ jsPDF }, { default: autoTable }, { dibujarLogoPdf }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const generado = momentoGeneracion(op.generadoEn ?? new Date().toISOString());
  const campos = camposElegidos(op.claves);
  const { encabezados, filas } = tablaProveedores(lista, op.claves);
  const orientation = orientacionFinal(op.claves ?? [], op.orientacion);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 36;
  let y = MARGIN;
  if (logo) dibujarLogoPdf(doc, logo, MARGIN, y, 44);

  const cx = W / 2 + (logo ? 28 : 0);
  doc.setTextColor(...PASTEL_PDF.titulo);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('PROVEEDORES', cx, y + 18, { align: 'center' });

  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(pdfSafe(`GOLDEN TOUCH 1127 C.A. · ${filas.length} proveedor(es) · Generado ${generado}`), cx, y + 32, { align: 'center' });
  if (op.filtro) doc.text(pdfSafe(`Filtro: ${op.filtro}`), cx, y + 44, { align: 'center' });
  y += op.filtro ? 62 : 54;

  const util = W - MARGIN * 2 - 24;
  const anchoTotal = campos.reduce((a, c) => a + c.ancho, 0);
  const letra = letraQueEntra(util, anchoTotal);

  const columnStyles: Record<number, { cellWidth: number; halign?: 'center' | 'left' }> = {
    0: { halign: 'center', cellWidth: 24 },
  };
  campos.forEach((c, idx) => {
    columnStyles[idx + 1] = {
      cellWidth: (util * c.ancho) / anchoTotal,
      halign: c.clave === 'estado' || c.clave === 'origen' ? 'center' : 'left',
    };
  });

  autoTable(doc, {
    startY: y,
    head: [['#', ...encabezados.map((e) => pdfSafe(e.toUpperCase()))]],
    body: filas.map((fila, i) => [String(i + 1), ...fila.map((val) => pdfSafe(val) || '—')]),
    styles: { fontSize: letra, cellPadding: letra < 7.5 ? 2.5 : 4, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: PASTEL_PDF.cabecera, textColor: PASTEL_PDF.cabeceraTexto, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: PASTEL_PDF.cebra },
    columnStyles,
    margin: MARGIN,
  });

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(225, 225, 225);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, H - 28, W - MARGIN, H - 28);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(pdfSafe(`PROVEEDORES · GOLDEN TOUCH 1127 C.A. · Generado ${generado}`), MARGIN, H - 16);
    doc.text(`Página ${i} de ${paginas}`, W - MARGIN, H - 16, { align: 'right' });
  }
  return doc;
}

export async function descargarProveedoresPdf(lista: readonly Proveedor[], op: OpcionesReporteProveedores = {}): Promise<void> {
  if (op.moldeable ? !op.moldeable.filas.length : !lista.length) {
    throw new Error('No hay proveedores en la lista (revisa los filtros).');
  }
  const { loadLogoPdfDataUrl } = await import('@/shared/lib/pdfLogo');
  const doc = await construirProveedoresPdf(lista, await loadLogoPdfDataUrl().catch(() => null), op);
  previewPdf(doc, `proveedores-${new Date().toISOString().slice(0, 10)}.pdf`);
}

const PASTEL_XLS = {
  titulo: 'FFC07E46',
  cabecera: 'FFF6D9B8',
  cabeceraTexto: 'FF5C3A1C',
  cebra: 'FFFDF8F2',
  borde: 'FFE0D3C2',
};

export async function construirProveedoresExcel(
  lista: readonly Proveedor[],
  op: OpcionesReporteProveedores = {},
): Promise<ArrayBuffer> {
  if (op.moldeable) return construirProveedoresExcelMoldeable(op.moldeable, op);
  const [{ default: ExcelJS }, { identidadEmpresa }] = await Promise.all([
    import('exceljs'),
    import('@/shared/lib/empresa'),
  ]);
  const emp = identidadEmpresa('GT');
  const generado = momentoGeneracion(op.generadoEn ?? new Date().toISOString());
  const campos = camposElegidos(op.claves);
  const { encabezados, filas } = tablaProveedores(lista, op.claves);
  const COLS = Math.max(2, campos.length + 1);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Proveedores', {
    pageSetup: {
      orientation: orientacionFinal(op.claves ?? [], op.orientacion),
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  ws.columns = [
    { width: 6 },
    ...campos.map((c) => ({ width: Math.max(c.ancho, c.etiqueta.length) + 6 })),
  ];
  const borde = { style: 'thin' as const, color: { argb: PASTEL_XLS.borde } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  for (const fila of [1, 2, 3]) ws.mergeCells(fila, 1, fila, COLS);
  ws.getRow(1).height = 26;
  const t = ws.getCell(1, 1);
  t.value = `PROVEEDORES · ${emp.nombre}`;
  t.font = { name: 'Arial', size: 14, bold: true, color: { argb: PASTEL_XLS.titulo } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  const sub = (fila: number, texto: string) => {
    const c = ws.getCell(fila, 1);
    c.value = texto;
    c.font = { name: 'Arial', size: 10, color: { argb: 'FF5C6673' } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  };
  sub(2, `${filas.length} proveedor(es) · Generado ${generado}`);
  sub(3, op.filtro ? `Filtro: ${op.filtro}` : 'Sin filtro: todos los proveedores');

  const cab = ws.getRow(4);
  cab.values = ['#', ...encabezados.map((e) => e.toUpperCase())];
  cab.height = 24;
  cab.eachCell((c) => {
    c.font = { name: 'Arial', size: 10.5, bold: true, color: { argb: PASTEL_XLS.cabeceraTexto } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PASTEL_XLS.cabecera } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = bordes;
  });

  filas.forEach((fila, i) => {
    const r = ws.addRow([i + 1, ...fila]);
    r.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { name: 'Arial', size: 10, bold: col === 3 };
      c.border = bordes;
      c.alignment = {
        vertical: 'middle',
        wrapText: true,
        horizontal: col === 1 || (campos[col - 2]?.clave === 'estado') ? 'center' : 'left',
      };
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PASTEL_XLS.cebra } };
    });
  });
  if (filas.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + filas.length, column: COLS } };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function descargarProveedoresExcel(lista: readonly Proveedor[], op: OpcionesReporteProveedores = {}): Promise<void> {
  if (op.moldeable ? !op.moldeable.filas.length : !lista.length) {
    throw new Error('No hay proveedores en la lista (revisa los filtros).');
  }
  const bytes = await construirProveedoresExcel(lista, op);
  await previewExcelArchivo(bytes, `proveedores-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ============================================================
   Reporte moldeable (agrupación + KPIs), calcado de Tesorería.
   ============================================================ */

/** Líneas de KPIs del encabezado del reporte moldeable (texto plano). */
function lineasResumenProveedor(r: ResumenReporteProveedor): string[] {
  const l: string[] = [];
  l.push(`Total: ${r.totalProveedores} proveedor(es) · Activos: ${r.activos} (${r.pctActivos.toFixed(1)}%) · Inactivos: ${r.inactivos}`);
  l.push(`Nacionales: ${r.nacionales} (${r.pctNacionales.toFixed(1)}%) · Internacionales: ${r.internacionales}`);
  if (r.topCategorias.length) {
    l.push('Top categorías: ' + r.topCategorias.map((c) => `${c.nombre} (${c.valor})`).join(' · '));
  }
  if (r.conCompras) {
    l.push(`Histórico de compras: ${r.totalOrdenes} orden(es) · $ ${r.totalMontoUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    if (r.topProveedoresMonto.length) {
      l.push('Top proveedores por monto: ' + r.topProveedoresMonto.map((p) => `${p.nombre} ($ ${p.valor.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`).join(' · '));
    }
  }
  return l;
}

/* Tintas de la ficha (tarjeta) del PDF moldeable. */
const TINTA_FICHA: [number, number, number] = [30, 41, 59];
const BORDE_FICHA: [number, number, number] = [225, 225, 225];

/**
 * Dibuja las filas del reporte como FICHAS (tarjetas), calcando el patrón de
 * Inventario/Tesorería: recuadro con acento lateral por estado, badge, título
 * (razón social), subtítulo (RIF · categorías), divisoria y hasta 4 métricas.
 */
function dibujarFichasProveedor(
  doc: import('jspdf').jsPDF,
  filas: FilaReporteProveedor[],
  columnas: CampoReporteProveedor[],
  agrupacionEtiqueta: string | undefined,
  orientation: 'portrait' | 'landscape',
  W: number,
  H: number,
  MARGIN: number,
  yInicial: number,
): void {
  const clavesColumnas = columnas.map((c) => c.clave);
  const UW = W - MARGIN * 2;
  const cols = orientation === 'landscape' ? 2 : 1;
  const cardGap = 10;
  const cardW = (UW - (cols - 1) * cardGap) / cols;
  const maxMetricas = Math.max(
    ...filas.map((f) => obtenerMetricasFichaProveedor(f, clavesColumnas).length),
    1,
  );
  const colsPorFila = orientation === 'landscape'
    ? (maxMetricas <= 3 ? Math.max(1, maxMetricas) : maxMetricas === 4 ? 4 : 3)
    : (maxMetricas <= 4 ? Math.max(1, maxMetricas) : 4);
  const numFilasMetricas = Math.ceil(maxMetricas / colsPorFila);
  const altoHeader = 32;
  const altoFilaMetrica = 25;
  const cardH = altoHeader + numFilasMetricas * altoFilaMetrica + 8;
  let y = yInicial;

  for (let i = 0; i < filas.length; i += cols) {
    if (y + cardH > H - 36) { doc.addPage(); y = 36; }
    for (let c = 0; c < cols; c++) {
      const f = filas[i + c];
      if (!f) break;
      const cx = MARGIN + c * (cardW + cardGap);
      const cy = y;
      // Acento lateral: rojo si está inactivo, ámbar si activo (igual que la vista previa).
      const acento: [number, number, number] = f.estado === 'Inactivo' ? [239, 68, 68] : [217, 119, 6];

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...BORDE_FICHA);
      doc.setLineWidth(0.6);
      doc.roundedRect(cx, cy, cardW, cardH, 4, 4, 'FD');
      doc.setFillColor(...acento);
      doc.rect(cx, cy + 1, 3.5, cardH - 2, 'F');

      // Badge: estado y/o % del total arriba; origen (o N° de proveedores del grupo) debajo.
      const pctTxt = f.pct_del_total != null ? `${f.pct_del_total.toFixed(1)}%` : '';
      const txtBadge = pdfSafe([f.estado, pctTxt].filter(Boolean).join(' · ') || (f.origen || 'Proveedor'));
      const txtSubBadge = pdfSafe(
        f.origen || (f.total_proveedores != null && f.total_proveedores > 1 ? `${f.total_proveedores} proveedores` : ''),
      );
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      const w1 = doc.getTextWidth(txtBadge);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      const w2 = doc.getTextWidth(txtSubBadge);
      const badgeW = Math.min(cardW * 0.44, Math.max(70, Math.max(w1, w2) + 12));
      const badgeH = txtSubBadge ? 15 : 11;
      const bx = cx + cardW - badgeW - 6;
      const by = cy + 4;

      const [ar, ag, ab] = acento;
      doc.setFillColor(Math.min(255, ar + 180), Math.min(255, ag + 70), Math.min(255, ab + 60));
      doc.roundedRect(bx, by, badgeW, badgeH, 3, 3, 'F');

      let fontB = 6.8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontB);
      doc.setTextColor(...acento);
      while (doc.getTextWidth(txtBadge) > badgeW - 6 && fontB > 5.4) { fontB -= 0.2; doc.setFontSize(fontB); }
      doc.text(txtBadge, bx + badgeW / 2, by + (txtSubBadge ? 5.8 : 7.2), { align: 'center' });

      if (txtSubBadge) {
        let fontS = 5.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fontS);
        doc.setTextColor(100, 116, 139);
        while (doc.getTextWidth(txtSubBadge) > badgeW - 6 && fontS > 4.4) { fontS -= 0.2; doc.setFontSize(fontS); }
        doc.text(txtSubBadge, bx + badgeW / 2, by + 11.5, { align: 'center' });
      }

      // Título: razón social (o la etiqueta del grupo).
      const tituloBase = f.razon_social || f.rif || 'Sin nombre';
      const maxTitleW = Math.max(60, (bx - 8) - (cx + 10));
      let titulo = pdfSafe(tituloBase);
      let titleFont = 9.5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(titleFont);
      while (doc.getTextWidth(titulo) > maxTitleW && titleFont > 7.4) { titleFont -= 0.3; doc.setFontSize(titleFont); }
      if (doc.getTextWidth(titulo) > maxTitleW) {
        while (titulo.length > 3 && doc.getTextWidth(titulo + '…') > maxTitleW) titulo = titulo.slice(0, -1);
        titulo += '…';
      }
      doc.setTextColor(...TINTA_FICHA);
      doc.text(titulo, cx + 10, cy + 13);

      // Subtítulo: RIF · categorías · (dimensión, si es un grupo sin RIF).
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(100, 116, 139);
      const partes = [
        f.rif && f.rif !== tituloBase ? f.rif : null,
        f.categorias && f.categorias !== tituloBase ? f.categorias : null,
        !f.rif && agrupacionEtiqueta ? agrupacionEtiqueta : null,
      ].filter(Boolean) as string[];
      let metaTxt = pdfSafe(partes.join(' · ') || 'Proveedor');
      const maxMetaW = cardW - 20;
      if (doc.getTextWidth(metaTxt) > maxMetaW) {
        while (metaTxt.length > 3 && doc.getTextWidth(metaTxt + '…') > maxMetaW) metaTxt = metaTxt.slice(0, -1);
        metaTxt += '…';
      }
      doc.text(metaTxt, cx + 10, cy + 24);

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(cx + 8, cy + 29, cx + cardW - 8, cy + 29);

      // Métricas dinámicas del motor, según las columnas marcadas.
      const metricas = obtenerMetricasFichaProveedor(f, clavesColumnas);
      const innerW = cardW - 16;
      const myBase = cy + 38;
      const colW = innerW / colsPorFila;
      const maxTextW = colW - 6;
      metricas.forEach((m, idx) => {
        const filaIdx = Math.floor(idx / colsPorFila);
        const colEnFila = idx % colsPorFila;
        const mx = cx + 8 + colW * colEnFila;
        const my = myBase + filaIdx * altoFilaMetrica;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.8);
        doc.setTextColor(71, 85, 105);
        let lblTxt = pdfSafe(m.etiqueta);
        if (doc.getTextWidth(lblTxt) > maxTextW) {
          while (lblTxt.length > 3 && doc.getTextWidth(lblTxt + '…') > maxTextW) lblTxt = lblTxt.slice(0, -1);
          lblTxt += '…';
        }
        doc.text(lblTxt, mx, my);
        doc.setFontSize(8.2);
        doc.setTextColor(...m.colorRgb);
        let valTxt = pdfSafe(m.valor);
        while (doc.getTextWidth(valTxt) > maxTextW && doc.getFontSize() > 6.0) doc.setFontSize(doc.getFontSize() - 0.3);
        if (doc.getTextWidth(valTxt) > maxTextW) {
          while (valTxt.length > 3 && doc.getTextWidth(valTxt + '…') > maxTextW) valTxt = valTxt.slice(0, -1);
          valTxt += '…';
        }
        doc.text(valTxt, mx, my + 8.5);
        if (m.sub) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(5.4);
          doc.setTextColor(148, 163, 184);
          let subTxt = pdfSafe(m.sub);
          if (doc.getTextWidth(subTxt) > maxTextW) {
            while (subTxt.length > 3 && doc.getTextWidth(subTxt + '…') > maxTextW) subTxt = subTxt.slice(0, -1);
            subTxt += '…';
          }
          doc.text(subTxt, mx, my + 14.5);
        }
      });
    }
    y += cardH + cardGap;
  }
}

async function construirProveedoresPdfMoldeable(
  datos: DatosMoldeableProveedor,
  logo: string | null,
  op: OpcionesReporteProveedores,
): Promise<import('jspdf').jsPDF> {
  const [{ jsPDF }, { default: autoTable }, { dibujarLogoPdf }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const generado = momentoGeneracion(op.generadoEn ?? new Date().toISOString());
  const { filas, columnas, resumen, agrupacionEtiqueta } = datos;
  // Presentación: «fichas» (tarjetas) por defecto; «tabla» mantiene el autoTable.
  const esFichas = op.formatoPresentacion !== 'tabla';
  const anchoTotal = columnas.reduce((a, c) => a + c.anchoPdf, 0);
  const orientation: 'portrait' | 'landscape' =
    op.orientacion === 'vertical' ? 'portrait'
      : op.orientacion === 'horizontal' ? 'landscape'
        : esFichas ? 'landscape'
          : anchoTotal > 85 || columnas.length > 5 ? 'landscape' : 'portrait';

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 36;
  let y = MARGIN;
  if (logo) dibujarLogoPdf(doc, logo, MARGIN, y, 44);

  const cx = W / 2 + (logo ? 28 : 0);
  doc.setTextColor(...PASTEL_PDF.titulo);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('PROVEEDORES', cx, y + 18, { align: 'center' });

  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const sub = `GOLDEN TOUCH 1127 C.A. · ${filas.length} fila(s)${agrupacionEtiqueta ? ` · ${agrupacionEtiqueta}` : ''} · Generado ${generado}`;
  doc.text(pdfSafe(sub), cx, y + 32, { align: 'center' });
  if (op.filtro) doc.text(pdfSafe(`Filtro: ${op.filtro}`), cx, y + 44, { align: 'center' });
  y += op.filtro ? 60 : 50;

  // Sección de KPIs (resumen) en un recuadro suave.
  if (resumen) {
    const lineas = lineasResumenProveedor(resumen);
    const alto = 14 + lineas.length * 11;
    doc.setFillColor(...PASTEL_PDF.cebra);
    doc.setDrawColor(...PASTEL_PDF.cabecera);
    doc.setLineWidth(0.5);
    doc.roundedRect(MARGIN, y, W - MARGIN * 2, alto, 4, 4, 'FD');
    doc.setTextColor(...PASTEL_PDF.cabeceraTexto);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('RESUMEN', MARGIN + 8, y + 12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 90, 90);
    lineas.forEach((ln, i) => doc.text(pdfSafe(ln), MARGIN + 8, y + 24 + i * 11, { maxWidth: W - MARGIN * 2 - 16 }));
    y += alto + 10;
  }

  if (esFichas) {
    dibujarFichasProveedor(doc, filas, columnas, agrupacionEtiqueta, orientation, W, H, MARGIN, y);
  } else {
    const util = W - MARGIN * 2 - 24;
    const letra = letraQueEntra(util, anchoTotal);
    const columnStyles: Record<number, { cellWidth: number; halign?: 'center' | 'left' | 'right' }> = {
      0: { halign: 'center', cellWidth: 24 },
    };
    columnas.forEach((c, idx) => {
      columnStyles[idx + 1] = { cellWidth: (util * c.anchoPdf) / anchoTotal, halign: c.alineacion };
    });

    autoTable(doc, {
      startY: y,
      head: [['#', ...columnas.map((c) => pdfSafe(c.etiqueta.toUpperCase()))]],
      body: filas.map((f, i) => [String(i + 1), ...columnas.map((c) => pdfSafe(textoColumnaProveedor(f, c.clave)) || '—')]),
      styles: { fontSize: letra, cellPadding: letra < 7.5 ? 2.5 : 4, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: PASTEL_PDF.cabecera, textColor: PASTEL_PDF.cabeceraTexto, fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: PASTEL_PDF.cebra },
      columnStyles,
      margin: MARGIN,
    });
  }

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(225, 225, 225);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, H - 28, W - MARGIN, H - 28);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(pdfSafe(`PROVEEDORES · GOLDEN TOUCH 1127 C.A. · Generado ${generado}`), MARGIN, H - 16);
    doc.text(`Página ${i} de ${paginas}`, W - MARGIN, H - 16, { align: 'right' });
  }
  return doc;
}

async function construirProveedoresExcelMoldeable(
  datos: DatosMoldeableProveedor,
  op: OpcionesReporteProveedores,
): Promise<ArrayBuffer> {
  const [{ default: ExcelJS }, { identidadEmpresa }] = await Promise.all([
    import('exceljs'),
    import('@/shared/lib/empresa'),
  ]);
  const emp = identidadEmpresa('GT');
  const generado = momentoGeneracion(op.generadoEn ?? new Date().toISOString());
  const { filas, columnas, resumen, agrupacionEtiqueta } = datos;
  const COLS = Math.max(2, columnas.length + 1);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Proveedores', {
    pageSetup: {
      orientation: op.orientacion === 'vertical' ? 'portrait' : op.orientacion === 'horizontal' ? 'landscape' : (columnas.length > 5 ? 'landscape' : 'portrait'),
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    },
  });
  ws.columns = [
    { width: 6 },
    ...columnas.map((c) => ({ width: Math.max(c.anchoExcel, c.etiqueta.length) + 4 })),
  ];
  const borde = { style: 'thin' as const, color: { argb: PASTEL_XLS.borde } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  for (const fila of [1, 2, 3]) ws.mergeCells(fila, 1, fila, COLS);
  ws.getRow(1).height = 26;
  const t = ws.getCell(1, 1);
  t.value = `PROVEEDORES · ${emp.nombre}`;
  t.font = { name: 'Arial', size: 14, bold: true, color: { argb: PASTEL_XLS.titulo } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  const subCell = (fila: number, texto: string) => {
    const c = ws.getCell(fila, 1);
    c.value = texto;
    c.font = { name: 'Arial', size: 10, color: { argb: 'FF5C6673' } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  };
  subCell(2, `${filas.length} fila(s)${agrupacionEtiqueta ? ` · ${agrupacionEtiqueta}` : ''} · Generado ${generado}`);
  subCell(3, op.filtro ? `Filtro: ${op.filtro}` : 'Sin filtro: todos los proveedores');

  let fila = 4;
  // Sección de KPIs (resumen).
  if (resumen) {
    for (const linea of lineasResumenProveedor(resumen)) {
      ws.mergeCells(fila, 1, fila, COLS);
      const c = ws.getCell(fila, 1);
      c.value = linea;
      c.font = { name: 'Arial', size: 9.5, color: { argb: PASTEL_XLS.cabeceraTexto } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PASTEL_XLS.cebra } };
      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      fila += 1;
    }
    fila += 1; // espacio
  }

  const filaCab = fila;
  const cab = ws.getRow(filaCab);
  cab.values = ['#', ...columnas.map((c) => c.etiqueta.toUpperCase())];
  cab.height = 24;
  cab.eachCell((c) => {
    c.font = { name: 'Arial', size: 10.5, bold: true, color: { argb: PASTEL_XLS.cabeceraTexto } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PASTEL_XLS.cabecera } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = bordes;
  });
  ws.views = [{ state: 'frozen', ySplit: filaCab }];

  filas.forEach((f, i) => {
    const r = ws.addRow([
      i + 1,
      ...columnas.map((c) => {
        const n = numeroColumnaProveedor(f, c.clave);
        if ((c.formato === 'numero' || c.formato === 'moneda') && n != null) return n;
        return textoColumnaProveedor(f, c.clave);
      }),
    ]);
    r.eachCell({ includeEmpty: true }, (c, col) => {
      const def = columnas[col - 2];
      c.font = { name: 'Arial', size: 10, bold: def?.clave === 'razon_social' };
      c.border = bordes;
      if (def?.formato === 'moneda' && typeof c.value === 'number') c.numFmt = '#,##0.00';
      c.alignment = {
        vertical: 'middle', wrapText: true,
        horizontal: col === 1 ? 'center' : (def?.alineacion ?? 'left'),
      };
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PASTEL_XLS.cebra } };
    });
  });
  if (filas.length) ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab + filas.length, column: COLS } };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/* ============================================================
   CSV (con blindaje anti «fórmula»), calcado de Tesorería.
   ============================================================ */

export interface OpcionesCsvProveedor {
  filtro?: string;
  generadoEn?: string;
}

export function descargarProveedoresCsv(
  filas: FilaReporteProveedor[],
  columnas: CampoReporteProveedor[],
  _op: OpcionesCsvProveedor = {},
): void {
  if (!columnas.length) throw new Error('Selecciona al menos una columna.');
  if (!filas.length) throw new Error('No hay proveedores en la lista (revisa los filtros).');

  const escapar = (val: unknown) => {
    let s = String(val ?? '');
    // Anti «CSV formula injection»: si el texto empieza por un carácter que
    // Excel/Sheets interpretarían como fórmula (= + - @ o tab/retorno), se le
    // antepone una comilla simple para que quede como TEXTO. La razón social,
    // el contacto, la dirección, etc. son texto libre que pudo escribir cualquiera.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return (s.includes(';') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lineas: string[] = [];
  lineas.push(columnas.map((c) => escapar(c.etiqueta)).join(';'));
  for (const f of filas) {
    const vals = columnas.map((c) => {
      if (c.formato === 'numero' || c.formato === 'moneda' || c.formato === 'porcentaje') {
        const n = numeroColumnaProveedor(f, c.clave);
        return n == null ? '' : String(n).replace('.', ','); // coma decimal para Excel en español
      }
      return escapar(textoColumnaProveedor(f, c.clave));
    });
    lineas.push(vals.join(';'));
  }

  const csvContent = '﻿' + lineas.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `proveedores-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
