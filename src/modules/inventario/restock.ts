/* ============================================================
   MGG · Inventario · Restock
   Clasificación ABC (Pareto) y detección de productos a
   reabastecer. Portado desde docs/reference/demo-old/src-full/
   shared/restock.js.

   ABC: el ~80% del valor del inventario se concentra en el
   ~20% de SKUs. Esa minoría (clase A) merece mayor control.
     Clase A → 0% – 80%   del valor acumulado
     Clase B → 80% – 95%
     Clase C → 95% – 100%
   ============================================================ */
import type { Producto } from '@/shared/lib/types';

export type AbcClass = 'A' | 'B' | 'C';

export type RestockMode = 'simple' | 'abc' | 'detallado';

export interface RestockPolicy {
  mode: RestockMode;
  /** % de stockMin (simple · fallback en detallado) */
  thresholdGlobal: number;
  /** % de stockMin por clase ABC */
  thresholdsByClass: Record<AbcClass, number>;
}

export const DEFAULT_POLICY: RestockPolicy = {
  mode: 'abc',
  thresholdGlobal: 100,
  thresholdsByClass: { A: 120, B: 100, C: 80 },
};

/**
 * Clasificación ABC (Pareto) por valor de inventario (stock × precio).
 * Devuelve Map<productoId, 'A'|'B'|'C'>. Productos sin valor → 'C'.
 */
export function classifyABC(productos: Producto[]): Map<string, AbcClass> {
  const result = new Map<string, AbcClass>();

  const items = (productos ?? [])
    .filter((p) => p.estado === 'activo')
    .map((p) => ({ id: p.id, valor: (p.stock ?? 0) * (p.precio ?? 0) }))
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  const total = items.reduce((acc, x) => acc + x.valor, 0);
  if (total === 0) {
    (productos ?? []).forEach((p) => result.set(p.id, 'C'));
    return result;
  }

  let acumulado = 0;
  items.forEach((x) => {
    acumulado += x.valor;
    const ratio = acumulado / total;
    if (ratio <= 0.8) result.set(x.id, 'A');
    else if (ratio <= 0.95) result.set(x.id, 'B');
    else result.set(x.id, 'C');
  });

  // Productos sin valor (stock 0 o precio 0) → C
  (productos ?? []).forEach((p) => {
    if (!result.has(p.id)) result.set(p.id, 'C');
  });

  return result;
}

/**
 * Porcentaje efectivo de stockMin que dispara la alerta para un producto,
 * según el modo de política activo.
 */
export function effectivePct(
  producto: Producto,
  policy: RestockPolicy,
  classMap?: Map<string, AbcClass>,
): number {
  if (policy.mode === 'detallado') {
    if (producto.restock_pct != null) return Number(producto.restock_pct);
    return policy.thresholdGlobal ?? 100;
  }
  if (policy.mode === 'abc') {
    const klass = classMap?.get(producto.id) ?? 'C';
    return policy.thresholdsByClass[klass] ?? 100;
  }
  return policy.thresholdGlobal ?? 100;
}

/** Umbral efectivo en unidades que dispara la alerta. */
export function effectiveThreshold(
  producto: Producto,
  policy: RestockPolicy,
  classMap?: Map<string, AbcClass>,
): number {
  const min = producto.stock_min ?? 0;
  const pct = effectivePct(producto, policy, classMap);
  return Math.ceil(min * (pct / 100));
}

export function hasCustomPct(producto: Producto): boolean {
  return producto.restock_pct != null;
}

export function needsRestock(
  producto: Producto,
  policy: RestockPolicy,
  classMap?: Map<string, AbcClass>,
): boolean {
  return (producto.stock ?? 0) <= effectiveThreshold(producto, policy, classMap);
}

export function isCritical(producto: Producto): boolean {
  return (producto.stock ?? 0) < (producto.stock_min ?? 0);
}

/** Anotaciones derivadas para la tabla y los filtros. */
export interface ProductoDecorado extends Producto {
  _klass: AbcClass;
  _threshold: number;
  _pct: number;
  _hasCustom: boolean;
  _needsRestock: boolean;
  _critical: boolean;
  _valor: number;
}

export function decorate(
  productos: Producto[],
  policy: RestockPolicy = DEFAULT_POLICY,
): ProductoDecorado[] {
  const classMap = classifyABC(productos);
  return productos
    .map((p) => ({
      ...p,
      _klass: classMap.get(p.id) ?? 'C',
      _threshold: effectiveThreshold(p, policy, classMap),
      _pct: effectivePct(p, policy, classMap),
      _hasCustom: hasCustomPct(p),
      _needsRestock: needsRestock(p, policy, classMap),
      _critical: isCritical(p),
      _valor: (p.stock ?? 0) * (p.precio ?? 0),
    }))
    // Listas de inventario / depósito / centros / almacenes SIEMPRE alfabéticas A→Z
    // (insensible a mayúsculas y acentos, con orden natural para los números).
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { numeric: true, sensitivity: 'base' }));
}
