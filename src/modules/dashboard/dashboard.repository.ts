import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Movimiento, Producto } from '@/shared/lib/types';

export interface DashboardKpis {
  totalProductosActivos: number;
  productosARestablecer: number;
  ordenesPendientes: number;
  valorInventario: number;
}

export interface MovimientoConProducto extends Movimiento {
  producto?: { id: string; sku: string; nombre: string; unidad: string } | null;
}

/**
 * Trae todos los productos activos en una sola query. Los KPIs derivados de
 * productos (conteo, valor de inventario, críticos) se calculan en cliente
 * para evitar tres round-trips a Supabase y mantener consistencia entre cifras.
 */
export async function getProductosActivos(): Promise<Producto[]> {
  // Por páginas: los activos ya rondan las 1.000 filas (tope por respuesta de Supabase).
  return todasLasFilas<Producto>((d, h) =>
    supabase.from('productos').select('*').eq('estado', 'activo').order('id').range(d, h));
}

export async function getOrdenesPendientesCount(): Promise<number> {
  const { count, error } = await supabase
    .from('ordenes')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente');

  if (error) throw error;
  return count ?? 0;
}

export async function getMovimientosRecientes(limit = 8): Promise<MovimientoConProducto[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('*, producto:productos(id, sku, nombre, unidad)')
    .order('at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as MovimientoConProducto[];
}

/** Detección de productos bajo umbral (modo "simple": stock <= stock_min). */
export function detectarCriticos(productos: Producto[]): Producto[] {
  return productos.filter((p) => (p.stock ?? 0) <= (p.stock_min ?? 0));
}

export function calcularValorInventario(productos: Producto[]): number {
  return productos.reduce((acc, p) => acc + (p.stock ?? 0) * (p.precio ?? 0), 0);
}

export async function loadDashboardData() {
  const [productos, ordenesPendientes, movimientos] = await Promise.all([
    getProductosActivos(),
    getOrdenesPendientesCount(),
    getMovimientosRecientes(8),
  ]);

  const criticos = detectarCriticos(productos);
  const kpis: DashboardKpis = {
    totalProductosActivos: productos.length,
    productosARestablecer: criticos.length,
    ordenesPendientes,
    valorInventario: calcularValorInventario(productos),
  };

  return { kpis, criticos, movimientos };
}
