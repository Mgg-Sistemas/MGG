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
import { registrarMovimiento, recomputeProductoAgg } from '@/modules/inventario/movimientos.repository';
import { getExistencia } from '@/modules/inventario/almacenes.repository';
import { salidaDinero, trasladoDinero } from './cajas.repository';
import { ensureUnidadSolicitante } from '@/modules/pedidos/pedidos.repository';
import { registrarSobrepagoCobrar } from '@/modules/tesoreria/cuentasPorCobrar.repository';

/**
 * Vínculo Salidas/Traslados → Inventario: fija el costo/PMP del producto en un
 * almacén y propaga al precio global del producto. Así el precio que el usuario
 * edita en la salida/traslado queda reflejado en el inventario (durable: escribe
 * la existencia, no `productos.precio` directo —que lo recalcula cada movimiento—).
 * No-op si el costo no cambió.
 */
async function vincularPrecioInventario(productoId: string, almacen: string, costo: number): Promise<void> {
  if (!productoId || !almacen || !Number.isFinite(costo) || costo < 0) return;
  const { data } = await supabase
    .from('existencias')
    .select('stock, costo_promedio')
    .eq('producto_id', productoId)
    .eq('almacen', almacen)
    .maybeSingle();
  const costoActual = Number(data?.costo_promedio) || 0;
  if (Math.abs(costoActual - costo) < 0.005) return; // sin cambios reales
  const { error } = await supabase
    .from('existencias')
    .upsert(
      { producto_id: productoId, almacen, stock: Number(data?.stock) || 0, costo_promedio: costo, updated_at: new Date().toISOString() },
      { onConflict: 'producto_id,almacen' },
    );
  if (error) throw error;
  await recomputeProductoAgg(productoId);
}

export interface SalidaMaterialInput {
  productoId: string;
  almacen: string;
  cantidad: number;
  destino: string;
  motivo?: string | null;
  precioUnit?: number | null;
  /** Fecha en que se entregó la salida al destino (YYYY-MM-DD). */
  fechaEntrega?: string | null;
  /** Marca que la salida es para consumo interno de la empresa. */
  consumoInterno?: boolean | null;
  /** Quién solicitó la salida (se muestra en el historial). */
  solicitante?: string | null;
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

  const mov = await registrarMovimiento({
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
    consumo_interno: input.consumoInterno ?? false,
    solicitante: input.solicitante ?? null,
  });
  // El precio editado se vincula con el inventario (actualiza el costo/PMP del producto).
  if (input.precioUnit != null) await vincularPrecioInventario(input.productoId, input.almacen, Number(input.precioUnit));
  return mov;
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
  /** Marca que el traslado es para consumo interno de la empresa. */
  consumoInterno?: boolean | null;
  /** Quién solicitó el traslado (se muestra en el historial). */
  solicitante?: string | null;
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
  // Si el usuario editó el precio, ese pasa a ser el costo que viaja al destino
  // (y se fija como costo del origen en el inventario). Si no, se conserva el PMP del origen.
  const costoDestino = precio != null && precio >= 0 ? precio : costoOrigen;
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
    consumo_interno: input.consumoInterno ?? false,
    solicitante: input.solicitante ?? null,
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
    precio_unitario: costoDestino,
    consumo_interno: input.consumoInterno ?? false,
    solicitante: input.solicitante ?? null,
  });
  // El precio editado se vincula con el inventario: fija el costo/PMP del producto en el origen.
  if (precio != null && precio >= 0) await vincularPrecioInventario(input.productoId, input.almacenOrigen, precio);
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
  // datos de la nota de salida en tránsito
  chofer?: string | null;
  choferCedula?: string | null;
  vehiculo?: string | null;
  vehiculoPlaca?: string | null;
  direccionDespacho?: string | null;
  direccionDestino?: string | null;
  /** Sede/centro de acopio destino (almacén padre o centro de acopio del desplegable). */
  sedeDestino?: string | null;
  /** Salida a CLIENTE: al ejecutar genera una cuenta por cobrar. */
  clienteId?: string | null;
  clienteNombre?: string | null;
  /** Monto de la cuenta por cobrar (valor del material, editable) y su moneda (def. USD). */
  cxcMonto?: number | null;
  cxcMoneda?: string | null;
  /** Marca que la salida/traslado es para consumo interno de la empresa. */
  consumoInterno?: boolean | null;
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
      observacion: it.observacion?.trim() || null,
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
      chofer: input.chofer?.trim() || null,
      chofer_cedula: input.choferCedula?.trim() || null,
      vehiculo: input.vehiculo?.trim() || null,
      vehiculo_placa: input.vehiculoPlaca?.trim() || null,
      direccion_despacho: input.direccionDespacho?.trim() || null,
      direccion_destino: input.direccionDestino?.trim() || null,
      sede_destino: input.sedeDestino?.trim() || null,
      cliente_id: input.clienteId ?? null,
      cliente_nombre: input.clienteNombre?.trim() || null,
      cxc_monto: input.cxcMonto != null ? Number(input.cxcMonto) : null,
      cxc_moneda: input.cxcMoneda ?? null,
      consumo_interno: input.consumoInterno ?? false,
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
 * Resuelve el DESTINO de un traslado (que puede ser una SEDE/centro, ej.
 * "CENTRO DE ACOPIO - LA ESPERANZA" o "LOS PINOS") al nombre de un almacén REAL
 * para registrar la entrada de stock. Si ya es un almacén, lo deja igual; si es
 * una sede, toma su almacén PADRE (el que mejor matchea el nombre). Así el PDF
 * imprime la sede pero el inventario entra a un almacén válido.
 */
async function resolverAlmacenDestino(destino: string): Promise<string> {
  const d = (destino || '').trim();
  if (!d) return d;
  const { data: exact } = await supabase.from('almacenes').select('nombre').eq('nombre', d).eq('estado', 'activo').maybeSingle();
  if (exact) return d;
  const { data: padres } = await supabase.from('almacenes').select('nombre').eq('sede', d).is('parent_id', null).eq('estado', 'activo').order('nombre');
  if (padres && padres.length) {
    const core = d.replace(/^CENTRO DE (ACOPIO|FUNDICION)\s*-\s*/i, '').trim().toLowerCase();
    const match = padres.find((a) => a.nombre.toLowerCase() === core)
      ?? padres.find((a) => a.nombre.toLowerCase().includes(core) || core.includes(a.nombre.toLowerCase()))
      ?? padres[0];
    return match.nombre;
  }
  return d;
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

  // Pre-validación ATÓMICA (material): antes de descontar NADA, se simula el gasto de
  // stock de TODAS las líneas (agregando las que repiten producto+almacén). Si a alguna
  // le falta existencia, se lanza un solo error con TODOS los faltantes y no se toca el
  // inventario. Evita el descuento parcial que dejaba la solicitud a medias (se tomaba
  // stock de las primeras líneas y el error seguía apareciendo al reintentar).
  if (s.tipo === 'material') {
    const destinoReal = s.scope === 'traslado' ? await resolverAlmacenDestino(s.almacen_destino || '') : null;
    const disp = new Map<string, number>();
    const faltan: string[] = [];
    for (const it of lineas) {
      const cant = Number(it.cantidad) || 0;
      if (cant <= 0) continue;
      const alm = it.almacen ?? s.almacen_origen ?? '';
      if (destinoReal && alm === destinoReal) continue; // traslado a sí mismo: no mueve stock
      const key = `${it.producto_id}|${alm}`;
      if (!disp.has(key)) {
        const ex = await getExistencia(it.producto_id, alm);
        disp.set(key, Number(ex?.stock) || 0);
      }
      const restante = disp.get(key)!;
      if (restante < cant) {
        faltan.push(`${it.producto_nombre ?? 'Producto'}: pide ${cant}, hay ${restante} en ${alm || '—'}`);
      } else {
        disp.set(key, restante - cant);
      }
    }
    if (faltan.length) {
      throw new Error(`No se ejecutó nada (no se descontó stock): faltan existencias en ${faltan.length} material(es).\n• ${faltan.join('\n• ')}`);
    }
  }

  if (s.scope === 'salida' && s.tipo === 'material') {
    for (const it of lineas) {
      const mov = await salidaMaterial({
        productoId: it.producto_id, almacen: it.almacen ?? s.almacen_origen!, cantidad: Number(it.cantidad) || 0,
        destino: s.destino || '', motivo: s.motivo, precioUnit: it.precio_unit ?? null,
        fechaEntrega: s.fecha_entrega, consumoInterno: s.consumo_interno ?? false, solicitante: s.solicitante, actor, actorName,
      });
      if (!movId) movId = mov.id;
    }
    movRef = 'salida_modulo';
  } else if (s.scope === 'traslado' && s.tipo === 'material') {
    // El destino puede ser una sede/centro: se resuelve a un almacén real para la entrada.
    const destinoReal = await resolverAlmacenDestino(s.almacen_destino || '');
    for (const it of lineas) {
      const origen = it.almacen ?? s.almacen_origen!;
      if (origen === destinoReal) continue; // mismo almacén: nada que mover para ese ítem
      const mov = await trasladoMaterial({
        productoId: it.producto_id, almacenOrigen: origen, almacenDestino: destinoReal,
        cantidad: Number(it.cantidad) || 0, motivo: s.motivo, precioUnit: it.precio_unit ?? null,
        notaEntrega: s.nota_entrega, fechaEntrega: s.fecha_entrega, consumoInterno: s.consumo_interno ?? false, solicitante: s.solicitante, actor, actorName,
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

  // Salida a CLIENTE: genera una cuenta por cobrar (incremental por cliente). El cliente
  // la salda luego en dinero o en producto desde Tesorería. Motivo = "Salida de material · <codigo>".
  let cxcId: string | null = null;
  const cxcMonto = Number(s.cxc_monto) || 0;
  if (s.tipo === 'material' && s.cliente_nombre && cxcMonto > 0) {
    try {
      const cuenta = await registrarSobrepagoCobrar({
        tipo: 'cliente',
        contraparte: s.cliente_nombre,
        monto: cxcMonto,
        moneda: s.cxc_moneda || 'USD',
        origen: 'salida_material',
        nota: `Salida de material · ${s.codigo}`,
        actor,
        actorName,
      });
      cxcId = cuenta.id;
    } catch (e) {
      // No bloquea la salida ya ejecutada: el material salió; la CxC se puede crear a mano.
      console.error('No se pudo crear la cuenta por cobrar de la salida', e);
    }
  }

  const { error } = await supabase
    .from(SOL)
    .update({
      estado: 'ejecutada',
      ejecutada_por: actor,
      ejecutada_en: new Date().toISOString(),
      mov_id: movId,
      mov_ref: movRef,
      cxc_id: cxcId,
      historial: appendHistorial(s, 'ejecutada', actor, cxcId ? { cxc: `Salida de material · ${s.codigo}`, monto: cxcMonto, moneda: s.cxc_moneda || 'USD' } : {}),
    })
    .eq('id', s.id);
  if (error) throw error;
}

/**
 * Cierra una solicitud APROBADA como EJECUTADA **sin descontar stock ni caja**, para el
 * caso en que la salida/traslado YA se hizo por fuera del módulo (ej.: una salida MANUAL
 * de inventario). Sirve para darle la TRAZA a la solicitud (que quede como ejecutada) sin
 * duplicar el descuento. Pide un motivo (queda en el historial) y NO genera movimientos.
 */
export async function cerrarSolicitudSinDescontar(s: SolicitudSalida, motivo: string, actor: string): Promise<void> {
  if (s.estado !== 'aprobada') throw new Error('Solo se cierran así las solicitudes aprobadas.');
  const razon = (motivo || '').trim();
  if (!razon) throw new Error('Indicá por qué se cierra sin descontar (ej.: ya se descontó con una salida manual de inventario).');
  const { error } = await supabase
    .from(SOL)
    .update({
      estado: 'ejecutada',
      ejecutada_por: actor,
      ejecutada_en: new Date().toISOString(),
      mov_id: null,
      mov_ref: 'manual_externo',   // marca: el descuento se hizo por fuera (salida manual de inventario)
      historial: appendHistorial(s, 'cerrada sin descontar (descuento manual por fuera)', actor, { motivo: razon }),
    })
    .eq('id', s.id);
  if (error) throw error;
}

export interface EditarSolicitudSalidaInput {
  /** Detalle multi-producto (manda sobre producto/cantidad de cabecera). */
  items?: ItemSolicitudSalida[] | null;
  productoId?: string | null;
  productoNombre?: string | null;
  almacenOrigen?: string | null;
  almacenDestino?: string | null;
  cantidad?: number | null;
  precioUnit?: number | null;
  destino?: string | null;
  motivo?: string | null;
  fechaEntrega?: string | null;
  consumoInterno?: boolean | null;
  solicitante?: string | null;
  /** Nota / observación adicional (se imprime en la orden). */
  notaEntrega?: string | null;
  /** Datos de despacho (transporte). */
  chofer?: string | null;
  choferCedula?: string | null;
  vehiculo?: string | null;
  vehiculoPlaca?: string | null;
  direccionDespacho?: string | null;
  direccionDestino?: string | null;
  sedeDestino?: string | null;
  /** Cliente + cuenta por cobrar (si la salida/traslado va a un cliente). */
  clienteId?: string | null;
  clienteNombre?: string | null;
  cxcMonto?: number | null;
  cxcMoneda?: string | null;
  /** Solicitudes de DINERO (monto / moneda / cajas). */
  monto?: number | null;
  moneda?: string | null;
  cajaId?: string | null;
  cajaDestinoId?: string | null;
}

/**
 * Edita una solicitud de salida/traslado mientras está POR APROBAR o APROBADA
 * (antes de ejecutarse: todavía no tocó stock/saldo). Permite corregir todos los
 * datos —producto(s), cantidad, almacén origen/destino, precio, destino, motivo,
 * fecha, consumo interno—. No se edita una vez EJECUTADA (ya movió inventario).
 */
export async function editarSolicitudSalida(s: SolicitudSalida, input: EditarSolicitudSalidaInput, actor: string): Promise<SolicitudSalida> {
  if (!['por_aprobar', 'aprobada'].includes(s.estado))
    throw new Error('Solo se edita una solicitud Por aprobar o Aprobada (antes de ejecutarla).');

  const itemsLimpios = (input.items ?? [])
    .map((it) => ({
      producto_id: it.producto_id,
      producto_nombre: it.producto_nombre ?? null,
      cantidad: Number(it.cantidad) || 0,
      precio_unit: it.precio_unit != null ? Number(it.precio_unit) : null,
      unidad: it.unidad ?? null,
      almacen: it.almacen ?? null,
      observacion: it.observacion?.trim() || null,
    }))
    .filter((it) => it.producto_id && it.cantidad > 0);

  const almacenOrigenCab = input.almacenOrigen ?? itemsLimpios.find((it) => it.almacen)?.almacen ?? s.almacen_origen ?? null;

  if (s.tipo === 'material') {
    if (itemsLimpios.length) {
      if (itemsLimpios.some((it) => it.cantidad <= 0)) throw new Error('Cada material debe tener cantidad mayor que 0.');
    } else {
      const cantidad = Number(input.cantidad) || 0;
      if (cantidad <= 0) throw new Error('La cantidad debe ser mayor que 0.');
      if (!input.productoId) throw new Error('Elegí el producto.');
    }
    if (!almacenOrigenCab) throw new Error('Indicá el almacén de origen.');
    if (s.scope === 'traslado') {
      const dest = input.almacenDestino !== undefined ? input.almacenDestino : s.almacen_destino;
      if (!dest) throw new Error('Indicá el almacén destino.');
      if ((itemsLimpios.length ? itemsLimpios.some((it) => it.almacen === dest) : almacenOrigenCab === dest))
        throw new Error('El almacén origen y destino deben ser distintos.');
    } else if (!(input.destino !== undefined ? input.destino?.trim() : s.destino?.trim())) {
      throw new Error('Indicá la unidad solicitante / destino.');
    }
  } else {
    const monto = input.monto != null ? Number(input.monto) : (input.cantidad != null ? Number(input.cantidad) : Number(s.monto) || 0);
    if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
    if (s.scope === 'traslado') {
      const org = input.cajaId !== undefined ? input.cajaId : s.caja_id;
      const dst = input.cajaDestinoId !== undefined ? input.cajaDestinoId : s.caja_destino_id;
      if (!org || !dst) throw new Error('Indicá la caja de origen y la de destino.');
      if (org === dst) throw new Error('La caja de origen y la de destino deben ser distintas.');
    } else if (!(input.cajaId !== undefined ? input.cajaId : s.caja_id)) {
      throw new Error('Indicá la caja de origen.');
    }
  }

  const cab = itemsLimpios[0] ?? null;
  const patch: Record<string, unknown> = {
    producto_id: cab ? cab.producto_id : (input.productoId !== undefined ? input.productoId : s.producto_id),
    producto_nombre: cab ? cab.producto_nombre : (input.productoNombre !== undefined ? input.productoNombre : s.producto_nombre),
    almacen_origen: almacenOrigenCab,
    almacen_destino: input.almacenDestino !== undefined ? input.almacenDestino : s.almacen_destino,
    cantidad: cab ? cab.cantidad : (input.cantidad != null ? Number(input.cantidad) : s.cantidad),
    precio_unit: cab ? cab.precio_unit : (input.precioUnit != null ? Number(input.precioUnit) : s.precio_unit),
    items: itemsLimpios.length ? itemsLimpios : null,
    destino: input.destino !== undefined ? (input.destino?.trim() || null) : s.destino,
    motivo: input.motivo !== undefined ? (input.motivo?.trim() || null) : s.motivo,
    fecha_entrega: input.fechaEntrega !== undefined ? (input.fechaEntrega || null) : s.fecha_entrega,
    consumo_interno: input.consumoInterno !== undefined ? !!input.consumoInterno : s.consumo_interno,
    solicitante: (input.solicitante?.trim()) || s.solicitante,
    historial: appendHistorial(s, 'editada', actor),
  };
  // Nota / observación (ambos tipos).
  if (input.notaEntrega !== undefined) patch.nota_entrega = input.notaEntrega?.trim() || null;
  // Despacho + cliente/CxC (material).
  if (s.tipo === 'material') {
    if (input.chofer !== undefined) patch.chofer = input.chofer?.trim() || null;
    if (input.choferCedula !== undefined) patch.chofer_cedula = input.choferCedula?.trim() || null;
    if (input.vehiculo !== undefined) patch.vehiculo = input.vehiculo?.trim() || null;
    if (input.vehiculoPlaca !== undefined) patch.vehiculo_placa = input.vehiculoPlaca?.trim() || null;
    if (input.direccionDespacho !== undefined) patch.direccion_despacho = input.direccionDespacho?.trim() || null;
    if (input.direccionDestino !== undefined) patch.direccion_destino = input.direccionDestino?.trim() || null;
    if (input.sedeDestino !== undefined) patch.sede_destino = input.sedeDestino?.trim() || null;
    if (input.clienteId !== undefined) patch.cliente_id = input.clienteId || null;
    if (input.clienteNombre !== undefined) patch.cliente_nombre = input.clienteNombre?.trim() || null;
    if (input.cxcMonto !== undefined) patch.cxc_monto = input.cxcMonto != null ? Number(input.cxcMonto) : null;
    if (input.cxcMoneda !== undefined) patch.cxc_moneda = input.cxcMoneda || null;
  }
  // Monto / moneda / cajas (dinero).
  if (s.tipo === 'dinero') {
    if (input.monto !== undefined) patch.monto = Number(input.monto) || 0;
    if (input.moneda !== undefined) patch.moneda = input.moneda || s.moneda;
    if (input.cajaId !== undefined) patch.caja_id = input.cajaId || null;
    if (input.cajaDestinoId !== undefined) patch.caja_destino_id = input.cajaDestinoId || null;
  }
  const { data, error } = await supabase.from(SOL).update(patch).eq('id', s.id).select('*').single();
  if (error) throw error;
  // Mantener sincronizada la unidad solicitante en el catálogo compartido con OP.
  if (s.tipo === 'material' && s.scope === 'salida' && input.destino) void ensureUnidadSolicitante(input.destino, actor);
  return data as SolicitudSalida;
}

/**
 * Edita SOLO la nota / motivo / detalle de una solicitud (cualquier estado, incluida
 * EJECUTADA). No toca stock, caja, ítems ni el estado: es una anotación adicional del
 * usuario. Se refleja en el detalle y en el PDF de la orden.
 */
export async function editarNotaSolicitudSalida(
  s: SolicitudSalida,
  input: { motivo?: string | null; notaEntrega?: string | null },
  actor: string,
): Promise<SolicitudSalida> {
  const motivo = input.motivo !== undefined ? (input.motivo?.trim() || null) : undefined;
  const nota = input.notaEntrega !== undefined ? (input.notaEntrega?.trim() || null) : undefined;

  const patch: Record<string, unknown> = { historial: appendHistorial(s, 'nota editada', actor) };
  if (motivo !== undefined) patch.motivo = motivo;
  if (nota !== undefined) patch.nota_entrega = nota;
  const { data, error } = await supabase.from(SOL).update(patch).eq('id', s.id).select('*').single();
  if (error) throw error;

  // Propaga la nota al MOVIMIENTO ya generado (para que se vea en el comprobante/kardex
  // y en el PDF de dinero, que no tiene "orden"). Best-effort: no bloquea la edición.
  if (s.mov_id && s.mov_ref) {
    try {
      if (s.mov_ref === 'salida_dinero' || s.mov_ref === 'traslado_dinero') {
        const p: Record<string, unknown> = {};
        if (motivo !== undefined) p.motivo = motivo;
        if (nota !== undefined) p.nota_entrega = nota;
        if (Object.keys(p).length) await supabase.from('movimientos_caja').update(p).eq('id', s.mov_id);
      } else if (s.mov_ref === 'salida_modulo') {
        // En una salida de material, detalle = motivo (texto plano).
        const p: Record<string, unknown> = {};
        if (motivo !== undefined) p.detalle = motivo;
        if (nota !== undefined) p.nota_entrega = nota;
        if (Object.keys(p).length) await supabase.from('movimientos').update(p).eq('id', s.mov_id);
      } else if (s.mov_ref === 'traslado_modulo') {
        // El detalle del traslado es compuesto ("Traslado a X · motivo"): solo la nota.
        if (nota !== undefined) await supabase.from('movimientos').update({ nota_entrega: nota }).eq('id', s.mov_id);
      }
    } catch { /* la nota en el movimiento es best-effort */ }
  }
  return data as SolicitudSalida;
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
