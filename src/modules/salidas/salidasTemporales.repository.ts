/* ============================================================
   MGG · Salidas Temporales (material a mantenimiento, con retorno)
   Submódulo de Salidas/Traslados. Saca material a mantenimiento,
   pasa por aprobación (descuenta stock + firma), se pone en tránsito
   cuando lo entregan de vuelta y se finaliza reingresándolo al
   inventario (mostrando el tiempo en mantenimiento y en tránsito).
   Reutiliza el kardex (`registrarMovimiento`) y las existencias.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type {
  EventoHistorial, SalidaTemporal, ItemSalidaTemporal, AprobadorSalidaTemporal,
} from '@/shared/lib/types';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { getExistencia } from '@/modules/inventario/almacenes.repository';

const T = 'solicitudes_salida_temporal';

/** Aprobadores fijos y su nombre visible (la clave define la firma del PDF). */
export const APROBADORES_SALIDA_TEMPORAL: Record<AprobadorSalidaTemporal, string> = {
  leidys: 'Leidys Rengel',
  jesus: 'Jesús Lozada',
};

function appendHistorial(
  s: Pick<SalidaTemporal, 'historial'>, evento: string, actor: string, meta: Record<string, unknown> = {},
): EventoHistorial[] {
  const ev = { at: new Date().toISOString(), evento, actor, ...meta } as EventoHistorial;
  return [...(s.historial ?? []), ev];
}

/** Próximo código global ST-AAAA-NNNN. */
async function nextCodigo(): Promise<string> {
  const year = new Date().getFullYear();
  const { count, error } = await supabase.from(T).select('id', { count: 'exact', head: true });
  if (error) throw error;
  return `ST-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

/** Próximo correlativo POR USUARIO (por actor): cada usuario tiene su serie 1,2,3…. */
async function nextNumUsuario(actor: string): Promise<number> {
  const { data, error } = await supabase
    .from(T).select('num_usuario').eq('actor', actor)
    .order('num_usuario', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (Number((data as { num_usuario?: number } | null)?.num_usuario) || 0) + 1;
}

/** Normaliza y valida las líneas de material (del inventario o "nuevo" solo-texto). */
function limpiarItems(items: ItemSalidaTemporal[] | null | undefined): ItemSalidaTemporal[] {
  return (items ?? [])
    .map((it) => ({
      producto_id: it.es_nuevo ? null : (it.producto_id ?? null),
      producto_nombre: (it.producto_nombre ?? '').trim(),
      sku: it.sku ?? null,
      cantidad: Number(it.cantidad) || 0,
      unidad: it.unidad ?? null,
      almacen: it.es_nuevo ? null : (it.almacen ?? null),
      precio_unit: it.precio_unit != null ? Number(it.precio_unit) : null,
      es_nuevo: !!it.es_nuevo,
      observacion: it.observacion?.trim() || null,
    }))
    .filter((it) => it.producto_nombre && it.cantidad > 0);
}

/** Ítems que mueven stock (de inventario, con almacén y cantidad > 0). */
function itemsInventario(s: Pick<SalidaTemporal, 'items'>): ItemSalidaTemporal[] {
  return (s.items ?? []).filter((it) => !it.es_nuevo && it.producto_id && it.almacen && (Number(it.cantidad) || 0) > 0);
}

export async function listSalidasTemporales(): Promise<SalidaTemporal[]> {
  const { data, error } = await supabase.from(T).select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SalidaTemporal[];
}

export interface CrearSalidaTemporalInput {
  items: ItemSalidaTemporal[];
  unidadSolicitante?: string | null;
  solicitante: string;
  responsable?: string | null;
  responsableCedula?: string | null;
  direccionDespacho?: string | null;
  direccionDestino?: string | null;
  motivo?: string | null;
  nota?: string | null;
  actor: string;
  actorName?: string | null;
}

/** Crea la solicitud en estado 'por_aprobar'. NO mueve stock todavía. */
export async function crearSalidaTemporal(input: CrearSalidaTemporalInput): Promise<SalidaTemporal> {
  if (!input.solicitante.trim()) throw new Error('Indicá quién hace la solicitud.');
  const items = limpiarItems(input.items);
  if (!items.length) throw new Error('Agregá al menos un material.');
  for (const it of items) {
    if (!it.es_nuevo && it.producto_id && !it.almacen) {
      throw new Error(`El material "${it.producto_nombre}" no tiene stock en ningún almacén.`);
    }
  }
  const codigo = await nextCodigo();
  const numUsuario = await nextNumUsuario(input.actor);
  const historial = appendHistorial({ historial: [] }, 'creada', input.actor);
  const { data, error } = await supabase
    .from(T)
    .insert({
      codigo,
      num_usuario: numUsuario,
      estado: 'por_aprobar',
      items,
      unidad_solicitante: input.unidadSolicitante?.trim() || null,
      solicitante: input.solicitante.trim(),
      responsable: input.responsable?.trim() || null,
      responsable_cedula: input.responsableCedula?.trim() || null,
      direccion_despacho: input.direccionDespacho?.trim() || null,
      direccion_destino: input.direccionDestino?.trim() || null,
      motivo: input.motivo?.trim() || null,
      nota: input.nota?.trim() || null,
      historial,
      actor: input.actor,
      actor_name: input.actorName ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as SalidaTemporal;
}

/**
 * Aprueba la solicitud (por_aprobar → aprobada): sale a mantenimiento, así que
 * DESCUENTA el stock de cada material de inventario. Estampa el aprobador (Leidys
 * o Jesús Lozada) que firma el PDF. Valida el stock atómico: si falta, no descuenta nada.
 */
export async function aprobarSalidaTemporal(
  s: SalidaTemporal, aprobador: AprobadorSalidaTemporal, actor: string, actorName?: string | null,
): Promise<void> {
  if (s.estado !== 'por_aprobar') throw new Error('Solo se aprueban solicitudes por aprobar.');
  const nombre = APROBADORES_SALIDA_TEMPORAL[aprobador];
  if (!nombre) throw new Error('Elegí quién aprueba (Leidys o Jesús Lozada).');
  const inv = itemsInventario(s);

  // Pre-validación atómica del stock (varias líneas del mismo par producto|almacén no reclaman dos veces).
  const disp = new Map<string, number>();
  const faltan: string[] = [];
  for (const it of inv) {
    const key = `${it.producto_id}|${it.almacen}`;
    if (!disp.has(key)) {
      const ex = await getExistencia(it.producto_id!, it.almacen!);
      disp.set(key, Number(ex?.stock) || 0);
    }
    const rest = disp.get(key)!;
    const c = Number(it.cantidad) || 0;
    if (rest < c) faltan.push(`${it.producto_nombre}: pide ${c}, hay ${rest} en ${it.almacen}`);
    else disp.set(key, rest - c);
  }
  if (faltan.length) {
    throw new Error(`No se aprobó (no se descontó stock): faltan existencias en ${faltan.length} material(es).\n• ${faltan.join('\n• ')}`);
  }

  // Descuento del inventario (salida hacia mantenimiento).
  const movOut: string[] = [];
  for (const it of inv) {
    const mov = await registrarMovimiento({
      producto_id: it.producto_id!,
      tipo: 'salida',
      delta: -(Number(it.cantidad) || 0),
      almacen: it.almacen!,
      actor,
      actor_name: actorName ?? null,
      ref_tipo: 'salida_temporal',
      ref_codigo: s.codigo,
      destino: s.unidad_solicitante || 'Mantenimiento',
      detalle: `Salida temporal a mantenimiento · ${s.codigo}${s.motivo ? ` · ${s.motivo}` : ''}`,
      solicitante: s.solicitante,
    });
    movOut.push(mov.id);
  }

  const { error } = await supabase
    .from(T)
    .update({
      estado: 'aprobada',
      aprobador: nombre,
      aprobador_firma: aprobador,
      aprobada_por: actor,
      aprobada_en: new Date().toISOString(),
      mov_out_ids: movOut.length ? movOut : null,
      historial: appendHistorial(s, `aprobada por ${nombre}`, actor, { aprobador: nombre }),
    })
    .eq('id', s.id);
  if (error) throw error;
}

/** aprobada → en_transito: la entregan de vuelta tras el mantenimiento (empieza a contar el tránsito). */
export async function ponerEnTransitoSalidaTemporal(s: SalidaTemporal, actor: string): Promise<void> {
  if (s.estado !== 'aprobada') throw new Error('Solo pasan a tránsito las solicitudes aprobadas.');
  const { error } = await supabase
    .from(T)
    .update({
      estado: 'en_transito',
      transito_por: actor,
      transito_en: new Date().toISOString(),
      historial: appendHistorial(s, 'en tránsito (entregado tras el mantenimiento)', actor),
    })
    .eq('id', s.id);
  if (error) throw error;
}

/**
 * en_transito → finalizada: el material RETORNA al inventario, así que REINGRESA
 * el stock (entrada positiva al mismo almacén; sin precio para conservar el PMP).
 */
export async function finalizarSalidaTemporal(s: SalidaTemporal, actor: string, actorName?: string | null): Promise<void> {
  if (s.estado !== 'en_transito') throw new Error('Solo se finalizan las solicitudes en tránsito.');
  const inv = itemsInventario(s);
  const movIn: string[] = [];
  for (const it of inv) {
    const mov = await registrarMovimiento({
      producto_id: it.producto_id!,
      tipo: 'entrada',
      delta: (Number(it.cantidad) || 0),
      almacen: it.almacen!,
      actor,
      actor_name: actorName ?? null,
      ref_tipo: 'salida_temporal_retorno',
      ref_codigo: s.codigo,
      detalle: `Retorno de mantenimiento · ${s.codigo}`,
      precio_unitario: null,   // sin costo: conserva el PMP del almacén (no recalcula)
      solicitante: s.solicitante,
    });
    movIn.push(mov.id);
  }
  const { error } = await supabase
    .from(T)
    .update({
      estado: 'finalizada',
      finalizada_por: actor,
      finalizada_en: new Date().toISOString(),
      mov_in_ids: movIn.length ? movIn : null,
      historial: appendHistorial(s, 'finalizada (retornó al inventario)', actor),
    })
    .eq('id', s.id);
  if (error) throw error;
}

export interface EditarSalidaTemporalInput {
  items?: ItemSalidaTemporal[] | null;
  unidadSolicitante?: string | null;
  solicitante?: string | null;
  responsable?: string | null;
  responsableCedula?: string | null;
  direccionDespacho?: string | null;
  direccionDestino?: string | null;
  motivo?: string | null;
  nota?: string | null;
}

/** Edita la solicitud SOLO mientras está por aprobar (aún no movió stock). */
export async function editarSalidaTemporal(
  s: SalidaTemporal, input: EditarSalidaTemporalInput, actor: string,
): Promise<SalidaTemporal> {
  if (s.estado !== 'por_aprobar') throw new Error('Solo se edita una solicitud Por aprobar (antes de aprobarla).');
  const patch: Record<string, unknown> = { historial: appendHistorial(s, 'editada', actor) };
  if (input.items !== undefined) {
    const items = limpiarItems(input.items);
    if (!items.length) throw new Error('Agregá al menos un material.');
    for (const it of items) {
      if (!it.es_nuevo && it.producto_id && !it.almacen) throw new Error(`El material "${it.producto_nombre}" no tiene stock en ningún almacén.`);
    }
    patch.items = items;
  }
  if (input.unidadSolicitante !== undefined) patch.unidad_solicitante = input.unidadSolicitante?.trim() || null;
  if (input.solicitante !== undefined) patch.solicitante = input.solicitante?.trim() || s.solicitante;
  if (input.responsable !== undefined) patch.responsable = input.responsable?.trim() || null;
  if (input.responsableCedula !== undefined) patch.responsable_cedula = input.responsableCedula?.trim() || null;
  if (input.direccionDespacho !== undefined) patch.direccion_despacho = input.direccionDespacho?.trim() || null;
  if (input.direccionDestino !== undefined) patch.direccion_destino = input.direccionDestino?.trim() || null;
  if (input.motivo !== undefined) patch.motivo = input.motivo?.trim() || null;
  if (input.nota !== undefined) patch.nota = input.nota?.trim() || null;
  const { data, error } = await supabase.from(T).update(patch).eq('id', s.id).select('*').single();
  if (error) throw error;
  return data as SalidaTemporal;
}

/** Elimina la solicitud (hard delete). Solo mientras está por aprobar (aún no movió stock). */
export async function eliminarSalidaTemporal(s: SalidaTemporal): Promise<void> {
  if (s.estado !== 'por_aprobar') throw new Error('Solo se elimina una solicitud Por aprobar (antes de aprobarla).');
  const { error } = await supabase.from(T).delete().eq('id', s.id);
  if (error) throw error;
}

/* ───────────── Tiempos (mantenimiento / tránsito / total) ───────────── */

function msEntre(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const d = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(d) && d >= 0 ? d : null;
}

/** Formatea una duración en ms a "N d N h N min" (es-VE). */
export function fmtDuracion(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} d`);
  if (h) parts.push(`${h} h`);
  if (m || !parts.length) parts.push(`${m} min`);
  return parts.join(' ');
}

/**
 * Tiempos de una salida temporal:
 *  - mantenimiento = aprobada → en tránsito (fuera, en el taller)
 *  - transito      = en tránsito → finalizada (de regreso al inventario)
 *  - total         = aprobada → finalizada (fuera del inventario en total)
 */
export function duracionesSalidaTemporal(s: SalidaTemporal): { mant: number | null; tran: number | null; total: number | null } {
  return {
    mant: msEntre(s.aprobada_en, s.transito_en),
    tran: msEntre(s.transito_en, s.finalizada_en),
    total: msEntre(s.aprobada_en, s.finalizada_en),
  };
}
