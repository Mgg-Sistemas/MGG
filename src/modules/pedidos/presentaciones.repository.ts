/* ============================================================
   MGG · Compras · Presentación de compra por proveedor (05-10-2026)

   Cada proveedor vende el producto en su medida (bulto de 50 kg, saco de
   25 kg…). Se recuerda la última con la que cotizó, para sugerirla en la
   próxima oferta. Si el proveedor nunca lo cotizó, se sugiere la de la ficha
   (`productos.unidad_compra` + `unidades_empaque`).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ItemOrden } from '@/shared/lib/types';
import { normalizarUnidad, presentacionSugerida, type PresentacionCompra } from './unidadCompra';

const TABLE = 'producto_presentaciones_proveedor';

/** Fichas de los productos: su unidad de uso y su presentación por defecto. */
export interface FichaCompra {
  id: string;
  unidad: string | null;
  unidad_compra: string | null;
  unidades_empaque: number | null;
}

/** Lo que sabe el sistema para sugerir: memoria del proveedor + fichas. */
export interface ContextoPresentaciones {
  delProveedor: Map<string, PresentacionCompra>;   // producto_id → presentación
  fichas: Map<string, FichaCompra>;               // producto_id → ficha
}

export async function contextoPresentaciones(proveedorId: string | null, productoIds: string[]): Promise<ContextoPresentaciones> {
  const ids = [...new Set(productoIds.filter(Boolean))];
  const vacio: ContextoPresentaciones = { delProveedor: new Map(), fichas: new Map() };
  if (!ids.length) return vacio;
  const [fichasRes, provRes] = await Promise.all([
    supabase.from('productos').select('id, unidad, unidad_compra, unidades_empaque').in('id', ids),
    proveedorId
      ? supabase.from(TABLE).select('producto_id, unidad_compra, factor_compra').eq('proveedor_id', proveedorId).in('producto_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (fichasRes.error) throw new Error(fichasRes.error.message);
  if (provRes.error) throw new Error(provRes.error.message);
  for (const f of (fichasRes.data ?? []) as FichaCompra[]) vacio.fichas.set(f.id, f);
  for (const r of (provRes.data ?? []) as Array<{ producto_id: string; unidad_compra: string; factor_compra: number }>) {
    vacio.delProveedor.set(r.producto_id, { unidad_compra: r.unidad_compra, factor_compra: Number(r.factor_compra) });
  }
  return vacio;
}

/** La presentación sugerida para un producto con ese proveedor (o null: se compra en la unidad de uso). */
export function sugerirPara(ctx: ContextoPresentaciones, productoId: string | undefined | null): PresentacionCompra | null {
  if (!productoId) return null;
  return presentacionSugerida(ctx.delProveedor.get(productoId), ctx.fichas.get(productoId));
}

/** Guarda lo que cotizó el proveedor (solo renglones con producto y unidad de compra). */
export async function recordarPresentaciones(proveedorId: string, items: ItemOrden[], actor: string): Promise<void> {
  const porProducto = new Map<string, { producto_id: string; proveedor_id: string; unidad_compra: string; factor_compra: number; actualizado_por: string; updated_at: string }>();
  const ahora = new Date().toISOString();
  for (const it of items) {
    const uc = normalizarUnidad(it.unidad_compra);
    const f = Number(it.factor_compra);
    if (!it.productoId || !uc || !(f > 0)) continue;
    porProducto.set(it.productoId, { producto_id: it.productoId, proveedor_id: proveedorId, unidad_compra: uc, factor_compra: f, actualizado_por: actor, updated_at: ahora });
  }
  if (!porProducto.size) return;
  const { error } = await supabase.from(TABLE).upsert([...porProducto.values()], { onConflict: 'producto_id,proveedor_id' });
  if (error) throw new Error(error.message);
}
