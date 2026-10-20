/* ============================================================
   MGG · Retenciones v8 · Los períodos de declaración (datos)

   Contra los objetos del paquete 07 de la base de Retenciones (v2.1, E-15):
   · la vista `retencion_periodos_v` (estado, días para vencer, retenciones
     y lo retenido del período);
   · `retencion_periodo_declarar` y `retencion_periodo_reabrir` (con motivo;
     el permiso lo decide la base);
   · el paso inicial de cada impuesto: el «desde» del interruptor
     `retenciones.numeracion.<impuesto>` (la fecha de corte con el otro
     sistema, la que usa `retencion_periodos_generar`).
   Si la vista no existe (la base de Retenciones aún sin aplicar),
   `listPeriodos` devuelve null: la pestaña Períodos no se muestra en
   producción y en local sale vacía y marcada.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';

export type EstadoPeriodo = 'abierto' | 'por_declarar' | 'vencido' | 'declarado';

export interface PeriodoRetencion {
  id: string;
  tipo: string;
  /** AAAAMM */
  periodo: string;
  /** 0 = mensual; 1 y 2 = quincenas. */
  tramo: number;
  desde: string;
  hasta: string;
  vence: string | null;
  estado: EstadoPeriodo;
  diasParaVencer: number | null;
  /** 'otro_sistema' = anterior al paso inicial: se declara en el otro sistema. */
  declara: 'mgg' | 'otro_sistema';
  declaradoEn: string | null;
  declaradoPor: string | null;
  declaradoRegistradoEn: string | null;
  planilla: string | null;
  numeroDeclaracion: string | null;
  montoEnterado: number | null;
  observacion: string | null;
  reabiertoPor: string | null;
  reabiertoEn: string | null;
  reabiertoMotivo: string | null;
  retencionesVigentes: number;
  retenidoBs: number;
  retenidoUsd: number;
}

export interface Declaracion {
  fecha: string;
  monto: number;
  planilla: string;
  numero: string;
  observacion: string;
}

const txt = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

function aPeriodo(r: Record<string, unknown>): PeriodoRetencion {
  return {
    id: String(r.id), tipo: String(r.tipo), periodo: String(r.periodo), tramo: n(r.tramo),
    desde: String(r.desde), hasta: String(r.hasta), vence: txt(r.vence), estado: r.estado as EstadoPeriodo,
    diasParaVencer: r.dias_para_vencer == null ? null : n(r.dias_para_vencer),
    declara: r.declara === 'otro_sistema' ? 'otro_sistema' : 'mgg',
    declaradoEn: txt(r.declarado_en), declaradoPor: txt(r.declarado_por), declaradoRegistradoEn: txt(r.declarado_registrado_en),
    planilla: txt(r.planilla), numeroDeclaracion: txt(r.numero_declaracion),
    montoEnterado: r.monto_enterado == null ? null : n(r.monto_enterado), observacion: txt(r.observacion),
    reabiertoPor: txt(r.reabierto_por), reabiertoEn: txt(r.reabierto_en), reabiertoMotivo: txt(r.reabierto_motivo),
    retencionesVigentes: n(r.retenciones_vigentes), retenidoBs: n(r.retenido_bs), retenidoUsd: n(r.retenido_usd),
  };
}

/** Los períodos; null si la base de Retenciones todavía no los tiene. */
export async function listPeriodos(): Promise<PeriodoRetencion[] | null> {
  try {
    const { data, error } = await supabase.from('retencion_periodos_v').select('*').order('desde', { ascending: false });
    if (error) return null;
    return (data ?? []).map((r) => aPeriodo(r as Record<string, unknown>));
  } catch {
    return null;
  }
}

/** El paso inicial de cada impuesto: la fecha de corte, o null si falta. */
export async function listPasoInicial(impuestos: readonly string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = Object.fromEntries(impuestos.map((k) => [k, null]));
  try {
    const { data, error } = await supabase.from('retencion_interruptores').select('clave, valor').in('clave', impuestos.map((k) => `retenciones.numeracion.${k}`));
    if (error) return out;
    for (const r of (data ?? []) as { clave: string; valor: unknown }[]) {
      const desde = (r.valor as { desde?: unknown } | null)?.desde;
      if (typeof desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(desde.trim())) out[r.clave.replace('retenciones.numeracion.', '')] = desde.trim();
    }
  } catch { /* sin la tabla, ningún impuesto tiene paso inicial */ }
  return out;
}

/** Marca el período como declarado; devuelve cuántas retenciones pasaron a «Declarada». */
export async function declararPeriodo(id: string, d: Declaracion): Promise<number> {
  const { data, error } = await supabase.rpc('retencion_periodo_declarar', {
    p_id: id, p_fecha: d.fecha, p_monto: d.monto, p_planilla: d.planilla, p_numero: d.numero || null, p_observacion: d.observacion || null,
  });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

/** Reabre un período declarado (motivo obligatorio); devuelve cuántas retenciones volvieron a «Registrada». */
export async function reabrirPeriodo(id: string, motivo: string): Promise<number> {
  const { data, error } = await supabase.rpc('retencion_periodo_reabrir', { p_id: id, p_motivo: motivo });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

/** El umbral «por vencer» de las declaraciones (`retenciones.avisos.umbrales` → declaraciones[0]); 7 si no está. */
export async function umbralDeclaraciones(): Promise<number> {
  try {
    const { data, error } = await supabase.from('retencion_interruptores').select('valor').eq('clave', 'retenciones.avisos.umbrales').maybeSingle();
    const d = (data as { valor?: { declaraciones?: unknown } } | null)?.valor?.declaraciones;
    const n = Array.isArray(d) ? Number(d[0]) : NaN;
    return !error && Number.isInteger(n) && n >= 0 ? n : 7;
  } catch {
    return 7;
  }
}

export interface PasoInicial {
  inicio: string;
  /** El ÚLTIMO N° de comprobante del otro sistema en la serie (la base guarda el siguiente). */
  ultimoNumero: number | null;
  anterioresOtroSistema: boolean;
  nombreOtroSistema: string;
}

/** El paso inicial de un impuesto (retencion_paso_inicial, en espera: docs/sql/2026-10-20-v8-pantallas/v8p-01). */
export async function guardarPasoInicial(tipo: string, p: PasoInicial): Promise<void> {
  const { error } = await supabase.rpc('retencion_paso_inicial', {
    p_tipo: tipo, p_inicio: p.inicio, p_ultimo_numero: p.ultimoNumero, p_anteriores_otro_sistema: p.anterioresOtroSistema,
    p_nombre_otro_sistema: p.nombreOtroSistema || null,
  });
  if (error) throw new Error(error.message);
}
