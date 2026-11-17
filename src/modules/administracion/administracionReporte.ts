/* ============================================================================
   Golden Touch · Administración · reporte del histórico (datos puros)
   El estándar del sistema: UNA lectura → UN armado → varias salidas (WhatsApp,
   PDF, Excel), todas diciendo lo mismo. Toma los movimientos YA filtrados y,
   según la DIMENSIÓN elegida (empresa/categoría/proveedor/período/moneda/estado),
   arma el desglose que consumen los tres generadores. Dinámico, determinista.
   ============================================================================ */
import { totalGeneral, type GrupoTotal, type Moneda, type MovimientoCalc } from './administracionCalculo';
import type { Empresa, Movimiento, OpcionRef } from './admin.repository';

export type DimensionReporte = 'empresa' | 'categoria' | 'proveedor' | 'periodo' | 'moneda' | 'estado';
export const ETIQUETA_DIMENSION: Record<DimensionReporte, string> = {
  empresa: 'Empresa', categoria: 'Categoría', proveedor: 'Proveedor', periodo: 'Período', moneda: 'Moneda', estado: 'Estado',
};

export interface ReporteAdminFila {
  fecha: string;
  empresa: string;
  concepto: string;
  categoria: string;
  proveedor: string;
  monto: number;
  moneda: Moneda;
  periodo: string;
  estadoPago: string;
  origen: string;
}
export interface ReporteAdminMeta {
  /** Razón social de la empresa elegida, o null = todas. */
  empresaNombre: string | null;
  /** Alcance del reporte, p. ej. «Octubre 2026» o «Todo el histórico». */
  alcanceLabel: string;
  /** Bs por 1 USD, para los equivalentes. */
  tasa: number;
  /** ISO del momento en que se armó. */
  generadoEn: string;
}
export interface ReporteAdminData {
  meta: ReporteAdminMeta;
  total: Omit<GrupoTotal, 'clave'>;
  /** Dimensión por la que se agrupó el desglose. */
  agruparPor: DimensionReporte;
  /** Desglose por la dimensión elegida (mayor a menor, en USD equivalente). */
  grupos: GrupoTotal[];
  filas: ReporteAdminFila[];
}

const ESTADO_LABEL: Record<string, string> = { pagado: 'Pagado', pendiente: 'Pendiente', anulado: 'Anulado' };
const ORIGEN_LABEL: Record<string, string> = { generado: 'Generado', importado: 'Importado', manual: 'Manual' };
export const estadoPagoLabel = (e: string): string => ESTADO_LABEL[e] ?? e;
export const origenLabel = (o: string): string => ORIGEN_LABEL[o] ?? o;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Clave de agrupación de una fila según la dimensión. */
function claveDimension(f: ReporteAdminFila, dim: DimensionReporte): string {
  switch (dim) {
    case 'empresa': return f.empresa;
    case 'categoria': return f.categoria;
    case 'proveedor': return f.proveedor || 'Sin proveedor';
    case 'periodo': return f.periodo;
    case 'moneda': return f.moneda;
    case 'estado': return estadoPagoLabel(f.estadoPago);
    default: return '—';
  }
}

/** Agrupa las filas por una dimensión cualquiera, de mayor a menor (USD equivalente). */
export function agruparFilas(filas: readonly ReporteAdminFila[], dim: DimensionReporte, tasa: number): GrupoTotal[] {
  const grupos = new Map<string, { bs: number; usd: number; n: number }>();
  for (const f of filas) {
    const k = claveDimension(f, dim);
    const g = grupos.get(k) ?? { bs: 0, usd: 0, n: 0 };
    if (f.moneda === 'Bs') g.bs += f.monto; else g.usd += f.monto;
    g.n += 1;
    grupos.set(k, g);
  }
  const t = tasa > 0 ? tasa : 0;
  return [...grupos.entries()]
    .map(([clave, g]) => {
      const bs = r2(g.bs);
      const usd = r2(g.usd);
      return { clave, bs, usd, equivUsd: r2(usd + (t ? bs / t : 0)), equivBs: r2(bs + usd * t), n: g.n };
    })
    .sort((a, b) => b.equivUsd - a.equivUsd || a.clave.localeCompare(b.clave, 'es'));
}

/** Arma el reporte a partir de los movimientos YA filtrados, agrupado por `agruparPor`. */
export function armarReporteAdmin(
  movs: readonly Movimiento[],
  empresas: readonly Empresa[],
  categorias: readonly OpcionRef[],
  o: { empresaNombre: string | null; alcanceLabel: string; tasa: number; agruparPor: DimensionReporte; generadoEn?: string },
): ReporteAdminData {
  const nombreEmp = new Map(empresas.map((e) => [e.clave, e.nombre]));
  const nombreCat = new Map(categorias.map((c) => [c.id, c.nombre]));
  const empOf = (m: Movimiento) => nombreEmp.get(m.empresaClave) ?? m.empresaClave;
  const catOf = (m: Movimiento) => (m.categoriaGastoId ? nombreCat.get(m.categoriaGastoId) ?? 'Sin categoría' : 'Sin categoría');
  const filas: ReporteAdminFila[] = movs.map((m) => ({
    fecha: m.fecha, empresa: empOf(m), concepto: m.concepto, categoria: catOf(m),
    proveedor: m.proveedorNombre ?? '', monto: m.monto, moneda: m.moneda, periodo: m.periodo,
    estadoPago: m.estadoPago, origen: m.origen,
  }));
  const calc: MovimientoCalc[] = filas.map((f) => ({ empresaClave: f.empresa, moneda: f.moneda, monto: f.monto }));
  return {
    meta: { empresaNombre: o.empresaNombre, alcanceLabel: o.alcanceLabel, tasa: o.tasa, generadoEn: o.generadoEn ?? new Date().toISOString() },
    total: totalGeneral(calc, o.tasa),
    agruparPor: o.agruparPor,
    grupos: agruparFilas(filas, o.agruparPor, o.tasa),
    filas,
  };
}

/** Nombre de archivo sugerido (slug del alcance), para PDF/Excel. */
export function nombreArchivoReporteAdmin(alcanceLabel: string, ext: 'pdf' | 'xlsx'): string {
  const slug = alcanceLabel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'reporte';
  return `reporte-gastos-${slug}.${ext}`;
}
