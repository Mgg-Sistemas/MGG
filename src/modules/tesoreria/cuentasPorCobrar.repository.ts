/* ============================================================
   MGG · Tesorería · Cuentas por cobrar
   Si a un cliente/proveedor se le PAGA de más, el excedente queda como
   deuda del cliente hacia la empresa (cuenta por cobrar). Es incremental por
   (tipo + contraparte + moneda) y se salda con abonos = ingresos reales a caja.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarIngresoCaja } from './tesoreria.repository';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { createProducto, findBySku } from '@/modules/inventario/inventario.repository';
import type { CuentaCaja } from '@/shared/lib/types';

// 'centro_acopio' = cuenta por cobrar generada por un traspaso de dinero a un centro de costo.
export type TipoCxC = 'cliente' | 'proveedor' | 'centro_acopio';
export type EstadoCxC = 'abierta' | 'saldada';

/** Etiqueta legible del tipo de contraparte de una cuenta por cobrar. */
export function labelTipoCxC(t: TipoCxC): string {
  return t === 'proveedor' ? 'Proveedor' : t === 'centro_acopio' ? 'Centro de costo' : 'Cliente';
}

export interface CuentaPorCobrar {
  id: string;
  tipo: TipoCxC;
  contraparte: string;
  monto: number;        // total que nos deben (acumula)
  abonado: number;      // lo que ya nos pagaron de vuelta
  moneda: string;
  estado: EstadoCxC;
  origen?: string | null;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface AbonoCxC {
  id: string;
  cuenta_id: string;
  monto: number;
  moneda: string;
  caja_id?: string | null;
  cuenta?: string | null;
  caja_mov_id?: string | null;
  saldo_restante?: number | null;
  /** 'dinero' = entró a caja · 'producto' = entró al inventario (intercambio dinero↔producto). */
  tipo_abono?: 'dinero' | 'producto';
  producto_id?: string | null;
  producto_nombre?: string | null;
  cantidad?: number | null;
  unidad?: string | null;
  costo_unit?: number | null;
  almacen?: string | null;
  inv_mov_id?: string | null;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  at: string;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const CXC = 'cuentas_por_cobrar';
const CXC_ABONOS = 'cuentas_por_cobrar_abonos';

/**
 * Registra una deuda del cliente hacia la empresa (cuenta por cobrar). Si ya hay una
 * ABIERTA del mismo (tipo + contraparte + moneda), SUMA al monto (incremental); si no,
 * la crea. La usa el sobrepago de una cuenta por pagar.
 */
export async function registrarSobrepagoCobrar(input: {
  tipo: TipoCxC;
  contraparte: string;
  monto: number;
  moneda: string;
  origen?: string | null;
  nota?: string | null;
  actor?: string | null;
  actorName?: string | null;
}): Promise<CuentaPorCobrar> {
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const contraparte = input.contraparte.trim();
  if (!contraparte) throw new Error('Indicá el cliente o proveedor.');

  const { data: abiertas } = await supabase.from(CXC).select('*')
    .eq('tipo', input.tipo).eq('moneda', input.moneda).eq('estado', 'abierta');
  const existente = (abiertas ?? []).find(
    (c) => (c as CuentaPorCobrar).contraparte.trim().toLowerCase() === contraparte.toLowerCase(),
  ) as CuentaPorCobrar | undefined;

  if (existente) {
    const nuevoMonto = round2(Number(existente.monto) + monto);
    const { data, error } = await supabase.from(CXC)
      .update({ monto: nuevoMonto, updated_at: new Date().toISOString() })
      .eq('id', existente.id).select('*').single();
    if (error) throw error;
    return data as CuentaPorCobrar;
  }
  const { data, error } = await supabase.from(CXC).insert({
    tipo: input.tipo, contraparte, monto, abonado: 0, moneda: input.moneda,
    estado: 'abierta', origen: input.origen ?? null, nota: input.nota?.trim() || null,
    actor: input.actor ?? null, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as CuentaPorCobrar;
}

/**
 * Alta MANUAL de una cuenta por cobrar (no por sobrepago). Mismo motor que
 * `registrarSobrepagoCobrar`: si ya hay una ABIERTA del mismo (tipo + contraparte
 * + moneda) suma; si no, la crea. La salda luego el cobro/abono (entra a caja).
 */
export async function crearCuentaPorCobrar(input: {
  tipo: TipoCxC;
  contraparte: string;
  monto: number;
  moneda: string;
  nota?: string | null;
  actor?: string | null;
  actorName?: string | null;
}): Promise<CuentaPorCobrar> {
  return registrarSobrepagoCobrar({ ...input, origen: 'manual' });
}

/**
 * Cuenta por cobrar generada por un TRASPASO de dinero a un centro de costo: el centro
 * debe rendir lo entregado. Incremental por (centro_acopio + centro + moneda): cada
 * traspaso SUMA al saldo. Se salda con dinero o con producto al cambio.
 */
export async function registrarCobrarPorTraspaso(input: {
  centro: string;
  monto: number;
  moneda: string;
  nota?: string | null;
  actor?: string | null;
  actorName?: string | null;
}): Promise<CuentaPorCobrar> {
  return registrarSobrepagoCobrar({
    tipo: 'centro_acopio', contraparte: input.centro, monto: input.monto, moneda: input.moneda,
    origen: 'traspaso', nota: input.nota ?? null, actor: input.actor ?? null, actorName: input.actorName ?? null,
  });
}

export async function listCuentasPorCobrar(soloAbiertas = true): Promise<CuentaPorCobrar[]> {
  let q = supabase.from(CXC).select('*').order('created_at', { ascending: false });
  if (soloAbiertas) q = q.eq('estado', 'abierta');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CuentaPorCobrar[];
}

export async function listAbonosCobrar(cuentaId: string): Promise<AbonoCxC[]> {
  const { data, error } = await supabase.from(CXC_ABONOS).select('*').eq('cuenta_id', cuentaId).order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AbonoCxC[];
}

/**
 * Registra un abono a una cuenta por cobrar: el cliente nos DEVUELVE dinero, así que
 * ENTRA a la caja elegida (en la misma moneda) y baja el saldo por cobrar. Al saldar,
 * estado='saldada'.
 */
export async function registrarAbonoCobrar(input: {
  cuenta: CuentaPorCobrar;
  cajaId: string;
  cuentaCaja: CuentaCaja;
  monto: number;
  nota?: string | null;
  actor: string;
  actorName?: string | null;
}): Promise<{ cuenta: CuentaPorCobrar; abono: AbonoCxC }> {
  const c = input.cuenta;
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error('El abono debe ser mayor que 0.');

  // 1) Reserva ATÓMICA del abono: bloquea la cuenta (FOR UPDATE) y revalida el saldo
  //    contra el valor real en la base, no el que traía el front. Dos abonos a la vez
  //    ya no se pisan (doble-abono). Cobrar no admite sobrepago → rechaza si excede.
  const { data: res, error: apErr } = await supabase.rpc('cuenta_aplicar_abono', {
    p_tabla: 'cuentas_por_cobrar', p_cuenta_id: c.id, p_monto: monto, p_cap: false,
  });
  if (apErr) throw apErr;
  const aplic = res as { abonado: number; estado: EstadoCxC; saldo_restante: number };

  // 2) Entra a la caja (ingreso real, atómico). Si falla, se revierte la reserva.
  let mov;
  try {
    mov = await registrarIngresoCaja({
      cajaId: input.cajaId, monto, moneda: c.moneda, cuenta: input.cuentaCaja,
      concepto: `Cobro cuenta por cobrar · ${labelTipoCxC(c.tipo)}: ${c.contraparte}`,
      categoria: 'cobro_cxc', actor: input.actor, actorName: input.actorName,
    });
  } catch (e) {
    await supabase.rpc('cuenta_aplicar_abono', { p_tabla: 'cuentas_por_cobrar', p_cuenta_id: c.id, p_monto: -monto, p_cap: false });
    throw e;
  }

  // 3) Registro del abono + saldo restante (que devolvió la reserva).
  const { data: ab, error: abErr } = await supabase.from(CXC_ABONOS).insert({
    cuenta_id: c.id, monto, moneda: c.moneda, caja_id: input.cajaId, cuenta: input.cuentaCaja,
    caja_mov_id: mov.id, saldo_restante: aplic.saldo_restante, nota: input.nota?.trim() || null,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (abErr) throw abErr;

  const cuenta: CuentaPorCobrar = { ...c, abonado: aplic.abonado, estado: aplic.estado, updated_at: new Date().toISOString() };
  return { cuenta, abono: ab as AbonoCxC };
}

/** SKU autogenerado para un producto recibido como abono (intercambio). */
function nuevoSkuAbono(nombre: string): string {
  const base = nombre.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16);
  const suf = Math.floor(performance.now() % 100000).toString(36).toUpperCase();
  return `MIN-${base || 'PROD'}-${suf}`;
}

/**
 * Abono EN PRODUCTO (intercambio dinero↔producto): la contraparte salda su deuda
 * entregando producto. El producto ENTRA al inventario (suma stock + PMP) y su
 * valor al cambio ($ en la moneda de la cuenta) abona la cuenta por cobrar. NO
 * entra dinero a caja. Ej.: GT debe $1000 y entrega 500 TON de casiterita = $1000 → saldada.
 */
export async function registrarAbonoCobrarProducto(input: {
  cuenta: CuentaPorCobrar;
  /** Producto existente; si es null se crea uno nuevo con `productoNuevo`. */
  productoId: string | null;
  productoNuevo?: { nombre: string; unidad: string } | null;
  almacen: string;
  cantidad: number;
  /** Valor total ($ en la moneda de la cuenta) que equivale el producto recibido — es lo que abona. */
  valor: number;
  nota?: string | null;
  actor: string;
  actorName?: string | null;
}): Promise<{ cuenta: CuentaPorCobrar; abono: AbonoCxC }> {
  const c = input.cuenta;
  const cantidad = round2(input.cantidad);
  const valor = round2(input.valor);
  if (cantidad <= 0) throw new Error('La cantidad de producto debe ser mayor que 0.');
  if (valor <= 0) throw new Error('El valor del producto (al cambio) debe ser mayor que 0.');
  const costoUnit = round2(valor / cantidad);

  // 0) Reserva ATÓMICA del abono: bloquea la cuenta (FOR UPDATE) y revalida el saldo real
  //    en la base. Producto cobrar no admite sobrepago. Si el inventario falla después, se
  //    revierte con monto negativo (compensación).
  const { data: res, error: apErr } = await supabase.rpc('cuenta_aplicar_abono', {
    p_tabla: 'cuentas_por_cobrar', p_cuenta_id: c.id, p_monto: valor, p_cap: false,
  });
  if (apErr) throw apErr;
  const aplic = res as { abonado: number; estado: EstadoCxC; saldo_restante: number };

  let mov;
  let productoId = input.productoId;
  let productoNombre = '';
  let unidad = input.productoNuevo?.unidad ?? null;
  try {
    // 1) Resolver el producto (existente o nuevo).
    if (!productoId) {
      if (!input.productoNuevo?.nombre.trim()) throw new Error('Indicá el producto recibido.');
      const nombre = input.productoNuevo.nombre.trim().toUpperCase();
      const sku = nuevoSkuAbono(nombre);
      if (await findBySku(sku)) throw new Error(`Ya existe un producto con el SKU ${sku}.`);
      const prod = await createProducto({
        sku, nombre, categoria: 'MINERALES', unidad: (input.productoNuevo.unidad || 'KG'),
        stock: 0, stock_min: 0, precio: costoUnit, almacen: input.almacen, estado: 'activo',
      });
      productoId = prod.id; productoNombre = prod.nombre; unidad = prod.unidad ?? unidad;
    } else {
      const { data } = await supabase.from('productos').select('nombre, unidad').eq('id', productoId).maybeSingle();
      productoNombre = (data?.nombre as string) ?? '';
      unidad = (data?.unidad as string) ?? unidad;
    }

    // 2) Entrada al inventario (suma stock + recalcula PMP del almacén).
    mov = await registrarMovimiento({
      producto_id: productoId, tipo: 'entrada', delta: cantidad, almacen: input.almacen,
      actor: input.actor, actor_name: input.actorName ?? null,
      ref_tipo: 'abono_cxc_producto', ref_id: c.id,
      detalle: `Abono en producto (cuenta por cobrar) · ${labelTipoCxC(c.tipo)}: ${c.contraparte}`,
      precio_unitario: costoUnit,
    });
  } catch (e) {
    await supabase.rpc('cuenta_aplicar_abono', { p_tabla: 'cuentas_por_cobrar', p_cuenta_id: c.id, p_monto: -valor, p_cap: false });
    throw e;
  }

  // 3) Registro del abono (producto) + saldo restante (que devolvió la reserva).
  const { data: ab, error: abErr } = await supabase.from(CXC_ABONOS).insert({
    cuenta_id: c.id, monto: valor, moneda: c.moneda, tipo_abono: 'producto',
    producto_id: productoId, producto_nombre: productoNombre || null, cantidad, unidad,
    costo_unit: costoUnit, almacen: input.almacen, inv_mov_id: mov.id,
    saldo_restante: aplic.saldo_restante, nota: input.nota?.trim() || null,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (abErr) throw abErr;

  const cuenta: CuentaPorCobrar = { ...c, abonado: aplic.abonado, estado: aplic.estado, updated_at: new Date().toISOString() };
  return { cuenta, abono: ab as AbonoCxC };
}
