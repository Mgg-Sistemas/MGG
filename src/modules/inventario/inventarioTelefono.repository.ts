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
import { SEGUNDOS_ENLACE_FOTO, nombreFotoCompartir, tipoDeFoto } from '@/shared/lib/fotosWhatsapp';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Producto, ScopeSalida, SolicitudSalida } from '@/shared/lib/types';
import type { MovimientoTraslado } from './historicosTelefono';
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
 * Histórico de salidas de un almacén entre dos días (hora de Venezuela), de la más
 * nueva a la más vieja (02-11-2026). Va por páginas: Supabase corta en 1.000 filas
 * sin avisar, y el desempate por id evita que las páginas se pisen.
 */
export async function listSalidasAlmacen(almacen: string, desde: string, hasta: string): Promise<SalidaTelefono[]> {
  try {
    const filas = await todasLasFilas<Record<string, unknown>>((d, h) => supabase.from(TABLE).select('*')
      .eq('almacen', almacen)
      .gte('created_at', `${desde}T00:00:00-04:00`).lte('created_at', `${hasta}T23:59:59.999-04:00`)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(d, h));
    return filas.map(normalizar);
  } catch (e) {
    throw err(e, 'No se pudo leer el histórico de salidas.');
  }
}

const desdeVE = (dia: string) => `${dia}T00:00:00-04:00`;
const hastaVE = (dia: string) => `${dia}T23:59:59.999-04:00`;

/**
 * Las solicitudes del módulo de Salidas / Traslados de material creadas entre dos días
 * (03-11-2026), para los históricos del teléfono. Quién ve cuáles y de qué almacén lo
 * decide `historicosTelefono.ts` (mezclarSalidas / mezclarTraslados). Por páginas.
 */
export async function listSolicitudesModulo(scope: ScopeSalida, desde: string, hasta: string): Promise<SolicitudSalida[]> {
  try {
    return await todasLasFilas<SolicitudSalida>((d, h) => supabase.from('solicitudes_salida').select('*')
      .eq('scope', scope).eq('tipo', 'material').eq('estado', 'ejecutada')
      .gte('created_at', desdeVE(desde)).lte('created_at', hastaVE(hasta))
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(d, h));
  } catch (e) {
    throw err(e, 'No se pudieron leer las salidas del módulo.');
  }
}

/** Los traslados del teléfono que tocan un almacén (su pata en el kardex de ese almacén), entre dos días. */
export async function listTrasladosTelefono(almacen: string, desde: string, hasta: string): Promise<MovimientoTraslado[]> {
  try {
    return await todasLasFilas<MovimientoTraslado>((d, h) => supabase.from('movimientos')
      .select('id, producto_id, delta, almacen, detalle, precio_unitario, costo_promedio, actor, actor_name, at, producto:productos(sku, nombre, unidad)')
      .eq('ref_tipo', 'traslado_telefono').eq('almacen', almacen)
      .gte('at', desdeVE(desde)).lte('at', hastaVE(hasta))
      .order('at', { ascending: false }).order('id', { ascending: false })
      .range(d, h) as unknown as PromiseLike<{ data: MovimientoTraslado[] | null; error: { message?: string } | null }>);
  } catch (e) {
    throw err(e, 'No se pudieron leer los traslados.');
  }
}

/**
 * El costo unitario de una salida del teléfono AL MOMENTO de la salida, para el PDF:
 * el costo promedio del almacén que quedó en su renglón del kardex. Si ese renglón no
 * tiene costo, el costo promedio actual del producto en el almacén. `null` = sin costo.
 */
export async function precioDeSalidaTelefono(s: Pick<SalidaTelefono, 'id' | 'producto_id' | 'almacen'>): Promise<number | null> {
  const { data } = await supabase.from('movimientos').select('precio_unitario, costo_promedio')
    .eq('ref_tipo', 'salida_telefono').eq('ref_id', s.id).lt('delta', 0).limit(1).maybeSingle();
  const delKardex = Number((data as { costo_promedio?: number } | null)?.costo_promedio) || Number((data as { precio_unitario?: number } | null)?.precio_unitario) || 0;
  if (delKardex > 0) return delKardex;
  const { data: ex } = await supabase.from('existencias').select('costo_promedio')
    .eq('producto_id', s.producto_id).eq('almacen', s.almacen).maybeSingle();
  const actual = Number((ex as { costo_promedio?: number } | null)?.costo_promedio) || 0;
  return actual > 0 ? actual : null;
}

/**
 * Salida desde el teléfono: reserva el N°, descuenta el stock del almacén (el kardex
 * lleva el N° y la guardia de comida lo vigila) y guarda la salida. Si guardarla falla,
 * devuelve el stock.
 */
/** Reserva el N° SAT de una salida (una sola vez aunque lleve varios materiales). */
export async function reservarCodigoSalida(): Promise<string> {
  const { data: codigo, error } = await supabase.rpc('inv_tel_reservar_codigo');
  if (error || !codigo) throw err(error, 'No se pudo numerar la salida.');
  return String(codigo);
}

/**
 * Una salida con VARIOS materiales (04-11-2026): todos con el mismo N° SAT, cada uno
 * con su fila, su kardex y su retorno. Si uno falla, los anteriores quedan registrados
 * y el error dice cuál no salió.
 */
export async function registrarSalidaTelefonoLote(d: {
  lineas: { producto: Producto; cantidad: number }[]; almacen: string; motivo: string; autorizadoPor: string;
  retorna: boolean; actor: string; actorName: string | null;
}): Promise<SalidaTelefono[]> {
  const codigo = await reservarCodigoSalida();
  const hechas: SalidaTelefono[] = [];
  for (const l of d.lineas) {
    try {
      hechas.push(await registrarSalidaTelefono({ ...d, producto: l.producto, cantidad: l.cantidad, codigo }));
    } catch (e) {
      if (!hechas.length) throw e;
      throw new Error(`Salida ${codigo}: quedaron registrados ${hechas.length} material(es), pero «${l.producto.nombre}» no salió: ${err(e, 'error').message}`);
    }
  }
  return hechas;
}

/** Copia las fotos (ya subidas) a otra fila de la misma salida. */
export async function copiarFotosSalida(s: SalidaTelefono, fotos: FotoSalida[]): Promise<SalidaTelefono> {
  const { data, error } = await supabase.rpc('inv_tel_fotos', { p_id: s.id, p_fotos: fotos.slice(0, MAX_FOTOS_SALIDA) });
  if (error) throw err(error, 'No se pudieron anotar las fotos.');
  return normalizar(data as Record<string, unknown>);
}

/** Sube las fotos a la primera fila de la salida y las anota también en las demás. */
export async function subirFotosSalidaLote(salidas: SalidaTelefono[], archivos: File[]): Promise<SalidaTelefono[]> {
  if (!salidas.length) return salidas;
  const primera = await subirFotosSalida(salidas[0], archivos);
  const resto = await Promise.all(salidas.slice(1).map((s) => copiarFotosSalida(s, primera.fotos)));
  return [primera, ...resto];
}

export async function registrarSalidaTelefono(d: {
  producto: Producto; almacen: string; cantidad: number; motivo: string; autorizadoPor: string;
  retorna: boolean; actor: string; actorName: string | null;
  /** N° ya reservado (salida con varios materiales); si no, se reserva uno. */
  codigo?: string;
}): Promise<SalidaTelefono> {
  const codigo = d.codigo ?? await reservarCodigoSalida();
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
    recordarFoto(path, f);
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

/* Las fotos con el aviso de WhatsApp (02-11-2026). Las recién subidas se
   guardan aquí (ya achicadas) para no volver a bajarlas del depósito al
   compartir: la salida se acaba de registrar y el aviso sale enseguida. Se
   guardan pocas; una salida vieja o de otra sesión se baja del depósito. */
const FOTOS_EN_MEMORIA = 12;
const fotosEnMemoria = new Map<string, File>();
function recordarFoto(path: string, f: File) {
  fotosEnMemoria.set(path, f);
  while (fotosEnMemoria.size > FOTOS_EN_MEMORIA) {
    const vieja = fotosEnMemoria.keys().next().value;
    if (vieja === undefined) break;
    fotosEnMemoria.delete(vieja);
  }
}

/**
 * Las fotos de UNA salida como archivos, listas para la hoja de compartir.
 * La que no se pudo bajar se salta: mejor mandar tres fotos que ninguna.
 */
export async function archivosFotosSalida(fotos: FotoSalida[]): Promise<File[]> {
  const res = await Promise.allSettled(fotos.slice(0, MAX_FOTOS_SALIDA).map(async (f, i) => {
    let blob: Blob | undefined = fotosEnMemoria.get(f.path);
    if (!blob) {
      const { data, error } = await supabase.storage.from(BUCKET).download(f.path);
      if (error || !data) throw new Error(`No se pudo bajar «${f.filename}».`);
      blob = data;
    }
    const tipo = tipoDeFoto(blob.type, f.path);
    return new File([blob], nombreFotoCompartir(f.filename || f.path.split('/').pop(), tipo, i), { type: tipo });
  }));
  return res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

/** Enlaces firmados (7 días) de las fotos de una salida, para el mensaje cuando no van adjuntas. */
export async function enlacesFotosSalida(fotos: FotoSalida[]): Promise<string[]> {
  if (!fotos.length) return [];
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrls(fotos.slice(0, MAX_FOTOS_SALIDA).map((f) => f.path), SEGUNDOS_ENLACE_FOTO);
  if (error || !data) return [];
  return data.map((d) => d.signedUrl ?? '').filter(Boolean);
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
