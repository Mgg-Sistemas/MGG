/* ============================================================
   MGG · Tesorería · Caja multimoneda (saldos + lotes + promedio)
   Una caja contiene varias monedas (Bs, USD, USDT, COP). Bs se
   divide en dos cuentas: jurídica y personal. Cada moneda lleva
   su saldo y una TASA PROMEDIO PONDERADA (Bs por unidad), igual
   que el PMP del inventario: un ingreso recalcula el promedio,
   un egreso sale a esa tasa. Cada ingreso queda como un "lote"
   para la trazabilidad de a qué tasa entró cada parte.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { CajaSaldo, CajaLote, CuentaCaja } from '@/shared/lib/types';

const SALDOS = 'caja_saldos';
const LOTES = 'caja_lotes';

export function round2(n: number): number { return Math.round((Number(n) || 0) * 100) / 100; }
export function round4(n: number): number { return Math.round((Number(n) || 0) * 10000) / 10000; }

/** Saldos de todas las cajas (con nombre de caja). */
export async function listSaldos(): Promise<CajaSaldo[]> {
  const { data, error } = await supabase
    .from(SALDOS)
    .select('*, caja:cajas(nombre)')
    .order('moneda', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CajaSaldo[];
}

/** Saldos de una caja puntual. */
export async function saldosDeCaja(cajaId: string): Promise<CajaSaldo[]> {
  const { data, error } = await supabase.from(SALDOS).select('*').eq('caja_id', cajaId).order('moneda');
  if (error) throw error;
  return (data ?? []) as CajaSaldo[];
}

export interface IngresarDivisaInput {
  cajaId: string;
  cuenta: CuentaCaja;
  moneda: string;
  monto: number;
  /** Bs por 1 unidad de la moneda al comprarla (para USD/USDT/COP). Bs = 1. */
  tasaBs?: number | null;
  origen?: string | null;
  motivo?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Ingresa divisa a una caja: suma al saldo y recalcula la tasa promedio
 * ponderada. Registra el lote (trazabilidad). Devuelve el saldo actualizado.
 */
export async function ingresarDivisa(input: IngresarDivisaInput): Promise<CajaSaldo> {
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const esBs = input.moneda === 'Bs';
  const tasaBs = esBs ? 1 : round4(Number(input.tasaBs) || 0);
  if (!esBs && tasaBs <= 0) throw new Error('Indicá la tasa de compra (Bs por unidad).');

  // Ingreso atómico con FOR UPDATE del saldo: suma + recálculo del promedio ponderado + lote +
  // libro en una sola transacción. Antes era leer-calcular-escribir (upsert de valor absoluto):
  // dos ingresos concurrentes pisaban el promedio. El RPC devuelve el saldo/tasa resultantes.
  const { error } = await supabase.rpc('caja_ingresar_divisa', {
    p_caja: input.cajaId,
    p_cuenta: input.cuenta,
    p_moneda: input.moneda,
    p_monto: monto,
    p_tasa_bs: esBs ? null : tasaBs,
    p_origen: input.origen ?? null,
    p_motivo: input.motivo ?? null,
    p_actor: input.actor,
    p_actor_name: input.actorName ?? null,
  });
  if (error) throw error;

  const { data: saldo, error: e2 } = await supabase.from(SALDOS).select('*')
    .eq('caja_id', input.cajaId).eq('cuenta', input.cuenta).eq('moneda', input.moneda).single();
  if (e2) throw e2;
  return saldo as CajaSaldo;
}

/** Trazabilidad: lotes (ingresos) de una caja, filtrable por moneda/cuenta. */
export async function listLotes(filtros: { cajaId: string; moneda?: string; cuenta?: CuentaCaja }): Promise<CajaLote[]> {
  let q = supabase.from(LOTES).select('*').eq('caja_id', filtros.cajaId).order('created_at', { ascending: false });
  if (filtros.moneda) q = q.eq('moneda', filtros.moneda);
  if (filtros.cuenta) q = q.eq('cuenta', filtros.cuenta);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CajaLote[];
}

export interface EgresarDivisaInput {
  cajaId: string;
  cuenta: CuentaCaja;
  moneda: string;
  monto: number;             // EN LA MONEDA de la cuenta
  concepto?: string | null;
  categoria?: string | null; // ej. 'pago_oc'
  gastoCategoria?: string | null;    // anclaje a categoría de gasto (opcional)
  gastoSubcategoria?: string | null; // anclaje a subcategoría de gasto (opcional)
  refOrdenId?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Egreso de una (caja, cuenta, moneda) puntual: descuenta del saldo multimoneda
 * (valida fondos) y deja el movimiento en el libro de la caja. Se usa para el
 * multipago de una OC desde la caja Multimoneda (una pata por moneda).
 */
export async function egresarDivisa(input: EgresarDivisaInput): Promise<{ id: string }> {
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  // Egreso atómico con FOR UPDATE del saldo (valida fondos y registra el libro en una sola
  // transacción). Antes era leer-calcular-escribir: dos egresos concurrentes perdían un descuento.
  const { data: movId, error } = await supabase.rpc('caja_egresar_divisa', {
    p_caja: input.cajaId,
    p_cuenta: input.cuenta,
    p_moneda: input.moneda,
    p_monto: monto,
    p_concepto: input.concepto ?? null,
    p_categoria: input.categoria ?? null,
    p_gasto_cat: input.gastoCategoria ?? null,
    p_gasto_subcat: input.gastoSubcategoria ?? null,
    p_ref_orden: input.refOrdenId ?? null,
    p_actor: input.actor,
    p_actor_name: input.actorName ?? null,
  });
  if (error) throw error;
  return { id: movId as string };
}

export interface TrasladoLeg { cuenta: CuentaCaja; moneda: string; monto: number; }

/**
 * Traslada dinero de una caja a otra (p. ej. a un Centro de Acopio) por moneda:
 * descuenta cada (cuenta, moneda) del origen y la suma al destino recalculando
 * su tasa promedio ponderada. Registra ambos lados en el libro (traslado_salida /
 * traslado_entrada) con el motivo. El motivo es OBLIGATORIO.
 */
export async function trasladoEntreCajasMulti(input: {
  origenId: string; destinoId: string; legs: TrasladoLeg[]; motivo: string;
  origenNombre?: string; destinoNombre?: string; actor: string; actorName?: string | null;
}): Promise<void> {
  if (!input.origenId || !input.destinoId) throw new Error('Elegí caja origen y destino.');
  if (input.origenId === input.destinoId) throw new Error('El origen y el destino no pueden ser la misma caja.');
  if (!input.motivo?.trim()) throw new Error('El motivo es obligatorio.');
  const legs = (input.legs ?? []).map((l) => ({ ...l, monto: round2(l.monto) })).filter((l) => l.monto > 0);
  if (!legs.length) throw new Error('Indicá al menos un monto a trasladar.');
  // El traslado se ejecuta en un RPC transaccional (caja_trasladar_multi): las dos patas
  // de cada leg (descuento del origen + acreditación del destino) y sus movimientos de libro
  // ocurren en UNA transacción con `SELECT … FOR UPDATE` sobre cada saldo. Así no hay race de
  // saldo (dos egresos concurrentes) ni "dinero que desaparece" si falla la segunda pata:
  // ante cualquier error, la base revierte todo. Las validaciones de arriba son solo para dar
  // feedback rápido; el RPC las vuelve a aplicar del lado del servidor.
  const { error } = await supabase.rpc('caja_trasladar_multi', {
    p_origen: input.origenId,
    p_destino: input.destinoId,
    p_legs: legs,
    p_motivo: input.motivo.trim(),
    p_origen_nombre: input.origenNombre ?? null,
    p_destino_nombre: input.destinoNombre ?? null,
    p_actor: input.actor,
    p_actor_name: input.actorName ?? null,
  });
  if (error) throw error;
}

export interface ConvertirDivisaInput {
  /** Origen: de dónde sale el dinero (caja + cuenta + moneda DE). */
  origenCajaId: string; origenCuenta: CuentaCaja; monedaDe: string;
  /** Destino: dónde entra el convertido (caja + cuenta + moneda A). */
  destinoCajaId: string; destinoCuenta: CuentaCaja; monedaA: string;
  montoDe: number;            // cuánto se cambia, en la moneda DE
  tasa: number;              // 1 DE = ? A (la tasa usada para convertir)
  /** Comisión/descuento (%) que se le descuenta al convertido: el destino recibe el neto. */
  comisionPct?: number | null;
  /** Neto redondeado (absoluto) que debe recibir el destino. Tiene prioridad sobre `comisionPct`:
   *  la comisión se calcula como (bruto − este monto). Lo usa el botón «Redondear». */
  montoANeto?: number | null;
  motivo?: string | null;
  actor: string; actorName?: string | null;
}

/**
 * Convierte un saldo existente de una moneda a otra: descuenta `montoDe` de la
 * (caja origen, cuenta, monedaDe) y acredita el equivalente `montoDe × tasa` en la
 * (caja destino, cuenta, monedaA). Ambas patas quedan en el libro de cada caja como
 * conversión, con la tasa usada. Origen y destino pueden ser la misma caja (cambio
 * interno de una multimoneda) o cajas distintas (p. ej. Multimoneda → Caja Bs).
 * Devuelve los saldos actualizados de origen y destino.
 */
export async function convertirDivisa(input: ConvertirDivisaInput): Promise<{ origen: CajaSaldo | null; destino: CajaSaldo }> {
  const montoDe = round2(input.montoDe);
  // Tasa con TODA la precisión que indicó el usuario (no se redondea a 4 dec): así el
  // monto acreditado refleja exactamente `montoDe × tasa` (lo mismo que la vista previa).
  const tasa = Number(input.tasa) || 0;
  if (montoDe <= 0) throw new Error('El monto a convertir debe ser mayor que 0.');
  if (tasa <= 0) throw new Error('La tasa de conversión debe ser mayor que 0.');
  if (input.monedaDe === input.monedaA && input.origenCajaId === input.destinoCajaId && input.origenCuenta === input.destinoCuenta)
    throw new Error('El origen y el destino son el mismo saldo: no hay nada que convertir.');
  // Comisión/descuento: el bruto se reduce y el destino recibe el neto.
  // Prioridad: si viene `montoANeto` (neto redondeado absoluto) se usa ese; si no, el %.
  const montoBruto = round2(montoDe * tasa);
  const netoManual = input.montoANeto != null ? round2(Number(input.montoANeto)) : null;
  let comision: number, montoA: number;
  if (netoManual != null && netoManual > 0 && netoManual <= montoBruto) {
    montoA = netoManual;
    comision = round2(montoBruto - montoA);
  } else {
    const pctIn = Math.max(0, Math.min(100, Number(input.comisionPct) || 0));
    comision = round2(montoBruto * pctIn / 100);
    montoA = round2(montoBruto - comision);
  }
  // % efectivo (para el motivo), derivado de la comisión real aplicada.
  const pct = montoBruto > 0 ? round2(comision / montoBruto * 100) : 0;
  if (montoA <= 0) throw new Error('El monto convertido (neto) resulta en 0.');

  // Tasa promedio (Bs/unidad) del saldo origen, para arrastrar la base de costo al destino.
  const { data: orig } = await supabase.from(SALDOS).select('tasa_prom')
    .eq('caja_id', input.origenCajaId).eq('cuenta', input.origenCuenta).eq('moneda', input.monedaDe).maybeSingle();
  const tasaPromOrig = input.monedaDe === 'Bs' ? 1 : (Number(orig?.tasa_prom) || 0);

  // Costo en Bs por unidad de la moneda DESTINO (para el promedio ponderado del destino).
  // - Destino Bs: ingresarDivisa lo fija en 1 (lo ignora).
  // - Origen Bs → Destino divisa: Bs/unidad = montoBs / montoDestino.
  // - Divisa → Divisa: arrastra la base Bs del origen (montoDe × tasaPromOrig) / montoDestino.
  let tasaBsDest: number | null = null;
  if (input.monedaA !== 'Bs') {
    if (input.monedaDe === 'Bs') tasaBsDest = round4(montoDe / montoA);
    else if (tasaPromOrig > 0) tasaBsDest = round4((montoDe * tasaPromOrig) / montoA);
    else tasaBsDest = null; // sin base conocida; el destino tomará su propio promedio/nulo
  }

  const motivo = input.motivo?.trim()
    || `Conversión ${montoDe} ${input.monedaDe} → ${montoA} ${input.monedaA} (1 ${input.monedaDe} = ${tasa} ${input.monedaA}${pct > 0 ? ` · comisión ${pct}% = ${comision} ${input.monedaA}` : ''})`;

  // Egreso (monedaDe) + ingreso del neto (monedaA) en UN RPC transaccional: si falla la
  // acreditación del destino, se revierte también el egreso del origen. Antes eran dos
  // operaciones sueltas: el dinero podía salir del origen y no entrar al destino.
  const { error } = await supabase.rpc('caja_convertir_divisa', {
    p_o_caja: input.origenCajaId, p_o_cuenta: input.origenCuenta, p_moneda_de: input.monedaDe,
    p_d_caja: input.destinoCajaId, p_d_cuenta: input.destinoCuenta, p_moneda_a: input.monedaA,
    p_monto_de: montoDe, p_monto_a: montoA, p_tasa_bs_dest: tasaBsDest,
    p_motivo: motivo, p_actor: input.actor, p_actor_name: input.actorName ?? null,
  });
  if (error) throw error;

  const [{ data: origAfter }, { data: destAfter }] = await Promise.all([
    supabase.from(SALDOS).select('*').eq('caja_id', input.origenCajaId).eq('cuenta', input.origenCuenta).eq('moneda', input.monedaDe).maybeSingle(),
    supabase.from(SALDOS).select('*').eq('caja_id', input.destinoCajaId).eq('cuenta', input.destinoCuenta).eq('moneda', input.monedaA).maybeSingle(),
  ]);
  return { origen: (origAfter as CajaSaldo) ?? null, destino: (destAfter as CajaSaldo) };
}

/** Ajusta (fija) el saldo y/o la tasa promedio de una (caja, cuenta, moneda). */
/**
 * Crea una billetera/cuenta VACÍA (saldo 0) para que aparezca en los saldos antes de
 * ingresarle dinero. Si ya existe, NO la toca.
 *
 * Antes esto era un `ajustarSaldoDivisa(saldo)` genérico: fijaba el saldo a CUALQUIER
 * valor con un upsert y sin dejar movimiento en el libro. Nadie lo usaba así (su único
 * llamador siempre mandaba 0), pero era una primitiva capaz de pisar un saldo real sin
 * rastro de quién ni por qué — justo lo contrario del resto de Tesorería. Queda acotada
 * a lo que de verdad hace, y de paso dos personas creando la misma billetera a la vez
 * dejan de ser un problema.
 *
 * Si alguna vez hace falta un ajuste manual de saldo en divisas, va como el resto: RPC
 * transaccional con `FOR UPDATE` Y su movimiento en el libro.
 */
export async function crearBilleteraEnCero(input: {
  cajaId: string; cuenta: CuentaCaja; moneda: string;
}): Promise<void> {
  const { error } = await supabase.from(SALDOS).upsert(
    {
      caja_id: input.cajaId, cuenta: input.cuenta, moneda: input.moneda,
      saldo: 0, tasa_prom: input.moneda === 'Bs' ? 1 : null,
      updated_at: new Date().toISOString(),
    },
    // ignoreDuplicates: si la billetera ya existe se deja intacta (nunca pisa un saldo).
    { onConflict: 'caja_id,cuenta,moneda', ignoreDuplicates: true },
  );
  if (error) throw error;
}
