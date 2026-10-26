/* ============================================================
   MGG · Control de Maquinaria · Flota y Servicio (Supabase)
   Estado operativo del equipo (con historial), órdenes de servicio y
   las lecturas del expediente (compras, surtidos, fotos).

   La orden de servicio NO mueve stock ni compra por su cuenta:
     · lo que sale del inventario se pide con una SOLICITUD DE SALIDA
       (Salidas, queda «por aprobar» y descuenta al ejecutarse);
     · lo que falta se pide con una SOLICITUD DE PEDIDO (Pedidos, SP).
   La salida se crea con el permiso de Salidas; si el usuario no lo tiene,
   queda «por solicitar». La SP la crea la app con el flujo de Pedidos de MGG
   (crearOrden) y da de alta las piezas que no estaban en el inventario
   (createProducto, stock 0) antes de pedirlas (13-10).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ItemOrden, ItemSolicitudSalida } from '@/shared/lib/types';
import { crearSolicitudSalida } from '@/modules/salidas/salidas.repository';
import { crearOrden, ensureUnidadSolicitante } from '@/modules/pedidos/pedidos.repository';
import { addCategoria, createProducto, siguienteSkuGlobal } from '@/modules/inventario/inventario.repository';
import { notify } from '@/shared/lib/notify';
import { listFotosOrden, borrarArchivosFotosOrden } from './osFotos.repository';
import { listFotosEquipo, urlsFotosEquipo } from './fotosEquipo.repository';
import type { EstadoEquipo, EstadoOrdenServicio, RepuestoOrden } from './flota';
import { servicioPorId, piezasNuevas } from './flota';
export { faltaSalida, faltaCompra } from './flota';

/* ───────── Estado operativo ───────── */

export interface EventoEstado {
  id: string;
  equipo_id: string;
  estado_anterior: string | null;
  estado: EstadoEquipo;
  motivo: string | null;
  material: string | null;
  nota: string | null;
  orden_servicio_id: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

/** Cambia el estado del equipo (avería, parada, espera, retiro, reactivar…) y deja el evento. */
export async function cambiarEstadoEquipo(equipoId: string, estado: EstadoEquipo, motivo?: string | null, material?: string | null, nota?: string | null): Promise<void> {
  const { error } = await supabase.rpc('maquinaria_cambiar_estado', {
    p_equipo_id: equipoId, p_estado: estado, p_motivo: motivo ?? null, p_material: material ?? null, p_nota: nota ?? null,
  });
  if (error) throw error;
}

/** Corrige el motivo, lo que falta y la nota de un cambio de estado (el estado no se cambia). */
export async function editarEventoEstado(id: string, motivo: string | null, material: string | null, nota: string | null): Promise<void> {
  const { error } = await supabase.rpc('maquinaria_editar_evento_estado', { p_id: id, p_motivo: motivo, p_material: material, p_nota: nota });
  if (error) throw error;
}

/**
 * Borra un cambio de estado. Si era el vigente, la base devuelve el equipo al estado
 * anterior; los que registró una orden que sigue existiendo se manejan desde la orden.
 */
export async function eliminarEventoEstado(id: string): Promise<void> {
  const { data, error } = await supabase.from('maquinaria_estado_eventos').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo borrar el cambio de estado (puede que ya no exista o que no tengas permiso).');
}

export async function listEventosEstado(equipoId: string): Promise<EventoEstado[]> {
  const { data, error } = await supabase.from('maquinaria_estado_eventos').select('*')
    .eq('equipo_id', equipoId).order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  return (data ?? []) as EventoEstado[];
}

/* ───────── Órdenes de servicio ───────── */

export interface OrdenServicio {
  id: string;
  codigo: string;
  equipo_id: string;
  tipo: string;
  urgencia: 'normal' | 'alta' | 'urgente';
  intervenciones: string[];
  /** Qué se hace dentro del tipo (ej. cauchos: «Caucho espichado»). */
  trabajos: string[];
  origen: 'interno' | 'externo';
  responsable: string | null;
  descripcion: string | null;
  estado: EstadoOrdenServicio;
  repuestos: RepuestoOrden[];
  horometro: number | null;
  kilometraje: number | null;
  solicitud_salida_id: string | null;
  orden_compra_id: string | null;
  estado_equipo_previo: string | null;
  nota_cierre: string | null;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
  updated_at: string | null;
  cerrada_at: string | null;
  /** Cuándo se avisó a Compras de las piezas que no están en el inventario. */
  compras_notificada_at: string | null;
}

export async function listOrdenesServicio(equipoId?: string): Promise<OrdenServicio[]> {
  let q = supabase.from('maquinaria_ordenes_servicio').select('*').order('created_at', { ascending: false });
  if (equipoId) q = q.eq('equipo_id', equipoId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OrdenServicio[];
}

/** Órdenes abiertas por equipo (para el catálogo). */
export async function ordenesAbiertasPorEquipo(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('maquinaria_ordenes_servicio').select('equipo_id')
    .in('estado', ['abierta', 'repuestos', 'en_proceso']);
  if (error) throw error;
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { equipo_id: string }[]) out.set(r.equipo_id, (out.get(r.equipo_id) ?? 0) + 1);
  return out;
}

export interface NuevaOrdenServicio {
  equipo_id: string;
  tipo: string;
  urgencia: 'normal' | 'alta' | 'urgente';
  intervenciones: string[];
  /** Qué se hace dentro del tipo (ej. cauchos: «Caucho espichado»). */
  trabajos: string[];
  origen: 'interno' | 'externo';
  responsable: string;
  descripcion: string;
  horometro: number | null;
  kilometraje: number | null;
  repuestos: { producto_id: string | null; nombre: string; unidad: string; cantidad: number }[];
}

/** Crea la orden. La base decide el origen de cada repuesto con el stock real del momento. */
export async function crearOrdenServicio(input: NuevaOrdenServicio): Promise<{ id: string; codigo: string; estado: EstadoOrdenServicio; repuestos: RepuestoOrden[] }> {
  const { data, error } = await supabase.rpc('maquinaria_crear_orden_servicio', { p: input });
  if (error) throw error;
  return data as { id: string; codigo: string; estado: EstadoOrdenServicio; repuestos: RepuestoOrden[] };
}

export async function avanzarOrdenServicio(id: string, estado: EstadoOrdenServicio, nota?: string | null): Promise<void> {
  const { error } = await supabase.rpc('maquinaria_avanzar_orden_servicio', { p_id: id, p_estado: estado, p_nota: nota ?? null });
  if (error) throw error;
}

async function vincular(id: string, salida: string | null, compra: string | null): Promise<void> {
  const { error } = await supabase.rpc('maquinaria_vincular_orden_servicio', { p_id: id, p_salida: salida, p_compra: compra });
  if (error) throw error;
}

interface Actor { email: string; nombre: string | null }

/**
 * Pide al inventario lo que sale de stock: una solicitud de salida «por aprobar»
 * (flujo de Salidas). No descuenta nada hasta que Salidas la ejecute.
 */
/** Unidad solicitante con la que Maquinaria pide salidas y compras (catálogo de Pedidos). */
export const UNIDAD_MAQUINARIA = 'MANTENIMIENTO DE MAQUINARIA';

export async function solicitarSalidaDeOrden(o: OrdenServicio, equipoNombre: string, actor: Actor): Promise<string> {
  const items: ItemSolicitudSalida[] = o.repuestos
    .filter((r) => r.producto_id && r.desde_inventario > 0)
    .map((r) => ({
      producto_id: r.producto_id as string,
      producto_nombre: r.nombre,
      unidad: r.unidad,
      cantidad: r.desde_inventario,
      precio_unit: 0,
      almacen: r.almacen,
      observacion: `${o.codigo} · ${equipoNombre}`,
      // El equipo al que va el material: así la salida queda en el kardex como consumo de ESTA máquina.
      equipo_id: o.equipo_id,
      equipo_nombre: equipoNombre,
    }));
  if (!items.length) throw new Error('Esta orden no tiene repuestos que salgan del inventario.');
  const sin = items.find((i) => !i.almacen);
  if (sin) throw new Error(`«${sin.producto_nombre}» no tiene almacén en el inventario: corrígelo en Inventario y vuelve a intentar.`);
  const servicio = servicioPorId(o.tipo)?.label ?? o.tipo;
  // En MGG el «destino» de una salida de material es la unidad solicitante (catálogo de Pedidos).
  await ensureUnidadSolicitante(UNIDAD_MAQUINARIA, actor.email);
  const sol = await crearSolicitudSalida({
    scope: 'salida', tipo: 'material',
    solicitante: (actor.nombre || actor.email).toUpperCase(),
    destino: UNIDAD_MAQUINARIA,
    motivo: `Orden de servicio ${o.codigo} · ${equipoNombre} · ${servicio}`,
    items, actor: actor.email, actorName: actor.nombre,
  });
  await vincular(o.id, sol.id, null);
  return sol.codigo;
}

/** Datos de una pieza nueva para darla de alta al pedir la compra. */
export interface PiezaNuevaAlta { nombre: string; categoria: string; unidad?: string }

/** Categoría con la que Maquinaria da de alta sus piezas nuevas si no se eligió otra. */
const CATEGORIA_PIEZAS = 'REPUESTOS';
/** Almacén «casa» de las piezas nuevas: el General (Matanzas). El stock real entra al recibir la compra. */
const ALMACEN_PIEZAS = 'General';

/** «Caucho 11R22.5 para CAMION NHR (PLACA A12BC3D)»: la finalidad de la solicitud de pedido. */
function finalidadDeOrden(o: OrdenServicio, equipo: { equipo: string; placa?: string | null; serial?: string | null }): string {
  const trabajos = (o.trabajos ?? []).map((t) => t.trim()).filter(Boolean);
  const que = trabajos.length === 1 ? trabajos[0]
    : trabajos.length > 1 ? `${trabajos.slice(0, -1).join(', ')} y ${trabajos[trabajos.length - 1]}`
    : servicioPorId(o.tipo)?.label ?? o.descripcion ?? 'Servicio';
  const limpio = (v: string | null | undefined) => (v ?? '').replace(/[\s./-]/g, '').toUpperCase();
  const id = !['', 'SN', 'NA', 'NO', 'SINPLACA', '0'].includes(limpio(equipo.placa)) ? ` (PLACA ${(equipo.placa ?? '').trim()})`
    : !['', 'SN', 'NA', 'NO', '0'].includes(limpio(equipo.serial)) ? ` (SERIAL ${(equipo.serial ?? '').trim()})` : '';
  return `${que} para ${equipo.equipo}${id}`.toUpperCase();
}

/**
 * Pide la compra de lo que falta: crea la SOLICITUD DE PEDIDO en Pedidos («pendiente», flujo
 * normal de MGG) y antes da de alta como producto (stock 0, categoría elegida o REPUESTOS)
 * las piezas que no estaban en el inventario. Devuelve el código de la SP.
 */
export async function solicitarCompraDeOrden(o: Pick<OrdenServicio, 'id'>, nuevasOactor?: PiezaNuevaAlta[] | Actor, actorOpt?: Actor): Promise<string> {
  const actor: Actor = (actorOpt ?? (Array.isArray(nuevasOactor) ? { email: 'sistema', nombre: null } : nuevasOactor)) as Actor;
  const { data: fila, error: eo } = await supabase.from('maquinaria_ordenes_servicio').select('*').eq('id', o.id).maybeSingle();
  if (eo) throw eo;
  if (!fila) throw new Error('La orden no existe (puede que la hayan borrado).');
  const orden = fila as OrdenServicio;
  if (orden.orden_compra_id) throw new Error(`La orden ${orden.codigo} ya tiene su solicitud de pedido.`);
  if (orden.estado !== 'abierta' && orden.estado !== 'repuestos') throw new Error('Solo se pide la compra de una orden abierta o esperando repuestos.');
  const { data: eq } = await supabase.from('maquinaria_equipos').select('id, equipo, placa, serial').eq('id', orden.equipo_id).maybeSingle();
  const equipo = (eq ?? { id: orden.equipo_id, equipo: 'equipo', placa: null, serial: null }) as { id: string; equipo: string; placa: string | null; serial: string | null };
  const finalidad = finalidadDeOrden(orden, equipo);

  // 1. Los repuestos por comprar pasan a Compras con su nombre general.
  // NO se guardan en el inventario (productos) porque el usuario de taller no conoce el nombre
  // comercial exacto. El analista de compras colocará el nombre real.
  const repuestos: RepuestoOrden[] = orden.repuestos.map((r) => ({
    ...r,
    pieza_nueva: r.producto_id ? (r.pieza_nueva ?? null) : (r.pieza_nueva ?? r.nombre),
  }));

  // 2. La solicitud de pedido (SP) en Pedidos, casada al equipo.
  const items: ItemOrden[] = [];
  for (const r of repuestos) {
    if (!(r.a_comprar > 0)) continue;
    let sku = '';
    let unidad = r.unidad || 'und';
    if (r.producto_id) {
      const { data: p } = await supabase.from('productos').select('sku, unidad').eq('id', r.producto_id).maybeSingle();
      if (p) {
        sku = (p as { sku?: string }).sku ?? '';
        unidad = (p as { unidad?: string }).unidad ?? unidad;
      }
    }
    items.push({
      productoId: r.producto_id ?? undefined,
      sku,
      nombre: r.nombre.trim().toUpperCase(),
      cantidad: r.a_comprar,
      precio: 0,
      unidad,
      comprar: true,
      finalidad,
      equipo_id: equipo.id,
      equipo_nombre: equipo.equipo,
    });
  }

  if (!items.length) throw new Error('Esta orden no tiene repuestos por comprar.');
  await ensureUnidadSolicitante(UNIDAD_MAQUINARIA, actor.email);
  const notas = `Orden de servicio ${orden.codigo} · ${equipo.equipo}.`;
  const sp = await crearOrden({
    proveedor_id: null, items, notas, motivo: null, finalidad, clasificacion: ['Mantenimiento'],
    solicitante_email: actor.email, solicitante: UNIDAD_MAQUINARIA, solicitante_persona: actor.nombre ?? null,
    ci_solicitante: null, urgente: orden.urgencia === 'urgente',
  });

  // 3. La orden queda con su SP vinculada.
  const { error: eu } = await supabase.from('maquinaria_ordenes_servicio').update({ repuestos }).eq('id', orden.id);
  if (eu) throw eu;
  await vincular(orden.id, null, sp.id);
  await supabase.from('notificaciones').update({ read: true }).eq('dedup_key', `maq-os-piezas-${orden.id}`).eq('read', false).then(() => undefined, () => undefined);
  notify(`🛒 Solicitud de pedido ${sp.codigo} · ${orden.codigo} (${equipo.equipo})`, 'info', {
    link: '#/app/pedidos', destino: 'admin', dedup_key: `maq-os-sp-${orden.id}`,
    detail: `Repuestos de la orden de servicio ${orden.codigo}. El analista de compras colocará el nombre comercial exacto en Pedidos.`,
  });
  return sp.codigo;
}

/* ───────── Compras del equipo (lectura) ───────── */

export interface CompraEquipo {
  id: string;
  codigo: string;
  oc_codigo: string | null;
  tipo: string | null;
  estado: string;
  created_at: string;
  total: number | null;
  total_moneda: string | null;
  lineas: { nombre: string; cantidad: number; unidad: string | null }[];
  /** Orden de servicio que la pidió (si salió de una). */
  orden_servicio: string | null;
}

/**
 * Solicitudes de pedido / servicio del equipo: las que tienen un renglón casado al
 * equipo (servicios de Pedidos y repuestos pedidos desde una orden de servicio) y las
 * vinculadas a sus órdenes de servicio.
 */
export async function comprasDeEquipo(equipoId: string, ordenes: OrdenServicio[]): Promise<CompraEquipo[]> {
  const vinculadas = ordenes.map((o) => o.orden_compra_id).filter(Boolean) as string[];
  // En MGG la orden guarda su clase ('producto' | 'servicio') y la moneda en `clase` y `moneda`.
  const cols = 'id, codigo, oc_codigo, clase, estado, created_at, total, moneda, items';
  const [porItem, porId] = await Promise.all([
    supabase.from('ordenes').select(cols).contains('items', [{ equipo_id: equipoId }]).order('created_at', { ascending: false }),
    vinculadas.length ? supabase.from('ordenes').select(cols).in('id', vinculadas) : Promise.resolve({ data: [], error: null }),
  ]);
  if (porItem.error) throw porItem.error;
  if (porId.error) throw porId.error;
  const porCompra = new Map(ordenes.filter((o) => o.orden_compra_id).map((o) => [o.orden_compra_id as string, o.codigo]));
  const vistos = new Map<string, CompraEquipo>();
  for (const r of [...(porItem.data ?? []), ...(porId.data ?? [])] as Array<Record<string, unknown>>) {
    const id = r.id as string;
    if (vistos.has(id)) continue;
    const items = Array.isArray(r.items) ? (r.items as Array<{ nombre?: string; cantidad?: number; unidad?: string; equipo_id?: string | null }>) : [];
    const propias = items.filter((i) => !i.equipo_id || i.equipo_id === equipoId);
    vistos.set(id, {
      id, codigo: r.codigo as string, oc_codigo: (r.oc_codigo as string) ?? null, tipo: (r.clase as string) ?? null,
      estado: r.estado as string, created_at: r.created_at as string,
      total: r.total != null ? Number(r.total) : null, total_moneda: (r.moneda as string) ?? null,
      lineas: propias.map((i) => ({ nombre: i.nombre ?? '—', cantidad: Number(i.cantidad) || 0, unidad: i.unidad ?? null })),
      orden_servicio: porCompra.get(id) ?? null,
    });
  }
  return [...vistos.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Estado de las solicitudes de salida vinculadas a órdenes de servicio. */
export async function salidasDeOrdenes(ordenes: OrdenServicio[]): Promise<Map<string, { codigo: string; estado: string }>> {
  const ids = ordenes.map((o) => o.solicitud_salida_id).filter(Boolean) as string[];
  const out = new Map<string, { codigo: string; estado: string }>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from('solicitudes_salida').select('id, codigo, estado').in('id', ids);
  if (error) throw error;
  for (const r of (data ?? []) as { id: string; codigo: string; estado: string }[]) out.set(r.id, { codigo: r.codigo, estado: r.estado });
  return out;
}

/* ───────── Combustible del equipo (lectura) ───────── */

export interface SurtidoEquipo {
  id: string;
  fecha: string;
  litros: number;
  horometro_fin: number | null;
  kilometraje: number | null;
  ubicacion: string | null;
  autorizado_por: string | null;
}

/** Últimos surtidos (consumo) del equipo vinculado en Combustible. */
export async function surtidosDeEquipo(nombreCombustible: string | null | undefined, limite = 25): Promise<SurtidoEquipo[]> {
  const nombre = (nombreCombustible ?? '').trim();
  if (!nombre) return [];
  const { data, error } = await supabase.from('combustible_tanque_movimientos')
    .select('id, fecha, litros, horometro_final, kilometraje_final, destino, autorizado_por')
    .eq('equipo', nombre).eq('tipo', 'consumo')
    .order('fecha', { ascending: false }).order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; fecha: string; litros: number; horometro_final: number | null; kilometraje_final: number | null; destino: string | null; autorizado_por: string | null }>)
    .map((r) => ({ id: r.id, fecha: r.fecha, litros: Number(r.litros) || 0, horometro_fin: r.horometro_final, kilometraje: r.kilometraje_final, ubicacion: r.destino, autorizado_por: r.autorizado_por }));
}

/* ───────── Fotos del equipo (tabla maquinaria_fotos, 16-10-2026) ─────────
   Antes salían de las IMÁGENES de los documentos (📎): la portada terminaba siendo
   el RCV. Ahora las fotos tienen su tabla, con orden (0 = portada). */

export interface FotoEquipo { id: string; equipo_id: string; nombre: string; url: string; path: string; orden: number; created_at: string; encuadre: 'cubrir' | 'completa' }

/** Fotos de uno o de todos los equipos, portada primero, con URL firmada (1 h). */
export async function fotosDeEquipos(equipoId?: string): Promise<FotoEquipo[]> {
  const rows = await listFotosEquipo(equipoId);
  if (!rows.length) return [];
  const urls = await urlsFotosEquipo(rows.map((r) => r.path));
  return rows.flatMap((r) => {
    const url = urls.get(r.path);
    return url ? [{ id: r.id, equipo_id: r.equipo_id, nombre: r.nombre || r.filename, url, path: r.path, orden: r.orden, created_at: r.created_at, encuadre: r.encuadre === 'completa' ? 'completa' : 'cubrir' }] : [];
  });
}

/* ───────── Piezas nuevas: aviso a Compras y cambio por el producto ───────── */

/**
 * Avisa a Compras (notificación persistente dirigida al rol analista_de_compras, con el
 * código OS, el equipo y la lista de piezas; enlaza al expediente) de las
 * piezas de la orden que no existen en el inventario: las da de alta Compras, la orden
 * no crea productos. Deja constancia en la orden. Devuelve false si no había piezas.
 */
export async function notificarComprasPiezasNuevas(o: Pick<OrdenServicio, 'id' | 'repuestos'>): Promise<boolean> {
  if (!piezasNuevas(o.repuestos).length) return false;
  // En el servidor (RPC): quien crea la orden no tiene el rol de Compras y no podría leer
  // de vuelta una notificación dirigida a ese rol. Inserta el aviso y marca la orden juntos.
  const { data, error } = await supabase.rpc('maquinaria_notificar_compras_piezas', { p_id: o.id });
  if (error) throw error;
  return data === true;
}

export interface EdicionOrdenServicio {
  tipo: string;
  urgencia: 'normal' | 'alta' | 'urgente';
  intervenciones: string[];
  /** Qué se hace dentro del tipo (ej. cauchos: «Caucho espichado»). */
  trabajos: string[];
  origen: 'interno' | 'externo';
  responsable: string;
  descripcion: string;
  horometro: number | null;
  kilometraje: number | null;
  /** Solo en órdenes cerradas (realizada / anulada). */
  nota_cierre?: string | null;
  /** Solo si se cambiaron (y la orden lo permite): la base vuelve a decidir inventario / compra. */
  repuestos?: NuevaOrdenServicio['repuestos'];
}

/** Edita la orden. Si cambiaron las piezas nuevas, `notificar` pide volver a avisar a Compras. */
export async function editarOrdenServicio(id: string, input: EdicionOrdenServicio): Promise<{ codigo: string; estado: EstadoOrdenServicio; repuestos: RepuestoOrden[]; notificar: boolean }> {
  const { data, error } = await supabase.rpc('maquinaria_editar_orden_servicio', { p_id: id, p: input });
  if (error) throw error;
  return data as { codigo: string; estado: EstadoOrdenServicio; repuestos: RepuestoOrden[]; notificar: boolean };
}

/**
 * Borra la orden con sus fotos. La base valida (una orden realizada solo la borra un
 * administrador) y, si estaba en curso, devuelve el equipo al estado que tenía antes.
 * Los archivos de las fotos se borran desde la app y solo si la orden se borró.
 */
export async function eliminarOrdenServicio(o: Pick<OrdenServicio, 'id' | 'codigo'>): Promise<void> {
  const fotos = await listFotosOrden(o.id).catch(() => []);
  const { data, error } = await supabase.from('maquinaria_ordenes_servicio').delete().eq('id', o.id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(`No se pudo borrar la orden ${o.codigo} (puede que ya no exista o que no tengas permiso).`);
  await borrarArchivosFotosOrden(fotos.map((f) => f.path));
}

/** Elimina todas las órdenes de servicio registradas como prueba en Maquinaria. */
export async function eliminarTodasLasOrdenesPrueba(): Promise<number> {
  const { data: ords } = await supabase.from('maquinaria_ordenes_servicio').select('id, codigo');
  if (!ords || !ords.length) return 0;
  let borradas = 0;
  for (const o of ords) {
    try {
      await eliminarOrdenServicio(o);
      borradas++;
    } catch { /* continua con las demas */ }
  }
  return borradas;
}

/** Cambia una pieza nueva por el producto del inventario y vuelve a decidir inventario / compra. */
export async function reemplazarPiezaOrden(ordenId: string, indice: number, productoId: string): Promise<RepuestoOrden> {
  const { data, error } = await supabase.rpc('maquinaria_reemplazar_pieza_orden', { p_id: ordenId, p_indice: indice, p_producto_id: productoId });
  if (error) throw error;
  return data as RepuestoOrden;
}

/* ───────── Lavados ───────── */

export interface LavadoEquipo {
  id: string;
  equipo_id: string;
  fecha: string;
  tipo: string;
  responsable: string | null;
  horometro: number | null;
  kilometraje: number | null;
  nota: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

export async function listLavados(equipoId: string): Promise<LavadoEquipo[]> {
  const { data, error } = await supabase.from('maquinaria_lavados').select('*')
    .eq('equipo_id', equipoId).order('fecha', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as LavadoEquipo[];
}

export interface NuevoLavado {
  equipo_id: string;
  fecha: string;          // ISO
  tipo: string;
  responsable: string | null;
  horometro: number | null;
  kilometraje: number | null;
  nota: string | null;
}

export async function registrarLavado(input: NuevoLavado, actor: { email: string; nombre: string | null }): Promise<void> {
  const tipo = input.tipo.trim();
  if (tipo.length < 3) throw new Error('Indica el tipo de lavado (al menos 3 letras).');
  const { error } = await supabase.from('maquinaria_lavados').insert({
    ...input, tipo,
    responsable: input.responsable?.trim() || null,
    nota: input.nota?.trim() || null,
    actor: actor.email, actor_name: actor.nombre,
  });
  if (error) throw error;
}

export async function actualizarLavado(id: string, input: Omit<NuevoLavado, 'equipo_id'>): Promise<void> {
  const tipo = input.tipo.trim();
  if (tipo.length < 3) throw new Error('Indica el tipo de lavado (al menos 3 letras).');
  const { data, error } = await supabase.from('maquinaria_lavados').update({
    ...input, tipo,
    responsable: input.responsable?.trim() || null,
    nota: input.nota?.trim() || null,
  }).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo guardar el lavado (puede que ya no exista o que no tengas permiso).');
}

/** Borra un lavado (con permiso de Maquinaria). */
export async function eliminarLavado(id: string): Promise<void> {
  const { data, error } = await supabase.from('maquinaria_lavados').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo borrar el lavado (puede que ya no exista o que no tengas permiso).');
}

/* ───────── Lecturas para los submódulos (todos los equipos) ───────── */

/** Historial global de cambios de estado (más reciente primero). */
export async function listEventosEstadoTodos(limite = 2000): Promise<EventoEstado[]> {
  const { data, error } = await supabase.from('maquinaria_estado_eventos').select('*')
    .order('created_at', { ascending: false }).limit(limite);
  if (error) throw error;
  return (data ?? []) as EventoEstado[];
}

/** Todos los lavados (más reciente primero). */
export async function listLavadosTodos(limite = 5000): Promise<LavadoEquipo[]> {
  const { data, error } = await supabase.from('maquinaria_lavados').select('*')
    .order('fecha', { ascending: false }).limit(limite);
  if (error) throw error;
  return (data ?? []) as LavadoEquipo[];
}

export interface CompraResumen { id: string; codigo: string; oc_codigo: string | null; estado: string; created_at: string; total: number | null; total_moneda: string | null }

/** Las solicitudes de pedido / OC vinculadas a órdenes de servicio (por id). */
export async function comprasPorIds(ids: string[]): Promise<Map<string, CompraResumen>> {
  const out = new Map<string, CompraResumen>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return out;
  const { data, error } = await supabase.from('ordenes').select('id, codigo, oc_codigo, estado, created_at, total, moneda').in('id', unicos);
  if (error) throw error;
  for (const r of (data ?? []) as Array<Omit<CompraResumen, 'total_moneda'> & { moneda: string | null }>) {
    out.set(r.id, { id: r.id, codigo: r.codigo, oc_codigo: r.oc_codigo, estado: r.estado, created_at: r.created_at, total: r.total != null ? Number(r.total) : null, total_moneda: r.moneda ?? null });
  }
  return out;
}

/* ───────── Contador (horómetro / km) en dos vías con Combustible ───────── */

export type OrigenLectura = 'maquinaria' | 'combustible' | 'bitacora';

export interface LecturaVigente {
  horometro: number | null;
  horometro_fecha: string | null;
  horometro_origen: OrigenLectura | null;
  kilometraje: number | null;
  km_fecha: string | null;
  km_origen: OrigenLectura | null;
}

const SIN_LECTURA: LecturaVigente = { horometro: null, horometro_fecha: null, horometro_origen: null, kilometraje: null, km_fecha: null, km_origen: null };

/**
 * Lectura vigente de TODOS los equipos (una sola consulta): la mayor entre Combustible,
 * Maquinaria y la bitácora, desde la última corrección. Es la que usan las alertas de
 * mantenimiento, el catálogo, el expediente y Servicio de Mantenimiento.
 */
export async function lecturasVigentesPorEquipo(): Promise<Map<string, LecturaVigente>> {
  const { data, error } = await supabase.rpc('maquinaria_lecturas_vigentes');
  if (error) throw error;
  const out = new Map<string, LecturaVigente>();
  for (const r of (data ?? []) as Array<LecturaVigente & { equipo_id: string }>) {
    out.set(r.equipo_id, {
      horometro: r.horometro == null ? null : Number(r.horometro), horometro_fecha: r.horometro_fecha, horometro_origen: r.horometro_origen,
      kilometraje: r.kilometraje == null ? null : Number(r.kilometraje), km_fecha: r.km_fecha, km_origen: r.km_origen,
    });
  }
  return out;
}

/** Lectura vigente de un equipo. */
export async function lecturaVigenteEquipo(equipoId: string): Promise<LecturaVigente> {
  const m = await lecturasVigentesPorEquipo();
  return m.get(equipoId) ?? SIN_LECTURA;
}

/** Horómetro y km vigentes de un equipo (para las ventanas que los precargan). */
export async function lecturasVigentesEquipo(e: { id: string }): Promise<{ horometro: number | null; km: number | null }> {
  const v = await lecturaVigenteEquipo(e.id);
  return { horometro: v.horometro, km: v.kilometraje };
}

export interface LecturaMedidor {
  origen: OrigenLectura;
  referencia: string;
  fecha: string;
  horometro: number | null;
  kilometraje: number | null;
  es_correccion: boolean;
  actor: string | null;
}

/** Historial de lecturas del equipo, de las tres fuentes (más reciente primero). */
export async function listLecturasEquipo(equipoId: string, limite = 60): Promise<LecturaMedidor[]> {
  const { data, error } = await supabase.from('maquinaria_lecturas_unificadas')
    .select('origen, referencia, fecha, horometro, kilometraje, es_correccion, actor')
    .eq('equipo_id', equipoId).order('fecha', { ascending: false }).limit(limite);
  if (error) throw error;
  return ((data ?? []) as LecturaMedidor[]).map((r) => ({
    ...r, horometro: r.horometro == null ? null : Number(r.horometro), kilometraje: r.kilometraje == null ? null : Number(r.kilometraje),
  }));
}

export interface NuevaLectura {
  equipo_id: string;
  horometro: number | null;
  kilometraje: number | null;
  fecha: string;        // ISO
  nota: string | null;
  /** Corrección hacia abajo (cambio de horómetro, error): solo admin y con motivo. */
  correccion?: boolean;
  motivo?: string | null;
}

/**
 * Registra un horómetro y/o km desde Maquinaria. La base no deja que sea menor que la
 * vigente (salvo corrección de un admin con motivo). El próximo surtido del equipo en
 * Combustible arranca desde esta lectura.
 */
export async function registrarLectura(l: NuevaLectura): Promise<void> {
  const { error } = await supabase.rpc('maquinaria_registrar_lectura', {
    p_equipo_id: l.equipo_id, p_horometro: l.horometro, p_kilometraje: l.kilometraje, p_fecha: l.fecha,
    p_nota: l.nota, p_correccion: !!l.correccion, p_motivo: l.motivo ?? null,
  });
  if (error) throw error;
}

export interface LecturaMaquinaria {
  id: string;
  equipo_id: string;
  fecha: string;
  horometro: number | null;
  kilometraje: number | null;
  nota: string | null;
  es_correccion: boolean;
  motivo_correccion: string | null;
}

/** Una lectura registrada desde Maquinaria (para editarla). */
export async function getLectura(id: string): Promise<LecturaMaquinaria | null> {
  const { data, error } = await supabase.from('maquinaria_lecturas')
    .select('id, equipo_id, fecha, horometro, kilometraje, nota, es_correccion, motivo_correccion').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as LecturaMaquinaria;
  return { ...r, horometro: r.horometro == null ? null : Number(r.horometro), kilometraje: r.kilometraje == null ? null : Number(r.kilometraje) };
}

/**
 * Edita una lectura de Maquinaria. Sin ser administrador tiene que quedar entre la lectura
 * anterior y la siguiente; una corrección solo la cambia un administrador. El contador
 * vigente (y el próximo surtido en Combustible) se recalcula solo.
 */
export async function editarLectura(id: string, l: { horometro: number | null; kilometraje: number | null; fecha: string; nota: string | null; motivo?: string | null }): Promise<void> {
  const { error } = await supabase.rpc('maquinaria_editar_lectura', {
    p_id: id, p_horometro: l.horometro, p_kilometraje: l.kilometraje, p_fecha: l.fecha, p_nota: l.nota, p_motivo: l.motivo ?? null,
  });
  if (error) throw error;
}

/** Borra una lectura de Maquinaria (una corrección, solo un administrador). */
export async function eliminarLectura(id: string): Promise<void> {
  const { data, error } = await supabase.from('maquinaria_lecturas').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo borrar la lectura (puede que ya no exista o que no tengas permiso).');
}

export interface UltimoSurtido {
  fecha: string;
  hora: string | null;
  litros: number;
  tanque: string | null;
  quien: string | null;
}

/** Último surtido (consumo) del equipo en Combustible. Solo lectura: el surtido se hace en Combustible. */
export async function ultimoSurtidoEquipo(nombreCombustible: string | null | undefined): Promise<UltimoSurtido | null> {
  const nombre = (nombreCombustible ?? '').trim();
  if (!nombre) return null;
  const { data, error } = await supabase.from('combustible_tanque_movimientos')
    .select('fecha, litros, autorizado_por, actor_name, actor, tanque_id, tanque_nombre')
    .eq('equipo', nombre).eq('tipo', 'consumo')
    .order('fecha', { ascending: false }).order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as { fecha: string; litros: number; autorizado_por: string | null; actor_name: string | null; actor: string | null; tanque_id: string | null; tanque_nombre: string | null };
  let tanque: string | null = r.tanque_nombre ?? null;
  if (!tanque && r.tanque_id) {
    const { data: t } = await supabase.from('combustible_tanques').select('nombre').eq('id', r.tanque_id).maybeSingle();
    tanque = (t as { nombre?: string } | null)?.nombre ?? null;
  }
  // En MGG la fecha del movimiento ya trae la hora (timestamptz): se muestra en hora de Venezuela.
  const hora = r.fecha ? new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' }).format(new Date(r.fecha)) : null;
  return { fecha: r.fecha, hora, litros: Number(r.litros) || 0, tanque, quien: r.autorizado_por || r.actor_name || r.actor };
}
