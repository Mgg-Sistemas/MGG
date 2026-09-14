import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Notificacion, NotifKind } from '@/shared/lib/types';

export async function listLatest(limit = 50): Promise<Notificacion[]> {
  const { data, error } = await supabase
    .from('notificaciones')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Notificacion[];
}

/**
 * Conserva solo las `keep` notificaciones más nuevas y borra las viejas.
 * Encuentra el `at` de la fila #keep y borra todo lo más viejo que eso.
 * El DELETE es admin-only por RLS: para no-admin no borra nada (sin error).
 * Devuelve cuántas se borraron.
 */
export async function pruneOld(keep = 10): Promise<number> {
  const { data: cut, error: selErr } = await supabase
    .from('notificaciones')
    .select('at')
    .order('at', { ascending: false })
    .range(keep - 1, keep - 1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!cut?.at) return 0; // hay <= keep notificaciones: nada que borrar
  const { error, count } = await supabase
    .from('notificaciones')
    .delete({ count: 'exact' })
    .lt('at', cut.at);
  if (error) throw error;
  return count ?? 0;
}

export async function unreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .eq('read', false);
  if (error) throw error;
  return count ?? 0;
}

export async function markAllRead(): Promise<void> {
  const { error } = await supabase
    .from('notificaciones')
    .update({ read: true })
    .eq('read', false);
  if (error) throw error;
}

/** Marca una notificación puntual como leída (best-effort). */
export async function markRead(id: string): Promise<void> {
  await supabase.from('notificaciones').update({ read: true }).eq('id', id);
}

export interface PushArgs {
  destino?: string;
  kind?: NotifKind;
  title: string;
  message?: string | null;
  link?: string | null;
  dedup_key?: string | null;
}

export async function push(args: PushArgs): Promise<Notificacion | null> {
  // Deduplicación: si ya existe una notif NO leída con el mismo dedup_key,
  // no creamos otra (evita spam de alertas de stock recurrentes).
  if (args.dedup_key) {
    const { data: existing } = await supabase
      .from('notificaciones')
      .select('id')
      .eq('dedup_key', args.dedup_key)
      .eq('read', false)
      .limit(1)
      .maybeSingle();
    if (existing) return null;
  }
  const { data, error } = await supabase
    .from('notificaciones')
    .insert({
      destino: args.destino ?? 'all',
      kind: args.kind ?? 'info',
      title: args.title,
      message: args.message ?? null,
      link: args.link ?? null,
      dedup_key: args.dedup_key ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Notificacion;
}

/**
 * Escanea stock crítico y crea notificaciones para admin.
 * Port del `Restock.notifyPending` del demo, con dedup_key por producto + severidad.
 *
 * Optimización vs versión naïve:
 *   - 1 query para traer productos activos.
 *   - 1 query para traer todos los dedup_key de notifs `restock:*` no leídas.
 *   - Los inserts faltantes se mandan en paralelo con Promise.all.
 *   En vez de O(N) queries secuenciales (~2N round-trips) → 2 + 1 paralelo.
 */
export async function scanStockAndNotify(): Promise<number> {
  // Productos POR PÁGINAS: ya hay más de 1.000 activos y una sola respuesta de
  // Supabase se corta en 1.000; los últimos nunca avisaban su stock crítico.
  const [productos, { data: existing }] = await Promise.all([
    todasLasFilas<{ id: string; sku: string; nombre: string; stock: number; stock_min: number; estado: string }>((d, h) =>
      supabase.from('productos').select('id, sku, nombre, stock, stock_min, estado')
        .eq('estado', 'activo').order('id', { ascending: true }).range(d, h)).catch(() => null),
    supabase
      .from('notificaciones')
      .select('dedup_key')
      .like('dedup_key', 'restock:%')
      .eq('read', false),
  ]);
  if (!productos) return 0;

  const existingKeys = new Set((existing ?? []).map((r) => r.dedup_key).filter(Boolean) as string[]);

  const toInsert: Array<{
    destino: string;
    kind: NotifKind;
    title: string;
    message: string;
    link: string;
    dedup_key: string;
  }> = [];

  for (const p of productos) {
    const stockMin = Number(p.stock_min ?? 0);
    const stock = Number(p.stock ?? 0);
    if (stockMin <= 0) continue;
    const critical = stock < stockMin;
    const needsRestock = stock <= stockMin;
    if (!needsRestock && !critical) continue;

    const dedup = `restock:${critical ? 'crit' : 'warn'}:${p.id}`;
    if (existingKeys.has(dedup)) continue;

    toInsert.push({
      destino: 'admin',
      kind: critical ? 'error' : 'warning',
      title: critical ? '⚠ Stock crítico' : 'Reabastecimiento requerido',
      message: critical
        ? `${p.sku} · ${p.nombre}: stock ${stock} POR DEBAJO del mínimo (${stockMin})`
        : `${p.sku} · ${p.nombre}: stock ${stock} ≤ mínimo ${stockMin}`,
      link: '#/app/inventario',
      dedup_key: dedup,
    });
  }

  if (!toInsert.length) return 0;
  const { error } = await supabase.from('notificaciones').insert(toInsert);
  return error ? 0 : toInsert.length;
}
