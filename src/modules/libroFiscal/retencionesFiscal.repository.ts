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
import { EMPRESA_DOMICILIO, EMPRESA_NOMBRE, EMPRESA_RIF } from '@/shared/lib/empresa';
import { normalizarRif, rifValido } from '@/shared/lib/rif';
import {
  CONFIG_RETENCION_DEFECTO, enBolivares, formatoComprobante, formatoSerie, labelImpuesto, motivoNoPuedePracticar, numeroConFormato, textoDeFormato,
  type ConceptoRetencion, type ConfigRetencion, type DireccionRetencion,
  type EstadoRetencion, type SujetoRetenido, type TipoImpuesto,
} from './retencionesCalculo';
import { mensajeDobleRegistro, normalizarFactura, retencionYaRegistrada } from './dobleRegistro';
import { faltaEnLaCarga } from './validarCarga';
import { errorRetencion } from './erroresRetencion';
import { configDeFecha } from './parametros.repository';
import { serieDeImpuesto } from './impuestos.repository';
import { tablaDisponible, v2rDisponible } from './disponibilidad';
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
    esAgenteRetencionIva: bool('agente_retencion_iva', CONFIG_RETENCION_DEFECTO.esAgenteRetencionIva),
    esContribuyenteEspecial: bool('contribuyente_especial', CONFIG_RETENCION_DEFECTO.esContribuyenteEspecial),
    pctIvaGeneral: n(j.iva_retencion) || 75,
    pctIvaEspecial: n(j.iva_retencion_especial) || 100,
    valorUt: n(j.unidad_tributaria),
    pctIgtf: j.igtf_alicuota == null ? CONFIG_RETENCION_DEFECTO.pctIgtf : n(j.igtf_alicuota),
    licenciaMunicipal: texto(j.licencia_municipal) ?? texto(j.licencia_numero) ?? texto(j.rim) ?? null,
    imprimirOriginalYCopia: bool('imprimir_original_copia', true),
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
    licencia_municipal: c.licenciaMunicipal ?? '',
    agente_retencion_iva: c.esAgenteRetencionIva,
    contribuyente_especial: c.esContribuyenteEspecial,
    iva_retencion: c.pctIvaGeneral,
    iva_retencion_especial: c.pctIvaEspecial,
    unidad_tributaria: c.valorUt,
    igtf_alicuota: c.pctIgtf,
    imprimir_original_copia: c.imprimirOriginalYCopia !== false,
  };
}

async function leerJsonParametros(): Promise<JsonParametros | null> {
  const { data, error } = await supabase.from('config').select('value').eq('key', CLAVE_CONFIG).maybeSingle();
  if (error) throw errorRetencion(error, 'No se pudieron leer los parámetros fiscales.');
  return (data?.value as JsonParametros | undefined) ?? null;
}

export async function getConfigRetencion(): Promise<ConfigRetencion> {
  return configDeJson(await leerJsonParametros());
}

/** La Providencia SNAT/2015/0049 solo admite 75% y 100%: los dos porcentajes son dato, pero no cualquier dato. */
export const PORCENTAJES_IVA = [75, 100] as const;

export function errorPorcentajesIva(c: Pick<ConfigRetencion, 'pctIvaGeneral' | 'pctIvaEspecial'>): string | null {
  const vale = (p: number) => (PORCENTAJES_IVA as readonly number[]).includes(n(p));
  return vale(c.pctIvaGeneral) && vale(c.pctIvaEspecial)
    ? null
    : 'La retención de IVA solo puede ser 75% o 100% (Providencia SNAT/2015/0049).';
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
  // Con R1 y R3, el régimen y los valores los escribe la base desde sus tablas con fecha:
  // no se pisan con lo que la pantalla leyó antes.
  const regimen = opciones?.conservarRegimen && previo
    ? { agente_retencion_iva: previo.agente_retencion_iva, contribuyente_especial: previo.contribuyente_especial }
    : {};
  const parametros = opciones?.conservarParametros && previo
    ? Object.fromEntries(CLAVES_R3.filter((k) => k in previo).map((k) => [k, previo[k]]))
    : {};
  const value = {
    ...jsonDeConfig(c, previo),
    ...(locales && !opciones?.conservarParametros ? { municipal_alicuota: n(locales.municipal), estadal_alicuota: n(locales.estadal) } : {}),
    ...regimen,
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
  facturaNumero: string | null;
  facturaControl: string | null;
  facturaFecha: string | null;
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
  /** N° de licencia municipal o RIM del sujeto retenido (ISAE). */
  licenciaSujeto?: string | null;
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
  /** Lo retenido en bolívares, que es como se declara (null si no hay tasa). */
  montoBs: number | null;
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
  const docKind: DocKind = r.orden_id ? 'oc' : r.compra_directa_id ? 'compra_directa' : r.servicio_directo_id ? 'servicio_directo' : 'manual';
  const sujeto = sujetoDeGt(r.sujeto);
  const fechaRef = String(r.factura_fecha ?? r.fecha ?? '');
  return {
    id: String(r.id), documentoId: texto(r.documento_id), tipo: tipoDeGt(r.tipo),
    direccion: direccionDeGt(r.rol),
    estado: r.declarada_at || r.estado === 'declarada' ? 'declarada' : 'registrada',
    docKind,
    docId: texto(r.orden_id ?? r.compra_directa_id ?? r.servicio_directo_id),
    docCodigo: null,
    contraparteId: texto(r.proveedor_id),
    contraparteRif: texto(r.rif),
    contraparteNombre: texto(r.razon_social),
    contraparteSujeto: sujeto,
    contraparteDireccion: texto(r.direccion ?? r.proveedor_direccion ?? r.contraparte_direccion),
    facturaNumero: texto(r.factura_nro),
    facturaControl: texto(r.factura_control),
    facturaFecha: texto(r.factura_fecha),
    tipoDocumento: r.tipo_documento === 'nota_debito' || r.tipo_documento === 'nota_credito' ? r.tipo_documento : (r.tipo_documento === 'factura' ? 'factura' : null),
    facturaAfectadaNro: texto(r.factura_afectada_nro),
    facturaTotal: r.factura_total == null ? null : n(r.factura_total),
    exento: r.exento == null ? null : n(r.exento),
    licenciaSujeto: texto(r.licencia_numero ?? r.contraparte_licencia),
    periodo: String(r.comprobante_periodo ?? (fechaRef.length >= 7 ? `${fechaRef.slice(0, 4)}${fechaRef.slice(5, 7)}` : '')),
    quincena: r.quincena === 1 || r.quincena === 2 ? r.quincena : null,
    numeroComprobante: texto(r.comprobante_nro),
    numeroOrigen: r.numero_origen === 'sistema' || r.numero_origen === 'dado' ? r.numero_origen : null,
    operacionNumero: r.operacion_numero == null ? null : n(r.operacion_numero),
    conceptoId: r.concepto_codigo ? `${r.concepto_codigo}${r.sujeto ? `:${r.sujeto}` : ''}` : null,
    conceptoNombre: texto(r.concepto),
    moneda: String(r.moneda ?? 'Bs'), tasa: r.tasa == null ? null : n(r.tasa),
    baseImponible: n(r.base), alicuota: n(r.iva_alicuota), impuesto: n(r.iva_monto),
    porcentaje: n(r.porcentaje), sustraendo: n(r.sustraendo), montoRetenido: n(r.monto),
    montoBs: r.monto_bs == null ? null : n(r.monto_bs),
    comprobantePath: texto(r.comprobante_path),
    comprobanteNombre: texto(r.comprobante_nombre),
    observacion: texto(r.descripcion),
    anulada: r.estado === 'anulada',
    anuladaMotivo: texto(r.anulada_motivo),
    declaradaEn: texto(r.declarada_at),
    declaradaPor: texto(r.declarada_por),
    actorName: texto(r.actor_name),
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
    if (f.direccion) q = q.eq('rol', rolAGt(f.direccion));
    if (f.tipo) q = q.eq('tipo', tipoAGt(f.tipo));
    if (f.estado) q = q.eq('estado', f.estado);
    if (f.periodo) q = q.eq('comprobante_periodo', f.periodo);
    if (f.desde) q = q.gte('factura_fecha', f.desde);
    if (f.hasta) q = q.lte('factura_fecha', f.hasta);
    if (f.docId) q = q.or(`orden_id.eq.${f.docId},compra_directa_id.eq.${f.docId},servicio_directo_id.eq.${f.docId}`);
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
export const llevaNumeroPropio = (i: Pick<NuevaRetencion, 'direccion' | 'tipo'>) =>
  i.direccion === 'practicada' && i.tipo !== 'igtf';

/** La fila de GT de una retención nueva (sin el número propio, que se pide aparte). */
export function filaGtDeNueva(input: NuevaRetencion, numero: { entero: number | null; texto: string | null }): Record<string, unknown> {
  const tasa = input.tasa ?? null;
  const conceptoCodigo = input.conceptoId && !input.conceptoId.endsWith(':todos') ? partirIdConcepto(input.conceptoId).codigo : null;
  const fecha = (input.fechaRetencion || input.facturaFecha || hoyVenezuela()).slice(0, 10);
  return {
    rol: rolAGt(input.direccion), tipo: tipoAGt(input.tipo), estado: 'registrada', fecha,
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
    base: r2(input.baseImponible),
    iva_alicuota: input.tipo === 'iva' ? input.alicuota ?? null : null,
    iva_monto: input.tipo === 'iva' ? input.impuesto ?? null : null,
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

  // Con V2R, el número de una practicada lo asigna la base. Solo viaja si se escribió a mano: «dado».
  // Sin V2R (la base de hoy), el front lo pide con siguiente_numero_retencion y lo arma AAAAMM + 8.
  let numero: { entero: number | null; texto: string | null } = { entero: null, texto: input.numeroComprobante?.trim() || null };
  if (!(await v2rDisponible())) {
    if (llevaNumeroPropio(input)) {
      const { data, error } = await supabase.rpc('siguiente_numero_retencion', { p_tipo: tipoAGt(input.tipo), p_periodo: input.periodo });
      if (error) throw error;
      const entero = Number(data);
      if (!(entero > 0)) throw new Error('La base no devolvió el número del comprobante.');
      numero = { entero, texto: formatoComprobante(input.periodo, entero) };
    }
  } else if (numero.texto && input.direccion === 'practicada') {
    // V2R: la serie (si numera y su formato) sale de retencion_impuestos; sin R2, las reglas fijas.
    const serie = await serieDeImpuesto(tipoAGt(input.tipo));
    const numera = serie ? serie.numera : llevaNumeroPropio(input);
    const formato = serie ? serie.formato : formatoSerie(input.tipo);
    if (numera && formato && !numeroConFormato(numero.texto, formato)) {
      throw new Error(`El número del comprobante de ${labelImpuesto(input.tipo)} lleva ${textoDeFormato(formato)}.`);
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
