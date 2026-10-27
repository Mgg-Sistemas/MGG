/* ============================================================
   Golden Touch · Control de Maquinaria · listados de los submódulos
   Reglas puras (sin Supabase) de Órdenes de servicio, Averías y
   estados, Lavados y Repuestos y compras: filtros sin acentos, rango
   de fechas, conteos por estado y equipos que llevan más días sin
   lavar. Las páginas solo pintan lo que sale de aquí.
   ============================================================ */
import { norm } from '@/shared/lib/texto';
import { diasDesde, estadoEfectivo, ordenAbierta, servicioPorId, faltaSalida, faltaCompra, columnaCompra, type ColumnaCompra, type EstadoEquipo, type EstadoOrdenServicio, type RepuestoOrden } from './flota';

/** Día local «aaaa-mm-dd» de una fecha ISO (para comparar con los filtros de fecha). */
export function diaLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ¿La fecha cae en el rango (inclusive)? Un extremo vacío no limita. */
export function enRango(iso: string | null | undefined, desde?: string | null, hasta?: string | null): boolean {
  if (!desde && !hasta) return true;
  const d = diaLocal(iso);
  if (!d) return false;
  if (desde && d < desde) return false;
  if (hasta && d > hasta) return false;
  return true;
}

/** Búsqueda sin acentos: cada palabra debe aparecer en alguno de los textos. */
export function coincideTexto(textos: (string | null | undefined)[], q: string): boolean {
  const t = norm(q);
  if (!t) return true;
  const todo = norm(textos.filter(Boolean).join(' '));
  return t.split(/\s+/).every((p) => todo.includes(p));
}

interface EquipoRef { id: string; equipo: string; tipo?: string | null; marca?: string | null; modelo?: string | null; serial?: string | null; placa?: string | null; ubicacion?: string | null }

/* ───────── Órdenes de servicio ───────── */

export interface OrdenListado {
  id: string; codigo: string; equipo_id: string; tipo: string; urgencia: string; estado: string;
  descripcion: string | null; responsable: string | null; created_at: string; repuestos: Pick<RepuestoOrden, 'nombre'>[];
}

export interface FiltroOrdenes {
  estado?: EstadoOrdenServicio | 'abiertas' | 'todas';
  equipoId?: string;
  tipo?: string;
  urgencia?: string;
  desde?: string;
  hasta?: string;
  q?: string;
}

export function filtrarOrdenes<T extends OrdenListado>(ordenes: T[], equipos: Map<string, EquipoRef>, f: FiltroOrdenes): T[] {
  return ordenes.filter((o) => {
    if (f.estado === 'abiertas' && !ordenAbierta(o.estado)) return false;
    if (f.estado && f.estado !== 'abiertas' && f.estado !== 'todas' && o.estado !== f.estado) return false;
    if (f.equipoId && o.equipo_id !== f.equipoId) return false;
    if (f.tipo && o.tipo !== f.tipo) return false;
    if (f.urgencia && o.urgencia !== f.urgencia) return false;
    if (!enRango(o.created_at, f.desde, f.hasta)) return false;
    const e = equipos.get(o.equipo_id);
    return coincideTexto([o.codigo, o.descripcion, o.responsable, servicioPorId(o.tipo)?.label, e?.equipo, e?.marca, e?.modelo, e?.serial, e?.placa,
      ...o.repuestos.map((r) => r.nombre)], f.q ?? '');
  });
}

/** Cuántas órdenes hay en cada estado (para las pestañas). */
export function contarPorEstado(ordenes: { estado: string }[]): Record<string, number> {
  const out: Record<string, number> = { abiertas: 0, todas: ordenes.length };
  for (const o of ordenes) {
    out[o.estado] = (out[o.estado] ?? 0) + 1;
    if (ordenAbierta(o.estado)) out.abiertas += 1;
  }
  return out;
}

/* ───────── Averías y estados ───────── */

/** Estados que «necesitan atención» (los que se listan arriba en Averías y estados). */
export const ESTADOS_ATENCION: EstadoEquipo[] = ['averiada', 'parada', 'taller', 'repuestos', 'espera'];

/** Equipos que hoy no están operativos (ni retirados), ordenados: averiados primero y los más antiguos antes. */
export function equiposEnAtencion<T extends EquipoRef & { estado_operativo?: string | null; status?: string | null; activo?: boolean | null; estado_desde?: string | null }>(equipos: T[]): (T & { estado: EstadoEquipo })[] {
  const peso: Record<string, number> = { averiada: 0, parada: 1, repuestos: 2, taller: 3, espera: 4 };
  return equipos
    .map((e) => ({ ...e, estado: estadoEfectivo(e) }))
    .filter((e) => ESTADOS_ATENCION.includes(e.estado))
    .sort((a, b) => (peso[a.estado] - peso[b.estado]) || String(a.estado_desde ?? '9').localeCompare(String(b.estado_desde ?? '9')) || a.equipo.localeCompare(b.equipo, 'es'));
}

export interface EventoListado { equipo_id: string; estado: string; estado_anterior: string | null; motivo: string | null; material: string | null; nota: string | null; actor: string | null; actor_name: string | null; created_at: string }

export interface FiltroEventos { estado?: string; equipoId?: string; desde?: string; hasta?: string; q?: string }

export function filtrarEventos<T extends EventoListado>(eventos: T[], equipos: Map<string, EquipoRef>, f: FiltroEventos): T[] {
  return eventos.filter((ev) => {
    if (f.estado && ev.estado !== f.estado) return false;
    if (f.equipoId && ev.equipo_id !== f.equipoId) return false;
    if (!enRango(ev.created_at, f.desde, f.hasta)) return false;
    const e = equipos.get(ev.equipo_id);
    return coincideTexto([e?.equipo, e?.marca, e?.modelo, ev.motivo, ev.material, ev.nota, ev.actor_name, ev.actor], f.q ?? '');
  });
}

/* ───────── Lavados ───────── */

export interface LavadoListado { equipo_id: string; fecha: string; tipo: string; responsable: string | null; nota: string | null; actor_name: string | null }

export interface FiltroLavados { equipoId?: string; tipo?: string; responsable?: string; desde?: string; hasta?: string; q?: string }

export function filtrarLavados<T extends LavadoListado>(lavados: T[], equipos: Map<string, EquipoRef>, f: FiltroLavados): T[] {
  return lavados.filter((l) => {
    if (f.equipoId && l.equipo_id !== f.equipoId) return false;
    if (f.tipo && norm(l.tipo) !== norm(f.tipo)) return false;
    if (f.responsable && !norm(l.responsable).includes(norm(f.responsable))) return false;
    if (!enRango(l.fecha, f.desde, f.hasta)) return false;
    const e = equipos.get(l.equipo_id);
    return coincideTexto([e?.equipo, e?.marca, e?.modelo, l.tipo, l.responsable, l.nota, l.actor_name], f.q ?? '');
  });
}

/**
 * Equipos (no retirados) ordenados por los días que llevan sin lavar: primero los que
 * nunca se han lavado, luego los de más días. `dias` = null cuando no hay registro.
 */
export function equiposSinLavar<T extends EquipoRef & { estado_operativo?: string | null; status?: string | null; activo?: boolean | null }>(
  equipos: T[], lavados: { equipo_id: string; fecha: string }[], hoy: Date = new Date(),
): { equipo: T; ultimo: string | null; dias: number | null }[] {
  const ultimo = new Map<string, string>();
  for (const l of lavados) {
    const u = ultimo.get(l.equipo_id);
    if (!u || l.fecha > u) ultimo.set(l.equipo_id, l.fecha);
  }
  return equipos
    .filter((e) => estadoEfectivo(e) !== 'retirada')
    .map((e) => { const u = ultimo.get(e.id) ?? null; return { equipo: e, ultimo: u, dias: diasDesde(u, hoy) }; })
    .sort((a, b) => {
      if (a.dias == null && b.dias == null) return a.equipo.equipo.localeCompare(b.equipo.equipo, 'es');
      if (a.dias == null) return -1;
      if (b.dias == null) return 1;
      return b.dias - a.dias;
    });
}

/* ───────── Repuestos y compras ───────── */

export interface OrdenConRepuestos {
  id: string; codigo: string; equipo_id: string; estado: string; created_at: string;
  solicitud_salida_id: string | null; orden_compra_id: string | null; compras_notificada_at: string | null;
  repuestos: Pick<RepuestoOrden, 'producto_id' | 'nombre' | 'unidad' | 'cantidad' | 'desde_inventario' | 'a_comprar'>[];
}

/** Piezas nuevas (sin producto en el inventario) de órdenes abiertas: lo que Compras tiene pendiente de dar de alta. */
export function piezasNuevasPendientes<T extends OrdenConRepuestos>(ordenes: T[]): { orden: T; pieza: T['repuestos'][number]; indice: number }[] {
  const out: { orden: T; pieza: T['repuestos'][number]; indice: number }[] = [];
  for (const o of ordenes) {
    if (!ordenAbierta(o.estado)) continue;
    o.repuestos.forEach((r, i) => { if (!r.producto_id) out.push({ orden: o, pieza: r, indice: i }); });
  }
  return out.sort((a, b) => a.orden.created_at.localeCompare(b.orden.created_at));
}

/** Órdenes que pidieron algo al inventario o a compras (las que tienen repuestos). */
export function ordenesConRepuestos<T extends OrdenConRepuestos>(ordenes: T[]): T[] {
  return ordenes.filter((o) => o.repuestos.length > 0 && o.estado !== 'anulada');
}

/** Columnas del tablero de salidas de inventario de las órdenes. */
export type ColumnaSalida = 'por_solicitar' | 'por_aprobar' | 'aprobada' | 'ejecutada' | 'cancelada';
export const COLUMNAS_SALIDA: { id: ColumnaSalida; label: string; icon: string; tono: string }[] = [
  { id: 'por_solicitar', label: 'Por solicitar', icon: '⚠️', tono: 'warning' },
  { id: 'por_aprobar', label: 'Por aprobar', icon: '📝', tono: 'info' },
  { id: 'aprobada', label: 'Aprobada', icon: '✅', tono: 'wait' },
  { id: 'ejecutada', label: 'Entregada', icon: '📦', tono: 'success' },
  { id: 'cancelada', label: 'Cancelada', icon: '⛔', tono: 'retired' },
];

/** Dónde va una orden en el tablero de salidas (null = no saca nada del inventario). */
export function columnaSalidaDeOrden(o: OrdenConRepuestos, estadoSalida: string | null | undefined): ColumnaSalida | null {
  if (o.solicitud_salida_id) {
    const e = estadoSalida ?? 'por_aprobar';
    return e === 'aprobada' || e === 'ejecutada' || e === 'cancelada' ? e : 'por_aprobar';
  }
  return faltaSalida(o) ? 'por_solicitar' : null;
}

/** Dónde va una orden en el tablero de compras (null = no compra nada). */
export function columnaCompraDeOrden(o: OrdenConRepuestos, estadoCompra: string | null | undefined): ColumnaCompra | 'por_solicitar' | null {
  if (o.orden_compra_id) return columnaCompra(estadoCompra ?? 'pendiente');
  return faltaCompra(o) ? 'por_solicitar' : null;
}

/* ───────── Acciones desde los submódulos ───────── */

export type AccionSubmodulo = 'orden' | 'averia' | 'lavado';

/** ¿Este equipo admite la acción? (los retirados no; una avería no se reporta dos veces). */
export function equipoAdmite(accion: AccionSubmodulo, estado: EstadoEquipo): boolean {
  if (estado === 'retirada') return false;
  if (accion === 'averia') return estado !== 'averiada' && estado !== 'parada';
  return true;
}
