/* ============================================================
   Mineral Group Guayana · Proveedores · Motor del Reporte Moldeable
   (03/11/2026)

   Motor de datos PURO y SÍNCRONO para el directorio flexible de proveedores,
   calcado del de Tesorería (reporteTesoreriaMoldeable.ts). Normaliza cada
   proveedor en una fila, lo agrupa por la dimensión elegida (categoría,
   origen, estado o actividad económica) y arma los KPIs del encabezado.

   REGLA DE ORO: aquí NO se lee de Supabase. Las funciones reciben los datos
   YA leídos por la capa de repositorios/modal:
     · la lista de proveedores,
     · el catálogo de actividades económicas (para resolver el código CIIU),
     · y, si se activó el ámbito «histórico de compras», un mapa con las
       órdenes de cada proveedor (que el modal trae con getOrdenesByProveedor).
   Así todo el cálculo es determinista y testeable con fixtures.
   ============================================================ */

import type { Orden, Proveedor } from '@/shared/lib/types';
import type { ActividadEconomica } from './actividadesEconomicas';
import { textoActividad } from './actividadesEconomicas';

/* ───────────── Tipos de configuración ───────────── */

/** Dimensión principal de agrupación de las filas. */
export type ModoAgrupacionProveedor = 'categoria' | 'origen' | 'estado' | 'actividad' | 'detallado';

/** Criterio de orden de las filas del reporte. */
export type OrdenProveedor = 'razon' | 'monto' | 'ordenes' | 'cantidad';

const ORIGEN_LABEL: Record<string, string> = { nacional: 'Nacional', internacional: 'Internacional' };
const txt = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/* ───────────── Histórico de compras (cruce con órdenes) ───────────── */

/** Resumen de compras de un proveedor: cuántas órdenes efectivas y su monto en $. */
export interface ResumenCompras {
  ordenes: number;
  montoUsd: number;
}

/**
 * Estados de orden que NO cuentan como compra real (nunca se concretaron),
 * por lo que no suman ni al conteo ni al monto del histórico.
 */
export const ESTADOS_ORDEN_NO_EFECTIVOS: ReadonlySet<string> = new Set([
  'rechazada',
  'cancelada',
  'desistida_proveedor',
  'reasignada',
]);

/** Redondeo a 2 decimales. */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Monto en $ de una orden para el histórico. El modelo valoriza en dólares
 * (`total` en USD salvo `total_moneda`); las órdenes cotizadas en Bs no se
 * suman al monto en $ (no hay tasa en el motor puro), pero sí se cuentan.
 */
function montoUsdDeOrden(o: Orden): number {
  const moneda = (o.total_moneda ?? 'USD').toUpperCase();
  if (moneda === 'BS') return 0;
  return Number(o.total) || 0;
}

/**
 * A partir de las órdenes de cada proveedor (ya leídas), calcula su resumen de
 * compras: órdenes efectivas y monto en $. PURO: no toca Supabase.
 */
export function calcularComprasPorProveedor(
  ordenesPorProveedor: Map<string, Orden[]>,
): Map<string, ResumenCompras> {
  const out = new Map<string, ResumenCompras>();
  for (const [proveedorId, ordenes] of ordenesPorProveedor.entries()) {
    let cuenta = 0;
    let monto = 0;
    for (const o of ordenes ?? []) {
      if (ESTADOS_ORDEN_NO_EFECTIVOS.has(String(o.estado))) continue;
      cuenta += 1;
      monto += montoUsdDeOrden(o);
    }
    out.set(proveedorId, { ordenes: cuenta, montoUsd: round2(monto) });
  }
  return out;
}

/* ───────────── Fila normalizada ───────────── */

export interface FilaReporteProveedor {
  id: string;
  rif: string;
  razon_social: string;
  contacto: string;
  telefono: string;
  email: string;
  direccion: string;
  categorias: string;          // categorías unidas con coma
  categoriasLista: string[];
  origen: string;              // Nacional / Internacional
  estado: string;              // Activo / Inactivo
  actividad: string;           // «5110 · Comercio…» o «—»
  numero_administracion: string;
  // Histórico de compras (solo si el ámbito está activo; si no, null)
  num_ordenes: number | null;
  monto_comprado: number | null;  // en $ USD

  // Métricas cuando la fila representa un grupo
  total_proveedores?: number;
  pct_del_total?: number | null;   // % respecto al total del directorio
}

/* ───────────── Catálogo de columnas ───────────── */

export interface CampoReporteProveedor {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  anchoPdf: number;
  anchoExcel: number;
  alineacion: 'left' | 'right' | 'center';
  formato?: 'texto' | 'numero' | 'moneda' | 'porcentaje';
  /** La columna solo tiene sentido con el ámbito «histórico de compras». */
  soloCompras?: boolean;
  /** La columna solo tiene sentido cuando las filas son grupos. */
  soloGrupo?: boolean;
}

export const CAMPOS_REPORTE_PROVEEDOR: CampoReporteProveedor[] = [
  { clave: 'rif', etiqueta: 'RIF', anchoPdf: 16, anchoExcel: 16, alineacion: 'left', formato: 'texto', descripcion: 'Registro de información fiscal' },
  { clave: 'razon_social', etiqueta: 'Razón social', anchoPdf: 34, anchoExcel: 36, alineacion: 'left', formato: 'texto', descripcion: 'Nombre legal del proveedor' },
  { clave: 'contacto', etiqueta: 'Contacto', anchoPdf: 20, anchoExcel: 22, alineacion: 'left', formato: 'texto', descripcion: 'Persona de contacto' },
  { clave: 'telefono', etiqueta: 'Teléfono', anchoPdf: 16, anchoExcel: 16, alineacion: 'left', formato: 'texto', descripcion: 'Teléfono de contacto' },
  { clave: 'email', etiqueta: 'Correo', anchoPdf: 24, anchoExcel: 26, alineacion: 'left', formato: 'texto', descripcion: 'Correo electrónico' },
  { clave: 'direccion', etiqueta: 'Dirección', anchoPdf: 30, anchoExcel: 32, alineacion: 'left', formato: 'texto', descripcion: 'Dirección fiscal / física' },
  { clave: 'categorias', etiqueta: 'Categorías', anchoPdf: 24, anchoExcel: 26, alineacion: 'left', formato: 'texto', descripcion: 'Rubros del proveedor' },
  { clave: 'origen', etiqueta: 'Origen', anchoPdf: 13, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Nacional o internacional' },
  { clave: 'actividad', etiqueta: 'Actividad económica', anchoPdf: 30, anchoExcel: 32, alineacion: 'left', formato: 'texto', descripcion: 'Actividad económica (código CIIU · SENIAT)' },
  { clave: 'numero_administracion', etiqueta: 'N° administración', anchoPdf: 16, anchoExcel: 18, alineacion: 'left', formato: 'texto', descripcion: 'Número de administración' },
  { clave: 'estado', etiqueta: 'Estado', anchoPdf: 11, anchoExcel: 12, alineacion: 'center', formato: 'texto', descripcion: 'Activo o inactivo' },
  { clave: 'total_proveedores', etiqueta: 'N° proveedores', anchoPdf: 14, anchoExcel: 14, alineacion: 'right', formato: 'numero', soloGrupo: true, descripcion: 'Cantidad de proveedores del grupo' },
  { clave: 'num_ordenes', etiqueta: 'N° de compras', anchoPdf: 13, anchoExcel: 14, alineacion: 'right', formato: 'numero', soloCompras: true, descripcion: 'Órdenes efectivas (histórico)' },
  { clave: 'monto_comprado', etiqueta: 'Comprado ($)', anchoPdf: 16, anchoExcel: 16, alineacion: 'right', formato: 'moneda', soloCompras: true, descripcion: 'Monto total comprado en dólares' },
  { clave: 'pct_total', etiqueta: '% del total', anchoPdf: 12, anchoExcel: 12, alineacion: 'right', formato: 'porcentaje', descripcion: 'Peso sobre el total del directorio' },
];

export const CAMPOS_POR_DEFECTO_POR_MODO: Record<ModoAgrupacionProveedor, string[]> = {
  detallado: ['rif', 'razon_social', 'contacto', 'telefono', 'email', 'categorias', 'estado'],
  categoria: ['categorias', 'total_proveedores', 'pct_total'],
  origen: ['origen', 'total_proveedores', 'pct_total'],
  estado: ['estado', 'total_proveedores', 'pct_total'],
  actividad: ['actividad', 'total_proveedores', 'pct_total'],
};

/* ───────────── Resumen / KPIs ───────────── */

export interface TopItemProveedor {
  nombre: string;
  valor: number;       // cantidad de proveedores, o monto en $ según el caso
  porcentaje: number;  // 0-100, un decimal
}

export interface ResumenReporteProveedor {
  totalProveedores: number;
  activos: number;
  inactivos: number;
  nacionales: number;
  internacionales: number;
  pctActivos: number;      // % de activos sobre el total
  pctNacionales: number;   // % de nacionales sobre el total
  topCategorias: TopItemProveedor[];
  // Histórico de compras (si el ámbito está activo)
  conCompras: boolean;
  totalOrdenes: number;
  totalMontoUsd: number;
  topProveedoresMonto: TopItemProveedor[];
}

/* ───────────── Métrica de ficha ejecutiva ───────────── */

export interface MetricaFichaProveedor {
  clave: string;
  etiqueta: string;
  valor: string;
  sub?: string;
  colorHex: string;
  colorRgb: [number, number, number];
}

/* ───────────── Normalización ───────────── */

export interface OpcionesNormalizarProveedor {
  listaActividades?: ActividadEconomica[];
  comprasPorProveedor?: Map<string, ResumenCompras>;
}

/** Normaliza los proveedores a filas del reporte, ordenadas por razón social. */
export function normalizarProveedores(
  lista: readonly Proveedor[],
  opts: OpcionesNormalizarProveedor = {},
): FilaReporteProveedor[] {
  const actividades = opts.listaActividades ?? [];
  const compras = opts.comprasPorProveedor;
  const filas = lista.map((p) => {
    const cats = (p.categorias ?? []).map(txt).filter(Boolean);
    const resumenCompras = compras?.get(p.id) ?? null;
    return {
      id: p.id,
      rif: txt(p.rif),
      razon_social: txt(p.razon_social),
      contacto: txt(p.contacto),
      telefono: txt(p.telefono),
      email: txt(p.email),
      direccion: txt(p.direccion),
      categorias: cats.join(', '),
      categoriasLista: cats,
      origen: ORIGEN_LABEL[p.origen] ?? txt(p.origen),
      estado: p.estado === 'activo' ? 'Activo' : 'Inactivo',
      actividad: textoActividad(p.actividad_economica, actividades),
      numero_administracion: txt(p.numero_administracion),
      num_ordenes: compras ? (resumenCompras?.ordenes ?? 0) : null,
      monto_comprado: compras ? (resumenCompras?.montoUsd ?? 0) : null,
    } satisfies FilaReporteProveedor;
  });
  filas.sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es-VE', { sensitivity: 'base' }));
  return filas;
}

/* ───────────── KPIs del directorio ───────────── */

function topCategoriasDe(filas: FilaReporteProveedor[]): TopItemProveedor[] {
  const map = new Map<string, number>();
  for (const f of filas) {
    for (const c of f.categoriasLista) map.set(c, (map.get(c) || 0) + 1);
  }
  const total = filas.length;
  return Array.from(map.entries())
    .map(([nombre, valor]) => ({ nombre, valor, porcentaje: total > 0 ? Math.round((valor / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.valor - a.valor || a.nombre.localeCompare(b.nombre, 'es-VE'))
    .slice(0, 5);
}

function topProveedoresMontoDe(filas: FilaReporteProveedor[], totalMonto: number): TopItemProveedor[] {
  return filas
    .filter((f) => (f.monto_comprado ?? 0) > 0)
    .map((f) => ({
      nombre: f.razon_social || f.rif || '—',
      valor: f.monto_comprado ?? 0,
      porcentaje: totalMonto > 0 ? Math.round(((f.monto_comprado ?? 0) / totalMonto) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);
}

/** KPIs del directorio a partir de las filas de detalle (ya filtradas). */
export function resumenProveedores(filas: FilaReporteProveedor[]): ResumenReporteProveedor {
  const total = filas.length;
  let activos = 0, nacionales = 0, totalOrdenes = 0, totalMontoUsd = 0;
  let conCompras = false;
  for (const f of filas) {
    if (f.estado === 'Activo') activos += 1;
    if (f.origen === 'Nacional') nacionales += 1;
    if (f.num_ordenes != null || f.monto_comprado != null) conCompras = true;
    totalOrdenes += f.num_ordenes ?? 0;
    totalMontoUsd += f.monto_comprado ?? 0;
  }
  totalMontoUsd = round2(totalMontoUsd);
  return {
    totalProveedores: total,
    activos,
    inactivos: total - activos,
    nacionales,
    internacionales: total - nacionales,
    pctActivos: total > 0 ? Math.round((activos / total) * 1000) / 10 : 0,
    pctNacionales: total > 0 ? Math.round((nacionales / total) * 1000) / 10 : 0,
    topCategorias: topCategoriasDe(filas),
    conCompras,
    totalOrdenes,
    totalMontoUsd,
    topProveedoresMonto: conCompras ? topProveedoresMontoDe(filas, totalMontoUsd) : [],
  };
}

/* ───────────── Agrupación ───────────── */

/** Clave + etiqueta del grupo de una fila según la dimensión elegida. */
function clavesGrupo(f: FilaReporteProveedor, modo: ModoAgrupacionProveedor): { clave: string; etiqueta: string }[] {
  switch (modo) {
    case 'origen': return [{ clave: f.origen || 'Sin origen', etiqueta: f.origen || 'Sin origen' }];
    case 'estado': return [{ clave: f.estado, etiqueta: f.estado }];
    case 'actividad': return [{ clave: f.actividad || '—', etiqueta: f.actividad || 'Sin actividad' }];
    case 'categoria':
      // Un proveedor con varias categorías cuenta en cada una de sus categorías.
      if (!f.categoriasLista.length) return [{ clave: '— Sin categoría', etiqueta: 'Sin categoría' }];
      return f.categoriasLista.map((c) => ({ clave: c, etiqueta: c }));
    default: return [{ clave: f.id, etiqueta: f.razon_social }];
  }
}

interface AcumuladorProveedor {
  clave: string;
  etiqueta: string;
  proveedores: number;
  ordenes: number;
  monto: number;
  conCompras: boolean;
}

/**
 * Genera las filas del reporte según la dimensión de agrupación, más el resumen.
 * El resumen (KPIs) siempre sale del detalle completo, no de los grupos.
 * En «categoría» un proveedor con varias categorías aporta a cada una, así que
 * la suma de los grupos puede superar el total de proveedores (se avisa en la UI).
 */
export function procesarFilasReporteProveedor(
  filasDetalle: FilaReporteProveedor[],
  agrupacion: ModoAgrupacionProveedor,
  opciones: { ordenarPor?: OrdenProveedor } = {},
): { filas: FilaReporteProveedor[]; resumen: ResumenReporteProveedor } {
  const ordenarPor = opciones.ordenarPor ?? (agrupacion === 'detallado' ? 'razon' : 'cantidad');
  const resumen = resumenProveedores(filasDetalle);

  if (agrupacion === 'detallado') {
    const totalMonto = resumen.totalMontoUsd;
    const filas = filasDetalle.map((f) => ({
      ...f,
      total_proveedores: 1,
      pct_del_total: resumen.conCompras && totalMonto > 0 ? Math.round(((f.monto_comprado ?? 0) / totalMonto) * 1000) / 10 : null,
    }));
    ordenarFilas(filas, ordenarPor);
    return { filas, resumen };
  }

  const mapa = new Map<string, AcumuladorProveedor>();
  for (const f of filasDetalle) {
    for (const { clave, etiqueta } of clavesGrupo(f, agrupacion)) {
      let g = mapa.get(clave);
      if (!g) { g = { clave, etiqueta, proveedores: 0, ordenes: 0, monto: 0, conCompras: resumen.conCompras }; mapa.set(clave, g); }
      g.proveedores += 1;
      g.ordenes += f.num_ordenes ?? 0;
      g.monto += f.monto_comprado ?? 0;
    }
  }

  const totalProv = resumen.totalProveedores;
  const filas: FilaReporteProveedor[] = Array.from(mapa.values()).map((g) => ({
    id: g.clave || g.etiqueta,
    rif: '',
    razon_social: g.etiqueta,
    contacto: '', telefono: '', email: '', direccion: '',
    categorias: agrupacion === 'categoria' ? g.etiqueta : '',
    categoriasLista: agrupacion === 'categoria' ? [g.etiqueta] : [],
    origen: agrupacion === 'origen' ? g.etiqueta : '',
    estado: agrupacion === 'estado' ? g.etiqueta : '',
    actividad: agrupacion === 'actividad' ? g.etiqueta : '',
    numero_administracion: '',
    num_ordenes: g.conCompras ? g.ordenes : null,
    monto_comprado: g.conCompras ? round2(g.monto) : null,
    total_proveedores: g.proveedores,
    pct_del_total: totalProv > 0 ? Math.round((g.proveedores / totalProv) * 1000) / 10 : 0,
  }));

  ordenarFilas(filas, ordenarPor);
  return { filas, resumen };
}

function ordenarFilas(filas: FilaReporteProveedor[], ordenarPor: OrdenProveedor): void {
  switch (ordenarPor) {
    case 'monto': filas.sort((a, b) => (b.monto_comprado ?? 0) - (a.monto_comprado ?? 0)); break;
    case 'ordenes': filas.sort((a, b) => (b.num_ordenes ?? 0) - (a.num_ordenes ?? 0)); break;
    case 'cantidad': filas.sort((a, b) => (b.total_proveedores ?? 0) - (a.total_proveedores ?? 0) || a.razon_social.localeCompare(b.razon_social, 'es-VE')); break;
    default: filas.sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es-VE', { sensitivity: 'base' }));
  }
}

/* ───────────── Métricas de la ficha ejecutiva ───────────── */

/**
 * Métricas visibles de una ficha según las columnas marcadas. Máximo 4 recuadros.
 * Para grupos muestra N° proveedores y % del total; para una fila con compras,
 * el monto comprado y las órdenes.
 */
export function obtenerMetricasFichaProveedor(
  f: FilaReporteProveedor,
  columnasClaves: string[],
): MetricaFichaProveedor[] {
  const metricas: MetricaFichaProveedor[] = [];
  const marca = (c: string) => columnasClaves.includes(c);

  if (f.total_proveedores != null && f.total_proveedores > 1) {
    metricas.push({
      clave: 'total_proveedores', etiqueta: 'PROVEEDORES', valor: `${f.total_proveedores}`,
      sub: f.total_proveedores === 1 ? 'proveedor' : 'proveedores', colorHex: '#f59e0b', colorRgb: [217, 119, 6],
    });
  }

  if (marca('monto_comprado') && f.monto_comprado != null) {
    metricas.push({
      clave: 'monto_comprado', etiqueta: 'COMPRADO ($)',
      valor: `$ ${f.monto_comprado.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: 'histórico', colorHex: '#22c55e', colorRgb: [22, 163, 74],
    });
  }

  if (marca('num_ordenes') && f.num_ordenes != null) {
    metricas.push({
      clave: 'num_ordenes', etiqueta: 'COMPRAS', valor: `${f.num_ordenes}`,
      sub: f.num_ordenes === 1 ? 'orden' : 'órdenes', colorHex: '#38bdf8', colorRgb: [2, 132, 199],
    });
  }

  if (marca('pct_total') && f.pct_del_total != null) {
    metricas.push({
      clave: 'pct_total', etiqueta: '% DEL TOTAL', valor: `${f.pct_del_total.toFixed(1)}%`,
      sub: 'del directorio', colorHex: '#eab308', colorRgb: [202, 138, 4],
    });
  }

  if (marca('estado') && f.estado) {
    metricas.push({
      clave: 'estado', etiqueta: 'ESTADO', valor: f.estado, sub: f.origen || '',
      colorHex: f.estado === 'Activo' ? '#10b981' : '#ef4444', colorRgb: f.estado === 'Activo' ? [16, 185, 129] : [239, 68, 68],
    });
  }

  if (metricas.length === 0) {
    metricas.push({
      clave: 'origen', etiqueta: 'ORIGEN', valor: f.origen || '—', sub: f.estado || '',
      colorHex: '#38bdf8', colorRgb: [2, 132, 199],
    });
  }

  return metricas;
}

/** Valor de texto plano de una columna para una fila (para tabla, CSV y Excel/PDF). */
export function textoColumnaProveedor(f: FilaReporteProveedor, clave: string): string {
  switch (clave) {
    case 'rif': return f.rif;
    case 'razon_social': return f.razon_social;
    case 'contacto': return f.contacto;
    case 'telefono': return f.telefono;
    case 'email': return f.email;
    case 'direccion': return f.direccion;
    case 'categorias': return f.categorias;
    case 'origen': return f.origen;
    case 'actividad': return f.actividad;
    case 'numero_administracion': return f.numero_administracion;
    case 'estado': return f.estado;
    case 'total_proveedores': return f.total_proveedores != null ? String(f.total_proveedores) : '';
    case 'num_ordenes': return f.num_ordenes != null ? String(f.num_ordenes) : '';
    case 'monto_comprado': return f.monto_comprado != null ? f.monto_comprado.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    case 'pct_total': return f.pct_del_total != null ? `${f.pct_del_total.toFixed(1)}%` : '';
    default: return '';
  }
}

/** Valor numérico de una columna (para Excel con tipo número y CSV). null si no aplica. */
export function numeroColumnaProveedor(f: FilaReporteProveedor, clave: string): number | null {
  switch (clave) {
    case 'total_proveedores': return f.total_proveedores ?? null;
    case 'num_ordenes': return f.num_ordenes;
    case 'monto_comprado': return f.monto_comprado;
    case 'pct_total': return f.pct_del_total ?? null;
    default: return null;
  }
}
