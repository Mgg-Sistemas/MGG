import { supabase } from '@/shared/lib/supabase';
import { PAGINA_SUPABASE, todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Almacen, Existencia, Movimiento, Producto } from '@/shared/lib/types';
import { listAlmacenes, listExistencias } from '@/modules/inventario/almacenes.repository';
import { nombreSedeCorto, SIN_SEDE } from '@/modules/inventario/stockPorAlmacen';

export interface DashboardKpis {
  totalProductosActivos: number;
  productosARestablecer: number;
  ordenesPendientes: number;
  valorInventario: number;
  /** El mismo valor repartido por sede (suma exactamente valorInventario). */
  valorPorSede: ValorSede[];
}

export interface ValorSede { sede: string; valor: number }

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
    supabase.from('productos').select('*').eq('estado', 'activo').order('id').range(d, h), PAGINA_SUPABASE, 2);
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

/**
 * Reparte el valor del inventario (stock × precio del catálogo, activos) por SEDE,
 * según dónde está el stock (existencias por almacén → sede del almacén). Usa el
 * mismo precio que la tarjeta, así las partes suman el total. Si queda stock del
 * producto sin existencia asignada, esa diferencia va a «Sin sede».
 */
export function calcularValorPorSede(
  productos: Pick<Producto, 'id' | 'stock' | 'precio'>[],
  existencias: Pick<Existencia, 'producto_id' | 'almacen' | 'stock'>[],
  almacenes: Pick<Almacen, 'nombre' | 'sede'>[],
): ValorSede[] {
  const precio = new Map(productos.map((p) => [p.id, Number(p.precio) || 0]));
  const sedeDe = new Map(almacenes.map((a) => [a.nombre, nombreSedeCorto(a.sede)]));
  const porSede = new Map<string, number>();
  const ubicado = new Map<string, number>();
  for (const e of existencias) {
    const pr = precio.get(e.producto_id);
    if (pr === undefined) continue;                  // producto inactivo: no cuenta
    const st = Number(e.stock) || 0;
    const sede = sedeDe.get(e.almacen) ?? SIN_SEDE;
    porSede.set(sede, (porSede.get(sede) ?? 0) + st * pr);
    ubicado.set(e.producto_id, (ubicado.get(e.producto_id) ?? 0) + st);
  }
  for (const p of productos) {
    const resto = (Number(p.stock) || 0) - (ubicado.get(p.id) ?? 0);
    if (Math.abs(resto) > 1e-9) porSede.set(SIN_SEDE, (porSede.get(SIN_SEDE) ?? 0) + resto * (Number(p.precio) || 0));
  }
  return [...porSede.entries()]
    .map(([sede, valor]) => ({ sede, valor: Math.round(valor * 100) / 100 }))
    .filter((x) => Math.abs(x.valor) >= 0.005)
    .sort((a, b) => b.valor - a.valor);
}

export async function loadDashboardData() {
  const [productos, ordenesPendientes, movimientos, existencias, almacenes] = await Promise.all([
    getProductosActivos(),
    getOrdenesPendientesCount(),
    getMovimientosRecientes(8),
    listExistencias().catch(() => [] as Existencia[]),
    listAlmacenes().catch(() => [] as Almacen[]),
  ]);

  const criticos = detectarCriticos(productos);
  const kpis: DashboardKpis = {
    totalProductosActivos: productos.length,
    productosARestablecer: criticos.length,
    ordenesPendientes,
    valorInventario: calcularValorInventario(productos),
    valorPorSede: existencias.length ? calcularValorPorSede(productos, existencias, almacenes) : [],
  };

  return { kpis, criticos, movimientos };
}
