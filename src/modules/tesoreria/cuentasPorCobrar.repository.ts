/* ============================================================
   MGG · Tesorería · Cuentas por cobrar
   Si a un cliente/proveedor se le PAGA de más, el excedente queda como
   deuda del cliente hacia la empresa (cuenta por cobrar). Es incremental por
   (tipo + contraparte + moneda) y se salda con abonos = ingresos reales a caja.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarIngresoCaja } from './tesoreria.repository';
import type { CuentaCaja } from '@/shared/lib/types';

export type TipoCxC = 'cliente' | 'proveedor';
export type EstadoCxC = 'abierta' | 'saldada';

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
  const saldoPrev = round2(c.monto - (Number(c.abonado) || 0));
  if (monto > saldoPrev + 0.01) throw new Error(`El abono (${monto}) supera el saldo por cobrar (${saldoPrev} ${c.moneda}).`);

  // 1) Entra a la caja (ingreso real, misma moneda de la cuenta por cobrar).
  const mov = await registrarIngresoCaja({
    cajaId: input.cajaId, monto, moneda: c.moneda, cuenta: input.cuentaCaja,
    concepto: `Cobro cuenta por cobrar · ${c.tipo === 'proveedor' ? 'Proveedor' : 'Cliente'}: ${c.contraparte}`,
    categoria: 'cobro_cxc', actor: input.actor, actorName: input.actorName,
  });

  // 2) Registro del abono + saldo restante.
  const saldoRestante = round2(saldoPrev - monto);
  const { data: ab, error: abErr } = await supabase.from(CXC_ABONOS).insert({
    cuenta_id: c.id, monto, moneda: c.moneda, caja_id: input.cajaId, cuenta: input.cuentaCaja,
    caja_mov_id: mov.id, saldo_restante: saldoRestante, nota: input.nota?.trim() || null,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (abErr) throw abErr;

  // 3) Actualiza la cuenta (abonado + estado).
  const nuevoAbonado = round2((Number(c.abonado) || 0) + monto);
  const estado: EstadoCxC = nuevoAbonado >= c.monto - 0.01 ? 'saldada' : 'abierta';
  const { data: cu, error: cuErr } = await supabase.from(CXC)
    .update({ abonado: nuevoAbonado, estado, updated_at: new Date().toISOString() })
    .eq('id', c.id).select('*').single();
  if (cuErr) throw cuErr;

  return { cuenta: cu as CuentaPorCobrar, abono: ab as AbonoCxC };
}
