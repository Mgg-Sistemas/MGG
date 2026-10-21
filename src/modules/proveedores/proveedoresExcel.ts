/* ============================================================
   MGG · Proveedores · Excel · 21-10-2026
   Una hoja «Proveedores» con título, filtros aplicados, fecha y hora, y una fila por proveedor
   (RIF, razón social, contacto, teléfonos, email, dirección, actividad, categorías, origen,
   estado). Estilos del sistema. Se MUESTRA en vista previa: nada se descarga solo.
   ============================================================ */
import { previewWorkbook } from '@/shared/lib/reportPreview';
import { ENCABEZADO, SUBTITULO, TITULO, type Celda, type XlsxLike } from '@/modules/pedidos/reporteComprasExcel';
import { fechaReporteTexto } from '@/modules/pedidos/comprasReporteMensaje';
import { resumenProveedores, type FilaProveedor } from './proveedoresReporte';

const COLUMNAS: { titulo: string; ancho: number; valor: (f: FilaProveedor) => string }[] = [
  { titulo: 'RIF', ancho: 16, valor: (f) => f.rif },
  { titulo: 'RAZÓN SOCIAL', ancho: 38, valor: (f) => f.razonSocial },
  { titulo: 'CONTACTO', ancho: 24, valor: (f) => f.contacto },
  { titulo: 'TELÉFONO', ancho: 16, valor: (f) => f.telefono },
  { titulo: 'TELÉFONO ADMINISTRACIÓN', ancho: 18, valor: (f) => f.telefonoAdmin },
  { titulo: 'EMAIL', ancho: 30, valor: (f) => f.email },
  { titulo: 'DIRECCIÓN', ancho: 40, valor: (f) => f.direccion },
  { titulo: 'ACTIVIDAD ECONÓMICA', ancho: 40, valor: (f) => f.actividad },
  { titulo: 'CATEGORÍAS', ancho: 30, valor: (f) => f.categorias },
  { titulo: 'ORIGEN', ancho: 14, valor: (f) => f.origen },
  { titulo: 'ESTADO', ancho: 11, valor: (f) => f.estado },
];

async function construirLibro(filas: FilaProveedor[], filtros: string, impresoIso: string): Promise<{ XLSX: XlsxLike; wb: unknown; nombre: string }> {
  const XLSX = (await import('xlsx-js-style')) as unknown as XlsxLike;
  const aoa: unknown[][] = [
    ['PROVEEDORES · MGG'],
    [`Filtros: ${filtros}`],
    [`${resumenProveedores(filas)} · Impreso: ${fechaReporteTexto(impresoIso)}`],
    [],
    COLUMNAS.map((c) => c.titulo),
    ...filas.map((f) => COLUMNAS.map((c) => c.valor(f))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const w = ws as Record<string, unknown>;
  const cell = (row: number, col: number) => (ws as Record<string, Celda>)[XLSX.utils.encode_cell({ r: row, c: col })];
  const ultima = COLUMNAS.length - 1;
  w['!cols'] = COLUMNAS.map((c) => ({ wch: c.ancho }));
  w['!merges'] = [0, 1, 2].map((row) => ({ s: { r: row, c: 0 }, e: { r: row, c: ultima } }));
  w['!freeze'] = { xSplit: 0, ySplit: 5 };
  const t = cell(0, 0); if (t) t.s = TITULO;
  for (const row of [1, 2]) { const c = cell(row, 0); if (c) c.s = SUBTITULO; }
  for (let col = 0; col <= ultima; col++) { const c = cell(4, col); if (c) c.s = ENCABEZADO; }
  const cuerpo = { font: { name: 'Arial', sz: 10 }, alignment: { vertical: 'top', wrapText: true } };
  for (let row = 5; row < aoa.length; row++) {
    for (let col = 0; col <= ultima; col++) { const c = cell(row, col); if (c) c.s = cuerpo; }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
  return { XLSX, wb, nombre: 'proveedores-mgg.xlsx' };
}

/** 📊 Muestra el Excel en vista previa (con su botón de descarga). */
export async function exportarProveedoresExcel(filas: FilaProveedor[], filtros: string, impresoIso: string = new Date().toISOString()): Promise<void> {
  const { XLSX, wb, nombre } = await construirLibro(filas, filtros, impresoIso);
  previewWorkbook(XLSX, wb, nombre);
}
