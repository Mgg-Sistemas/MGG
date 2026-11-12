import { supabase } from '@/shared/lib/supabase';
import type { Notificacion, NotifKind } from '@/shared/lib/types';

export async function listLatest(
  limit = 50,
  filtroPermiso?: (n: Notificacion) => boolean
): Promise<Notificacion[]> {
  const fetchLimit = filtroPermiso ? Math.max(limit * 4, 100) : limit;
  const { data, error } = await supabase
    .from('notificaciones')
    .select('*')
    .order('at', { ascending: false })
    .limit(fetchLimit);
  if (error) throw error;
  const lista = (data ?? []) as Notificacion[];
  const filtradas = filtroPermiso ? lista.filter(filtroPermiso) : lista;
  return filtradas.slice(0, limit);
}

/**
 * Conserva solo las `keep` notificaciones más nuevas y borra las viejas.
 * Encuentra el `at` de la fila #keep y borra todo lo más viejo que eso.
 * El DELETE es admin-only por RLS: para no-admin no borra nada (sin error).
 * Devuelve cuántas se borraron.
 */
export async function pruneOld(keep = 100): Promise<number> {
  const { data: cut, error: selErr } = await supabase
    .from('notificaciones')
    .select('at')
    .order('at', { ascending: false })
    .range(keep - 1, keep - 1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!cut?.at) return 0; // hay <= keep notificaciones: nada que borrar
  // 12-11-2026: las alertas de stock SIN LEER no se borran (son una por producto,
  // las mantiene notif_escanear_stock); borrarlas hacía que se volvieran a crear.
  const viejas = () => supabase.from('notificaciones').delete({ count: 'exact' }).lt('at', cut.at);
  const res = await Promise.all([
    viejas().is('dedup_key', null),
    viejas().not('dedup_key', 'like', 'restock:%'),
    viejas().like('dedup_key', 'restock:%').eq('read', true),
  ]);
  const err = res.find((r) => r.error)?.error;
  if (err) throw err;
  return res.reduce((t, r) => t + (r.count ?? 0), 0);
}

export async function unreadCount(filtroPermiso?: (n: Notificacion) => boolean): Promise<number> {
  if (!filtroPermiso) {
    const { count, error } = await supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('read', false);
    if (error) throw error;
    return count ?? 0;
  }
  const { data, error } = await supabase
    .from('notificaciones')
    .select('*')
    .eq('read', false)
    .order('at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const permitidas = (data ?? []).filter(filtroPermiso);
  return permitidas.length;
}

export async function markAllRead(ids?: string[]): Promise<void> {
  if (ids && ids.length === 0) return;
  let q = supabase
    .from('notificaciones')
    .update({ read: true })
    .eq('read', false);
  if (ids && ids.length > 0) {
    q = q.in('id', ids);
  }
  const { error } = await q;
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
 * Escanea stock crítico y crea las alertas para admin (una por producto).
 * Desde el 12-11-2026 lo hace la BASE (RPC notif_escanear_stock): antes cada
 * navegador bajaba `productos` entero y, como la RLS no le deja ver a un
 * no-admin las alertas 'admin', no veía las existentes y las duplicaba (~11
 * copias por producto, cada una un evento de Realtime para todos). La RPC
 * inserta las que faltan sin duplicar y marca leídas las de productos que ya
 * se reabastecieron. Devuelve cuántas alertas nuevas creó.
 */
export async function scanStockAndNotify(): Promise<number> {
  const { data, error } = await supabase.rpc('notif_escanear_stock');
  if (error) return 0;
  return Number(data ?? 0);
}
