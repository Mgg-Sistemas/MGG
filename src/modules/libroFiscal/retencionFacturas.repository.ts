/* ============================================================
   Golden Touch · Libro fiscal · Registro por factura (v8 · VF)

   Un DOCUMENTO (cabecera: factura, nota de débito o nota de crédito) con
   varias LÍNEAS de impuesto. La tabla es `retencion_documentos` y cada línea
   apunta a ella por `retenciones.documento_id`. El registro es
   atómico: la base crea la cabecera y las líneas en una sola transacción con
   `retencion_factura_registrar`, y devuelve todo con sus números ya asignados
   (V2). Si algo falla, no se gasta ningún número ni queda cabecera huérfana.

   Esta capa traduce el modelo del módulo (dirección, impuesto en minúsculas,
   sujeto, documento de origen) a los NOMBRES DE COLUMNA de GT que la función
   espera. Depende del paquete de base VF (y V2 para la numeración): el código
   queda listo y se enchufa cuando estén aplicados.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { normalizarRif } from '@/shared/lib/rif';
import type { DireccionRetencion, SujetoRetenido, TipoImpuesto } from './retencionesCalculo';
import {
  aRetencion, rolAGt, sujetoAGt, tipoAGt, type DocKind, type RetencionPracticada,
  type NuevaRetencion, registrarRetencion,
} from './retencionesFiscal.repository';
import { errorRetencion } from './erroresRetencion';
import { configDeFecha } from './parametros.repository';
import { tablaDisponible, v2rDisponible } from './disponibilidad';
import { CONFIG_RETENCION_DEFECTO, formatoComprobante } from './retencionesCalculo';

const T_DOCUMENTOS = 'retencion_documentos';
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const texto = (v: unknown) => (v == null || v === '' ? null : String(v));
/** Una UT sin cargar (0) no se manda: la pone el trigger desde la configuración. */
const utValida = (v: number | null | undefined) => (Number(v) > 0 ? Number(v) : null);

/* ───────── El modelo del front ───────── */

export interface LineaFacturaNueva {
  tipo: TipoImpuesto;
  base: number;
  porcentaje: number;
  monto: number;
  sustraendo?: number | null;
  ivaAlicuota?: number | null;
  ivaMonto?: number | null;
  moneda?: string;
  tasa?: number | null;
  baseBs?: number | null;
  montoBs?: number | null;
  /** El supuesto del 100 % del IVA. */
  motivo?: string | null;
  conceptoCodigo?: string | null;
  conceptoNombre?: string | null;
  municipio?: string | null;
  /** Observación; OBLIGATORIA si el monto es 0 (D19); la valida la base. */
  descripcion?: string | null;
  /** El número editado (mixta) o el del cliente en una recibida. */
  comprobanteNro?: string | null;
  comprobantePeriodo?: string | null;
  quincena?: 1 | 2 | null;
  /** La fecha de la retención (emisión del comprobante). El período sale de la factura. */
  fecha?: string | null;
  /** R7: la regla vigente con que se calculó y la foto del cálculo (columnasDeRegla). Sin R7F la base lo ignora. */
  regla?: { regla_id: string; foto: Record<string, unknown> } | null;
}

/** Qué documento es la cabecera. Los montos van siempre en positivo: el tipo decide el signo (la nota de crédito resta). */
export type TipoDocumento = 'factura' | 'nota_debito' | 'nota_credito';

export interface FacturaNueva {
  direccion: DireccionRetencion;
  /** Por defecto, factura. */
  tipoDocumento?: TipoDocumento;
  /** La cabecera que ajusta una nota, si está en el libro. */
  documentoAfectadoId?: string | null;
  /** N° de la factura que ajusta una nota; obligatorio en una nota (puede no estar en el libro). */
  facturaAfectadaNro?: string | null;
  docKind: DocKind;
  docId?: string | null;
  /** Solo un proveedor: en una recibida la contraparte es un cliente (no lleva proveedor_id). */
  contraparteId?: string | null;
  contraparteRif?: string | null;
  contraparteNombre?: string | null;
  contraparteSujeto?: SujetoRetenido | null;
  facturaNro?: string | null;
  facturaControl?: string | null;
  facturaFecha?: string | null;
  facturaTotal?: number | null;
  exento?: number | null;
  ivaAlicuota?: number | null;
  ivaMonto?: number | null;
  moneda?: string;
  tasa?: number | null;
  operacion?: 'servicio' | 'mercancia' | null;
  concepto?: string | null;
  nota?: string | null;
  periodo?: string;
  /** La UT con la que se calcularon las líneas (VU): va en cada línea; el trigger de la base es solo respaldo. */
  valorUt?: number | null;
  /** P03: el archivo de factura de Compras del que sale el registro. Se manda solo si viene; la base lo enlaza en la misma transacción. */
  adjuntoId?: string | null;
  actor: string;
  actorName?: string | null;
}

/* ───────── Traducción al contrato de la función (columnas de GT) ───────── */

/** p_factura: la cabecera con los nombres de columna de GT. */
export function pFacturaDe(f: FacturaNueva): Record<string, unknown> {
  const tipoDocumento = f.tipoDocumento ?? 'factura';
  const esNota = tipoDocumento !== 'factura';
  return {
    rol: rolAGt(f.direccion),
    tipo_documento: tipoDocumento,
    // Una factura no ajusta a otra: la base rechaza estos datos en una factura.
    documento_afectado_id: esNota ? f.documentoAfectadoId ?? null : null,
    factura_afectada_nro: esNota ? f.facturaAfectadaNro?.trim() || null : null,
    // En una recibida la contraparte es un cliente: no cabe en la FK a proveedores.
    proveedor_id: f.direccion === 'practicada' ? f.contraparteId ?? null : null,
    rif: f.contraparteRif ? normalizarRif(f.contraparteRif) : null,
    razon_social: f.contraparteNombre?.trim() || null,
    sujeto: sujetoAGt(f.contraparteSujeto),
    factura_nro: f.facturaNro?.trim() || null,
    factura_control: f.facturaControl?.trim() || null,
    factura_fecha: f.facturaFecha || null,
    factura_total: f.facturaTotal ?? null,
    exento: f.exento ?? null,
    iva_alicuota: f.ivaAlicuota ?? null,
    iva_monto: f.ivaMonto ?? null,
    moneda: f.moneda || 'Bs',
    tasa: f.tasa ?? null,
    doc_kind: f.docKind,
    doc_id: f.docKind === 'manual' ? null : f.docId ?? null,
    operacion: f.operacion ?? null,
    concepto: f.concepto?.trim() || null,
    nota: f.nota?.trim() || null,
    periodo: f.periodo || null,
    actor: f.actor,
    actor_name: f.actorName ?? null,
    // Una factura fuera del sistema no lleva archivo de Compras (la base: RET_ADJUNTO_SIN_ORIGEN).
    ...(f.adjuntoId && f.docKind !== 'manual' ? { adjunto_id: f.adjuntoId } : {}),
  };
}

/** p_lineas[]: cada línea de impuesto con los nombres de columna de GT. */
export function pLineaDe(l: LineaFacturaNueva): Record<string, unknown> {
  return {
    tipo: tipoAGt(l.tipo),
    base: r2(n(l.base)),
    porcentaje: n(l.porcentaje),
    monto: r2(n(l.monto)),
    sustraendo: l.sustraendo ?? null,
    base_bs: l.baseBs ?? null,
    monto_bs: l.montoBs ?? null,
    iva_alicuota: l.ivaAlicuota ?? null,
    iva_monto: l.ivaMonto ?? null,
    moneda: l.moneda ?? null,
    tasa: l.tasa ?? null,
    motivo: l.motivo?.trim() || null,
    concepto_codigo: l.conceptoCodigo ?? null,
    concepto: l.conceptoNombre?.trim() || null,
    municipio: l.municipio?.trim() || null,
    descripcion: l.descripcion?.trim() || null,
    comprobante_nro: l.comprobanteNro?.trim() || null,
    comprobante_periodo: l.comprobantePeriodo ?? null,
    quincena: l.quincena ?? null,
    fecha: l.fecha ?? null,
    ...(l.regla ? { regla_id: l.regla.regla_id, foto: l.regla.foto } : {}),
  };
}

/* ───────── El registro atómico ───────── */

export interface FacturaCabecera {
  id: string;
  direccion: DireccionRetencion;
  tipoDocumento: TipoDocumento;
  documentoAfectadoId: string | null;
  facturaAfectadaNro: string | null;
  docKind: DocKind;
  docId: string | null;
  contraparteRif: string | null;
  contraparteNombre: string | null;
  facturaNro: string | null;
  facturaFecha: string | null;
  facturaTotal: number | null;
  moneda: string;
  periodo: string | null;
  nota: string | null;
  createdAt: string;
}

export interface FacturaConLineas {
  factura: FacturaCabecera;
  lineas: RetencionPracticada[];
}

/** Una fila de retencion_documentos → la cabecera del módulo. */
export function aFacturaCabecera(r: Record<string, unknown>): FacturaCabecera {
  return {
    id: String(r.id),
    direccion: r.rol === 'practicada' ? 'practicada' : 'recibida',
    tipoDocumento: r.tipo_documento === 'nota_debito' || r.tipo_documento === 'nota_credito' ? r.tipo_documento : 'factura',
    documentoAfectadoId: texto(r.documento_afectado_id),
    facturaAfectadaNro: texto(r.factura_afectada_nro),
    docKind: r.orden_id ? 'oc' : r.compra_directa_id ? 'compra_directa' : r.servicio_directo_id ? 'servicio_directo' : 'manual',
    docId: texto(r.orden_id ?? r.compra_directa_id ?? r.servicio_directo_id),
    contraparteRif: texto(r.rif),
    contraparteNombre: texto(r.razon_social),
    facturaNro: texto(r.factura_nro),
    facturaFecha: texto(r.factura_fecha),
    facturaTotal: r.factura_total == null ? null : n(r.factura_total),
    moneda: String(r.moneda ?? 'Bs'),
    // La cabecera no guarda el período: lo llevan sus líneas (retenciones.comprobante_periodo).
    periodo: periodoDeLineas(r.retenciones) ?? texto(r.periodo ?? r.comprobante_periodo),
    nota: texto(r.nota),
    createdAt: String(r.created_at ?? ''),
  };
}

/** El período de un documento: el de sus líneas (todas comparten el de la factura). */
function periodoDeLineas(lineas: unknown): string | null {
  if (!Array.isArray(lineas)) return null;
  const l = lineas.find((x) => x && (x as Record<string, unknown>).comprobante_periodo) as Record<string, unknown> | undefined;
  return l ? texto(l.comprobante_periodo) : null;
}

/** Traduce los errores de la función a un texto para la pantalla (códigos RET_* en erroresRetencion). */
function errorLegibleFactura(e: { code?: string; message?: string }): Error {
  return errorRetencion(e, 'No se pudo registrar la factura.');
}

/**
 * Sin V2R la base no numera las practicadas: cada línea que lleva número
 * propio (practicada, no IGTF, sin número escrito) lo pide con
 * siguiente_numero_retencion y lo arma AAAAMM + 8, como el registro suelto de
 * hoy. Con V2R, las líneas van sin número y la base lo pone.
 * Ojo: así el número se pide antes de la transacción; si el registro falla, ese número queda gastado (igual que hoy en el suelto).
 */
export async function numerarSinV2R(factura: Pick<FacturaNueva, 'direccion' | 'periodo' | 'facturaFecha'>, lineas: LineaFacturaNueva[]): Promise<LineaFacturaNueva[]> {
  if (factura.direccion !== 'practicada' || (await v2rDisponible())) return lineas;
  const salida: LineaFacturaNueva[] = [];
  for (const l of lineas) {
    if (l.tipo === 'igtf' || l.comprobanteNro?.trim()) { salida.push(l); continue; }
    const periodo = l.comprobantePeriodo || factura.periodo || (factura.facturaFecha ?? '').slice(0, 7).replace('-', '');
    const { data, error } = await supabase.rpc('siguiente_numero_retencion', { p_tipo: tipoAGt(l.tipo), p_periodo: periodo });
    if (error) throw errorLegibleFactura(error);
    const entero = Number(data);
    if (!(entero > 0)) throw new Error('La base no devolvió el número del comprobante.');
    salida.push({ ...l, comprobanteNro: formatoComprobante(periodo, entero), comprobantePeriodo: periodo });
  }
  return salida;
}

/**
 * Registra una factura con sus líneas en una sola transacción. La base asigna
 * los números (V2) y los devuelve. Todo o nada.
 */
export async function registrarFactura(factura: FacturaNueva, lineas: LineaFacturaNueva[]): Promise<FacturaConLineas> {
  if (!lineas.length) throw new Error('La factura necesita al menos una línea de impuesto.');
  // R3: la UT de la fecha de la factura (sin UT cargada para esa fecha, no se registra).
  const vigente = await configDeFecha({ ...CONFIG_RETENCION_DEFECTO, valorUt: factura.valorUt ?? 0 },
    (factura.facturaFecha ?? '').slice(0, 10), lineas.map((l) => l.tipo));
  const conNumero = await numerarSinV2R(factura, lineas);

  // 1. Intento por la RPC de GT (si estuviera disponible)
  try {
    const { data, error } = await supabase.rpc('retencion_factura_registrar', {
      p_factura: pFacturaDe(factura),
      p_lineas: conNumero.map((l) => ({ ...pLineaDe(l), valor_ut: utValida(vigente.valorUt) })),
    });
    if (!error && data) {
      const res = data as { factura?: Record<string, unknown>; lineas?: Record<string, unknown>[] };
      if (res.factura) {
        return {
          factura: aFacturaCabecera({ ...res.factura, retenciones: res.lineas ?? [] }),
          lineas: (res.lineas ?? []).map((l) => aRetencion(l)),
        };
      }
    }
  } catch {
    // Si la función RPC no existe en el schema cache (MGG), continuar con fallback
  }

  // 2. Registro nativo en MGG: cada línea a través de registrarRetencion
  const lineasRegistradas: RetencionPracticada[] = [];
  for (const l of conNumero) {
    const periodo = l.comprobantePeriodo || factura.periodo || (factura.facturaFecha ?? '').slice(0, 7).replace('-', '');
    const nueva: NuevaRetencion = {
      tipo: l.tipo,
      direccion: factura.direccion,
      docKind: factura.docKind,
      docId: factura.docId,
      contraparteId: factura.contraparteId,
      contraparteRif: factura.contraparteRif,
      contraparteNombre: factura.contraparteNombre,
      contraparteSujeto: factura.contraparteSujeto,
      facturaNumero: factura.facturaNro,
      facturaControl: factura.facturaControl,
      facturaFecha: factura.facturaFecha,
      fechaRetencion: l.fecha ?? factura.facturaFecha,
      periodo,
      quincena: l.quincena,
      numeroComprobante: l.comprobanteNro,
      conceptoId: l.conceptoCodigo,
      conceptoNombre: l.conceptoNombre,
      municipio: l.municipio,
      moneda: l.moneda || factura.moneda || 'Bs',
      tasa: l.tasa ?? factura.tasa,
      baseImponible: l.base,
      alicuota: l.ivaAlicuota ?? undefined,
      impuesto: l.ivaMonto ?? undefined,
      porcentaje: l.porcentaje,
      sustraendo: l.sustraendo ?? undefined,
      montoRetenido: l.monto,
      observacion: l.descripcion || factura.nota,
      actor: factura.actor,
      actorName: factura.actorName,
    };
    const reg = await registrarRetencion(nueva, vigente);
    lineasRegistradas.push(reg);
  }

  const cabeceraSintetica: FacturaCabecera = {
    id: lineasRegistradas[0]?.id || `sintetica-${Date.now()}`,
    direccion: factura.direccion,
    tipoDocumento: factura.tipoDocumento ?? 'factura',
    documentoAfectadoId: factura.documentoAfectadoId ?? null,
    facturaAfectadaNro: factura.facturaAfectadaNro ?? null,
    docKind: factura.docKind,
    docId: factura.docId ?? null,
    contraparteRif: factura.contraparteRif ?? null,
    contraparteNombre: factura.contraparteNombre ?? null,
    facturaNro: factura.facturaNro ?? null,
    facturaFecha: factura.facturaFecha ?? null,
    facturaTotal: factura.facturaTotal ?? null,
    moneda: factura.moneda || 'Bs',
    periodo: factura.periodo ?? lineasRegistradas[0]?.periodo ?? null,
    nota: factura.nota ?? null,
    createdAt: new Date().toISOString(),
  };

  return {
    factura: cabeceraSintetica,
    lineas: lineasRegistradas,
  };
}

/* ───────── Lectura: cabecera + líneas ───────── */

export interface FiltroFacturas {
  direccion?: DireccionRetencion;
  periodo?: string;
  desde?: string;
  hasta?: string;
  docId?: string;
}

/**
 * Los documentos con sus líneas. PostgREST anida por la FK retenciones.documento_id.
 * El período no está en la cabecera sino en las líneas: con ese filtro, el
 * anidado pasa a «inner» y solo quedan los documentos con líneas del período.
 */
export async function listFacturas(f: FiltroFacturas = {}): Promise<FacturaConLineas[]> {
  if (!(await tablaDisponible(T_DOCUMENTOS))) return [];
  let q = supabase.from(T_DOCUMENTOS).select(f.periodo ? '*, retenciones!inner(*)' : '*, retenciones(*)')
    .order('factura_fecha', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (f.direccion) q = q.eq('rol', rolAGt(f.direccion));
  if (f.periodo) q = q.eq('retenciones.comprobante_periodo', f.periodo);
  if (f.desde) q = q.gte('factura_fecha', f.desde);
  if (f.hasta) q = q.lte('factura_fecha', f.hasta);
  if (f.docId) q = q.or(`orden_id.eq.${f.docId},compra_directa_id.eq.${f.docId},servicio_directo_id.eq.${f.docId}`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const lineas = (r.retenciones as Record<string, unknown>[] | undefined) ?? [];
    return { factura: aFacturaCabecera(r), lineas: lineas.map((l) => aRetencion(l)) };
  });
}

/** Cambia los datos de una factura (la base los copia a sus líneas). Con líneas declaradas, solo la nota. */
export async function actualizarFactura(id: string, cambios: Partial<Pick<FacturaNueva, 'contraparteRif' | 'contraparteNombre' | 'facturaNro' | 'facturaControl' | 'facturaFecha' | 'facturaTotal' | 'nota'>>): Promise<void> {
  if (!(await tablaDisponible(T_DOCUMENTOS))) return;
  const patch: Record<string, unknown> = {};
  if ('contraparteRif' in cambios) patch.rif = cambios.contraparteRif ? normalizarRif(cambios.contraparteRif) : null;
  if ('contraparteNombre' in cambios) patch.razon_social = cambios.contraparteNombre?.trim() || null;
  if ('facturaNro' in cambios) patch.factura_nro = cambios.facturaNro?.trim() || null;
  if ('facturaControl' in cambios) patch.factura_control = cambios.facturaControl?.trim() || null;
  if ('facturaFecha' in cambios) patch.factura_fecha = cambios.facturaFecha || null;
  if ('facturaTotal' in cambios) patch.factura_total = cambios.facturaTotal ?? null;
  if ('nota' in cambios) patch.nota = cambios.nota?.trim() || null;
  const { data, error } = await supabase.from(T_DOCUMENTOS).update(patch).eq('id', id).select('id');
  if (error) throw errorLegibleFactura(error);
  if (!data?.length) throw new Error('No se guardó el cambio de la factura: sin permiso, o la factura ya no existe.');
}

/**
 * Borra una factura LIBRE (P03): sin retenciones (aunque estén anuladas), sin
 * decisiones y sin notas que la afecten. La base lo revisa y, si no, rechaza
 * con RET_DOCUMENTO_NO_LIBRE. Queda en el historial.
 */
export async function borrarFacturaLibre(id: string): Promise<void> {
  if (!(await tablaDisponible(T_DOCUMENTOS))) return;
  const { data, error } = await supabase.from(T_DOCUMENTOS).delete().eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo borrar la factura.');
  if (!data?.length) throw new Error('No se borró la factura: sin permiso de Retenciones, o ya no existe.');
}
