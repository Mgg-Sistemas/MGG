/* ============================================================
   MGG · Inventario · Motor del Reporte Dinámico · Matanzas (04-11-2026)

   Motor de datos PURO y SÍNCRONO para el reporte dinámico del
   Centro de Fundición Matanzas (CENTRO DE FUNDICION - MATANZAS).
   Sigue el estándar exacto de Tesorería (reporteTesoreriaMoldeable.ts)
   y RRHH (reporteRrhhDinamico.ts).

   Unifica cuatro ámbitos operativos en una sola estructura analítica:
     · stock        → existencias actuales, catálogo, PMP (USD/Bs), mínimos, ABC
     · movimientos  → kárdex histórico (entradas, salidas, transferencias, ajustes)
     · casiterita   → inventario detallado de SnO₂ (lotes, humedad, ley Sn/Fe, kg finos)
     · criticos     → alertas de inventario (bajo mínimo, existencias en $0, mermas)

   REGLA DE ORO: aquí NO se lee de Supabase. Recibe datos en memoria ya leídos
   por reporteInventarioMatanzas.repository.ts más tasas de cambio oficiales BCV.
   Todo el cálculo es determinista y testeable con pruebas unitarias.
   ============================================================ */

import type { Producto, Existencia, Movimiento } from '@/shared/lib/types';
import type { CasiteritaDetalle } from './casiteritaDetalle.repository';

/** Redondeo a 2 decimales para operaciones de moneda y porcentajes. */
export function round2(n: number): number {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

/** Redondeo a 4 decimales para leyes minerales y tasas finas. */
export function round4(n: number): number {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 10000) / 10000;
}

/* ───────────── Tipos de configuración ───────────── */

/** Ámbitos operativos del reporte de Matanzas. */
export type AmbitoInventarioMatanzas = 'stock' | 'movimientos' | 'casiterita' | 'criticos';

export interface AmbitoMatanzasMeta {
  id: AmbitoInventarioMatanzas;
  icon: string;
  label: string;
  descripcion: string;
}

export const AMBITOS_INVENTARIO_MATANZAS: AmbitoMatanzasMeta[] = [
  {
    id: 'stock',
    icon: '📦',
    label: 'Stock y Valuación',
    descripcion: 'Existencias físicas actuales, catálogo, valuación PMP en USD y Bs, clasificación ABC y niveles de seguridad.',
  },
  {
    id: 'movimientos',
    icon: '🔄',
    label: 'Kárdex de Movimientos',
    descripcion: 'Historial de entradas, salidas, traslados entre subalmacenes, ajustes y consumos de fundición.',
  },
  {
    id: 'casiterita',
    icon: '⛏',
    label: 'Casiterita SnO₂ Detallada',
    descripcion: 'Lotes de mineral recepcionados en patio: peso bruto/húmedo, humedad, ley de estaño (% Sn), ley de hierro y kg finos.',
  },
  {
    id: 'criticos',
    icon: '⚠',
    label: 'Críticos y Auditoría',
    descripcion: 'Productos en stock cero, bajo mínimo de seguridad, existencias sin valorizar ($0) e inconsistencias.',
  },
];

/** Dimensiones de agrupación disponibles. */
export type ModoAgrupacionMatanzas =
  | 'subalmacen'
  | 'categoria'
  | 'estado_stock'
  | 'procedencia'
  | 'tipo_movimiento'
  | 'detallado';

export interface AgrupacionMatanzasMeta {
  id: ModoAgrupacionMatanzas;
  icon: string;
  label: string;
}

export const MODOS_AGRUPACION_MATANZAS: AgrupacionMatanzasMeta[] = [
  { id: 'subalmacen', icon: '🏢', label: 'Por Subalmacén' },
  { id: 'categoria', icon: '📁', label: 'Por Categoría' },
  { id: 'estado_stock', icon: '🚦', label: 'Por Estado de Stock' },
  { id: 'tipo_movimiento', icon: '🔄', label: 'Por Tipo de Movimiento' },
  { id: 'procedencia', icon: '📍', label: 'Por Procedencia / Mina' },
  { id: 'detallado', icon: '📋', label: 'Detallado (Fila a fila)' },
];

/** Presets de rangos temporales para kárdex. */
export type PresetRangoMatanzas = 'hoy' | 'semana' | 'mes' | 'mes_anterior' | 'ult30' | 'ult90' | 'anio' | 'todos';

export const PRESETS_RANGO_MATANZAS: { id: PresetRangoMatanzas; label: string }[] = [
  { id: 'todos', label: 'Histórico Completo' },
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mes_anterior', label: 'Mes anterior' },
  { id: 'ult30', label: 'Últimos 30 días' },
  { id: 'ult90', label: 'Últimos 90 días' },
  { id: 'anio', label: 'Este año' },
];

/* ───────────── Catálogo de Columnas ───────────── */

export type FormatoColumnaMatanzas =
  | 'texto'
  | 'numero'
  | 'peso_kg'
  | 'moneda'
  | 'moneda_bs'
  | 'porcentaje'
  | 'fecha';

export interface CampoColumnaMatanzas {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  anchoExcel: number;
  alineacion: 'left' | 'right' | 'center';
  formato: FormatoColumnaMatanzas;
  ambitos: AmbitoInventarioMatanzas[];
}

export const CAMPOS_REPORTE_MATANZAS: CampoColumnaMatanzas[] = [
  // Identificación y clasificación base
  { clave: 'almacen', etiqueta: 'Subalmacén', anchoExcel: 22, alineacion: 'left', formato: 'texto', ambitos: ['stock', 'movimientos', 'casiterita', 'criticos'] },
  { clave: 'sku', etiqueta: 'SKU / Código', anchoExcel: 14, alineacion: 'center', formato: 'texto', ambitos: ['stock', 'movimientos', 'criticos'] },
  { clave: 'nombre', etiqueta: 'Descripción del Producto', anchoExcel: 32, alineacion: 'left', formato: 'texto', ambitos: ['stock', 'movimientos', 'criticos'] },
  { clave: 'categoria', etiqueta: 'Categoría', anchoExcel: 20, alineacion: 'left', formato: 'texto', ambitos: ['stock', 'criticos'] },
  { clave: 'unidad', etiqueta: 'Unidad', anchoExcel: 10, alineacion: 'center', formato: 'texto', ambitos: ['stock', 'movimientos', 'criticos'] },

  // Stock y Valuación
  { clave: 'stock', etiqueta: 'Stock Físico', anchoExcel: 14, alineacion: 'right', formato: 'numero', ambitos: ['stock', 'criticos'] },
  { clave: 'minimo', etiqueta: 'Stock Mínimo', anchoExcel: 14, alineacion: 'right', formato: 'numero', ambitos: ['stock', 'criticos'] },
  { clave: 'deficit', etiqueta: 'Déficit Reposición', anchoExcel: 16, alineacion: 'right', formato: 'numero', ambitos: ['criticos'] },
  { clave: 'costo_usd', etiqueta: 'Costo Unit. PMP ($)', anchoExcel: 18, alineacion: 'right', formato: 'moneda', ambitos: ['stock', 'criticos'] },
  { clave: 'costo_bs', etiqueta: 'Costo Unit. (Bs)', anchoExcel: 18, alineacion: 'right', formato: 'moneda_bs', ambitos: ['stock', 'criticos'] },
  { clave: 'valor_usd', etiqueta: 'Valuación Total ($)', anchoExcel: 20, alineacion: 'right', formato: 'moneda', ambitos: ['stock', 'criticos'] },
  { clave: 'valor_bs', etiqueta: 'Valuación Total (Bs)', anchoExcel: 22, alineacion: 'right', formato: 'moneda_bs', ambitos: ['stock', 'criticos'] },
  { clave: 'estado_stock', etiqueta: 'Estado de Stock', anchoExcel: 16, alineacion: 'center', formato: 'texto', ambitos: ['stock', 'criticos'] },
  { clave: 'clasificacion_abc', etiqueta: 'Clase ABC', anchoExcel: 12, alineacion: 'center', formato: 'texto', ambitos: ['stock'] },
  { clave: 'ubicacion', etiqueta: 'Ubicación / Sector', anchoExcel: 18, alineacion: 'left', formato: 'texto', ambitos: ['stock'] },

  // Kárdex de Movimientos
  { clave: 'fecha', etiqueta: 'Fecha / Hora', anchoExcel: 18, alineacion: 'center', formato: 'fecha', ambitos: ['movimientos'] },
  { clave: 'tipo', etiqueta: 'Tipo Movimiento', anchoExcel: 16, alineacion: 'center', formato: 'texto', ambitos: ['movimientos'] },
  { clave: 'cantidad', etiqueta: 'Cantidad', anchoExcel: 14, alineacion: 'right', formato: 'numero', ambitos: ['movimientos'] },
  { clave: 'costo_unitario', etiqueta: 'Costo Unit. ($)', anchoExcel: 16, alineacion: 'right', formato: 'moneda', ambitos: ['movimientos'] },
  { clave: 'costo_total', etiqueta: 'Total Transacción ($)', anchoExcel: 18, alineacion: 'right', formato: 'moneda', ambitos: ['movimientos'] },
  { clave: 'destino', etiqueta: 'Destino / Receptor', anchoExcel: 22, alineacion: 'left', formato: 'texto', ambitos: ['movimientos'] },
  { clave: 'motivo', etiqueta: 'Motivo / Justificación', anchoExcel: 26, alineacion: 'left', formato: 'texto', ambitos: ['movimientos'] },
  { clave: 'ref_tipo', etiqueta: 'Origen Operativo', anchoExcel: 18, alineacion: 'center', formato: 'texto', ambitos: ['movimientos'] },
  { clave: 'ref_codigo', etiqueta: 'Doc. Referencia', anchoExcel: 16, alineacion: 'center', formato: 'texto', ambitos: ['movimientos'] },
  { clave: 'actor', etiqueta: 'Responsable', anchoExcel: 20, alineacion: 'left', formato: 'texto', ambitos: ['movimientos'] },

  // Casiterita SnO₂
  { clave: 'precinto_lote', etiqueta: 'N° Precinto / Lote', anchoExcel: 18, alineacion: 'center', formato: 'texto', ambitos: ['casiterita'] },
  { clave: 'categoria_envase', etiqueta: 'Tipo Envase', anchoExcel: 16, alineacion: 'center', formato: 'texto', ambitos: ['casiterita'] },
  { clave: 'procedencia', etiqueta: 'Procedencia / Mina', anchoExcel: 22, alineacion: 'left', formato: 'texto', ambitos: ['casiterita'] },
  { clave: 'fecha_recepcion', etiqueta: 'Fecha Recepción', anchoExcel: 16, alineacion: 'center', formato: 'fecha', ambitos: ['casiterita'] },
  { clave: 'peso_humedo', etiqueta: 'Peso Bruto/Húmedo (kg)', anchoExcel: 20, alineacion: 'right', formato: 'peso_kg', ambitos: ['casiterita'] },
  { clave: 'humedad_pct', etiqueta: '% Humedad', anchoExcel: 14, alineacion: 'right', formato: 'porcentaje', ambitos: ['casiterita'] },
  { clave: 'peso_seco', etiqueta: 'Peso Neto Seco (kg)', anchoExcel: 20, alineacion: 'right', formato: 'peso_kg', ambitos: ['casiterita'] },
  { clave: 'ley_sn_pct', etiqueta: 'Ley Sn (%)', anchoExcel: 14, alineacion: 'right', formato: 'porcentaje', ambitos: ['casiterita'] },
  { clave: 'ley_fe_pct', etiqueta: 'Ley Fe (%)', anchoExcel: 14, alineacion: 'right', formato: 'porcentaje', ambitos: ['casiterita'] },
  { clave: 'peso_puro_sn', etiqueta: 'Contenido Fino Sn (kg)', anchoExcel: 20, alineacion: 'right', formato: 'peso_kg', ambitos: ['casiterita'] },
  { clave: 'tasa_usd', etiqueta: 'Tasa ($/kg Sn)', anchoExcel: 16, alineacion: 'right', formato: 'moneda', ambitos: ['casiterita'] },
  { clave: 'estado_lote', etiqueta: 'Estado de Lote', anchoExcel: 16, alineacion: 'center', formato: 'texto', ambitos: ['casiterita'] },
];

/** Presets preconfigurados de columnas según el objetivo del análisis. */
export const COLUMNAS_PRESETS_MATANZAS: Record<
  AmbitoInventarioMatanzas,
  { id: string; label: string; columnas: string[] }[]
> = {
  stock: [
    {
      id: 'estandar',
      label: 'Estándar Operativo',
      columnas: ['almacen', 'sku', 'nombre', 'categoria', 'unidad', 'stock', 'costo_usd', 'valor_usd', 'estado_stock'],
    },
    {
      id: 'financiero',
      label: 'Valuación Monetaria (USD y Bs)',
      columnas: ['almacen', 'sku', 'nombre', 'unidad', 'stock', 'costo_usd', 'costo_bs', 'valor_usd', 'valor_bs', 'clasificacion_abc'],
    },
    {
      id: 'completo',
      label: 'Auditoría Completa',
      columnas: ['almacen', 'sku', 'nombre', 'categoria', 'unidad', 'stock', 'minimo', 'costo_usd', 'costo_bs', 'valor_usd', 'valor_bs', 'estado_stock', 'clasificacion_abc', 'ubicacion'],
    },
  ],
  movimientos: [
    {
      id: 'estandar',
      label: 'Kárdex General',
      columnas: ['fecha', 'tipo', 'almacen', 'sku', 'nombre', 'cantidad', 'unidad', 'destino', 'motivo', 'actor'],
    },
    {
      id: 'costeado',
      label: 'Flujo Económico',
      columnas: ['fecha', 'tipo', 'almacen', 'sku', 'nombre', 'cantidad', 'costo_unitario', 'costo_total', 'ref_tipo', 'ref_codigo'],
    },
    {
      id: 'completo',
      label: 'Auditoría Exhaustiva',
      columnas: ['fecha', 'tipo', 'almacen', 'sku', 'nombre', 'cantidad', 'costo_unitario', 'costo_total', 'destino', 'motivo', 'ref_tipo', 'ref_codigo', 'actor'],
    },
  ],
  casiterita: [
    {
      id: 'estandar',
      label: 'Control de Lotes SnO₂',
      columnas: ['precinto_lote', 'almacen', 'procedencia', 'fecha_recepcion', 'peso_seco', 'ley_sn_pct', 'peso_puro_sn', 'tasa_usd', 'valor_usd'],
    },
    {
      id: 'laboratorio',
      label: 'Ensayos y Leyes Minerales',
      columnas: ['precinto_lote', 'categoria_envase', 'procedencia', 'peso_humedo', 'humedad_pct', 'peso_seco', 'ley_sn_pct', 'ley_fe_pct', 'peso_puro_sn'],
    },
    {
      id: 'completo',
      label: 'Inventario Fino Total',
      columnas: ['precinto_lote', 'categoria_envase', 'almacen', 'procedencia', 'fecha_recepcion', 'peso_humedo', 'humedad_pct', 'peso_seco', 'ley_sn_pct', 'ley_fe_pct', 'peso_puro_sn', 'tasa_usd', 'valor_usd', 'valor_bs', 'estado_lote'],
    },
  ],
  criticos: [
    {
      id: 'estandar',
      label: 'Reposición y Alertas',
      columnas: ['almacen', 'sku', 'nombre', 'categoria', 'stock', 'minimo', 'deficit', 'estado_stock', 'costo_usd', 'valor_usd'],
    },
    {
      id: 'sin_costo',
      label: 'Existencias en $0',
      columnas: ['almacen', 'sku', 'nombre', 'unidad', 'stock', 'costo_usd', 'valor_usd', 'estado_stock'],
    },
  ],
};

/** Columnas seleccionadas por defecto si el usuario no tiene preferencias guardadas. */
export const COLUMNAS_DEFAULT_MATANZAS: Record<AmbitoInventarioMatanzas, string[]> = {
  stock: COLUMNAS_PRESETS_MATANZAS.stock[0].columnas,
  movimientos: COLUMNAS_PRESETS_MATANZAS.movimientos[0].columnas,
  casiterita: COLUMNAS_PRESETS_MATANZAS.casiterita[0].columnas,
  criticos: COLUMNAS_PRESETS_MATANZAS.criticos[0].columnas,
};

/* ───────────── Modelo Unificado de Filas ───────────── */

export interface FilaReporteMatanzas {
  id: string;
  ambito: AmbitoInventarioMatanzas;
  almacen: string;
  sku: string;
  nombre: string;
  categoria: string;
  unidad: string;

  // Stock y Valuación
  stock: number;
  minimo: number;
  deficit: number;
  costo_usd: number;
  costo_bs: number;
  valor_usd: number;
  valor_bs: number;
  estado_stock: string;
  clasificacion_abc: string;
  ubicacion: string;

  // Kárdex
  fecha: string;
  tipo: string;
  cantidad: number;
  costo_unitario: number;
  costo_total: number;
  destino: string;
  motivo: string;
  ref_tipo: string;
  ref_codigo: string;
  actor: string;

  // Casiterita
  precinto_lote: string;
  categoria_envase: string;
  procedencia: string;
  fecha_recepcion: string;
  peso_humedo: number;
  humedad_pct: number;
  peso_seco: number;
  ley_sn_pct: number;
  ley_fe_pct: number;
  peso_puro_sn: number;
  tasa_usd: number;
  estado_lote: string;

  // Extensiones libres
  [key: string]: unknown;
}

/* ───────────── Normalizadores ───────────── */

/** Determina la clasificación ABC según la política de MGG y porcentaje de mínimo. */
export function calcularClasificacionAbc(stock: number, minimo: number): string {
  if (minimo <= 0) return 'C';
  const ratio = stock / minimo;
  if (ratio >= 1.2) return 'A';
  if (ratio >= 1.0) return 'B';
  return 'C';
}

/** Determina la etiqueta de estado semafórico para un artículo. */
export function calcularEstadoStock(stock: number, minimo: number, costoUsd: number): string {
  if (stock <= 0) return 'Sin Stock';
  if (costoUsd <= 0) return 'Sin Costo ($0)';
  if (minimo > 0 && stock <= minimo) return 'Bajo Mínimo';
  return 'Normal';
}

/**
 * Normaliza una existencia de producto en Matanzas.
 */
export function normalizarStockMatanzas(
  p: Producto,
  existencia: Existencia | null,
  subalmacen: string,
  tasaBcv: number,
): FilaReporteMatanzas {
  const stock = existencia ? Number(existencia.stock) || 0 : Number(p.stock) || 0;
  // Costo: se prioriza el costo_promedio guardado en la existencia, luego el del maestro
  const costoUsd = round2(
    existencia && Number(existencia.costo_promedio) > 0
      ? Number(existencia.costo_promedio)
      : Number(p.precio) || 0,
  );
  const costoBs = round2(costoUsd * tasaBcv);
  const valorUsd = round2(stock * costoUsd);
  const valorBs = round2(valorUsd * tasaBcv);
  const minimo = Number(p.stock_min) || 0;
  const deficit = stock < minimo ? round2(minimo - stock) : 0;
  const estadoStock = calcularEstadoStock(stock, minimo, costoUsd);
  const abc = calcularClasificacionAbc(stock, minimo);

  return {
    id: `stock_${p.id}_${subalmacen}`,
    ambito: 'stock',
    almacen: subalmacen || p.almacen || 'General',
    sku: p.sku || '— (sin SKU)',
    nombre: p.nombre || '— (sin nombre)',
    categoria: (p.categoria || 'GENERAL').toUpperCase(),
    unidad: (p.unidad || 'UND').toUpperCase(),
    stock,
    minimo,
    deficit,
    costo_usd: costoUsd,
    costo_bs: costoBs,
    valor_usd: valorUsd,
    valor_bs: valorBs,
    estado_stock: estadoStock,
    clasificacion_abc: abc,
    ubicacion: p.almacen || '—',

    // Campos vacíos de otros ámbitos
    fecha: '',
    tipo: '',
    cantidad: 0,
    costo_unitario: costoUsd,
    costo_total: valorUsd,
    destino: '',
    motivo: '',
    ref_tipo: '',
    ref_codigo: '',
    actor: '',
    precinto_lote: '',
    categoria_envase: '',
    procedencia: '',
    fecha_recepcion: '',
    peso_humedo: 0,
    humedad_pct: 0,
    peso_seco: 0,
    ley_sn_pct: 0,
    ley_fe_pct: 0,
    peso_puro_sn: 0,
    tasa_usd: 0,
    estado_lote: '',
  };
}

/**
 * Normaliza un movimiento de kárdex de Matanzas.
 */
export function normalizarMovimientoMatanzas(
  m: Movimiento,
  prodMap: Map<string, Producto>,
  tasaBcv: number,
): FilaReporteMatanzas {
  const prod = prodMap.get(m.producto_id);
  const cant = Math.abs(Number(m.delta) || 0);
  const costoUnitUsd = round2(
    Number(m.precio_unitario) > 0
      ? Number(m.precio_unitario)
      : Number(m.costo_promedio) > 0
      ? Number(m.costo_promedio)
      : Number(prod?.precio) || 0,
  );
  const costoTotalUsd = round2(cant * costoUnitUsd);
  const costoTotalBs = round2(costoTotalUsd * tasaBcv);

  return {
    id: `mov_${m.id}`,
    ambito: 'movimientos',
    almacen: m.almacen || prod?.almacen || 'General',
    sku: prod?.sku || m.producto?.sku || '—',
    nombre: prod?.nombre || m.producto?.nombre || '—',
    categoria: (prod?.categoria || 'GENERAL').toUpperCase(),
    unidad: (prod?.unidad || m.producto?.unidad || 'UND').toUpperCase(),
    stock: Number(m.stock_despues) || 0,
    minimo: Number(prod?.stock_min) || 0,
    deficit: 0,
    costo_usd: costoUnitUsd,
    costo_bs: round2(costoUnitUsd * tasaBcv),
    valor_usd: costoTotalUsd,
    valor_bs: costoTotalBs,
    estado_stock: 'Normal',
    clasificacion_abc: '—',
    ubicacion: m.almacen || '—',

    fecha: m.at ? m.at.slice(0, 19).replace('T', ' ') : '—',
    tipo: (m.tipo || 'ajuste').toUpperCase(),
    cantidad: cant,
    costo_unitario: costoUnitUsd,
    costo_total: costoTotalUsd,
    destino: m.destino || '—',
    motivo: m.detalle || m.nota_entrega || '—',
    ref_tipo: (m.ref_tipo || 'manual').toUpperCase(),
    ref_codigo: m.ref_codigo || m.ref_id || '—',
    actor: m.actor_name || m.actor || '—',

    precinto_lote: '',
    categoria_envase: '',
    procedencia: '',
    fecha_recepcion: '',
    peso_humedo: 0,
    humedad_pct: 0,
    peso_seco: 0,
    ley_sn_pct: 0,
    ley_fe_pct: 0,
    peso_puro_sn: 0,
    tasa_usd: 0,
    estado_lote: '',
  };
}

/**
 * Normaliza una fila del inventario detallado de casiterita SnO₂.
 */
export function normalizarCasiteritaMatanzas(
  c: CasiteritaDetalle,
  tasaBcv: number,
): FilaReporteMatanzas {
  const pesoNeto = round2(Number(c.peso_neto_kgs) || 0);
  const pesoCasiterita = round2(Number(c.peso_casiterita_kgs) || pesoNeto);
  const promSn = c.prom_sn != null ? round2(Number(c.prom_sn)) : 0;
  const pesoPuroSn = c.peso_puro_sn != null ? round2(Number(c.peso_puro_sn)) : round2(pesoCasiterita * (promSn / 100));
  const tasaUsd = c.tasa != null ? round2(Number(c.tasa)) : 0;
  const valorUsd = round2(pesoCasiterita * tasaUsd);
  const valorBs = round2(valorUsd * tasaBcv);
  const humedad = pesoNeto > 0 ? round2(((pesoNeto - pesoCasiterita) / pesoNeto) * 100) : 0;

  return {
    id: `cas_${c.id}`,
    ambito: 'casiterita',
    almacen: c.almacen || 'ALMACEN CASITERITA',
    sku: c.precinto || `SNO2-${c.id.slice(0, 6)}`,
    nombre: `Casiterita SnO₂ (${c.categoria || 'Lote'}) · ${c.procedencia || 'Sin procedencia'}`,
    categoria: 'MINERAL',
    unidad: 'KG',
    stock: pesoCasiterita,
    minimo: 0,
    deficit: 0,
    costo_usd: tasaUsd,
    costo_bs: round2(tasaUsd * tasaBcv),
    valor_usd: valorUsd,
    valor_bs: valorBs,
    estado_stock: 'En Patio',
    clasificacion_abc: 'A',
    ubicacion: 'Patio de Fundición',

    fecha: c.created_at ? c.created_at.slice(0, 10) : '',
    tipo: 'MINERAL',
    cantidad: pesoCasiterita,
    costo_unitario: tasaUsd,
    costo_total: valorUsd,
    destino: 'Planta de Fundición',
    motivo: c.nota || '—',
    ref_tipo: c.cierre_id ? 'CIERRE' : 'RECEPCION',
    ref_codigo: c.n_analisis || c.precinto || '—',
    actor: c.actor_name || c.actor || '—',

    precinto_lote: c.precinto || '—',
    categoria_envase: (c.categoria || 'BIGBAG').toUpperCase(),
    procedencia: (c.procedencia || '—').toUpperCase(),
    fecha_recepcion: c.created_at ? c.created_at.slice(0, 10) : '—',
    peso_humedo: pesoNeto,
    humedad_pct: humedad,
    peso_seco: pesoCasiterita,
    ley_sn_pct: promSn,
    ley_fe_pct: 0,
    peso_puro_sn: pesoPuroSn,
    tasa_usd: tasaUsd,
    estado_lote: Number(c.stock_kg) > 0 ? 'En patio' : 'Procesado',
  };
}

/* ───────────── Filtros Dinámicos ───────────── */

export interface FiltrosReporteMatanzas {
  subalmacenes: string[];
  categorias: string[];
  texto?: string;
  fechaDesde?: string | null;
  fechaHasta?: string | null;
  estadoStock?: string;
  tipoMovimiento?: string;
  procedencia?: string;
}

/**
 * Filtra una colección de filas según los checks y parámetros seleccionados.
 */
export function filtrarFilasMatanzas(
  filas: FilaReporteMatanzas[],
  filtros: FiltrosReporteMatanzas,
): FilaReporteMatanzas[] {
  const subsSel = Array.isArray(filtros.subalmacenes) ? filtros.subalmacenes : [];
  const catsSel = Array.isArray(filtros.categorias) ? filtros.categorias : [];
  const q = (filtros.texto || '').trim().toLowerCase();
  const desde = filtros.fechaDesde ? filtros.fechaDesde.slice(0, 10) : null;
  const hasta = filtros.fechaHasta ? filtros.fechaHasta.slice(0, 10) : null;
  const estado = filtros.estadoStock && filtros.estadoStock !== 'todos' ? filtros.estadoStock.toLowerCase() : null;
  const tipoMov = filtros.tipoMovimiento && filtros.tipoMovimiento !== 'todos' ? filtros.tipoMovimiento.toLowerCase() : null;
  const proc = filtros.procedencia && filtros.procedencia !== 'todas' ? filtros.procedencia.toLowerCase() : null;

  return filas.filter((fila) => {
    // 1. Filtro estricto por checks de subalmacén
    // Si la lista de subalmacenes viene vacía, no pasa nada (todo excluido).
    if (subsSel.length > 0 && !subsSel.includes(fila.almacen)) {
      return false;
    }
    if (subsSel.length === 0) {
      return false;
    }

    // 2. Filtro por checks de categorías
    if (catsSel.length > 0 && !catsSel.includes(fila.categoria)) {
      return false;
    }

    // 3. Filtro por rango de fechas (kárdex / casiterita)
    if (desde && fila.fecha) {
      const f = fila.fecha.slice(0, 10);
      if (f < desde) return false;
    }
    if (hasta && fila.fecha) {
      const f = fila.fecha.slice(0, 10);
      if (f > hasta) return false;
    }

    // 4. Estado de stock
    if (estado) {
      if (estado === 'critico' && fila.estado_stock !== 'Bajo Mínimo' && fila.estado_stock !== 'Sin Stock') return false;
      if (estado === 'sin_costo' && fila.costo_usd > 0) return false;
      if (estado === 'bajo_minimo' && fila.estado_stock !== 'Bajo Mínimo') return false;
      if (estado === 'normal' && fila.estado_stock !== 'Normal') return false;
    }

    // 5. Tipo de movimiento
    if (tipoMov && fila.tipo.toLowerCase() !== tipoMov) {
      return false;
    }

    // 6. Procedencia (casiterita)
    if (proc && fila.procedencia.toLowerCase() !== proc) {
      return false;
    }

    // 7. Búsqueda libre por texto
    if (q) {
      const match =
        fila.sku.toLowerCase().includes(q) ||
        fila.nombre.toLowerCase().includes(q) ||
        fila.almacen.toLowerCase().includes(q) ||
        fila.categoria.toLowerCase().includes(q) ||
        fila.motivo.toLowerCase().includes(q) ||
        fila.ref_codigo.toLowerCase().includes(q) ||
        fila.actor.toLowerCase().includes(q) ||
        fila.precinto_lote.toLowerCase().includes(q) ||
        fila.procedencia.toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  });
}

/* ───────────── Agrupación y Resumen ───────────── */

export interface GrupoFilasMatanzas {
  claveGrupo: string;
  etiquetaGrupo: string;
  totalFilas: number;
  totalCantidad: number;
  valorTotalUsd: number;
  valorTotalBs: number;
  filas: FilaReporteMatanzas[];
}

/**
 * Agrupa las filas según la dimensión solicitada.
 */
export function agruparFilasMatanzas(
  filas: FilaReporteMatanzas[],
  modo: ModoAgrupacionMatanzas,
): GrupoFilasMatanzas[] {
  if (modo === 'detallado') {
    return [
      {
        claveGrupo: 'todos',
        etiquetaGrupo: 'Todos los registros',
        totalFilas: filas.length,
        totalCantidad: filas.reduce((a, f) => a + f.stock, 0),
        valorTotalUsd: round2(filas.reduce((a, f) => a + f.valor_usd, 0)),
        valorTotalBs: round2(filas.reduce((a, f) => a + f.valor_bs, 0)),
        filas,
      },
    ];
  }

  const mapa = new Map<string, FilaReporteMatanzas[]>();

  for (const fila of filas) {
    let clave = 'Otros';
    switch (modo) {
      case 'subalmacen':
        clave = fila.almacen || 'General';
        break;
      case 'categoria':
        clave = fila.categoria || 'GENERAL';
        break;
      case 'estado_stock':
        clave = fila.estado_stock || 'Normal';
        break;
      case 'tipo_movimiento':
        clave = fila.tipo || 'AJUSTE';
        break;
      case 'procedencia':
        clave = fila.procedencia || 'SIN PROCEDENCIA';
        break;
    }

    const list = mapa.get(clave) ?? [];
    list.push(fila);
    mapa.set(clave, list);
  }

  const grupos: GrupoFilasMatanzas[] = [];
  for (const [clave, items] of mapa.entries()) {
    grupos.push({
      claveGrupo: clave,
      etiquetaGrupo: clave,
      totalFilas: items.length,
      totalCantidad: items.reduce((a, f) => a + (f.ambito === 'movimientos' ? f.cantidad : f.stock), 0),
      valorTotalUsd: round2(items.reduce((a, f) => a + f.valor_usd, 0)),
      valorTotalBs: round2(items.reduce((a, f) => a + f.valor_bs, 0)),
      filas: items,
    });
  }

  // Ordenar por valor descendente o por nombre
  return grupos.sort((a, b) => b.valorTotalUsd - a.valorTotalUsd || a.etiquetaGrupo.localeCompare(b.etiquetaGrupo, 'es'));
}

/* ───────────── Métricas KPI Reactivas ("Sin Discusión") ───────────── */

export interface ResumenReporteMatanzas {
  totalRegistros: number;
  totalUnidades: number;
  valuacionTotalUsd: number;
  valuacionTotalBs: number;
  articulosCriticos: number;
  articulosSinCosto: number;
  pesoSecoKg: number;
  pesoPuroSnKg: number;
  entradasCount: number;
  salidasCount: number;
  tasaBcv: number;
  subalmacenesCount: number;
}

/**
 * Calcula los totales puros y síncronos de un conjunto de filas filtradas.
 */
export function calcularResumenMatanzas(
  filas: FilaReporteMatanzas[],
  tasaBcv: number,
): ResumenReporteMatanzas {
  let totalUnidades = 0;
  let valuacionTotalUsd = 0;
  let articulosCriticos = 0;
  let articulosSinCosto = 0;
  let pesoSecoKg = 0;
  let pesoPuroSnKg = 0;
  let entradasCount = 0;
  let salidasCount = 0;
  const subs = new Set<string>();

  for (const f of filas) {
    if (f.almacen) subs.add(f.almacen);

    if (f.ambito === 'casiterita') {
      pesoSecoKg += f.peso_seco;
      pesoPuroSnKg += f.peso_puro_sn;
      valuacionTotalUsd += f.valor_usd;
    } else if (f.ambito === 'movimientos') {
      if (f.tipo.includes('ENTRADA') || f.tipo.includes('RECEPCION')) entradasCount++;
      if (f.tipo.includes('SALIDA') || f.tipo.includes('TRANSFERENCIA')) salidasCount++;
      valuacionTotalUsd += f.costo_total;
      totalUnidades += f.cantidad;
    } else {
      totalUnidades += f.stock;
      valuacionTotalUsd += f.valor_usd;
      if (f.estado_stock === 'Bajo Mínimo' || f.estado_stock === 'Sin Stock') {
        articulosCriticos++;
      }
      if (f.costo_usd <= 0 && f.stock > 0) {
        articulosSinCosto++;
      }
    }
  }

  valuacionTotalUsd = round2(valuacionTotalUsd);
  const valuacionTotalBs = round2(valuacionTotalUsd * tasaBcv);

  return {
    totalRegistros: filas.length,
    totalUnidades: round2(totalUnidades),
    valuacionTotalUsd,
    valuacionTotalBs,
    articulosCriticos,
    articulosSinCosto,
    pesoSecoKg: round2(pesoSecoKg),
    pesoPuroSnKg: round2(pesoPuroSnKg),
    entradasCount,
    salidasCount,
    tasaBcv,
    subalmacenesCount: subs.size,
  };
}

export interface MetricaFichaMatanzas {
  clave: string;
  etiqueta: string;
  valor: string;
  sub: string;
  colorCss: string;
  colorRgb: [number, number, number];
}

/** Formateo a moneda USD ($) con coma decimal y punto de miles. */
export function fmtMonedaUsd(val: number): string {
  return `$ ${Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formateo a moneda Bs con coma decimal y punto de miles. */
export function fmtMonedaBs(val: number): string {
  return `Bs ${Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formateo a número con separador de miles. */
export function fmtNum(val: number): string {
  return Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Formateo de peso en kilogramos (kg). */
export function fmtPesoKg(val: number): string {
  return `${Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
}

/**
 * Genera las tarjetas KPI ejecutivas para la cabecera del reporte.
 *
 * CUMPLE LA REGLA DE ORO ESTRICTA:
 * Todo responde fielmente a las casillas marcadas (`columnasSel` y `subalmacenesSel`).
 * Si el usuario desmarca la columna que provee la información, el valor se
 * sustituye por `'—'` y el subtítulo indica sutilmente `'(No marcado en checks de columnas)'`.
 * Si no hay subalmacenes seleccionados, se indica sutilmente `'(Ningún subalmacén seleccionado)'`.
 */
export function obtenerMetricasFichaMatanzas(
  resumen: ResumenReporteMatanzas,
  ambito: AmbitoInventarioMatanzas,
  columnasSel?: readonly string[] | null,
  subalmacenesSel?: readonly string[] | null,
): MetricaFichaMatanzas[] {
  const tieneCol = (clave: string) => !columnasSel || columnasSel.includes(clave);
  const sinSubalmacenes = Array.isArray(subalmacenesSel) && subalmacenesSel.length === 0;

  if (sinSubalmacenes) {
    return [
      {
        clave: 'alerta_vacio',
        etiqueta: 'SUBALMACENES',
        valor: '0',
        sub: '(Ningún subalmacén seleccionado)',
        colorCss: 'var(--muted)',
        colorRgb: [140, 150, 160],
      },
      {
        clave: 'items_vacio',
        etiqueta: 'TOTAL ÍTEMS',
        valor: '—',
        sub: '(Marcá al menos un subalmacén en los checks)',
        colorCss: 'var(--muted)',
        colorRgb: [140, 150, 160],
      },
      {
        clave: 'valor_vacio',
        etiqueta: 'VALUACIÓN TOTAL',
        valor: '—',
        sub: '(Sin registros incluidos)',
        colorCss: 'var(--muted)',
        colorRgb: [140, 150, 160],
      },
    ];
  }

  // Ámbito: Kárdex de Movimientos
  if (ambito === 'movimientos') {
    const tieneCostos = tieneCol('costo_unitario') || tieneCol('costo_total');
    const tieneCant = tieneCol('cantidad');

    return [
      {
        clave: 'total_movs',
        etiqueta: 'TOTAL MOVIMIENTOS',
        valor: String(resumen.totalRegistros),
        sub: `${resumen.subalmacenesCount} subalmacén(es) involucrado(s)`,
        colorCss: 'var(--primary)',
        colorRgb: [255, 138, 0],
      },
      {
        clave: 'flujo_unidades',
        etiqueta: 'FLUJO DE MATERIAL',
        valor: tieneCant ? `${fmtNum(resumen.totalUnidades)} unid.` : '—',
        sub: tieneCant
          ? `${resumen.entradasCount} entradas · ${resumen.salidasCount} salidas`
          : '(No marcado en checks de columnas)',
        colorCss: tieneCant ? 'var(--info)' : 'var(--muted)',
        colorRgb: tieneCant ? [52, 152, 219] : [140, 150, 160],
      },
      {
        clave: 'monto_transacciones',
        etiqueta: 'MONTO TRANSACCIONES ($)',
        valor: tieneCostos ? fmtMonedaUsd(resumen.valuacionTotalUsd) : '—',
        sub: tieneCostos
          ? `Equiv. ${fmtMonedaBs(resumen.valuacionTotalBs)}`
          : '(No marcado en checks de columnas)',
        colorCss: tieneCostos ? 'var(--success)' : 'var(--muted)',
        colorRgb: tieneCostos ? [46, 204, 113] : [140, 150, 160],
      },
    ];
  }

  // Ámbito: Casiterita SnO₂ Detallada
  if (ambito === 'casiterita') {
    const tienePesos = tieneCol('peso_seco') || tieneCol('peso_humedo');
    const tieneFino = tieneCol('peso_puro_sn') || tieneCol('ley_sn_pct');
    const tieneValor = tieneCol('valor_usd') || tieneCol('tasa_usd');

    return [
      {
        clave: 'total_lotes',
        etiqueta: 'TOTAL LOTES RECEPCIONADOS',
        valor: String(resumen.totalRegistros),
        sub: `${resumen.subalmacenesCount} subalmacén(es) de patio`,
        colorCss: 'var(--primary)',
        colorRgb: [255, 138, 0],
      },
      {
        clave: 'peso_seco_mineral',
        etiqueta: 'PESO SECO TOTAL',
        valor: tienePesos ? fmtPesoKg(resumen.pesoSecoKg) : '—',
        sub: tienePesos ? 'Mineral SnO₂ acopiado' : '(No marcado en checks de columnas)',
        colorCss: tienePesos ? 'var(--warning)' : 'var(--muted)',
        colorRgb: tienePesos ? [243, 156, 18] : [140, 150, 160],
      },
      {
        clave: 'fino_sn',
        etiqueta: 'ESTAÑO FINO PURO (Sn)',
        valor: tieneFino ? fmtPesoKg(resumen.pesoPuroSnKg) : '—',
        sub: tieneFino ? 'Contenido metálico recuperable' : '(No marcado en checks de columnas)',
        colorCss: tieneFino ? 'var(--info)' : 'var(--muted)',
        colorRgb: tieneFino ? [52, 152, 219] : [140, 150, 160],
      },
      {
        clave: 'valor_mineral',
        etiqueta: 'VALUACIÓN MINERAL ($)',
        valor: tieneValor ? fmtMonedaUsd(resumen.valuacionTotalUsd) : '—',
        sub: tieneValor
          ? `Equiv. ${fmtMonedaBs(resumen.valuacionTotalBs)}`
          : '(No marcado en checks de columnas)',
        colorCss: tieneValor ? 'var(--success)' : 'var(--muted)',
        colorRgb: tieneValor ? [46, 204, 113] : [140, 150, 160],
      },
    ];
  }

  // Ámbito: Críticos y Auditoría
  if (ambito === 'criticos') {
    const tieneStock = tieneCol('stock') || tieneCol('deficit');
    const tieneCostos = tieneCol('costo_usd') || tieneCol('valor_usd');

    return [
      {
        clave: 'articulos_alerta',
        etiqueta: 'ARTÍCULOS CON INCIDENCIA',
        valor: String(resumen.totalRegistros),
        sub: `${resumen.articulosCriticos} bajo stock mínimo`,
        colorCss: 'var(--danger)',
        colorRgb: [231, 76, 60],
      },
      {
        clave: 'sin_costo',
        etiqueta: 'EXISTENCIAS EN $0',
        valor: tieneCostos ? String(resumen.articulosSinCosto) : '—',
        sub: tieneCostos ? 'Requieren asignación de costo PMP' : '(No marcado en checks de columnas)',
        colorCss: tieneCostos && resumen.articulosSinCosto > 0 ? 'var(--warning)' : 'var(--muted)',
        colorRgb: tieneCostos && resumen.articulosSinCosto > 0 ? [243, 156, 18] : [140, 150, 160],
      },
      {
        clave: 'unidades_comprometidas',
        etiqueta: 'UNIDADES EN DÉFICIT',
        valor: tieneStock ? fmtNum(resumen.totalUnidades) : '—',
        sub: tieneStock ? 'Unidades en riesgo de quiebre' : '(No marcado en checks de columnas)',
        colorCss: tieneStock ? 'var(--info)' : 'var(--muted)',
        colorRgb: tieneStock ? [52, 152, 219] : [140, 150, 160],
      },
    ];
  }

  // Ámbito: Stock y Valuación (General)
  const tieneStock = tieneCol('stock');
  const tieneValuacion = tieneCol('costo_usd') || tieneCol('valor_usd') || tieneCol('costo_bs') || tieneCol('valor_bs');
  const tieneMinimo = tieneCol('minimo') || tieneCol('estado_stock');

  return [
    {
      clave: 'total_articulos',
      etiqueta: 'CATÁLOGO DE EXISTENCIAS',
      valor: String(resumen.totalRegistros),
      sub: tieneStock ? `${fmtNum(resumen.totalUnidades)} unidades totales` : '(Columna stock no marcada)',
      colorCss: 'var(--primary)',
      colorRgb: [255, 138, 0],
    },
    {
      clave: 'valor_total',
      etiqueta: 'VALUACIÓN TOTAL MATANZAS',
      valor: tieneValuacion ? fmtMonedaUsd(resumen.valuacionTotalUsd) : '—',
      sub: tieneValuacion
        ? `Equiv. ${fmtMonedaBs(resumen.valuacionTotalBs)} (BCV: ${fmtNum(resumen.tasaBcv)})`
        : '(No marcado en checks de columnas)',
      colorCss: tieneValuacion ? 'var(--success)' : 'var(--muted)',
      colorRgb: tieneValuacion ? [46, 204, 113] : [140, 150, 160],
    },
    {
      clave: 'criticos_alerta',
      etiqueta: 'ALERTAS DE STOCK',
      valor: tieneMinimo ? String(resumen.articulosCriticos) : '—',
      sub: tieneMinimo
        ? `${resumen.articulosSinCosto} existencias sin costo ($0)`
        : '(No marcado en checks de columnas)',
      colorCss: tieneMinimo && resumen.articulosCriticos > 0 ? 'var(--danger)' : 'var(--muted)',
      colorRgb: tieneMinimo && resumen.articulosCriticos > 0 ? [231, 76, 60] : [140, 150, 160],
    },
    {
      clave: 'subalmacenes_activos',
      etiqueta: 'SUBALMACENES MATANZAS',
      valor: String(resumen.subalmacenesCount),
      sub: 'Áreas operativas reportadas',
      colorCss: 'var(--info)',
      colorRgb: [52, 152, 219],
    },
  ];
}

/* ───────────── Formateo de Celdas y Valores ───────────── */

/**
 * Formatea el valor de una celda para presentación en tabla o exportaciones.
 * Si el dato no existe o está vacío, retorna una indicación sutil ('— (sin registrar)' o '—').
 */
export function formatearCeldaMatanzas(
  valor: unknown,
  formato: FormatoColumnaMatanzas,
  clave: string,
): string {
  if (valor == null || valor === '') {
    if (clave === 'motivo' || clave === 'actor' || clave === 'destino' || clave === 'ref_codigo') {
      return '— (sin registrar)';
    }
    return '—';
  }

  switch (formato) {
    case 'moneda':
      return fmtMonedaUsd(Number(valor) || 0);
    case 'moneda_bs':
      return fmtMonedaBs(Number(valor) || 0);
    case 'peso_kg':
      return fmtPesoKg(Number(valor) || 0);
    case 'porcentaje':
      return `${round2(Number(valor) || 0)} %`;
    case 'numero':
      return fmtNum(Number(valor) || 0);
    case 'fecha':
      return String(valor);
    case 'texto':
    default:
      return String(valor);
  }
}

