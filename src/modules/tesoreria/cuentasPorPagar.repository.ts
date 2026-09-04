/* ============================================================
   MGG · Tesorería · Cuentas por pagar (manuales)
   Un ingreso manual de dinero a caja marcado como Cliente o
   Proveedor genera una cuenta por pagar por el mismo monto, que
   se salda con abonos (egresos de caja). Independiente de los
   créditos de compras (OC), se muestra junto a ellos.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarGasto } from './tesoreria.repository';
import { registrarSobrepagoCobrar } from './cuentasPorCobrar.repository';
import type { CuentaCaja } from '@/shared/lib/types';

export type TipoCxP = 'cliente' | 'proveedor';
export type EstadoCxP = 'abierta' | 'saldada';

export interface CuentaPorPagar {
  id: string;
  tipo: TipoCxP;
  contraparte: string;
  monto: number;
  abonado: number;
  moneda: string;
  cuenta?: string | null;
  caja_id?: string | null;
  caja_mov_id?: string | null;
  estado: EstadoCxP;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface AbonoCxP {
  id: string;
  cuenta_id: string;
  monto: number;
  moneda: string;
  caja_id?: string | null;
  cuenta?: string | null;
  caja_mov_id?: string | null;
  saldo_restante?: number | null;
  nota?: string | null;
  comision_monto?: number | null;
  comision_moneda?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  at: string;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const CXP = 'cuentas_por_pagar';
const CXP_ABONOS = 'cuentas_por_pagar_abonos';
const CXP_INGRESOS = 'cuentas_por_pagar_ingresos';

/** Un ingreso (lote) de dinero que entró a una cuenta por pagar, con su fecha. */
export interface IngresoCxP {
  id: string;
  cuenta_id: string;
  monto: number;
  moneda: string;
  caja_id?: string | null;
  cuenta?: string | null;
  caja_mov_id?: string | null;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  at: string;
}

/**
 * Registra un INGRESO de dinero de un cliente/proveedor como cuenta por pagar.
 * Si ya existe una cuenta ABIERTA del mismo (tipo + contraparte + moneda), SUMA el
 * monto a esa cuenta (incremental) y guarda el ingreso con su fecha. Si no existe,
 * la crea. Así un mismo cliente es UNA sola cuenta que acumula, no varias.
 */
export async function registrarIngresoCxP(input: {
  tipo: TipoCxP;
  contraparte: string;
  monto: number;
  moneda: string;
  cuenta?: string | null;
  cajaId?: string | null;
  cajaMovId?: string | null;
  nota?: string | null;
  actor?: string | null;
  actorName?: string | null;
}): Promise<CuentaPorPagar> {
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const contraparte = input.contraparte.trim();
  if (!contraparte) throw new Error('Indicá el cliente o proveedor.');

  // ¿Hay una cuenta ABIERTA del mismo tipo + contraparte (sin distinguir mayúsculas) + moneda?
  const { data: abiertas } = await supabase.from(CXP).select('*')
    .eq('tipo', input.tipo).eq('moneda', input.moneda).eq('estado', 'abierta');
  const existente = (abiertas ?? []).find(
    (c) => (c as CuentaPorPagar).contraparte.trim().toLowerCase() === contraparte.toLowerCase(),
  ) as CuentaPorPagar | undefined;

  let cuenta: CuentaPorPagar;
  if (existente) {
    const nuevoMonto = round2(Number(existente.monto) + monto);
    const { data, error } = await supabase.from(CXP)
      .update({ monto: nuevoMonto, updated_at: new Date().toISOString() })
      .eq('id', existente.id).select('*').single();
    if (error) throw error;
    cuenta = data as CuentaPorPagar;
  } else {
    const { data, error } = await supabase.from(CXP).insert({
      tipo: input.tipo, contraparte, monto, abonado: 0,
      moneda: input.moneda, cuenta: input.cuenta ?? null, caja_id: input.cajaId ?? null,
      caja_mov_id: input.cajaMovId ?? null, estado: 'abierta', nota: input.nota?.trim() || null,
      actor: input.actor ?? null, actor_name: input.actorName ?? null,
    }).select('*').single();
    if (error) throw error;
    cuenta = data as CuentaPorPagar;
  }

  // Traza del ingreso (fecha + monto) para el detalle y el PDF.
  const { error: iErr } = await supabase.from(CXP_INGRESOS).insert({
    cuenta_id: cuenta.id, monto, moneda: input.moneda, caja_id: input.cajaId ?? null,
    cuenta: input.cuenta ?? null, caja_mov_id: input.cajaMovId ?? null,
    nota: input.nota?.trim() || null, actor: input.actor ?? null, actor_name: input.actorName ?? null,
  });
  if (iErr) throw iErr;
  return cuenta;
}

/**
 * Crea una Cuenta por Pagar como DEUDA PURA (sin ingreso de dinero a caja): la usa,
 * p. ej., un servicio directo "con abonos" (a crédito). Si ya hay una cuenta ABIERTA
 * del mismo tipo+contraparte+moneda, SUMA a esa (incremental). No registra ingreso ni
 * mueve caja; solo crea/incrementa la deuda que después se salda con abonos.
 */
export async function crearCuentaPorPagarDeuda(input: {
  tipo: TipoCxP;
  contraparte: string;
  monto: number;
  moneda: string;
  nota?: string | null;
  actor?: string | null;
  actorName?: string | null;
}): Promise<CuentaPorPagar> {
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const contraparte = input.contraparte.trim();
  if (!contraparte) throw new Error('Indicá el proveedor/contraparte.');

  const { data: abiertas } = await supabase.from(CXP).select('*')
    .eq('tipo', input.tipo).eq('moneda', input.moneda).eq('estado', 'abierta');
  const existente = (abiertas ?? []).find(
    (c) => (c as CuentaPorPagar).contraparte.trim().toLowerCase() === contraparte.toLowerCase(),
  ) as CuentaPorPagar | undefined;

  if (existente) {
    const { data, error } = await supabase.from(CXP)
      .update({ monto: round2(Number(existente.monto) + monto), updated_at: new Date().toISOString() })
      .eq('id', existente.id).select('*').single();
    if (error) throw error;
    return data as CuentaPorPagar;
  }
  const { data, error } = await supabase.from(CXP).insert({
    tipo: input.tipo, contraparte, monto, abonado: 0, moneda: input.moneda,
    estado: 'abierta', nota: input.nota?.trim() || null,
    actor: input.actor ?? null, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as CuentaPorPagar;
}

/** Lista los ingresos (lotes con su fecha) de una cuenta por pagar, del más viejo al más nuevo. */
export async function listIngresosCxP(cuentaId: string): Promise<IngresoCxP[]> {
  const { data, error } = await supabase.from(CXP_INGRESOS).select('*').eq('cuenta_id', cuentaId).order('at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as IngresoCxP[];
}

export async function listCuentasPorPagar(soloAbiertas = true): Promise<CuentaPorPagar[]> {
  let q = supabase.from(CXP).select('*').order('created_at', { ascending: false });
  if (soloAbiertas) q = q.eq('estado', 'abierta');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CuentaPorPagar[];
}

export async function listAbonosCuenta(cuentaId: string): Promise<AbonoCxP[]> {
  const { data, error } = await supabase.from(CXP_ABONOS).select('*').eq('cuenta_id', cuentaId).order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AbonoCxP[];
}

/**
 * Registra un abono a una cuenta por pagar: egreso real de la caja elegida (en
 * la misma moneda de la cuenta) + actualiza lo abonado. Al saldar, estado='saldada'.
 */
export async function registrarAbonoCuenta(input: {
  cuenta: CuentaPorPagar;
  cajaId: string;
  cuentaCaja: CuentaCaja;
  monto: number;
  nota?: string | null;
  /** Comisión bancaria (opcional): egreso EXTRA de la billetera, NO se abona a la deuda.
   *  Ej.: abono 1.500 + comisión 150 → salen 1.650 de la caja; la cuenta baja solo 1.500. */
  comision?: { cuenta: CuentaCaja; moneda: string; monto: number } | null;
  actor: string;
  actorName?: string | null;
}): Promise<{ cuenta: CuentaPorPagar; abono: AbonoCxP }> {
  const c = input.cuenta;
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error('El abono debe ser mayor que 0.');

  // 1) Reserva ATÓMICA del abono: bloquea la cuenta (FOR UPDATE) y revalida el saldo real
  //    en la base (no el que traía el front) → dos abonos a la vez no se pisan. Pagar admite
  //    sobrepago: topa lo aplicado al saldo y devuelve el excedente (→ cuenta por cobrar).
  const { data: resAb, error: apErr } = await supabase.rpc('cuenta_aplicar_abono', {
    p_tabla: 'cuentas_por_pagar', p_cuenta_id: c.id, p_monto: monto, p_cap: true,
  });
  if (apErr) throw apErr;
  const aplic = resAb as { aplicado: number; excedente: number; abonado: number; estado: EstadoCxP; saldo_restante: number };
  const aplicado = aplic.aplicado;
  const excedente = aplic.excedente;

  // 2) Egreso real de la caja por el monto pagado (atómico). Si falla, se revierte la reserva.
  let mov;
  try {
    mov = await registrarGasto({
      cajaId: input.cajaId, monto, moneda: c.moneda, cuenta: input.cuentaCaja,
      concepto: `Abono cuenta por pagar · ${c.tipo === 'proveedor' ? 'Proveedor' : 'Cliente'}: ${c.contraparte}`
        + (excedente > 0 ? ` (sobrepago ${excedente} ${c.moneda} → cuenta por cobrar)` : ''),
      categoria: 'abono_cxp', actor: input.actor, actorName: input.actorName,
    });
  } catch (e) {
    await supabase.rpc('cuenta_aplicar_abono', { p_tabla: 'cuentas_por_pagar', p_cuenta_id: c.id, p_monto: -aplicado, p_cap: true });
    throw e;
  }

  // 1b) Comisión bancaria (opcional): egreso EXTRA aparte, no suma a la deuda.
  const comMonto = input.comision ? Math.round((Number(input.comision.monto) || 0) * 100) / 100 : 0;
  if (input.comision && comMonto > 0) {
    await registrarGasto({
      cajaId: input.cajaId, monto: comMonto, moneda: input.comision.moneda, cuenta: input.comision.cuenta,
      concepto: `Comisión bancaria · abono a ${c.tipo === 'proveedor' ? 'proveedor' : 'cliente'} ${c.contraparte}`,
      categoria: 'comision_bancaria', actor: input.actor, actorName: input.actorName,
    });
  }

  // 2) Registro del abono que salda la deuda (lo aplicado, no el excedente).
  const { data: ab, error: abErr } = await supabase.from(CXP_ABONOS).insert({
    cuenta_id: c.id, monto: aplicado, moneda: c.moneda, caja_id: input.cajaId, cuenta: input.cuentaCaja,
    caja_mov_id: mov.id, saldo_restante: aplic.saldo_restante,
    nota: (input.nota?.trim() || '') + (excedente > 0 ? `${input.nota?.trim() ? ' · ' : ''}Sobrepago ${excedente} ${c.moneda} → cuenta por cobrar` : '') || null,
    comision_monto: comMonto > 0 ? comMonto : null,
    comision_moneda: comMonto > 0 ? (input.comision?.moneda ?? null) : null,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (abErr) throw abErr;

  // 3) La cuenta ya quedó actualizada (abonado + estado) dentro de la reserva atómica.
  const cuenta: CuentaPorPagar = { ...c, abonado: aplic.abonado, estado: aplic.estado, updated_at: new Date().toISOString() };

  // 4) Excedente → cuenta por cobrar del mismo cliente/proveedor (incremental).
  if (excedente > 0) {
    await registrarSobrepagoCobrar({
      tipo: c.tipo, contraparte: c.contraparte, monto: excedente, moneda: c.moneda,
      origen: 'sobrepago_cxp', nota: `Sobrepago al pagar a ${c.contraparte}`,
      actor: input.actor, actorName: input.actorName,
    });
  }

  return { cuenta, abono: ab as AbonoCxP };
}
