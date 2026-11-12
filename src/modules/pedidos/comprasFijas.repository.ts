/* ============================================================
   MGG · Compras FIJAS (12-11-2026, de Golden Touch) · base de datos.
   Tabla compras_fijas + compra_fija_id en ordenes y compras_directas
   (supabase/sql/compras-fijas-2026-11-12.sql).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ItemOrden, Orden } from '@/shared/lib/types';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { siguienteFecha, type CompraFija, type ProductoFijo } from './comprasFijas';

const TABLE = 'compras_fijas';
export const MSG_FALTA_SQL_COMPRAS_FIJAS =
  'Falta aplicar en Supabase el SQL supabase/sql/compras-fijas-2026-11-12.sql (Compras fijas).';

const faltaSql = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || e.code === 'PGRST204'
    || /does not exist|Could not find the (table|.*column)/i.test(e.message ?? ''));

function err(e: { code?: string; message?: string }, d: string): Error {
  if (faltaSql(e)) return new Error(MSG_FALTA_SQL_COMPRAS_FIJAS);
  if (e.code === '42501') return new Error('No tienes permiso de escritura en Pedidos / Compras.');
  return new Error(e.message || d);
}

function normalizar(r: Record<string, unknown>): CompraFija {
  const c = r as unknown as CompraFija;
  return {
    ...c,
    categorias: Array.isArray(r.categorias) ? (r.categorias as string[]) : [],
    productos: Array.isArray(r.productos) ? (r.productos as ProductoFijo[]) : [],
    urgente: !!r.urgente, activa: r.activa !== false, permite_cotizar: r.permite_cotizar !== false,
    sugerida: r.sugerida === true,
  };
}

/** Las plantillas (activas primero, por su orden). Sin el SQL aplicado: lista vacía y `disponible=false`. */
export async function listComprasFijas(): Promise<{ lista: CompraFija[]; disponible: boolean }> {
  const { data, error } = await supabase.from(TABLE).select('*').order('orden').order('nombre');
  if (error) {
    if (faltaSql(error)) return { lista: [], disponible: false };
    throw err(error, 'No se pudieron leer las compras fijas.');
  }
  const lista = ((data ?? []) as Record<string, unknown>[]).map(normalizar);
  return { lista: lista.sort((a, b) => Number(b.activa) - Number(a.activa)), disponible: true };
}

export type CompraFijaEditable = Omit<CompraFija, 'id' | 'ultima_ref_tipo' | 'ultima_ref_id' | 'ultima_codigo' | 'ultima_generada_en'>;

export async function guardarCompraFija(id: string | null, c: CompraFijaEditable): Promise<CompraFija> {
  const fila = {
    nombre: c.nombre.trim(), icono: c.icono || '🔁', frecuencia: c.frecuencia,
    cada_dias: c.frecuencia === 'cada_dias' ? Number(c.cada_dias) || 30 : null,
    proxima_fecha: c.proxima_fecha, activa: c.activa, modo: c.modo, permite_cotizar: c.permite_cotizar,
    solicitante: c.solicitante?.trim().toUpperCase() || null, unidad_solicitante: c.unidad_solicitante?.trim().toUpperCase() || null,
    finalidad: c.finalidad?.trim().toUpperCase() || null, urgente: c.urgente,
    proveedor_id: c.proveedor_id || null, proveedor_nombre: c.proveedor_nombre || null,
    categorias: c.categorias.map((x) => x.trim()).filter(Boolean), productos: c.productos,
    nota: c.nota?.trim() || null, orden: Number(c.orden) || 0,
    // Al guardarla, Compras ya la configuró: deja de ser sugerencia.
    sugerida: false,
    // Si cambió la fecha, que vuelva a avisar en la nueva.
    avisada_para: null,
  };
  const q = id
    ? supabase.from(TABLE).update(fila).eq('id', id).select('*').single()
    : supabase.from(TABLE).insert(fila).select('*').single();
  const { data, error } = await q;
  if (error) throw err(error, 'No se pudo guardar la compra fija.');
  return normalizar(data as Record<string, unknown>);
}

export async function eliminarCompraFija(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw err(error, 'No se pudo eliminar.');
}

/** Después de generar: anota cuál fue y corre la próxima fecha según la frecuencia. */
export async function marcarCompraFijaGenerada(c: CompraFija, ref: { tipo: 'orden' | 'compra_directa'; id: string; codigo: string | null }): Promise<void> {
  const { error } = await supabase.from(TABLE).update({
    ultima_ref_tipo: ref.tipo, ultima_ref_id: ref.id, ultima_codigo: ref.codigo, ultima_generada_en: new Date().toISOString(),
    proxima_fecha: siguienteFecha(c, hoyVenezuela()), avisada_para: null,
  }).eq('id', c.id);
  if (error) throw err(error, 'No se pudo actualizar la compra fija.');
}

/** Los renglones de la última vez que se generó esta plantilla (solicitud o compra directa). */
export async function ultimosItemsDe(c: CompraFija): Promise<{ items: Array<Pick<ItemOrden, 'productoId' | 'sku' | 'cantidad'>>; codigo: string | null; fecha: string | null }> {
  const [o, cd] = await Promise.all([
    supabase.from('ordenes').select('codigo, items, created_at').eq('compra_fija_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('compras_directas').select('codigo, items, created_at').eq('compra_fija_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  type FilaO = { codigo: string; items: ItemOrden[] | null; created_at: string };
  type FilaCd = { codigo: string | null; items: Array<{ producto_id: string; producto_sku: string | null; cantidad: number }> | null; created_at: string };
  const ord = (o.data ?? null) as FilaO | null;
  const comp = (cd.data ?? null) as FilaCd | null;
  if (ord && (!comp || ord.created_at >= comp.created_at)) {
    return { items: (ord.items ?? []).filter((i) => i.comprar !== false), codigo: ord.codigo, fecha: ord.created_at };
  }
  if (comp) {
    return {
      items: (comp.items ?? []).map((i) => ({ productoId: i.producto_id, sku: i.producto_sku ?? '', cantidad: Number(i.cantidad) || 0 })),
      codigo: comp.codigo, fecha: comp.created_at,
    };
  }
  return { items: [], codigo: null, fecha: null };
}

export interface GeneradaFija { tipo: 'orden' | 'compra_directa'; id: string; codigo: string | null; fecha: string; estado: string; total: number | null }

/** Historial de una plantilla: sus solicitudes y compras directas. */
export async function historialCompraFija(id: string): Promise<GeneradaFija[]> {
  const [o, cd] = await Promise.all([
    supabase.from('ordenes').select('id, codigo, oc_codigo, created_at, estado, total').eq('compra_fija_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('compras_directas').select('id, codigo, created_at, estado, gasto').eq('compra_fija_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (o.error) throw err(o.error, 'No se pudo leer el historial.');
  const ords = ((o.data ?? []) as Array<Pick<Orden, 'id' | 'codigo' | 'oc_codigo' | 'created_at' | 'estado' | 'total'>>)
    .map((x) => ({ tipo: 'orden' as const, id: x.id, codigo: x.oc_codigo ?? x.codigo, fecha: x.created_at, estado: x.estado, total: Number(x.total) || null }));
  const cds = ((cd.data ?? []) as Array<{ id: string; codigo: string | null; created_at: string; estado: string; gasto: number | null }>)
    .map((x) => ({ tipo: 'compra_directa' as const, id: x.id, codigo: x.codigo, fecha: x.created_at, estado: x.estado, total: x.gasto == null ? null : Number(x.gasto) }));
  return [...ords, ...cds].sort((a, b) => b.fecha.localeCompare(a.fecha));
}
