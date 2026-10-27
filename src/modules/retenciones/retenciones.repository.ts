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
import type { Orden } from '@/shared/lib/types';
import { fechaDesdeAgenteRetencion } from '@/modules/libroFiscal/agenteCondiciones.repository';
import { getConfigRetencion } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { estatusKanbanHabilitados, ordenTieneEstatusRetencion, ESTATUS_KANBAN_DEFECTO } from './retencionesKanban';

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

async function mapProveedores(): Promise<Map<string, string>> {
  const { data } = await supabase.from('proveedores').select('id, razon_social');
  return new Map((data ?? []).map((p) => [p.id as string, p.razon_social as string]));
}

/**
 * Fecha en que la empresa obtuvo la designación/permiso para retener.
 * Por defecto '2026-10-01' si no hay configuración en el Régimen fiscal.
 */
export const FECHA_PERMISO_RETENCION = '2026-10-01';

/** Comprueba si una orden corresponde al período con autorización de retención y estatus elegible. */
export function ordenAplicaRetencion(
  o: Orden,
  fechaCorte: string = FECHA_PERMISO_RETENCION,
  estatusPermitidos: string[] = ESTATUS_KANBAN_DEFECTO,
): boolean {
  if (o.estado && !ordenTieneEstatusRetencion(o.estado, estatusPermitidos)) {
    return false;
  }
  const f = (o.oc_emitida_en || o.oc_creada_en || o.created_at || '').slice(0, 10);
  return f >= fechaCorte;
}

async function queryOrdenesPendientes() {
  const base = () => supabase.from(TABLE).select('*')
    .or('retencion_finalizada.is.null,retencion_finalizada.eq.false')
    .not('estado', 'in', '("cancelada","anulada","desistida_proveedor")')
    .gte('created_at', '2026-09-25T00:00:00Z')
    .order('created_at', { ascending: true });

  const res = await base().or('comprobante_tipo.eq.factura,factura_recepcion_path.not.is.null,iva.gt.0,retencion_monto.gt.0');
  if (res.error && /factura_recepcion_path/i.test(res.error.message)) {
    return base().or('comprobante_tipo.eq.factura,iva.gt.0,retencion_monto.gt.0');
  }
  return res;
}

async function queryConteoPendientes() {
  const base = () => supabase.from(TABLE)
    .select('id, created_at, oc_creada_en, oc_emitida_en, estado')
    .or('retencion_finalizada.is.null,retencion_finalizada.eq.false')
    .not('estado', 'in', '("cancelada","anulada","desistida_proveedor")')
    .gte('created_at', '2026-09-25T00:00:00Z');

  const res = await base().or('comprobante_tipo.eq.factura,factura_recepcion_path.not.is.null,iva.gt.0,retencion_monto.gt.0');
  if (res.error && /factura_recepcion_path/i.test(res.error.message)) {
    return base().or('comprobante_tipo.eq.factura,iva.gt.0,retencion_monto.gt.0');
  }
  return res;
}

/** Retenciones por realizar: OC con soporte Factura O con factura del proveedor cargada
 *  (al finalizar la OC), aún sin finalizar la retención. Solo a partir de la vigencia del régimen
 *  y con estatus del kanban permitido. */
export async function listRetencionesPendientes(): Promise<RetencionItem[]> {
  const [desdeAgente, { data, error }, pm, config] = await Promise.all([
    fechaDesdeAgenteRetencion(),
    queryOrdenesPendientes(),
    mapProveedores(),
    getConfigRetencion().catch(() => null),
  ]);
  if (error) throw error;
  const permitidos = estatusKanbanHabilitados(config?.estatusKanbanRetencion);
  return (data ?? [])
    .filter((o) => ordenAplicaRetencion(o as Orden, desdeAgente, permitidos))
    .map((o) => ({ orden: o as Orden, proveedorNombre: ((o as Orden).proveedor_id && pm.get((o as Orden).proveedor_id as string)) || '—' }));
}

/** Retenciones ya finalizadas (comprobantes cargados). Solo a partir de la vigencia del régimen. */
export async function listRetencionesHechas(): Promise<RetencionItem[]> {
  const [desdeAgente, { data, error }, pm] = await Promise.all([
    fechaDesdeAgenteRetencion(),
    supabase.from(TABLE).select('*')
      .or('comprobante_tipo.eq.factura,factura_recepcion_path.not.is.null,iva.gt.0,retencion_monto.gt.0')
      .eq('retencion_finalizada', true)
      .not('estado', 'in', '("cancelada","anulada","desistida_proveedor")')
      .gte('created_at', '2026-09-25T00:00:00Z')
      .order('retencion_finalizada_en', { ascending: false }),
    mapProveedores(),
  ]);
  if (error) throw error;
  return (data ?? [])
    .filter((o) => ordenAplicaRetencion(o as Orden, desdeAgente))
    .map((o) => ({ orden: o as Orden, proveedorNombre: ((o as Orden).proveedor_id && pm.get((o as Orden).proveedor_id as string)) || '—' }));
}

export async function contarRetencionesPendientes(): Promise<number> {
  const [desdeAgente, { data, error }, config] = await Promise.all([
    fechaDesdeAgenteRetencion(),
    queryConteoPendientes(),
    getConfigRetencion().catch(() => null),
  ]);
  if (error) throw error;
  const permitidos = estatusKanbanHabilitados(config?.estatusKanbanRetencion);
  return (data ?? []).filter((o) => ordenAplicaRetencion(o as unknown as Orden, desdeAgente, permitidos)).length;
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
}): Promise<void> {
  const entries = (Object.entries(input.archivos) as [TipoRetencion, File | undefined][]).filter(([, f]) => !!f);
  if (!entries.length) throw new Error('Carga al menos un comprobante de retención (IVA, ISLR o Municipal).');
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
