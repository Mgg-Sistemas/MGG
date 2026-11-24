/* ============================================================
   Golden Touch · Retenciones · Monto neto con que se pagó una OC

   LECTURA CRUZADA A TESORERÍA — EXCEPCIÓN DE ALCANCE autorizada por el usuario
   (1/11/2026). Solo lectura: NO escribe nada en Tesorería ni la modifica. Lee los
   egresos reales del pago de la orden en `movimientos_caja` (los que de verdad
   salieron de caja) para mostrar «Pagada: Bs X» en el estado y en el WhatsApp.

   El pago de una OC crea egresos (tipo 'salida') con categoría 'pago_oc' y
   `ref_orden_id` apuntando a la orden (ver tesoreria.repository.pagarOrden). El
   excedente de un sobrepago sale aparte como 'reembolso_oc' y NO cuenta como pago.
   Si el pago salió en más de una moneda (multi-caja) no se puede representar como
   un solo monto: se devuelve null y quien llama cae a «✓ Pagada» sin monto.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

const MOVIMIENTOS = 'movimientos_caja';

export interface MontoPagado { monto: number; moneda: string }

/** Una fila de egreso que nos interesa (lo mínimo para sumar el neto). */
export interface EgresoOc { monto: number | null; moneda: string | null; categoria?: string | null; tipo?: string | null }

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * El neto pagado de una OC a partir de sus egresos: suma los 'pago_oc' por moneda.
 * Si hay una sola moneda con monto, la devuelve; si hay varias (multi-caja) o
 * ninguna, devuelve null (no se puede dar un monto fiable). Pura: sin base.
 */
export function netoPagadoOc(egresos: readonly EgresoOc[]): MontoPagado | null {
  const porMoneda = new Map<string, number>();
  for (const e of egresos) {
    if ((e.categoria ?? 'pago_oc') !== 'pago_oc') continue;
    const mon = String(e.moneda ?? '').trim();
    if (!mon) continue;
    porMoneda.set(mon, (porMoneda.get(mon) ?? 0) + (Number(e.monto) || 0));
  }
  const conMonto = [...porMoneda.entries()].filter(([, v]) => Math.abs(v) > 0.005);
  if (conMonto.length !== 1) return null;
  const [moneda, monto] = conMonto[0];
  return { monto: r2(monto), moneda };
}

/** El neto pagado de una OC (lectura cruzada a Tesorería, solo lectura). */
export async function montoPagadoDeOrden(ordenId: string): Promise<MontoPagado | null> {
  const { data, error } = await supabase.from(MOVIMIENTOS)
    .select('monto, moneda, categoria, tipo')
    .eq('ref_orden_id', ordenId).eq('tipo', 'salida').eq('categoria', 'pago_oc');
  if (error || !data) return null;
  return netoPagadoOc(data as EgresoOc[]);
}

/**
 * El neto pagado de varias OC en una sola consulta (para listas). Devuelve solo
 * las que tienen un monto fiable. Lectura cruzada a Tesorería, solo lectura.
 */
export async function montosPagadosDeOrdenes(ordenIds: readonly string[]): Promise<Map<string, MontoPagado>> {
  const out = new Map<string, MontoPagado>();
  const ids = [...new Set(ordenIds)].filter(Boolean);
  if (!ids.length) return out;
  const { data, error } = await supabase.from(MOVIMIENTOS)
    .select('ref_orden_id, monto, moneda, categoria, tipo')
    .in('ref_orden_id', ids).eq('tipo', 'salida').eq('categoria', 'pago_oc');
  if (error || !data) return out;
  const porOrden = new Map<string, EgresoOc[]>();
  for (const row of data as (EgresoOc & { ref_orden_id?: string | null })[]) {
    const id = String(row.ref_orden_id ?? '');
    if (!id) continue;
    (porOrden.get(id) ?? porOrden.set(id, []).get(id)!).push(row);
  }
  for (const [id, egresos] of porOrden) {
    const neto = netoPagadoOc(egresos);
    if (neto) out.set(id, neto);
  }
  return out;
}
