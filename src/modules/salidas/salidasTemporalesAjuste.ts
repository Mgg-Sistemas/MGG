/* ============================================================
   MGG · Salidas Temporales · ajuste de stock al editar
   Una salida aprobada o en tránsito ya descontó su material. Si se
   editan los materiales, solo se mueve la DIFERENCIA por producto y
   almacén: más cantidad → sale lo que falta; menos → reingresa lo que
   sobra. Los ítems «nuevos» (fuera de inventario) no mueven stock.
   ============================================================ */
import type { ItemSalidaTemporal } from '@/shared/lib/types';

export interface AjusteStockSalidaTemporal {
  producto_id: string;
  almacen: string;
  producto_nombre: string;
  /** > 0: sale más material del inventario; < 0: reingresa. */
  delta: number;
}

function totales(items: ItemSalidaTemporal[] | null | undefined) {
  const m = new Map<string, { producto_id: string; almacen: string; producto_nombre: string; cantidad: number }>();
  for (const it of items ?? []) {
    if (it.es_nuevo || !it.producto_id || !it.almacen) continue;
    const c = Number(it.cantidad) || 0;
    if (c <= 0) continue;
    const k = `${it.producto_id}|${it.almacen}`;
    const cur = m.get(k);
    if (cur) cur.cantidad += c;
    else m.set(k, { producto_id: it.producto_id, almacen: it.almacen, producto_nombre: it.producto_nombre, cantidad: c });
  }
  return m;
}

/** Diferencias de stock entre los materiales anteriores y los nuevos (sin ceros). */
export function ajustesDeStock(
  antes: ItemSalidaTemporal[] | null | undefined,
  despues: ItemSalidaTemporal[] | null | undefined,
): AjusteStockSalidaTemporal[] {
  const a = totales(antes);
  const d = totales(despues);
  const out: AjusteStockSalidaTemporal[] = [];
  for (const k of new Set([...a.keys(), ...d.keys()])) {
    const x = a.get(k);
    const y = d.get(k);
    const delta = Math.round(((y?.cantidad ?? 0) - (x?.cantidad ?? 0)) * 1e6) / 1e6;
    if (delta === 0) continue;
    const ref = (y ?? x)!;
    out.push({ producto_id: ref.producto_id, almacen: ref.almacen, producto_nombre: ref.producto_nombre, delta });
  }
  return out;
}
