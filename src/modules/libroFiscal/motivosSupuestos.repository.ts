/* ============================================================
   Golden Touch · Retenciones · Motivos de «No aplica» y supuestos (R6)

   · Motivos de «No aplica»: por qué una factura no lleva retención, por
     impuesto o para todos, con vigencia (desde/hasta) y si piden un texto.
   · Supuestos: los casos que imponen un % de retención (el 100 % del art. 5
     del IVA), por impuesto, con vigencia.
   La vigencia se escribe a mano (desde/hasta); la base no cierra versiones.
   La «nota» es el motivo del cambio: la base la pasa al historial. La
   retención guarda el texto elegido como foto (retenciones.motivo).
   Sin R6, el IVA sigue con las cinco casillas fijas del art. 5.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';

const T_MOTIVOS = 'retencion_motivos_no_aplica';
const T_SUPUESTOS = 'retencion_supuestos';

export const r6Disponible = () => tablaDisponible(T_SUPUESTOS);

interface Vigencia { desde: string; hasta: string | null; activo: boolean; orden: number; fuente: string | null; nota: string | null }

export interface MotivoNoAplica extends Vigencia {
  id: string;
  /** null = para todos los impuestos. */
  impuestoClave: string | null;
  texto: string;
  /** Si al elegirlo hay que escribir un detalle. */
  requiereTexto: boolean;
  actualizadoPor: string | null;
}

export interface Supuesto extends Vigencia {
  id: string;
  impuestoClave: string;
  codigo: string;
  texto: string;
  pct: number;
  actualizadoPor: string | null;
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;

const vigencia = (r: Record<string, unknown>): Vigencia => ({
  desde: String(r.desde ?? ''), hasta: texto(r.hasta), activo: r.activo !== false,
  orden: Number(r.orden ?? 0) || 0, fuente: texto(r.fuente), nota: texto(r.nota),
});

export function aMotivo(r: Record<string, unknown>): MotivoNoAplica {
  return {
    ...vigencia(r),
    id: String(r.id),
    impuestoClave: texto(r.impuesto_clave ?? r.tipo),
    texto: String(r.texto ?? ''),
    requiereTexto: r.requiere_texto === true,
    actualizadoPor: texto(r.actualizado_por),
  };
}

export function aSupuesto(r: Record<string, unknown>): Supuesto {
  return { ...vigencia(r), id: String(r.id), impuestoClave: String(r.impuesto_clave ?? ''), codigo: String(r.codigo ?? ''),
    texto: String(r.texto ?? ''), pct: Number(r.pct ?? 0), actualizadoPor: texto(r.actualizado_por) };
}

/* ───────── Piezas puras ───────── */

/** ¿Vale en esa fecha? Igual que las funciones de vigentes de la base. */
export const vigenteEn = (x: Pick<Vigencia, 'activo' | 'desde' | 'hasta'>, fecha: string = hoyIso()) =>
  x.activo && x.desde <= fecha && (!x.hasta || x.hasta >= fecha);

/** Los supuestos marcados → el % que manda (el mayor) y el texto que queda como foto. null si no hay marcados. */
export function supuestoAplicado(marcados: Record<string, boolean | undefined>, supuestos: Pick<Supuesto, 'codigo' | 'pct' | 'texto'>[]): { pct: number; texto: string } | null {
  const xs = supuestos.filter((s) => marcados[s.codigo]);
  if (!xs.length) return null;
  const mayor = [...xs].sort((a, b) => b.pct - a.pct)[0];
  return { pct: mayor.pct, texto: xs.map((s) => s.texto).join('; ') };
}

function faltaEnVigencia(v: { desde: string; hasta?: string | null }, nota: string): string | null {
  if (!FECHA.test(v.desde)) return 'Indica desde qué fecha vale.';
  if (v.hasta && (!FECHA.test(v.hasta) || v.hasta < v.desde)) return 'La fecha «hasta» no puede ser anterior a «desde».';
  if (!nota.trim()) return 'Indica el motivo del cambio: queda en el historial.';
  return null;
}

export function faltaEnMotivo(m: { texto: string; desde: string; hasta?: string | null }, nota: string): string | null {
  if (m.texto.trim().length < 3) return 'El motivo necesita al menos 3 letras.';
  return faltaEnVigencia(m, nota);
}

export function faltaEnSupuesto(s: { impuestoClave: string; codigo: string; texto: string; pct: number; orden?: number; desde: string; hasta?: string | null }, nota: string): string | null {
  if (!s.impuestoClave) return 'Indica el impuesto del supuesto.';
  if (!/^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(s.codigo)) return 'El código va sin espacios ni acentos (letras, números y _), empieza con una letra y lleva de 2 a 41 caracteres.';
  if (s.texto.trim().length < 3) return 'El texto del supuesto necesita al menos 3 letras.';
  if (!Number.isFinite(s.pct) || s.pct < 0 || s.pct > 100) return 'El porcentaje va de 0 a 100.';
  if (s.orden != null && s.orden < 0) return 'El orden no puede ser negativo.';
  return faltaEnVigencia(s, nota);
}

/**
 * ¿Ya hay en ese impuesto otro supuesto con el mismo código, sin distinguir
 * mayúsculas? La base lo rechaza (retencion_supuestos_codigo_unico_sin_mayusculas):
 * con la lista a mano se avisa antes de mandar.
 */
export function supuestoRepetido(s: { impuestoClave: string; codigo: string }, lista: Pick<Supuesto, 'id' | 'impuestoClave' | 'codigo'>[], idPropio?: string): string | null {
  const c = s.codigo.trim().toLowerCase();
  if (!c) return null;
  const otro = lista.find((x) => x.id !== idPropio && x.impuestoClave === s.impuestoClave && x.codigo.toLowerCase() === c);
  return otro ? `Ese impuesto ya tiene el supuesto «${otro.codigo}»: el código no puede repetirse cambiando solo mayúsculas.` : null;
}

/* ───────── Lectura ───────── */

export async function listMotivos(): Promise<MotivoNoAplica[]> {
  try {
    const { data, error } = await supabase.from(T_MOTIVOS).select('*').order('orden').order('texto');
    if (!error && data) return data.map((r) => aMotivo(r as Record<string, unknown>));
  } catch { /* fallback */ }
  const { data, error } = await supabase.from(T_MOTIVOS).select('*');
  if (error) throw errorRetencion(error, 'No se pudieron leer los motivos.');
  return (data ?? []).map((r) => aMotivo(r as Record<string, unknown>));
}

export async function listSupuestos(): Promise<Supuesto[]> {
  if (!(await r6Disponible())) return [];
  const { data, error } = await supabase.from(T_SUPUESTOS).select('*').order('orden').order('codigo');
  if (error) throw errorRetencion(error, 'No se pudieron leer los supuestos.');
  return (data ?? []).map((r) => aSupuesto(r as Record<string, unknown>));
}

/** Los motivos de «No aplica» que valen para un impuesto en una fecha (los generales incluidos). */
export async function motivosVigentes(impuesto: string, fecha: string): Promise<MotivoNoAplica[]> {
  try {
    const { data, error } = await supabase.rpc('retencion_motivos_vigentes', { p_impuesto: impuesto, p_fecha: fecha });
    if (!error && data) return ((data ?? []) as Record<string, unknown>[]).map(aMotivo);
  } catch { /* RPC fallback */ }

  const impMin = impuesto.toLowerCase();
  try {
    const { data, error } = await supabase.from(T_MOTIVOS).select('*')
      .or(`tipo.eq.${impMin},tipo.is.null`)
      .eq('activo', true)
      .order('orden');
    if (!error && data) return data.map((r) => aMotivo(r as Record<string, unknown>));
  } catch { /* fallback */ }

  try {
    const { data } = await supabase.from(T_MOTIVOS).select('*').eq('activo', true);
    return ((data ?? []) as Record<string, unknown>[]).map(aMotivo);
  } catch {
    return [];
  }
}

/** Los supuestos de un impuesto en una fecha. Sin R6, null: la pantalla usa las casillas fijas. */
export async function supuestosVigentes(impuesto: string, fecha: string): Promise<Supuesto[] | null> {
  if (!(await r6Disponible())) return null;
  const { data, error } = await supabase.rpc('retencion_supuestos_vigentes', { p_impuesto: impuesto, p_fecha: fecha });
  if (error) throw errorRetencion(error, 'No se pudieron leer los supuestos.');
  return ((data ?? []) as Record<string, unknown>[]).map(aSupuesto);
}

/* ───────── Escritura ───────── */

export interface MotivoDatos { impuestoClave: string | null; texto: string; requiereTexto: boolean; orden: number; desde: string; hasta?: string | null; fuente?: string | null; activo?: boolean }
export interface SupuestoDatos { impuestoClave: string; codigo: string; texto: string; pct: number; orden: number; desde: string; hasta?: string | null; fuente?: string | null; activo?: boolean }

const filaMotivo = (m: MotivoDatos, nota: string) => ({
  impuesto_clave: m.impuestoClave || null, texto: m.texto.trim(), requiere_texto: m.requiereTexto, orden: m.orden,
  desde: m.desde, hasta: m.hasta || null, fuente: m.fuente?.trim() || null, activo: m.activo ?? true, nota: nota.trim(),
});
const filaSupuesto = (s: SupuestoDatos, nota: string) => ({
  impuesto_clave: s.impuestoClave, codigo: s.codigo.trim(), texto: s.texto.trim(), pct: s.pct, orden: s.orden,
  desde: s.desde, hasta: s.hasta || null, fuente: s.fuente?.trim() || null, activo: s.activo ?? true, nota: nota.trim(),
});

const exigirFila = (data: unknown, que: string) => {
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(`No se guardó ${que}: sin permiso de escritura en Retenciones, o ya no existe.`);
  return id;
};

/** Alta (sin id) o cambio (con id) de un motivo de «No aplica». */
export async function guardarMotivo(m: MotivoDatos, nota: string, id?: string): Promise<string> {
  const falta = faltaEnMotivo(m, nota);
  if (falta) throw new Error(falta);
  const fila = filaMotivo(m, nota);
  const q = id ? supabase.from(T_MOTIVOS).update(fila).eq('id', id) : supabase.from(T_MOTIVOS).insert(fila);
  const { data, error } = await q.select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar el motivo.', { unico: 'Ya hay un motivo con ese texto para ese impuesto.', regla: 'Revisa el motivo: texto de 3 letras o más y «hasta» después de «desde».' });
  return exigirFila(data, 'el motivo');
}

/** Alta (sin id) o cambio (con id) de un supuesto. */
export async function guardarSupuesto(s: SupuestoDatos, nota: string, id?: string): Promise<string> {
  const falta = faltaEnSupuesto(s, nota);
  if (falta) throw new Error(falta);
  const fila = filaSupuesto(s, nota);
  const q = id ? supabase.from(T_SUPUESTOS).update(fila).eq('id', id) : supabase.from(T_SUPUESTOS).insert(fila);
  const { data, error } = await q.select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar el supuesto.', { unico: 'Ese impuesto ya tiene un supuesto con ese código.', regla: 'Revisa el supuesto: % de 0 a 100 y «hasta» después de «desde».' });
  return exigirFila(data, 'el supuesto');
}

/** Activa o desactiva (no se borra), con el motivo en la nota. */
export async function activarMotivo(id: string, activo: boolean, nota: string): Promise<void> {
  if (!nota.trim()) throw new Error('Indica el motivo del cambio.');
  const { data, error } = await supabase.from(T_MOTIVOS).update({ activo, nota: nota.trim() }).eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo cambiar el motivo.');
  exigirFila(data, 'el cambio');
}

export async function activarSupuesto(id: string, activo: boolean, nota: string): Promise<void> {
  if (!nota.trim()) throw new Error('Indica el motivo del cambio.');
  const { data, error } = await supabase.from(T_SUPUESTOS).update({ activo, nota: nota.trim() }).eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo cambiar el supuesto.');
  exigirFila(data, 'el cambio');
}
