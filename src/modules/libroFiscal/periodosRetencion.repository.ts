/* ============================================================
   Golden Touch · Libro fiscal · Períodos: generar, declarar y reabrir (v8 · V3)

   Las funciones de la base devuelven cuántas retenciones tocaron. Sin permiso,
   con un período que no existe o en un estado que no corresponde, la base da
   error (RET_*) y aquí se traduce. Un 0 sin error no es un fallo: el período
   sí quedó declarado o reabierto, pero no movió ninguna retención (declaración
   en cero). No se informa como un «hecho» sin más: se devuelve el aviso para
   que la pantalla lo muestre.
   Con V3R los períodos van por rango (desde/hasta) sobre el impuesto
   contenedor, con su vencimiento y quién declara (GT u otro sistema). Las
   funciones de la base conservan sus nombres. Por la API solo se cambian el
   vencimiento y quién declara (este último, con motivo).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';

export interface ResultadoPeriodo {
  /** Retenciones que cambiaron de estado. */
  filas: number;
  /** Texto para la pantalla. */
  mensaje: string;
  /** true cuando no se movió ninguna retención: la pantalla lo muestra como aviso, no como éxito. */
  enCero: boolean;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plural = (k: number) => (k === 1 ? '1 retención' : `${k} retenciones`);

/** Crea los períodos del año que falten. Devuelve cuántos creó (0 = ya estaban todos). */
export async function generarPeriodos(anio: number): Promise<number> {
  const { data, error } = await supabase.rpc('retencion_periodos_generar', { p_anio: anio });
  if (error) throw errorRetencion(error, 'No se pudieron generar los períodos.');
  return n(data);
}

/** Declara un período: sus retenciones practicadas registradas pasan a «declarada». */
export async function declararPeriodo(id: string): Promise<ResultadoPeriodo> {
  const { data, error } = await supabase.rpc('retencion_periodo_declarar', { p_id: id });
  if (error) throw errorRetencion(error, 'No se pudo declarar el período.');
  const filas = n(data);
  return filas === 0
    ? { filas, enCero: true, mensaje: 'El período quedó declarado sin retenciones (declaración en cero). Si esperabas retenciones en él, revisa sus fechas y su período.' }
    : { filas, enCero: false, mensaje: `Período declarado: ${plural(filas)} pasaron a «declarada».` };
}

/** Reabre un período declarado, con su motivo: sus retenciones declaradas vuelven a «registrada». */
export async function reabrirPeriodo(id: string, motivo: string): Promise<ResultadoPeriodo> {
  const m = motivo.trim();
  if (!m) throw new Error('Indica el motivo para reabrir el período: queda en el historial.');
  const { data, error } = await supabase.rpc('retencion_periodo_reabrir', { p_id: id, p_motivo: m });
  if (error) throw errorRetencion(error, 'No se pudo reabrir el período.');
  const filas = n(data);
  return filas === 0
    ? { filas, enCero: true, mensaje: 'El período quedó reabierto, pero no tenía retenciones declaradas.' }
    : { filas, enCero: false, mensaje: `Período reabierto: ${plural(filas)} volvieron a «registrada».` };
}

/* ───────── V3R: los períodos como filas ───────── */

const T_PERIODOS = 'retencion_periodos';
export const v3Disponible = () => tablaDisponible(T_PERIODOS);

export type Declara = 'gt' | 'otro_sistema';

export interface PeriodoFiscal {
  id: string;
  tipo: string;
  periodo: string;
  /** 0 = el mes o el año; 1 y 2 = quincenas. */
  tramo: 0 | 1 | 2;
  periodicidad: 'quincenal' | 'mensual' | 'anual';
  desde: string;
  hasta: string;
  vence: string | null;
  declara: Declara;
  declaradoEn: string | null;
  declaradoPor: string | null;
  reabiertoEn: string | null;
  reabiertoPor: string | null;
  reabiertoMotivo: string | null;
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));

export function aPeriodo(r: Record<string, unknown>): PeriodoFiscal {
  const tramo = Number(r.tramo ?? 0);
  return {
    id: String(r.id), tipo: String(r.tipo), periodo: String(r.periodo),
    tramo: tramo === 1 || tramo === 2 ? tramo : 0,
    periodicidad: (r.periodicidad as PeriodoFiscal['periodicidad']) ?? 'mensual',
    desde: String(r.desde ?? ''), hasta: String(r.hasta ?? ''), vence: texto(r.vence),
    declara: r.declara === 'otro_sistema' ? 'otro_sistema' : 'gt',
    declaradoEn: texto(r.declarado_en), declaradoPor: texto(r.declarado_por),
    reabiertoEn: texto(r.reabierto_en), reabiertoPor: texto(r.reabierto_por), reabiertoMotivo: texto(r.reabierto_motivo),
  };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «Octubre 2026 · 1.ª quincena», «Octubre 2026», «Año 2026». */
export function nombrePeriodo(p: Pick<PeriodoFiscal, 'periodo' | 'tramo' | 'periodicidad'>): string {
  const y = p.periodo.slice(0, 4); const m = Number(p.periodo.slice(4, 6));
  if (p.periodicidad === 'anual') return `Año ${y}`;
  const mes = `${(MESES[m - 1] ?? '').replace(/^./, (c) => c.toUpperCase())} ${y}`;
  return p.tramo ? `${mes} · ${p.tramo === 1 ? '1.ª' : '2.ª'} quincena` : mes;
}

export type EstadoPeriodo = 'declarado' | 'vencido' | 'abierto' | 'otro_sistema';

/** Cómo está hoy: declarado; lo declara el otro sistema; vencido sin declarar; abierto. */
export function estadoPeriodo(p: Pick<PeriodoFiscal, 'declaradoEn' | 'declara' | 'vence'>, hoy: string = hoyVenezuela()): EstadoPeriodo {
  if (p.declaradoEn) return 'declarado';
  if (p.declara === 'otro_sistema') return 'otro_sistema';
  if (p.vence && p.vence < hoy) return 'vencido';
  return 'abierto';
}

/** Cuántas practicadas (sin anular) caen en el período, y cuántas ya están declaradas. Mismo criterio que la base: período fiscal y, si es quincenal, la quincena. */
export function conteoDelPeriodo(
  p: Pick<PeriodoFiscal, 'tipo' | 'periodo' | 'tramo'>,
  retenciones: { tipoGt: string; periodo: string; quincena: 1 | 2 | null; declarada: boolean }[],
): { total: number; declaradas: number } {
  const xs = retenciones.filter((r) => r.tipoGt === p.tipo && r.periodo === p.periodo && (p.tramo === 0 || r.quincena === p.tramo));
  return { total: xs.length, declaradas: xs.filter((r) => r.declarada).length };
}

/** Los períodos de un año (todos los impuestos o uno), en orden. */
export async function listPeriodos(anio: number, tipo?: string): Promise<PeriodoFiscal[]> {
  let q = supabase.from(T_PERIODOS).select('*').gte('periodo', `${anio}01`).lte('periodo', `${anio}12`);
  if (tipo) q = q.eq('tipo', tipo);
  const { data, error } = await q.order('tipo').order('desde');
  if (error) throw errorRetencion(error, 'No se pudieron leer los períodos.');
  return (data ?? []).map((r) => aPeriodo(r as Record<string, unknown>));
}

/** Cambia el vencimiento de un período (el calendario oficial se carga como dato). */
export async function cambiarVence(id: string, vence: string | null): Promise<void> {
  if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw new Error('La fecha de vencimiento no es válida.');
  const { data, error } = await supabase.from(T_PERIODOS).update({ vence: vence || null }).eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo cambiar el vencimiento.');
  if (!data?.length) throw new Error('No se cambió el vencimiento: sin permiso de escritura en Retenciones, o el período ya no existe.');
}

/** Cambia quién declara el período (GT o el otro sistema), con su motivo. Un período declarado no cambia. */
export async function cambiarDeclara(id: string, declara: Declara, motivo: string): Promise<void> {
  const m = motivo.trim();
  if (!m) throw new Error('Indica por qué cambia quién declara el período.');
  const { data, error } = await supabase.from(T_PERIODOS).update({ declara, motivo_cambio: m }).eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo cambiar quién declara.');
  if (!data?.length) throw new Error('No se cambió: sin permiso de escritura en Retenciones, o el período ya no existe.');
}

/**
 * Comprueba si una fecha y tipo de impuesto caen en un período fiscal ya declarado (cerrado con candado).
 * Devuelve el PeriodoFiscal si está cerrado, o null si está abierto.
 */
export async function periodoEstaCerrado(tipoImpuesto: string, fechaIso: string): Promise<PeriodoFiscal | null> {
  const d = fechaIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const disponible = await v3Disponible().catch(() => false);
  if (!disponible) return null;
  try {
    const { data, error } = await supabase
      .from(T_PERIODOS)
      .select('*')
      .eq('tipo', tipoImpuesto)
      .lte('desde', d)
      .gte('hasta', d)
      .not('declarado_en', 'is', null)
      .limit(1);
    if (!error && data && data.length > 0) {
      return aPeriodo(data[0] as Record<string, unknown>);
    }
  } catch { /* continuar si no hay acceso */ }
  return null;
}

