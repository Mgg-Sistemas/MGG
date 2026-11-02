/* ============================================================
   MGG · Compras · ¿Se retiene ANTES o DESPUÉS de pagar? (30-10-2026)

   Regla de la administradora, SOLO con el flujo nuevo de compras prendido
   (`config.compras.revision_almacen`, ver revisionAlmacen.repository.ts):
   al indicar el método de pago, Compras puede marcar el momento de la retención.
     · 'antes'   → la OC aparece en RETENCIONES («antes»); si la retienen antes
                   de que Tesorería pague, el monto a pagar BAJA.
     · 'despues' → ya pagada, aparece en Retenciones para retenerla.
   null = sin marca (flujo viejo, o Compras no la indicó).
   01-11-2026: la retención es OPCIONAL y NO frena el pago: Tesorería paga igual,
   la haya hecho Retenciones o no. Una 'antes' ya pagada sigue en su cola hasta
   que la marquen (para que no se pierda).

   Acá vive lo que no toca la base (base: compras-retencion-momento-2026-10-30.sql).
   ============================================================ */
import type { Orden } from '@/shared/lib/types';

export type RetencionMomento = 'antes' | 'despues';

type OrdenRet = Pick<Orden, 'estado' | 'retencion_momento' | 'retencion_hecha_en'>;

/** Lo que se guarda junto con el método de pago. Si el momento cambia, la retención marcada se borra. */
export function patchRetencionMomento(
  o: Pick<Orden, 'retencion_momento'>,
  momento: RetencionMomento | null | undefined,
): Partial<Pick<Orden, 'retencion_momento' | 'retencion_hecha_en' | 'retencion_hecha_por' | 'retencion_nota'>> {
  if (momento !== 'antes' && momento !== 'despues') return {};
  if ((o.retencion_momento ?? null) === momento) return { retencion_momento: momento };
  return { retencion_momento: momento, retencion_hecha_en: null, retencion_hecha_por: null, retencion_nota: null };
}

/** En qué lista de «OC por retener» cae la orden (null = en ninguna). */
export function colaRetencion(o: OrdenRet): RetencionMomento | null {
  if (o.retencion_hecha_en) return null;
  // 'antes' sigue en su cola aunque Tesorería ya haya pagado (la retención no frena el pago).
  if (o.retencion_momento === 'antes' && (o.estado === 'confirmada_metodo' || o.estado === 'oc_aprobada' || o.estado === 'pagada')) return 'antes';
  if (o.retencion_momento === 'despues' && o.estado === 'pagada') return 'despues';
  return null;
}

/** Reparte las órdenes en las dos colas de Retenciones (cada una, la más vieja primero). */
export function repartirColasRetencion<T extends OrdenRet & { metodo_pago_en?: string | null; created_at?: string | null }>(
  ordenes: T[],
): { antes: T[]; despues: T[] } {
  const antes: T[] = [];
  const despues: T[] = [];
  for (const o of ordenes) {
    const c = colaRetencion(o);
    if (c === 'antes') antes.push(o);
    else if (c === 'despues') despues.push(o);
  }
  const f = (o: T) => String(o.metodo_pago_en ?? o.created_at ?? '');
  const asc = (a: T, b: T) => f(a).localeCompare(f(b));
  return { antes: antes.sort(asc), despues: despues.sort(asc) };
}

/** Texto del distintivo en el detalle de la OC (null = flujo viejo, sin distintivo). */
export function etiquetaRetencionMomento(o: Pick<Orden, 'retencion_momento' | 'retencion_hecha_en'>): string | null {
  if (o.retencion_momento !== 'antes' && o.retencion_momento !== 'despues') return null;
  const cuando = o.retencion_momento === 'antes' ? 'antes de pagar' : 'después de pagar';
  return `Retención: ${cuando} · ${o.retencion_hecha_en ? 'hecha' : 'pendiente'}`;
}

/** Retención hecha ANTES de pagar, anotada por Retenciones (ordenes.retencion_previa). */
export interface RetencionPrevia { bs: number; usd: number; tasa: number | null; monto: number }

export interface EfectoRetencionPago {
  /** 'baja': se paga el total MENOS lo retenido · 'completo': se paga el total y se retiene después. */
  efecto: 'baja' | 'completo';
  retenido: number;
  aPagar: number;
}

/**
 * ¿El monto que paga Tesorería BAJA o va COMPLETO? (30-10-2026)
 * ANTES con retención anotada → baja; DESPUÉS → completo. Sin flujo nuevo → null.
 */
export function efectoRetencionEnPago(
  o: Pick<Orden, 'retencion_momento' | 'retencion_previa' | 'total'>, totalAPagar?: number,
): EfectoRetencionPago | null {
  const total = Number(totalAPagar ?? o.total) || 0;
  if (o.retencion_momento === 'despues') return { efecto: 'completo', retenido: 0, aPagar: total };
  if (o.retencion_momento !== 'antes') return null;
  const retenido = Math.max(0, Number(o.retencion_previa?.monto) || 0);
  if (retenido <= 0) return null;
  return { efecto: 'baja', retenido, aPagar: Math.max(0, Math.round((total - retenido) * 100) / 100) };
}
