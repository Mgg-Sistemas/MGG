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

  // Egreso atómico (caja_gasto): descuenta con FOR UPDATE del saldo multimoneda (caja_saldos)
  // o del saldo legado de la caja, y registra el libro, en una sola transacción. Antes era
  // leer-calcular-escribir sin bloqueo: dos gastos concurrentes sobre la misma caja perdían
  // uno de los descuentos.
  const { data: movId, error } = await supabase.rpc('caja_gasto', {
    p_caja: input.cajaId,
    p_monto: monto,
    p_concepto: input.concepto,
    p_categoria: input.categoria ?? null,
    p_cuenta: input.cuenta ?? null,
    p_moneda: input.moneda ?? null,
    p_gasto_cat: input.gastoCategoria ?? null,
    p_gasto_subcat: input.gastoSubcategoria ?? null,
    p_gasto_corr: input.gastoCorrelativo ?? null,
    p_actor: input.actor,
    p_actor_name: input.actorName ?? null,
  });
  if (error) throw error;

  const { data, error: e2 } = await supabase.from(LIBRO).select('*').eq('id', movId).single();
  if (e2) throw e2;
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
  gastoCategoria?: string | null; gastoSubcategoria?: string | null;
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
    gasto_categoria: input.gastoCategoria ?? null, gasto_subcategoria: input.gastoSubcategoria ?? null,
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
  // SOLO cajas propias de Tesorería: el dinero trasladado a un sistema externo
  // (p. ej. Peramanal, externo=true) o a un CENTRO DE ACOPIO interno
  // (tipo='centro_acopio') ya salió de Tesorería, así que esas cajas se excluyen
  // de la disponibilidad (si no, el traspaso nunca se vería descontar del total).
  const { data: internas } = await supabase.from('cajas').select('id').eq('externo', false).neq('tipo', 'centro_acopio');
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

/** Lee un movimiento de caja por id (para editarlo/revertirlo desde otro módulo). */
export async function getMovimientoCajaPorId(id: string): Promise<MovimientoCaja | null> {
  const { data, error } = await supabase.from(LIBRO).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as MovimientoCaja) ?? null;
}

export interface EditarMovimientoInput {
  monto?: number;
  motivo?: string;
  /** Nueva fecha/hora (ISO). Al cambiarla, la cadena se reordena por `at` y los saldos se recalculan. */
  at?: string;
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
  if (input.at) patch.at = input.at; // reordena la cadena (recomputarCadena ordena por `at`)
  if (input.gastoCategoria !== undefined) patch.gasto_categoria = input.gastoCategoria;
  if (input.gastoSubcategoria !== undefined) patch.gasto_subcategoria = input.gastoSubcategoria;

  const { error } = await supabase.from(LIBRO).update(patch).eq('id', mov.id);
  if (error) throw error;
  if (delta !== 0) await ajustarSaldoVigente(mov.caja_id, cuenta, moneda, delta);
  await recomputarCadena(mov.caja_id, cuenta, moneda);
}

export interface EditarMovimientoFullInput {
  monto?: number;
  motivo?: string;
  at?: string;
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  /** Mover el movimiento a otra partición (caja / billetera / moneda). */
  cajaId?: string;
  cuenta?: string | null;
  moneda?: string;
}

/**
 * Edición TOTAL de un movimiento: monto, concepto, fecha, categoría de gasto y —si hace
 * falta— la CAJA / billetera (cuenta) / moneda de la que sale o entra. Sincroniza los
 * saldos: si cambia de partición, reversa el efecto en la caja vieja y lo aplica en la
 * nueva, y recalcula la cadena de saldos (Libro Mayor) de AMBAS. No cambia el tipo
 * (entrada/salida); para eso, eliminá y recreá.
 */
export async function editarMovimientoCajaFull(mov: MovimientoCaja, input: EditarMovimientoFullInput): Promise<void> {
  if (mov.tipo === 'ajuste') throw new Error('Un ajuste no se edita por esta vía; eliminá y recreá si hace falta.');
  const oldCaja = mov.caja_id, oldCuenta = mov.cuenta ?? null, oldMoneda = mov.moneda;
  const newCaja = input.cajaId ?? oldCaja;
  const newMoneda = (input.moneda ?? oldMoneda) as string;
  const newCuenta = input.cuenta !== undefined ? input.cuenta : oldCuenta;
  const nuevoMonto = input.monto != null ? round2(input.monto) : round2(Number(mov.monto) || 0);
  if (nuevoMonto <= 0) throw new Error('El monto debe ser mayor que 0.');

  const patch: Record<string, unknown> = { monto: nuevoMonto };
  if (input.motivo != null) patch.motivo = input.motivo.trim() || mov.motivo;
  if (input.at) patch.at = input.at;
  if (input.gastoCategoria !== undefined) patch.gasto_categoria = input.gastoCategoria;
  if (input.gastoSubcategoria !== undefined) patch.gasto_subcategoria = input.gastoSubcategoria;

  const mismaParticion = oldCaja === newCaja && (oldCuenta ?? null) === (newCuenta ?? null) && oldMoneda === newMoneda;

  if (mismaParticion) {
    const signo = signoMov(mov.tipo);
    const delta = round2(signo * (nuevoMonto - (Number(mov.monto) || 0)));
    const { error } = await supabase.from(LIBRO).update(patch).eq('id', mov.id);
    if (error) throw error;
    if (delta !== 0) await ajustarSaldoVigente(oldCaja, oldCuenta, oldMoneda, delta);
    await recomputarCadena(oldCaja, oldCuenta, oldMoneda);
    return;
  }

  // Cambió de partición: mover la fila + reversar efecto viejo + aplicar efecto nuevo.
  const efViejo = efectoMov(mov);                                 // efecto del monto VIEJO en la caja vieja
  const efNuevo = round2(signoMov(mov.tipo) * nuevoMonto);        // efecto del monto NUEVO en la caja nueva
  patch.caja_id = newCaja;
  patch.cuenta = newCuenta;
  patch.moneda = newMoneda;
  const { error } = await supabase.from(LIBRO).update(patch).eq('id', mov.id);
  if (error) throw error;
  if (efViejo !== 0) await ajustarSaldoVigente(oldCaja, oldCuenta, oldMoneda, -efViejo);
  if (efNuevo !== 0) await ajustarSaldoVigente(newCaja, newCuenta, newMoneda, efNuevo);
  await recomputarCadena(oldCaja, oldCuenta, oldMoneda);
  await recomputarCadena(newCaja, newCuenta, newMoneda);
}

/**
 * Al eliminar el pago de una OC (pago_oc), devuelve la orden vinculada a "Confirmada
 * pagar" (`oc_aprobada`) y limpia los campos de pago, para que Tesorería la pueda
 * re-pagar. Sin esto la orden quedaría "pagada" apuntando a un movimiento que ya no
 * existe (imposible de re-pagar). Solo actúa si la orden está en `pagada` y NO quedan
 * otras patas de pago vivas (multipago parcial no se revierte). Self-contained: no
 * importa el repo de pedidos para evitar dependencia circular.
 */
async function revertirOrdenSiPagoBorrado(mov: MovimientoCaja): Promise<void> {
  let ordenId = mov.ref_orden_id ?? null;
  if (!ordenId) {
    // Legado: pagos sin ref_orden_id se ubican por el caja_mov_id que guardó la orden.
    const { data } = await supabase.from('ordenes').select('id').eq('caja_mov_id', mov.id).maybeSingle();
    ordenId = (data as { id: string } | null)?.id ?? null;
  }
  if (!ordenId) return;
  // ¿Quedan otras patas de pago de esta orden en caja? (el movimiento ya fue borrado.)
  const { data: restantes } = await supabase.from(LIBRO).select('id').eq('ref_orden_id', ordenId).limit(1);
  if (restantes && restantes.length > 0) return; // aún hay pago(s) vivo(s): no tocar el estado
  const { data: o } = await supabase
    .from('ordenes')
    .select('id, estado, oc_codigo, comprobante_tipo, historial')
    .eq('id', ordenId)
    .maybeSingle();
  const orden = o as { id: string; estado: string; oc_codigo: string | null; comprobante_tipo: string | null; historial: unknown } | null;
  if (!orden || orden.estado !== 'pagada') return; // solo un pago simple aún no recibido
  const evento = {
    at: new Date().toISOString(),
    actor: 'tesoreria',
    evento: 'pago_revertido',
    oc_codigo: orden.oc_codigo ?? null,
    nota: 'Movimiento de pago eliminado desde Tesorería; la orden vuelve a Confirmada pagar.',
  };
  const historial = Array.isArray(orden.historial) ? [...orden.historial, evento] : [evento];
  await supabase.from('ordenes').update({
    estado: 'oc_aprobada',
    caja_mov_id: null,
    caja_id: null,
    pagada_por: null,
    pagada_en: null,
    ...(orden.comprobante_tipo === 'factura' ? { retencion_pagada: false, retencion_pagada_en: null } : {}),
    historial,
    updated_at: new Date().toISOString(),
  }).eq('id', ordenId);
}

/**
 * Elimina un movimiento revirtiendo su efecto en el saldo vigente y recalculando
 * la cadena. Si el movimiento pagaba una OC (pago_oc), además devuelve la orden a
 * "Confirmada pagar" para que se pueda re-pagar (ver `revertirOrdenSiPagoBorrado`).
 * ATENCIÓN: no revierte otros módulos vinculados (Nómina / la otra pata de un
 * traslado); eso queda a cargo del usuario (reversión total elegida).
 */
export async function eliminarMovimientoCaja(mov: MovimientoCaja): Promise<void> {
  const cuenta = mov.cuenta ?? null;
  const moneda = mov.moneda;
  const ef = efectoMov(mov);
  const { error } = await supabase.from(LIBRO).delete().eq('id', mov.id);
  if (error) throw error;
  if (ef !== 0) await ajustarSaldoVigente(mov.caja_id, cuenta, moneda, -ef);
  await recomputarCadena(mov.caja_id, cuenta, moneda);
  // Tras borrar el egreso, si pagaba una OC, revertí la orden a "por pagar".
  if (mov.ref_orden_id || mov.categoria === 'pago_oc') await revertirOrdenSiPagoBorrado(mov);
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
