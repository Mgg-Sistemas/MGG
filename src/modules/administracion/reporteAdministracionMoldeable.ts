/* ============================================================
   Golden Touch · Administración · Motor del Reporte Moldeable
   (04/11/2026)

   Motor de datos PURO, DETERMINISTA y SÍNCRONO para el reporte dinámico
   del módulo de Administración. Sigue el estándar de excelencia de
   Combustible y Tesorería:
     - Multi-dimensión de agrupación (empresa, categoría, proveedor,
       período, mes, día, moneda, estado, origen, detallado).
     - Valuación bimoneda (USD y Bs) con tasa de movimiento vs BCV del día,
       y cálculo de tasa promedio ponderada.
     - Filtros multidimensionales y presets de fecha (Mes actual, Mes anterior,
       7d, 15d, 30d, año actual, historial completo).
     - Fichas ejecutivas con tarjetas interactivas (inclusión/exclusión puntual).
     - Compatible con la evolución rápida del esquema y cargas masivas de datos.

   REGLA DE ORO: Aquí NO se hacen llamadas a Supabase ni efectos colaterales.
   Recibe los datos listos y devuelve estructuras listas para UI, PDF y Excel.
   ============================================================ */

import type { Empresa, Movimiento, OpcionRef, EstadoPago, OrigenMovimiento } from './admin.repository';
import type { Moneda } from './administracionCalculo';
import { isoAVe } from '@/shared/lib/fechaVe';

/* ───────────── Modos de agrupación y presets ───────────── */

export type ModoAgrupacionAdmin =
  | 'empresa'
  | 'categoria'
  | 'proveedor'
  | 'periodo'
  | 'mes'
  | 'dia'
  | 'moneda'
  | 'estado'
  | 'origen'
  | 'detallado';

export const MODOS_AGRUPACION_ADMIN: { id: ModoAgrupacionAdmin; icon: string; label: string }[] = [
  { id: 'empresa', icon: '🏢', label: 'Por Empresa' },
  { id: 'categoria', icon: '🏷️', label: 'Por Categoría' },
  { id: 'proveedor', icon: '👤', label: 'Por Proveedor' },
  { id: 'mes', icon: '📅', label: 'Por Mes' },
  { id: 'periodo', icon: '📆', label: 'Por Período' },
  { id: 'dia', icon: '🗓️', label: 'Por Día' },
  { id: 'moneda', icon: '💱', label: 'Por Moneda' },
  { id: 'estado', icon: '🚦', label: 'Por Estado de Pago' },
  { id: 'origen', icon: '📦', label: 'Por Origen' },
  { id: 'detallado', icon: '📋', label: 'Detallado (Movimientos)' },
];

export const ETIQUETA_MODO_ADMIN: Record<ModoAgrupacionAdmin, string> = {
  empresa: 'Empresa',
  categoria: 'Categoría',
  proveedor: 'Proveedor',
  periodo: 'Período',
  mes: 'Mes',
  dia: 'Día',
  moneda: 'Moneda',
  estado: 'Estado de Pago',
  origen: 'Origen',
  detallado: 'Detallado',
};

export type PresetPeriodoAdmin =
  | 'mes_actual'
  | 'mes_anterior'
  | '7dias'
  | '15dias'
  | '30dias'
  | 'este_ano'
  | 'todos'
  | 'personalizado';

export type BaseTasaAdmin = 'movimiento' | 'bcv_dia';

/* ───────────── Catálogo de columnas seleccionables ───────────── */

export interface CampoColumnaAdmin {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  anchoPdf: number;
  anchoExcel: number;
  alineacion: 'left' | 'right' | 'center';
  formato?: 'texto' | 'numero' | 'moneda' | 'moneda_bs' | 'porcentaje';
}

export const CAMPOS_REPORTE_ADMIN: CampoColumnaAdmin[] = [
  { clave: 'fecha', etiqueta: 'Fecha', anchoPdf: 14, anchoExcel: 13, alineacion: 'center', formato: 'texto', descripcion: 'Fecha efectiva del movimiento' },
  { clave: 'empresa', etiqueta: 'Empresa', anchoPdf: 22, anchoExcel: 24, alineacion: 'left', formato: 'texto', descripcion: 'Razón social de la empresa' },
  { clave: 'operaciones', etiqueta: 'N° Operaciones', anchoPdf: 15, anchoExcel: 14, alineacion: 'center', formato: 'numero', descripcion: 'Cantidad de movimientos u operaciones en el grupo' },
  { clave: 'concepto', etiqueta: 'Concepto / Servicio', anchoPdf: 28, anchoExcel: 30, alineacion: 'left', formato: 'texto', descripcion: 'Descripción del gasto administrativo (solo detallado)' },
  { clave: 'categoria', etiqueta: 'Categoría', anchoPdf: 20, anchoExcel: 22, alineacion: 'left', formato: 'texto', descripcion: 'Rubro / categoría contable' },
  { clave: 'proveedor', etiqueta: 'Proveedor / Beneficiario', anchoPdf: 24, anchoExcel: 26, alineacion: 'left', formato: 'texto', descripcion: 'Proveedor o beneficiario del pago' },
  { clave: 'periodo', etiqueta: 'Período', anchoPdf: 14, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Token del período (ej. 2026-11)' },
  { clave: 'estado', etiqueta: 'Estado', anchoPdf: 15, anchoExcel: 15, alineacion: 'center', formato: 'texto', descripcion: 'Pagado, Pendiente o Anulado' },
  { clave: 'origen', etiqueta: 'Origen', anchoPdf: 14, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Generado, Importado o Manual' },
  { clave: 'moneda_orig', etiqueta: 'Divisa Orig.', anchoPdf: 12, anchoExcel: 12, alineacion: 'center', formato: 'texto', descripcion: 'Moneda nativa (USD / Bs)' },
  { clave: 'monto_orig', etiqueta: 'Monto Original', anchoPdf: 16, anchoExcel: 16, alineacion: 'right', formato: 'numero', descripcion: 'Monto en su moneda nativa' },
  { clave: 'monto_usd', etiqueta: 'Monto ($ USD)', anchoPdf: 16, anchoExcel: 16, alineacion: 'right', formato: 'moneda', descripcion: 'Equivalente en Dólares' },
  { clave: 'monto_bs', etiqueta: 'Monto (Bs)', anchoPdf: 18, anchoExcel: 18, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Equivalente en Bolívares' },
  { clave: 'tasa', etiqueta: 'Tasa ($/Bs)', anchoPdf: 14, anchoExcel: 14, alineacion: 'right', formato: 'numero', descripcion: 'Tasa de cambio aplicada' },
  { clave: 'pct_total', etiqueta: '% del Total', anchoPdf: 13, anchoExcel: 12, alineacion: 'right', formato: 'porcentaje', descripcion: 'Participación porcentual' },
];

export const CAMPOS_POR_DEFECTO_ADMIN_POR_MODO: Record<ModoAgrupacionAdmin, string[]> = {
  empresa: ['empresa', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  categoria: ['categoria', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  proveedor: ['proveedor', 'operaciones', 'categoria', 'monto_usd', 'monto_bs', 'pct_total'],
  periodo: ['periodo', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  mes: ['fecha', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  dia: ['fecha', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  moneda: ['moneda_orig', 'operaciones', 'monto_orig', 'monto_usd', 'monto_bs', 'pct_total'],
  estado: ['estado', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  origen: ['origen', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  detallado: ['fecha', 'empresa', 'concepto', 'categoria', 'proveedor', 'estado', 'monto_usd', 'monto_bs'],
};

/**
 * Determina si una columna es aplicable según el modo de agrupación activo en Administración.
 */
export function esColumnaAplicableModoAdmin(
  colClave: string,
  modo: ModoAgrupacionAdmin,
): boolean {
  if (modo === 'detallado') {
    return true; // En detallado cada fila es 1 movimiento
  }

  // En modos agrupados:
  if (colClave === 'concepto') {
    return false; // El concepto individual aplica a nivel de movimiento detallado
  }
  if (colClave === 'fecha') {
    return modo === 'dia' || modo === 'mes';
  }
  return true;
}

/* ───────────── Fila normalizada del reporte ───────────── */

export interface FilaReporteAdmin {
  id: string;
  fecha: string;
  empresaClave: string;
  empresaNombre: string;
  concepto: string;
  categoriaId: string | null;
  categoriaNombre: string;
  proveedorNombre: string;
  periodo: string;
  estadoPago: EstadoPago;
  origen: OrigenMovimiento;
  monedaOriginal: Moneda;
  montoOriginal: number;
  tasaAplicada: number;
  montoUsd: number;
  montoBs: number;
  // Campos de agregación cuando la fila representa un grupo
  esGrupo?: boolean;
  grupoClave?: string;
  titulo?: string;
  subtitulo?: string;
  totalOperaciones?: number;
  pctDelTotal?: number;
  montoPagadoUsd?: number;
  montoPendienteUsd?: number;
  montoAnuladoUsd?: number;
  montoPagadoBs?: number;
  montoPendienteBs?: number;
  montoAnuladoBs?: number;
}

/* ───────────── Métrica de ficha ejecutiva ───────────── */

export interface MetricaFichaAdmin {
  clave: string;
  etiqueta: string;
  valor: string;
  sub?: string;
  colorHex: string;
  colorRgb: [number, number, number];
}

/* ───────────── Resumen / KPIs del reporte ───────────── */

export interface TopItemAdmin {
  nombre: string;
  montoUsd: number;
  montoBs: number;
  porcentaje: number;
  operaciones: number;
}

export interface ResumenReporteAdmin {
  totalUsd: number;
  totalBs: number;
  totalOperaciones: number;
  tasaPromedioPonderada: number;
  tasaBcvReferencia: number;
  totalPagadoUsd: number;
  totalPendienteUsd: number;
  totalAnuladoUsd: number;
  totalPagadoBs: number;
  totalPendienteBs: number;
  totalAnuladoBs: number;
  topCategorias: TopItemAdmin[];
  topProveedores: TopItemAdmin[];
  topEmpresas: TopItemAdmin[];
}

/* ───────────── Filtros y Opciones ───────────── */

export interface FiltrosReporteAdmin {
  empresasSel?: string[];
  categoriasSel?: string[];
  proveedoresSel?: string[];
  estadosSel?: EstadoPago[];
  origenesSel?: OrigenMovimiento[];
  monedasSel?: Moneda[];
}

export interface OpcionesReporteAdmin extends FiltrosReporteAdmin {
  desde: string;
  hasta: string;
  periodoPreset: PresetPeriodoAdmin;
  agrupacion: ModoAgrupacionAdmin;
  baseTasa: BaseTasaAdmin;
  tasaBcvHoy: number;
  mostrarUsd: boolean;
  mostrarBs: boolean;
  columnas: string[];
  ordenarPor?: 'usd' | 'bs' | 'fecha' | 'nombre' | 'ops';
  incluirTarjetas: boolean;
  incluirMovimientos: boolean;
  incluirResumen: boolean;
  kpisSimplificados?: boolean;
  formatoPresentacion: 'fichas' | 'tabla';
  orientacion: 'landscape' | 'portrait';
}

/* ───────────── Utilidades de redondeo y formato ───────────── */

export const r2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
export const r4 = (n: number): number => Math.round((Number(n) || 0) * 10000) / 10000;

export const fmtMontoUsd = (v: number): string =>
  `$ ${(Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtMontoBs = (v: number): string =>
  `Bs ${(Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtMontoNum = (v: number, dec = 2): string =>
  (Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const nombreMesEs = (mesNumero: number): string => {
  return MESES_ES[mesNumero - 1] ?? `Mes ${mesNumero}`;
};

export const ESTADO_PAGO_LABEL: Record<EstadoPago, string> = {
  pagado: 'Pagado',
  pendiente: 'Pendiente',
  anulado: 'Anulado',
};

export const ORIGEN_LABEL: Record<OrigenMovimiento, string> = {
  generado: 'Generado',
  importado: 'Importado',
  manual: 'Manual',
};

/* ───────────── Presets de fechas ───────────── */

export function hoyIsoVE(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Caracas',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function obtenerPresetRangoAdmin(
  preset: PresetPeriodoAdmin,
  hoyRef?: string,
): { desde: string; hasta: string; label: string } {
  const hoy = hoyRef || hoyIsoVE();
  const [yStr, mStr] = hoy.split('-');
  const y = Number(yStr);
  const m = Number(mStr);

  switch (preset) {
    case 'mes_actual': {
      const desde = `${yStr}-${mStr.padStart(2, '0')}-01`;
      return {
        desde,
        hasta: hoy,
        label: `Mes actual (${nombreMesEs(m)} ${y})`,
      };
    }
    case 'mes_anterior': {
      let prevY = y;
      let prevM = m - 1;
      if (prevM < 1) {
        prevM = 12;
        prevY -= 1;
      }
      const prevMStr = String(prevM).padStart(2, '0');
      const diasEnMesAnterior = new Date(prevY, prevM, 0).getDate();
      const desde = `${prevY}-${prevMStr}-01`;
      const hasta = `${prevY}-${prevMStr}-${String(diasEnMesAnterior).padStart(2, '0')}`;
      return {
        desde,
        hasta,
        label: `Mes anterior (${nombreMesEs(prevM)} ${prevY})`,
      };
    }
    case '7dias': {
      const d = new Date(y, m - 1, Number(hoy.slice(8, 10)));
      d.setDate(d.getDate() - 6);
      const desde = d.toISOString().slice(0, 10);
      return { desde, hasta: hoy, label: 'Últimos 7 días' };
    }
    case '15dias': {
      const d = new Date(y, m - 1, Number(hoy.slice(8, 10)));
      d.setDate(d.getDate() - 14);
      const desde = d.toISOString().slice(0, 10);
      return { desde, hasta: hoy, label: 'Últimos 15 días' };
    }
    case '30dias': {
      const d = new Date(y, m - 1, Number(hoy.slice(8, 10)));
      d.setDate(d.getDate() - 29);
      const desde = d.toISOString().slice(0, 10);
      return { desde, hasta: hoy, label: 'Últimos 30 días' };
    }
    case 'este_ano': {
      const desde = `${y}-01-01`;
      return { desde, hasta: hoy, label: `Año ${y}` };
    }
    case 'todos':
    default:
      return { desde: '', hasta: '', label: 'Todo el histórico' };
  }
}

/**
 * Título formal y explícito para cabecera, impresión y PDF.
 * Ejemplo: "Reporte del 01 al 31 de Octubre 2026"
 */
export function obtenerTituloRangoAdmin(
  desde?: string | null,
  hasta?: string | null,
  preset?: PresetPeriodoAdmin,
  empresaNombre?: string | null,
): string {
  const baseEmpresa = empresaNombre ? ` · ${empresaNombre}` : '';

  if (preset === 'todos' || (!desde && !hasta)) {
    return `Reporte Administrativo Histórico Completo${baseEmpresa}`;
  }

  const d = (desde || '').trim();
  const h = (hasta || '').trim();

  if (d && h) {
    const [yD, mD, diaD] = d.split('-').map(Number);
    const [yH, mH, diaH] = h.split('-').map(Number);
    const padD = String(diaD).padStart(2, '0');
    const padH = String(diaH).padStart(2, '0');

    if (yD === yH && mD === mH) {
      return `Reporte del ${padD} al ${padH} de ${nombreMesEs(mD)} ${yH}${baseEmpresa}`;
    }
    if (yD === yH) {
      return `Reporte del ${padD} de ${nombreMesEs(mD)} al ${padH} de ${nombreMesEs(mH)} ${yH}${baseEmpresa}`;
    }
    return `Reporte del ${padD} de ${nombreMesEs(mD)} ${yD} al ${padH} de ${nombreMesEs(mH)} ${yH}${baseEmpresa}`;
  }

  if (h) {
    const [yH, mH, diaH] = h.split('-').map(Number);
    const padH = String(diaH).padStart(2, '0');
    return `Reporte Administrativo al ${padH} de ${nombreMesEs(mH)} ${yH}${baseEmpresa}`;
  }

  if (d) {
    const [yD, mD, diaD] = d.split('-').map(Number);
    const padD = String(diaD).padStart(2, '0');
    return `Reporte Administrativo desde el ${padD} de ${nombreMesEs(mD)} ${yD}${baseEmpresa}`;
  }

  return `Reporte Dinámico de Administración${baseEmpresa}`;
}

/* ───────────── Normalización pura de movimientos ───────────── */

export function normalizarMovimientosAdmin(
  movs: readonly Movimiento[],
  empresas: readonly Empresa[],
  categorias: readonly OpcionRef[],
  tasaBcvHoy: number,
  baseTasa: BaseTasaAdmin = 'movimiento',
): FilaReporteAdmin[] {
  const empMap = new Map(empresas.map((e) => [e.clave, e.nombre]));
  const catMap = new Map(categorias.map((c) => [c.id, c.nombre]));
  const tasaBcvValida = tasaBcvHoy > 0 ? tasaBcvHoy : 1;

  return movs.map((m) => {
    const empNombre = empMap.get(m.empresaClave) || m.empresaClave || 'Sin empresa';
    const catNombre = m.categoriaGastoId
      ? catMap.get(m.categoriaGastoId) || 'Sin categoría'
      : 'Sin categoría';

    const tasaMov = Number(m.tasaRef) > 0 ? Number(m.tasaRef) : tasaBcvValida;
    const tasaAplicada = baseTasa === 'bcv_dia' ? tasaBcvValida : tasaMov;

    const montoOrig = Number(m.monto) || 0;
    let montoUsd = 0;
    let montoBs = 0;

    if (m.moneda === 'USD') {
      montoUsd = r2(montoOrig);
      montoBs = r2(montoOrig * tasaAplicada);
    } else {
      montoBs = r2(montoOrig);
      montoUsd = tasaAplicada > 0 ? r2(montoOrig / tasaAplicada) : 0;
    }

    return {
      id: m.id,
      fecha: (m.fecha || '').slice(0, 10),
      empresaClave: m.empresaClave,
      empresaNombre: empNombre,
      concepto: m.concepto || 'Sin concepto',
      categoriaId: m.categoriaGastoId ?? null,
      categoriaNombre: catNombre,
      proveedorNombre: m.proveedorNombre || 'Sin proveedor',
      periodo: m.periodo || '—',
      estadoPago: m.estadoPago || 'pendiente',
      origen: m.origen || 'manual',
      monedaOriginal: m.moneda || 'USD',
      montoOriginal: montoOrig,
      tasaAplicada,
      montoUsd,
      montoBs,
    };
  });
}

/* ───────────── Filtrado de filas ───────────── */

export function filtrarFilasAdmin(
  filas: readonly FilaReporteAdmin[],
  filtros: FiltrosReporteAdmin,
  desde?: string,
  hasta?: string,
  incluirAnulados = false,
): FilaReporteAdmin[] {
  const d = desde ? desde.trim() : '';
  const h = hasta ? hasta.trim() : '';

  const empSet = filtros.empresasSel && filtros.empresasSel.length ? new Set(filtros.empresasSel) : null;
  const catSet = filtros.categoriasSel && filtros.categoriasSel.length ? new Set(filtros.categoriasSel) : null;
  const provSet = filtros.proveedoresSel && filtros.proveedoresSel.length ? new Set(filtros.proveedoresSel) : null;
  const estSet = filtros.estadosSel && filtros.estadosSel.length ? new Set(filtros.estadosSel) : null;
  const origSet = filtros.origenesSel && filtros.origenesSel.length ? new Set(filtros.origenesSel) : null;
  const monSet = filtros.monedasSel && filtros.monedasSel.length ? new Set(filtros.monedasSel) : null;

  return filas.filter((f) => {
    if (!incluirAnulados && f.estadoPago === 'anulado') return false;
    if (d && f.fecha && f.fecha < d) return false;
    if (h && f.fecha && f.fecha > h) return false;

    if (empSet && !empSet.has(f.empresaClave)) return false;
    if (catSet && !catSet.has(f.categoriaId || 'sin_cat')) return false;
    if (provSet && !provSet.has(f.proveedorNombre)) return false;
    if (estSet && !estSet.has(f.estadoPago)) return false;
    if (origSet && !origSet.has(f.origen)) return false;
    if (monSet && !monSet.has(f.monedaOriginal)) return false;

    return true;
  });
}

/* ───────────── Cálculo de Resumen y KPIs ───────────── */

export function calcularResumenAdmin(
  filas: readonly FilaReporteAdmin[],
  tasaBcvHoy: number,
): ResumenReporteAdmin {
  let totalUsd = 0;
  let totalBs = 0;
  let totalPagadoUsd = 0;
  let totalPendienteUsd = 0;
  let totalAnuladoUsd = 0;
  let totalPagadoBs = 0;
  let totalPendienteBs = 0;
  let totalAnuladoBs = 0;

  const catMap = new Map<string, { usd: number; bs: number; ops: number }>();
  const provMap = new Map<string, { usd: number; bs: number; ops: number }>();
  const empMap = new Map<string, { usd: number; bs: number; ops: number }>();

  for (const f of filas) {
    if (f.estadoPago === 'anulado') {
      totalAnuladoUsd += f.montoUsd;
      totalAnuladoBs += f.montoBs;
      continue;
    }

    totalUsd += f.montoUsd;
    totalBs += f.montoBs;

    if (f.estadoPago === 'pagado') {
      totalPagadoUsd += f.montoUsd;
      totalPagadoBs += f.montoBs;
    } else {
      totalPendienteUsd += f.montoUsd;
      totalPendienteBs += f.montoBs;
    }

    // Acumular por categoría
    const cKey = f.categoriaNombre || 'Sin categoría';
    const cItem = catMap.get(cKey) || { usd: 0, bs: 0, ops: 0 };
    cItem.usd += f.montoUsd;
    cItem.bs += f.montoBs;
    cItem.ops += 1;
    catMap.set(cKey, cItem);

    // Acumular por proveedor
    const pKey = f.proveedorNombre || 'Sin proveedor';
    const pItem = provMap.get(pKey) || { usd: 0, bs: 0, ops: 0 };
    pItem.usd += f.montoUsd;
    pItem.bs += f.montoBs;
    pItem.ops += 1;
    provMap.set(pKey, pItem);

    // Acumular por empresa
    const eKey = f.empresaNombre || f.empresaClave || 'Sin empresa';
    const eItem = empMap.get(eKey) || { usd: 0, bs: 0, ops: 0 };
    eItem.usd += f.montoUsd;
    eItem.bs += f.montoBs;
    eItem.ops += 1;
    empMap.set(eKey, eItem);
  }

  const opsValidas = filas.filter((f) => f.estadoPago !== 'anulado').length;
  const tasaPromPonderada = totalUsd > 0 ? r2(totalBs / totalUsd) : tasaBcvHoy;

  const toTop = (map: Map<string, { usd: number; bs: number; ops: number }>): TopItemAdmin[] => {
    return [...map.entries()]
      .map(([nombre, d]) => ({
        nombre,
        montoUsd: r2(d.usd),
        montoBs: r2(d.bs),
        porcentaje: totalUsd > 0 ? r2((d.usd / totalUsd) * 100) : 0,
        operaciones: d.ops,
      }))
      .sort((a, b) => b.montoUsd - a.montoUsd);
  };

  return {
    totalUsd: r2(totalUsd),
    totalBs: r2(totalBs),
    totalOperaciones: opsValidas,
    tasaPromedioPonderada: tasaPromPonderada,
    tasaBcvReferencia: tasaBcvHoy,
    totalPagadoUsd: r2(totalPagadoUsd),
    totalPendienteUsd: r2(totalPendienteUsd),
    totalAnuladoUsd: r2(totalAnuladoUsd),
    totalPagadoBs: r2(totalPagadoBs),
    totalPendienteBs: r2(totalPendienteBs),
    totalAnuladoBs: r2(totalAnuladoBs),
    topCategorias: toTop(catMap),
    topProveedores: toTop(provMap),
    topEmpresas: toTop(empMap),
  };
}

/* ───────────── Agrupación multidimensional ───────────── */

export function agruparFilasAdmin(
  filas: readonly FilaReporteAdmin[],
  modo: ModoAgrupacionAdmin,
  tasaBcvHoy: number,
): FilaReporteAdmin[] {
  if (modo === 'detallado') {
    return [...filas];
  }

  // Agrupador
  const mapa = new Map<string, {
    clave: string;
    titulo: string;
    subtitulo: string;
    filas: FilaReporteAdmin[];
    montoUsd: number;
    montoBs: number;
    montoOrigUsd: number;
    montoOrigBs: number;
    pagadoUsd: number;
    pendienteUsd: number;
    anuladoUsd: number;
    pagadoBs: number;
    pendienteBs: number;
    anuladoBs: number;
    empresaClave: string;
    empresaNombre: string;
    categoriaId: string | null;
    categoriaNombre: string;
    proveedorNombre: string;
    periodo: string;
    fecha: string;
  }>();

  for (const f of filas) {
    let clave = '';
    let titulo = '';
    let subtitulo = '';

    switch (modo) {
      case 'empresa':
        clave = f.empresaClave;
        titulo = f.empresaNombre;
        subtitulo = `Código: ${f.empresaClave}`;
        break;
      case 'categoria':
        clave = f.categoriaId || 'sin_cat';
        titulo = f.categoriaNombre;
        subtitulo = 'Categoría de gasto';
        break;
      case 'proveedor':
        clave = f.proveedorNombre;
        titulo = f.proveedorNombre;
        subtitulo = 'Proveedor / Beneficiario';
        break;
      case 'periodo':
        clave = f.periodo;
        titulo = f.periodo;
        subtitulo = 'Período contable';
        break;
      case 'mes': {
        const [y, m] = f.fecha.split('-');
        clave = `${y}-${m}`;
        titulo = `${nombreMesEs(Number(m))} ${y}`;
        subtitulo = 'Mes calendario';
        break;
      }
      case 'dia':
        clave = f.fecha;
        titulo = isoAVe(f.fecha);
        subtitulo = f.fecha;
        break;
      case 'moneda':
        clave = f.monedaOriginal;
        titulo = f.monedaOriginal === 'USD' ? 'Divisa Estadounidense ($)' : 'Moneda Nacional (Bs)';
        subtitulo = `Transacciones en ${f.monedaOriginal}`;
        break;
      case 'estado':
        clave = f.estadoPago;
        titulo = ESTADO_PAGO_LABEL[f.estadoPago] || f.estadoPago;
        subtitulo = 'Estado del movimiento';
        break;
      case 'origen':
        clave = f.origen;
        titulo = ORIGEN_LABEL[f.origen] || f.origen;
        subtitulo = 'Vía de ingreso al sistema';
        break;
      default:
        clave = 'general';
        titulo = 'General';
        subtitulo = '';
    }

    const g = mapa.get(clave) || {
      clave,
      titulo,
      subtitulo,
      filas: [],
      montoUsd: 0,
      montoBs: 0,
      montoOrigUsd: 0,
      montoOrigBs: 0,
      pagadoUsd: 0,
      pendienteUsd: 0,
      anuladoUsd: 0,
      pagadoBs: 0,
      pendienteBs: 0,
      anuladoBs: 0,
      empresaClave: f.empresaClave,
      empresaNombre: f.empresaNombre,
      categoriaId: f.categoriaId,
      categoriaNombre: f.categoriaNombre,
      proveedorNombre: f.proveedorNombre,
      periodo: f.periodo,
      fecha: f.fecha,
    };

    g.filas.push(f);
    g.montoUsd += f.montoUsd;
    g.montoBs += f.montoBs;

    if (f.monedaOriginal === 'USD') g.montoOrigUsd += f.montoOriginal;
    else g.montoOrigBs += f.montoOriginal;

    if (f.estadoPago === 'pagado') {
      g.pagadoUsd += f.montoUsd;
      g.pagadoBs += f.montoBs;
    } else if (f.estadoPago === 'anulado') {
      g.anuladoUsd += f.montoUsd;
      g.anuladoBs += f.montoBs;
    } else {
      g.pendienteUsd += f.montoUsd;
      g.pendienteBs += f.montoBs;
    }

    mapa.set(clave, g);
  }

  // Total acumulado para porcentajes
  const totalUsdG = [...mapa.values()].reduce((sum, g) => sum + g.montoUsd, 0);

  return [...mapa.values()].map((g) => {
    const tasaGrupo = g.montoUsd > 0 ? r2(g.montoBs / g.montoUsd) : tasaBcvHoy;
    const pct = totalUsdG > 0 ? r2((g.montoUsd / totalUsdG) * 100) : 0;

    return {
      id: `grupo-${modo}-${g.clave}`,
      esGrupo: true,
      grupoClave: g.clave,
      titulo: g.titulo,
      subtitulo: g.subtitulo,
      fecha: g.fecha,
      empresaClave: g.empresaClave,
      empresaNombre: g.empresaNombre,
      concepto: `${g.filas.length} movimiento(s)`,
      categoriaId: g.categoriaId,
      categoriaNombre: g.categoriaNombre,
      proveedorNombre: g.proveedorNombre,
      periodo: g.periodo,
      estadoPago: (g.filas[0]?.estadoPago || 'pendiente') as EstadoPago,
      origen: (g.filas[0]?.origen || 'manual') as OrigenMovimiento,
      monedaOriginal: (g.montoOrigUsd >= g.montoOrigBs ? 'USD' : 'Bs') as Moneda,
      montoOriginal: r2(g.montoOrigUsd > 0 ? g.montoOrigUsd : g.montoOrigBs),
      tasaAplicada: tasaGrupo,
      montoUsd: r2(g.montoUsd),
      montoBs: r2(g.montoBs),
      totalOperaciones: g.filas.length,
      pctDelTotal: pct,
      montoPagadoUsd: r2(g.pagadoUsd),
      montoPendienteUsd: r2(g.pendienteUsd),
      montoAnuladoUsd: r2(g.anuladoUsd),
      montoPagadoBs: r2(g.pagadoBs),
      montoPendienteBs: r2(g.pendienteBs),
      montoAnuladoBs: r2(g.anuladoBs),
    };
  });
}

/* ───────────── Métricas para Fichas Ejecutivas ───────────── */

export function obtenerMetricasFichaAdmin(
  fila: FilaReporteAdmin,
  camposMarcados: string[],
  opts: { mostrarUsd: boolean; mostrarBs: boolean },
): MetricaFichaAdmin[] {
  const metricas: MetricaFichaAdmin[] = [];
  const hayMarcas = camposMarcados.length > 0;

  // 1. Monto USD
  if (opts.mostrarUsd && (camposMarcados.includes('monto_usd') || !hayMarcas)) {
    metricas.push({
      clave: 'usd',
      etiqueta: 'TOTAL $',
      valor: fmtMontoUsd(fila.montoUsd),
      colorHex: '#22c55e',
      colorRgb: [34, 197, 94],
    });
  }

  // 2. Monto Bs
  if (opts.mostrarBs && (camposMarcados.includes('monto_bs') || !hayMarcas)) {
    metricas.push({
      clave: 'bs',
      etiqueta: 'TOTAL BS',
      valor: fmtMontoBs(fila.montoBs),
      colorHex: '#ff8a00',
      colorRgb: [255, 138, 0],
    });
  }

  // 3. % Participación
  if (fila.pctDelTotal != null && (camposMarcados.includes('pct_total') || !hayMarcas)) {
    metricas.push({
      clave: 'pct',
      etiqueta: '% PARTICIPACIÓN',
      valor: `${fila.pctDelTotal.toFixed(1)}%`,
      colorHex: '#38bdf8',
      colorRgb: [56, 189, 248],
    });
  }

  // 4. Cantidad de movimientos / operaciones
  if (fila.totalOperaciones != null && (camposMarcados.includes('operaciones') || !hayMarcas)) {
    metricas.push({
      clave: 'ops',
      etiqueta: 'MOVIMIENTOS',
      valor: `${fila.totalOperaciones}`,
      colorHex: '#a855f7',
      colorRgb: [168, 85, 247],
    });
  }

  // 5. Tasa de cambio aplicada
  if (camposMarcados.includes('tasa') && fila.tasaAplicada > 0) {
    metricas.push({
      clave: 'tasa',
      etiqueta: 'TASA APLICADA',
      valor: `${fmtMontoNum(fila.tasaAplicada, 2)} $/Bs`,
      colorHex: '#94a3b8',
      colorRgb: [148, 163, 184],
    });
  }

  // 6. Fecha
  if (camposMarcados.includes('fecha') && fila.fecha) {
    const [y, m, d] = (fila.fecha || '').split('-');
    const fechaFmt = y && m && d ? `${d}/${m}/${y}` : fila.fecha;
    metricas.push({
      clave: 'fecha',
      etiqueta: 'FECHA',
      valor: fechaFmt,
      colorHex: '#94a3b8',
      colorRgb: [148, 163, 184],
    });
  }

  // 7. Empresa
  if (camposMarcados.includes('empresa') && (fila.empresaNombre || fila.empresaClave)) {
    metricas.push({
      clave: 'empresa',
      etiqueta: 'EMPRESA',
      valor: fila.empresaNombre || fila.empresaClave,
      colorHex: '#3b82f6',
      colorRgb: [59, 130, 246],
    });
  }

  // 8. Concepto / Servicio
  if (camposMarcados.includes('concepto') && fila.concepto) {
    metricas.push({
      clave: 'concepto',
      etiqueta: 'CONCEPTO / SERVICIO',
      valor: fila.concepto,
      colorHex: '#64748b',
      colorRgb: [100, 116, 139],
    });
  }

  // 9. Categoría de Gasto
  if (camposMarcados.includes('categoria') && (fila.categoriaNombre || fila.categoriaId)) {
    metricas.push({
      clave: 'categoria',
      etiqueta: 'CATEGORÍA',
      valor: fila.categoriaNombre || 'Sin categoría',
      colorHex: '#d97706',
      colorRgb: [217, 119, 6],
    });
  }

  // 10. Proveedor / Beneficiario
  if (camposMarcados.includes('proveedor') && fila.proveedorNombre) {
    metricas.push({
      clave: 'proveedor',
      etiqueta: 'PROVEEDOR / BENEFICIARIO',
      valor: fila.proveedorNombre,
      colorHex: '#ea580c',
      colorRgb: [234, 88, 12],
    });
  }

  // 11. Período
  if (camposMarcados.includes('periodo') && fila.periodo) {
    metricas.push({
      clave: 'periodo',
      etiqueta: 'PERÍODO',
      valor: fila.periodo,
      colorHex: '#6366f1',
      colorRgb: [99, 102, 241],
    });
  }

  // 12. Estado de Pago
  if (camposMarcados.includes('estado') && fila.estadoPago) {
    const lbl = fila.estadoPago === 'pagado' ? 'Pagado' : fila.estadoPago === 'pendiente' ? 'Pendiente' : 'Anulado';
    const hex = fila.estadoPago === 'pagado' ? '#10b981' : fila.estadoPago === 'pendiente' ? '#f59e0b' : '#ef4444';
    const rgb: [number, number, number] = fila.estadoPago === 'pagado' ? [16, 185, 129] : fila.estadoPago === 'pendiente' ? [245, 158, 11] : [239, 68, 68];
    metricas.push({
      clave: 'estado',
      etiqueta: 'ESTADO',
      valor: lbl,
      colorHex: hex,
      colorRgb: rgb,
    });
  }

  // 13. Origen
  if (camposMarcados.includes('origen') && fila.origen) {
    const lbl = fila.origen === 'generado' ? 'Generado' : fila.origen === 'importado' ? 'Importado' : 'Manual';
    metricas.push({
      clave: 'origen',
      etiqueta: 'ORIGEN',
      valor: lbl,
      colorHex: '#0284c7',
      colorRgb: [2, 132, 199],
    });
  }

  // 14. Moneda original
  if (camposMarcados.includes('moneda_orig') && fila.monedaOriginal) {
    metricas.push({
      clave: 'moneda_orig',
      etiqueta: 'DIVISA ORIG.',
      valor: fila.monedaOriginal,
      colorHex: '#8b5cf6',
      colorRgb: [139, 92, 246],
    });
  }

  // 15. Monto original
  if (camposMarcados.includes('monto_orig') && fila.montoOriginal != null) {
    const pref = fila.monedaOriginal === 'Bs' ? 'Bs ' : '$ ';
    metricas.push({
      clave: 'monto_orig',
      etiqueta: 'MONTO ORIG.',
      valor: `${pref}${fmtMontoNum(fila.montoOriginal, 2)}`,
      colorHex: '#06b6d4',
      colorRgb: [6, 182, 212],
    });
  }

  // Fallback seguro si nada quedó marcado o visible
  if (metricas.length === 0) {
    if (opts.mostrarUsd) {
      metricas.push({
        clave: 'usd',
        etiqueta: 'TOTAL $',
        valor: fmtMontoUsd(fila.montoUsd),
        colorHex: '#22c55e',
        colorRgb: [34, 197, 94],
      });
    } else {
      metricas.push({
        clave: 'bs',
        etiqueta: 'TOTAL BS',
        valor: fmtMontoBs(fila.montoBs),
        colorHex: '#ff8a00',
        colorRgb: [255, 138, 0],
      });
    }
  }

  return metricas;
}

/* ───────────── Ordenamiento de filas ───────────── */

export function ordenarFilasAdmin(
  filas: readonly FilaReporteAdmin[],
  criterio: 'usd' | 'bs' | 'fecha' | 'nombre' | 'ops' = 'usd',
  descendente = true,
): FilaReporteAdmin[] {
  const arr = [...filas];
  const factor = descendente ? -1 : 1;

  arr.sort((a, b) => {
    switch (criterio) {
      case 'usd':
        return (a.montoUsd - b.montoUsd) * factor;
      case 'bs':
        return (a.montoBs - b.montoBs) * factor;
      case 'ops':
        return ((a.totalOperaciones ?? 0) - (b.totalOperaciones ?? 0)) * factor;
      case 'fecha':
        return (a.fecha.localeCompare(b.fecha)) * factor;
      case 'nombre': {
        const nomA = a.titulo || a.empresaNombre || a.concepto || '';
        const nomB = b.titulo || b.empresaNombre || b.concepto || '';
        return nomA.localeCompare(nomB, 'es') * factor;
      }
      default:
        return 0;
    }
  });

  return arr;
}

