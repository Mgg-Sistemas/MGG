/* ============================================================
   Golden Touch · Libro fiscal · Acceso a datos

   Tres cosas: la configuración del agente de retención, el catálogo de
   conceptos y el libro. El cálculo NO vive aquí (está en
   `retencionesCalculo.ts`, sin base de datos, para poder probarlo).

   El módulo trabaja con su propio modelo (dirección, impuesto en minúsculas,
   documento de origen…) y esta capa lo traduce a las tablas que GT ya tiene:
   · `retenciones`: `rol` sufrida/practicada, `tipo` en MAYÚSCULAS (el CHECK y
     el trigger del régimen solo aceptan MAYÚSCULAS), la anulación es un
     estado, y el documento de origen son tres columnas (OC, compra directa o
     servicio directo).
   · la configuración es el JSON `config['retenciones.parametros']`.
   · el catálogo del ISLR es una fila por código con una columna por sujeto.

   El número de una practicada lo pone la BASE al insertar (V2): el IVA,
   AAAAMM + 8 dígitos; ISLR, ISAE y estadal, 10 dígitos continuos. El front no
   lo pide ni lo arma: lo lee de la fila devuelta. Solo manda un número cuando
   se escribe a mano («dado»), y la base lo valida con el formato de su serie.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { EMPRESA_DOMICILIO, EMPRESA_EMAIL, EMPRESA_NOMBRE, EMPRESA_RIF } from '@/shared/lib/empresa';
import { normalizarRif, rifValido } from '@/shared/lib/rif';
import type { EstadoOrden } from '@/shared/lib/types';
import {
  CONFIG_RETENCION_DEFECTO, enBolivares, formatoComprobante, formatoSerie, labelImpuesto, motivoNoPuedePracticar, numeroConFormato, textoDeFormato,
  type ConceptoRetencion, type ConfigRetencion, type DireccionRetencion,
  type EstadoRetencion, type SujetoRetenido, type TipoImpuesto,
} from './retencionesCalculo';
export { formatoComprobante, formatoSerie };
export type { ConfigRetencion };
import { mensajeDobleRegistro, normalizarFactura, retencionYaRegistrada } from './dobleRegistro';
import { faltaEnLaCarga } from './validarCarga';
import { errorRetencion } from './erroresRetencion';
import { configDeFecha } from './parametros.repository';
import { serieDeImpuesto } from './impuestos.repository';
import { tablaDisponible } from './disponibilidad';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';

const T_RETENCIONES = 'retenciones';
const T_CONCEPTOS = 'retenciones_conceptos';
const CLAVE_CONFIG = 'retenciones.parametros';
const BUCKET = 'compras-oc';

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const texto = (v: unknown) => (v == null || v === '' ? null : String(v));

/** Cuando un UPDATE no toca ninguna fila: la base no dio permiso, o la fila no existe. */
export const SIN_PERMISO = 'No se guardó el cambio: el usuario no tiene permiso de escritura en Retenciones, o la retención ya no existe.';

/* ───────────────────── Traducciones de valores ───────────────────── */

type TipoGt = 'IVA' | 'ISLR' | 'MUNICIPAL' | 'ESTADAL' | 'IGTF';
type SujetoGt = 'PJD' | 'PJND' | 'PNR' | 'PNNR';

export function tipoAGt(t: TipoImpuesto): TipoGt {
  return t === 'regional' ? 'ESTADAL' : (t.toUpperCase() as TipoGt);
}

export function tipoDeGt(t: unknown): TipoImpuesto {
  const s = String(t ?? '').toUpperCase();
  return s === 'ESTADAL' ? 'regional' : (s.toLowerCase() as TipoImpuesto);
}

export const rolAGt = (d: DireccionRetencion) => (d === 'recibida' ? 'sufrida' : 'practicada');
export const direccionDeGt = (rol: unknown): DireccionRetencion => (rol === 'practicada' ? 'practicada' : 'recibida');

const SUJETO_A_GT: Record<Exclude<SujetoRetenido, 'todos'>, SujetoGt> = {
  pj_domiciliada: 'PJD', pj_no_domiciliada: 'PJND', pn_residente: 'PNR', pn_no_residente: 'PNNR',
};
const SUJETO_DE_GT: Record<SujetoGt, SujetoRetenido> = {
  PJD: 'pj_domiciliada', PJND: 'pj_no_domiciliada', PNR: 'pn_residente', PNNR: 'pn_no_residente',
};

export function sujetoAGt(s: SujetoRetenido | null | undefined): SujetoGt | null {
  return s && s !== 'todos' ? SUJETO_A_GT[s] : null;
}

export function sujetoDeGt(s: unknown): SujetoRetenido | null {
  return SUJETO_DE_GT[s as SujetoGt] ?? null;
}

/* ───────────────────── Configuración ───────────────────── */

export type JsonParametros = Record<string, unknown>;

/** El JSON de GT → la configuración del módulo. Sin datos, los de la empresa (empresa.ts). */
export function configDeJson(v: JsonParametros | null | undefined): ConfigRetencion {
  const j = v ?? {};
  const bool = (k: string, def: boolean) => (typeof j[k] === 'boolean' ? (j[k] as boolean) : def);
  return {
    rif: texto(j.empresa_rif) ?? texto(j.agente_rif) ?? EMPRESA_RIF,
    razonSocial: texto(j.empresa_nombre) ?? texto(j.agente_nombre) ?? EMPRESA_NOMBRE,
    direccionFiscal: texto(j.agente_direccion) ?? EMPRESA_DOMICILIO,
    municipio: texto(j.municipio),
    estado: null,
    email: texto(j.empresa_email) ?? texto(j.agente_email) ?? EMPRESA_EMAIL,
    esAgenteRetencionIva: bool('agente_retencion_iva', CONFIG_RETENCION_DEFECTO.esAgenteRetencionIva),
    esContribuyenteEspecial: bool('contribuyente_especial', CONFIG_RETENCION_DEFECTO.esContribuyenteEspecial),
    retieneIslr: bool('retiene_islr', true),
    retieneMunicipal: bool('retiene_municipal', false),
    estadosKanbanRetencion: Array.isArray(j.estados_kanban_retencion) ? (j.estados_kanban_retencion as EstadoOrden[]) : CONFIG_RETENCION_DEFECTO.estadosKanbanRetencion,
    pctIvaGeneral: n(j.iva_retencion) || 75,
    pctIvaEspecial: n(j.iva_retencion_especial) || 100,
    valorUt: n(j.unidad_tributaria),
    pctIgtf: j.igtf_alicuota == null ? CONFIG_RETENCION_DEFECTO.pctIgtf : n(j.igtf_alicuota),
    ivaAlicuota: n(j.iva_alicuota) || CONFIG_RETENCION_DEFECTO.ivaAlicuota,
    licenciaMunicipal: texto(j.licencia_municipal) ?? texto(j.licencia_numero) ?? texto(j.rim) ?? null,
    imprimirOriginalYCopia: bool('imprimir_original_copia', true),
    incluirLogo: bool('comprobante_logo', true),
    incluirFirma: bool('comprobante_firma', true),
    incluirSello: bool('comprobante_sello', true),
    incluirQr: bool('comprobante_qr', true),
    buzonActivo: bool('buzon_activo', true),
    multiempresaActivo: bool('multiempresa_activo', true),
  };
}

/**
 * La configuración del módulo mezclada sobre el JSON que ya hay. Se conservan
 * las claves que este módulo no maneja (alícuotas de IVA, municipal y estadal,
 * municipio…): escribir solo lo propio las borraría.
 */
export function jsonDeConfig(c: ConfigRetencion, previo: JsonParametros | null | undefined): JsonParametros {
  return {
    ...(previo ?? {}),
    empresa_rif: c.rif ?? '', empresa_nombre: c.razonSocial ?? '', agente_direccion: c.direccionFiscal ?? '',
    municipio: c.municipio ?? '',
    empresa_email: c.email ?? '',
    licencia_municipal: c.licenciaMunicipal ?? '',
    agente_retencion_iva: c.esAgenteRetencionIva,
    contribuyente_especial: c.esContribuyenteEspecial,
    retiene_islr: c.retieneIslr !== false,
    retiene_municipal: c.retieneMunicipal === true,
    estados_kanban_retencion: c.estadosKanbanRetencion ?? CONFIG_RETENCION_DEFECTO.estadosKanbanRetencion,
    iva_retencion: c.pctIvaGeneral,
    iva_retencion_especial: c.pctIvaEspecial,
    unidad_tributaria: c.valorUt,
    igtf_alicuota: c.pctIgtf,
    imprimir_original_copia: c.imprimirOriginalYCopia !== false,
    comprobante_logo: c.incluirLogo !== false,
    comprobante_firma: c.incluirFirma !== false,
    comprobante_sello: c.incluirSello !== false,
    comprobante_qr: c.incluirQr !== false,
    buzon_activo: c.buzonActivo !== false,
    multiempresa_activo: c.multiempresaActivo !== false,
  };
}

async function leerJsonParametros(): Promise<JsonParametros | null> {
  const { data, error } = await supabase.from('config').select('value').eq('key', CLAVE_CONFIG).maybeSingle();
  if (error) throw errorRetencion(error, 'No se pudieron leer los parámetros fiscales.');
  return (data?.value as JsonParametros | undefined) ?? null;
}

export async function getConfigRetencion(): Promise<ConfigRetencion> {
  const cfg = configDeJson(await leerJsonParametros());
  try {
    const { data: conds } = await supabase.from('retencion_agente_condiciones')
      .select('condicion, valor, desde, hasta')
      .is('empresa_id', null)
      .eq('condicion', 'contribuyente_especial');
    if (conds && conds.length > 0) {
      const hoy = hoyVenezuela().slice(0, 10);
      const vigente = conds
        .filter((c) => String(c.desde) <= hoy && (!c.hasta || String(c.hasta) >= hoy))
        .sort((a, b) => String(b.desde).localeCompare(String(a.desde)))[0];
      cfg.esContribuyenteEspecial = vigente ? vigente.valor === true : false;
      cfg.esAgenteRetencionIva = cfg.esContribuyenteEspecial;
    } else {
      // Golden Touch es Contribuyente Ordinario ante el SENIAT: no retiene IVA salvo designación formal expresa
      cfg.esContribuyenteEspecial = false;
      cfg.esAgenteRetencionIva = false;
    }
  } catch {
    /* fallback seguro */
  }
  return cfg;
}

/** La Providencia SNAT/2025/000054 (que derogó a la SNAT/2015/0049) solo admite 75% y 100%: los dos porcentajes son dato, pero no cualquier dato. */
export const PORCENTAJES_IVA = [75, 100] as const;

export function errorPorcentajesIva(c: Pick<ConfigRetencion, 'pctIvaGeneral' | 'pctIvaEspecial'>): string | null {
  const vale = (p: number) => (PORCENTAJES_IVA as readonly number[]).includes(n(p));
  return vale(c.pctIvaGeneral) && vale(c.pctIvaEspecial)
    ? null
    : 'La retención de IVA solo puede ser 75% o 100% (Providencia SNAT/2025/000054).';
}

/** Las alícuotas del ISAE y del timbre estadal: datos de Parámetros, no del catálogo. */
export interface AlicuotasLocales { municipal: number; estadal: number }

export function alicuotasLocalesDeJson(j: JsonParametros | null | undefined): AlicuotasLocales {
  return { municipal: n(j?.municipal_alicuota), estadal: n(j?.estadal_alicuota) };
}

export async function getAlicuotasLocales(): Promise<AlicuotasLocales> {
  return alicuotasLocalesDeJson(await leerJsonParametros());
}

/** Solo el administrador escribe la configuración (la base lo exige). */
/** Claves del JSON que, con R3, copia la base desde los parámetros con vigencia. */
const CLAVES_R3 = ['unidad_tributaria', 'iva_alicuota', 'iva_retencion', 'iva_retencion_especial', 'igtf_alicuota', 'municipal_alicuota', 'estadal_alicuota'] as const;

export async function guardarConfigRetencion(c: ConfigRetencion, locales?: AlicuotasLocales,
  opciones?: { conservarRegimen?: boolean; conservarParametros?: boolean }): Promise<void> {
  const falla = errorPorcentajesIva(c);
  if (falla) throw new Error(falla);
  const previo = await leerJsonParametros();
  const parametros = opciones?.conservarParametros && previo
    ? Object.fromEntries(CLAVES_R3.filter((k) => k in previo).map((k) => [k, previo[k]]))
    : {};
  const value = {
    ...jsonDeConfig(c, previo),
    ...(locales && !opciones?.conservarParametros ? { municipal_alicuota: n(locales.municipal), estadal_alicuota: n(locales.estadal) } : {}),
    agente_retencion_iva: c.esAgenteRetencionIva === true,
    contribuyente_especial: c.esContribuyenteEspecial === true,
    retiene_municipal: c.retieneMunicipal === true,
    retiene_islr: c.retieneIslr !== false,
    ...parametros,
  };
  const { data, error } = await supabase.from('config')
    .upsert({ key: CLAVE_CONFIG, value }, { onConflict: 'key' })
    .select('key');
  if (error) throw errorRetencion(error, 'No se pudieron guardar los parámetros fiscales.');
  if (!data?.length) throw new Error('Los parámetros fiscales aún no se pueden guardar con este permiso: falta aplicar un cambio pendiente en la base.');
}

/* ───────────────── Tipos de licencia (en el JSON hasta R3; con R3, su tabla) ───────────────── */

const T_LICENCIA_TIPOS = 'retencion_licencia_tipos';
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TipoLicencia { id: string; nombre: string; activo: boolean }

/** Los tipos guardados; los que no tienen forma válida se descartan. */
export function tiposLicenciaDeJson(j: JsonParametros | null | undefined): TipoLicencia[] {
  const xs = Array.isArray(j?.licencia_tipos) ? (j?.licencia_tipos as unknown[]) : [];
  return xs.flatMap((x) => {
    const t = x as Partial<TipoLicencia>;
    return typeof t?.id === 'string' && typeof t?.nombre === 'string' && t.nombre.trim()
      ? [{ id: t.id, nombre: t.nombre.trim(), activo: t.activo !== false }]
      : [];
  });
}

export async function listTiposLicencia(): Promise<TipoLicencia[]> {
  if (await tablaDisponible(T_LICENCIA_TIPOS)) {
    const { data, error } = await supabase.from(T_LICENCIA_TIPOS).select('id, nombre, activo').order('orden').order('nombre');
    if (error) throw errorRetencion(error, 'No se pudieron leer los tipos de licencia.');
    return ((data ?? []) as { id: string; nombre: string; activo: boolean }[]).map((t) => ({ id: t.id, nombre: t.nombre, activo: t.activo !== false }));
  }
  return tiposLicenciaDeJson(await leerJsonParametros());
}

/**
 * Con R3: cada tipo en su fila. Los que ya existen se actualizan por id; los
 * nuevos (o con id de antes de R3) se insertan. Ninguno se borra: se desactiva.
 */
async function guardarTiposLicenciaR3(tipos: TipoLicencia[]): Promise<void> {
  const filas = tipos.map((t, i) => ({ ...(ES_UUID.test(t.id) ? { id: t.id } : {}), nombre: t.nombre.trim(), activo: t.activo, orden: i }));
  const existentes = filas.filter((f) => 'id' in f);
  const nuevas = filas.filter((f) => !('id' in f));
  const textos = { unico: 'Ese tipo de licencia ya existe.' };
  if (existentes.length) {
    const { data, error } = await supabase.from(T_LICENCIA_TIPOS).upsert(existentes, { onConflict: 'id' }).select('id');
    if (error) throw errorRetencion(error, 'No se guardaron los tipos de licencia.', textos);
    if ((data?.length ?? 0) < existentes.length) throw new Error('No se guardaron los tipos de licencia: sin permiso de escritura en Retenciones.');
  }
  if (nuevas.length) {
    const { data, error } = await supabase.from(T_LICENCIA_TIPOS).insert(nuevas).select('id');
    if (error) throw errorRetencion(error, 'No se guardaron los tipos de licencia nuevos.', textos);
    if ((data?.length ?? 0) < nuevas.length) throw new Error('No se guardaron los tipos de licencia nuevos: sin permiso de escritura en Retenciones.');
  }
}

/** Guarda la lista entera sobre el JSON que ya hay. Ninguno se borra: se desactiva. */
export async function guardarTiposLicencia(tipos: TipoLicencia[]): Promise<void> {
  const nombres = tipos.map((t) => t.nombre.trim().toLocaleLowerCase('es'));
  if (nombres.some((x) => !x)) throw new Error('Un tipo de licencia no puede quedar sin nombre.');
  if (new Set(nombres).size !== nombres.length) throw new Error('Ese tipo de licencia ya existe.');
  if (await tablaDisponible(T_LICENCIA_TIPOS)) {
    await guardarTiposLicenciaR3(tipos);
    return;
  }
  const previo = await leerJsonParametros();
  const value = { ...(previo ?? {}), licencia_tipos: tipos.map((t) => ({ id: t.id, nombre: t.nombre.trim(), activo: t.activo })) };
  const { data, error } = await supabase.from('config')
    .upsert({ key: CLAVE_CONFIG, value }, { onConflict: 'key' })
    .select('key');
  if (error) throw error;
  if (!data?.length) throw new Error('No se guardó: tu cuenta no tiene permiso para cambiar los parámetros de retenciones.');
}

/* ───────────────────── Catálogo ───────────────────── */

const COLUMNA_SUJETO: Record<SujetoGt, 'pjd' | 'pjnd' | 'pnr' | 'pnnr'> = {
  PJD: 'pjd', PJND: 'pjnd', PNR: 'pnr', PNNR: 'pnnr',
};

/**
 * Una fila del catálogo de GT (un código, un % por sujeto) → un concepto por
 * cada sujeto que el código contempla. El sujeto sin porcentaje no se ofrece:
 * en el catálogo, vacío quiere decir «no aplica», no «falta cargar».
 * Sustraendo y mínimo de 83,3334 UT, solo para la persona natural residente.
 */
export function conceptosDeFilaGt(r: Record<string, unknown>): ConceptoRetencion[] {
  const out: ConceptoRetencion[] = [];
  for (const s of ['PJD', 'PJND', 'PNR', 'PNNR'] as const) {
    const pct = r[COLUMNA_SUJETO[s]];
    if (pct == null) continue;
    out.push({
      id: `${r.codigo}:${s}`, tipo: 'islr', codigo: texto(r.codigo), nombre: String(r.concepto ?? ''),
      sujeto: SUJETO_DE_GT[s], porcentaje: n(pct), basePct: n(r.base_pct) || 100,
      aplicaSustraendo: s === 'PNR', baseMinimaUt: s === 'PNR' ? 83.3334 : 0,
      fundamento: texto(r.nota), activo: r.activo !== false, orden: n(r.orden),
    });
  }
  return out;
}

/**
 * El ISAE y el timbre estadal no están en el catálogo de GT: su alícuota es un
 * dato de Parámetros. Se ofrecen como un concepto cada uno, para que el cálculo
 * los trate igual que al ISLR.
 */
export function conceptosLocales(j: JsonParametros | null | undefined): ConceptoRetencion[] {
  const v = j ?? {};
  const base = { codigo: null, sujeto: 'todos' as const, basePct: 100, aplicaSustraendo: false, baseMinimaUt: 0, activo: true };
  return [
    { ...base, id: 'municipal:todos', tipo: 'municipal', nombre: `ISAE${v.municipio ? ` · ${v.municipio}` : ''}`,
      porcentaje: n(v.municipal_alicuota), fundamento: 'Ordenanza de actividades económicas del municipio', orden: 900 },
    { ...base, id: 'regional:todos', tipo: 'regional', nombre: 'Estadal (timbre fiscal)',
      porcentaje: n(v.estadal_alicuota), fundamento: 'Ley de timbre fiscal del estado', orden: 901 },
  ];
}

export async function listConceptos(soloActivos = false): Promise<ConceptoRetencion[]> {
  let q = supabase.from(T_CONCEPTOS).select('codigo, concepto, pjd, pjnd, pnr, pnnr, base_pct, activo, orden, nota')
    .order('orden', { ascending: true });
  if (soloActivos) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw errorRetencion(error, 'No se pudo leer el catálogo de conceptos.');
  const islr = (data ?? []).flatMap((r) => conceptosDeFilaGt(r as Record<string, unknown>));
  return [...islr, ...conceptosLocales(await leerJsonParametros())];
}

/** Separa el id sintético `codigo:SUJETO` del catálogo de GT. */
export function partirIdConcepto(id: string): { codigo: string; sujeto: SujetoGt | null } {
  const [codigo, s] = String(id).split(':');
  return { codigo, sujeto: (['PJD', 'PJND', 'PNR', 'PNNR'] as const).includes(s as SujetoGt) ? (s as SujetoGt) : null };
}

/**
 * Guarda un concepto del ISLR: el % va en la columna de su sujeto; el nombre y
 * la porción de la base son del código, y valen para todos sus sujetos.
 * El ISAE y el timbre estadal se cambian en Parámetros.
 */
export async function guardarConcepto(c: Partial<ConceptoRetencion> & { nombre: string; tipo: ConceptoRetencion['tipo'] }): Promise<void> {
  if (c.tipo !== 'islr') throw new Error('La alícuota municipal y la estadal se cambian en Parámetros.');
  const codigo = (c.id ? partirIdConcepto(c.id).codigo : c.codigo)?.trim();
  const sujeto = sujetoAGt(c.sujeto);
  if (!codigo) throw new Error('Código del concepto requerido (Decreto 1.808).');
  if (!sujeto) throw new Error('Sujeto requerido: indicar a quién se le aplica el porcentaje.');
  const { data, error } = await supabase.from(T_CONCEPTOS).upsert({
    codigo, concepto: c.nombre.trim(), base_pct: n(c.basePct) || 100,
    [COLUMNA_SUJETO[sujeto]]: n(c.porcentaje), nota: c.fundamento ?? null,
    ...(c.orden != null ? { orden: n(c.orden) } : {}),
  }, { onConflict: 'codigo' }).select('codigo');
  if (error) throw errorRetencion(error, 'No se pudo guardar el concepto.');
  if (!data?.length) throw new Error(SIN_PERMISO);
}

/** En GT un concepto se activa o se apaga entero: con todos sus sujetos. */
export async function activarConcepto(id: string, activo: boolean): Promise<void> {
  const { codigo } = partirIdConcepto(id);
  if (id.endsWith(':todos')) throw new Error('La alícuota municipal y la estadal se cambian en Parámetros.');
  const { data, error } = await supabase.from(T_CONCEPTOS).update({ activo }).eq('codigo', codigo).select('codigo');
  if (error) throw errorRetencion(error, 'No se pudo cambiar el concepto.');
  if (!data?.length) throw new Error(SIN_PERMISO);
}

/* ───────────────────── El libro de retenciones ─────────────────────

   Una retención tiene DIRECCIÓN, y eso cambia lo que significa:
   · recibida   — nos la practicaron: anticipo de impuesto a favor.
   · practicada — la practicamos: dinero de un tercero que hay que enterar.

   La contraparte puede ser un cliente (el que nos retiene) o un proveedor
   (al que le retenemos), por eso no se llama «proveedor».                   */

export type DocKind = 'oc' | 'compra_directa' | 'servicio_directo' | 'manual';

export interface RetencionPracticada {
  id: string;
  /** Multi-empresa: ID de la empresa a la que pertenece la retención. */
  empresaId?: string | null;
  /** VF: el documento fiscal (factura) al que pertenece la línea, si lo tiene. */
  documentoId?: string | null;
  tipo: TipoImpuesto;
  direccion: DireccionRetencion;
  estado: EstadoRetencion;
  docKind: DocKind;
  docId: string | null;
  docCodigo: string | null;
  contraparteId: string | null;
  contraparteRif: string | null;
  contraparteNombre: string | null;
  contraparteSujeto: SujetoRetenido | null;
  contraparteDireccion?: string | null;
  contraparteEmail?: string | null;
  facturaNumero: string | null;
  facturaControl: string | null;
  facturaFecha: string | null;
  /** Fecha de emisión del comprobante (columna `retenciones.fecha`). */
  fecha?: string | null;
  /** Opcional (Art. 18.3): fecha real de entrega; vacía si no se informa. */
  fechaEntrega?: string | null;
  periodo: string;
  quincena: 1 | 2 | null;
  numeroComprobante: string | null;
  /** Quién puso el número (V2, solo informativo): la serie de la base o una persona. */
  numeroOrigen?: 'sistema' | 'dado' | null;
  /** ISAE: «Operación N°», correlativo del año que pone la base (V2), solo informativo. */
  operacionNumero?: number | null;
  /** Tipo de documento tributario: factura, nota de débito o nota de crédito (PA 071). */
  tipoDocumento?: 'factura' | 'nota_debito' | 'nota_credito' | null;
  /** Factura afectada si es nota de crédito o débito (PA 071 Art. 15). */
  facturaAfectadaNro?: string | null;
  /** Monto total de la compra o factura con IVA incluido (PA 049). */
  facturaTotal?: number | null;
  /** Compras sin derecho a crédito fiscal o monto exento (PA 049). */
  exento?: number | null;
  /** Monto manual «sin derecho a crédito IVA» (dato interno; no es un concepto literal del Art. 18.8). */
  sinDerechoCreditoIva?: number | null;
  /** N° de licencia municipal o RIM del sujeto retenido (ISAE). */
  licenciaSujeto?: string | null;
  conceptoId: string | null;
  conceptoNombre: string | null;
  moneda: string;
  tasa: number | null;
  baseImponible: number;
  /** Base imponible expresada en bolívares (null si no hay tasa). */
  baseBs?: number | null;
  alicuota: number;
  impuesto: number;
  /** Art. 18.8: IVA de la factura o bruto del ISLR antes del sustraendo. */
  impuestoCausado?: number | null;
  porcentaje: number;
  sustraendo: number;
  montoRetenido: number;
  /** Lo retenido en bolívares, que es como se declara (null si no hay tasa). */
  montoBs: number | null;
  /** Valor de la Unidad Tributaria vigente con que se calculó (VU). */
  valorUt?: number | null;
  comprobantePath: string | null;
  comprobanteNombre: string | null;
  observacion: string | null;
  anulada: boolean;
  anuladaMotivo: string | null;
  declaradaEn: string | null;
  /** Quién la declaró (la cuenta que lo marcó). */
  declaradaPor: string | null;
  actorName: string | null;
  createdAt: string;
  /** Último cambio de la fila (en una anulada, cuándo se anuló). */
  updatedAt: string | null;
}

/** Una fila de la tabla de GT → una retención del módulo. */
export function aRetencion(r: Record<string, unknown>): RetencionPracticada {
  const doc = (r.retencion_documentos && typeof r.retencion_documentos === 'object' && !Array.isArray(r.retencion_documentos))
    ? (r.retencion_documentos as Record<string, unknown>)
    : (Array.isArray(r.retencion_documentos) && r.retencion_documentos[0] && typeof r.retencion_documentos[0] === 'object'
      ? (r.retencion_documentos[0] as Record<string, unknown>)
      : null);
  const ordenId = r.orden_id ?? doc?.orden_id;
  const compraDirectaId = r.compra_directa_id ?? doc?.compra_directa_id;
  const servicioDirectoId = r.servicio_directo_id ?? doc?.servicio_directo_id;
  const docKind: DocKind = ordenId ? 'oc' : compraDirectaId ? 'compra_directa' : servicioDirectoId ? 'servicio_directo' : 'manual';
  const sujeto = sujetoDeGt(r.sujeto ?? doc?.sujeto);
  const fechaFactura = texto(r.factura_fecha ?? doc?.factura_fecha);
  const fechaEmision = texto(r.fecha);
  const fechaRef = String(fechaFactura ?? fechaEmision ?? '');
  const tipoDocRaw = r.tipo_documento ?? doc?.tipo_documento;
  const facturaAfectadaRaw = r.factura_afectada_nro ?? doc?.factura_afectada_nro;
  const facturaTotalRaw = r.factura_total ?? doc?.factura_total;
  const exentoRaw = r.exento ?? doc?.exento;
  return {
    id: String(r.id), documentoId: texto(r.documento_id), tipo: tipoDeGt(r.tipo),
    direccion: direccionDeGt(r.rol ?? doc?.rol),
    estado: r.declarada_at || r.estado === 'declarada' ? 'declarada' : 'registrada',
    docKind,
    docId: texto(ordenId ?? compraDirectaId ?? servicioDirectoId),
    docCodigo: null,
    contraparteId: texto(r.proveedor_id ?? doc?.proveedor_id),
    contraparteRif: texto(r.rif ?? doc?.rif),
    contraparteNombre: texto(r.razon_social ?? doc?.razon_social),
    contraparteSujeto: sujeto,
    contraparteDireccion: texto(r.direccion ?? r.proveedor_direccion ?? r.contraparte_direccion),
    contraparteEmail: texto(r.email ?? r.proveedor_email ?? r.contraparte_email),
    facturaNumero: texto(r.factura_nro ?? doc?.factura_nro),
    facturaControl: texto(r.factura_control ?? doc?.factura_control),
    facturaFecha: fechaFactura,
    fecha: fechaEmision,
    fechaEntrega: texto(r.fecha_entrega ?? doc?.fecha_entrega),
    tipoDocumento: tipoDocRaw === 'nota_debito' || tipoDocRaw === 'nota_credito' ? tipoDocRaw : (tipoDocRaw === 'factura' ? 'factura' : null),
    facturaAfectadaNro: texto(facturaAfectadaRaw),
    facturaTotal: facturaTotalRaw == null ? null : n(facturaTotalRaw),
    exento: exentoRaw == null ? null : n(exentoRaw),
    sinDerechoCreditoIva: (r.monto_sin_derecho_credito_iva ?? doc?.monto_sin_derecho_credito_iva) == null
      ? null : n(r.monto_sin_derecho_credito_iva ?? doc?.monto_sin_derecho_credito_iva),
    licenciaSujeto: texto(r.licencia_numero ?? r.contraparte_licencia),
    periodo: String(r.comprobante_periodo ?? (fechaRef.length >= 7 ? `${fechaRef.slice(0, 4)}${fechaRef.slice(5, 7)}` : '')),
    quincena: r.quincena === 1 || r.quincena === 2 ? r.quincena : null,
    numeroComprobante: texto(r.comprobante_nro),
    numeroOrigen: r.numero_origen === 'sistema' || r.numero_origen === 'dado' ? r.numero_origen : null,
    operacionNumero: r.operacion_numero == null ? null : n(r.operacion_numero),
    conceptoId: r.concepto_codigo ? `${r.concepto_codigo}${(r.sujeto ?? doc?.sujeto) ? `:${r.sujeto ?? doc?.sujeto}` : ''}` : null,
    conceptoNombre: texto(r.concepto),
    moneda: String(r.moneda ?? doc?.moneda ?? 'Bs'), tasa: (r.tasa ?? doc?.tasa) == null ? null : n(r.tasa ?? doc?.tasa),
    baseImponible: n(r.base),
    baseBs: r.base_bs == null ? null : n(r.base_bs),
    alicuota: n(r.iva_alicuota ?? doc?.iva_alicuota), impuesto: n(r.iva_monto ?? doc?.iva_monto),
    impuestoCausado: (r.impuesto_causado ?? doc?.impuesto_causado) == null
      ? null : n(r.impuesto_causado ?? doc?.impuesto_causado),
    porcentaje: n(r.porcentaje), sustraendo: n(r.sustraendo), montoRetenido: n(r.monto),
    montoBs: r.monto_bs == null ? null : n(r.monto_bs),
    valorUt: r.valor_ut == null ? null : n(r.valor_ut),
    comprobantePath: texto(r.comprobante_path),
    comprobanteNombre: texto(r.comprobante_nombre),
    observacion: texto(r.descripcion),
    anulada: r.estado === 'anulada',
    anuladaMotivo: texto(r.anulada_motivo),
    declaradaEn: texto(r.declarada_at),
    declaradaPor: texto(r.declarada_por),
    actorName: texto(r.actor_name),
    empresaId: texto(r.empresa_id ?? (doc as any)?.empresa_id),
    createdAt: String(r.created_at ?? ''),
    updatedAt: texto(r.updated_at),
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
  /** Multi-empresa: filtra al libro de ESA empresa. Solo surte efecto si viene (en single-empresa no se pasa). */
  empresaId?: string | null;
}

/**
 * El libro. Trae TODAS las filas del rango: Supabase corta en 1.000 sin avisar,
 * así que se pagina (un año de retenciones pasa ese tope sin esfuerzo).
 */
export async function listRetenciones(f: FiltroRetenciones = {}): Promise<RetencionPracticada[]> {
  const conDocumentos = await tablaDisponible('retencion_documentos');
  const columnas = conDocumentos
    ? '*, retencion_documentos(tipo_documento, factura_afectada_nro, factura_total, exento)'
    : '*';
  const filas = await todasLasFilas<Record<string, unknown>>((desde, hasta) => {
    let q = (supabase.from(T_RETENCIONES).select(columnas) as any)
      .order('factura_fecha', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })   // desempate estable: sin esto las páginas se solapan
      .range(desde, hasta);
    if (f.direccion) q = q.eq('rol', rolAGt(f.direccion));
    if (f.tipo) q = q.eq('tipo', tipoAGt(f.tipo));
    if (f.estado) q = q.eq('estado', f.estado);
    if (f.periodo) q = q.eq('comprobante_periodo', f.periodo);
    if (f.desde) q = q.gte('factura_fecha', f.desde);
    if (f.hasta) q = q.lte('factura_fecha', f.hasta);
    if (f.docId) q = q.or(`orden_id.eq.${f.docId},compra_directa_id.eq.${f.docId},servicio_directo_id.eq.${f.docId}`);
    // Multi-empresa: la columna la pone/copia la base (R13). Solo filtra si se pidió.
    if (f.empresaId) q = q.eq('empresa_id', f.empresaId);
    if (!f.incluirAnuladas) q = q.neq('estado', 'anulada');
    return q;
  });
  return filas.map((r) => aRetencion(r));
}

/** Los períodos que tienen retenciones, del más nuevo al más viejo. */
export async function listPeriodos(): Promise<string[]> {
  const { data, error } = await supabase.from(T_RETENCIONES).select('comprobante_periodo')
    .not('comprobante_periodo', 'is', null).order('comprobante_periodo', { ascending: false });
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => String((r as { comprobante_periodo: string }).comprobante_periodo)))];
}

export interface NuevaRetencion {
  /** R7: la regla vigente con que se calculó y la foto de sus pasos (de calcularConReglaVigente). Solo se guarda si existe R7. */
  regla?: { regla_id: string; foto: Record<string, unknown> } | null;
  tipo: TipoImpuesto;
  direccion: DireccionRetencion;
  docKind: DocKind;
  docId?: string | null;
  docCodigo?: string | null;
  /** Solo un proveedor: la columna tiene clave foránea a `proveedores`. */
  contraparteId?: string | null;
  contraparteRif?: string | null;
  contraparteNombre?: string | null;
  contraparteSujeto?: SujetoRetenido | null;
  facturaNumero?: string | null;
  facturaControl?: string | null;
  facturaFecha?: string | null;
  /** Emisión del comprobante (columna `fecha`). El período sale de la fecha de la factura. */
  fechaRetencion?: string | null;
  /** Opcional (Art. 18.3): fecha real de entrega del comprobante. */
  fechaEntrega?: string | null;
  periodo: string;
  quincena?: 1 | 2 | null;
  /** Solo para las recibidas: el número que trae el comprobante del cliente. */
  numeroComprobante?: string | null;
  conceptoId?: string | null;
  conceptoNombre?: string | null;
  /** El municipio de un ISAE (el de la empresa). */
  municipio?: string | null;
  moneda: string;
  tasa?: number | null;
  /** Total real de la factura o nota de débito (Art. 18.8), distinto de la base si aplica. */
  facturaTotal?: number | null;
  baseImponible: number;
  alicuota?: number;
  impuesto?: number;
  /** Art. 18.8: impuesto causado (IVA de factura o bruto ISLR antes del sustraendo). */
  impuestoCausado?: number | null;
  /** Dato interno manual; separado de `exento`. */
  sinDerechoCreditoIva?: number | null;
  porcentaje: number;
  sustraendo?: number;
  montoRetenido: number;
  observacion?: string | null;
  /**
   * Multi-empresa: la empresa receptora. El registro suelto inserta una línea SIN
   * documento cabecera, así que la empresa elegida se marca directamente en la
   * línea (D1b). Solo viaja si viene (single-empresa no la manda). El camino de
   * factura marca la empresa en la cabecera (ver FacturaNueva).
   */
  empresaId?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * La retención vigente que ya ocupa la factura (mismo RIF y número, mismo
 * impuesto y dirección), o null. La base trae las candidatas por los últimos
 * dígitos del número; la comparación fina es `retencionYaRegistrada`.
 */
async function retencionVigenteDeLaFactura(input: NuevaRetencion): Promise<RetencionPracticada | null> {
  const factura = normalizarFactura(input.facturaNumero);
  if (input.tipo === 'igtf' || !factura || !input.contraparteRif?.trim()) return null;
  const cola = factura.match(/\d+$/)?.[0] ?? factura;
  const { data, error } = await supabase.from(T_RETENCIONES).select('*')
    .eq('rol', rolAGt(input.direccion)).eq('tipo', tipoAGt(input.tipo)).neq('estado', 'anulada')
    .ilike('factura_nro', `%${cola}%`);
  if (error) throw error;
  return retencionYaRegistrada((data ?? []).map((r) => aRetencion(r as Record<string, unknown>)), input);
}

/** ¿Lleva número propio? Toda practicada lo lleva, menos el IGTF (es una percepción). */
export const llevaNumeroPropio = (i: Pick<NuevaRetencion, 'direccion' | 'tipo'> & { montoRetenido?: number }) =>
  i.direccion === 'practicada' && i.tipo !== 'igtf' && (i.montoRetenido == null || i.montoRetenido > 0);

/** La fila de GT de una retención nueva (sin el número propio, que se pide aparte). */
export function filaGtDeNueva(input: NuevaRetencion, numero: { entero: number | null; texto: string | null }): Record<string, unknown> {
  const tasa = input.tasa ?? null;
  const conceptoCodigo = input.conceptoId && !input.conceptoId.endsWith(':todos') ? partirIdConcepto(input.conceptoId).codigo : null;
  const fecha = (input.fechaRetencion || input.facturaFecha || hoyVenezuela()).slice(0, 10);
  return {
    rol: rolAGt(input.direccion), tipo: tipoAGt(input.tipo), estado: 'registrada', fecha,
    // La pantalla propone hoy, pero si el llamador no confirma una entrega no se inventa.
    fecha_entrega: input.fechaEntrega?.slice(0, 10) || null,
    numero: numero.entero, comprobante_nro: numero.texto,
    comprobante_periodo: input.periodo, quincena: input.quincena ?? null,
    // En una recibida la contraparte es un cliente: no cabe en la clave foránea a proveedores.
    proveedor_id: input.direccion === 'practicada' ? input.contraparteId ?? null : null,
    rif: input.contraparteRif ? normalizarRif(input.contraparteRif) : null,
    razon_social: input.contraparteNombre?.trim() || null,
    sujeto: sujetoAGt(input.contraparteSujeto),
    factura_nro: input.facturaNumero?.trim() || null,
    factura_control: input.facturaControl?.trim() || null,
    factura_fecha: input.facturaFecha || null,
    factura_total: input.facturaTotal ?? null,
    base: r2(input.baseImponible),
    iva_alicuota: input.tipo === 'iva' ? input.alicuota ?? null : null,
    iva_monto: input.tipo === 'iva' ? input.impuesto ?? null : null,
    impuesto_causado: r2(input.impuestoCausado ?? input.impuesto ?? 0),
    monto_sin_derecho_credito_iva: input.tipo === 'iva' ? r2(input.sinDerechoCreditoIva ?? 0) : null,
    porcentaje: n(input.porcentaje),
    concepto_codigo: conceptoCodigo,
    concepto: input.conceptoNombre?.trim() || null,
    municipio: input.tipo === 'municipal' ? input.municipio?.trim() || null : null,
    sustraendo: input.sustraendo ?? null,
    monto: r2(input.montoRetenido), moneda: input.moneda || 'Bs', tasa,
    base_bs: enBolivares(r2(input.baseImponible), input.moneda, tasa) || null,
    monto_bs: enBolivares(r2(input.montoRetenido), input.moneda, tasa) || null,
    descripcion: input.observacion?.trim() || null,
    orden_id: input.docKind === 'oc' ? input.docId ?? null : null,
    compra_directa_id: input.docKind === 'compra_directa' ? input.docId ?? null : null,
    servicio_directo_id: input.docKind === 'servicio_directo' ? input.docId ?? null : null,
    actor: input.actor, actor_name: input.actorName ?? null,
    updated_at: new Date().toISOString(),
    // Multi-empresa (D1b): el registro suelto inserta una línea SIN cabecera, así que la
    // empresa elegida se marca aquí mismo. Solo viaja si viene (single-empresa no la manda).
    ...(input.empresaId ? { empresa_id: input.empresaId } : {}),
  };
}

/**
 * Traduce los errores de la base a algo que se entienda. El número único vale
 * solo para las practicadas (VF): una recibida anulada se vuelve a registrar
 * con el mismo número del cliente sin chocar.
 */
function errorLegible(e: { code?: string; message?: string }): Error {
  // D41: el único del número de comprobante lo dice errorRetencion por su nombre; otro único dice lo suyo.
  return errorRetencion(e, 'No se pudo registrar la retención.', { unico: 'Ya hay en el libro un comprobante de ese impuesto con el mismo número. Revisa el número del comprobante.' });
}

/**
 * Registra una retención en el libro.
 *
 * Primero se valida todo lo que se puede en pantalla (régimen, carga, monto y
 * doble registro). Las practicadas (menos el IGTF) reciben el número de la base
 * al insertar; el de una recibida lo puso otra empresa y se copia del
 * comprobante que entregaron.
 */
export async function registrarRetencion(input: NuevaRetencion, config: ConfigRetencion): Promise<RetencionPracticada> {
  if (input.direccion === 'practicada') {
    const motivo = motivoNoPuedePracticar(input.tipo, config);
    if (motivo) throw new Error(motivo);
  }
  const falta = faltaEnLaCarga({ tipo: input.tipo, facturaNumero: input.facturaNumero ?? '', facturaFecha: input.facturaFecha ?? '' });
  if (falta) throw new Error(falta);
  if (input.contraparteRif?.trim() && !rifValido(input.contraparteRif)) {
    throw new Error('El RIF de la contraparte no es válido: revisa la letra, los números y el dígito verificador.');
  }
  if (input.montoRetenido < 0) throw new Error('La retención no puede ser negativa.');
  // Un 0 se registra solo con su motivo (D19 · v8 §4.10): deja constancia de por qué no se retiene.
  if (input.montoRetenido === 0 && !input.observacion?.trim()) {
    throw new Error('Una retención en 0 debe llevar el motivo (por qué no se retiene).');
  }
  if (!/^\d{6}$/.test(input.periodo)) throw new Error('El período de la retención no es válido.');
  const previa = await retencionVigenteDeLaFactura(input);
  if (previa) throw new Error(mensajeDobleRegistro(previa));
  // R3: la UT (y los % del IVA) de la fecha de la factura. Antes de pedir el número: si falta, no se gasta.
  const vigente = await configDeFecha(config, (input.facturaFecha ?? '').slice(0, 10), [input.tipo]);

  // La base numera cada practicada al insertar (único lugar donde dos usuarios no
  // sacan el mismo). El número solo viaja desde el front si se escribió a mano: «dado».
  const numero: { entero: number | null; texto: string | null } = { entero: null, texto: input.numeroComprobante?.trim() || null };
  if (numero.texto && input.direccion === 'practicada') {
    // El número «dado» se valida con la serie (si numera y su formato) de
    // retencion_impuestos; sin R2, con las reglas fijas del impuesto.
    const serie = await serieDeImpuesto(tipoAGt(input.tipo));
    const numera = serie ? serie.numera : llevaNumeroPropio(input);
    const formato = serie ? serie.formato : formatoSerie(input.tipo);
    if (numera && formato && !numeroConFormato(numero.texto, formato)) {
      throw new Error(`El número del comprobante de ${labelImpuesto(input.tipo)} lleva ${textoDeFormato(formato)}.`);
    }
    if (numera && formato === 'AAAAMM8' && numero.texto.slice(0, 6) !== input.periodo) {
      throw new Error(`El número del comprobante empieza con ${numero.texto.slice(0, 6)} y debe coincidir con el período ${input.periodo} (AAAAMMSSSSSSSS).`);
    }
  }
  // VU: la UT con la que se calculó queda en la fila (el trigger de la base es solo respaldo).
  // R7: la regla y la foto viajan solo si la retención se calculó con una regla y la base las tiene.
  const conRegla = input.regla && (await tablaDisponible('retencion_reglas')) ? input.regla : null;
  const fila = { ...filaGtDeNueva(input, numero), valor_ut: vigente.valorUt > 0 ? vigente.valorUt : null, ...(conRegla ?? {}) };
  const { data, error } = await supabase.from(T_RETENCIONES).insert(fila).select('*').single();
  if (error) throw errorLegible(error);
  return aRetencion(data as Record<string, unknown>);
}

/** Un UPDATE que no tocó ninguna fila no es un éxito: la base no dio permiso. */
function exigirFilas(data: unknown[] | null): void {
  if (!data?.length) throw new Error(SIN_PERMISO);
}

/**
 * Anula una retención. NO se borra: un comprobante emitido y entregado queda en
 * el libro con su motivo, porque el correlativo no se reusa.
 */
export async function anularRetencion(id: string, motivo: string): Promise<void> {
  const m = motivo.trim();
  if (!m) throw new Error('Motivo de anulación requerido: queda en el libro como constancia.');
  const { data, error } = await supabase.from(T_RETENCIONES)
    .update({ estado: 'anulada', anulada_motivo: m, updated_at: new Date().toISOString() })
    .eq('id', id).neq('estado', 'anulada').select('id');
  if (error) throw error;
  exigirFilas(data);
}

/** Marca como declarada (o la devuelve a registrada) una retención del libro. */
export async function marcarDeclarada(id: string, declarada: boolean, actor: string): Promise<void> {
  const ahora = new Date().toISOString();
  const { data, error } = await supabase.from(T_RETENCIONES).update({
    estado: declarada ? 'declarada' : 'registrada',
    declarada_at: declarada ? ahora : null,
    declarada_por: declarada ? actor : null,
    updated_at: ahora,
  }).eq('id', id).neq('estado', 'anulada').select('id');
  if (error) throw error;
  exigirFilas(data);
}

export interface DatosCorreccionRetencion {
  base: number;
  monto: number;
  impuestoCausado?: number | null;
  ivaMonto?: number | null;
  ivaAlicuota?: number | null;
  baseBs?: number | null;
  montoBs?: number | null;
}

/**
 * Corrige la base gravable y montos de una retención emitida erróneamente sobre el total con IVA.
 * Actualiza la línea y, si existe documento_id, también la cabecera en retencion_documentos.
 */
export async function corregirBaseRetencion(id: string, datos: DatosCorreccionRetencion): Promise<void> {
  const ahora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    base: datos.base,
    monto: datos.monto,
    impuesto_causado: datos.impuestoCausado ?? datos.ivaMonto ?? datos.monto,
    updated_at: ahora,
  };
  if (datos.ivaMonto !== undefined) patch.iva_monto = datos.ivaMonto;
  if (datos.ivaAlicuota !== undefined) patch.iva_alicuota = datos.ivaAlicuota;
  if (datos.baseBs !== undefined) patch.base_bs = datos.baseBs;
  if (datos.montoBs !== undefined) patch.monto_bs = datos.montoBs;

  const { data, error } = await supabase.from(T_RETENCIONES)
    .update(patch)
    .eq('id', id)
    .neq('estado', 'anulada')
    .select('id, documento_id');

  if (error) throw error;
  exigirFilas(data);

  const docId = data[0]?.documento_id;
  if (docId && datos.ivaMonto != null) {
    try {
      await supabase.from('retencion_documentos')
        .update({
          iva_monto: datos.ivaMonto,
          iva_alicuota: datos.ivaAlicuota ?? 16,
          updated_at: ahora,
        })
        .eq('id', docId);
    } catch {
      // Ignorar si retencion_documentos no existe o falla
    }
  }
}

/** Adjunta el comprobante: el que firma el proveedor, o el que entregó el cliente. */
/** `tipo` dice qué documento es (factura, comprobante firmado…): queda delante del nombre, sin cambiar la base. */
export async function adjuntarComprobante(id: string, file: File, tipo?: string): Promise<void> {
  if (file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
    throw new Error('El comprobante debe ser PDF o imagen.');
  }
  const safe = file.name.replace(/[^\w.-]+/g, '_');
  const path = `retenciones/${id}/${safe}`;
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from(T_RETENCIONES)
    .update({ comprobante_path: path, comprobante_nombre: tipo ? `${tipo} · ${file.name}` : file.name, updated_at: new Date().toISOString() })
    .eq('id', id).select('id');
  if (error) throw error;
  exigirFilas(data);
}

/** URL firmada (10 minutos) para ver un comprobante guardado. */
export async function urlComprobante(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

export interface CorrelativoEstimado {
  numero: number;
  comprobante: string;
  formato: ReturnType<typeof formatoSerie>;
  explicacion: string;
}

/**
 * Consulta el próximo correlativo que le corresponderá a una retención practicada
 * según su impuesto y período. Es una lectura segura e idempotente que no consume secuencias.
 */
export async function consultarCorrelativoEstimado(
  tipo: TipoImpuesto,
  periodo: string,
  formatoFicha?: ReturnType<typeof formatoSerie>,
  empresaId?: string | null,
): Promise<CorrelativoEstimado> {
  if (tipo === 'igtf') {
    return {
      numero: 0,
      comprobante: 'No aplica (Percepción)',
      formato: null,
      explicacion: 'El IGTF no emite comprobante de retención propio (es percepción sobre el pago).',
    };
  }

  const tipoGt = tipoAGt(tipo);
  // El formato sale de la ficha (R2) si el front lo pasa; si no, el mapeo fijo del tipo.
  const fmt = formatoFicha !== undefined ? formatoFicha : formatoSerie(tipo);
  // Con formato AAAAMM8 el número lleva el período adelante (lo pueden usar varios impuestos).
  const conPeriodo = fmt === 'AAAAMM8';

  try {
    let q = supabase
      .from(T_RETENCIONES)
      .select('numero, comprobante_nro')
      .eq('rol', 'practicada')
      .eq('tipo', tipoGt);

    if (conPeriodo && periodo) {
      q = q.eq('comprobante_periodo', periodo);
    }
    // B2 (multi-empresa): cada empresa lleva su propia serie (R14). Si viene la empresa,
    // el estimado cuenta solo sus retenciones, para que coincida con el número que asignará la base.
    if (empresaId) {
      q = q.eq('empresa_id', empresaId);
    }

    const { data } = await q
      .order('numero', { ascending: false, nullsFirst: false })
      .limit(20);

    let maxNum = 0;
    if (data && data.length > 0) {
      for (const fila of data as { numero: unknown; comprobante_nro: unknown }[]) {
        const numFila = fila.numero != null ? Number(fila.numero) : null;
        if (numFila != null && !Number.isNaN(numFila) && numFila > maxNum) {
          maxNum = numFila;
        }
        if (fila.comprobante_nro) {
          const digitos = String(fila.comprobante_nro).replace(/\D/g, '');
          if (conPeriodo && digitos.length >= 14 && digitos.startsWith(periodo)) {
            const sec = Number(digitos.slice(6));
            if (!Number.isNaN(sec) && sec > maxNum) maxNum = sec;
          } else if (!conPeriodo && digitos.length >= 1) {
            const sec = Number(digitos.length === 14 ? digitos.slice(6) : digitos.slice(-10));
            if (!Number.isNaN(sec) && sec > maxNum) maxNum = sec;
          }
        }
      }
    }

    const siguienteNumero = maxNum + 1;
    const compTexto = formatoComprobante(periodo, siguienteNumero, tipo, fmt);

    return {
      numero: siguienteNumero,
      comprobante: compTexto,
      formato: fmt,
      explicacion: conPeriodo
        ? `Correlativo #${siguienteNumero} para ${labelImpuesto(tipo)} en el período ${periodo} (${compTexto}).`
        : `Correlativo #${siguienteNumero} para ${labelImpuesto(tipo)} (${compTexto}).`,
    };
  } catch {
    const compTexto = formatoComprobante(periodo, 1, tipo, fmt);
    return {
      numero: 1,
      comprobante: compTexto,
      formato: fmt,
      explicacion: `Correlativo #1 para ${labelImpuesto(tipo)}.`,
    };
  }
}
