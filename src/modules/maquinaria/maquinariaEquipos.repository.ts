/* ============================================================
   MGG · Control de Maquinaria · registro de equipos
   Ficha técnica de cada equipo/maquinaria (réplica de la hoja
   DATOS MAQUINARIA). Integra con Combustible: si el equipo se
   vincula (combustible_equipo), el horómetro y el gasoil consumido
   se traen del módulo de Combustible.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { ultimoHorometroEquipo, consumoCombustiblePorEquipo } from '@/modules/combustible/combustible.repository';
import { claveEquipo } from '@/modules/combustible/equipoVinculo';

export interface MaquinariaEquipo {
  id: string;
  equipo: string;
  tipo: string | null;
  propietario: string | null;
  status: string;
  ubicacion: string | null;
  anio: number | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  serial: string | null;
  placa: string | null;
  motor_modelo: string | null;
  motor_serial: string | null;
  combustible: string | null;
  litros_consume: number | null;
  ficha_tecnica: string | null;
  ficha_mantenimiento: string | null;
  documentacion: string | null;
  mantenimiento_cada_hrs: number | null;
  /** Nivel de DISPARO de alerta (objetivo) fijado en la ficha; lecturas vienen de Combustible. */
  alerta_km: number | null;
  alerta_horometro: number | null;
  /** Intervalos de servicio por ítem (horas de horómetro) para el control de ESTADO CRÍTICO. */
  aceite_cada_hrs: number | null;
  filtro_cada_hrs: number | null;
  combustible_cada_hrs: number | null;
  combustible_equipo: string | null;
  /** Grupo del submódulo Servicio de Mantenimiento (ver GRUPOS_MANTENIMIENTO). */
  grupo_mantenimiento: string | null;
  doc_fisico: boolean;
  ficha_mantt: boolean;
  doc_drive: boolean;
  esp_tecnicas: boolean;
  revision_mina: boolean;
  notas: string | null;
  activo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export type MaquinariaEquipoInput = Partial<Omit<MaquinariaEquipo, 'id' | 'created_at' | 'updated_at'>> & { equipo: string };

/** Grupos del submódulo Servicio de Mantenimiento (switches). Orden = orden de los switches. */
export const GRUPOS_MANTENIMIENTO = ['FLOTA PESADA', 'VEHÍCULOS DE CARGA', 'PLANTAS ELÉCTRICAS'] as const;
export type GrupoMantenimiento = (typeof GRUPOS_MANTENIMIENTO)[number];

const TABLE = 'maquinaria_equipos';

export async function listEquipos(): Promise<MaquinariaEquipo[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .order('equipo', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MaquinariaEquipo[];
}

export async function getEquipo(id: string): Promise<MaquinariaEquipo | null> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as MaquinariaEquipo) ?? null;
}

function sanitize(input: MaquinariaEquipoInput): Record<string, unknown> {
  const v = (s?: string | null) => (s == null ? null : String(s).trim() || null);
  const n = (x?: number | null) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));
  return {
    equipo: input.equipo.trim().toUpperCase(),
    tipo: v(input.tipo), propietario: v(input.propietario),
    status: v(input.status) ?? 'ACTIVO',
    ubicacion: v(input.ubicacion), anio: n(input.anio),
    marca: v(input.marca), modelo: v(input.modelo), color: v(input.color),
    serial: v(input.serial), placa: v(input.placa),
    motor_modelo: v(input.motor_modelo), motor_serial: v(input.motor_serial),
    combustible: v(input.combustible), litros_consume: n(input.litros_consume),
    ficha_tecnica: v(input.ficha_tecnica), ficha_mantenimiento: v(input.ficha_mantenimiento),
    documentacion: v(input.documentacion), mantenimiento_cada_hrs: n(input.mantenimiento_cada_hrs),
    alerta_km: n(input.alerta_km), alerta_horometro: n(input.alerta_horometro),
    aceite_cada_hrs: n(input.aceite_cada_hrs), filtro_cada_hrs: n(input.filtro_cada_hrs), combustible_cada_hrs: n(input.combustible_cada_hrs),
    combustible_equipo: v(input.combustible_equipo),
    grupo_mantenimiento: v(input.grupo_mantenimiento),
    doc_fisico: !!input.doc_fisico, ficha_mantt: !!input.ficha_mantt, doc_drive: !!input.doc_drive,
    esp_tecnicas: !!input.esp_tecnicas, revision_mina: !!input.revision_mina,
    notas: v(input.notas),
  };
}

export async function addEquipo(input: MaquinariaEquipoInput, actor: string): Promise<MaquinariaEquipo> {
  if (!input.equipo?.trim()) throw new Error('Indicá el equipo.');
  const { data, error } = await supabase.from(TABLE)
    .insert({ ...sanitize(input), created_by: actor })
    .select('*').single();
  if (error) throw error;
  return data as MaquinariaEquipo;
}

export async function updateEquipo(id: string, input: MaquinariaEquipoInput): Promise<void> {
  if (!input.equipo?.trim()) throw new Error('Indicá el equipo.');
  const { error } = await supabase.from(TABLE)
    .update({ ...sanitize(input), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function setEquipoActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ activo, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function eliminarEquipo(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/* ───────── Integración con Combustible ───────── */

export interface DatosCombustibleEquipo {
  horometro: number | null;     // última lectura de horómetro (Combustible)
  gasoilLts: number;            // gasoil consumido (uso) en el rango
  gasoilUsd: number;            // su equivalente en USD
}

/**
 * Trae del módulo de Combustible el horómetro vigente y el gasoil consumido por el
 * equipo vinculado (`combustible_equipo`) en el rango dado. Devuelve ceros/null si
 * el equipo no está vinculado o no tiene movimientos.
 */
export async function datosCombustibleDeEquipo(
  combustibleEquipo: string | null | undefined,
  desde?: Date, hasta?: Date,
): Promise<DatosCombustibleEquipo> {
  const nombre = (combustibleEquipo ?? '').trim();
  if (!nombre) return { horometro: null, gasoilLts: 0, gasoilUsd: 0 };
  const d = desde ?? new Date(2000, 0, 1);
  const h = hasta ?? new Date();
  const [horometro, consumo] = await Promise.all([
    ultimoHorometroEquipo(nombre).catch(() => null),
    consumoCombustiblePorEquipo(d, h).catch(() => [] as { nombre: string; cantidad: number; valor: number }[]),
  ]);
  // Se cruza por CLAVE normalizada: `consumoCombustiblePorEquipo` agrupa las variantes
  // («Camión NHR», «CAMION NHR») en una sola fila y expone como `nombre` la primera que
  // encontró, que es arbitraria. Comparar el texto crudo dejaba el gasoil del equipo en 0.
  const clave = claveEquipo(nombre);
  const fila = consumo.find((c) => claveEquipo(c.nombre) === clave);
  return { horometro, gasoilLts: fila?.cantidad ?? 0, gasoilUsd: fila?.valor ?? 0 };
}
