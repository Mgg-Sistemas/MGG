/* ============================================================
   Golden Touch · Control de Maquinaria · Ficha de repuestos (datos)
   Tabla `maquinaria_repuestos_equipo` (14/10/2026). RLS: la lee cualquier
   usuario autenticado; la escribe el administrador o quien tiene
   permiso de Maquinaria. Auditada con fn_auditar y en Realtime.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { ALMACEN_MINA } from '@/modules/inventario/depositos';
import { filasParaCopiar, type DatosRepuesto, type ProductoRepuesto, type RepuestoEquipo } from './repuestosEquipo';

const TABLE = 'maquinaria_repuestos_equipo';

const aRenglon = (r: Record<string, unknown>): RepuestoEquipo => ({
  ...(r as unknown as RepuestoEquipo),
  equivalencias: Array.isArray(r.equivalencias) ? (r.equivalencias as string[]) : [],
  cantidad: Number(r.cantidad) || 0,
  cada_hrs: r.cada_hrs == null ? null : Number(r.cada_hrs),
  cada_km: r.cada_km == null ? null : Number(r.cada_km),
});

/** La ficha de un equipo. */
export async function listRepuestosEquipo(equipoId: string): Promise<RepuestoEquipo[]> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('equipo_id', equipoId)
    .order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(aRenglon);
}

/** Las fichas de toda la flota (para el buscador y «qué comprar»). */
export async function listRepuestosTodos(): Promise<RepuestoEquipo[]> {
  const out: RepuestoEquipo[] = [];
  const PAGE = 1000;
  for (let desde = 0; ; desde += PAGE) {
    const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: true }).range(desde, desde + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []).map(aRenglon));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Productos del inventario (los activos, de cualquier almacén menos Depósito Mina) por id. */
export async function productosParaFicha(): Promise<Map<string, ProductoRepuesto>> {
  const out = new Map<string, ProductoRepuesto>();
  const PAGE = 1000;
  for (let desde = 0; ; desde += PAGE) {
    const { data, error } = await supabase.from('productos')
      .select('id, nombre, unidad, stock, sku, categoria, almacen, nombre_busqueda')
      .eq('estado', 'activo').neq('almacen', ALMACEN_MINA)
      .order('nombre', { ascending: true }).range(desde, desde + PAGE - 1);
    if (error) throw error;
    for (const p of data ?? []) out.set(p.id as string, { ...(p as ProductoRepuesto), stock: Number(p.stock) || 0 });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const limpiar = (d: DatosRepuesto) => ({
  sistema: d.sistema,
  tipo: d.tipo.trim(),
  numero_parte: d.numero_parte?.trim() || null,
  equivalencias: d.equivalencias ?? [],
  especificacion: d.especificacion?.trim() || null,
  cantidad: d.cantidad,
  unidad: d.unidad?.trim() || 'und',
  cada_hrs: d.cada_hrs ?? null,
  cada_km: d.cada_km ?? null,
  en_servicio: d.en_servicio,
  producto_id: d.producto_id ?? null,
  nota: d.nota?.trim() || null,
});

export async function crearRepuestoEquipo(equipoId: string, d: DatosRepuesto, actor: string): Promise<RepuestoEquipo> {
  const { data, error } = await supabase.from(TABLE)
    .insert({ equipo_id: equipoId, ...limpiar(d), created_by: actor, updated_by: actor }).select('*').single();
  if (error) throw error;
  return aRenglon(data);
}

export async function editarRepuestoEquipo(id: string, d: DatosRepuesto, actor: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ ...limpiar(d), updated_by: actor }).eq('id', id);
  if (error) throw error;
}

export async function eliminarRepuestoEquipo(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/**
 * Copia la ficha de otro equipo a este. No borra nada: solo agrega lo que el
 * destino todavía no tiene (mismo sistema, tipo y número de parte). Devuelve
 * cuántos renglones agregó.
 */
export async function copiarRepuestosDeEquipo(origenId: string, destinoId: string, actor: string): Promise<number> {
  const [origen, destino] = await Promise.all([listRepuestosEquipo(origenId), listRepuestosEquipo(destinoId)]);
  const filas = filasParaCopiar(origen, destino);
  if (!filas.length) return 0;
  const base = destino.reduce((m, r) => Math.max(m, r.orden), 0);
  const { error } = await supabase.from(TABLE).insert(filas.map((f, i) => ({
    equipo_id: destinoId, ...limpiar(f), orden: base + i + 1, created_by: actor, updated_by: actor,
  })));
  if (error) throw error;
  return filas.length;
}
