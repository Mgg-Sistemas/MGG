/* ============================================================
   MGG · RRHH · Anticipos y préstamos (deducciones con saldo)
   Se registran por persona y se descuentan por cuotas en la nómina
   hasta saldar. El saldo se reduce cuando el renglón se PAGA en Tesorería.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { AnticipoPrestamo, PagoAnticipo } from '@/shared/lib/types';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';

const TABLE = 'anticipos_prestamos';
const TABLA_PAGOS = 'anticipos_pagos';

const round2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const hoy = () => new Date().toISOString().slice(0, 10);

/** Los anticipos de la nómina. La empresa la hereda la fila de su persona. */
export async function listAnticipos(
  personalId?: string,
  soloActivos = false,
  empresa: Empresa = EMPRESA_POR_DEFECTO,
): Promise<AnticipoPrestamo[]> {
  // Por páginas: Supabase corta en 1.000 filas sin avisar, y con el histórico
  // de cada trabajador cargado esta tabla pasa ese número sin problema.
  // Ordenado por la fecha en que se DIO, que es como se lee el historial.
  return todasLasFilas<AnticipoPrestamo>((desde, hasta) => {
    let q = supabase.from(TABLE).select('*').eq('empresa', empresa)
      .order('fecha', { ascending: false }).order('created_at', { ascending: false }).order('id')
      .range(desde, hasta);
    if (personalId) q = q.eq('personal_id', personalId);
    if (soloActivos) q = q.eq('estado', 'activo');
    return q;
  });
}

/**
 * Activos con saldo > 0, para armar la nómina. El filtro por empresa quedó
 * de cuando había dos: hoy trae lo mismo, pero es la pieza que habría que
 * mantener si volviera una segunda nómina.
 */
export async function listAnticiposActivos(empresa: Empresa = EMPRESA_POR_DEFECTO): Promise<AnticipoPrestamo[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .eq('empresa', empresa).eq('estado', 'activo').gt('saldo', 0)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AnticipoPrestamo[];
}

export interface AnticipoInput {
  personal_id: string;
  tipo: 'anticipo' | 'prestamo';
  monto_total: number;
  cuota_sugerida?: number | null;
  motivo?: string | null;
  /** Cuándo se DIO. Para cargar préstamos viejos con su fecha de verdad. */
  fecha?: string | null;
  /**
   * Cuánto ya había pagado de ese préstamo viejo. Entra como un abono con
   * origen `historico` y la misma fecha, así el saldo arranca donde va.
   */
  ya_pagado?: number | null;
}

export async function crearAnticipo(input: AnticipoInput, actorEmail?: string, actorName?: string | null): Promise<AnticipoPrestamo> {
  const monto = round2(input.monto_total);
  if (!input.personal_id) throw new Error('Indicá a quién corresponde.');
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const fecha = (input.fecha ?? '').slice(0, 10) || null;
  if (fecha && fecha > hoy()) throw new Error('La fecha del préstamo no puede ser futura.');
  const yaPagado = round2(input.ya_pagado);
  if (yaPagado > monto) throw new Error('Lo ya pagado no puede superar el monto del préstamo.');

  const { data, error } = await supabase.from(TABLE).insert({
    personal_id: input.personal_id,
    tipo: input.tipo,
    monto_total: monto,
    // El saldo lo recalcula la base a partir de los abonos; se manda el total
    // para que la fila arranque coherente aunque no haya ningún abono.
    saldo: monto,
    fecha: fecha ?? undefined,
    cuota_sugerida: input.cuota_sugerida != null ? round2(input.cuota_sugerida) : null,
    motivo: input.motivo?.trim() || null,
    creado_por: actorEmail ?? null,
    actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  const creado = data as AnticipoPrestamo;

  // Lo ya pagado va como abono, no como un saldo más chico: así queda en el
  // estado de cuenta en vez de desaparecer dentro de un número.
  if (yaPagado > 0) {
    await agregarPagoAnticipo({
      anticipo_id: creado.id,
      monto: yaPagado,
      fecha: fecha ?? hoy(),
      origen: 'historico',
      nota: 'Abonado antes de cargarlo al sistema',
    }, actorEmail, actorName);
    const refrescado = await getAnticipo(creado.id);
    if (refrescado) return refrescado;
  }
  return creado;
}

export async function getAnticipo(id: string): Promise<AnticipoPrestamo | null> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as AnticipoPrestamo | null) ?? null;
}

/**
 * Edita un préstamo ya cargado. El saldo NO se toca acá: sale de los abonos.
 *
 * Bajar el monto total por debajo de lo ya abonado dejaría un saldo negativo,
 * que la base recorta a cero y esconde el problema; mejor avisarlo.
 */
export async function editarAnticipo(
  id: string,
  patch: { tipo?: 'anticipo' | 'prestamo'; monto_total?: number; cuota_sugerida?: number | null; motivo?: string | null; fecha?: string | null },
): Promise<AnticipoPrestamo> {
  const campos: Record<string, unknown> = {};
  if (patch.tipo !== undefined) campos.tipo = patch.tipo;
  if (patch.motivo !== undefined) campos.motivo = patch.motivo?.trim() || null;
  if (patch.cuota_sugerida !== undefined) campos.cuota_sugerida = patch.cuota_sugerida != null ? round2(patch.cuota_sugerida) : null;
  if (patch.fecha !== undefined) {
    const f = (patch.fecha ?? '').slice(0, 10);
    if (!f) throw new Error('Indicá la fecha del préstamo.');
    if (f > hoy()) throw new Error('La fecha del préstamo no puede ser futura.');
    campos.fecha = f;
  }
  if (patch.monto_total !== undefined) {
    const monto = round2(patch.monto_total);
    if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
    const pagado = await totalAbonado(id);
    if (monto < pagado) {
      throw new Error(`Ya se abonaron ${pagado.toLocaleString('es-VE', { minimumFractionDigits: 2 })}: el monto no puede quedar por debajo. Borrá primero los abonos que sobren.`);
    }
    campos.monto_total = monto;
  }
  if (!Object.keys(campos).length) {
    const actual = await getAnticipo(id);
    if (!actual) throw new Error('Ese préstamo ya no existe.');
    return actual;
  }
  const { data, error } = await supabase.from(TABLE).update(campos).eq('id', id).select('*').single();
  if (error) throw error;
  // El monto cambió: el saldo tiene que seguirlo.
  if (campos.monto_total !== undefined) {
    await supabase.rpc('anticipos_recalcular_saldo', { p_id: id });
    return (await getAnticipo(id)) ?? (data as AnticipoPrestamo);
  }
  return data as AnticipoPrestamo;
}

/* ───────────────────── Abonos ───────────────────── */

/**
 * Los abonos. Sin `anticipoIds` trae todos, por páginas.
 *
 * Por páginas porque Supabase corta en 1.000 filas sin avisar, y los abonos
 * crecen más rápido que los préstamos: cada quincena agrega uno por cada
 * préstamo abierto.
 */
export async function listPagosAnticipos(anticipoIds?: string[]): Promise<PagoAnticipo[]> {
  if (anticipoIds && !anticipoIds.length) return [];
  const filas = await todasLasFilas<PagoAnticipo>((desde, hasta) => {
    let q = supabase.from(TABLA_PAGOS).select('*').order('fecha', { ascending: true }).order('id').range(desde, hasta);
    if (anticipoIds) q = q.in('anticipo_id', anticipoIds);
    return q;
  });
  return filas;
}

/** Lo abonado hasta ahora a un préstamo. */
export async function totalAbonado(anticipoId: string): Promise<number> {
  const { data, error } = await supabase.from(TABLA_PAGOS).select('monto').eq('anticipo_id', anticipoId);
  if (error) throw error;
  return round2((data ?? []).reduce((a, r) => a + (Number((r as { monto: unknown }).monto) || 0), 0));
}

export interface PagoInput {
  anticipo_id: string;
  monto: number;
  fecha?: string | null;
  origen?: 'manual' | 'historico';
  nota?: string | null;
}

/**
 * Carga un abono. El saldo lo recalcula sola la base.
 *
 * Se revisa contra el saldo del momento y no contra el que vio la pantalla:
 * entre que se abrió el formulario y se guardó, la nómina pudo haber
 * descontado una cuota.
 */
export async function agregarPagoAnticipo(
  input: PagoInput, actorEmail?: string, actorName?: string | null,
): Promise<PagoAnticipo> {
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error('El abono debe ser mayor que 0.');
  const fecha = (input.fecha ?? '').slice(0, 10) || hoy();
  if (fecha > hoy()) throw new Error('La fecha del abono no puede ser futura.');

  const prestamo = await getAnticipo(input.anticipo_id);
  if (!prestamo) throw new Error('Ese préstamo ya no existe.');
  const restante = round2(Number(prestamo.saldo));
  if (monto > restante + 0.004) {
    throw new Error(`El abono es mayor que lo que se debe (${restante.toLocaleString('es-VE', { minimumFractionDigits: 2 })}). Si sobra, cargá un préstamo aparte.`);
  }

  const { data, error } = await supabase.from(TABLA_PAGOS).insert({
    anticipo_id: input.anticipo_id,
    monto,
    fecha,
    origen: input.origen ?? 'manual',
    nota: input.nota?.trim() || null,
    actor: actorEmail ?? null,
    actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as PagoAnticipo;
}

/**
 * Borra un abono. El saldo vuelve a subir solo.
 *
 * Los de la nómina no se borran desde acá: los generó el pago de un renglón, y
 * borrarlos dejaría el préstamo diciendo que se debe una plata que sí se
 * descontó del sueldo. Eso se arregla anulando el pago de la nómina.
 */
export async function eliminarPagoAnticipo(pago: Pick<PagoAnticipo, 'id' | 'origen'>): Promise<void> {
  if (pago.origen === 'nomina') {
    throw new Error('Este abono lo generó un pago de nómina. Para revertirlo, anulá ese pago en la nómina.');
  }
  const { data, error } = await supabase.from(TABLA_PAGOS).delete().eq('id', pago.id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo borrar: sin permiso o ya no existía.');
}

/** Descuenta `monto` del saldo (al pagar un renglón). Marca saldado si llega a 0. */
export async function descontarSaldo(id: string, monto: number): Promise<void> {
  const { data, error } = await supabase.from(TABLE).select('saldo').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const nuevo = Math.max(0, Math.round(((Number(data.saldo) || 0) - (Number(monto) || 0)) * 100) / 100);
  const { error: uErr } = await supabase.from(TABLE).update({ saldo: nuevo, estado: nuevo <= 0 ? 'saldado' : 'activo' }).eq('id', id);
  if (uErr) throw uErr;
}

export async function eliminarAnticipo(id: string): Promise<void> {
  const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
}
