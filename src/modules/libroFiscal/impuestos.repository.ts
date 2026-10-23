/* ============================================================
   Golden Touch · Retenciones · Impuestos y reglas (R2: el impuesto contenedor)

   Cada impuesto es una ficha (retencion_impuestos): nombre, ente, si admite
   practicada o sufrida, su serie (formato, modo, inicial y último número del
   otro sistema), «Operación N°», si agrupa, qué exporta, orden y estado. Lo que
   cambia con el tiempo va en versiones (retencion_impuesto_versiones):
   periodicidad, vencimiento, plazo de entrega, convivencia y base legal. Una
   versión nueva se manda solo con «desde»: la base cierra la anterior el día
   antes. La vigente se puede corregir (con motivo).

   Cada cambio de la ficha lleva su motivo (motivo_cambio): la base lo pasa al
   historial (retencion_historial, solo lectura) y lo vacía.
   Depende del paquete R2; no se monta en pantalla hasta que BD lo confirme.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';

const T_IMPUESTOS = 'retencion_impuestos';
const T_VERSIONES = 'retencion_impuesto_versiones';
const T_HISTORIAL = 'retencion_historial';

export type FormatoSerie = 'AAAAMM8' | 'N10';
export type ModoSerie = 'automatica' | 'manual';
export type Exporta = 'txt' | 'xml' | 'planilla' | 'ninguno';
export type Periodicidad = 'quincenal' | 'mensual' | 'anual';
export type VenceSiInhabil = 'siguiente_habil' | 'anterior_habil' | 'igual';

export const EXPORTA: { key: Exporta; label: string }[] = [
  { key: 'txt', label: 'TXT' }, { key: 'xml', label: 'XML' }, { key: 'planilla', label: 'Planilla' }, { key: 'ninguno', label: 'Nada' },
];
export const PERIODICIDADES: { key: Periodicidad; label: string }[] = [
  { key: 'quincenal', label: 'Quincenal' }, { key: 'mensual', label: 'Mensual' }, { key: 'anual', label: 'Anual' },
];
export const VENCE_SI_INHABIL: { key: VenceSiInhabil; label: string }[] = [
  { key: 'siguiente_habil', label: 'Pasa al siguiente día hábil' },
  { key: 'anterior_habil', label: 'Se adelanta al día hábil anterior' },
  { key: 'igual', label: 'Vence igual' },
];

export interface VersionImpuesto {
  id: string;
  impuestoClave: string;
  desde: string;
  hasta: string | null;
  periodicidad: Periodicidad;
  venceDia: number | null;
  venceSiInhabil: VenceSiInhabil;
  plazoEntregaDias: number;
  plazoDiasHabiles: boolean;
  convive: boolean;
  otroSistemaNombre: string | null;
  otroSistemaEnTotales: boolean;
  baseLegal: string | null;
  fuente: string | null;
  motivo: string;
  actualizadoEn: string | null;
  actualizadoPor: string | null;
}

export interface Impuesto {
  clave: string;
  nombre: string;
  enteId: string | null;
  admitePracticada: boolean;
  admiteSufrida: boolean;
  numera: boolean;
  serieFormato: FormatoSerie | null;
  serieModo: ModoSerie;
  serieInicial: number;
  serieUltimoOtroSistema: number | null;
  numeraOperacion: boolean;
  agrupa: boolean;
  exporta: Exporta;
  orden: number;
  activo: boolean;
  /** Las versiones, la más nueva primero. */
  versiones: VersionImpuesto[];
  actualizadoEn: string | null;
  actualizadoPor: string | null;
}

export interface CambioHistorial {
  id: number;
  tabla: string;
  clave: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  motivo: string | null;
  actor: string | null;
  at: string;
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;

/* ───────── Piezas puras ───────── */

export function aVersionImpuesto(r: Record<string, unknown>): VersionImpuesto {
  return {
    id: String(r.id), impuestoClave: String(r.impuesto_clave ?? ''),
    desde: String(r.desde ?? ''), hasta: texto(r.hasta),
    periodicidad: (r.periodicidad as Periodicidad) ?? 'mensual',
    venceDia: num(r.vence_dia), venceSiInhabil: (r.vence_si_inhabil as VenceSiInhabil) ?? 'siguiente_habil',
    plazoEntregaDias: num(r.plazo_entrega_dias) ?? 2, plazoDiasHabiles: r.plazo_dias_habiles !== false,
    convive: r.convive === true, otroSistemaNombre: texto(r.otro_sistema_nombre), otroSistemaEnTotales: r.otro_sistema_en_totales === true,
    baseLegal: texto(r.base_legal), fuente: texto(r.fuente), motivo: String(r.motivo ?? ''),
    actualizadoEn: texto(r.actualizado_en), actualizadoPor: texto(r.actualizado_por),
  };
}

const NOMBRES_IMPUESTO_MGG: Record<string, string> = {
  iva: 'Retención de IVA',
  islr: 'Retención de ISLR',
  municipal: 'Retención municipal (ISAE)',
  regional: 'Timbre fiscal estadal',
  igtf: 'IGTF',
};

export function aImpuesto(r: Record<string, unknown>): Impuesto {
  const vs = (r.retencion_impuesto_versiones as Record<string, unknown>[] | undefined) ?? [];
  const clave = String(r.clave);
  const nombre = String(r.nombre ?? NOMBRES_IMPUESTO_MGG[clave.toLowerCase()] ?? clave.toUpperCase());
  const versionesMapeadas = vs.length > 0
    ? vs.map(aVersionImpuesto).sort((a, b) => b.desde.localeCompare(a.desde))
    : [
        {
          id: `ver-${clave}`,
          impuestoClave: clave,
          desde: r.vigente_desde ? String(r.vigente_desde).slice(0, 10) : '2020-01-01',
          hasta: texto(r.vigente_hasta)?.slice(0, 10) ?? null,
          periodicidad: (r.periodicidad as Periodicidad) ?? 'mensual',
          venceDia: num(r.vence_dias_mes_siguiente),
          venceSiInhabil: 'siguiente_habil' as VenceSiInhabil,
          plazoEntregaDias: 2,
          plazoDiasHabiles: true,
          convive: false,
          otroSistemaNombre: null,
          otroSistemaEnTotales: false,
          baseLegal: texto(r.vence_fuente),
          fuente: texto(r.vence_fuente),
          motivo: 'Configuración inicial de impuesto',
          actualizadoEn: texto(r.actualizado_en),
          actualizadoPor: texto(r.actualizado_por),
        },
      ];

  return {
    clave,
    nombre,
    enteId: texto(r.ente_id ?? r.ente),
    admitePracticada: r.admite_practicada !== false,
    admiteSufrida: r.admite_sufrida !== false && r.admite_recibida !== false,
    numera: r.numera !== false,
    serieFormato: (texto(r.serie_prefijo) === 'AAAAMM' ? 'AAAAMM8' : (texto(r.serie_formato) as FormatoSerie | null)),
    serieModo: r.serie_modo === 'manual' ? 'manual' : 'automatica',
    serieInicial: num(r.serie_inicial) ?? 1,
    serieUltimoOtroSistema: num(r.serie_ultimo_otro_sistema),
    numeraOperacion: r.numera_operacion === true,
    agrupa: r.agrupa === true,
    exporta: (r.exporta as Exporta) ?? 'ninguno',
    orden: num(r.orden) ?? 0,
    activo: r.activo !== false,
    versiones: versionesMapeadas,
    actualizadoEn: texto(r.actualizado_en),
    actualizadoPor: texto(r.actualizado_por),
  };
}

/** La versión que vale en una fecha; si la fecha es anterior a la primera, la primera. Igual que retencion_impuesto_version. */
export function versionDeFecha(versiones: VersionImpuesto[], fecha: string = hoyIso()): VersionImpuesto | null {
  const orden = [...versiones].sort((a, b) => b.desde.localeCompare(a.desde));
  return orden.find((v) => v.desde <= fecha) ?? orden[orden.length - 1] ?? null;
}

/** Suma días hábiles (lunes a viernes, sin feriados). Igual que retencion_dias_habiles_sumar. */
export function sumarDiasHabiles(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  let n = 0;
  while (n < dias) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Fecha límite de entrega del comprobante con una versión. Igual que retencion_plazo_entrega. */
export function plazoEntrega(v: Pick<VersionImpuesto, 'plazoEntregaDias' | 'plazoDiasHabiles'>, fecha: string): string {
  if (v.plazoDiasHabiles) return sumarDiasHabiles(fecha, v.plazoEntregaDias);
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + v.plazoEntregaDias);
  return d.toISOString().slice(0, 10);
}

export type FichaImpuesto = Omit<Impuesto, 'versiones' | 'actualizadoEn' | 'actualizadoPor'>;

/** Lo que falta o sobra en la ficha, o null. Las mismas reglas que la tabla. */
export function faltaEnImpuesto(f: Partial<FichaImpuesto> & { clave: string; nombre: string }): string | null {
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(f.clave)) return 'La clave va en mayúsculas, sin espacios (letras, números y _), de 2 a 30.';
  if (f.nombre.trim().length < 2) return 'El nombre necesita al menos 2 letras.';
  if (f.admitePracticada === false && f.admiteSufrida === false) return 'El impuesto tiene que admitir practicadas, recibidas o ambas.';
  if (f.numera && !f.serieFormato) return 'Un impuesto que numera lleva el formato de su serie.';
  if (f.orden != null && Number.isFinite(f.orden) && f.orden < 0) return 'El orden no puede ser negativo.';
  if (f.serieInicial != null && (!Number.isInteger(f.serieInicial) || f.serieInicial < 1)) return 'El primer número de la serie es un entero desde 1.';
  if (f.serieUltimoOtroSistema != null && f.serieUltimoOtroSistema < 0) return 'El último número del otro sistema no puede ser negativo.';
  if (f.serieUltimoOtroSistema != null && f.serieInicial != null && f.serieInicial <= f.serieUltimoOtroSistema) {
    return `El primer número tiene que ser mayor que el último del otro sistema (${f.serieUltimoOtroSistema}).`;
  }
  return null;
}

export type DatosVersion = Omit<VersionImpuesto, 'id' | 'impuestoClave' | 'desde' | 'hasta' | 'motivo' | 'actualizadoEn' | 'actualizadoPor'>;

export function faltaEnVersion(v: DatosVersion, desde: string, motivo: string): string | null {
  if (!FECHA.test(desde)) return 'Indica desde qué fecha vale la versión.';
  if (!motivo.trim()) return 'Indica el motivo: queda en el historial.';
  if (v.venceDia != null && (!Number.isInteger(v.venceDia) || v.venceDia < 1 || v.venceDia > 31)) return 'El día de vencimiento va del 1 al 31.';
  if (!Number.isInteger(v.plazoEntregaDias) || v.plazoEntregaDias < 0 || v.plazoEntregaDias > 60) return 'El plazo de entrega va de 0 a 60 días.';
  if (v.convive && !v.otroSistemaNombre?.trim()) return 'Si convive con otro sistema, indica cuál.';
  return null;
}

const filaFicha = (f: Partial<FichaImpuesto>): Record<string, unknown> => {
  const p: Record<string, unknown> = {};
  if (f.nombre !== undefined) p.nombre = f.nombre.trim();
  if (f.enteId !== undefined) p.ente_id = f.enteId || null;
  if (f.admitePracticada !== undefined) p.admite_practicada = f.admitePracticada;
  if (f.admiteSufrida !== undefined) p.admite_sufrida = f.admiteSufrida;
  if (f.numera !== undefined) p.numera = f.numera;
  if (f.serieFormato !== undefined) p.serie_formato = f.serieFormato;
  if (f.serieModo !== undefined) p.serie_modo = f.serieModo;
  if (f.serieInicial !== undefined) p.serie_inicial = f.serieInicial;
  if (f.serieUltimoOtroSistema !== undefined) p.serie_ultimo_otro_sistema = f.serieUltimoOtroSistema;
  if (f.numeraOperacion !== undefined) p.numera_operacion = f.numeraOperacion;
  if (f.agrupa !== undefined) p.agrupa = f.agrupa;
  if (f.exporta !== undefined) p.exporta = f.exporta;
  if (f.orden !== undefined) p.orden = f.orden;
  if (f.activo !== undefined) p.activo = f.activo;
  return p;
};

const filaVersion = (v: DatosVersion): Record<string, unknown> => ({
  periodicidad: v.periodicidad, vence_dia: v.venceDia, vence_si_inhabil: v.venceSiInhabil,
  plazo_entrega_dias: v.plazoEntregaDias, plazo_dias_habiles: v.plazoDiasHabiles,
  convive: v.convive, otro_sistema_nombre: v.convive ? v.otroSistemaNombre?.trim() || null : null,
  otro_sistema_en_totales: v.convive ? v.otroSistemaEnTotales : false,
  base_legal: v.baseLegal?.trim() || null, fuente: v.fuente?.trim() || null,
});

const TEXTOS_FICHA = {
  unico: 'Ya hay un impuesto con esa clave.',
  regla: 'Revisa la ficha: admite practicadas o recibidas, y si numera lleva el formato de su serie.',
};
const TEXTOS_VERSION = {
  unico: 'Ya hay una versión de ese impuesto que empieza en esa fecha: elige otra fecha.',
  regla: 'Revisa la versión: el día de vencimiento va del 1 al 31, el plazo de 0 a 60 días y, si convive, el nombre del otro sistema.',
};

/* ───────── Lectura ───────── */

/** Todos los impuestos con sus versiones, en su orden. */
export async function listImpuestos(): Promise<Impuesto[]> {
  const hayVersiones = await tablaDisponible(T_VERSIONES);
  if (hayVersiones) {
    const { data, error } = await supabase.from(T_IMPUESTOS).select(`*, ${T_VERSIONES}(*)`).order('orden').order('clave');
    if (error) throw errorRetencion(error, 'No se pudieron leer los impuestos.');
    return (data ?? []).map((r) => aImpuesto(r as Record<string, unknown>));
  }
  const { data, error } = await supabase.from(T_IMPUESTOS).select('*').order('orden').order('clave');
  if (error) throw errorRetencion(error, 'No se pudieron leer los impuestos.');
  return (data ?? []).map((r) => aImpuesto(r as Record<string, unknown>));
}

/** El historial de un impuesto (ficha y versiones), el más nuevo primero. */
export async function historialImpuesto(clave: string, limite = 50): Promise<CambioHistorial[]> {
  if (!(await tablaDisponible(T_HISTORIAL))) return [];
  const { data, error } = await supabase.from(T_HISTORIAL).select('*')
    .in('tabla', [T_IMPUESTOS, T_VERSIONES]).eq('clave', clave).order('at', { ascending: false }).limit(limite);
  if (error) throw errorRetencion(error, 'No se pudo leer el historial.');
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: Number(x.id), tabla: String(x.tabla), clave: String(x.clave),
      antes: (x.antes as Record<string, unknown> | null) ?? null, despues: (x.despues as Record<string, unknown> | null) ?? null,
      motivo: texto(x.motivo), actor: texto(x.actor), at: String(x.at ?? ''),
    };
  });
}

/**
 * La serie de un impuesto (V2R la lee de aquí): si numera y con qué formato.
 * Sin R2 (o si el impuesto no está), null: quien llama usa las reglas fijas.
 */
export async function serieDeImpuesto(clave: string): Promise<{ numera: boolean; formato: FormatoSerie | null } | null> {
  if (!(await tablaDisponible(T_IMPUESTOS))) return null;
  const { data, error } = await supabase.from(T_IMPUESTOS).select('numera, serie_formato, serie_prefijo').eq('clave', clave.toLowerCase()).maybeSingle();
  if (error) throw errorRetencion(error, 'No se pudo leer la serie del impuesto.');
  if (!data) return null;
  const r = data as { numera: boolean; serie_formato?: string | null; serie_prefijo?: string | null };
  const formato: FormatoSerie | null = r.serie_prefijo === 'AAAAMM' ? 'AAAAMM8' : ((r.serie_formato as FormatoSerie | null) ?? 'N10');
  return { numera: r.numera !== false, formato };
}

/** El plazo de entrega que calcula la base para una fecha. */
export async function consultarPlazoEntrega(clave: string, fecha: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('retencion_plazo_entrega', { p_clave: clave, p_fecha: fecha });
    if (!error && data) return texto(data);
  } catch {
    // fallback
  }
  return sumarDiasHabiles(fecha, 2);
}

/* ───────── Escritura ───────── */

/** Cambia la ficha de un impuesto, con el motivo de este cambio. */
export async function guardarImpuesto(clave: string, cambios: Partial<FichaImpuesto>, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error('Indica el motivo del cambio: queda en el historial.');
  if (cambios.nombre !== undefined) {
    const falta = faltaEnImpuesto({ clave, nombre: cambios.nombre, ...cambios });
    if (falta) throw new Error(falta);
  }
  const hayVersiones = await tablaDisponible(T_VERSIONES);
  if (hayVersiones) {
    const { data, error } = await supabase.from(T_IMPUESTOS)
      .update({ ...filaFicha(cambios), motivo_cambio: motivo.trim() }).eq('clave', clave).select('clave');
    if (error) throw errorRetencion(error, 'No se pudo guardar el impuesto.', TEXTOS_FICHA);
    if (!data?.length) throw new Error('No se guardó el impuesto: sin permiso de escritura en Retenciones, o el impuesto ya no existe.');
  } else {
    // MGG schema
    const patch: Record<string, unknown> = {};
    if (cambios.enteId !== undefined) patch.ente = cambios.enteId || null;
    if (cambios.admitePracticada !== undefined) patch.admite_practicada = cambios.admitePracticada;
    if (cambios.admiteSufrida !== undefined) {
      patch.admite_practicada = cambios.admitePracticada ?? true;
      patch.admite_recibida = cambios.admiteSufrida;
    }
    if (cambios.numera !== undefined) patch.numera = cambios.numera;
    if (cambios.orden !== undefined) patch.orden = cambios.orden;
    if (cambios.activo !== undefined) patch.activo = cambios.activo;

    const { data, error } = await supabase.from(T_IMPUESTOS).update(patch).eq('clave', clave.toLowerCase()).select('clave');
    if (error) throw errorRetencion(error, 'No se pudo guardar el impuesto.', TEXTOS_FICHA);
    if (!data?.length) throw new Error('No se guardó el impuesto: sin permiso de escritura en Retenciones, o el impuesto ya no existe.');
  }
}

/**
 * Da de alta un impuesto con su primera versión. Son dos pasos: si la versión
 * falla, el impuesto queda creado sin versión y el aviso lo dice.
 */
export async function crearImpuesto(f: FichaImpuesto, version: DatosVersion, desde: string, motivo: string): Promise<void> {
  const falta = faltaEnImpuesto(f) ?? faltaEnVersion(version, desde, motivo);
  if (falta) throw new Error(falta);
  const hayVersiones = await tablaDisponible(T_VERSIONES);
  if (hayVersiones) {
    const { data, error } = await supabase.from(T_IMPUESTOS)
      .insert({ clave: f.clave, ...filaFicha(f), motivo_cambio: motivo.trim() }).select('clave');
    if (error) throw errorRetencion(error, 'No se pudo crear el impuesto.', TEXTOS_FICHA);
    if (!data?.length) throw new Error('No se creó el impuesto: sin permiso de escritura en Retenciones.');
    try {
      await nuevaVersion(f.clave, version, desde, motivo);
    } catch (e) {
      throw new Error(`El impuesto quedó creado, pero sin su versión: ${e instanceof Error ? e.message : 'error'}. Agrégala con «Nueva versión desde…».`);
    }
  } else {
    // MGG schema
    const { data, error } = await supabase.from(T_IMPUESTOS).insert({
      clave: f.clave.toLowerCase(),
      motor: 'base_por_pct',
      periodicidad: version.periodicidad,
      numera: f.numera,
      serie_prefijo: f.serieFormato === 'AAAAMM8' ? 'AAAAMM' : '',
      serie_largo: f.serieFormato === 'AAAAMM8' ? 8 : 10,
      vence_dias_mes_siguiente: version.venceDia,
      admite_practicada: f.admitePracticada,
      admite_recibida: f.admiteSufrida,
      ente: f.enteId,
      orden: f.orden,
      vigente_desde: desde,
      activo: f.activo,
    }).select('clave');
    if (error) throw errorRetencion(error, 'No se pudo crear el impuesto.', TEXTOS_FICHA);
    if (!data?.length) throw new Error('No se creó el impuesto: sin permiso de escritura en Retenciones.');
  }
}

/** Versión nueva desde una fecha; la base cierra la anterior el día antes. */
export async function nuevaVersion(clave: string, v: DatosVersion, desde: string, motivo: string): Promise<string> {
  const falta = faltaEnVersion(v, desde, motivo);
  if (falta) throw new Error(falta);
  const hayVersiones = await tablaDisponible(T_VERSIONES);
  if (!hayVersiones) {
    const { error } = await supabase.from(T_IMPUESTOS)
      .update({
        periodicidad: v.periodicidad,
        vence_dias_mes_siguiente: v.venceDia,
        vigente_desde: desde,
      }).eq('clave', clave.toLowerCase());
    if (error) throw errorRetencion(error, 'No se pudo actualizar la configuración del impuesto.');
    return `ver-${clave}`;
  }
  const { data, error } = await supabase.from(T_VERSIONES)
    .insert({ impuesto_clave: clave, desde, ...filaVersion(v), motivo: motivo.trim() }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar la versión.', TEXTOS_VERSION);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error('No se guardó la versión: sin permiso de escritura en Retenciones.');
  return id;
}

/** Corrige una versión (sin abrir otra): lo que se cargó mal. Su «desde» no cambia. */
export async function corregirVersion(id: string, v: DatosVersion, motivo: string): Promise<void> {
  const falta = faltaEnVersion(v, '2000-01-01', motivo);
  if (falta) throw new Error(falta);
  const hayVersiones = await tablaDisponible(T_VERSIONES);
  if (!hayVersiones) {
    const clave = id.replace(/^ver-/, '');
    const { error } = await supabase.from(T_IMPUESTOS)
      .update({
        periodicidad: v.periodicidad,
        vence_dias_mes_siguiente: v.venceDia,
      }).eq('clave', clave.toLowerCase());
    if (error) throw errorRetencion(error, 'No se pudo corregir la versión.');
    return;
  }
  const { data, error } = await supabase.from(T_VERSIONES)
    .update({ ...filaVersion(v), motivo: motivo.trim() }).eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo corregir la versión.', TEXTOS_VERSION);
  if (!data?.length) throw new Error('No se corrigió la versión: sin permiso de escritura en Retenciones, o la versión ya no existe.');
}
