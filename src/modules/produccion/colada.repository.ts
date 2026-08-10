/* ============================================================
   MGG · Reporte de Colada (MGG-FR-001, horno de fundición primaria)
   Metadata rica 1:1 con una orden de fundición (`produccion` tipo='fundicion').
   La orden ya consume insumos (materias primas) y, al finalizar, el estaño
   obtenido entra a inventario. Aquí se guarda todo el detalle del formato.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ColadaDatos, ProduccionColada } from '@/shared/lib/types';
import { finalizarProduccion } from './produccion.repository';

const TABLE = 'produccion_colada';
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Jornada laboral (en horas) = (fecha+hora fin) − (fecha+hora inicio) de la carga.
 *  Devuelve null si falta algún dato o si el fin no es posterior al inicio. */
export function calcJornadaHoras(fIni?: string, hIni?: string, fFin?: string, hFin?: string): number | null {
  if (!fIni || !hIni || !fFin || !hFin) return null;
  const ini = new Date(`${fIni}T${hIni}`).getTime();
  const fin = new Date(`${fFin}T${hFin}`).getTime();
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return null;
  return round2((fin - ini) / 3_600_000);
}

/** Jornada legible: "21,5 h · 21 h 30 min" (es-VE). '—' si no hay valor. */
export function fmtJornada(horas?: number | null): string {
  if (horas == null || !Number.isFinite(horas)) return '—';
  const h = Math.floor(horas);
  const min = Math.round((horas - h) * 60);
  const dec = String(round2(horas)).replace('.', ',');
  return `${dec} h · ${h} h ${min} min`;
}

/** Datos de colada vacíos (para inicializar el formulario). */
export function coladaDatosVacios(): ColadaDatos {
  return {
    turno: '', responsable: '',
    big_bags: [{ kg: null, precinto: '' }],
    total_casiterita: null, ley_sn: null, sn_kg: null,
    coque_kg: null, coque_proveedor: '', coque_granulometria: '',
    otro_fundente: 'PIRULITA', otro_fundente_kg: null,
    caco3_tipo: '', caco3_kg: null, caco3_granulometria: '',
    homogeneizacion: '', carga_horno: '',
    temp_int_abrir: null, temp_ext_abrir: null,
    fecha_inicio_carga: '', hora_inicio_carga: '', fecha_fin_carga: '', hora_fin_carga: '', jornada_horas: null,
    temp_int_cerrar: null, temp_ext_cerrar: null,
    temperaturas: [],
    hora_inicio_proceso: '', hora_fin_proceso: '', hora_sangrado: '',
    temp_colada: null, duracion_horas: null,
    estano_kg: null, escoria_kg: null, destino_almacen: '', n_lingotes: null, rendimiento: null,
    merma_kg: null, observaciones: '', involucrados: [],
  };
}

/**
 * Kg ya CONSUMIDOS de cada big bag del inventario detallado de casiterita, sumando
 * los big bags de TODAS las coladas que lo referencian (por `origen_detalle_id`).
 * Con esto el disponible de un big bag = peso_casiterita − Σ consumido, y se puede
 * usar un % o una parte, dejando el saldo para otra colada. `excluirColadaId` omite
 * una colada puntual (p. ej. al editar la propia, para no contarse a sí misma).
 */
export async function getConsumoBigBags(excluirColadaId?: string | null): Promise<Map<string, number>> {
  const { data, error } = await supabase.from(TABLE).select('id, datos');
  if (error) throw error;
  const acc = new Map<string, number>();
  for (const row of data ?? []) {
    if (excluirColadaId && (row as { id: string }).id === excluirColadaId) continue;
    const bags = ((row as { datos?: ColadaDatos }).datos?.big_bags ?? []);
    for (const b of bags) {
      const id = b.origen_detalle_id;
      if (!id) continue;
      acc.set(id, round2((acc.get(id) ?? 0) + (Number(b.kg) || 0)));
    }
  }
  return acc;
}

/** Consumo por big bag CON el detalle de en qué coladas se usó (para el inventario). */
export interface ConsumoBigBagDetalle { kg: number; coladas: { num: number; kg: number }[] }
export async function getConsumoBigBagsDetallado(): Promise<Map<string, ConsumoBigBagDetalle>> {
  const { data, error } = await supabase.from(TABLE).select('colada_num, datos');
  if (error) throw error;
  const acc = new Map<string, ConsumoBigBagDetalle>();
  for (const row of data ?? []) {
    const num = Number((row as { colada_num?: number }).colada_num) || 0;
    const bags = ((row as { datos?: ColadaDatos }).datos?.big_bags ?? []);
    for (const b of bags) {
      const id = b.origen_detalle_id;
      const kg = Number(b.kg) || 0;
      if (!id || kg <= 0) continue;
      const cur = acc.get(id) ?? { kg: 0, coladas: [] };
      cur.kg = round2(cur.kg + kg);
      const ex = cur.coladas.find((c) => c.num === num);
      if (ex) ex.kg = round2(ex.kg + kg); else cur.coladas.push({ num, kg });
      acc.set(id, cur);
    }
  }
  return acc;
}

/** Próximo Colada N° (correlativo GLOBAL): el máximo + 1. La primera se ingresa a mano. */
export async function proximaColadaNum(): Promise<number> {
  const { data, error } = await supabase.from(TABLE)
    .select('colada_num').order('colada_num', { ascending: false }).limit(1);
  if (error) throw error;
  return (Number(data?.[0]?.colada_num) || 0) + 1;
}

/** Colada de una orden de producción (o null si esa orden no tiene reporte de colada). */
export async function getColada(produccionId: string): Promise<ProduccionColada | null> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('produccion_id', produccionId).maybeSingle();
  if (error) throw error;
  return (data as ProduccionColada) ?? null;
}

/** Coladas de varias órdenes (para pintar el Colada N° en las tarjetas). */
export async function getColadasByProduccion(ids: string[]): Promise<Map<string, ProduccionColada>> {
  const out = new Map<string, ProduccionColada>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from(TABLE).select('*').in('produccion_id', ids);
  if (error) throw error;
  (data ?? []).forEach((r) => out.set((r as ProduccionColada).produccion_id, r as ProduccionColada));
  return out;
}

/** Una fila del RESUMEN GENERAL de fundición (una colada finalizada). */
export interface FundicionResumenRow {
  colada_num: number;
  fecha: string;
  almacen_destino: string;
  total_casiterita: number | null;
  ley_sn: number | null;
  sn_kg: number | null;
  coque_kg: number | null;
  caco3_kg: number | null;
  estano_kg: number;            // estaño obtenido (= cantidad finalizada)
  n_lingotes: number | null;
}

/**
 * Lista TODAS las fundiciones FINALIZADAS con el detalle de su colada, una fila
 * por colada, para el reporte general (RESUMEN DE FUNDICIÓN). Cruza `produccion`
 * (tipo='fundicion', finalizada) con su reporte de colada (`datos`).
 */
export async function listFundicionesFinalizadasConDatos(): Promise<FundicionResumenRow[]> {
  const { data: prods, error } = await supabase
    .from('produccion')
    .select('id, almacen_destino, cantidad')
    .eq('tipo', 'fundicion')
    .eq('estado', 'finalizado')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = prods ?? [];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id as string);
  const [{ data: coladas }, { data: mats }] = await Promise.all([
    supabase.from(TABLE).select('produccion_id, colada_num, fecha, datos').in('produccion_id', ids),
    supabase.from('produccion_materiales').select('produccion_id, material_nombre, cantidad').in('produccion_id', ids),
  ]);
  const cMap = new Map<string, ProduccionColada>();
  (coladas ?? []).forEach((c) => cMap.set((c as ProduccionColada).produccion_id, c as ProduccionColada));

  // Fundentes ahora viven en la RECETA (produccion_materiales): se suman por nombre
  // (case-insensitive) para poblar las columnas Coque / CaCO₃ del resumen.
  const fund = new Map<string, { coque: number; caco3: number }>();
  (mats ?? []).forEach((m) => {
    const pid = m.produccion_id as string;
    const nombre = String(m.material_nombre ?? '');
    const cant = Number(m.cantidad) || 0;
    const acc = fund.get(pid) ?? { coque: 0, caco3: 0 };
    if (/coque/i.test(nombre)) acc.coque += cant;
    else if (/caco3|caco₃|caliza|calc[aá]reo|carbonato/i.test(nombre)) acc.caco3 += cant;
    fund.set(pid, acc);
  });

  return rows.map((r) => {
    const c = cMap.get(r.id as string);
    const d: ColadaDatos = c?.datos ?? {};
    const f = fund.get(r.id as string) ?? { coque: 0, caco3: 0 };
    return {
      colada_num: c ? Number(c.colada_num) || 0 : 0,
      fecha: c?.fecha ?? '',
      almacen_destino: (r.almacen_destino as string) ?? '',
      total_casiterita: d.total_casiterita ?? null,
      ley_sn: d.ley_sn ?? null,
      sn_kg: d.sn_kg ?? null,
      coque_kg: d.coque_kg ?? (f.coque || null),
      caco3_kg: d.caco3_kg ?? (f.caco3 || null),
      estano_kg: Number(r.cantidad) || 0,
      n_lingotes: d.n_lingotes ?? null,
    };
  }).sort((a, b) => a.colada_num - b.colada_num);
}

/** Total de lingotes producidos en fundición (Σ N° lingotes de todas las coladas
 *  finalizadas). Es la "segunda medida" (unidades) del stock de ESTAÑO EN BRUTO,
 *  que en inventario se lleva en kg. */
export async function totalLingotesFundicion(): Promise<number> {
  const filas = await listFundicionesFinalizadasConDatos();
  return filas.reduce((a, f) => a + (Number(f.n_lingotes) || 0), 0);
}

/** Crea el reporte de colada vinculado a una orden de fundición ya creada. */
export async function crearColada(input: {
  produccionId: string; coladaNum: number; fecha: string; datos: ColadaDatos; actor?: string | null;
}): Promise<ProduccionColada> {
  const { data, error } = await supabase.from(TABLE).insert({
    produccion_id: input.produccionId,
    colada_num: input.coladaNum,
    fecha: input.fecha,
    datos: input.datos ?? {},
    created_by: input.actor ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as ProduccionColada;
}

/** Actualiza campos sueltos del reporte (fusiona el patch sobre `datos`). */
export async function actualizarColadaDatos(produccionId: string, patch: Partial<ColadaDatos>): Promise<void> {
  const actual = await getColada(produccionId);
  const datos = { ...(actual?.datos ?? {}), ...patch };
  const { error } = await supabase.from(TABLE)
    .update({ datos, updated_at: new Date().toISOString() }).eq('produccion_id', produccionId);
  if (error) throw error;
}

/** Actualiza la cabecera (Colada N° y/o fecha) del reporte. */
export async function actualizarColadaCabecera(produccionId: string, patch: { colada_num?: number; fecha?: string }): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.colada_num != null) payload.colada_num = patch.colada_num;
  if (patch.fecha) payload.fecha = patch.fecha;
  const { error } = await supabase.from(TABLE).update(payload).eq('produccion_id', produccionId);
  if (error) throw error;
}

export interface ColadaResultados {
  estano_kg?: number | null;
  escoria_kg?: number | null;
  destino_almacen?: string;
  n_lingotes?: number | null;
  rendimiento?: number | null;   // %
  merma_kg?: number | null;
  observaciones?: string;
  involucrados?: string[];
}

/**
 * Finaliza la colada: guarda los RESULTADOS en el reporte y cierra la orden de
 * fundición. El estaño obtenido define la cantidad que ENTRA a inventario (con su
 * costo unitario = CP total ÷ estaño obtenido). Si no se indicó estaño, se finaliza
 * con la cantidad estimada original.
 */
export async function finalizarColadaConResultados(
  produccionId: string, resultados: ColadaResultados, actor: string, actorName?: string | null,
): Promise<void> {
  await actualizarColadaDatos(produccionId, resultados);

  const estano = Number(resultados.estano_kg) || 0;
  if (estano > 0) {
    const { data: prod, error } = await supabase.from('produccion')
      .select('costo_material, mano_obra, costos_indirectos').eq('id', produccionId).single();
    if (error) throw error;
    const cp = (Number(prod.costo_material) || 0) + (Number(prod.mano_obra) || 0) + (Number(prod.costos_indirectos) || 0);
    const upd: Record<string, unknown> = { cantidad: estano, costo_unitario: round2(cp / estano) };
    const dest = resultados.destino_almacen?.trim();
    if (dest) upd.almacen_destino = dest;
    const { error: e2 } = await supabase.from('produccion').update(upd).eq('id', produccionId);
    if (e2) throw e2;
  }

  // Entra el estaño terminado a inventario (recalcula PMP) y marca la orden finalizada.
  await finalizarProduccion(produccionId, actor, actorName ?? null);
}
