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
import { listComprasConRetencion, type CompraDirecta } from '@/modules/pedidos/compras.repository';
import { labelCondicionPago } from '@/modules/pedidos/ofertas.repository';

const TABLE = 'ordenes';
const BUCKET = 'compras-oc';

function fmtMonto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
}

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

/**
 * Fila unificada del módulo Retenciones: puede ser una OC o una compra directa.
 * Los campos de display quedan pre-calculados para que la página no ramifique.
 */
export interface RetencionItem {
  kind: 'oc' | 'compra_directa';
  id: string;
  ocCodigo: string | null;      // N°OC (OC) o código CD (compra directa)
  opCodigo: string | null;      // OP (OC) o null (compra directa)
  proveedorNombre: string;
  condicionLabel: string;       // condición de pago (OC) o "Compra directa"
  retencionLabel: string;       // modo de retención (OC) o "16% IVA · Bs X" (compra directa)
  moneda: string;
  total: number;
  tesoreria: 'pagada' | 'por_pagar' | 'na';
  finalizada: boolean;
  finalizadaEn: string | null;
  tiposComprobante: TipoRetencion[];   // comprobantes cargados (para el filtro por tipo)
  // Registro subyacente según el tipo (lo usa el modal de detalle).
  orden?: Orden;
  compra?: CompraDirecta;
}

async function mapProveedores(): Promise<Map<string, string>> {
  const { data } = await supabase.from('proveedores').select('id, razon_social');
  return new Map((data ?? []).map((p) => [p.id as string, p.razon_social as string]));
}

// OC que entran a Retenciones: las de soporte Factura, y las Notas de entrega que
// tengan un comprobante cargado (factura/nota subida desde la OC finalizada).
const FILTRO_COMPROBANTE = 'comprobante_tipo.eq.factura,and(comprobante_tipo.eq.nota_entrega,factura_path.not.is.null)';

function ocToItem(o: Orden, pm: Map<string, string>): RetencionItem {
  return {
    kind: 'oc', id: o.id,
    ocCodigo: o.oc_codigo ?? null, opCodigo: o.codigo,
    proveedorNombre: (o.proveedor_id && pm.get(o.proveedor_id as string)) || '—',
    condicionLabel: labelCondicionPago(o.condiciones_pago),
    retencionLabel: labelRetencionModo(o.retencion_modo),
    moneda: 'USD', total: Number(o.total) || 0,
    tesoreria: o.retencion_pagada ? 'pagada' : 'por_pagar',
    finalizada: !!o.retencion_finalizada, finalizadaEn: o.retencion_finalizada_en ?? null,
    tiposComprobante: comprobantesDeOrden(o).map((c) => c.tipo),
    orden: o,
  };
}

function compraToItem(c: CompraDirecta): RetencionItem {
  return {
    kind: 'compra_directa', id: c.id,
    ocCodigo: c.codigo, opCodigo: null,
    proveedorNombre: c.proveedor_nombre || '—',
    condicionLabel: 'Compra directa',
    retencionLabel: `${c.retencion_pct}% IVA · ${fmtMonto(c.retencion_monto, c.moneda)}`,
    moneda: c.moneda || 'Bs', total: Number(c.gasto) || 0,
    tesoreria: c.estado === 'por_pagar' ? 'por_pagar' : 'pagada',
    finalizada: !!c.retencion_finalizada, finalizadaEn: c.retencion_finalizada_en ?? null,
    tiposComprobante: c.retencion_iva_path ? ['iva'] : [],
    compra: c,
  };
}

/** Retenciones por realizar: OC con comprobante + compras directas con retención, sin finalizar. */
export async function listRetencionesPendientes(): Promise<RetencionItem[]> {
  const [{ data, error }, pm, compras] = await Promise.all([
    supabase.from(TABLE).select('*')
      .or(FILTRO_COMPROBANTE)
      .or('retencion_finalizada.is.null,retencion_finalizada.eq.false')
      .order('metodo_pago_en', { ascending: true }),
    mapProveedores(),
    listComprasConRetencion(false).catch(() => [] as CompraDirecta[]),
  ]);
  if (error) throw error;
  const ocs = (data ?? []).map((o) => ocToItem(o as Orden, pm));
  return [...ocs, ...compras.map(compraToItem)];
}

/** Retenciones ya finalizadas (comprobantes cargados). */
export async function listRetencionesHechas(): Promise<RetencionItem[]> {
  const [{ data, error }, pm, compras] = await Promise.all([
    supabase.from(TABLE).select('*')
      .or(FILTRO_COMPROBANTE)
      .eq('retencion_finalizada', true)
      .order('retencion_finalizada_en', { ascending: false }),
    mapProveedores(),
    listComprasConRetencion(true).catch(() => [] as CompraDirecta[]),
  ]);
  if (error) throw error;
  const items = [...(data ?? []).map((o) => ocToItem(o as Orden, pm)), ...compras.map(compraToItem)];
  // Historial ordenado por fecha de finalización (desc).
  return items.sort((a, b) => (b.finalizadaEn ?? '').localeCompare(a.finalizadaEn ?? ''));
}

export async function contarRetencionesPendientes(): Promise<number> {
  const [{ count, error }, compras] = await Promise.all([
    supabase.from(TABLE)
      .select('id', { count: 'exact', head: true })
      .or(FILTRO_COMPROBANTE)
      .or('retencion_finalizada.is.null,retencion_finalizada.eq.false'),
    listComprasConRetencion(false).catch(() => [] as CompraDirecta[]),
  ]);
  if (error) throw error;
  return (count ?? 0) + compras.length;
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
