/* ============================================================
   MGG · Proveedores · Excel · 21-10-2026
   Una hoja «Proveedores» con título, filtros aplicados, fecha y hora,
   y las columnas escogidas por el usuario.
   Estilos del sistema. Se MUESTRA en vista previa: nada se descarga solo.
   ============================================================ */
import { previewWorkbook } from '@/shared/lib/reportPreview';
import { ENCABEZADO, SUBTITULO, TITULO, type Celda, type XlsxLike } from '@/modules/pedidos/reporteComprasExcel';
import { fechaReporteTexto } from '@/modules/pedidos/comprasReporteMensaje';
import type { Proveedor } from '@/shared/lib/types';
import type { ActividadEconomica } from './ciiu';
import { type FilaProveedor } from './proveedoresReporte';
import { camposElegidosProveedores, CAMPOS_POR_DEFECTO, tablaExportProveedores } from './exportarProveedores';

export interface OpcionesExcelProveedores {
  keys?: string[];
  actividades?: ActividadEconomica[];
  impresoIso?: string;
}

async function construirLibro(
  datos: Proveedor[] | FilaProveedor[],
  filtros: string,
  opts: OpcionesExcelProveedores,
): Promise<{ XLSX: XlsxLike; wb: unknown; nombre: string }> {
  const impresoIso = opts.impresoIso ?? new Date().toISOString();
  const keys = opts.keys && opts.keys.length ? opts.keys : CAMPOS_POR_DEFECTO;
  const XLSX = (await import('xlsx-js-style')) as unknown as XlsxLike;

  const esLegacy = datos.length > 0 && 'razonSocial' in (datos[0] as object);

  let head: string[];
  let filas: string[][];
  let anchos: number[];

  if (esLegacy) {
    const filasLegacy = datos as FilaProveedor[];
    head = ['RIF', 'RAZÓN SOCIAL', 'CONTACTO', 'TELÉFONO', 'TELÉFONO ADMINISTRACIÓN', 'EMAIL', 'DIRECCIÓN', 'CATEGORÍAS', 'ORIGEN', 'ESTADO'];
    anchos = [16, 38, 24, 16, 18, 30, 40, 30, 14, 11];
    filas = filasLegacy.map((f) => [
      f.rif,
      f.razonSocial,
      f.contacto,
      f.telefono,
      f.telefonoAdmin,
      f.email,
      f.direccion,
      f.categorias,
      f.origen,
      f.estado,
    ]);
  } else {
    const provs = datos as Proveedor[];
    const campos = camposElegidosProveedores(keys);
    const res = tablaExportProveedores(provs, keys);
    head = res.head;
    filas = res.filas;
    anchos = [6, ...campos.map((c) => c.ancho)];
  }

  const totalActivos = esLegacy
    ? (datos as FilaProveedor[]).filter((x) => x.estado.toLowerCase().includes('activo')).length
    : (datos as Proveedor[]).filter((p) => p.estado === 'activo').length;
  const textoResumen = `${datos.length} proveedor(es) · ${totalActivos} activo(s) · ${datos.length - totalActivos} inactivo(s)`;

  const aoa: unknown[][] = [
    ['PROVEEDORES · MGG'],
    [`Filtros: ${filtros}`],
    [`${textoResumen} · Impreso: ${fechaReporteTexto(impresoIso)}`],
    [],
    head,
    ...filas,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const w = ws as Record<string, unknown>;
  const cell = (row: number, col: number) => (ws as Record<string, Celda>)[XLSX.utils.encode_cell({ r: row, c: col })];
  const ultima = head.length - 1;

  w['!cols'] = anchos.map((wch) => ({ wch }));
  w['!merges'] = [0, 1, 2].map((row) => ({ s: { r: row, c: 0 }, e: { r: row, c: ultima } }));
  w['!freeze'] = { xSplit: 0, ySplit: 5 };

  const t = cell(0, 0); if (t) t.s = TITULO;
  for (const row of [1, 2]) { const c = cell(row, 0); if (c) c.s = SUBTITULO; }
  for (let col = 0; col <= ultima; col++) { const c = cell(4, col); if (c) c.s = ENCABEZADO; }

  const cuerpo = { font: { name: 'Arial', sz: 10 }, alignment: { vertical: 'top', wrapText: true } };
  for (let row = 5; row < aoa.length; row++) {
    for (let col = 0; col <= ultima; col++) {
      const c = cell(row, col);
      if (c) c.s = cuerpo;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
  return { XLSX, wb, nombre: 'proveedores-mgg.xlsx' };
}

/** 📊 Muestra el Excel en vista previa (con su botón de descarga). */
export async function exportarProveedoresExcel(
  datos: Proveedor[] | FilaProveedor[],
  filtros: string,
  opcionesOImpreso: OpcionesExcelProveedores | string = {},
): Promise<void> {
  const opts: OpcionesExcelProveedores =
    typeof opcionesOImpreso === 'string'
      ? { impresoIso: opcionesOImpreso }
      : opcionesOImpreso;
  const { XLSX, wb, nombre } = await construirLibro(datos, filtros, opts);
  previewWorkbook(XLSX, wb, nombre);
}
