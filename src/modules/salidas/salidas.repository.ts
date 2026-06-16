/* ============================================================
   MGG · Salidas / Traslados · Material (Supabase)
   Salida (descuenta stock hacia un destino) y traslado (mueve
   stock entre almacenes llevando el PMP). Reutiliza el kardex
   (`movimientos`) y la lógica de existencias por almacén.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type {
  Movimiento, EventoHistorial, SolicitudSalida, EstadoSolicitudSalida, ScopeSalida, TipoSalida, ItemSolicitudSalida,
} from '@/shared/lib/types';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { getExistencia } from '@/modules/inventario/almacenes.repository';
import { salidaDinero, trasladoDinero } from './cajas.repository';
import { ensureUnidadSolicitante } from '@/modules/pedidos/pedidos.repository';

export interface SalidaMaterialInput {
  productoId: string;
  almacen: string;
  cantidad: number;
  destino: string;
  motivo?: string | null;
  precioUnit?: number | null;
  /** Fecha en que se entregó la salida al destino (YYYY-MM-DD). */
  fechaEntrega?: string | null;
  actor: string;
  actorName?: string | null;
}

/** Salida de material: descuenta stock del almacén hacia un destino. */
export async function salidaMaterial(input: SalidaMaterialInput): Promise<Movimiento> {
  const cantidad = Number(input.cantidad) || 0;
  if (cantidad <= 0) throw new Error('La cantidad debe ser mayor que 0.');
  const ex = await getExistencia(input.productoId, input.almacen);
  const stock = Number(ex?.stock) || 0;
  if (cantidad > stock) throw new Error(`Stock insuficiente en ${input.almacen}. Disponible: ${stock}.`);

  return registrarMovimiento({
    producto_id: input.productoId,
    tipo: 'salida',
    delta: -cantidad,
    almacen: input.almacen,
    actor: input.actor,
    actor_name: input.actorName ?? null,
    ref_tipo: 'salida_modulo',
    destino: input.destino || null,
    fecha_entrega: input.fechaEntrega || null,
    detalle: input.motivo || null,
    precio_unitario: input.precioUnit != null ? Number(input.precioUnit) : null,
  });
}

export interface TrasladoMaterialInput {
  productoId: string;
  almacenOrigen: string;
  almacenDestino: string;
  cantidad: number;
  motivo?: string | null;
  precioUnit?: number | null;
  /** Texto de la nota de entrega (se imprime en el PDF cuando está marcada). */
  notaEntrega?: string | null;
  /** Fecha en que se entregó el traslado al almacén destino (YYYY-MM-DD). */
  fechaEntrega?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Traslado de material entre almacenes: salida en origen + entrada en destino
 * llevando el costo (PMP) del origen para fundirlo en el destino.
 */
export async function trasladoMaterial(input: TrasladoMaterialInput): Promise<Movimiento> {
  const cantidad = Number(input.cantidad) || 0;
  if (cantidad <= 0) throw new Error('La cantidad debe ser mayor que 0.');
  if (input.almacenOrigen === input.almacenDestino) throw new Error('El almacén origen y destino deben ser distintos.');
  const exOrigen = await getExistencia(input.productoId, input.almacenOrigen);
  const stockOrigen = Number(exOrigen?.stock) || 0;
  if (cantidad > stockOrigen) throw new Error(`Stock insuficiente en ${input.almacenOrigen}. Disponible: ${stockOrigen}.`);
  const costoOrigen = Number(exOrigen?.costo_promedio) || 0;
  const precio = input.precioUnit != null ? Number(input.precioUnit) : null;
  const motivo = input.motivo?.trim() || null;
  const notaEntrega = input.notaEntrega?.trim() || null;

  // Salida del origen (se devuelve este movimiento para trazar el traslado).
  const movSalida = await registrarMovimiento({
    producto_id: input.productoId,
    tipo: 'transferencia',
    delta: -cantidad,
    almacen: input.almacenOrigen,
    actor: input.actor,
    actor_name: input.actorName ?? null,
    ref_tipo: 'traslado_modulo',
    destino: input.almacenDestino,
    nota_entrega: notaEntrega,
    fecha_entrega: input.fechaEntrega || null,
    detalle: motivo ? `Traslado a ${input.almacenDestino} · ${motivo}` : `Traslado a ${input.almacenDestino}`,
    precio_unitario: precio,
  });
  // Entrada al destino al costo (PMP) del origen.
  await registrarMovimiento({
    producto_id: input.productoId,
    tipo: 'transferencia',
    delta: cantidad,
    almacen: input.almacenDestino,
    actor: input.actor,
    actor_name: input.actorName ?? null,
    ref_tipo: 'traslado_modulo',
    destino: input.almacenDestino,
    nota_entrega: notaEntrega,
    fecha_entrega: input.fechaEntrega || null,
    detalle: motivo ? `Traslado desde ${input.almacenOrigen} · ${motivo}` : `Traslado desde ${input.almacenOrigen}`,
    precio_unitario: costoOrigen,
  });
  return movSalida;
}

/* ───────────── Directorio de personas (destino) ───────────── */

export interface PersonaDirectorio {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string;
}

/** Directorio mínimo de usuarios activos (vía función SECURITY DEFINER,
 *  legible por cualquier autenticado) para elegir el destinatario persona. */
export async function listDirectorioUsuarios(): Promise<PersonaDirectorio[]> {
  const { data, error } = await supabase.rpc('directorio_usuarios');
  if (error) throw error;
  return (data ?? []) as PersonaDirectorio[];
}

/* ───────────── Listados (historial) ───────────── */

export async function listSalidasMaterial(): Promise<Movimiento[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('*, producto:productos(sku, nombre, unidad)')
    .eq('ref_tipo', 'salida_modulo')
    .order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Movimiento[];
}

/** Traslados de material: solo el lado de salida (delta<0) para no duplicar. */
export async function listTrasladosMaterial(): Promise<Movimiento[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('*, producto:productos(sku, nombre, unidad)')
    .eq('ref_tipo', 'traslado_modulo')
    .lt('delta', 0)
    .order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Movimiento[];
}

/* ============================================================
   Solicitudes de salida/traslado con aprobación
   El obrero crea (por_aprobar); admin/analista aprueba y ejecuta.
   Al ejecutar se reutilizan las funciones inmediatas de arriba
   (salidaMaterial/trasladoMaterial/salidaDinero/trasladoDinero).
   ============================================================ */

const SOL = 'solicitudes_salida';

function appendHistorial(s: Pick<SolicitudSalida, 'historial'>, evento: string, actor: string, meta: Record<string, unknown> = {}): EventoHistorial[] {
  const ev = { at: new Date().toISOString(), evento, actor, ...meta } as EventoHistorial;
  return [...(s.historial ?? []), ev];
}

/** Próximo código SAL-AAAA-NNNN (salida) o TRA-AAAA-NNNN (traslado). */
async function nextCodigoSolicitudSalida(scope: ScopeSalida): Promise<string> {
  const year = new Date().getFullYear();
  const prefijo = scope === 'traslado' ? 'TRA' : 'SAL';
  const { count, error } = await supabase
    .from(SOL)
    .select('id', { count: 'exact', head: true })
    .eq('scope', scope);
  if (error) throw error;
  return `${prefijo}-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

export async function listSolicitudesSalida(filtros?: {
  scope?: ScopeSalida; tipo?: TipoSalida; estado?: EstadoSolicitudSalida;
}): Promise<SolicitudSalida[]> {
  let qy = supabase.from(SOL).select('*').order('created_at', { ascending: false });
  if (filtros?.scope) qy = qy.eq('scope', filtros.scope);
  if (filtros?.tipo) qy = qy.eq('tipo', filtros.tipo);
  if (filtros?.estado) qy = qy.eq('estado', filtros.estado);
  const { data, error } = await qy;
  if (error) throw error;
  return (data ?? []) as SolicitudSalida[];
}

export interface CrearSolicitudSalidaInput {
  scope: ScopeSalida;
  tipo: TipoSalida;
  solicitante: string;
  destino?: string | null;
  motivo?: string | null;
  // material
  productoId?: string | null;
  productoNombre?: string | null;
  almacenOrigen?: string | null;
  almacenDestino?: string | null;
  cantidad?: number | null;
  precioUnit?: number | null;
  fechaEntrega?: string | null;
  notaEntrega?: string | null;
  /** Detalle multi-producto (varias líneas). Si trae >0, manda sobre producto/cantidad. */
  items?: ItemSolicitudSalida[] | null;
  // dinero
  cajaId?: string | null;
  cajaDestinoId?: string | null;
  monto?: number | null;
  moneda?: string | null;
  cuenta?: string | null;
  actor: string;
  actorName?: string | null;
}

/** Crea la solicitud en estado 'por_aprobar'. NO ejecuta el movimiento. */
export async function crearSolicitudSalida(input: CrearSolicitudSalidaInput): Promise<SolicitudSalida> {
  if (!input.solicitante.trim()) throw new Error('Indicá quién hace la solicitud.');
  // Detalle multi-producto: limpia y valida cada línea (cantidad > 0, producto elegido).
  const itemsLimpios = (input.items ?? [])
    .map((it) => ({
      producto_id: it.producto_id,
      producto_nombre: it.producto_nombre ?? null,
      cantidad: Number(it.cantidad) || 0,
      precio_unit: it.precio_unit != null ? Number(it.precio_unit) : null,
      unidad: it.unidad ?? null,
      almacen: it.almacen ?? null,
    }))
    .filter((it) => it.producto_id && it.cantidad > 0);
  // El almacén de origen viaja por ítem (autoasignado: el que tiene el stock).
  // La cabecera toma el del primer ítem (para mostrarse y por compatibilidad).
  const almacenOrigenCab = input.almacenOrigen ?? itemsLimpios.find((it) => it.almacen)?.almacen ?? null;
  if (input.tipo === 'material') {
    if (itemsLimpios.length) {
      if (itemsLimpios.some((it) => it.cantidad <= 0)) throw new Error('Cada material debe tener cantidad mayor que 0.');
    } else {
      const cantidad = Number(input.cantidad) || 0;
      if (cantidad <= 0) throw new Error('La cantidad debe ser mayor que 0.');
      if (!input.productoId) throw new Error('Elegí el producto.');
    }
    if (!almacenOrigenCab) throw new Error('Algún material no tiene stock en ningún almacén.');
    if (input.scope === 'traslado') {
      if (!input.almacenDestino) throw new Error('Indicá el almacén destino.');
      if (itemsLimpios.some((it) => it.almacen === input.almacenDestino)) throw new Error('El almacén origen y destino deben ser distintos.');
    } else if (!input.destino?.trim()) {
      // En la salida de material el "destino" es la UNIDAD SOLICITANTE (gerencia/área),
      // compartida con el catálogo de OP.
      throw new Error('Indicá la unidad solicitante.');
    }
  } else {
    const monto = Number(input.monto) || 0;
    if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
    if (!input.cajaId) throw new Error('Elegí la caja.');
    if (input.scope === 'traslado') {
      if (!input.cajaDestinoId) throw new Error('Elegí la caja destino.');
      if (input.cajaId === input.cajaDestinoId) throw new Error('La caja origen y destino deben ser distintas.');
    } else if (!input.destino?.trim()) {
      throw new Error('Indicá a quién va dirigida la salida de dinero.');
    }
  }

  const codigo = await nextCodigoSolicitudSalida(input.scope);
  const historial = appendHistorial({ historial: [] }, 'creada', input.actor);
  // Cabecera: si hay detalle multi-producto, la primera línea actúa como resumen.
  const cab = itemsLimpios[0] ?? null;
  const productoId = cab ? cab.producto_id : (input.productoId ?? null);
  const productoNombre = cab ? cab.producto_nombre : (input.productoNombre ?? null);
  const cantidadCab = cab ? cab.cantidad : (input.cantidad != null ? Number(input.cantidad) : null);
  const precioCab = cab ? cab.precio_unit : (input.precioUnit != null ? Number(input.precioUnit) : null);
  const { data, error } = await supabase
    .from(SOL)
    .insert({
      codigo,
      scope: input.scope,
      tipo: input.tipo,
      estado: 'por_aprobar',
      producto_id: productoId,
      producto_nombre: productoNombre,
      almacen_origen: almacenOrigenCab,
      almacen_destino: input.almacenDestino ?? null,
      cantidad: cantidadCab,
      precio_unit: precioCab,
      items: itemsLimpios.length ? itemsLimpios : null,
      fecha_entrega: input.fechaEntrega || null,
      nota_entrega: input.notaEntrega?.trim() || null,
      caja_id: input.cajaId ?? null,
      caja_destino_id: input.cajaDestinoId ?? null,
      monto: input.monto != null ? Number(input.monto) : null,
      moneda: input.moneda ?? null,
      cuenta: input.cuenta ?? null,
      solicitante: input.solicitante.trim(),
      destino: input.destino?.trim() || null,
      motivo: input.motivo?.trim() || null,
      historial,
      actor: input.actor,
      actor_name: input.actorName ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  // La unidad solicitante de una salida de material se guarda en el catálogo
  // compartido con OP (se sincroniza en ambos sentidos).
  if (input.tipo === 'material' && input.scope === 'salida') {
    void ensureUnidadSolicitante(input.destino, input.actor);
  }
  return data as SolicitudSalida;
}

/** Aprueba la solicitud (por_aprobar → aprobada). NO ejecuta el movimiento. */
export async function aprobarSolicitudSalida(s: SolicitudSalida, actor: string): Promise<void> {
  if (s.estado !== 'por_aprobar') throw new Error('Solo se aprueban solicitudes por aprobar.');
  const { error } = await supabase
    .from(SOL)
    .update({
      estado: 'aprobada',
      aprobada_por: actor,
      aprobada_en: new Date().toISOString(),
      historial: appendHistorial(s, 'aprobada', actor),
    })
    .eq('id', s.id);
  if (error) throw error;
}

/**
 * Ejecuta la solicitud aprobada: realiza el movimiento real reutilizando las
 * funciones inmediatas (que validan stock/saldo) y cierra como 'ejecutada'.
 */
export async function ejecutarSolicitudSalida(s: SolicitudSalida, actor: string, actorName?: string | null): Promise<void> {
  if (s.estado !== 'aprobada') throw new Error('Solo se ejecutan solicitudes aprobadas.');

  let movId: string | null = null;
  let movRef = '';
  // Líneas a ejecutar: el detalle multi-producto si existe, si no la cabecera (1 línea).
  const lineas: ItemSolicitudSalida[] = (s.items && s.items.length)
    ? s.items
    : [{ producto_id: s.producto_id!, producto_nombre: s.producto_nombre, cantidad: Number(s.cantidad) || 0, precio_unit: s.precio_unit, almacen: s.almacen_origen }];
  if (s.scope === 'salida' && s.tipo === 'material') {
    for (const it of lineas) {
      const mov = await salidaMaterial({
        productoId: it.producto_id, almacen: it.almacen ?? s.almacen_origen!, cantidad: Number(it.cantidad) || 0,
        destino: s.destino || '', motivo: s.motivo, precioUnit: it.precio_unit ?? null,
        fechaEntrega: s.fecha_entrega, actor, actorName,
      });
      if (!movId) movId = mov.id;
    }
    movRef = 'salida_modulo';
  } else if (s.scope === 'traslado' && s.tipo === 'material') {
    for (const it of lineas) {
      const mov = await trasladoMaterial({
        productoId: it.producto_id, almacenOrigen: it.almacen ?? s.almacen_origen!, almacenDestino: s.almacen_destino!,
        cantidad: Number(it.cantidad) || 0, motivo: s.motivo, precioUnit: it.precio_unit ?? null,
        notaEntrega: s.nota_entrega, fechaEntrega: s.fecha_entrega, actor, actorName,
      });
      if (!movId) movId = mov.id;
    }
    movRef = 'traslado_modulo';
  } else if (s.scope === 'salida' && s.tipo === 'dinero') {
    const mov = await salidaDinero({
      cajaId: s.caja_id!, destino: s.destino || '', motivo: s.motivo || '',
      monto: Number(s.monto) || 0, actor, actorName,
    });
    movId = mov.id; movRef = 'salida_dinero';
  } else if (s.scope === 'traslado' && s.tipo === 'dinero') {
    const mov = await trasladoDinero({
      origenId: s.caja_id!, destinoId: s.caja_destino_id!, monto: Number(s.monto) || 0,
      motivo: s.motivo, notaEntrega: s.nota_entrega, actor, actorName,
    });
    movId = mov.id; movRef = 'traslado_dinero';
  } else {
    throw new Error('Combinación de solicitud no soportada.');
  }

  const { error } = await supabase
    .from(SOL)
    .update({
      estado: 'ejecutada',
      ejecutada_por: actor,
      ejecutada_en: new Date().toISOString(),
      mov_id: movId,
      mov_ref: movRef,
      historial: appendHistorial(s, 'ejecutada', actor),
    })
    .eq('id', s.id);
  if (error) throw error;
}

export async function cancelarSolicitudSalida(s: SolicitudSalida, actor: string, motivo: string): Promise<void> {
  if (s.estado === 'ejecutada') throw new Error('No se puede cancelar una solicitud ya ejecutada.');
  const { error } = await supabase
    .from(SOL)
    .update({
      estado: 'cancelada',
      historial: appendHistorial(s, 'cancelada', actor, { motivo }),
    })
    .eq('id', s.id);
  if (error) throw error;
}
