/* ============================================================
   MGG · Inventario · Cola de productos sin costo
   Lee las existencias con stock pero valoradas en $0 y busca en el
   historial de compras un precio para sugerir.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { filasSinCosto, type FilaExistencia, type FilaSinCosto, type PrecioHistorico } from './sinCosto';

/**
 * Existencias CON stock, con su producto resuelto.
 *
 * El filtro por stock va en el servidor (descarta la mayor parte de la tabla),
 * pero quién cuenta como «sin costo» lo decide `filasSinCosto`, que está
 * testeada y ya contempla el costo en null y en 0. Así la regla vive en un
 * solo lugar y el contador del botón no puede desalinearse de la lista.
 */
async function leerExistenciasConStock(): Promise<FilaExistencia[]> {
  const { data, error } = await supabase
    .from('existencias')
    .select('producto_id, almacen, stock, costo_promedio, producto:productos(sku, nombre, unidad, categoria, estado)')
    .gt('stock', 0);
  if (error) throw error;

  type Row = {
    producto_id: string;
    almacen: string | null;
    stock: number | null;
    costo_promedio: number | null;
    producto: { sku: string; nombre: string; unidad: string | null; categoria: string | null; estado: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[])
    // Un producto dado de baja no se valora: ya no participa de los reportes.
    .filter((r) => r.producto && r.producto.estado !== 'inactivo')
    .map((r) => ({
      producto_id: r.producto_id,
      almacen: (r.almacen || 'General').trim() || 'General',
      stock: r.stock,
      costo_promedio: r.costo_promedio,
      sku: r.producto!.sku,
      nombre: r.producto!.nombre,
      unidad: r.producto!.unidad,
      categoria: r.producto!.categoria,
    }));
}

/**
 * Precios ya pagados por esos SKU, sacados de las órdenes de compra.
 * Es la única fuente confiable del sistema: las compras directas guardan
 * el gasto total pero no el precio unitario, así que no sirven acá.
 */
async function leerHistorialPrecios(skus: Set<string>): Promise<PrecioHistorico[]> {
  if (!skus.size) return [];
  const { data, error } = await supabase
    .from('ordenes')
    .select('codigo, items')
    .not('items', 'is', null);
  if (error) throw error;

  const out: PrecioHistorico[] = [];
  for (const o of (data ?? []) as Array<{ codigo: string | null; items: unknown }>) {
    if (!Array.isArray(o.items)) continue;
    for (const it of o.items as Array<Record<string, unknown>>) {
      const sku = String(it?.sku ?? '').trim();
      if (!sku || !skus.has(sku)) continue;
      const precio = Number(it?.precio) || 0;
      if (precio <= 0) continue;
      out.push({ sku, precio, origen: (o.codigo || 'una orden anterior').trim() });
    }
  }
  return out;
}

/** Cola completa lista para pintar: filas a valorar + sugerencias. */
export async function listarSinCosto(): Promise<FilaSinCosto[]> {
  const conStock = await leerExistenciasConStock();
  // El historial se busca DESPUÉS de filtrar: no tiene sentido recorrer las
  // órdenes por productos que ya están valorados.
  const pendientes = filasSinCosto(conStock);
  const historial = await leerHistorialPrecios(new Set(pendientes.map((f) => f.sku)));
  return filasSinCosto(conStock, historial);
}

/**
 * Cuántas existencias están esperando precio (contador del botón).
 * Usa la MISMA regla que arma la lista, para que el número del botón no
 * prometa filas que la pantalla después descarta.
 */
export async function contarSinCosto(): Promise<number> {
  return filasSinCosto(await leerExistenciasConStock()).length;
}
