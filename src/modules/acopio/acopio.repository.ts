/* ============================================================
   Golden Touch · Centro de Acopio PERAMANAL (Supabase)
   Control de recepción de mineral por centro de acopio.
   Maestro (acopio_recepciones) + detalle (acopio_recepcion_lotes).

   · Los 3 cálculos (peso bruto, dif. bruto-neto, dif. neto-recep.)
     son columnas GENERADAS en la base: NO se envían al guardar.
   · Estados: abierta (borrador editable) → cerrada (suma stock al
     inventario) ; cualquiera → anulada (revierte el stock si estaba
     cerrada). Una recepción cerrada/anulada no se edita.
   · Al CERRAR, el total recibido se suma al producto/almacén elegido
     vía el kardex de inventario (registrarMovimiento, tipo 'entrada').
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { RecepcionAcopio, RecepcionAcopioLote } from '@/shared/lib/types';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';

/** Campos editables de un lote (sin las columnas generadas ni ids). */
export interface LoteInput {
  nro_lote?: string | null;
  cantidad_bolsas?: number | null;
  peso_bolsa_kg?: number | null;
  peso_neto_kg?: number | null;
  precinto_inicio?: string | null;
  peso_recepcionado_kg?: number | null;
  precinto_final?: string | null;
}

export interface RecepcionInput {
  fecha: string;
  centro_acopio?: string | null;
  aliado?: string | null;
  producto_id?: string | null;
  almacen?: string | null;
  entregado_nombre?: string | null;
  entregado_ci?: string | null;
  recibido_nombre?: string | null;
  recibido_ci?: string | null;
  observaciones?: string | null;
  lotes: LoteInput[];
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Próximo correlativo REC-AAAA-NNNN (por año, según lo ya existente). */
async function nextNumero(fecha: string): Promise<string> {
  const year = (fecha || '').slice(0, 4) || String(new Date().getFullYear());
  const { data, error } = await supabase
    .from('acopio_recepciones')
    .select('numero')
    .like('numero', `REC-${year}-%`);
  if (error) throw error;
  let max = 0;
  (data ?? []).forEach((r) => {
    const m = String((r as { numero: string }).numero).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `REC-${year}-${String(max + 1).padStart(4, '0')}`;
}

/** Mapea los lotes editables a filas insertables (sin columnas generadas). */
function lotesPayload(recepcionId: string, lotes: LoteInput[]): Record<string, unknown>[] {
  return (lotes ?? [])
    // descartamos filas totalmente vacías
    .filter((l) =>
      (l.nro_lote ?? '').toString().trim() !== '' ||
      num(l.cantidad_bolsas) > 0 || num(l.peso_bolsa_kg) > 0 ||
      num(l.peso_neto_kg) > 0 || num(l.peso_recepcionado_kg) > 0 ||
      (l.precinto_inicio ?? '').toString().trim() !== '' ||
      (l.precinto_final ?? '').toString().trim() !== '')
    .map((l, i) => ({
      recepcion_id: recepcionId,
      orden: i,
      nro_lote: l.nro_lote?.toString().trim() || String(i + 1),
      cantidad_bolsas: num(l.cantidad_bolsas),
      peso_bolsa_kg: num(l.peso_bolsa_kg),
      peso_neto_kg: num(l.peso_neto_kg),
      precinto_inicio: l.precinto_inicio?.toString().trim() || null,
      peso_recepcionado_kg: num(l.peso_recepcionado_kg),
      precinto_final: l.precinto_final?.toString().trim() || null,
    }));
}

/* ───────────── Lecturas ───────────── */

export async function listRecepciones(): Promise<RecepcionAcopio[]> {
  const { data, error } = await supabase
    .from('acopio_recepciones')
    .select('*, lotes:acopio_recepcion_lotes(*)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = r as RecepcionAcopio;
    const lotes = [...(row.lotes ?? [])].sort((a, b) => a.orden - b.orden);
    return { ...row, lotes };
  });
}

export async function getRecepcion(id: string): Promise<RecepcionAcopio | null> {
  const { data, error } = await supabase
    .from('acopio_recepciones')
    .select('*, lotes:acopio_recepcion_lotes(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as RecepcionAcopio;
  return { ...row, lotes: [...(row.lotes ?? [])].sort((a, b) => a.orden - b.orden) };
}

/* ───────────── Totales (helper de UI/stock) ───────────── */

export function totalesRecepcion(lotes: Pick<RecepcionAcopioLote, 'cantidad_bolsas' | 'peso_bruto_total' | 'peso_neto_kg' | 'peso_recepcionado_kg'>[] = []) {
  return lotes.reduce(
    (a, l) => ({
      bolsas: a.bolsas + num(l.cantidad_bolsas),
      bruto: a.bruto + num(l.peso_bruto_total),
      neto: a.neto + num(l.peso_neto_kg),
      recepcionado: a.recepcionado + num(l.peso_recepcionado_kg),
    }),
    { bolsas: 0, bruto: 0, neto: 0, recepcionado: 0 },
  );
}

/** Cantidad (kg) que entra al inventario al cerrar: peso recepcionado real;
 *  si todo el recepcionado es 0 se usa el peso neto como respaldo. */
function cantidadAStock(lotes: Pick<RecepcionAcopioLote, 'peso_neto_kg' | 'peso_recepcionado_kg' | 'peso_bruto_total' | 'cantidad_bolsas'>[]): number {
  const t = totalesRecepcion(lotes);
  return t.recepcionado > 0 ? t.recepcionado : t.neto;
}

/* ───────────── Escrituras ───────────── */

export async function createRecepcion(input: RecepcionInput, actor: string, actorName?: string | null): Promise<RecepcionAcopio> {
  if (!input.fecha) throw new Error('La fecha es obligatoria.');
  const numero = await nextNumero(input.fecha);
  const { data: cab, error } = await supabase
    .from('acopio_recepciones')
    .insert({
      numero,
      fecha: input.fecha,
      centro_acopio: input.centro_acopio?.trim() || null,
      aliado: input.aliado?.trim() || null,
      producto_id: input.producto_id || null,
      almacen: input.almacen?.trim() || null,
      entregado_nombre: input.entregado_nombre?.trim() || null,
      entregado_ci: input.entregado_ci?.trim() || null,
      recibido_nombre: input.recibido_nombre?.trim() || null,
      recibido_ci: input.recibido_ci?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
      estado: 'abierta',
      created_by: actor,
      actor_name: actorName ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  const recepcion = cab as RecepcionAcopio;

  const payload = lotesPayload(recepcion.id, input.lotes);
  if (payload.length) {
    const { error: lErr } = await supabase.from('acopio_recepcion_lotes').insert(payload);
    if (lErr) throw lErr;
  }
  return (await getRecepcion(recepcion.id))!;
}

/** Actualiza una recepción ABIERTA: cabecera + reemplazo total de lotes. */
export async function updateRecepcion(id: string, input: RecepcionInput): Promise<RecepcionAcopio> {
  const actual = await getRecepcion(id);
  if (!actual) throw new Error('Recepción no encontrada.');
  if (actual.estado !== 'abierta') throw new Error('Solo se puede editar una recepción abierta.');

  const { error } = await supabase
    .from('acopio_recepciones')
    .update({
      fecha: input.fecha,
      centro_acopio: input.centro_acopio?.trim() || null,
      aliado: input.aliado?.trim() || null,
      producto_id: input.producto_id || null,
      almacen: input.almacen?.trim() || null,
      entregado_nombre: input.entregado_nombre?.trim() || null,
      entregado_ci: input.entregado_ci?.trim() || null,
      recibido_nombre: input.recibido_nombre?.trim() || null,
      recibido_ci: input.recibido_ci?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;

  // Reemplazo de lotes (la recepción está abierta, no afecta stock).
  const { error: dErr } = await supabase.from('acopio_recepcion_lotes').delete().eq('recepcion_id', id);
  if (dErr) throw dErr;
  const payload = lotesPayload(id, input.lotes);
  if (payload.length) {
    const { error: iErr } = await supabase.from('acopio_recepcion_lotes').insert(payload);
    if (iErr) throw iErr;
  }
  return (await getRecepcion(id))!;
}

/**
 * CIERRA la recepción: suma el mineral recibido al inventario (producto +
 * almacén elegidos) con un único movimiento de entrada y bloquea la edición.
 */
export async function cerrarRecepcion(id: string, actor: string, actorName?: string | null): Promise<RecepcionAcopio> {
  const rec = await getRecepcion(id);
  if (!rec) throw new Error('Recepción no encontrada.');
  if (rec.estado !== 'abierta') throw new Error('Solo se puede cerrar una recepción abierta.');
  if (!rec.producto_id) throw new Error('Elegí el producto (mineral) al que se suma el stock antes de cerrar.');
  if (!rec.almacen?.trim()) throw new Error('Elegí el almacén destino del stock antes de cerrar.');
  if (!(rec.lotes ?? []).length) throw new Error('Agregá al menos un lote antes de cerrar.');

  const cantidad = cantidadAStock(rec.lotes ?? []);
  if (cantidad <= 0) throw new Error('El peso recibido debe ser mayor que 0 para sumar stock.');

  // 1) Entra al INVENTARIO (un solo movimiento por el total recibido).
  const mov = await registrarMovimiento({
    producto_id: rec.producto_id,
    tipo: 'entrada',
    delta: cantidad,
    almacen: rec.almacen.trim(),
    actor,
    actor_name: actorName ?? null,
    ref_tipo: 'acopio_recepcion',
    ref_id: rec.id,
    ref_codigo: rec.numero,
    detalle: `Recepción ${rec.numero}${rec.aliado ? ` · Aliado ${rec.aliado}` : ''}${rec.centro_acopio ? ` · ${rec.centro_acopio}` : ''}`,
  });

  // 2) Marca la recepción como cerrada y guarda la traza del movimiento.
  const { error } = await supabase
    .from('acopio_recepciones')
    .update({
      estado: 'cerrada',
      mov_id: mov.id,
      mov_producto_id: rec.producto_id,
      mov_almacen: rec.almacen.trim(),
      mov_cantidad: cantidad,
      cerrada_por: actor,
      cerrada_en: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
  return (await getRecepcion(id))!;
}

/**
 * ANULA la recepción. Si estaba cerrada, revierte el stock sumado (salida por
 * la misma cantidad/almacén). Una recepción abierta solo se marca anulada.
 */
export async function anularRecepcion(id: string, actor: string, actorName?: string | null): Promise<RecepcionAcopio> {
  const rec = await getRecepcion(id);
  if (!rec) throw new Error('Recepción no encontrada.');
  if (rec.estado === 'anulada') throw new Error('La recepción ya está anulada.');

  if (rec.estado === 'cerrada' && rec.mov_producto_id && rec.mov_almacen && num(rec.mov_cantidad) > 0) {
    await registrarMovimiento({
      producto_id: rec.mov_producto_id,
      tipo: 'salida',
      delta: -num(rec.mov_cantidad),
      almacen: rec.mov_almacen,
      actor,
      actor_name: actorName ?? null,
      ref_tipo: 'acopio_recepcion_anulacion',
      ref_id: rec.id,
      ref_codigo: rec.numero,
      detalle: `Anulación recepción ${rec.numero}`,
    });
  }

  const { error } = await supabase
    .from('acopio_recepciones')
    .update({
      estado: 'anulada',
      anulada_por: actor,
      anulada_en: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
  return (await getRecepcion(id))!;
}

/** Elimina una recepción ABIERTA (borrador). Las cerradas se anulan, no se borran. */
export async function deleteRecepcion(id: string): Promise<void> {
  const rec = await getRecepcion(id);
  if (!rec) return;
  if (rec.estado !== 'abierta') throw new Error('Solo se puede eliminar una recepción abierta. Las cerradas se anulan.');
  const { error } = await supabase.from('acopio_recepciones').delete().eq('id', id);
  if (error) throw error;
}
