/* ============================================================
   MGG · Inventario y Almacenes · Vista de teléfono · base (29-10-2026)

   El stock se mueve como en todo MGG (registrarMovimiento / transferir);
   la salida con retorno se guarda en `inventario_salidas_telefono` por las
   funciones de supabase/sql/inventario-telefono-2026-10-29.sql. Nada es
   transaccional desde el navegador, así que cada paso que falla después de
   mover stock se COMPENSA (igual que `transferir`).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import type { Producto } from '@/shared/lib/types';
import { registrarMovimiento, transferir } from './movimientos.repository';
import {
  MAX_FOTOS_SALIDA, errorFotos, type FotoSalida, type MovimientoStock, type RetornoSalida, type SalidaTelefono,
} from './inventarioTelefono';

const TABLE = 'inventario_salidas_telefono';
const BUCKET = 'inventario-salidas';
const PAGINA = 1000;

function normalizar(r: Record<string, unknown>): SalidaTelefono {
  const s = r as unknown as SalidaTelefono;
  return {
    ...s,
    cantidad: Number(s.cantidad) || 0,
    retornado: Number(s.retornado) || 0,
    fotos: Array.isArray(r.fotos) ? (r.fotos as FotoSalida[]) : [],
    retornos: Array.isArray(r.retornos) ? (r.retornos as RetornoSalida[]) : [],
  };
}

function err(e: { message?: string } | null | unknown, porDefecto: string): Error {
  const m = String((e as { message?: string } | null)?.message ?? '').trim();
  if (/permission denied|row-level security/i.test(m)) return new Error('No tienes permiso de escritura en Inventario.');
  return new Error(m || porDefecto);
}

/** Un producto con su stock EN ESTE almacén (no el global). */
export type ProductoEnAlmacen = Producto & { stock_almacen: number };

/**
 * Los productos activos de un almacén con su stock ahí: los que tienen existencia en
 * ese almacén y los que tienen ese almacén como hogar aunque estén en 0.
 */
export async function productosDeAlmacen(almacen: string): Promise<ProductoEnAlmacen[]> {
  const exist: Array<{ producto_id: string; stock: number }> = [];
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await supabase.from('existencias').select('producto_id, stock')
      .eq('almacen', almacen).order('producto_id').range(i, i + PAGINA - 1);
    if (error) throw error;
    exist.push(...((data ?? []) as Array<{ producto_id: string; stock: number }>));
    if (!data || data.length < PAGINA) break;
  }
  const stock = new Map(exist.map((e) => [e.producto_id, Number(e.stock) || 0]));
  const ids = [...stock.keys()];
  const prods = new Map<string, Producto>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('productos').select('*').in('id', ids.slice(i, i + 200)).eq('estado', 'activo');
    if (error) throw error;
    for (const p of (data ?? []) as Producto[]) prods.set(p.id, p);
  }
  const { data: hogar, error: hErr } = await supabase.from('productos').select('*').eq('almacen', almacen).eq('estado', 'activo');
  if (hErr) throw hErr;
  for (const p of (hogar ?? []) as Producto[]) if (!prods.has(p.id)) prods.set(p.id, p);
  return [...prods.values()]
    .map((p) => ({ ...p, stock_almacen: stock.get(p.id) ?? 0 }))
    .sort((a, b) => (b.stock_almacen > 0 ? 1 : 0) - (a.stock_almacen > 0 ? 1 : 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Las salidas que retornan y todavía no volvieron completas (de un almacén, o de todos). */
export async function listPorRetornar(almacen?: string | null): Promise<SalidaTelefono[]> {
  let q = supabase.from(TABLE).select('*').eq('estado', 'por_retornar').order('created_at', { ascending: true });
  if (almacen) q = q.eq('almacen', almacen);
  const { data, error } = await q;
  if (error) throw err(error, 'No se pudieron leer las salidas por retornar.');
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

/**
 * Salida desde el teléfono: reserva el N°, descuenta el stock del almacén (el kardex
 * lleva el N° y la guardia de comida lo vigila) y guarda la salida. Si guardarla falla,
 * devuelve el stock.
 */
export async function registrarSalidaTelefono(d: {
  producto: Producto; almacen: string; cantidad: number; motivo: string; autorizadoPor: string;
  retorna: boolean; actor: string; actorName: string | null;
}): Promise<SalidaTelefono> {
  const { data: codigo, error: cErr } = await supabase.rpc('inv_tel_reservar_codigo');
  if (cErr || !codigo) throw err(cErr, 'No se pudo numerar la salida.');
  const id = crypto.randomUUID();
  const detalle = `${d.motivo.trim()} · autorizó ${d.autorizadoPor.trim()}${d.retorna ? ' · retorna' : ' · no retorna'} · ${d.almacen} (teléfono)`;
  const mov = await registrarMovimiento({
    producto_id: d.producto.id, tipo: 'salida', delta: -d.cantidad, almacen: d.almacen,
    actor: d.actor, actor_name: d.actorName,
    ref_tipo: 'salida_telefono', ref_id: id, ref_codigo: String(codigo),
    solicitante: d.autorizadoPor.trim(), detalle,
  });
  const { data, error } = await supabase.rpc('inv_tel_registrar_salida', {
    p: {
      id, codigo, almacen: d.almacen, producto_id: d.producto.id, cantidad: d.cantidad, motivo: d.motivo.trim(),
      autorizado_por: d.autorizadoPor.trim(), retorna: d.retorna, movimiento_id: mov.id, actor: d.actor, actor_name: d.actorName,
    },
  });
  if (error) {
    await registrarMovimiento({
      producto_id: d.producto.id, tipo: 'entrada', delta: d.cantidad, almacen: d.almacen,
      actor: d.actor, actor_name: d.actorName, ref_tipo: 'salida_telefono_reverso', ref_id: id, ref_codigo: String(codigo),
      detalle: `Reverso de ${codigo}: la salida no se pudo guardar`,
    }).catch(() => { /* el error de abajo ya lo cuenta */ });
    throw err(error, 'No se pudo registrar la salida.');
  }
  return normalizar(data as Record<string, unknown>);
}

/** Retorno (todo o una parte): anota el retorno y devuelve el stock al almacén de la salida. */
export async function retornarSalidaTelefono(
  s: SalidaTelefono, cantidad: number, nota: string, actor: string, actorName: string | null,
): Promise<SalidaTelefono> {
  const { data, error } = await supabase.rpc('inv_tel_retornar', {
    p_id: s.id, p_cantidad: cantidad, p_nota: nota.trim() || null, p_actor_name: actorName,
  });
  if (error) throw err(error, 'No se pudo registrar el retorno.');
  try {
    await registrarMovimiento({
      producto_id: s.producto_id, tipo: 'entrada', delta: cantidad, almacen: s.almacen,
      actor, actor_name: actorName, ref_tipo: 'retorno_telefono', ref_id: s.id, ref_codigo: s.codigo,
      detalle: `Retorno de ${s.codigo}${nota.trim() ? ` · ${nota.trim()}` : ''} · ${s.almacen} (teléfono)`,
    });
  } catch (e) {
    await supabase.rpc('inv_tel_deshacer_retorno', { p_id: s.id, p_cantidad: cantidad });
    throw err(e, 'No se pudo devolver el material al inventario.');
  }
  return normalizar(data as Record<string, unknown>);
}

const seguro = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);

/** Sube las fotos (comprimidas) y las anota en la salida. */
export async function subirFotosSalida(s: SalidaTelefono, archivos: File[]): Promise<SalidaTelefono> {
  const mal = errorFotos(archivos, s.fotos.length);
  if (mal) throw new Error(mal);
  const candidatos = archivos.slice(0, MAX_FOTOS_SALIDA - s.fotos.length);
  const nuevas = await Promise.all(candidatos.map(async (original) => {
    const f = await comprimirImagen(original).catch(() => original);
    const path = `${s.id}/foto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${seguro(f.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir «${original.name}»: ${error.message}`);
    return { path, filename: original.name };
  }));
  const fotos = [...s.fotos, ...nuevas].slice(0, MAX_FOTOS_SALIDA);
  const { data, error } = await supabase.rpc('inv_tel_fotos', { p_id: s.id, p_fotos: fotos });
  if (error) throw err(error, 'No se pudieron anotar las fotos.');
  return normalizar(data as Record<string, unknown>);
}

/** URL firmada (10 min) de una foto. */
export async function urlFotoSalida(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error('No se pudo abrir la foto.');
  return data.signedUrl;
}

/** Traslado directo entre almacenes (salida en origen + entrada en destino, con reverso si falla). */
export async function trasladarTelefono(d: {
  producto: Producto; origen: string; destino: string; cantidad: number; motivo: string; actor: string; actorName: string | null;
}): Promise<void> {
  await transferir({
    producto_id: d.producto.id, almacenOrigen: d.origen, almacenDestino: d.destino, cantidad: d.cantidad,
    actor: d.actor, actor_name: d.actorName, ref_tipo: 'traslado_telefono',
    detalle: `${d.motivo.trim()} (teléfono)`,
  });
}

/** Movimientos de un almacén desde el día `desde` (hora de Venezuela) hasta hoy, para el reporte de stock. */
export async function movimientosAlmacenDesde(almacen: string, desde: string): Promise<MovimientoStock[]> {
  const out: MovimientoStock[] = [];
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await supabase.from('movimientos').select('producto_id, delta, at')
      .eq('almacen', almacen).gte('at', `${desde}T00:00:00-04:00`)
      .order('at', { ascending: true }).range(i, i + PAGINA - 1);
    if (error) throw error;
    out.push(...((data ?? []) as MovimientoStock[]));
    if (!data || data.length < PAGINA) return out;
  }
}
