/* ============================================================
   MGG · RRHH · Anticipos y préstamos (deducciones con saldo)
   Se registran por persona y se descuentan por cuotas en la nómina
   hasta saldar. El saldo se reduce cuando el renglón se PAGA en Tesorería.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { AnticipoPrestamo, PagoAnticipo } from '@/shared/lib/types';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';
import { formatearEntrega, obtenerEntregas } from './prestamos';

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

  // Si la persona ya tiene un préstamo activo con saldo > 0, se le suma a lo que ya había pedido prestado:
  const { data: activos, error: errAct } = await supabase
    .from(TABLE)
    .select('*')
    .eq('personal_id', input.personal_id)
    .eq('estado', 'activo')
    .gt('saldo', 0)
    .order('created_at', { ascending: false });

  if (errAct) throw errAct;

  const existente = (activos as AnticipoPrestamo[] | null)?.[0];
  if (existente) {
    const nuevoTotal = round2(Number(existente.monto_total) + monto);
    const nuevoSaldo = round2(Number(existente.saldo) + monto);
    const tagEntrega = formatearEntrega(fecha ?? hoy(), monto, input.motivo);
    const motivoCombinado = existente.motivo?.trim()
      ? `${existente.motivo.trim()}\n${tagEntrega}`
      : tagEntrega;

    const camposUpdate: Record<string, unknown> = {
      monto_total: nuevoTotal,
      saldo: nuevoSaldo,
      motivo: motivoCombinado,
    };
    if (input.cuota_sugerida != null && Number(input.cuota_sugerida) > 0) {
      camposUpdate.cuota_sugerida = round2(input.cuota_sugerida);
    }

    const { error: updErr } = await supabase
      .from(TABLE)
      .update(camposUpdate)
      .eq('id', existente.id);
    if (updErr) throw updErr;

    if (yaPagado > 0) {
      await agregarPagoAnticipo({
        anticipo_id: existente.id,
        monto: yaPagado,
        fecha: fecha ?? hoy(),
        origen: 'historico',
        nota: input.motivo?.trim() ? `Abono de entrega: ${input.motivo.trim()}` : 'Abonado antes de cargarlo al sistema',
      }, actorEmail, actorName);
    }

    try {
      await supabase.rpc('anticipos_recalcular_saldo', { p_id: existente.id });
    } catch {
      /* si no existe la función rpc, el saldo ya quedó actualizado arriba */
    }

    const refrescado = await getAnticipo(existente.id);
    return refrescado ?? existente;
  }

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

export interface EditarPagoInput {
  monto?: number;
  fecha?: string | null;
  origen?: 'manual' | 'historico' | 'nomina';
  nota?: string | null;
}

/**
 * Edita un abono ya registrado (monto, fecha, origen, nota) y sincroniza el saldo
 * y estado del préstamo asociado.
 */
export async function editarPagoAnticipo(
  pagoId: string,
  input: EditarPagoInput,
  actorEmail?: string,
  actorName?: string | null,
): Promise<PagoAnticipo> {
  const { data: act, error: errAct } = await supabase.from(TABLA_PAGOS).select('*').eq('id', pagoId).single();
  if (errAct || !act) throw new Error('El abono no existe o fue eliminado.');
  const pagoActual = act as PagoAnticipo;

  const campos: Record<string, unknown> = {};

  if (input.monto !== undefined) {
    const monto = round2(input.monto);
    if (monto <= 0) throw new Error('El abono debe ser mayor que 0.');
    const prestamo = await getAnticipo(pagoActual.anticipo_id);
    if (!prestamo) throw new Error('El préstamo asociado ya no existe.');

    const todosPagos = await listPagosAnticipos([pagoActual.anticipo_id]);
    const otrosPagosTotal = todosPagos
      .filter((p) => p.id !== pagoId)
      .reduce((acc, p) => acc + (Number(p.monto) || 0), 0);

    const maxPermitido = round2(Number(prestamo.monto_total) - otrosPagosTotal);
    if (monto > maxPermitido + 0.004) {
      throw new Error(`El abono supera el saldo restante (${maxPermitido.toLocaleString('es-VE', { minimumFractionDigits: 2 })}).`);
    }
    campos.monto = monto;
  }

  if (input.fecha !== undefined) {
    const f = (input.fecha ?? '').slice(0, 10);
    if (!f) throw new Error('Indicá la fecha del abono.');
    if (f > hoy()) throw new Error('La fecha del abono no puede ser futura.');
    campos.fecha = f;
  }

  if (input.origen !== undefined) {
    campos.origen = input.origen;
  }

  if (input.nota !== undefined) {
    campos.nota = input.nota?.trim() || null;
  }

  if (actorEmail) campos.actor = actorEmail;
  if (actorName) campos.actor_name = actorName;

  if (Object.keys(campos).length) {
    const { error } = await supabase.from(TABLA_PAGOS).update(campos).eq('id', pagoId);
    if (error) throw error;
  }

  // Sincronizar saldo y estado del préstamo en anticipos_prestamos:
  try {
    await supabase.rpc('anticipos_recalcular_saldo', { p_id: pagoActual.anticipo_id });
  } catch {
    /* si no existe la RPC, se recalcula directo abajo */
  }

  const todos = await listPagosAnticipos([pagoActual.anticipo_id]);
  const suma = round2(todos.reduce((acc, p) => acc + (Number(p.monto) || 0), 0));
  const prestamo = await getAnticipo(pagoActual.anticipo_id);
  if (prestamo) {
    const nuevoSaldo = Math.max(0, round2(Number(prestamo.monto_total) - suma));
    const nuevoEstado = nuevoSaldo <= 0 ? 'saldado' : 'activo';
    await supabase.from(TABLE).update({ saldo: nuevoSaldo, estado: nuevoEstado }).eq('id', prestamo.id);
  }

  const { data: final, error: fErr } = await supabase.from(TABLA_PAGOS).select('*').eq('id', pagoId).single();
  if (fErr) throw fErr;
  return final as PagoAnticipo;
}

/**
 * Borra un abono. El saldo vuelve a subir solo.
 *
 * Los de la nómina no se borran desde acá: los generó el pago de un renglón, y
 * borrarlos dejaría el préstamo diciendo que se debe una plata que sí se
 * descontó del sueldo. Eso se arregla anulando el pago de la nómina.
 */
export async function eliminarPagoAnticipo(pago: Pick<PagoAnticipo, 'id' | 'origen' | 'anticipo_id'>): Promise<void> {
  if (pago.origen === 'nomina') {
    throw new Error('Este abono lo generó un pago de nómina. Para revertirlo, anulá ese pago en la nómina.');
  }
  const { data, error } = await supabase.from(TABLA_PAGOS).delete().eq('id', pago.id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo borrar: sin permiso o ya no existía.');

  // Sincronizar saldo y estado del préstamo:
  try {
    await supabase.rpc('anticipos_recalcular_saldo', { p_id: pago.anticipo_id });
  } catch {
    /* si no existe la RPC, se recalcula directo abajo */
  }
  if (pago.anticipo_id) {
    const todos = await listPagosAnticipos([pago.anticipo_id]);
    const suma = round2(todos.reduce((acc, p) => acc + (Number(p.monto) || 0), 0));
    const prestamo = await getAnticipo(pago.anticipo_id);
    if (prestamo) {
      const nuevoSaldo = Math.max(0, round2(Number(prestamo.monto_total) - suma));
      const nuevoEstado = nuevoSaldo <= 0 ? 'saldado' : 'activo';
      await supabase.from(TABLE).update({ saldo: nuevoSaldo, estado: nuevoEstado }).eq('id', prestamo.id);
    }
  }
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

/**
 * Detecta y sincroniza automáticamente en la base de datos a cualquier trabajador
 * que tenga más de un préstamo activo abierto, unificándolos en uno solo con el
 * historial completo de entregas y reasignando sus abonos sin requerir acción manual.
 */
export async function sincronizarPrestamosDuplicadosAutomatico(empresa: Empresa = EMPRESA_POR_DEFECTO): Promise<boolean> {
  try {
    const { data, error } = await supabase.from(TABLE).select('*')
      .eq('empresa', empresa).eq('estado', 'activo').gt('saldo', 0)
      .order('created_at', { ascending: true });
    if (error || !data?.length) return false;

    const lista = data as AnticipoPrestamo[];
    const grupos = new Map<string, AnticipoPrestamo[]>();
    for (const a of lista) {
      const arr = grupos.get(a.personal_id) ?? [];
      arr.push(a);
      grupos.set(a.personal_id, arr);
    }

    let huboCambios = false;

    for (const [, items] of grupos.entries()) {
      if (items.length <= 1) continue;

      huboCambios = true;
      const principal = items[0];
      const secundarios = items.slice(1);
      const secIds = secundarios.map((s) => s.id);

      // 1. Reasignar todos los abonos de los préstamos secundarios al principal:
      await supabase.from(TABLA_PAGOS).update({ anticipo_id: principal.id }).in('anticipo_id', secIds);

      // 2. Extraer todas las entregas combinadas
      const todasLasEntregas = items.flatMap((item) => obtenerEntregas(item));
      todasLasEntregas.sort((a, b) => a.fecha.localeCompare(b.fecha));

      const montoTotal = round2(items.reduce((acc, it) => acc + (Number(it.monto_total) || 0), 0));
      const motivoConsolidado = todasLasEntregas
        .map((e) => `[Entrega ${e.fecha} · $ ${e.monto.toFixed(2)}]: ${e.motivo || 'Préstamo'}`)
        .join('\n');

      // 3. Marcar secundarios como saldados
      await supabase.from(TABLE).update({
        estado: 'saldado',
        saldo: 0,
        motivo: 'Consolidado automáticamente en préstamo activo',
      }).in('id', secIds);

      // 4. Calcular suma de abonos para el saldo real
      const todosPagos = await listPagosAnticipos([principal.id]);
      const sumaPagos = round2(todosPagos.reduce((acc, p) => acc + (Number(p.monto) || 0), 0));
      const nuevoSaldo = Math.max(0, round2(montoTotal - sumaPagos));
      const nuevoEstado = nuevoSaldo <= 0 ? 'saldado' : 'activo';

      await supabase.from(TABLE).update({
        monto_total: montoTotal,
        saldo: nuevoSaldo,
        estado: nuevoEstado,
        motivo: motivoConsolidado,
        fecha: todasLasEntregas[0]?.fecha || principal.fecha,
      }).eq('id', principal.id);
    }

    return huboCambios;
  } catch {
    return false;
  }
}

