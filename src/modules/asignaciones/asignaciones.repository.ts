/* ============================================================
   MGG · Asignaciones · Lectura y escritura

   Lo que se le entrega a un trabajador. Cuando lo asignado sale de una
   ficha del inventario, se descuenta con un movimiento NORMAL —el mismo
   que usa cualquier salida—, para que el kardex cuente la historia
   completa: quién se llevó qué, cuándo y para quién.

   La regla que ordena todo esto es la bandera `descontado`: dice si hay
   una salida VIVA por esta asignación. Se prende al descontar y se apaga
   al devolver, al corregir o al eliminar. Mientras esté bien puesta, es
   imposible reingresar dos veces el mismo material.

   Una carga HISTÓRICA no toca el inventario: ese material salió del
   almacén hace rato y descontarlo hoy lo contaría dos veces.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import type { Asignacion } from '@/shared/lib/types';
import { descuentaInventario, reingresaAlInventario, type EstadoAsignacion } from './asignaciones';

const TABLE = 'asignaciones';

export interface AsignacionInput {
  personal_id: string;
  tipo: string;
  descripcion: string;
  producto_id?: string | null;
  almacen?: string | null;
  cantidad: number;
  unidad?: string | null;
  serial?: string | null;
  numero_linea?: string | null;
  fecha_asignacion: string;
  retornable: boolean;
  historico?: boolean;
  observaciones?: string | null;
  /** Vehículo del catálogo (solo tipo vehiculo). */
  vehiculo_id?: string | null;
  /** Hasta cuándo vale la autorización de circulación (opcional). */
  autorizacion_hasta?: string | null;
}

/**
 * Todas las asignaciones, de la más nueva a la más vieja.
 *
 * Por páginas porque Supabase corta en 1.000 filas sin avisar: con varios años
 * de dotación esto pasa los mil sin que nadie lo note, y el histórico de un
 * trabajador viejo desaparecería del reporte sin un solo error.
 */
export async function listAsignaciones(): Promise<Asignacion[]> {
  return todasLasFilas<Asignacion>((desde, hasta) =>
    supabase.from(TABLE).select('*')
      .order('fecha_asignacion', { ascending: false })
      .order('created_at', { ascending: false })
      .range(desde, hasta));
}

/** El histórico de UNA persona, que es lo que se mira al liquidarla. */
export async function listAsignacionesDe(personalId: string): Promise<Asignacion[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .eq('personal_id', personalId)
    .order('fecha_asignacion', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Asignacion[];
}

/** Texto del movimiento, para que el kardex se explique solo. */
function detalleSalida(descripcion: string, quien: string): string {
  return `Asignado a ${quien}: ${descripcion}`;
}

function detalleRetorno(descripcion: string, quien: string): string {
  return `Devuelto por ${quien}: ${descripcion}`;
}

interface Actor { actor: string; actorName?: string | null }

/**
 * Descuenta del inventario lo que se le entrega al trabajador.
 *
 * Va DESPUÉS de crear la fila, con su id: así el movimiento queda apuntando a
 * la asignación y desde el kardex se puede volver a ella. Si el descuento
 * falla, la asignación se borra: dejarla sin su movimiento haría que el sistema
 * dijera que la laptop está entregada y el almacén que sigue en el estante.
 */
async function descontarDelInventario(
  fila: Asignacion, quien: string, a: Actor,
): Promise<void> {
  await registrarMovimiento({
    producto_id: fila.producto_id as string,
    tipo: 'salida',
    delta: -Math.abs(Number(fila.cantidad) || 0),
    almacen: fila.almacen,
    actor: a.actor,
    actor_name: a.actorName ?? null,
    ref_tipo: 'asignacion',
    ref_id: fila.id,
    destino: quien,
    solicitante: quien,
    consumo_interno: true,
    detalle: detalleSalida(fila.descripcion, quien),
  });
}

/** Reingresa al inventario lo que el trabajador devolvió. */
async function reingresarAlInventario(
  fila: Asignacion, quien: string, a: Actor,
): Promise<void> {
  await registrarMovimiento({
    producto_id: fila.producto_id as string,
    tipo: 'entrada',
    delta: Math.abs(Number(fila.cantidad) || 0),
    almacen: fila.almacen,
    actor: a.actor,
    actor_name: a.actorName ?? null,
    ref_tipo: 'asignacion_retorno',
    ref_id: fila.id,
    // Sin precio: el material ya está costeado, y ponerle uno movería el PMP
    // del almacén con una plata que nadie volvió a pagar.
    precio_unitario: null,
    detalle: detalleRetorno(fila.descripcion, quien),
  });
}

/**
 * Registra una asignación y, si corresponde, la saca del inventario.
 *
 * `quien` es el nombre del trabajador: viaja al kardex para que el movimiento
 * se entienda sin tener que abrir otra pantalla.
 */
export async function crearAsignacion(
  input: AsignacionInput, quien: string, a: Actor,
): Promise<Asignacion> {
  const descuenta = descuentaInventario(input);

  const { data, error } = await supabase.from(TABLE).insert({
    personal_id: input.personal_id,
    tipo: input.tipo,
    descripcion: input.descripcion.trim(),
    producto_id: input.producto_id || null,
    almacen: input.almacen || null,
    cantidad: Number(input.cantidad) || 0,
    unidad: input.unidad || null,
    serial: (input.serial ?? '').trim() || null,
    numero_linea: (input.numero_linea ?? '').trim() || null,
    fecha_asignacion: input.fecha_asignacion,
    retornable: input.retornable,
    estado: 'asignado',
    historico: input.historico === true,
    descontado: false,
    observaciones: (input.observaciones ?? '').trim() || null,
    vehiculo_id: input.vehiculo_id || null,
    autorizacion_hasta: input.autorizacion_hasta || null,
    creado_por: a.actor,
    actor_name: a.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  const fila = data as Asignacion;

  if (!descuenta) return fila;

  try {
    await descontarDelInventario(fila, quien, a);
  } catch (e) {
    // Sin movimiento no hay asignación: una entrega a medias es peor que
    // ninguna, porque nadie se entera de que el stock quedó mal.
    await supabase.from(TABLE).delete().eq('id', fila.id);
    throw e;
  }

  const { data: upd } = await supabase.from(TABLE)
    .update({ descontado: true, updated_at: new Date().toISOString() })
    .eq('id', fila.id).select('*').single();
  return (upd ?? { ...fila, descontado: true }) as Asignacion;
}

/** Cómo salió una tanda: lo que entró y lo que quedó fuera, con su motivo. */
export interface ResultadoLote {
  creadas: Asignacion[];
  fallidas: { descripcion: string; motivo: string }[];
}

/**
 * Registra VARIOS ítems de una entrega.
 *
 * A un ingreso se le dan uniforme, botas, casco y laptop el mismo día. Cada uno
 * se guarda como su propia asignación porque cada uno se devuelve por separado:
 * la laptop vuelve y el uniforme no.
 *
 * Van de a UNO y no en un insert masivo a propósito: cada ítem tiene su
 * movimiento de inventario, y si el tercero se queda sin stock, los dos
 * primeros YA se entregaron y su descuento estaba bien. Deshacerlos sería
 * revertir movimientos correctos. Se sigue con el resto y se informa qué quedó
 * fuera, que es lo que le permite a quien entrega arreglar solo lo que falló.
 */
export async function crearAsignaciones(
  inputs: readonly AsignacionInput[], quien: string, a: Actor,
): Promise<ResultadoLote> {
  const creadas: Asignacion[] = [];
  const fallidas: { descripcion: string; motivo: string }[] = [];
  for (const input of inputs) {
    try {
      creadas.push(await crearAsignacion(input, quien, a));
    } catch (e) {
      fallidas.push({
        descripcion: input.descripcion,
        motivo: e instanceof Error ? e.message : 'no se pudo registrar',
      });
    }
  }
  return { creadas, fallidas };
}

/**
 * Corrige una asignación.
 *
 * Si tenía una salida viva, se REVIERTE la vieja y se aplica la nueva, en vez
 * de intentar calcular la diferencia: cambiar de producto, de almacén y de
 * cantidad a la vez convierte ese cálculo en tres restas que hay que acertar
 * todas. Dos movimientos claros valen más que uno ingenioso, y además el kardex
 * muestra la corrección en lugar de esconderla.
 */
export async function actualizarAsignacion(
  id: string, input: AsignacionInput, quien: string, a: Actor,
): Promise<Asignacion> {
  const { data: prev, error: e0 } = await supabase.from(TABLE).select('*').eq('id', id).single();
  if (e0) throw e0;
  const anterior = prev as Asignacion;

  if (anterior.descontado && anterior.producto_id) {
    await reingresarAlInventario(anterior, quien, a);
  }

  const descuenta = descuentaInventario(input);
  const { data, error } = await supabase.from(TABLE).update({
    personal_id: input.personal_id,
    tipo: input.tipo,
    descripcion: input.descripcion.trim(),
    producto_id: input.producto_id || null,
    almacen: input.almacen || null,
    cantidad: Number(input.cantidad) || 0,
    unidad: input.unidad || null,
    serial: (input.serial ?? '').trim() || null,
    numero_linea: (input.numero_linea ?? '').trim() || null,
    fecha_asignacion: input.fecha_asignacion,
    retornable: input.retornable,
    historico: input.historico === true,
    descontado: false,
    observaciones: (input.observaciones ?? '').trim() || null,
    vehiculo_id: input.vehiculo_id || null,
    autorizacion_hasta: input.autorizacion_hasta || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select('*').single();
  if (error) throw error;
  const fila = data as Asignacion;

  // Solo se vuelve a descontar si la asignación sigue abierta: corregir la
  // descripción de algo ya devuelto no puede sacarlo del almacén otra vez.
  if (!descuenta || fila.estado !== 'asignado') return fila;

  await descontarDelInventario(fila, quien, a);
  const { data: upd } = await supabase.from(TABLE)
    .update({ descontado: true, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single();
  return (upd ?? { ...fila, descontado: true }) as Asignacion;
}

/**
 * Cierra una asignación: devuelta, perdida o dañada.
 *
 * Solo lo DEVUELTO vuelve al stock. Lo perdido y lo dañado no reingresan: no
 * están. Meterlos de vuelta haría que el almacén dijera que hay una laptop que
 * nadie puede encontrar.
 */
export async function devolverAsignacion(
  id: string,
  cierre: { fecha_retorno: string; estado: EstadoAsignacion; condicion_retorno?: string | null },
  quien: string,
  a: Actor,
): Promise<Asignacion> {
  const { data: prev, error: e0 } = await supabase.from(TABLE).select('*').eq('id', id).single();
  if (e0) throw e0;
  const fila = prev as Asignacion;

  const reingresa = reingresaAlInventario(fila, cierre.estado);
  if (reingresa && fila.producto_id) await reingresarAlInventario(fila, quien, a);

  const { data, error } = await supabase.from(TABLE).update({
    estado: cierre.estado,
    fecha_retorno: cierre.fecha_retorno,
    condicion_retorno: (cierre.condicion_retorno ?? '').trim() || null,
    // La salida deja de estar viva en los dos casos: si reingresó, porque ya
    // volvió; si se perdió, porque nunca va a volver.
    descontado: false,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Asignacion;
}

/**
 * Reabre una asignación cerrada por error.
 *
 * Vuelve a sacar el material del inventario si había vuelto: si no, la laptop
 * quedaría contada en el almacén y en manos del trabajador al mismo tiempo.
 */
export async function reabrirAsignacion(id: string, quien: string, a: Actor): Promise<Asignacion> {
  const { data: prev, error: e0 } = await supabase.from(TABLE).select('*').eq('id', id).single();
  if (e0) throw e0;
  const fila = prev as Asignacion;
  if (fila.estado === 'asignado') return fila;

  const vuelveASalir = fila.estado === 'devuelto' && !!fila.producto_id && !fila.historico;
  if (vuelveASalir) await descontarDelInventario(fila, quien, a);

  const { data, error } = await supabase.from(TABLE).update({
    estado: 'asignado',
    fecha_retorno: null,
    condicion_retorno: null,
    descontado: vuelveASalir,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Asignacion;
}

/**
 * Elimina una asignación.
 *
 * Si tenía una salida viva, primero se devuelve el material al almacén: borrar
 * el registro sin reponer el stock dejaría un faltante que nadie puede explicar,
 * porque el documento que lo justificaba ya no existe.
 */
export async function eliminarAsignacion(id: string, quien: string, a: Actor): Promise<void> {
  const { data: prev } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  const fila = prev as Asignacion | null;
  if (fila?.descontado && fila.producto_id) await reingresarAlInventario(fila, quien, a);

  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
