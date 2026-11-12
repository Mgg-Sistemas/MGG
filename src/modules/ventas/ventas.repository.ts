/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Repository (Supabase)

   Acceso a las tres tablas del módulo (`ventas`, `ventas_renglones`,
   `ventas_recibidos`) y a las tres transiciones, que NO son `update` sueltos:
   cada una mueve dinero o material en varias tablas a la vez, así que vive en
   la base como RPC y aquí solo se la llama. Un corte de red en el medio no
   puede dejar una venta confirmada sin deuda, ni media entrega.

   La regla que ordena el módulo:
     · Al CONFIRMAR se mueve el dinero (caja o cuenta por cobrar).
     · Al ENTREGAR se mueve el material (kardex).

   Los totales salen SIEMPRE de `calcularTotalesVenta` (`ventasCalculos.ts`).
   Aquí no se vuelve a escribir la cuenta: el bug de «el IVA no se suma» ya
   volvió varias veces por tenerla escrita en varios lados.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import {
  calcularTotalesVenta, round2,
  type RenglonCalculo, type TotalesVenta,
} from './ventasCalculos';
import {
  crearContraparte, listContrapartes,
  type Contraparte, type ContraparteInput,
} from '@/modules/tesoreria/contrapartes.repository';
import type { CuentaCaja } from '@/shared/lib/types';

const T_VENTAS = 'ventas';
const T_RENGLONES = 'ventas_renglones';
const T_RECIBIDOS = 'ventas_recibidos';
const V_MOV_CAJA = 'ventas_movimientos_caja';

/* ─────────────────────────── Tipos ─────────────────────────── */

export type TipoVenta = 'venta' | 'permuta';
/**
 * borrador → por_autorizar → autorizada → confirmada → entregada (y `anulada` desde
 * cualquiera). Antes de mover dinero la venta pasa por LEYDIS RENGEL o JESUS LOZADA:
 * lo hace cumplir la base (trigger `trg_ventas_guardia_y_historial`), no la pantalla.
 */
export type EstadoVenta = 'borrador' | 'por_autorizar' | 'autorizada' | 'confirmada' | 'entregada' | 'anulada';
/** Con qué documento sale: nota de entrega o factura (con su nº y su nº de control). */
export type DocumentoVenta = 'nota_entrega' | 'factura';
/** Estados en los que todavía no se movió dinero ni material: se pueden editar. */
export const ESTADOS_EDITABLES: EstadoVenta[] = ['borrador', 'por_autorizar', 'autorizada'];

export const DOCUMENTO_LABEL: Record<DocumentoVenta, string> = {
  nota_entrega: 'Nota de entrega',
  factura: 'Factura',
};

export const ESTADO_LABEL: Record<EstadoVenta, string> = {
  borrador: 'Borrador',
  por_autorizar: 'Por autorizar',
  autorizada: 'Autorizada',
  confirmada: 'Confirmada',
  entregada: 'Entregada',
  anulada: 'Anulada',
};

/** Un paso del rastro. Lo escribe la base; el cliente no puede reescribirlo. */
export interface EventoVenta {
  at: string;
  evento: string;
  de?: EstadoVenta | null;
  a?: EstadoVenta | null;
  actor?: string | null;
  actor_name?: string | null;
  motivo?: string | null;
  total?: number | null;
  total_antes?: number | null;
}
export type CondicionVenta = 'contado' | 'credito';
/** Por qué un despacho no se aprueba POR AHORA (sigue por aprobar). */
export type MotivoNoDespacho = 'deuda_vencida' | 'sin_cupo' | 'sin_existencia' | 'otro';

/** Contraparte del padrón de Tesorería usada como cliente. */
export type Cliente = Contraparte;

/**
 * Una forma de pago del cobro de contado: cuánto entra, en qué caja, en qué
 * cuenta y en qué moneda. Mismas claves que guarda `compras_directas`, y las
 * mismas que lee `confirmar_venta` del jsonb (`monto`, `cajaId`, `cuenta`,
 * `moneda`).
 */
export interface PagoLeg {
  cuenta: CuentaCaja;
  moneda: string;
  monto: number;
  cajaId?: string | null;
}

/** El documento. Espejo exacto de las columnas de `public.ventas`. */
export interface Venta {
  id: string;
  /** `VT-AAAA-####` (venta) o `PM-AAAA-####` (permuta). Correlativo atómico. */
  codigo: string;
  tipo: TipoVenta;
  estado: EstadoVenta;
  cliente_id: string | null;
  /** Congelados al confirmar: el comprobante de hace seis meses no puede cambiar. */
  cliente_nombre: string | null;
  cliente_rif: string | null;
  condicion: CondicionVenta;
  moneda: string;
  tasa_bs: number | null;
  subtotal: number;
  descuento: number;
  iva_pct: number;
  iva_monto: number;
  /** 0 = no aplica. Se calcula sobre la base (subtotal − descuento), como en las OC. */
  igtf_pct: number;
  igtf_monto: number;
  /** `subtotal − descuento + iva_monto + igtf_monto`. NUNCA es la base de la ganancia. */
  total: number;
  costo_total: number;
  /** Congelada al confirmar. No es `total − costo_total`: el total lleva IVA. */
  ganancia_total: number;
  /** Permuta: valor del material que entra. En venta normal, 0. */
  valor_recibido: number;
  /** `total − valor_recibido`. Es lo que hay que COBRAR, no el total. */
  diferencia: number;
  pago_legs: PagoLeg[];
  /** Cuenta corriente del cliente. La COMPARTE con otras ventas a crédito. */
  cxc_id: string | null;
  nota: string | null;
  actor: string | null;
  actor_name: string | null;
  confirmada_at: string | null;
  confirmada_por: string | null;
  entregada_at: string | null;
  entregada_por: string | null;
  anulada_at: string | null;
  anulada_por: string | null;
  motivo_anulacion: string | null;
  documento: DocumentoVenta;
  numero_factura: string | null;
  numero_control: string | null;
  enviada_at: string | null;
  enviada_por: string | null;
  autorizada_at: string | null;
  autorizada_por: string | null;
  rechazada_at: string | null;
  rechazada_por: string | null;
  rechazo_motivo: string | null;
  /** 10/11/2026 · «¿Se despacha?» → No, por ahora: el motivo queda a la vista y sigue por aprobar. */
  no_despacho_motivo: MotivoNoDespacho | null;
  no_despacho_detalle: string | null;
  no_despacho_por: string | null;
  no_despacho_en: string | null;
  /** Fecha acordada de pago (aaaa-mm-dd). Vencida si pasa y queda saldo. */
  cobrar_el: string | null;
  /** Cuándo se emitió la factura de la venta despachada. */
  facturada_at: string | null;
  facturada_por: string | null;
  /** Trazabilidad: un evento por paso, del más viejo al más nuevo. */
  historial: EventoVenta[];
  created_at: string;
  updated_at: string | null;
}

/** Lo que SALE. Espejo de `public.ventas_renglones`. */
export interface VentaRenglon {
  id: string;
  venta_id: string;
  orden: number;
  producto_id: string;
  producto_sku: string | null;
  producto_nombre: string | null;
  unidad: string | null;
  cantidad: number;
  precio_unit: number;
  /** Copiado de `existencias.costo_promedio` AL CONFIRMAR y congelado ahí. */
  costo_unit: number;
  descuento: number;
  subtotal: number;
  ganancia: number;
  /** Movimiento de kardex de la salida. Se llena al entregar. */
  mov_id: string | null;
}

/** Lo que ENTRA en una permuta. Espejo de `public.ventas_recibidos`. */
export interface VentaRecibido {
  id: string;
  venta_id: string;
  orden: number;
  producto_id: string;
  producto_sku: string | null;
  producto_nombre: string | null;
  unidad: string | null;
  cantidad: number;
  /** Valor pactado por unidad. Es la forma de pago: la base lo exige mayor a 0. */
  valor_unit: number;
  subtotal: number;
  /** Movimiento de kardex de la entrada. Se llena al entregar. */
  mov_id: string | null;
}

/** El documento con sus hijas, que es como lo usan el formulario y los PDF. */
export interface VentaCompleta {
  venta: Venta;
  renglones: VentaRenglon[];
  recibidos: VentaRecibido[];
}

/** Fila de `public.ventas_movimientos_caja`: a qué caja fue el dinero de la venta. */
export interface MovimientoCajaDeVenta {
  venta_id: string;
  movimiento_id: string;
  at: string;
  tipo: string;
  categoria: string | null;
  monto: number;
  moneda: string | null;
  cuenta: string | null;
  caja_id: string | null;
  caja_nombre: string | null;
  motivo: string | null;
  actor_name: string | null;
  cierre_id: string | null;
}

/** Stock y costo actuales de un producto, para los avisos del formulario. */
export interface ExistenciaProducto {
  producto_id: string;
  stock: number;
  costo_promedio: number;
}

/* ─────────────────────────── Inputs ─────────────────────────── */

export interface RenglonInput {
  producto_id: string;
  producto_sku?: string | null;
  producto_nombre?: string | null;
  unidad?: string | null;
  cantidad: number;
  precio_unit: number;
  /** Solo referencial en el borrador: al confirmar lo pisa `existencias`. */
  costo_unit?: number | null;
  descuento?: number | null;
}

export interface RecibidoInput {
  producto_id: string;
  producto_sku?: string | null;
  producto_nombre?: string | null;
  unidad?: string | null;
  cantidad: number;
  /** Obligatorio y mayor a 0: es la forma de pago de la permuta. */
  valor_unit: number;
}

export interface VentaInput {
  tipo?: TipoVenta;
  clienteId?: string | null;
  clienteNombre?: string | null;
  clienteRif?: string | null;
  condicion?: CondicionVenta;
  moneda?: string;
  tasaBs?: number | null;
  ivaPct?: number | null;
  /** 0 o vacío = sin IGTF. */
  igtfPct?: number | null;
  documento?: DocumentoVenta;
  numeroFactura?: string | null;
  numeroControl?: string | null;
  descuento?: number | null;
  pagoLegs?: PagoLeg[] | null;
  /** Fecha acordada de pago (aaaa-mm-dd). */
  cobrarEl?: string | null;
  nota?: string | null;
  renglones: RenglonInput[];
  recibidos?: RecibidoInput[] | null;
  actor?: string | null;
  actorName?: string | null;
}

export interface VentasFiltro {
  tipo?: TipoVenta | null;
  estado?: EstadoVenta | EstadoVenta[] | null;
  condicion?: CondicionVenta | null;
  clienteId?: string | null;
  /** ISO. Filtran por `created_at`. */
  desde?: string | null;
  hasta?: string | null;
  /** Busca en el código y en el nombre del cliente. */
  texto?: string | null;
}

/** Totales del documento + la balanza de la permuta. */
export interface ResumenVenta extends TotalesVenta {
  /** Σ (cantidad × valor_unit) del material recibido. */
  valorRecibido: number;
  /** `total − valorRecibido`: lo que hay que cobrar (o el saldo a favor si es negativo). */
  diferencia: number;
}

/* ───────────────────── Normalización ───────────────────── */

const num = (v: unknown): number => Number(v) || 0;
const txt = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s || null;
};

/** Deja las patas de pago con las claves que lee `confirmar_venta`. */
export function normalizarPagoLegs(raw: unknown): PagoLeg[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    return {
      cuenta: (o.cuenta as CuentaCaja) ?? 'general',
      moneda: txt(o.moneda) ?? 'USD',
      monto: round2(num(o.monto)),
      // La pantalla escribe `cajaId`; se acepta `caja_id` por si alguna pata
      // quedó escrita con el nombre de la columna.
      cajaId: txt(o.cajaId) ?? txt(o.caja_id),
    };
  });
}

function normalizarVenta(row: Record<string, unknown>): Venta {
  return {
    id: String(row.id),
    codigo: String(row.codigo ?? ''),
    tipo: (row.tipo as TipoVenta) ?? 'venta',
    estado: (row.estado as EstadoVenta) ?? 'borrador',
    cliente_id: (row.cliente_id as string) ?? null,
    cliente_nombre: (row.cliente_nombre as string) ?? null,
    cliente_rif: (row.cliente_rif as string) ?? null,
    condicion: (row.condicion as CondicionVenta) ?? 'contado',
    moneda: String(row.moneda ?? 'USD'),
    tasa_bs: row.tasa_bs == null ? null : num(row.tasa_bs),
    subtotal: num(row.subtotal),
    descuento: num(row.descuento),
    iva_pct: num(row.iva_pct),
    iva_monto: num(row.iva_monto),
    igtf_pct: num(row.igtf_pct),
    igtf_monto: num(row.igtf_monto),
    total: num(row.total),
    costo_total: num(row.costo_total),
    ganancia_total: num(row.ganancia_total),
    valor_recibido: num(row.valor_recibido),
    diferencia: num(row.diferencia),
    pago_legs: normalizarPagoLegs(row.pago_legs),
    cxc_id: (row.cxc_id as string) ?? null,
    nota: (row.nota as string) ?? null,
    actor: (row.actor as string) ?? null,
    actor_name: (row.actor_name as string) ?? null,
    confirmada_at: (row.confirmada_at as string) ?? null,
    confirmada_por: (row.confirmada_por as string) ?? null,
    entregada_at: (row.entregada_at as string) ?? null,
    entregada_por: (row.entregada_por as string) ?? null,
    anulada_at: (row.anulada_at as string) ?? null,
    anulada_por: (row.anulada_por as string) ?? null,
    motivo_anulacion: (row.motivo_anulacion as string) ?? null,
    documento: row.documento === 'factura' ? 'factura' : 'nota_entrega',
    numero_factura: (row.numero_factura as string) ?? null,
    numero_control: (row.numero_control as string) ?? null,
    enviada_at: (row.enviada_at as string) ?? null,
    enviada_por: (row.enviada_por as string) ?? null,
    autorizada_at: (row.autorizada_at as string) ?? null,
    autorizada_por: (row.autorizada_por as string) ?? null,
    rechazada_at: (row.rechazada_at as string) ?? null,
    rechazada_por: (row.rechazada_por as string) ?? null,
    rechazo_motivo: (row.rechazo_motivo as string) ?? null,
    no_despacho_motivo: (row.no_despacho_motivo as MotivoNoDespacho) ?? null,
    no_despacho_detalle: (row.no_despacho_detalle as string) ?? null,
    no_despacho_por: (row.no_despacho_por as string) ?? null,
    no_despacho_en: (row.no_despacho_en as string) ?? null,
    cobrar_el: (row.cobrar_el as string) ?? null,
    facturada_at: (row.facturada_at as string) ?? null,
    facturada_por: (row.facturada_por as string) ?? null,
    historial: Array.isArray(row.historial) ? (row.historial as EventoVenta[]) : [],
    created_at: String(row.created_at ?? ''),
    updated_at: (row.updated_at as string) ?? null,
  };
}

function normalizarRenglon(row: Record<string, unknown>): VentaRenglon {
  return {
    id: String(row.id),
    venta_id: String(row.venta_id),
    orden: Math.trunc(num(row.orden)),
    producto_id: String(row.producto_id),
    producto_sku: (row.producto_sku as string) ?? null,
    producto_nombre: (row.producto_nombre as string) ?? null,
    unidad: (row.unidad as string) ?? null,
    cantidad: num(row.cantidad),
    precio_unit: num(row.precio_unit),
    costo_unit: num(row.costo_unit),
    descuento: num(row.descuento),
    subtotal: num(row.subtotal),
    ganancia: num(row.ganancia),
    mov_id: (row.mov_id as string) ?? null,
  };
}

function normalizarRecibido(row: Record<string, unknown>): VentaRecibido {
  return {
    id: String(row.id),
    venta_id: String(row.venta_id),
    orden: Math.trunc(num(row.orden)),
    producto_id: String(row.producto_id),
    producto_sku: (row.producto_sku as string) ?? null,
    producto_nombre: (row.producto_nombre as string) ?? null,
    unidad: (row.unidad as string) ?? null,
    cantidad: num(row.cantidad),
    valor_unit: num(row.valor_unit),
    subtotal: num(row.subtotal),
    mov_id: (row.mov_id as string) ?? null,
  };
}

/* ─────────────────────── Cálculo compartido ─────────────────────── */

/** Suma de las patas de pago, redondeada. */
export function sumaPagoLegs(legs: PagoLeg[] | null | undefined): number {
  return round2((legs ?? []).reduce((a, l) => a + num(l.monto), 0));
}

/**
 * Totales del documento + la balanza de la permuta, con la MISMA cuenta que usa
 * la base al confirmar. Lo usan el formulario (en vivo), los PDF y los reportes.
 * No recalcular nada de esto a mano en otro lado.
 */
export function resumenDeVenta(
  renglones: RenglonCalculo[],
  recibidos: Array<{ cantidad: number; valor_unit: number }> = [],
  ivaPct = 16,
  descuento = 0,
  igtfPct = 0,
): ResumenVenta {
  const totales = calcularTotalesVenta(renglones, ivaPct, descuento, igtfPct);
  const valorRecibido = round2(
    recibidos.reduce((a, r) => a + num(r.cantidad) * num(r.valor_unit), 0),
  );
  return { ...totales, valorRecibido, diferencia: round2(totales.total - valorRecibido) };
}

/** Los renglones de entrada, en la forma que espera `calcularTotalesVenta`. */
function aCalculo(renglones: RenglonInput[]): RenglonCalculo[] {
  return renglones.map((r) => ({
    cantidad: num(r.cantidad),
    precio_unit: num(r.precio_unit),
    costo_unit: num(r.costo_unit),
    descuento: num(r.descuento),
  }));
}

/* ─────────────────────────── Correlativo ─────────────────────────── */

/**
 * Siguiente código del documento con el contador ATÓMICO de la base
 * (`next_correlativo`): nunca retrocede ni reutiliza aunque se borren
 * borradores, y es seguro entre varios vendedores a la vez. Dos series
 * separadas, como pide la spec: `VT-AAAA-####` y `PM-AAAA-####`.
 */
export async function nextCodigoVenta(tipo: TipoVenta = 'venta'): Promise<string> {
  const year = new Date().getFullYear();
  const clave = tipo === 'permuta' ? `permutas-${year}` : `ventas-${year}`;
  const { data, error } = await supabase.rpc('next_correlativo', { p_clave: clave });
  if (error) throw error;
  const seq = String(Number(data) || 1).padStart(4, '0');
  return `${tipo === 'permuta' ? 'PM' : 'VT'}-${year}-${seq}`;
}

/* ─────────────────────────── Lectura ─────────────────────────── */

/** Ventas y permutas, de la más nueva a la más vieja, con filtros opcionales. */
export async function listVentas(filtros: VentasFiltro = {}): Promise<Venta[]> {
  const filas = await todasLasFilas<Record<string, unknown>>((desde, hasta) => {
    let q = supabase.from(T_VENTAS).select('*');
    if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
    if (Array.isArray(filtros.estado)) {
      if (filtros.estado.length) q = q.in('estado', filtros.estado);
    } else if (filtros.estado) {
      q = q.eq('estado', filtros.estado);
    }
    if (filtros.condicion) q = q.eq('condicion', filtros.condicion);
    if (filtros.clienteId) q = q.eq('cliente_id', filtros.clienteId);
    if (filtros.desde) q = q.gte('created_at', filtros.desde);
    if (filtros.hasta) q = q.lte('created_at', filtros.hasta);
    // Las comas y los paréntesis son la gramática del `or` de PostgREST: si el
    // vendedor los tipea en el buscador, rompen la consulta. Se sacan.
    const texto = (filtros.texto ?? '').trim().replace(/[,()*]/g, ' ').trim();
    if (texto) q = q.or(`codigo.ilike.%${texto}%,cliente_nombre.ilike.%${texto}%`);
    // Orden estable (con desempate único) para que las páginas de
    // `todasLasFilas` no se solapen ni salten filas.
    return q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(desde, hasta);
  });
  return filas.map(normalizarVenta);
}

/** Solo la cabecera. Para el detalle de un movimiento de caja en Tesorería. */
export async function getVentaCabecera(id: string): Promise<Venta | null> {
  if (!id) return null;
  const { data, error } = await supabase.from(T_VENTAS).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? normalizarVenta(data as Record<string, unknown>) : null;
}

export async function listRenglones(ventaId: string): Promise<VentaRenglon[]> {
  if (!ventaId) return [];
  const { data, error } = await supabase.from(T_RENGLONES).select('*')
    .eq('venta_id', ventaId)
    .order('orden', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => normalizarRenglon(r as Record<string, unknown>));
}

export async function listRecibidos(ventaId: string): Promise<VentaRecibido[]> {
  if (!ventaId) return [];
  const { data, error } = await supabase.from(T_RECIBIDOS).select('*')
    .eq('venta_id', ventaId)
    .order('orden', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => normalizarRecibido(r as Record<string, unknown>));
}

/** El documento con sus renglones y su material recibido. */
export async function getVenta(id: string): Promise<VentaCompleta | null> {
  if (!id) return null;
  const venta = await getVentaCabecera(id);
  if (!venta) return null;
  const [renglones, recibidos] = await Promise.all([listRenglones(id), listRecibidos(id)]);
  return { venta, renglones, recibidos };
}

/** La venta cuyo cobro generó un movimiento de caja concreto (vínculo de Tesorería). */
export async function getVentaByCajaMovId(movId: string): Promise<Venta | null> {
  if (!movId) return null;
  const { data, error } = await supabase.from(V_MOV_CAJA)
    .select('venta_id').eq('movimiento_id', movId).maybeSingle();
  if (error) throw error;
  const ventaId = (data as { venta_id?: string | null } | null)?.venta_id;
  return ventaId ? getVentaCabecera(ventaId) : null;
}

/** Trocea un `in (...)` largo: PostgREST no traga miles de ids en la URL. */
async function porTandas<T>(ids: string[], traer: (tanda: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...await traer(ids.slice(i, i + 100)));
  }
  return out;
}

/** Renglones de varias ventas de una (reportes de ganancia por producto/cliente). */
export async function listRenglonesDeVentas(ventaIds: string[]): Promise<VentaRenglon[]> {
  if (!ventaIds.length) return [];
  return porTandas(ventaIds, async (tanda) => {
    const filas = await todasLasFilas<Record<string, unknown>>((desde, hasta) =>
      supabase.from(T_RENGLONES).select('*').in('venta_id', tanda)
        .order('venta_id', { ascending: true })
        .order('orden', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, hasta));
    return filas.map(normalizarRenglon);
  });
}

/** Material recibido de varias permutas de una. */
export async function listRecibidosDeVentas(ventaIds: string[]): Promise<VentaRecibido[]> {
  if (!ventaIds.length) return [];
  return porTandas(ventaIds, async (tanda) => {
    const filas = await todasLasFilas<Record<string, unknown>>((desde, hasta) =>
      supabase.from(T_RECIBIDOS).select('*').in('venta_id', tanda)
        .order('venta_id', { ascending: true })
        .order('orden', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, hasta));
    return filas.map(normalizarRecibido);
  });
}

/**
 * A qué cajas fue el dinero de esta venta. Lee la vista
 * `public.ventas_movimientos_caja`, que es `movimientos_caja` filtrada por
 * `ref_venta_id` con el nombre de la caja ya resuelto. Trae tanto el cobro
 * (`categoria = 'cobro_venta'`) como la reversa de la anulación.
 */
export async function listMovimientosCajaDeVenta(ventaId: string): Promise<MovimientoCajaDeVenta[]> {
  if (!ventaId) return [];
  const { data, error } = await supabase.from(V_MOV_CAJA).select('*')
    .eq('venta_id', ventaId).order('at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const o = r as Record<string, unknown>;
    return {
      venta_id: String(o.venta_id ?? ventaId),
      movimiento_id: String(o.movimiento_id ?? ''),
      at: String(o.at ?? ''),
      tipo: String(o.tipo ?? ''),
      categoria: (o.categoria as string) ?? null,
      monto: num(o.monto),
      moneda: (o.moneda as string) ?? null,
      cuenta: (o.cuenta as string) ?? null,
      caja_id: (o.caja_id as string) ?? null,
      caja_nombre: (o.caja_nombre as string) ?? null,
      motivo: (o.motivo as string) ?? null,
      actor_name: (o.actor_name as string) ?? null,
      cierre_id: (o.cierre_id as string) ?? null,
    };
  });
}

/**
 * Stock y costo promedio de cada producto, indexados por `producto_id`. Es lo
 * que el formulario necesita para los tres avisos del renglón (sin costo, por
 * debajo del costo, más de lo que hay). El costo se toma del almacén General,
 * que es el único que usa el sistema y el mismo que congela `confirmar_venta`.
 */
export async function listExistenciasVenta(): Promise<Record<string, ExistenciaProducto>> {
  const filas = await todasLasFilas<Record<string, unknown>>((desde, hasta) =>
    supabase.from('existencias').select('producto_id, almacen, stock, costo_promedio')
      .order('producto_id', { ascending: true })
      .order('almacen', { ascending: true })
      .range(desde, hasta));
  const out: Record<string, ExistenciaProducto> = {};
  for (const f of filas) {
    const pid = String(f.producto_id ?? '');
    if (!pid) continue;
    const prev = out[pid];
    const esGeneral = String(f.almacen ?? '') === 'General';
    out[pid] = {
      producto_id: pid,
      stock: (prev?.stock ?? 0) + num(f.stock),
      // Manda el General; si todavía no apareció esa fila, sirve la que haya.
      costo_promedio: esGeneral || !prev ? num(f.costo_promedio) : prev.costo_promedio,
    };
  }
  return out;
}

/* ─────────────────────────── Borrador ─────────────────────────── */

/** Columnas de la cabecera comunes al alta y a la edición. */
function columnasCabecera(input: VentaInput, resumen: ResumenVenta): Record<string, unknown> {
  return {
    tipo: input.tipo ?? 'venta',
    cliente_id: input.clienteId ?? null,
    cliente_nombre: txt(input.clienteNombre),
    cliente_rif: txt(input.clienteRif),
    condicion: input.condicion ?? 'contado',
    moneda: input.moneda ?? 'USD',
    tasa_bs: input.tasaBs == null ? null : num(input.tasaBs),
    subtotal: resumen.subtotal,
    descuento: resumen.descuento,
    iva_pct: resumen.ivaPct,
    iva_monto: resumen.ivaMonto,
    igtf_pct: resumen.igtfPct,
    igtf_monto: resumen.igtfMonto,
    documento: input.documento === 'factura' ? 'factura' : 'nota_entrega',
    // El nº de factura y el de control solo tienen sentido en una factura.
    numero_factura: input.documento === 'factura' ? txt(input.numeroFactura) : null,
    numero_control: input.documento === 'factura' ? txt(input.numeroControl) : null,
    total: resumen.total,
    costo_total: resumen.costoTotal,
    ganancia_total: resumen.gananciaTotal,
    valor_recibido: resumen.valorRecibido,
    diferencia: resumen.diferencia,
    pago_legs: normalizarPagoLegs(input.pagoLegs ?? []),
    // Solo se escribe si el formulario la manda: así no se borra en ediciones viejas.
    ...(input.cobrarEl !== undefined ? { cobrar_el: txt(input.cobrarEl) } : {}),
    nota: txt(input.nota),
  };
}

function filasRenglones(ventaId: string, renglones: RenglonInput[]): Record<string, unknown>[] {
  return renglones.map((r, i) => {
    const cant = num(r.cantidad);
    const precio = num(r.precio_unit);
    const costo = num(r.costo_unit);
    const desc = Math.max(0, num(r.descuento));
    return {
      venta_id: ventaId, orden: i,
      producto_id: r.producto_id,
      producto_sku: txt(r.producto_sku),
      producto_nombre: txt(r.producto_nombre),
      unidad: txt(r.unidad),
      cantidad: cant, precio_unit: precio, costo_unit: costo, descuento: desc,
      subtotal: round2(cant * precio - desc),
      // Referencial hasta que se confirme: ahí la base la recalcula con el costo
      // promedio del momento y la congela.
      ganancia: round2(cant * (precio - costo) - desc),
    };
  });
}

function filasRecibidos(ventaId: string, recibidos: RecibidoInput[]): Record<string, unknown>[] {
  return recibidos.map((r, i) => {
    const cant = num(r.cantidad);
    const valor = num(r.valor_unit);
    return {
      venta_id: ventaId, orden: i,
      producto_id: r.producto_id,
      producto_sku: txt(r.producto_sku),
      producto_nombre: txt(r.producto_nombre),
      unidad: txt(r.unidad),
      cantidad: cant, valor_unit: valor,
      subtotal: round2(cant * valor),
    };
  });
}

/** Valida lo que la base rechazaría igual, pero con un mensaje entendible. */
function validarInput(input: VentaInput): { renglones: RenglonInput[]; recibidos: RecibidoInput[] } {
  const renglones = (input.renglones ?? []).filter((r) => r.producto_id && num(r.cantidad) > 0);
  if (!renglones.length) throw new Error('Agrega al menos un producto con cantidad.');
  const recibidos = (input.recibidos ?? []).filter((r) => r.producto_id && num(r.cantidad) > 0);
  if ((input.tipo ?? 'venta') !== 'permuta' && recibidos.length) {
    throw new Error('Solo una permuta puede recibir material: cambia el tipo del documento.');
  }
  // En una permuta el valor del material ES la forma de pago. En 0 el material
  // entraría al inventario sin costo y la diferencia a cobrar saldría mal; la
  // base lo rechaza con un error de restricción, aquí se avisa antes y claro.
  const sinValor = recibidos.find((r) => num(r.valor_unit) <= 0);
  if (sinValor) {
    const quien = sinValor.producto_nombre ?? 'El material recibido';
    throw new Error(`«${quien}» no tiene valor por unidad. En una permuta el valor del material es la forma de pago: no puede ir en 0.`);
  }
  return { renglones, recibidos };
}

async function insertarHijas(
  ventaId: string, renglones: RenglonInput[], recibidos: RecibidoInput[],
): Promise<void> {
  const { error: errR } = await supabase.from(T_RENGLONES).insert(filasRenglones(ventaId, renglones));
  if (errR) throw errR;
  if (recibidos.length) {
    const { error: errX } = await supabase.from(T_RECIBIDOS).insert(filasRecibidos(ventaId, recibidos));
    if (errX) throw errX;
  }
}

/**
 * Crea un BORRADOR con sus renglones (y su material recibido si es permuta).
 * No mueve dinero ni stock: eso pasa al confirmar y al entregar. Los totales se
 * guardan ya calculados para que el tablero muestre números desde el minuto
 * cero; al confirmar, la base los vuelve a calcular y los congela.
 */
export async function crearBorrador(input: VentaInput): Promise<VentaCompleta> {
  const { renglones, recibidos } = validarInput(input);
  const resumen = resumenDeVenta(
    aCalculo(renglones), recibidos, num(input.ivaPct ?? 16), num(input.descuento), num(input.igtfPct),
  );
  const codigo = await nextCodigoVenta(input.tipo ?? 'venta');

  const { data, error } = await supabase.from(T_VENTAS).insert({
    codigo, estado: 'borrador',
    ...columnasCabecera(input, resumen),
    actor: txt(input.actor), actor_name: txt(input.actorName),
  }).select('*').single();
  if (error) throw error;
  const venta = normalizarVenta(data as Record<string, unknown>);

  try {
    await insertarHijas(venta.id, renglones, recibidos);
  } catch (e) {
    // Una venta sin renglones no sirve para nada y ensucia el tablero: si las
    // hijas no entraron, la cabecera se va con ellas. Todavía no movió nada.
    await supabase.from(T_VENTAS).delete().eq('id', venta.id).eq('estado', 'borrador');
    throw e;
  }
  const completa = await getVenta(venta.id);
  if (!completa) throw new Error('La venta se creó pero no se pudo volver a leer.');
  return completa;
}

/**
 * Reescribe la venta entera (cabecera + hijas). Se puede editar mientras no se
 * haya movido dinero ni material: `borrador`, `por_autorizar` y `autorizada`.
 * Editar una venta ya enviada o autorizada la DEVUELVE A BORRADOR: lo que se
 * autorizó fue otro documento, así que hay que volver a pedir la autorización
 * (queda anotado en el historial). Desde `confirmada` en adelante el camino es
 * anular y rehacer.
 */
export async function actualizarBorrador(id: string, input: VentaInput): Promise<VentaCompleta> {
  const actual = await getVentaCabecera(id);
  if (!actual) throw new Error('No existe la venta que se quiere editar.');
  if (!ESTADOS_EDITABLES.includes(actual.estado)) {
    throw new Error(`La venta ${actual.codigo} ya está ${ESTADO_LABEL[actual.estado].toLowerCase()}: para cambiarla hay que anularla y rehacerla.`);
  }
  const conTipo: VentaInput = { ...input, tipo: input.tipo ?? actual.tipo };
  const { renglones, recibidos } = validarInput(conTipo);
  const resumen = resumenDeVenta(
    aCalculo(renglones), recibidos, num(input.ivaPct ?? actual.iva_pct), num(input.descuento),
    num(input.igtfPct ?? actual.igtf_pct),
  );

  const { data, error } = await supabase.from(T_VENTAS)
    .update({
      ...columnasCabecera({ ...conTipo, documento: input.documento ?? actual.documento }, resumen),
      // Si estaba enviada o autorizada, vuelve a borrador y la autorización se cae.
      estado: 'borrador', autorizada_at: null, autorizada_por: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('estado', actual.estado)
    .select('*').maybeSingle();
  if (error) throw error;
  // El `eq('estado','borrador')` es el candado: si otro usuario la confirmó
  // mientras esta pantalla la editaba, no se pisa nada.
  if (!data) throw new Error('La venta cambió de estado mientras se editaba: vuelve a abrirla.');

  const { error: dR } = await supabase.from(T_RENGLONES).delete().eq('venta_id', id);
  if (dR) throw dR;
  const { error: dX } = await supabase.from(T_RECIBIDOS).delete().eq('venta_id', id);
  if (dX) throw dX;
  await insertarHijas(id, renglones, recibidos);

  const completa = await getVenta(id);
  if (!completa) throw new Error('La venta se guardó pero no se pudo volver a leer.');
  return completa;
}

/**
 * Borra un borrador de verdad. No hubo nada que anular: no movió dinero ni
 * stock. Las hijas se van solas por `on delete cascade`.
 */
export async function borrarBorrador(id: string): Promise<void> {
  const { data, error } = await supabase.from(T_VENTAS).delete()
    .eq('id', id).eq('estado', 'borrador').select('id');
  if (error) throw error;
  if (!data || !data.length) {
    throw new Error('Solo se puede borrar un borrador. Una venta confirmada o entregada se anula, no se borra.');
  }
}

/* ─────────────────── Transiciones (RPC en la base) ───────────────────
   Cada una es un puñado de escrituras que valen todas o ninguna. Van en
   Postgres, en una sola transacción, y desde aquí solo se las llama. */

/**
 * Borrador → POR AUTORIZAR. No mueve nada: deja la venta esperando a LEYDIS
 * RENGEL o JESUS LOZADA y les avisa por la campana.
 */
export async function enviarVentaAAutorizar(id: string, actor: string, actorName: string): Promise<Venta> {
  const { data, error } = await supabase.rpc('enviar_venta_a_autorizar', {
    p_venta_id: id, p_actor: actor, p_actor_name: actorName,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/**
 * Por autorizar → AUTORIZADA (o de vuelta a borrador si se RECHAZA, con motivo
 * obligatorio). Solo los dos autorizadores: lo comprueba la base, no la pantalla.
 */
export async function resolverAutorizacionVenta(
  id: string, aprobar: boolean, actor: string, actorName: string, motivo?: string | null,
): Promise<Venta> {
  const m = (motivo ?? '').trim();
  if (!aprobar && !m) throw new Error('Hay que decir por qué se rechaza la venta.');
  const { data, error } = await supabase.rpc('autorizar_venta', {
    p_venta_id: id, p_aprobar: aprobar, p_motivo: m || null, p_actor: actor, p_actor_name: actorName,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/**
 * Autorizada → CONFIRMADA. **Mueve el dinero, no el stock.** Congela el costo de
 * cada renglón contra `existencias.costo_promedio`, recalcula los totales y
 * copia el cliente, y cobra: de contado por las patas de pago (una entrada de
 * caja por pata), a crédito cargándole la DIFERENCIA —no el total— a la cuenta
 * corriente del cliente.
 */
export async function confirmarVenta(id: string, actor: string, actorName: string): Promise<Venta> {
  const { data, error } = await supabase.rpc('confirmar_venta', {
    p_venta_id: id, p_actor: actor, p_actor_name: actorName,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/**
 * Confirmada → ENTREGADA. **Mueve el material, no el dinero.** Salida de kardex
 * por cada renglón y, en permuta, entrada por cada recibido al valor pactado
 * (así el costo promedio de esa ficha se recalcula solo). Si un renglón falla,
 * no queda nada entregado a medias.
 */
export async function entregarVenta(id: string, actor: string, actorName: string): Promise<Venta> {
  const { data, error } = await supabase.rpc('entregar_venta', {
    p_venta_id: id, p_actor: actor, p_actor_name: actorName,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/**
 * Cualquiera → ANULADA. Motivo obligatorio. Devuelve el stock si estaba
 * entregada, reversa las patas de caja y, a crédito, RESTA de la cuenta
 * corriente del cliente (que comparte con otras ventas: anular una no la
 * cierra, le deja un cargo negativo como rastro). Se niega si esa cuenta ya
 * tiene cobros: primero hay que devolver ese dinero.
 */
export async function anularVenta(
  id: string, actor: string, actorName: string, motivo: string,
): Promise<Venta> {
  const m = (motivo ?? '').trim();
  if (!m) throw new Error('Hay que decir por qué se anula la venta.');
  const { data, error } = await supabase.rpc('anular_venta', {
    p_venta_id: id, p_actor: actor, p_actor_name: actorName, p_motivo: m,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/* ───────────────── Despacho, factura y cobro (10/11/2026) ─────────────────
   El flujo de La Cantera: cotización → despacho por aprobar → despachada ·
   por cobrar → facturada · por cobrar → cobrada. Una sola aprobación por venta,
   al DESPACHAR. Ver supabase/2026-11-10-ventas-como-compras.sql. */

/**
 * «¿Se despacha?» → SÍ. En UNA transacción: congela la venta, la deja por
 * cobrar (o la cobra en caja si ya traía las patas de pago) y saca el material.
 * Si falta existencia, no se mueve nada.
 */
export async function aprobarDespacho(id: string, actor: string, actorName: string): Promise<Venta> {
  const { data, error } = await supabase.rpc('aprobar_despacho_venta', {
    p_venta_id: id, p_actor: actor, p_actor_name: actorName,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/** «¿Se despacha?» → NO, POR AHORA. Queda por aprobar con el motivo a la vista. */
export async function noSeDespacha(
  id: string, motivo: MotivoNoDespacho, detalle: string | null, actorName: string,
): Promise<Venta> {
  const { data, error } = await supabase.rpc('venta_no_se_despacha', {
    p_venta_id: id, p_motivo: motivo, p_detalle: (detalle ?? '').trim() || null, p_actor_name: actorName,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/** «¿Se despacha?» → NO PROCEDE. Se anula con su justificación. */
export async function rechazarDespacho(id: string, justificacion: string, actorName: string): Promise<Venta> {
  const m = (justificacion ?? '').trim();
  if (m.length < 4) throw new Error('Escribe la justificación (al menos 4 letras).');
  const { data, error } = await supabase.rpc('rechazar_despacho_venta', {
    p_venta_id: id, p_motivo: m, p_actor_name: actorName,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/**
 * Emite la factura de una venta despachada (sin otra autorización). Si la venta
 * no se cobró en caja, se pueden ajustar IVA/IGTF: la diferencia va a su cuenta
 * por cobrar.
 */
export async function facturarVenta(input: {
  id: string; numeroFactura: string; numeroControl: string;
  ivaPct?: number | null; igtfPct?: number | null; actor: string; actorName: string;
}): Promise<Venta> {
  const { data, error } = await supabase.rpc('facturar_venta', {
    p_venta_id: input.id,
    p_numero_factura: input.numeroFactura.trim(),
    p_numero_control: input.numeroControl.trim(),
    p_iva_pct: input.ivaPct ?? null,
    p_igtf_pct: input.igtfPct ?? null,
    p_actor: input.actor, p_actor_name: input.actorName,
  });
  if (error) throw error;
  return normalizarVenta(data as Record<string, unknown>);
}

/**
 * Lo cobrado de cada venta por «Registrar cobro» (abonos con `ref_venta_id`).
 * Lo cobrado en caja al despachar está en las patas de pago de la venta.
 */
export async function listCobradoPorVenta(): Promise<Record<string, number>> {
  const filas = await todasLasFilas<Record<string, unknown>>((desde, hasta) =>
    supabase.from('cuentas_por_cobrar_abonos').select('ref_venta_id, monto')
      .not('ref_venta_id', 'is', null)
      .order('at', { ascending: true })
      .range(desde, hasta));
  const out: Record<string, number> = {};
  for (const f of filas) {
    const id = String(f.ref_venta_id ?? '');
    if (id) out[id] = round2((out[id] ?? 0) + num(f.monto));
  }
  return out;
}

/* ─────────────────────────── Clientes ───────────────────────────
   El padrón es `tesoreria_contrapartes` con `tipo = 'cliente'`: uno solo,
   compartido con Tesorería. La cuenta por cobrar se busca por el NOMBRE del
   cliente, así que renombrar uno después de venderle desengancha su cuenta
   vieja — limitación conocida (spec §6.2). */

export async function listClientes(): Promise<Cliente[]> {
  return listContrapartes('cliente');
}

export async function crearCliente(input: Omit<ContraparteInput, 'tipo'>): Promise<Cliente> {
  return crearContraparte({ ...input, tipo: 'cliente' });
}
