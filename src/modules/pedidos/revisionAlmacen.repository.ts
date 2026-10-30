/* ============================================================
   MGG · Compras · Revisión de ALMACÉN · acceso a datos (29-10-2026)

   El INTERRUPTOR: `config.compras.revision_almacen = {"activo": true|false}`.
   Arranca en false: mientras esté apagado la SP nace en `pendiente` como
   siempre y nada de esto se ve. La administradora decide cuándo se prende
   (desde el lunes 02-11-2026); se cambia en la base y toma al recargar.

   La revisión la lleva la base (`almacen_revisar_solicitud`, security
   definer): solo toca SP en `revision_almacen`, solo quien escribe en
   Inventario o en Salidas, y cada almacenista responde por SU sede (30-10:
   Los Pinos y Matanza confirman por separado; cuando confirman todos, la base
   reparte y cierra). Ver supabase/sql/compras-revision-almacen-sedes-2026-10-30.sql.
   ============================================================ */
import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { ItemOrden, Orden } from '@/shared/lib/types';
import type { MarcaAlmacen } from './revisionAlmacen';

export const CLAVE_FLUJO_ALMACEN = 'compras.revision_almacen';

let cache: { valor: boolean; at: number } | null = null;
const VIGENCIA_MS = 60_000;

/** ¿Está prendido el flujo nuevo (SP → Almacén → Compras)? Sin lectura = apagado. */
export async function flujoRevisionAlmacenActivo(): Promise<boolean> {
  if (cache && Date.now() - cache.at < VIGENCIA_MS) return cache.valor;
  try {
    const { data } = await supabase.from('config').select('value').eq('key', CLAVE_FLUJO_ALMACEN).maybeSingle();
    const v = (data?.value ?? null) as { activo?: unknown } | null;
    cache = { valor: v?.activo === true, at: Date.now() };
  } catch {
    cache = { valor: false, at: Date.now() };
  }
  return cache.valor;
}

/** El interruptor para las pantallas. Arranca en false hasta leer la base. */
export function useFlujoRevisionAlmacen(): boolean {
  const [activo, setActivo] = useState(cache?.valor ?? false);
  useEffect(() => {
    let vivo = true;
    void flujoRevisionAlmacenActivo().then((v) => { if (vivo) setActivo(v); });
    return () => { vivo = false; };
  }, []);
  return activo;
}

/** SP de productos que esperan a almacén, la más vieja primero (se atiende en orden). */
export async function listSolicitudesEnRevision(): Promise<Orden[]> {
  const { data, error } = await supabase.from('ordenes').select('*')
    .eq('estado', 'revision_almacen')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Orden[]).filter((o) => (o.clase ?? 'producto') !== 'servicio');
}

/** Las que almacén ya revisó en los últimos `dias` días (la más reciente primero). */
export async function listSolicitudesRevisadas(dias = 30): Promise<Orden[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const { data, error } = await supabase.from('ordenes').select('*')
    .not('revisada_almacen_en', 'is', null)
    .gte('revisada_almacen_en', desde)
    .order('revisada_almacen_en', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Orden[];
}

function marcasParaRpc(marcas: Record<string, MarcaAlmacen>) {
  return Object.entries(marcas).map(([sku, m]) => ({ sku, disponible: Number(m.disponible) || 0, revisado: !!m.revisado }));
}

/** Guarda lo que marcó una sede hasta ahora (uno a uno) sin confirmar. No toca lo de la otra sede. */
export async function guardarMarcasSede(ordenId: string, sede: string, marcas: Record<string, MarcaAlmacen>): Promise<Orden> {
  const { data, error } = await supabase.rpc('almacen_revisar_solicitud', {
    p_orden_id: ordenId, p_sede: sede, p_items: marcasParaRpc(marcas), p_confirmar: false, p_nota: null,
  });
  if (error) throw new Error(error.message || 'No se pudo guardar la revisión');
  return data as Orden;
}

/**
 * La sede confirma su revisión. Si era la última que faltaba, la base cierra la SP:
 * pasa a Compras con lo que ningún almacén tiene (`pendiente`) o queda «Atendida
 * por almacén» si entre los dos lo tienen todo.
 */
export async function confirmarRevisionSede(
  ordenId: string, sede: string, marcas: Record<string, MarcaAlmacen>, nota?: string | null,
): Promise<Orden> {
  const { data, error } = await supabase.rpc('almacen_revisar_solicitud', {
    p_orden_id: ordenId, p_sede: sede, p_items: marcasParaRpc(marcas), p_confirmar: true, p_nota: nota ?? null,
  });
  if (error) throw new Error(error.message || 'No se pudo confirmar la revisión');
  return data as Orden;
}

export interface StockRenglon {
  /** Ficha de inventario con la que se comparó (la del renglón o la que coincide por nombre). */
  productoId: string | null;
  nombre: string | null;
  /** Stock total del producto (todas las sedes). */
  stock: number;
  /** Stock por almacén, solo los que tienen algo. */
  porAlmacen: Array<{ almacen: string; stock: number }>;
  /** Stock por sede (`almacenes.sede`), solo las que tienen algo. */
  porSede: Record<string, number>;
}

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Cuánto hay en inventario de cada renglón (por SKU del renglón). Usa la ficha del
 * renglón; si es un nombre general sin ficha, busca un producto activo con el mismo
 * nombre. Sin coincidencia, stock 0 y productoId null: almacén lo revisa a mano.
 */
export async function stockDeRenglones(items: ItemOrden[]): Promise<Map<string, StockRenglon>> {
  const out = new Map<string, StockRenglon>();
  const ids = [...new Set(items.map((i) => i.productoId).filter(Boolean) as string[])];
  const sinFicha = items.filter((i) => !i.productoId).map((i) => i.nombre).filter(Boolean);

  const prods = new Map<string, { id: string; nombre: string; stock: number }>();
  const porNombre = new Map<string, { id: string; nombre: string; stock: number }>();
  const sedeDe = new Map<string, string>();
  await Promise.all([
    ids.length
      ? supabase.from('productos').select('id, nombre, stock').in('id', ids).then(({ data }) => {
        for (const p of (data ?? []) as Array<{ id: string; nombre: string; stock: number }>) prods.set(p.id, p);
      })
      : null,
    sinFicha.length
      ? supabase.from('productos').select('id, nombre, stock')
        .eq('estado', 'activo').in('nombre', [...new Set(sinFicha.map((n) => n.trim()))]).then(({ data }) => {
          for (const p of (data ?? []) as Array<{ id: string; nombre: string; stock: number }>) porNombre.set(norm(p.nombre), p);
        })
      : null,
    // De qué sede es cada almacén, para decirle a cada almacenista cuánto hay en SU sede.
    supabase.from('almacenes').select('nombre, sede').then(({ data }) => {
      for (const a of (data ?? []) as Array<{ nombre: string; sede: string | null }>) {
        if (a.sede?.trim()) sedeDe.set(a.nombre, a.sede.trim());
      }
    }),
  ]);

  const resueltos = new Map<string, { id: string; nombre: string; stock: number }>();
  for (const it of items) {
    const p = it.productoId ? prods.get(it.productoId) : porNombre.get(norm(it.nombre ?? ''));
    if (p) resueltos.set(it.sku, p);
  }
  const todosIds = [...new Set([...resueltos.values()].map((p) => p.id))];
  const exist = new Map<string, Array<{ almacen: string; stock: number }>>();
  if (todosIds.length) {
    const { data } = await supabase.from('existencias').select('producto_id, almacen, stock').in('producto_id', todosIds).gt('stock', 0);
    for (const e of (data ?? []) as Array<{ producto_id: string; almacen: string; stock: number }>) {
      const l = exist.get(e.producto_id) ?? [];
      l.push({ almacen: e.almacen, stock: Number(e.stock) || 0 });
      exist.set(e.producto_id, l);
    }
  }
  for (const it of items) {
    const p = resueltos.get(it.sku);
    if (!p) { out.set(it.sku, { productoId: null, nombre: null, stock: 0, porAlmacen: [], porSede: {} }); continue; }
    const porAlmacen = (exist.get(p.id) ?? []).sort((a, b) => b.stock - a.stock);
    const porSede: Record<string, number> = {};
    for (const a of porAlmacen) {
      const s = sedeDe.get(a.almacen);
      if (s) porSede[s] = Math.round(((porSede[s] ?? 0) + a.stock) * 10000) / 10000;
    }
    out.set(it.sku, { productoId: p.id, nombre: p.nombre, stock: Number(p.stock) || 0, porAlmacen, porSede });
  }
  return out;
}
