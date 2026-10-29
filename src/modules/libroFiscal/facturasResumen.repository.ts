/* ============================================================
   Golden Touch · Retenciones · Facturas registradas y retener después (R10)

   · La factura se puede registrar SOLA (solo_documento), sin líneas: queda
     pendiente por retener.
   · El buscador del N° de factura y la lista «Facturas registradas» leen la
     vista retencion_facturas_resumen: por factura, lo retenido por impuesto,
     las decisiones («no aplica»), los impuestos pendientes y si es retenible.
   · Retener después: retencion_lineas_registrar sobre el documento elegido,
     con la misma regla de líneas que el registro por factura.
   Todo detrás de r10Disponible() (la vista existe desde R10).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';
import { configDeFecha } from './parametros.repository';
import { aRetencion, tipoDeGt, registrarRetencion, type DocKind, type RetencionPracticada } from './retencionesFiscal.repository';
import {
  aFacturaCabecera, numerarSinV2R, pFacturaDe, pLineaDe,
  type FacturaConLineas, type FacturaNueva, type LineaFacturaNueva, type TipoDocumento,
} from './retencionFacturas.repository';
import { CONFIG_RETENCION_DEFECTO, type TipoImpuesto } from './retencionesCalculo';

const V_RESUMEN = 'retencion_facturas_resumen';

export const r10Disponible = () => tablaDisponible(V_RESUMEN);

export interface RetenidoImpuesto { lineas: number; monto: number; montoBs: number | null; estados: string[] }

export interface FacturaResumen {
  documentoId: string;
  direccion: 'practicada' | 'recibida';
  tipoDocumento: string;
  facturaAfectadaNro?: string | null;
  facturaNro: string | null;
  facturaControl: string | null;
  facturaFecha: string | null;
  facturaTotal: number | null;
  exento?: number | null;
  ivaMonto: number | null;
  moneda: string;
  tasa: number | null;
  proveedorId: string | null;
  rif: string | null;
  razonSocial: string | null;
  docKind: DocKind;
  docId: string | null;
  createdAt: string;
  /** Impuesto (clave GT: IVA, ISLR…) → lo retenido (líneas no anuladas). */
  retenido: Record<string, RetenidoImpuesto>;
  /** Impuesto → «aplica» o «no_aplica». */
  decisiones: Record<string, string>;
  /** Impuestos que la empresa practica y todavía no tienen línea ni «no aplica», en el orden de Parámetros. */
  pendientes: string[];
  retenible: boolean;
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function esFuncionInexistente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === '42883' || e.code === 'PGRST202' || e.code === '42P01') return true;
  return /could not find the function|function .* does not exist|relation .* does not exist/i.test(e.message ?? '');
}

export function aFacturaResumen(r: Record<string, unknown>): FacturaResumen {
  const retenido: Record<string, RetenidoImpuesto> = {};
  for (const [k, v] of Object.entries((r.retenido as Record<string, Record<string, unknown>> | null) ?? {})) {
    retenido[k] = { lineas: Number(v.lineas ?? 0), monto: Number(v.monto ?? 0), montoBs: num(v.monto_bs), estados: Array.isArray(v.estados) ? (v.estados as string[]) : [] };
  }
  return {
    documentoId: String(r.documento_id), direccion: r.rol === 'practicada' ? 'practicada' : 'recibida',
    tipoDocumento: String(r.tipo_documento ?? 'factura'),
    facturaAfectadaNro: texto(r.factura_afectada_nro),
    facturaNro: texto(r.factura_nro), facturaControl: texto(r.factura_control), facturaFecha: texto(r.factura_fecha),
    facturaTotal: num(r.factura_total), exento: num(r.exento), ivaMonto: num(r.iva_monto), moneda: String(r.moneda ?? 'Bs'), tasa: num(r.tasa),
    proveedorId: texto(r.proveedor_id), rif: texto(r.rif), razonSocial: texto(r.razon_social),
    docKind: r.orden_id ? 'oc' : r.compra_directa_id ? 'compra_directa' : r.servicio_directo_id ? 'servicio_directo' : r.venta_id || r.doc_kind === 'venta' ? 'venta' : 'manual',
    docId: texto(r.orden_id ?? r.compra_directa_id ?? r.servicio_directo_id ?? r.venta_id ?? r.doc_id), createdAt: String(r.created_at ?? ''),
    retenido, decisiones: (r.decisiones as Record<string, string> | null) ?? {},
    pendientes: Array.isArray(r.pendientes) ? (r.pendientes as string[]) : [], retenible: r.retenible === true,
  };
}

/** Los impuestos pendientes como tipos del módulo (iva, islr, municipal…). */
export const pendientesComoTipos = (f: Pick<FacturaResumen, 'pendientes'>): TipoImpuesto[] => f.pendientes.map((k) => tipoDeGt(k));

/** El texto del buscador: sin espacios al borde y en minúsculas (la vista guarda «buscar» en minúsculas). */
export const textoBusqueda = (t: string) => t.trim().toLowerCase().replace(/[%_]/g, '');

export interface FiltroFacturas {
  texto?: string;
  proveedorId?: string | null;
  soloRetenibles?: boolean;
  desde?: string;
  hasta?: string;
  limite?: number;
}

/** Facturas registradas (la lista) o retenibles (el buscador), las más nuevas primero. */
export async function listFacturasResumen(f: FiltroFacturas = {}): Promise<FacturaResumen[]> {
  if (!(await r10Disponible())) return [];
  let q = supabase.from(V_RESUMEN).select('*');
  if (f.soloRetenibles) q = q.eq('retenible', true);
  if (f.proveedorId) q = q.eq('proveedor_id', f.proveedorId);
  const t = textoBusqueda(f.texto ?? '');
  if (t) q = q.ilike('buscar', `%${t}%`);
  if (f.desde) q = q.gte('factura_fecha', f.desde);
  if (f.hasta) q = q.lte('factura_fecha', f.hasta);
  const { data, error } = await q.order('factura_fecha', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(f.limite ?? 50);
  if (error) throw errorRetencion(error, 'No se pudieron leer las facturas registradas.');
  return (data ?? []).map((r) => aFacturaResumen(r as Record<string, unknown>));
}

/** El buscador del N° de factura: solo las que todavía tienen algo por retener. */
export const buscarFacturasRetenibles = (texto: string, proveedorId?: string | null) =>
  listFacturasResumen({ texto, proveedorId, soloRetenibles: true, limite: 15 });

/** Registra la factura SOLA (sin líneas): queda pendiente por retener. */
export async function registrarFacturaSola(factura: FacturaNueva): Promise<FacturaConLineas> {
  if (!(await tablaDisponible('retencion_documentos'))) {
    throw new Error('El registro de facturas pendientes requiere el paquete de documentos.');
  }
  const { data, error } = await supabase.rpc('retencion_factura_registrar', {
    p_factura: { ...pFacturaDe(factura), solo_documento: true },
    p_lineas: [],
  });
  if (error) throw errorRetencion(error, 'No se pudo registrar la factura.');
  const res = (data ?? {}) as { factura?: Record<string, unknown> };
  if (!res.factura) throw new Error('La base no devolvió la factura registrada.');
  return { factura: aFacturaCabecera({ ...res.factura, retenciones: [] }), lineas: [] };
}

/**
 * Retiene después contra una factura ya registrada: las líneas van con la UT
 * de la fecha de la factura y, sin V2R, con su número como hoy.
 */
export async function retenerDespues(
  doc: Pick<FacturaResumen, 'documentoId' | 'facturaFecha' | 'direccion'> &
    Partial<Pick<FacturaResumen, 'proveedorId' | 'rif' | 'razonSocial' | 'facturaNro' | 'facturaControl' | 'facturaTotal' | 'exento' | 'moneda' | 'tasa' | 'tipoDocumento' | 'facturaAfectadaNro' | 'docKind' | 'docId'>>,
  lineas: LineaFacturaNueva[],
  opciones: { periodo?: string | null; actorName?: string | null; valorUt?: number | null } = {},
): Promise<FacturaConLineas> {
  if (!lineas.length) throw new Error('Agrega al menos una línea de impuesto para retener.');
  const fecha = (doc.facturaFecha ?? '').slice(0, 10);
  const vigente = await configDeFecha({ ...CONFIG_RETENCION_DEFECTO, valorUt: opciones.valorUt ?? 0 }, fecha, lineas.map((l) => l.tipo));
  const conNumero = await numerarSinV2R({ direccion: doc.direccion, periodo: opciones.periodo ?? undefined, facturaFecha: fecha }, lineas);

  // 1. Intento por RPC retencion_lineas_registrar (atómico en la base)
  let falloRpc = false;
  let dataRpc: unknown = null;
  try {
    const { data, error } = await supabase.rpc('retencion_lineas_registrar', {
      p_documento_id: doc.documentoId,
      p_lineas: conNumero.map((l) => ({ ...pLineaDe(l), valor_ut: Number(vigente.valorUt) > 0 ? Number(vigente.valorUt) : null })),
      p_periodo: opciones.periodo ?? null,
      p_actor_name: opciones.actorName ?? null,
    });
    if (error) {
      if (!esFuncionInexistente(error)) throw errorRetencion(error, 'No se pudo retener sobre la factura.');
      falloRpc = true;
    } else {
      dataRpc = data;
    }
  } catch (err) {
    if (err instanceof Error && !/could not find the function|function .* does not exist/i.test(err.message)) {
      throw err;
    }
    falloRpc = true;
  }

  if (!falloRpc) {
    const res = (dataRpc ?? {}) as { factura?: Record<string, unknown>; lineas?: Record<string, unknown>[] };
    if (!res.factura) throw new Error('La base no devolvió la factura registrada.');
    return {
      factura: aFacturaCabecera({ ...res.factura, retenciones: res.lineas ?? [] }),
      lineas: (res.lineas ?? []).map((l) => aRetencion(l)),
    };
  }

  // 2. Fallback nativo en MGG: registrar cada línea en retenciones conservando los datos de la factura
  const tipoDoc: TipoDocumento = doc.tipoDocumento === 'nota_credito' || doc.tipoDocumento === 'nota_debito' ? doc.tipoDocumento : 'factura';
  const lineasReg: RetencionPracticada[] = [];
  for (const l of conNumero) {
    const reg = await registrarRetencion({
      tipo: l.tipo,
      direccion: doc.direccion,
      tipoDocumento: tipoDoc,
      facturaAfectadaNro: doc.facturaAfectadaNro ?? null,
      facturaTotal: doc.facturaTotal ?? null,
      exento: doc.exento ?? null,
      docKind: doc.docKind ?? 'manual',
      docId: doc.docId ?? null,
      contraparteId: doc.proveedorId ?? null,
      contraparteRif: doc.rif ?? null,
      contraparteNombre: doc.razonSocial ?? null,
      facturaNumero: doc.facturaNro ?? null,
      facturaControl: doc.facturaControl ?? null,
      facturaFecha: fecha,
      periodo: l.comprobantePeriodo || opciones.periodo || fecha.slice(0, 7).replace('-', ''),
      quincena: l.quincena,
      numeroComprobante: l.comprobanteNro,
      conceptoId: l.conceptoCodigo,
      conceptoNombre: l.conceptoNombre,
      municipio: l.municipio,
      moneda: l.moneda || doc.moneda || 'Bs',
      tasa: l.tasa ?? doc.tasa,
      baseImponible: l.base,
      alicuota: l.ivaAlicuota ?? undefined,
      impuesto: l.ivaMonto ?? undefined,
      porcentaje: l.porcentaje,
      sustraendo: l.sustraendo ?? undefined,
      montoRetenido: l.monto,
      observacion: l.descripcion,
      actor: 'sistema',
      actorName: opciones.actorName,
    }, vigente);
    lineasReg.push(reg);
  }

  return {
    factura: {
      id: doc.documentoId,
      direccion: doc.direccion,
      tipoDocumento: tipoDoc,
      documentoAfectadoId: null,
      facturaAfectadaNro: doc.facturaAfectadaNro ?? null,
      docKind: doc.docKind ?? 'manual',
      docId: doc.docId ?? null,
      contraparteRif: doc.rif ?? null,
      contraparteNombre: doc.razonSocial ?? null,
      facturaNro: doc.facturaNro ?? null,
      facturaFecha: fecha,
      facturaTotal: doc.facturaTotal ?? null,
      moneda: doc.moneda || 'Bs',
      periodo: opciones.periodo ?? null,
      nota: null,
      createdAt: new Date().toISOString(),
    },
    lineas: lineasReg,
  };
}

/* ───────── Libro › «Sin retención»: las decisiones «no aplica» ───────── */

export interface NoAplicaRegistrado {
  id: string;
  documentoId: string;
  impuestoClave: string;
  motivo: string;
  detalle: string | null;
  quien: string | null;
  cuando: string;
  facturaNro: string | null;
  facturaFecha: string | null;
  razonSocial: string | null;
  rif: string | null;
  docKind: FacturaResumen['docKind'];
  docId: string | null;
}

export function aNoAplica(r: Record<string, unknown>): NoAplicaRegistrado {
  const d = (r.retencion_documentos as Record<string, unknown> | null) ?? {};
  const m = (r.retencion_motivos_no_aplica as Record<string, unknown> | null) ?? {};
  return {
    id: String(r.id), documentoId: String(r.documento_id), impuestoClave: String(r.impuesto_clave ?? ''),
    motivo: texto(r.motivo_texto) ?? texto(m.texto) ?? 'Sin motivo', detalle: texto(r.detalle),
    quien: texto(r.actualizado_por), cuando: String(r.actualizado_en ?? r.created_at ?? ''),
    facturaNro: texto(d.factura_nro), facturaFecha: texto(d.factura_fecha), razonSocial: texto(d.razon_social), rif: texto(d.rif),
    docKind: d.orden_id ? 'oc' : d.compra_directa_id ? 'compra_directa' : d.servicio_directo_id ? 'servicio_directo' : d.venta_id || d.doc_kind === 'venta' ? 'venta' : 'manual',
    docId: texto(d.orden_id ?? d.compra_directa_id ?? d.servicio_directo_id ?? d.venta_id ?? d.doc_id),
  };
}

/** Las decisiones «no aplica» registradas (las más nuevas primero), en un rango de fechas de la decisión. */
export async function listNoAplica(f: { desde?: string; hasta?: string } = {}): Promise<NoAplicaRegistrado[]> {
  if (!(await tablaDisponible('retencion_decisiones'))) return [];
  let q = supabase.from('retencion_decisiones')
    .select('*, retencion_documentos(factura_nro, factura_fecha, razon_social, rif, orden_id, compra_directa_id, servicio_directo_id), retencion_motivos_no_aplica(texto)')
    .eq('decision', 'no_aplica');
  if (f.desde) q = q.gte('created_at', `${f.desde}T00:00:00`);
  if (f.hasta) q = q.lte('created_at', `${f.hasta}T23:59:59`);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
  if (error) throw errorRetencion(error, 'No se pudieron leer las decisiones de «no aplica».');
  return (data ?? []).map((r) => aNoAplica(r as Record<string, unknown>));
}
