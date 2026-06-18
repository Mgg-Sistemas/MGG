/* ============================================================
   MGG · Tesorería (Supabase)
   Maneja el flujo de dinero sobre las mismas cajas/movimientos_caja
   del módulo Salidas (una sola fuente). Agrega: gastos (etiquetados
   por moneda), pago a personal (multipagos), pago de OC, libro mayor,
   disponibilidad financiera (USD + equivalente Bs) y retenciones.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Caja, MovimientoCaja, Retencion, TipoRetencion, CuentaCaja } from '@/shared/lib/types';
import { getTasaHoy, round2 } from './tasas.repository';

const TABLE = 'cajas';
const LIBRO = 'movimientos_caja';
const SALDOS = 'caja_saldos';

// Reutilizamos la infraestructura de cajas ya existente del módulo Salidas.
export {
  listCajas, listCajasActivas, listCentrosAcopio, crearCaja, renombrarCaja,
  deshabilitarCaja, habilitarCaja, ajustarSaldo, ingresarDinero, trasladoDinero, listMovimientosCaja,
} from '@/modules/salidas/cajas.repository';

async function getCaja(id: string): Promise<Caja> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Caja no encontrada');
  return data as Caja;
}

/* ───────────── Gasto (egreso simple, etiquetado por moneda) ───────────── */

export async function registrarGasto(input: {
  cajaId: string; monto: number; concepto: string; categoria?: string;
  cuenta?: CuentaCaja | null; moneda?: string | null;
  gastoCategoria?: string | null; gastoSubcategoria?: string | null;
  gastoCorrelativo?: number | null;
  actor: string; actorName?: string | null;
}): Promise<MovimientoCaja> {
  const monto = round2(Number(input.monto) || 0);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  if (!input.concepto.trim()) throw new Error('Indicá el concepto del gasto.');
  const caja = await getCaja(input.cajaId);

  // Si la caja maneja saldos multimoneda (caja_saldos), se descuenta del saldo
  // elegido (cuenta+moneda); si no, del saldo legado de la caja.
  const monedaPago = (input.moneda ?? caja.moneda) as string;
  const cuentaSel: CuentaCaja = (input.cuenta ?? 'general') as CuentaCaja;
  const { data: saldoRow } = await supabase.from(SALDOS)
    .select('id, saldo').eq('caja_id', input.cajaId).eq('cuenta', cuentaSel).eq('moneda', monedaPago).maybeSingle();
  const usaSaldos = !!saldoRow;
  const saldoAntes = usaSaldos ? (Number(saldoRow!.saldo) || 0) : (Number(caja.saldo) || 0);
  if (monto > saldoAntes)
    throw new Error(`Saldo insuficiente en ${caja.nombre}${cuentaSel !== 'general' ? ` (${cuentaSel})` : ''}. Disponible: ${saldoAntes} ${monedaPago}.`);
  const saldoDespues = round2(saldoAntes - monto);

  const { data, error } = await supabase.from(LIBRO).insert({
    caja_id: input.cajaId, tipo: 'salida', monto, moneda: monedaPago,
    saldo_antes: saldoAntes, saldo_despues: saldoDespues,
    motivo: input.concepto.trim(), categoria: input.categoria ?? 'gasto',
    gasto_categoria: input.gastoCategoria ?? null, gasto_subcategoria: input.gastoSubcategoria ?? null,
    gasto_correlativo: input.gastoCorrelativo ?? null,
    cuenta: usaSaldos ? cuentaSel : null,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;

  if (usaSaldos) {
    const { error: uErr } = await supabase.from(SALDOS).update({ saldo: saldoDespues, updated_at: new Date().toISOString() }).eq('id', saldoRow!.id);
    if (uErr) throw uErr;
  } else {
    const { error: uErr } = await supabase.from(TABLE).update({ saldo: saldoDespues, updated_at: new Date().toISOString() }).eq('id', input.cajaId);
    if (uErr) throw uErr;
  }
  return data as MovimientoCaja;
}

/** Categorías de gasto con numeración correlativa (nombre normalizado, sin tildes). */
export const CATEGORIAS_GASTO_NUMERADAS = ['RECEPCION', 'EXPORTACION'] as const;

/** Normaliza un nombre de categoría para comparar (mayúsculas, sin tildes, trim). */
export function normCategoriaGasto(nombre: string | null | undefined): string {
  return (nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

/** ¿La categoría lleva correlativo numérico (RECEPCION / EXPORTACION)? */
export function categoriaLlevaCorrelativo(nombre: string | null | undefined): boolean {
  return (CATEGORIAS_GASTO_NUMERADAS as readonly string[]).includes(normCategoriaGasto(nombre));
}

/**
 * Próximo correlativo para una categoría numerada: max(gasto_correlativo)+1 sobre los
 * gastos de esa categoría. Devuelve null si todavía no hay ninguno (la primera vez el
 * usuario ingresa el número inicial; de ahí en más se autoincrementa).
 */
export async function proximoCorrelativoGasto(gastoCategoria: string): Promise<number | null> {
  const { data, error } = await supabase.from(LIBRO)
    .select('gasto_correlativo')
    .eq('gasto_categoria', gastoCategoria)
    .not('gasto_correlativo', 'is', null)
    .order('gasto_correlativo', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const max = data?.gasto_correlativo;
  return max == null ? null : Number(max) + 1;
}

/**
 * Crédito (ENTRADA) simple a una caja: suma al saldo de (cuenta+moneda) sin tocar la
 * tasa promedio (no es compra de divisa). Lo usa el cobro de una cuenta por cobrar
 * (el cliente devuelve dinero). Si no existe la fila de saldo, la crea.
 */
export async function registrarIngresoCaja(input: {
  cajaId: string; monto: number; concepto: string; categoria?: string;
  cuenta?: CuentaCaja | null; moneda?: string | null;
  actor: string; actorName?: string | null;
}): Promise<MovimientoCaja> {
  const monto = round2(Number(input.monto) || 0);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  if (!input.concepto.trim()) throw new Error('Indicá el concepto del ingreso.');
  const caja = await getCaja(input.cajaId);
  const monedaPago = (input.moneda ?? caja.moneda) as string;
  const cuentaSel: CuentaCaja = (input.cuenta ?? 'general') as CuentaCaja;

  const { data: saldoRow } = await supabase.from(SALDOS)
    .select('id, saldo').eq('caja_id', input.cajaId).eq('cuenta', cuentaSel).eq('moneda', monedaPago).maybeSingle();
  const saldoAntes = saldoRow ? (Number(saldoRow.saldo) || 0) : 0;
  const saldoDespues = round2(saldoAntes + monto);

  const { data, error } = await supabase.from(LIBRO).insert({
    caja_id: input.cajaId, tipo: 'entrada', monto, moneda: monedaPago,
    saldo_antes: saldoAntes, saldo_despues: saldoDespues,
    motivo: input.concepto.trim(), categoria: input.categoria ?? 'ingreso',
    cuenta: cuentaSel, actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;

  if (saldoRow) {
    const { error: uErr } = await supabase.from(SALDOS).update({ saldo: saldoDespues, updated_at: new Date().toISOString() }).eq('id', saldoRow.id);
    if (uErr) throw uErr;
  } else {
    const { error: iErr } = await supabase.from(SALDOS).insert({
      caja_id: input.cajaId, cuenta: cuentaSel, moneda: monedaPago, saldo: saldoDespues,
      tasa_prom: monedaPago === 'Bs' ? 1 : null, updated_at: new Date().toISOString(),
    });
    if (iErr) throw iErr;
  }
  return data as MovimientoCaja;
}

/* ───────────── Pago a personal (multipagos a usuarios del sistema) ───────────── */

export async function pagarPersonal(input: {
  cajaId: string; concepto: string;
  pagos: Array<{ usuarioId: string; nombre: string; monto: number }>;
  actor: string; actorName?: string | null;
}): Promise<void> {
  const pagos = input.pagos
    .map((p) => ({ ...p, monto: round2(Number(p.monto) || 0) }))
    .filter((p) => p.monto > 0);
  if (!pagos.length) throw new Error('Indicá al menos un pago con monto.');
  const total = round2(pagos.reduce((a, p) => a + p.monto, 0));

  const caja = await getCaja(input.cajaId);
  let saldo = Number(caja.saldo) || 0;
  if (total > saldo) throw new Error(`Saldo insuficiente en ${caja.nombre}. Disponible: ${saldo} ${caja.moneda}.`);

  const filas = pagos.map((p) => {
    const antes = saldo;
    const despues = round2(saldo - p.monto);
    saldo = despues;
    return {
      caja_id: input.cajaId, tipo: 'salida', monto: p.monto, moneda: caja.moneda,
      saldo_antes: antes, saldo_despues: despues,
      motivo: input.concepto.trim() || 'Pago a personal', categoria: 'pago_personal',
      beneficiario: p.nombre, beneficiario_id: p.usuarioId,
      actor: input.actor, actor_name: input.actorName ?? null,
    };
  });

  const { error } = await supabase.from(LIBRO).insert(filas);
  if (error) throw error;
  const { error: uErr } = await supabase.from(TABLE).update({ saldo, updated_at: new Date().toISOString() }).eq('id', input.cajaId);
  if (uErr) throw uErr;
}

/* ───────────── Pago de una orden (puente Compras → Tesorería) ───────────── */

export async function pagarOrden(input: {
  cajaId: string; ordenId: string; monto: number; concepto?: string;
  actor: string; actorName?: string | null;
}): Promise<MovimientoCaja> {
  const monto = round2(Number(input.monto) || 0);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const caja = await getCaja(input.cajaId);
  const saldoAntes = Number(caja.saldo) || 0;
  if (monto > saldoAntes) throw new Error(`Saldo insuficiente en ${caja.nombre}. Disponible: ${saldoAntes} ${caja.moneda}.`);
  const saldoDespues = round2(saldoAntes - monto);

  const { data, error } = await supabase.from(LIBRO).insert({
    caja_id: input.cajaId, tipo: 'salida', monto, moneda: caja.moneda,
    saldo_antes: saldoAntes, saldo_despues: saldoDespues,
    motivo: input.concepto?.trim() || 'Pago de compra', categoria: 'pago_oc',
    ref_orden_id: input.ordenId,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  const { error: uErr } = await supabase.from(TABLE).update({ saldo: saldoDespues, updated_at: new Date().toISOString() }).eq('id', input.cajaId);
  if (uErr) throw uErr;
  return data as MovimientoCaja;
}

/* ───────────── Disponibilidad financiera ───────────── */

export interface Disponibilidad {
  usd: number;        // total en cajas USD (efectivo dólar)
  usdt: number;       // total en cajas USDT (cripto-dólar)
  bs: number;         // total en cajas Bs
  tasaUsd: number | null;
  usdEnBs: number;    // equivalente en Bs de TODOS los dólares (USD + USDT) × tasa
  totalBs: number;    // bs + usdEnBs
  fecha: string | null;
}

export async function disponibilidadFinanciera(): Promise<Disponibilidad> {
  // Multimoneda: se calcula desde caja_saldos (Bs jurídica/personal, USD, USDT, COP).
  // Cada divisa se valora en Bs con su tasa promedio ponderada (costo real).
  // SOLO cajas propias: el dinero trasladado a un sistema externo (p. ej. Peramanal)
  // ya no es disponibilidad de MGG, así que esas cajas (externo=true) se excluyen.
  const { data: internas } = await supabase.from('cajas').select('id').eq('externo', false);
  const ids = (internas ?? []).map((c) => (c as { id: string }).id);
  if (!ids.length) {
    const tasaVacia = await getTasaHoy();
    return { usd: 0, usdt: 0, bs: 0, tasaUsd: tasaVacia.usd, usdEnBs: 0, totalBs: 0, fecha: tasaVacia.fecha };
  }
  const { data, error } = await supabase.from('caja_saldos').select('moneda, saldo, tasa_prom').in('caja_id', ids);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ moneda: string; saldo: number; tasa_prom: number | null }>;
  const equiv = (r: { moneda: string; saldo: number; tasa_prom: number | null }) =>
    r.moneda === 'Bs' ? (Number(r.saldo) || 0) : round2((Number(r.saldo) || 0) * (Number(r.tasa_prom) || 0));
  const esDolar = (m: string) => m === 'USD' || m === 'USDT';
  const bs = round2(rows.filter((r) => r.moneda === 'Bs').reduce((a, r) => a + (Number(r.saldo) || 0), 0));
  // USD y USDT se muestran por separado, pero su equivalente en Bs se agrega junto (dólares).
  const usd = round2(rows.filter((r) => r.moneda === 'USD').reduce((a, r) => a + (Number(r.saldo) || 0), 0));
  const usdt = round2(rows.filter((r) => r.moneda === 'USDT').reduce((a, r) => a + (Number(r.saldo) || 0), 0));
  const usdEnBs = round2(rows.filter((r) => esDolar(r.moneda)).reduce((a, r) => a + equiv(r), 0));
  const totalBs = round2(rows.reduce((a, r) => a + equiv(r), 0));
  const tasa = await getTasaHoy();
  return { usd, usdt, bs, tasaUsd: tasa.usd, usdEnBs, totalBs, fecha: tasa.fecha };
}

/* ───────────── Libro mayor (entradas/salidas con filtros) ───────────── */

export async function listLibroMayor(filtros: {
  cajaId?: string; moneda?: string; tipo?: string; desde?: string; hasta?: string;
  /** Incluir movimientos ya archivados por un cierre de mes (por defecto NO). */
  incluirCerrados?: boolean;
  /** Tope de filas. El Libro Mayor (sumas Debe/Haber) usa un tope alto para no
   *  quedar corto por el límite por defecto de 1000 filas de Supabase. */
  limite?: number;
} = {}): Promise<MovimientoCaja[]> {
  let q = supabase.from(LIBRO).select('*, caja:cajas!movimientos_caja_caja_id_fkey(nombre, moneda)').order('at', { ascending: false });
  if (filtros.cajaId) q = q.eq('caja_id', filtros.cajaId);
  if (filtros.moneda) q = q.eq('moneda', filtros.moneda);
  if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
  if (filtros.desde) q = q.gte('at', `${filtros.desde}T00:00:00`);
  if (filtros.hasta) q = q.lte('at', `${filtros.hasta}T23:59:59`);
  if (!filtros.incluirCerrados) q = q.is('cierre_id', null); // mes cerrado = fuera de la vista actual
  if (filtros.limite) q = q.limit(filtros.limite);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MovimientoCaja[];
}

/* ───────────── Editar / eliminar movimientos (reversión + recálculo) ─────────────
   Un movimiento afecta el saldo de su "partición": (caja, cuenta, moneda) en
   `caja_saldos` si tiene `cuenta`, o el saldo legado de `cajas` si no la tiene.
   La columna SALDO del Libro Mayor se lee de `saldo_despues` (snapshot por fila),
   así que al editar/eliminar hay que (1) revertir/ajustar el saldo vigente y
   (2) recalcular saldo_antes/saldo_despues de toda la cadena visible de esa
   partición, anclando en el saldo vigente corregido (hacia atrás en el tiempo).
   ─────────────────────────────────────────────────────────────────────────── */

type MovChainRow = { id: string; tipo: string; monto: number; saldo_antes: number; saldo_despues: number };

/** Signo del efecto de un movimiento sobre su saldo: +entra · −sale · 0 ajuste. */
function signoMov(tipo: string): number {
  if (tipo === 'entrada' || tipo === 'ingreso' || tipo === 'traslado_entrada') return 1;
  if (tipo === 'salida' || tipo === 'traslado_salida') return -1;
  return 0; // 'ajuste': el efecto es (saldo_despues − saldo_antes), no el monto
}

/** Efecto (con signo) de un movimiento sobre el saldo de su partición. */
function efectoMov(m: { tipo: string; monto: number; saldo_antes?: number | null; saldo_despues?: number | null }): number {
  if (m.tipo === 'ajuste') return round2((Number(m.saldo_despues) || 0) - (Number(m.saldo_antes) || 0));
  return round2(signoMov(m.tipo) * (Number(m.monto) || 0));
}

/** Lee el saldo vigente de la partición (caja_saldos si hay cuenta, si no cajas.saldo). */
async function saldoVigente(cajaId: string, cuenta: string | null, moneda: string): Promise<number> {
  if (cuenta != null) {
    const { data } = await supabase.from(SALDOS).select('saldo').eq('caja_id', cajaId).eq('cuenta', cuenta).eq('moneda', moneda).maybeSingle();
    return Number(data?.saldo) || 0;
  }
  const { data } = await supabase.from(TABLE).select('saldo').eq('id', cajaId).maybeSingle();
  return Number(data?.saldo) || 0;
}

/** Aplica un delta al saldo vigente de la partición. */
async function ajustarSaldoVigente(cajaId: string, cuenta: string | null, moneda: string, delta: number): Promise<void> {
  const now = new Date().toISOString();
  if (cuenta != null) {
    const { data } = await supabase.from(SALDOS).select('id, saldo').eq('caja_id', cajaId).eq('cuenta', cuenta).eq('moneda', moneda).maybeSingle();
    if (data) {
      await supabase.from(SALDOS).update({ saldo: round2((Number(data.saldo) || 0) + delta), updated_at: now }).eq('id', data.id);
    } else {
      await supabase.from(SALDOS).insert({ caja_id: cajaId, cuenta, moneda, saldo: round2(delta), tasa_prom: moneda === 'Bs' ? 1 : null, updated_at: now });
    }
    return;
  }
  const { data } = await supabase.from(TABLE).select('saldo').eq('id', cajaId).maybeSingle();
  await supabase.from(TABLE).update({ saldo: round2((Number(data?.saldo) || 0) + delta), updated_at: now }).eq('id', cajaId);
}

/**
 * Recalcula saldo_antes/saldo_despues de TODA la cadena visible (cierre_id null) de
 * una partición, anclando en el saldo vigente (corregido) y caminando del más nuevo
 * al más viejo. Así la columna SALDO del Libro Mayor queda consistente con el saldo real.
 */
async function recomputarCadena(cajaId: string, cuenta: string | null, moneda: string): Promise<void> {
  const saldoActual = await saldoVigente(cajaId, cuenta, moneda);
  let q = supabase.from(LIBRO).select('id, tipo, monto, saldo_antes, saldo_despues')
    .eq('caja_id', cajaId).eq('moneda', moneda).is('cierre_id', null)
    .order('at', { ascending: false }).order('id', { ascending: false });
  q = cuenta == null ? q.is('cuenta', null) : q.eq('cuenta', cuenta);
  const { data, error } = await q;
  if (error) throw error;
  let running = round2(saldoActual);
  for (const r of (data ?? []) as MovChainRow[]) {
    const after = round2(running);
    const before = round2(running - efectoMov(r));
    if (round2(Number(r.saldo_despues)) !== after || round2(Number(r.saldo_antes)) !== before) {
      await supabase.from(LIBRO).update({ saldo_antes: before, saldo_despues: after }).eq('id', r.id);
    }
    running = before;
  }
}

/** ¿El movimiento está vinculado a otro módulo (OC, nómina, traslado)? Solo informativo. */
export function movEstaVinculado(m: MovimientoCaja): boolean {
  return !!(m.ref_orden_id || m.ref_nomina_renglon_id) || m.tipo === 'traslado_salida' || m.tipo === 'traslado_entrada' || m.categoria === 'abono_cxp' || m.categoria === 'pago_oc' || m.categoria === 'pago_nomina';
}

export interface EditarMovimientoInput {
  monto?: number;
  motivo?: string;
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
}

/**
 * Edita un movimiento (monto y/o concepto) y sincroniza el saldo: aplica la
 * diferencia de efecto al saldo vigente y recalcula la cadena. No cambia
 * moneda/caja/cuenta/tipo (eso movería de partición: para eso, eliminá y recreá).
 */
export async function editarMovimientoCaja(mov: MovimientoCaja, input: EditarMovimientoInput): Promise<void> {
  if (mov.tipo === 'ajuste') throw new Error('Un ajuste no se edita por monto; eliminá y recreá si hace falta.');
  const cuenta = mov.cuenta ?? null;
  const moneda = mov.moneda;
  const nuevoMonto = input.monto != null ? round2(input.monto) : round2(Number(mov.monto) || 0);
  if (nuevoMonto <= 0) throw new Error('El monto debe ser mayor que 0.');

  const signo = signoMov(mov.tipo);
  const delta = round2(signo * (nuevoMonto - (Number(mov.monto) || 0)));

  const patch: Record<string, unknown> = { monto: nuevoMonto };
  if (input.motivo != null) patch.motivo = input.motivo.trim() || mov.motivo;
  if (input.gastoCategoria !== undefined) patch.gasto_categoria = input.gastoCategoria;
  if (input.gastoSubcategoria !== undefined) patch.gasto_subcategoria = input.gastoSubcategoria;

  const { error } = await supabase.from(LIBRO).update(patch).eq('id', mov.id);
  if (error) throw error;
  if (delta !== 0) await ajustarSaldoVigente(mov.caja_id, cuenta, moneda, delta);
  await recomputarCadena(mov.caja_id, cuenta, moneda);
}

/**
 * Elimina un movimiento revirtiendo su efecto en el saldo vigente y recalculando
 * la cadena. ATENCIÓN: no revierte los módulos vinculados (Compras/Nómina/la otra
 * pata de un traslado); eso queda a cargo del usuario (reversión total elegida).
 */
export async function eliminarMovimientoCaja(mov: MovimientoCaja): Promise<void> {
  const cuenta = mov.cuenta ?? null;
  const moneda = mov.moneda;
  const ef = efectoMov(mov);
  const { error } = await supabase.from(LIBRO).delete().eq('id', mov.id);
  if (error) throw error;
  if (ef !== 0) await ajustarSaldoVigente(mov.caja_id, cuenta, moneda, -ef);
  await recomputarCadena(mov.caja_id, cuenta, moneda);
}

/* ───────────── Retenciones e impuestos ───────────── */

export async function crearRetencion(input: {
  tipo: TipoRetencion; base: number; porcentaje: number; moneda: string;
  proveedorId?: string | null; ordenId?: string | null;
  comprobanteNro?: string | null; fecha?: string; descripcion?: string | null;
  actor: string; actorName?: string | null;
}): Promise<Retencion> {
  const base = round2(Number(input.base) || 0);
  const porcentaje = Number(input.porcentaje) || 0;
  if (base <= 0) throw new Error('Indicá la base imponible.');
  if (porcentaje <= 0) throw new Error('Indicá el porcentaje de retención.');
  const monto = round2(base * (porcentaje / 100));

  const { data, error } = await supabase.from('retenciones').insert({
    tipo: input.tipo, base, porcentaje, monto, moneda: input.moneda || 'Bs',
    proveedor_id: input.proveedorId ?? null, orden_id: input.ordenId ?? null,
    comprobante_nro: input.comprobanteNro?.trim() || null,
    fecha: input.fecha || new Date().toISOString().slice(0, 10),
    descripcion: input.descripcion?.trim() || null,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as Retencion;
}

export async function listRetenciones(filtros: {
  tipo?: TipoRetencion; desde?: string; hasta?: string;
} = {}): Promise<Retencion[]> {
  let q = supabase.from('retenciones').select('*').order('fecha', { ascending: false });
  if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
  if (filtros.desde) q = q.gte('fecha', filtros.desde);
  if (filtros.hasta) q = q.lte('fecha', filtros.hasta);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Retencion[];
}
