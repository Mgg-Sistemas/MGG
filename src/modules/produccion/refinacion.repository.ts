/* ============================================================
   MGG · Reporte de Refinación de Lingotes de Estaño (MGG-FR-002).
   Metadata rica 1:1 con una orden de refinación (`produccion` tipo='refinacion').
   El estaño CRUDO se toma de varias coladas finalizadas (se suman sus kg como
   base y se consumen del inventario). Al finalizar, el estaño REFINADO entra a
   inventario con su costo (CP ÷ kg refinado). Todo el detalle del formato vive
   en `datos` (jsonb) para iterar sin ALTERs.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { RefinacionDatos, ProduccionRefinacion } from '@/shared/lib/types';
import { finalizarProduccion } from './produccion.repository';

const TABLE = 'produccion_refinacion';
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Etapas estándar del proceso de refinación (formato MGG-FR-002). */
export const ETAPAS_REFINACION = [
  'Fusión de la carga cruda',
  'Adición de Agentes Refinantes',
  'Agitación y Reacción',
  'Reposo y Segregación de Dross',
  'Retiro de Escoria de Refinación',
  'Preparación para Colada de Lingotes',
] as const;

/** Datos de refinación vacíos (para inicializar el formulario). */
export function refinacionDatosVacios(): RefinacionDatos {
  return {
    turno: '', responsable: '', n_horno_olla: '',
    coladas: [], estano_crudo_kg: null, pureza_inicial: null,
    metodo_agitacion: '', desespumado: '',
    etapas: ETAPAS_REFINACION.map((etapa) => ({ etapa, hora: '', temp_bano: null, temp_quemador: null, accion: etapa })),
    hora_inicio_refinacion: '', hora_fin_refinacion: '', hora_inicio_vaciado: '',
    temp_colada: null, tiempo_total_horas: null,
    estano_refinado_kg: null, n_lingotes: null, peso_prom_lingote: null, n_precinto: '',
    dross_kg: null, rendimiento: null, pureza_final: null, destino_almacen: '',
    merma_kg: null, observaciones: '', involucrados: [],
  };
}

/** Próximo N° de refinación (correlativo GLOBAL): el máximo + 1. */
export async function proximaRefinacionNum(): Promise<number> {
  const { data, error } = await supabase.from(TABLE)
    .select('refinacion_num').order('refinacion_num', { ascending: false }).limit(1);
  if (error) throw error;
  return (Number(data?.[0]?.refinacion_num) || 0) + 1;
}

/** Reporte de refinación de una orden (o null si esa orden no tiene reporte). */
export async function getRefinacion(produccionId: string): Promise<ProduccionRefinacion | null> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('produccion_id', produccionId).maybeSingle();
  if (error) throw error;
  return (data as ProduccionRefinacion) ?? null;
}

/** Reportes de varias órdenes (para pintar el N° de refinación en las tarjetas). */
export async function getRefinacionesByProduccion(ids: string[]): Promise<Map<string, ProduccionRefinacion>> {
  const out = new Map<string, ProduccionRefinacion>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from(TABLE).select('*').in('produccion_id', ids);
  if (error) throw error;
  (data ?? []).forEach((r) => out.set((r as ProduccionRefinacion).produccion_id, r as ProduccionRefinacion));
  return out;
}

/** Una colada finalizada disponible como origen de estaño crudo. */
export interface ColadaFinalizada {
  produccion_id: string;
  colada_num: number;
  fecha: string;
  producto_id: string | null;
  producto_nombre: string;
  almacen: string;
  estano_kg: number;       // estaño obtenido (= cantidad finalizada)
  costo_unitario: number;  // costo/kg de esa colada
}

/**
 * Lista las coladas (fundiciones) FINALIZADAS para elegirlas como origen del
 * estaño crudo a refinar. Cruza `produccion` (tipo='fundicion', finalizada) con
 * su reporte de colada para traer el N° de colada.
 */
export async function listColadasFinalizadas(): Promise<ColadaFinalizada[]> {
  const { data: prods, error } = await supabase
    .from('produccion')
    .select('id, producto_id, producto_nombre, cantidad, almacen_destino, costo_unitario')
    .eq('tipo', 'fundicion')
    .eq('estado', 'finalizado')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = prods ?? [];
  if (!rows.length) return [];

  const { data: coladas } = await supabase
    .from('produccion_colada')
    .select('produccion_id, colada_num, fecha')
    .in('produccion_id', rows.map((r) => r.id as string));
  const cMap = new Map<string, { colada_num: number; fecha: string }>();
  (coladas ?? []).forEach((c) => cMap.set(c.produccion_id as string, { colada_num: Number(c.colada_num) || 0, fecha: c.fecha as string }));

  return rows.map((r) => {
    const c = cMap.get(r.id as string);
    return {
      produccion_id: r.id as string,
      colada_num: c?.colada_num ?? 0,
      fecha: c?.fecha ?? '',
      producto_id: (r.producto_id as string) ?? null,
      producto_nombre: r.producto_nombre as string,
      almacen: r.almacen_destino as string,
      estano_kg: round2(Number(r.cantidad) || 0),
      costo_unitario: Number(r.costo_unitario) || 0,
    };
  });
}

/** Crea el reporte de refinación vinculado a una orden ya creada. */
export async function crearRefinacion(input: {
  produccionId: string; refinacionNum: number; fecha: string; datos: RefinacionDatos; actor?: string | null;
}): Promise<ProduccionRefinacion> {
  const { data, error } = await supabase.from(TABLE).insert({
    produccion_id: input.produccionId,
    refinacion_num: input.refinacionNum,
    fecha: input.fecha,
    datos: input.datos ?? {},
    created_by: input.actor ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as ProduccionRefinacion;
}

/** Actualiza campos sueltos del reporte (fusiona el patch sobre `datos`). */
export async function actualizarRefinacionDatos(produccionId: string, patch: Partial<RefinacionDatos>): Promise<void> {
  const actual = await getRefinacion(produccionId);
  const datos = { ...(actual?.datos ?? {}), ...patch };
  const { error } = await supabase.from(TABLE)
    .update({ datos, updated_at: new Date().toISOString() }).eq('produccion_id', produccionId);
  if (error) throw error;
}

/** Actualiza la cabecera (N° de refinación y/o fecha). */
export async function actualizarRefinacionCabecera(produccionId: string, patch: { refinacion_num?: number; fecha?: string }): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.refinacion_num != null) payload.refinacion_num = patch.refinacion_num;
  if (patch.fecha) payload.fecha = patch.fecha;
  const { error } = await supabase.from(TABLE).update(payload).eq('produccion_id', produccionId);
  if (error) throw error;
}

export interface RefinacionResultados {
  hora_inicio_refinacion?: string;
  hora_fin_refinacion?: string;
  hora_inicio_vaciado?: string;
  temp_colada?: number | null;
  tiempo_total_horas?: number | null;
  estano_refinado_kg?: number | null;
  n_lingotes?: number | null;
  peso_prom_lingote?: number | null;
  n_precinto?: string;
  dross_kg?: number | null;
  rendimiento?: number | null;
  pureza_final?: number | null;
  destino_almacen?: string;
  merma_kg?: number | null;
  observaciones?: string;
  involucrados?: string[];
}

/**
 * Finaliza la refinación: guarda los RESULTADOS en el reporte y cierra la orden.
 * El estaño REFINADO obtenido define la cantidad que ENTRA a inventario (con su
 * costo unitario = CP total ÷ estaño refinado). Si no se indicó, finaliza con la
 * cantidad original (estaño crudo cargado).
 */
export async function finalizarRefinacionConResultados(
  produccionId: string, resultados: RefinacionResultados, actor: string, actorName?: string | null,
): Promise<void> {
  await actualizarRefinacionDatos(produccionId, resultados);

  const refinado = Number(resultados.estano_refinado_kg) || 0;
  if (refinado > 0) {
    const { data: prod, error } = await supabase.from('produccion')
      .select('costo_material, mano_obra, costos_indirectos').eq('id', produccionId).single();
    if (error) throw error;
    const cp = (Number(prod.costo_material) || 0) + (Number(prod.mano_obra) || 0) + (Number(prod.costos_indirectos) || 0);
    const upd: Record<string, unknown> = { cantidad: refinado, costo_unitario: round2(cp / refinado) };
    const dest = resultados.destino_almacen?.trim();
    if (dest) upd.almacen_destino = dest;
    const { error: e2 } = await supabase.from('produccion').update(upd).eq('id', produccionId);
    if (e2) throw e2;
  }

  // Entra el estaño refinado a inventario (recalcula PMP) y marca la orden finalizada.
  await finalizarProduccion(produccionId, actor, actorName ?? null);
}
