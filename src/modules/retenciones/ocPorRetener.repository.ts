/* ============================================================
   MGG · Retenciones · OC por retener (flujo nuevo de compras, 30-10-2026)

   Compras marca al indicar el método de pago si se retiene ANTES o DESPUÉS
   de pagar (`ordenes.retencion_momento`). Retenciones ve dos colas y marca
   la retención hecha con la RPC `compras_marcar_retencion` (security definer:
   valida permiso y que la 'despues' ya esté pagada).
   Ver supabase/sql/compras-retencion-momento-2026-10-30.sql.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Orden } from '@/shared/lib/types';
import { repartirColasRetencion } from '@/modules/pedidos/retencionMomento';

export interface OcPorRetener {
  orden: Orden;
  proveedorNombre: string;
}

export interface ColasOcPorRetener {
  antes: OcPorRetener[];
  despues: OcPorRetener[];
}

export async function listOcPorRetener(): Promise<ColasOcPorRetener> {
  const { data, error } = await supabase.from('ordenes').select('*')
    .not('retencion_momento', 'is', null)
    .is('retencion_hecha_en', null)
    .in('estado', ['confirmada_metodo', 'oc_aprobada', 'pagada'])
    .limit(1000);
  if (error) throw error;
  const ordenes = (data ?? []) as Orden[];
  const ids = [...new Set(ordenes.map((o) => o.proveedor_id).filter(Boolean) as string[])];
  const pm = new Map<string, string>();
  if (ids.length) {
    const { data: provs } = await supabase.from('proveedores').select('id, razon_social').in('id', ids);
    for (const p of provs ?? []) pm.set(p.id as string, p.razon_social as string);
  }
  const { antes, despues } = repartirColasRetencion(ordenes);
  const fila = (orden: Orden): OcPorRetener => ({ orden, proveedorNombre: (orden.proveedor_id && pm.get(orden.proveedor_id)) || '—' });
  return { antes: antes.map(fila), despues: despues.map(fila) };
}

/**
 * Retenciones marca la retención como hecha (o que no aplica, con nota). En las de ANTES
 * de pagar anota cuánto retuvo: Tesorería paga el total MENOS eso (el monto baja).
 */
export async function marcarRetencionHecha(
  ordenId: string, nota?: string | null, monto?: { bs: number; usd: number; tasa: number } | null,
): Promise<Orden> {
  const { data, error } = await supabase.rpc('compras_marcar_retencion', {
    p_orden_id: ordenId, p_nota: nota?.trim() || null,
    p_monto_bs: monto && monto.bs > 0 ? monto.bs : null,
    p_monto_usd: monto && monto.usd > 0 ? monto.usd : null,
    p_tasa: monto && monto.tasa > 0 ? monto.tasa : null,
  });
  if (error) throw new Error(error.message || 'No se pudo marcar la retención');
  return data as Orden;
}
