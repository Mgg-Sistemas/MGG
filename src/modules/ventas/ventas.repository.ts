/* ============================================================
   MGG · Ventas (Supabase)

   Documento: FACTURA (FAC-AAAA-NNNN, IVA e IGTF con casilla) o NOTA DE
   ENTREGA (NE-AAAA-NNNN, sin impuestos).
   Forma de pago:
     · contado     → al cobrar, el dinero entra a una caja.
     · crédito     → al emitir nace SU cuenta por cobrar (se cobra en Tesorería).
     · intercambio → el cliente paga con material: al emitir SALE lo vendido y
                     ENTRA el material (ficha existente o nueva). Si el material
                     no cubre el total, la diferencia se cobra en caja.
   Editar una venta emitida mueve el inventario solo por la DIFERENCIA y exige
   motivo. Anular revierte todo (stock, material, caja o cuenta por cobrar).
   Cada paso queda en `historial` (quién, cuándo, qué y por qué).

   AUTORIZACIÓN PREVIA: borrador → por autorizar → autorizada → emitida.
   Autorizan SOLO Leydis Rengel y Jesús Lozada (misma regla que Salidas),
   en la pantalla y en la base (trigger `trg_ventas_solo_autorizados`).
   Editar una venta autorizada (antes de emitir) la vuelve a autorización.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { getExistencia } from '@/modules/inventario/almacenes.repository';
import { createProducto, findBySku } from '@/modules/inventario/inventario.repository';
import { registrarIngresoCaja, registrarGasto } from '@/modules/tesoreria/tesoreria.repository';
import {
  crearCuentaCobrarDocumento, anularCuentaCobrarDocumento, cuentasCobrarPorIds,
  ajustarMontoCuentaCobrarDocumento, type CuentaPorCobrar,
} from '@/modules/tesoreria/cuentasPorCobrar.repository';
import type { CuentaCaja } from '@/shared/lib/types';
import { puedeAutorizarSalidas, AUTORIZAN_SALIDAS } from '@/modules/salidas/autorizanteSalida';
import {
  r2, calcItem, calcVenta, impuestosAplicados, materialValido, valorMaterial, costoUnitMaterial,
  porCobrarEnDinero, errorIntercambio, diferenciasStock, cambiosVenta, exigirMotivo,
  prefijoDocumento, nombreDocumento,
  type VentaItem, type VentaTotales, type PagoMaterial, type EventoVenta,
  type TipoDocumentoVenta, type CondicionPagoVenta,
} from './ventasLogica';

export {
  calcItem, calcVenta, nombreDocumento, porCobrarEnDinero,
  type VentaItem, type VentaTotales, type PagoMaterial, type EventoVenta,
  type TipoDocumentoVenta, type CondicionPagoVenta,
};

export type EstadoVenta = 'borrador' | 'por_aprobar' | 'aprobada' | 'emitida' | 'pagada' | 'anulada';

/** Autorizan ventas los mismos que autorizan salidas: Leydis Rengel y Jesús Lozada. */
export const puedeAutorizarVentas = puedeAutorizarSalidas;
export function nombreAutorizante(correo: string | null | undefined): string {
  return AUTORIZAN_SALIDAS[(correo ?? '').trim().toLowerCase()] ?? (correo ?? '');
}
/** ¿La venta ya movió inventario o dinero? (emitida o pagada) */
export function yaEmitida(v: Pick<Venta, 'estado'>): boolean {
  return v.estado === 'emitida' || v.estado === 'pagada';
}

export interface Venta extends VentaTotales {
  id: string;
  numero: string;
  fecha: string;
  tipo_documento?: TipoDocumentoVenta | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  estado: EstadoVenta;
  moneda: string;
  items: VentaItem[];
  descuento: number;
  aplica_iva?: boolean | null;
  iva_pct: number;
  aplica_igtf?: boolean | null;
  igtf_pct?: number | null;
  metodo_pago?: string | null;
  /** Todo lo cobrado: material + dinero en caja. */
  pagado_monto: number;
  /** Solo lo que entró a caja (contado o diferencia de un intercambio). */
  cobrado_caja?: number | null;
  /** Falta = 'contado': las ventas anteriores al crédito se leen así. */
  condicion_pago?: CondicionPagoVenta | null;
  pago_material?: PagoMaterial[] | null;
  valor_material?: number | null;
  /** Cuenta por cobrar PROPIA de esta venta (solo a crédito). */
  cxc_id?: string | null;
  caja_id?: string | null;
  cuenta_caja?: string | null;
  caja_mov_id?: string | null;
  vendedor?: string | null;
  nota?: string | null;
  historial?: EventoVenta[] | null;
  enviada_por?: string | null;
  enviada_en?: string | null;
  aprobada_por?: string | null;
  aprobada_en?: string | null;
  emitida_en?: string | null;
  emitida_por?: string | null;
  anulada_en?: string | null;
  anulada_por?: string | null;
  motivo_anulacion?: string | null;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VentaInput {
  fecha: string;
  tipo_documento?: TipoDocumentoVenta;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  moneda?: string;
  items: VentaItem[];
  descuento?: number;
  aplica_iva?: boolean;
  iva_pct?: number;
  aplica_igtf?: boolean;
  igtf_pct?: number;
  metodo_pago?: string | null;
  condicion_pago?: CondicionPagoVenta | null;
  pago_material?: PagoMaterial[];
  vendedor?: string | null;
  nota?: string | null;
}

/** Una venta a crédito mientras su cuenta por cobrar siga abierta. */
export function esVentaACredito(v: Pick<Venta, 'condicion_pago'>): boolean {
  return v.condicion_pago === 'credito';
}
export function esIntercambio(v: Pick<Venta, 'condicion_pago'>): boolean {
  return v.condicion_pago === 'intercambio';
}

/** Lo que entró a caja por esta venta (compatible con ventas viejas sin la columna). */
export function cobradoEnCaja(v: Pick<Venta, 'cobrado_caja' | 'caja_mov_id' | 'pagado_monto' | 'valor_material'>): number {
  const c = Number(v.cobrado_caja) || 0;
  if (c > 0) return r2(c);
  return v.caja_mov_id ? r2((Number(v.pagado_monto) || 0) - (Number(v.valor_material) || 0)) : 0;
}

/** Lo que falta cobrar en dinero de una venta emitida (0 si ya se cobró). */
export function saldoPorCobrar(v: Venta): number {
  if (v.estado !== 'emitida') return 0;
  return Math.max(0, r2(porCobrarEnDinero(v) - cobradoEnCaja(v)));
}

const ahora = () => new Date().toISOString();

function evento(accion: EventoVenta['accion'], actor: string, actorName: string | null | undefined, extra: Partial<EventoVenta> = {}): EventoVenta {
  return { at: ahora(), actor, actor_name: actorName ?? null, accion, ...extra };
}

/** Próximo correlativo FAC-AAAA-NNNN o NE-AAAA-NNNN (por año y tipo). */
async function nextNumero(fecha: string, tipo: TipoDocumentoVenta): Promise<string> {
  const year = (fecha || '').slice(0, 4) || String(new Date().getFullYear());
  const pre = prefijoDocumento(tipo);
  const { data, error } = await supabase.from('ventas').select('numero').like('numero', `${pre}-${year}-%`);
  if (error) throw error;
  let max = 0;
  (data ?? []).forEach((r) => {
    const m = String((r as { numero: string }).numero).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `${pre}-${year}-${String(max + 1).padStart(4, '0')}`;
}

export async function listVentas(): Promise<Venta[]> {
  const { data, error } = await supabase
    .from('ventas').select('*')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Venta[];
}

function limpiarMaterial(pagos: PagoMaterial[] | null | undefined): PagoMaterial[] {
  return materialValido(pagos).map((p) => ({
    producto_id: p.producto_id || null,
    producto_nombre: (p.producto_nombre ?? '').trim().toUpperCase(),
    unidad: p.unidad ?? null,
    almacen: (p.almacen ?? '').trim(),
    cantidad: r2(Number(p.cantidad) || 0),
    valor: r2(Number(p.valor) || 0),
  }));
}

function buildPayload(input: VentaInput) {
  const tipo: TipoDocumentoVenta = input.tipo_documento === 'nota_entrega' ? 'nota_entrega' : 'factura';
  const items = (input.items ?? []).map(calcItem).filter((i) => i.producto_nombre || i.cantidad > 0);
  const imp = impuestosAplicados({
    tipo, aplicaIva: !!input.aplica_iva, ivaPct: Number(input.iva_pct) || 0,
    aplicaIgtf: !!input.aplica_igtf, igtfPct: Number(input.igtf_pct) || 0,
  });
  const t = calcVenta(items, input.descuento ?? 0, imp.iva_pct, imp.igtf_pct);
  const condicion: CondicionPagoVenta = input.condicion_pago === 'credito' || input.condicion_pago === 'intercambio'
    ? input.condicion_pago : 'contado';
  const pago_material = condicion === 'intercambio' ? limpiarMaterial(input.pago_material) : [];
  return {
    fecha: input.fecha,
    tipo_documento: tipo,
    cliente_id: input.cliente_id ?? null,
    cliente_nombre: input.cliente_nombre?.trim() || null,
    moneda: input.moneda || 'USD',
    items,
    descuento: r2(input.descuento ?? 0),
    aplica_iva: imp.iva_pct > 0,
    iva_pct: imp.iva_pct,
    aplica_igtf: imp.igtf_pct > 0,
    igtf_pct: imp.igtf_pct,
    iva_monto: t.iva_monto, igtf_monto: t.igtf_monto,
    subtotal: t.subtotal, total: t.total, costo_total: t.costo_total,
    ganancia: t.ganancia, ganancia_pct: t.ganancia_pct,
    metodo_pago: input.metodo_pago?.trim() || null,
    condicion_pago: condicion,
    pago_material,
    valor_material: valorMaterial(pago_material),
    vendedor: input.vendedor?.trim() || null,
    nota: input.nota?.trim() || null,
  };
}

type Payload = ReturnType<typeof buildPayload>;

function validarPayload(p: Payload): void {
  if (!p.fecha) throw new Error('Indicá la fecha.');
  if (!p.items.some((i) => i.cantidad > 0 && i.precio_unit > 0)) throw new Error('Agregá al menos una línea con cantidad y precio.');
  if (p.items.some((i) => i.cantidad > 0 && !i.producto_id)) throw new Error('Cada línea tiene que tener un producto del inventario.');
  if (p.condicion_pago === 'credito' && !p.cliente_nombre) {
    throw new Error('Una venta a crédito necesita el cliente: es a nombre de quién queda la deuda.');
  }
  if (p.condicion_pago === 'intercambio') {
    const err = errorIntercambio(p.total, p.pago_material);
    if (err) throw new Error(err);
  }
}

/** Crea una venta en borrador (no toca inventario ni caja). */
export async function crearVenta(input: VentaInput, actor: string, actorName?: string | null): Promise<Venta> {
  const payload = buildPayload(input);
  if (!payload.fecha) throw new Error('Indicá la fecha.');
  const numero = await nextNumero(payload.fecha, payload.tipo_documento);
  const { data, error } = await supabase.from('ventas').insert({
    numero, estado: 'borrador', ...payload,
    historial: [evento('creada', actor, actorName, { detalle: `${nombreDocumento(payload.tipo_documento)} ${numero} en borrador` })],
    created_by: actor, actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as Venta;
}

/* ───────────── Inventario ───────────── */

async function validarStock(lineas: Array<{ producto_id: string; almacen: string; producto_nombre: string; cantidad: number }>): Promise<void> {
  // Se agrupa por producto y almacén: dos líneas del mismo producto suman.
  const m = new Map<string, { producto_id: string; almacen: string; producto_nombre: string; cantidad: number }>();
  for (const l of lineas) {
    const k = `${l.producto_id}|${l.almacen}`;
    const cur = m.get(k);
    if (cur) cur.cantidad += l.cantidad; else m.set(k, { ...l });
  }
  for (const l of m.values()) {
    const ex = await getExistencia(l.producto_id, l.almacen);
    const stock = Number(ex?.stock) || 0;
    if (r2(l.cantidad) > r2(stock)) {
      throw new Error(`Stock insuficiente de ${l.producto_nombre} en ${l.almacen}. Disponible: ${r2(stock)}, hace falta: ${r2(l.cantidad)}.`);
    }
  }
}

/** SKU para un material nuevo recibido en intercambio. */
function nuevoSkuIntercambio(nombre: string): string {
  const base = nombre.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16);
  const suf = Math.floor(performance.now() % 100000).toString(36).toUpperCase();
  return `INT-${base || 'MAT'}-${suf}`;
}

/** Crea las fichas de los materiales nuevos (antes de mover stock). */
async function resolverMaterialNuevo(pagos: PagoMaterial[]): Promise<PagoMaterial[]> {
  const out: PagoMaterial[] = [];
  for (const p of pagos) {
    if (p.producto_id) { out.push(p); continue; }
    const nombre = p.producto_nombre.trim().toUpperCase();
    if (!nombre) throw new Error('Indicá el nombre del material nuevo.');
    const sku = nuevoSkuIntercambio(nombre);
    if (await findBySku(sku)) throw new Error(`Ya existe un producto con el SKU ${sku}. Intentá de nuevo.`);
    const prod = await createProducto({
      sku, nombre, categoria: 'MINERALES', unidad: p.unidad || 'KG',
      stock: 0, stock_min: 0, precio: costoUnitMaterial(p), almacen: p.almacen, estado: 'activo',
    });
    out.push({ ...p, producto_id: prod.id, producto_nombre: prod.nombre, unidad: prod.unidad ?? p.unidad ?? null });
  }
  return out;
}

async function salidaVendido(v: Pick<Venta, 'numero' | 'cliente_nombre'>, it: { producto_id: string; almacen: string; cantidad: number; precio_unit?: number }, actor: string, actorName: string | null | undefined, detalle: string) {
  await registrarMovimiento({
    producto_id: it.producto_id, tipo: 'salida', delta: -r2(it.cantidad), almacen: it.almacen,
    actor, actor_name: actorName ?? null, ref_tipo: 'venta', ref_codigo: v.numero,
    destino: v.cliente_nombre || 'Venta', detalle, precio_unitario: it.precio_unit ?? null,
  });
}

async function reingresoVendido(v: Pick<Venta, 'numero'>, it: { producto_id: string; almacen: string; cantidad: number; costo_unit?: number }, actor: string, actorName: string | null | undefined, detalle: string, refTipo = 'venta_anulada') {
  await registrarMovimiento({
    producto_id: it.producto_id, tipo: 'entrada', delta: r2(it.cantidad), almacen: it.almacen,
    actor, actor_name: actorName ?? null, ref_tipo: refTipo, ref_codigo: v.numero,
    detalle, precio_unitario: it.costo_unit ?? null,
  });
}

async function entradaMaterial(v: Pick<Venta, 'numero' | 'cliente_nombre'>, p: PagoMaterial, cantidad: number, actor: string, actorName: string | null | undefined, detalle: string) {
  await registrarMovimiento({
    producto_id: p.producto_id!, tipo: 'entrada', delta: r2(cantidad), almacen: p.almacen,
    actor, actor_name: actorName ?? null, ref_tipo: 'venta_intercambio', ref_codigo: v.numero,
    detalle, precio_unitario: costoUnitMaterial(p),
  });
}

async function salidaMaterial(v: Pick<Venta, 'numero' | 'cliente_nombre'>, p: { producto_id: string; almacen: string }, cantidad: number, actor: string, actorName: string | null | undefined, detalle: string) {
  await registrarMovimiento({
    producto_id: p.producto_id, tipo: 'salida', delta: -r2(cantidad), almacen: p.almacen,
    actor, actor_name: actorName ?? null, ref_tipo: 'venta_intercambio_reverso', ref_codigo: v.numero,
    destino: v.cliente_nombre || 'Venta', detalle,
  });
}

/* ───────────── Emitir ───────────── */

/**
 * Emite la venta: valida stock, SALE lo vendido, ENTRA el material del
 * intercambio, y a crédito crea la cuenta por cobrar. Todas las validaciones
 * van antes de mover nada.
 */
export async function emitirVenta(v: Venta, actor: string, actorName?: string | null): Promise<Venta> {
  if (v.estado !== 'aprobada') {
    throw new Error(v.estado === 'borrador' || v.estado === 'por_aprobar'
      ? 'La venta necesita la autorización de Leydis Rengel o Jesús Lozada antes de emitirse.'
      : 'Solo se emiten ventas autorizadas.');
  }
  const p = buildPayload({ ...v, items: v.items, pago_material: v.pago_material ?? [] } as VentaInput);
  validarPayload(p);
  const items = p.items.filter((i) => i.producto_id && i.cantidad > 0);
  await validarStock(items.map((i) => ({ producto_id: i.producto_id!, almacen: i.almacen, producto_nombre: i.producto_nombre, cantidad: i.cantidad })));

  // A crédito: la deuda nace con la venta emitida. Se crea antes de mover
  // stock para que, si falla, no quede material despachado sin deuda.
  let cxcId: string | null = v.cxc_id ?? null;
  if (p.condicion_pago === 'credito' && !cxcId) {
    const cuenta = await crearCuentaCobrarDocumento({
      tipo: 'cliente', contraparte: p.cliente_nombre!, monto: p.total, moneda: p.moneda,
      origen: 'venta', nota: `${nombreDocumento(p.tipo_documento)} ${v.numero}`, actor, actorName: actorName ?? null,
    });
    cxcId = cuenta.id;
  }

  const doc = `${nombreDocumento(p.tipo_documento)} ${v.numero}`;
  for (const it of items) {
    await salidaVendido(v, { producto_id: it.producto_id!, almacen: it.almacen, cantidad: it.cantidad, precio_unit: it.precio_unit }, actor, actorName, `Venta · ${doc}`);
  }

  let material: PagoMaterial[] = [];
  if (p.condicion_pago === 'intercambio') {
    material = await resolverMaterialNuevo(p.pago_material);
    for (const m of material) {
      await entradaMaterial(v, m, m.cantidad, actor, actorName, `Pago en material · ${doc}${v.cliente_nombre ? ` · ${v.cliente_nombre}` : ''}`);
    }
  }

  const valorMat = valorMaterial(material);
  const cubierta = p.condicion_pago === 'intercambio' && r2(p.total - valorMat) <= 0;
  const detalle = [
    `${items.length} producto(s) salieron del inventario`,
    material.length ? `entró material por ${valorMat} ${p.moneda}` : null,
    p.condicion_pago === 'credito' ? 'se creó la cuenta por cobrar' : null,
    p.condicion_pago === 'intercambio' && !cubierta ? `falta cobrar ${r2(p.total - valorMat)} ${p.moneda}` : null,
  ].filter(Boolean).join(' · ');

  const { data, error } = await supabase.from('ventas').update({
    estado: cubierta ? 'pagada' : 'emitida', emitida_en: ahora(), emitida_por: actor,
    cxc_id: cxcId, pago_material: material, valor_material: valorMat,
    pagado_monto: p.condicion_pago === 'intercambio' ? valorMat : 0,
    historial: [...(v.historial ?? []), evento('emitida', actor, actorName, { detalle })],
    updated_at: ahora(),
  }).eq('id', v.id).eq('estado', 'aprobada').select('*').single();
  if (error) throw error;
  return data as Venta;
}

/* ───────────── Autorización previa ───────────── */

/** Borrador → por autorizar. Valida todo antes, para que no llegue algo incompleto. */
export async function enviarAAutorizar(v: Venta, actor: string, actorName?: string | null): Promise<Venta> {
  if (v.estado !== 'borrador') throw new Error('Solo se envían a autorizar ventas en borrador.');
  validarPayload(buildPayload({ ...v, pago_material: v.pago_material ?? [] } as VentaInput));
  const { data, error } = await supabase.from('ventas').update({
    estado: 'por_aprobar', enviada_por: actor, enviada_en: ahora(),
    historial: [...(v.historial ?? []), evento('enviada', actor, actorName, { detalle: 'Enviada a autorizar (Leydis Rengel / Jesús Lozada)' })],
    updated_at: ahora(),
  }).eq('id', v.id).eq('estado', 'borrador').select('*').single();
  if (error) throw error;
  return data as Venta;
}

/** Por autorizar → autorizada. Solo Leydis Rengel o Jesús Lozada (la base también lo exige). */
export async function autorizarVenta(v: Venta, actor: string, actorName?: string | null): Promise<Venta> {
  if (!puedeAutorizarVentas(actor)) throw new Error('Solo Leydis Rengel o Jesús Lozada pueden autorizar ventas.');
  if (v.estado !== 'por_aprobar') throw new Error('Solo se autorizan ventas que están por autorizar.');
  const { data, error } = await supabase.from('ventas').update({
    estado: 'aprobada', aprobada_por: actor.trim().toLowerCase(), aprobada_en: ahora(),
    historial: [...(v.historial ?? []), evento('autorizada', actor, actorName ?? nombreAutorizante(actor))],
    updated_at: ahora(),
  }).eq('id', v.id).eq('estado', 'por_aprobar').select('*').single();
  if (error) throw error;
  return data as Venta;
}

/** Por autorizar / autorizada → borrador, con motivo (para que la corrijan). */
export async function devolverVenta(v: Venta, actor: string, actorName: string | null | undefined, motivo: string): Promise<Venta> {
  if (!puedeAutorizarVentas(actor)) throw new Error('Solo Leydis Rengel o Jesús Lozada pueden devolver una venta.');
  if (v.estado !== 'por_aprobar' && v.estado !== 'aprobada') throw new Error('Solo se devuelven ventas por autorizar o autorizadas sin emitir.');
  const m = exigirMotivo(motivo, 'devolver la venta');
  const { data, error } = await supabase.from('ventas').update({
    estado: 'borrador', aprobada_por: null, aprobada_en: null,
    historial: [...(v.historial ?? []), evento('devuelta', actor, actorName ?? nombreAutorizante(actor), { motivo: m, detalle: 'Devuelta a borrador para corregir' })],
    updated_at: ahora(),
  }).eq('id', v.id).select('*').single();
  if (error) throw error;
  return data as Venta;
}

/* ───────────── Editar ───────────── */

/**
 * Edita una venta en cualquier estado menos anulada.
 * · Borrador: se guarda tal cual (si cambia el tipo de documento, cambia el número).
 * · Emitida / pagada: motivo obligatorio. El inventario se mueve SOLO por la
 *   diferencia (vendido y material); a crédito se ajusta la cuenta por cobrar;
 *   si ya se cobró en caja, la diferencia entra o sale de esa misma caja.
 *   La forma de pago no cambia después de emitir: para eso se anula y se rehace.
 */
export async function actualizarVenta(
  v: Venta, input: VentaInput, actor: string, actorName?: string | null, motivo?: string | null,
): Promise<Venta> {
  if (v.estado === 'anulada') throw new Error('Una venta anulada no se edita.');
  const p = buildPayload(input);

  if (!yaEmitida(v)) {
    if (!p.fecha) throw new Error('Indicá la fecha.');
    const cambios = cambiosVenta(v, p);
    // Una venta autorizada que se cambia vuelve a autorización: lo que se autorizó ya no es lo mismo.
    const reautorizar = v.estado === 'aprobada' && cambios.length > 0;
    if (reautorizar) cambios.push('Vuelve a autorización: se cambió después de autorizada');
    let numero = v.numero;
    const anioNumero = /-(\d{4})-/.exec(numero)?.[1];
    if (v.estado === 'borrador' && ((v.tipo_documento ?? 'factura') !== p.tipo_documento || anioNumero !== p.fecha.slice(0, 4))) {
      numero = await nextNumero(p.fecha, p.tipo_documento);
      if (numero !== v.numero) cambios.unshift(`Número: ${v.numero} → ${numero}`);
    }
    const { data, error } = await supabase.from('ventas').update({
      ...p, numero,
      ...(reautorizar ? { estado: 'por_aprobar', aprobada_por: null, aprobada_en: null } : {}),
      historial: [...(v.historial ?? []), evento('editada', actor, actorName, { cambios, motivo: motivo?.trim() || null })],
      updated_at: ahora(),
    }).eq('id', v.id).eq('estado', v.estado).select('*').single();
    if (error) throw error;
    return data as Venta;
  }

  // ── Emitida o pagada ──
  const m = exigirMotivo(motivo, 'editar una venta ya emitida');
  if ((v.condicion_pago ?? 'contado') !== p.condicion_pago) {
    throw new Error('La forma de pago no se cambia después de emitir. Anulá la venta y hacé una nueva.');
  }
  if ((v.tipo_documento ?? 'factura') !== p.tipo_documento) {
    throw new Error('El tipo de documento no se cambia después de emitir: el número ya se entregó. Anulá y hacé uno nuevo.');
  }
  validarPayload(p);

  const cambios = cambiosVenta(v, p);
  if (!cambios.length) throw new Error('No hay cambios que guardar.');

  // 1) Qué se mueve (todo se valida antes de tocar nada).
  const vendAntes = (v.items ?? []).map((i) => ({ ...i, producto_nombre: i.producto_nombre }));
  const difVendido = diferenciasStock(vendAntes, p.items);
  const nuevosMat = p.pago_material.filter((x) => !x.producto_id);
  const difMaterial = diferenciasStock(v.pago_material ?? [], p.pago_material.filter((x) => x.producto_id));
  await validarStock(difVendido.filter((d) => d.delta > 0).map((d) => ({ ...d, cantidad: d.delta })));
  await validarStock(difMaterial.filter((d) => d.delta < 0).map((d) => ({ ...d, cantidad: -d.delta })));

  // 2) Dinero: a crédito, la deuda; en caja, la diferencia de lo ya cobrado.
  const esInter = p.condicion_pago === 'intercambio';
  const valorMatNuevo = valorMaterial(p.pago_material);
  const dineroNuevo = porCobrarEnDinero({ total: p.total, condicion_pago: p.condicion_pago, valor_material: valorMatNuevo });
  const cobrado = cobradoEnCaja(v);
  let cajaMovId = v.caja_mov_id ?? null;
  let cobradoNuevo = cobrado;
  if (p.condicion_pago === 'credito' && v.cxc_id && r2(p.total) !== r2(v.total)) {
    await ajustarMontoCuentaCobrarDocumento(v.cxc_id, p.total, `Venta ${v.numero} editada: ${m}`);
  }
  if (p.condicion_pago !== 'credito' && cobrado > 0 && v.caja_id) {
    const dif = r2(dineroNuevo - cobrado);
    if (dif > 0) {
      const mov = await registrarIngresoCaja({
        cajaId: v.caja_id, monto: dif, moneda: v.moneda || 'USD', cuenta: (v.cuenta_caja as CuentaCaja) ?? null,
        categoria: 'venta', concepto: `Ajuste ${v.numero} (edición): ${m}`, actor, actorName: actorName ?? null,
      });
      cajaMovId = mov.id; cobradoNuevo = dineroNuevo;
    } else if (dif < 0) {
      const mov = await registrarGasto({
        cajaId: v.caja_id, monto: -dif, moneda: v.moneda || 'USD', cuenta: (v.cuenta_caja as CuentaCaja) ?? null,
        categoria: 'venta_reintegro', concepto: `Reintegro ${v.numero} (edición): ${m}`, actor, actorName: actorName ?? null,
      });
      cajaMovId = mov.id; cobradoNuevo = dineroNuevo;
    }
  }

  // 3) Inventario por diferencia.
  const doc = `${nombreDocumento(p.tipo_documento)} ${v.numero}`;
  for (const d of difVendido) {
    const it = p.items.find((i) => i.producto_id === d.producto_id && i.almacen === d.almacen)
      ?? (v.items ?? []).find((i) => i.producto_id === d.producto_id && i.almacen === d.almacen);
    if (d.delta > 0) await salidaVendido(v, { producto_id: d.producto_id, almacen: d.almacen, cantidad: d.delta, precio_unit: it?.precio_unit }, actor, actorName, `Edición ${doc}: ${m}`);
    else await reingresoVendido(v, { producto_id: d.producto_id, almacen: d.almacen, cantidad: -d.delta, costo_unit: it?.costo_unit }, actor, actorName, `Edición ${doc}: ${m}`, 'venta_edicion');
  }
  let material = p.pago_material;
  if (esInter) {
    for (const d of difMaterial) {
      const linea = p.pago_material.find((x) => x.producto_id === d.producto_id && x.almacen === d.almacen)
        ?? (v.pago_material ?? []).find((x) => x.producto_id === d.producto_id && x.almacen === d.almacen)!;
      if (d.delta > 0) await entradaMaterial(v, linea, d.delta, actor, actorName, `Edición ${doc} · material: ${m}`);
      else await salidaMaterial(v, { producto_id: d.producto_id, almacen: d.almacen }, -d.delta, actor, actorName, `Edición ${doc} · material: ${m}`);
    }
    if (nuevosMat.length) {
      const creados = await resolverMaterialNuevo(nuevosMat);
      for (const c of creados) await entradaMaterial(v, c, c.cantidad, actor, actorName, `Edición ${doc} · material nuevo: ${m}`);
      material = [...p.pago_material.filter((x) => x.producto_id), ...creados];
    }
  }

  // 4) Estado: un intercambio cubierto por material queda pagado; si ahora
  //    falta dinero y no se había cobrado nada en caja, vuelve a «emitida».
  const estado: EstadoVenta = p.condicion_pago === 'credito'
    ? v.estado
    : (r2(dineroNuevo - cobradoNuevo) <= 0 ? 'pagada' : 'emitida');

  const { data, error } = await supabase.from('ventas').update({
    ...p, pago_material: material, valor_material: valorMaterial(material),
    cobrado_caja: cobradoNuevo, caja_mov_id: cajaMovId,
    pagado_monto: r2((esInter ? valorMaterial(material) : 0) + cobradoNuevo),
    estado,
    historial: [...(v.historial ?? []), evento('editada', actor, actorName, { cambios, motivo: m })],
    updated_at: ahora(),
  }).eq('id', v.id).select('*').single();
  if (error) throw error;
  return data as Venta;
}

/* ───────────── Cobrar (contado o diferencia de intercambio) ───────────── */

/**
 * El dinero ENTRA a la caja elegida y recién ahí la venta queda pagada. En un
 * intercambio se cobra solo la diferencia que el material no cubrió. Las ventas
 * a crédito se cobran en Tesorería, contra su cuenta por cobrar.
 */
export async function marcarPagada(input: {
  venta: Venta;
  metodo: string;
  monto: number;
  cajaId: string;
  cuentaCaja?: CuentaCaja | null;
  actor: string;
  actorName?: string | null;
}): Promise<void> {
  const v = input.venta;
  if (v.estado !== 'emitida') throw new Error('Solo se cobran ventas emitidas.');
  if (esVentaACredito(v)) throw new Error('Esta venta es a crédito: se cobra en Tesorería → Cuentas por cobrar.');
  const falta = saldoPorCobrar(v);
  const monto = r2(input.monto || falta);
  if (!input.cajaId) throw new Error('Elegí la caja donde entra el dinero.');
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');

  // Primero la caja: si el ingreso falla, la venta NO queda como cobrada.
  const mov = await registrarIngresoCaja({
    cajaId: input.cajaId, monto, moneda: v.moneda || 'USD',
    cuenta: input.cuentaCaja ?? null, categoria: 'venta',
    concepto: `Cobro ${nombreDocumento(v.tipo_documento).toLowerCase()} ${v.numero}${v.cliente_nombre ? ` · ${v.cliente_nombre}` : ''}`,
    actor: input.actor, actorName: input.actorName ?? null,
  });

  const cobrado = r2(cobradoEnCaja(v) + monto);
  const { error } = await supabase.from('ventas').update({
    estado: 'pagada', metodo_pago: input.metodo?.trim() || null,
    cobrado_caja: cobrado, pagado_monto: r2((Number(v.valor_material) || 0) + cobrado),
    caja_id: input.cajaId, cuenta_caja: input.cuentaCaja ?? null, caja_mov_id: mov.id,
    historial: [...(v.historial ?? []), evento('cobrada', input.actor, input.actorName, {
      detalle: `${monto} ${v.moneda} en caja · ${input.metodo || 'sin método'}`,
    })],
    updated_at: ahora(),
  }).eq('id', v.id);
  if (error) throw error;
}

/**
 * Pone al día las ventas a crédito contra su cuenta por cobrar: la que ya se
 * cobró entera (en dinero o en material, desde Tesorería) pasa a «pagada».
 */
export async function sincronizarCredito(ventas: Venta[]): Promise<Map<string, CuentaPorCobrar>> {
  const aCredito = ventas.filter((v) => v.cxc_id && (v.estado === 'emitida' || v.estado === 'pagada'));
  if (!aCredito.length) return new Map();
  const cuentas = await cuentasCobrarPorIds(aCredito.map((v) => v.cxc_id!));

  const saldadas = aCredito.filter((v) => {
    const c = cuentas.get(v.cxc_id!);
    return v.estado === 'emitida' && c && c.estado === 'saldada' && Number(c.monto) > 0;
  });
  await Promise.all(saldadas.map(async (v) => {
    const c = cuentas.get(v.cxc_id!)!;
    await supabase.from('ventas').update({
      estado: 'pagada', pagado_monto: r2(Number(c.abonado) || Number(v.total)),
      updated_at: ahora(),
    }).eq('id', v.id).eq('estado', 'emitida');
  }));
  return cuentas;
}

/* ───────────── Anular ───────────── */

/** Lo que va a pasar al anular (para mostrarlo antes de confirmar). */
export function efectosAnulacion(v: Venta): string[] {
  if (!yaEmitida(v)) return ['Todavía no se emitió: no movió inventario ni dinero. Solo queda anulada, con el motivo.'];
  const out: string[] = [];
  const items = (v.items ?? []).filter((i) => i.producto_id && Number(i.cantidad) > 0);
  if (items.length) out.push(`Vuelven al inventario: ${items.map((i) => `${r2(i.cantidad)} ${i.unidad ?? ''} ${i.producto_nombre} (${i.almacen})`.replace(/\s+/g, ' ')).join(', ')}.`);
  const mat = (v.pago_material ?? []).filter((p) => p.producto_id && Number(p.cantidad) > 0);
  if (mat.length) out.push(`Sale del inventario el material recibido: ${mat.map((p) => `${r2(p.cantidad)} ${p.producto_nombre} (${p.almacen})`).join(', ')}.`);
  const caja = cobradoEnCaja(v);
  if (caja > 0) out.push(`Se devuelve ${caja} ${v.moneda} desde la caja donde se cobró (queda como egreso en el Libro Mayor).`);
  if (v.cxc_id) out.push('Se cierra la cuenta por cobrar de esta venta (solo si no tiene abonos).');
  return out;
}

/** Anula la venta con motivo obligatorio y revierte todo lo que movió. */
export async function anularVenta(v: Venta, actor: string, actorName?: string | null, motivo?: string | null): Promise<void> {
  if (v.estado === 'anulada') throw new Error('La venta ya está anulada.');
  const m = exigirMotivo(motivo, 'anular');
  const movio = yaEmitida(v);
  const doc = `${nombreDocumento(v.tipo_documento)} ${v.numero}`;
  const mat = (v.pago_material ?? []).filter((p) => p.producto_id && Number(p.cantidad) > 0);

  // 1) Validaciones: el material recibido tiene que seguir en el inventario.
  if (movio && mat.length) {
    await validarStock(mat.map((p) => ({ producto_id: p.producto_id!, almacen: p.almacen, producto_nombre: p.producto_nombre, cantidad: p.cantidad })));
  }

  // 2) Dinero primero: si no se puede cerrar la deuda o devolver la caja, no se toca el stock.
  if (v.cxc_id) await anularCuentaCobrarDocumento(v.cxc_id, `${doc} anulada: ${m}`);
  const caja = cobradoEnCaja(v);
  if (movio && caja > 0 && v.caja_id) {
    await registrarGasto({
      cajaId: v.caja_id, monto: caja, moneda: v.moneda || 'USD', cuenta: (v.cuenta_caja as CuentaCaja) ?? null,
      categoria: 'venta_anulada', concepto: `Devolución por anulación ${doc}: ${m}`,
      actor, actorName: actorName ?? null,
    });
  }

  // 3) Inventario.
  if (movio) {
    for (const it of (v.items ?? []).filter((i) => i.producto_id && Number(i.cantidad) > 0)) {
      await reingresoVendido(v, { producto_id: it.producto_id!, almacen: it.almacen, cantidad: Number(it.cantidad), costo_unit: it.costo_unit }, actor, actorName, `Reversa ${doc}: ${m}`);
    }
    for (const p of mat) {
      await salidaMaterial(v, { producto_id: p.producto_id!, almacen: p.almacen }, Number(p.cantidad), actor, actorName, `Reversa pago en material ${doc}: ${m}`);
    }
  }

  const { error } = await supabase.from('ventas').update({
    estado: 'anulada', anulada_en: ahora(), anulada_por: actor, motivo_anulacion: m,
    historial: [...(v.historial ?? []), evento('anulada', actor, actorName, { motivo: m, detalle: efectosAnulacion(v).join(' ') })],
    updated_at: ahora(),
  }).eq('id', v.id);
  if (error) throw error;
}

/** Elimina una venta en borrador (nunca movió nada). */
export async function eliminarVenta(id: string): Promise<void> {
  const { error } = await supabase.from('ventas').delete().eq('id', id).eq('estado', 'borrador');
  if (error) throw error;
}

/* ───────────── KPIs ───────────── */

export interface ResumenVentas {
  totalVendido: number;    // total vendido (emitida + pagada)
  aCredito: number;        // total de las ventas a crédito vivas
  ganancia: number;
  gananciaPct: number;
  costo: number;
  facturas: number;        // documentos emitidos + pagados
  porCobrar: number;       // lo que falta cobrar de las emitidas
  cobrado: number;         // total de las pagadas
  impuestos: number;       // IVA + IGTF de las vivas
  materialRecibido: number; // valor del material recibido en intercambios
}

export function resumenVentas(ventas: Venta[]): ResumenVentas {
  const vivas = ventas.filter((v) => v.estado === 'emitida' || v.estado === 'pagada');
  const suma = (arr: Venta[], f: (v: Venta) => number) => r2(arr.reduce((a, v) => a + (f(v) || 0), 0));
  const totalVendido = suma(vivas, (v) => Number(v.total));
  const costo = suma(vivas, (v) => Number(v.costo_total));
  const ganancia = suma(vivas, (v) => Number(v.ganancia));
  const emitidas = vivas.filter((v) => v.estado === 'emitida');
  const porCobrar = suma(emitidas, (v) => (esVentaACredito(v) ? Number(v.total) : porCobrarEnDinero(v) - cobradoEnCaja(v)));
  const cobrado = suma(vivas.filter((v) => v.estado === 'pagada'), (v) => Number(v.total));
  const aCredito = suma(vivas.filter(esVentaACredito), (v) => Number(v.total));
  const impuestos = suma(vivas, (v) => Number(v.iva_monto) + Number(v.igtf_monto));
  const materialRecibido = suma(vivas.filter(esIntercambio), (v) => Number(v.valor_material));
  const base = r2(vivas.reduce((a, v) => a + (Number(v.subtotal) || 0) - (Number(v.descuento) || 0), 0));
  return {
    totalVendido, ganancia, costo, facturas: vivas.length, porCobrar, cobrado, aCredito, impuestos, materialRecibido,
    gananciaPct: base > 0 ? r2((ganancia / base) * 100) : 0,
  };
}
