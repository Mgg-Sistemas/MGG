/* ============================================================
   MGG · Retenciones fiscales (Supabase)
   Cuando al indicar el método de pago de una OC se elige soporte
   "Factura", la orden entra a Retenciones. Acá se cargan los
   comprobantes fiscales (IVA / ISLR / Municipal) y se finaliza la
   retención. La marca de pago la pone Tesorería automáticamente al
   pagar la OC. Las de "Nota de entrega" NO pasan por acá (van directo
   a Tesorería).
   Archivos en el bucket `compras-oc` (mismo de factura/retención de OC).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Orden } from '@/shared/lib/types';

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

// OC que entran a Retenciones: las de soporte Factura, y las Notas de entrega que
// tengan un comprobante cargado (factura/nota subida desde la OC finalizada).
const FILTRO_COMPROBANTE = 'comprobante_tipo.eq.factura,and(comprobante_tipo.eq.nota_entrega,factura_path.not.is.null)';

/** Retenciones por realizar: OC con comprobante (factura o nota) sin finalizar la retención. */
export async function listRetencionesPendientes(): Promise<RetencionItem[]> {
  const [{ data, error }, pm] = await Promise.all([
    supabase.from(TABLE).select('*')
      .or(FILTRO_COMPROBANTE)
      .or('retencion_finalizada.is.null,retencion_finalizada.eq.false')
      .order('metodo_pago_en', { ascending: true }),
    mapProveedores(),
  ]);
  if (error) throw error;
  return (data ?? []).map((o) => ({ orden: o as Orden, proveedorNombre: ((o as Orden).proveedor_id && pm.get((o as Orden).proveedor_id as string)) || '—' }));
}

/** Retenciones ya finalizadas (comprobantes cargados). */
export async function listRetencionesHechas(): Promise<RetencionItem[]> {
  const [{ data, error }, pm] = await Promise.all([
    supabase.from(TABLE).select('*')
      .or(FILTRO_COMPROBANTE)
      .eq('retencion_finalizada', true)
      .order('retencion_finalizada_en', { ascending: false }),
    mapProveedores(),
  ]);
  if (error) throw error;
  return (data ?? []).map((o) => ({ orden: o as Orden, proveedorNombre: ((o as Orden).proveedor_id && pm.get((o as Orden).proveedor_id as string)) || '—' }));
}

export async function contarRetencionesPendientes(): Promise<number> {
  const { count, error } = await supabase.from(TABLE)
    .select('id', { count: 'exact', head: true })
    .or(FILTRO_COMPROBANTE)
    .or('retencion_finalizada.is.null,retencion_finalizada.eq.false');
  if (error) throw error;
  return count ?? 0;
}

async function subirComprobante(ordenId: string, tipo: TipoRetencion, file: File): Promise<{ path: string; nombre: string }> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
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
  if (!entries.length) throw new Error('Cargá al menos un comprobante de retención (IVA, ISLR o Municipal).');
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
  const { error } = await supabase.from(TABLE).update(patch).eq('id', input.orden.id);
  if (error) throw error;
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
