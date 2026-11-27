/* ============================================================
   Golden Touch · Retenciones fiscales (Supabase)
   Cuando al indicar el método de pago de una OC se elige soporte
   "Factura", la orden entra a Retenciones. Aquí se cargan los
   comprobantes fiscales (IVA / ISLR / Municipal) y se finaliza la
   retención. La marca de pago la pone Tesorería automáticamente al
   pagar la OC. Las de "Nota de entrega" NO pasan por aquí (van directo
   a Tesorería).
   Archivos en el bucket `compras-oc` (mismo de factura/retención de OC).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { EstadoOrden, Orden } from '@/shared/lib/types';
import { fechaDesdeAgenteRetencion } from '@/modules/libroFiscal/agenteCondiciones.repository';

const TABLE = 'ordenes';
const BUCKET = 'compras-oc';

export type TipoRetencion = 'iva' | 'islr' | 'municipal';
export const TIPOS_RETENCION: { key: TipoRetencion; label: string }[] = [
  { key: 'iva', label: 'Retención por IVA' },
  { key: 'islr', label: 'Retención por ISLR' },
  { key: 'municipal', label: 'Retención Municipal' },
];

export function labelRetencionModo(v?: string | null): string {
  return v === 'se_paga_despues' ? 'Se paga después'
    : v === 'completo_reembolso' ? 'Se paga completo y luego se reembolsa'
    : '—';
}

export interface RetencionItem {
  orden: Orden;
  proveedorNombre: string;
}

export async function mapProveedores(ids?: string[]): Promise<Map<string, string>> {
  const unicos = ids ? Array.from(new Set(ids.filter(Boolean))) : [];
  if (ids && unicos.length === 0) return new Map();
  const q = supabase.from('proveedores').select('id, razon_social');
  const { data } = unicos.length > 0 ? await q.in('id', unicos) : await q;
  return new Map((data ?? []).map((p) => [p.id as string, p.razon_social as string]));
}

/**
 * Carga órdenes específicas por sus IDs con su nombre de proveedor resuelto.
 * Utilizado por la cola Por Hacer para resolver órdenes de adjuntos que no
 * están en la consulta predeterminada de pendientes/hechas.
 */
export async function listOrdenesPorIds(ids: string[]): Promise<RetencionItem[]> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (unicos.length === 0) return [];
  const { data, error } = await supabase.from(TABLE).select('*').in('id', unicos);
  if (error) throw error;
  const pm = await mapProveedores((data ?? []).map((o) => (o as Orden).proveedor_id as string));
  return (data ?? []).map((o) => ({
    orden: o as Orden,
    proveedorNombre: ((o as Orden).proveedor_id && pm.get((o as Orden).proveedor_id as string)) || '—',
  }));
}

/**
 * Fecha en que la empresa obtuvo la designación/permiso para retener.
 * Por defecto '2026-10-01' si no hay configuración en el Régimen fiscal.
 */
export const FECHA_PERMISO_RETENCION = '2026-10-01';

/**
 * Estatus de compras que por definición contable y tributaria nunca deben retenerse:
 * Órdenes canceladas, desistidas por proveedor o rechazadas.
 */
export const ESTADOS_NUNCA_RETENCION: readonly EstadoOrden[] = ['cancelada', 'desistida_proveedor', 'rechazada'];

/** Comprueba si una orden corresponde al período con autorización de retención (a partir de la fecha de designación)
 *  y si su estado de compras es válido para gestionar retención. */
export function ordenAplicaRetencion(
  o: Orden,
  fechaCorte: string = FECHA_PERMISO_RETENCION,
  estadosPermitidos?: EstadoOrden[],
): boolean {
  if (ESTADOS_NUNCA_RETENCION.includes(o.estado)) return false;
  if (estadosPermitidos && estadosPermitidos.length > 0 && !estadosPermitidos.includes(o.estado)) {
    return false;
  }
  const f = (o.oc_emitida_en || o.oc_creada_en || o.created_at || '').slice(0, 10);
  return f >= fechaCorte;
}

/** Nuevo flujo (30/10/2026): la OC que se retiene DESPUÉS de pagar llega a Retenciones
 *  recién cuando Tesorería la paga; mientras espera el pago no se muestra aquí. */
export function esperaPagoParaRetener(o: Pick<Orden, 'estado' | 'retencion_momento'>): boolean {
  return o.retencion_momento === 'despues_de_pagar' && (o.estado === 'confirmada_metodo' || o.estado === 'oc_aprobada');
}

export function labelRetencionMomento(v?: string | null): string {
  return v === 'antes_de_pagar' ? '🔻 Antes de pagar (Tesorería paga el neto)'
    : v === 'despues_de_pagar' ? '🔺 Después de pagar (Tesorería paga completo)'
    : '';
}

/** Retenciones por realizar: OC con soporte Factura O con factura del proveedor cargada
 *  (al finalizar la OC), aún sin finalizar la retención. Excluye órdenes canceladas/desistidas
 *  y filtra por los estados del Kanban configurados. */
export async function listRetencionesPendientes(estadosPermitidos?: EstadoOrden[]): Promise<RetencionItem[]> {
  const [desdeAgente, { data, error }] = await Promise.all([
    fechaDesdeAgenteRetencion(),
    supabase.from(TABLE).select('*')
      .or('comprobante_tipo.eq.factura,factura_recepcion_path.not.is.null')
      .or('retencion_finalizada.is.null,retencion_finalizada.eq.false')
      .not('estado', 'in', `(${ESTADOS_NUNCA_RETENCION.join(',')})`)
      .gte('created_at', '2026-09-25T00:00:00Z')
      .order('created_at', { ascending: true }),
  ]);
  if (error) throw error;
  const filtradas = (data ?? []).filter((o) => ordenAplicaRetencion(o as Orden, desdeAgente, estadosPermitidos) && !esperaPagoParaRetener(o as Orden));
  const pm = await mapProveedores(filtradas.map((o) => (o as Orden).proveedor_id as string));
  return filtradas
    .map((o) => ({ orden: o as Orden, proveedorNombre: ((o as Orden).proveedor_id && pm.get((o as Orden).proveedor_id as string)) || '—' }));
}

/** Retenciones ya finalizadas (comprobantes cargados). Solo a partir de la vigencia del régimen. */
export async function listRetencionesHechas(): Promise<RetencionItem[]> {
  const [desdeAgente, { data, error }] = await Promise.all([
    fechaDesdeAgenteRetencion(),
    supabase.from(TABLE).select('*')
      .or('comprobante_tipo.eq.factura,factura_recepcion_path.not.is.null')
      .eq('retencion_finalizada', true)
      .gte('created_at', '2026-09-25T00:00:00Z')
      .order('retencion_finalizada_en', { ascending: false }),
  ]);
  if (error) throw error;
  const filtradas = (data ?? []).filter((o) => ordenAplicaRetencion(o as Orden, desdeAgente));
  const pm = await mapProveedores(filtradas.map((o) => (o as Orden).proveedor_id as string));
  return filtradas
    .map((o) => ({ orden: o as Orden, proveedorNombre: ((o as Orden).proveedor_id && pm.get((o as Orden).proveedor_id as string)) || '—' }));
}

export async function contarRetencionesPendientes(estadosPermitidos?: EstadoOrden[]): Promise<number> {
  const [desdeAgente, { data, error }] = await Promise.all([
    fechaDesdeAgenteRetencion(),
    supabase.from(TABLE)
      .select('id, created_at, oc_creada_en, oc_emitida_en, estado, retencion_momento')
      .or('comprobante_tipo.eq.factura,factura_recepcion_path.not.is.null')
      .or('retencion_finalizada.is.null,retencion_finalizada.eq.false')
      .not('estado', 'in', `(${ESTADOS_NUNCA_RETENCION.join(',')})`)
      .gte('created_at', '2026-09-25T00:00:00Z'),
  ]);
  if (error) throw error;
  return (data ?? []).filter((o) => ordenAplicaRetencion(o as unknown as Orden, desdeAgente, estadosPermitidos) && !esperaPagoParaRetener(o as unknown as Orden)).length;
}

async function subirComprobante(ordenId: string, tipo: TipoRetencion, file: File): Promise<{ path: string; nombre: string }> {
  const safe = file.name.replace(/[^\w.-]+/g, '_');
  const path = `${ordenId}/retencion_${tipo}_${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true, contentType: file.type || 'application/pdf',
  });
  if (error) throw error;
  return { path, nombre: file.name };
}

/** URL firmada (10 min) para descargar un comprobante de retención. */
export async function urlRetencion(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Finaliza la retención de una OC: sube los comprobantes provistos (al menos uno
 * es obligatorio) y marca la retención como finalizada. Acepta PDF o imagen.
 */
export async function finalizarRetencion(input: {
  orden: Orden;
  archivos: Partial<Record<TipoRetencion, File>>;
  actor: string;
  /** Permite finalizar sin adjuntar archivos nuevos cuando las retenciones ya constan en el Libro Fiscal o como «no aplica». */
  permitirSinArchivo?: boolean;
}): Promise<void> {
  const entries = (Object.entries(input.archivos) as [TipoRetencion, File | undefined][]).filter(([, f]) => !!f);
  if (!entries.length && !input.permitirSinArchivo) throw new Error('Carga al menos un comprobante de retención (IVA, ISLR o Municipal).');
  for (const [, f] of entries) {
    const file = f as File;
    if (file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      throw new Error('Los comprobantes deben ser PDF o imagen.');
    }
  }
  const patch: Record<string, unknown> = {
    retencion_finalizada: true,
    retencion_finalizada_por: input.actor,
    retencion_finalizada_en: new Date().toISOString(),
  };
  for (const [tipo, file] of entries) {
    const { path, nombre } = await subirComprobante(input.orden.id, tipo, file as File);
    patch[`retencion_${tipo}_path`] = path;
    patch[`retencion_${tipo}_nombre`] = nombre;
  }
  // Sin permiso sobre la OC (o si la OC ya no existe) la base no toca ninguna fila y no
  // da error: se pide la fila de vuelta para no dar por finalizada una retención que no quedó.
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', input.orden.id).select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('No se pudo finalizar la retención: no tienes permiso sobre esta OC o la OC ya no existe. Los comprobantes quedaron subidos; se pueden volver a cargar.');
  }
}

/** Comprobantes cargados en una OC (para mostrar/descargar en Retenciones y Tesorería). */
export function comprobantesDeOrden(o: Orden): { tipo: TipoRetencion; label: string; path: string; nombre: string }[] {
  const out: { tipo: TipoRetencion; label: string; path: string; nombre: string }[] = [];
  for (const { key, label } of TIPOS_RETENCION) {
    const path = (o as unknown as Record<string, string | null>)[`retencion_${key}_path`];
    const nombre = (o as unknown as Record<string, string | null>)[`retencion_${key}_nombre`];
    if (path) out.push({ tipo: key, label, path, nombre: nombre || label });
  }
  return out;
}
