/* ============================================================
   MGG · Retenciones · Acceso a datos del módulo fiscal

   Tres cosas: la configuración del agente de retención, el catálogo de
   conceptos y las retenciones practicadas. El cálculo NO vive acá (está en
   `retencionesCalculo.ts`, sin base de datos, para poder probarlo).

   El correlativo del comprobante de IVA lo da la BASE, no el front: dos
   personas emitiendo a la vez no pueden sacar el mismo número.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import {
  CONFIG_RETENCION_DEFECTO,
  type ConceptoRetencion, type ConfigRetencion, type DireccionRetencion,
  type EstadoRetencion, type SujetoRetenido, type TipoImpuesto,
} from './retencionesCalculo';

const T_CONFIG = 'retencion_config';
const T_CONCEPTOS = 'retencion_conceptos';
const T_RETENCIONES = 'retenciones';
const BUCKET = 'compras-oc';

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ───────────────────── Configuración ───────────────────── */

export async function getConfigRetencion(): Promise<ConfigRetencion> {
  const { data, error } = await supabase.from(T_CONFIG).select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  if (!data) return CONFIG_RETENCION_DEFECTO;
  return {
    rif: data.rif ?? null,
    razonSocial: data.razon_social ?? null,
    direccionFiscal: data.direccion_fiscal ?? null,
    municipio: data.municipio ?? null,
    estado: data.estado ?? null,
    esContribuyenteEspecial: !!data.es_contribuyente_especial,
    pctIvaGeneral: n(data.pct_iva_general) || 75,
    pctIvaEspecial: n(data.pct_iva_especial) || 100,
    valorUt: n(data.valor_ut),
    pctIgtf: n(data.pct_igtf),
  };
}

export async function guardarConfigRetencion(c: ConfigRetencion, actor: string): Promise<void> {
  const { error } = await supabase.from(T_CONFIG).upsert({
    id: true,
    rif: c.rif, razon_social: c.razonSocial, direccion_fiscal: c.direccionFiscal,
    municipio: c.municipio, estado: c.estado,
    es_contribuyente_especial: c.esContribuyenteEspecial,
    pct_iva_general: c.pctIvaGeneral, pct_iva_especial: c.pctIvaEspecial,
    valor_ut: c.valorUt, pct_igtf: c.pctIgtf,
    actualizado_en: new Date().toISOString(), actualizado_por: actor,
  }, { onConflict: 'id' });
  if (error) throw error;
}

/* ───────────────────── Catálogo ───────────────────── */

function aConcepto(r: Record<string, unknown>): ConceptoRetencion {
  return {
    id: String(r.id), tipo: r.tipo as ConceptoRetencion['tipo'],
    codigo: (r.codigo as string) ?? null, nombre: String(r.nombre),
    sujeto: (r.sujeto as SujetoRetenido) ?? 'todos',
    porcentaje: n(r.porcentaje), basePct: n(r.base_pct) || 100,
    aplicaSustraendo: !!r.aplica_sustraendo, baseMinimaUt: n(r.base_minima_ut),
    fundamento: (r.fundamento as string) ?? null,
    activo: !!r.activo, orden: n(r.orden),
  };
}

export async function listConceptos(soloActivos = false): Promise<ConceptoRetencion[]> {
  let q = supabase.from(T_CONCEPTOS).select('*').order('orden', { ascending: true });
  if (soloActivos) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => aConcepto(r as Record<string, unknown>));
}

export async function guardarConcepto(c: Partial<ConceptoRetencion> & { nombre: string; tipo: ConceptoRetencion['tipo'] }): Promise<void> {
  const fila = {
    tipo: c.tipo, codigo: c.codigo ?? null, nombre: c.nombre, sujeto: c.sujeto ?? 'todos',
    porcentaje: n(c.porcentaje), base_pct: n(c.basePct) || 100,
    aplica_sustraendo: !!c.aplicaSustraendo, base_minima_ut: n(c.baseMinimaUt),
    fundamento: c.fundamento ?? null, activo: c.activo !== false, orden: n(c.orden),
  };
  const { error } = c.id
    ? await supabase.from(T_CONCEPTOS).update(fila).eq('id', c.id)
    : await supabase.from(T_CONCEPTOS).insert(fila);
  if (error) throw error;
}

export async function activarConcepto(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(T_CONCEPTOS).update({ activo }).eq('id', id);
  if (error) throw error;
}

/* ───────────────────── El libro de retenciones ─────────────────────

   Una retención tiene DIRECCIÓN, y eso cambia lo que significa:
   · recibida   — nos la practicaron: anticipo de impuesto a favor.
   · practicada — la practicamos: plata de un tercero que hay que enterar.

   La contraparte puede ser un cliente (el que nos retiene) o un proveedor
   (al que le retenemos), por eso no se llama «proveedor».                   */

export interface RetencionPracticada {
  id: string;
  tipo: TipoImpuesto;
  direccion: DireccionRetencion;
  estado: EstadoRetencion;
  docKind: 'oc' | 'compra_directa' | 'servicio_directo' | 'venta' | 'manual';
  docId: string | null;
  docCodigo: string | null;
  contraparteId: string | null;
  contraparteRif: string | null;
  contraparteNombre: string | null;
  contraparteSujeto: SujetoRetenido | null;
  facturaNumero: string | null;
  facturaControl: string | null;
  facturaFecha: string | null;
  periodo: string;
  quincena: 1 | 2 | null;
  numeroComprobante: string | null;
  conceptoId: string | null;
  conceptoNombre: string | null;
  moneda: string;
  tasa: number | null;
  baseImponible: number;
  alicuota: number;
  impuesto: number;
  porcentaje: number;
  sustraendo: number;
  montoRetenido: number;
  comprobantePath: string | null;
  comprobanteNombre: string | null;
  observacion: string | null;
  anulada: boolean;
  anuladaMotivo: string | null;
  declaradaEn: string | null;
  actorName: string | null;
  createdAt: string;
}

function aRetencion(r: Record<string, unknown>): RetencionPracticada {
  return {
    id: String(r.id), tipo: r.tipo as TipoImpuesto,
    direccion: (r.direccion as DireccionRetencion) ?? 'recibida',
    estado: (r.estado as EstadoRetencion) ?? 'registrada',
    docKind: (r.doc_kind as RetencionPracticada['docKind']) ?? 'manual',
    docId: (r.doc_id as string) ?? null, docCodigo: (r.doc_codigo as string) ?? null,
    contraparteId: (r.contraparte_id as string) ?? null,
    contraparteRif: (r.contraparte_rif as string) ?? null,
    contraparteNombre: (r.contraparte_nombre as string) ?? null,
    contraparteSujeto: (r.contraparte_sujeto as SujetoRetenido) ?? null,
    facturaNumero: (r.factura_numero as string) ?? null,
    facturaControl: (r.factura_control as string) ?? null,
    facturaFecha: (r.factura_fecha as string) ?? null,
    periodo: String(r.periodo ?? ''), quincena: (r.quincena as 1 | 2) ?? null,
    numeroComprobante: (r.numero_comprobante as string) ?? null,
    conceptoId: (r.concepto_id as string) ?? null,
    conceptoNombre: (r.concepto_nombre as string) ?? null,
    moneda: String(r.moneda ?? 'Bs'), tasa: r.tasa == null ? null : n(r.tasa),
    baseImponible: n(r.base_imponible), alicuota: n(r.alicuota), impuesto: n(r.impuesto),
    porcentaje: n(r.porcentaje), sustraendo: n(r.sustraendo), montoRetenido: n(r.monto_retenido),
    comprobantePath: (r.comprobante_path as string) ?? null,
    comprobanteNombre: (r.comprobante_nombre as string) ?? null,
    observacion: (r.observacion as string) ?? null,
    anulada: !!r.anulada, anuladaMotivo: (r.anulada_motivo as string) ?? null,
    declaradaEn: (r.declarada_en as string) ?? null,
    actorName: (r.actor_name as string) ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

export interface FiltroRetenciones {
  direccion?: DireccionRetencion;
  tipo?: TipoImpuesto;
  estado?: EstadoRetencion;
  periodo?: string;
  /** Rango por fecha de la factura (AAAA-MM-DD). */
  desde?: string;
  hasta?: string;
  docId?: string;
  incluirAnuladas?: boolean;
}

/**
 * El libro. Trae TODAS las filas del rango: Supabase corta en 1.000 sin avisar,
 * así que se pagina (un año de retenciones pasa ese tope sin esfuerzo).
 */
export async function listRetenciones(f: FiltroRetenciones = {}): Promise<RetencionPracticada[]> {
  const filas = await todasLasFilas<Record<string, unknown>>((desde, hasta) => {
    let q = supabase.from(T_RETENCIONES).select('*')
      .order('factura_fecha', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })   // desempate estable: sin esto las páginas se solapan
      .range(desde, hasta);
    if (f.direccion) q = q.eq('direccion', f.direccion);
    if (f.tipo) q = q.eq('tipo', f.tipo);
    if (f.estado) q = q.eq('estado', f.estado);
    if (f.periodo) q = q.eq('periodo', f.periodo);
    if (f.desde) q = q.gte('factura_fecha', f.desde);
    if (f.hasta) q = q.lte('factura_fecha', f.hasta);
    if (f.docId) q = q.eq('doc_id', f.docId);
    if (!f.incluirAnuladas) q = q.eq('anulada', false);
    return q;
  });
  return filas.map((r) => aRetencion(r));
}

/** Los períodos que tienen retenciones, del más nuevo al más viejo. */
export async function listPeriodos(): Promise<string[]> {
  const { data, error } = await supabase.from(T_RETENCIONES).select('periodo').order('periodo', { ascending: false });
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => String((r as { periodo: string }).periodo)))];
}

export interface NuevaRetencion {
  tipo: TipoImpuesto;
  direccion: DireccionRetencion;
  docKind: RetencionPracticada['docKind'];
  docId?: string | null;
  docCodigo?: string | null;
  contraparteId?: string | null;
  contraparteRif?: string | null;
  contraparteNombre?: string | null;
  contraparteSujeto?: SujetoRetenido | null;
  facturaNumero?: string | null;
  facturaControl?: string | null;
  facturaFecha?: string | null;
  periodo: string;
  quincena?: 1 | 2 | null;
  /** Solo para las recibidas: el número que trae el comprobante del cliente. */
  numeroComprobante?: string | null;
  conceptoId?: string | null;
  conceptoNombre?: string | null;
  moneda: string;
  tasa?: number | null;
  baseImponible: number;
  alicuota?: number;
  impuesto?: number;
  porcentaje: number;
  sustraendo?: number;
  montoRetenido: number;
  observacion?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Registra una retención en el libro.
 *
 * El correlativo AAAAMM + 8 dígitos lo asigna la BASE, y SOLO cuando la
 * practicamos nosotros: dos personas emitiendo a la vez no pueden sacar el
 * mismo número. El de una retención que nos practicaron lo puso otra empresa:
 * se copia tal cual del comprobante que entregaron.
 */
export async function registrarRetencion(input: NuevaRetencion): Promise<RetencionPracticada> {
  if (input.montoRetenido <= 0) throw new Error('La retención no tiene monto: revisá la base y el porcentaje.');
  let numero: string | null = input.numeroComprobante?.trim() || null;
  if (input.direccion === 'practicada' && input.tipo === 'iva') {
    const { data, error } = await supabase.rpc('siguiente_comprobante_retencion', { p_periodo: input.periodo });
    if (error) throw error;
    numero = String(data);
  }
  const { data, error } = await supabase.from(T_RETENCIONES).insert({
    tipo: input.tipo, direccion: input.direccion, estado: 'registrada',
    doc_kind: input.docKind, doc_id: input.docId ?? null, doc_codigo: input.docCodigo ?? null,
    contraparte_id: input.contraparteId ?? null, contraparte_rif: input.contraparteRif ?? null,
    contraparte_nombre: input.contraparteNombre ?? null, contraparte_sujeto: input.contraparteSujeto ?? null,
    factura_numero: input.facturaNumero ?? null, factura_control: input.facturaControl ?? null,
    factura_fecha: input.facturaFecha ?? null,
    periodo: input.periodo, quincena: input.quincena ?? null, numero_comprobante: numero,
    concepto_id: input.conceptoId ?? null, concepto_nombre: input.conceptoNombre ?? null,
    moneda: input.moneda, tasa: input.tasa ?? null,
    base_imponible: input.baseImponible, alicuota: input.alicuota ?? 0, impuesto: input.impuesto ?? 0,
    porcentaje: input.porcentaje, sustraendo: input.sustraendo ?? 0, monto_retenido: input.montoRetenido,
    observacion: input.observacion ?? null,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return aRetencion(data as Record<string, unknown>);
}

/**
 * Anula una retención. NO se borra: un comprobante emitido y entregado queda en
 * el libro con su motivo, porque el correlativo no se reusa.
 */
export async function anularRetencion(id: string, motivo: string): Promise<void> {
  const m = motivo.trim();
  if (!m) throw new Error('Indicá por qué se anula la retención.');
  const { error } = await supabase.from(T_RETENCIONES)
    .update({ anulada: true, anulada_motivo: m, anulada_en: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Marca como declarada (o la devuelve a registrada) una retención del libro. */
export async function marcarDeclarada(id: string, declarada: boolean, actor: string): Promise<void> {
  const { error } = await supabase.from(T_RETENCIONES).update({
    estado: declarada ? 'declarada' : 'registrada',
    declarada_en: declarada ? new Date().toISOString() : null,
    declarada_por: declarada ? actor : null,
  }).eq('id', id);
  if (error) throw error;
}

/** Adjunta el comprobante: el que firma el proveedor, o el que nos entregó el cliente. */
export async function adjuntarComprobante(id: string, file: File): Promise<void> {
  if (file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
    throw new Error('El comprobante debe ser PDF o imagen.');
  }
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `retenciones/${id}/${safe}`;
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' });
  if (upErr) throw upErr;
  const { error } = await supabase.from(T_RETENCIONES)
    .update({ comprobante_path: path, comprobante_nombre: file.name }).eq('id', id);
  if (error) throw error;
}
