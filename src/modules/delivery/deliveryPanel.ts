/* ============================================================
   MGG · Delivery · ayudantes del panel de escritorio (31/10/2026)

   Lo que el panel central (Tablero, Mapa, Histórico, Por delivery) calcula
   sin tocar la base: atajos de fechas, conteos por estado, filas del
   histórico con el nombre del proveedor, el resumen por motorizado y el
   mensaje de WhatsApp que se puede volver a abrir. Funciones puras: se
   prueban en deliveryPanel.test.ts.
   ============================================================ */
import type { FilaHistorialCruda } from './delivery.repository';
import {
  ALMACEN_RETIRO, MOTIVO_RECIBIDA_ALMACEN, UBICACION_VIEJA_MS, destinoDe, esRetiroAlmacen, mensajeAceptado, mensajeCancelado, mensajeEnRuta, mensajeEntregado,
  minutosEntre, resumenPorDelivery, type EstadoDelivery, type OrigenDelivery, type PedidoDelivery,
} from './delivery';

/* ───────────── Atajos de fechas (hora de Venezuela, AAAA-MM-DD) ───────────── */

export type RangoDelivery = 'hoy' | 'semana' | 'mes';

export const RANGOS_DELIVERY: { valor: RangoDelivery; label: string }[] = [
  { valor: 'hoy', label: 'Hoy' },
  { valor: 'semana', label: 'Esta semana' },
  { valor: 'mes', label: 'Este mes' },
];

const isoDia = (d: Date) => d.toISOString().slice(0, 10);

/** Rango de un atajo. La semana arranca el lunes. `hoy` viene de hoyVenezuela(). */
export function rangoDelivery(r: RangoDelivery, hoy: string): { desde: string; hasta: string } {
  const [y, m, d] = hoy.split('-').map(Number);
  if (r === 'hoy') return { desde: hoy, hasta: hoy };
  if (r === 'mes') return { desde: isoDia(new Date(Date.UTC(y, m - 1, 1))), hasta: hoy };
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  const desdeLunes = (dow + 6) % 7;
  return { desde: isoDia(new Date(Date.UTC(y, m - 1, d - desdeLunes))), hasta: hoy };
}

/** ¿El rango coincide con algún atajo? (para marcar el chip activo) */
export function rangoDeliveryActivo(desde: string, hasta: string, hoy: string): RangoDelivery | null {
  for (const r of RANGOS_DELIVERY) {
    const x = rangoDelivery(r.valor, hoy);
    if (x.desde === desde && x.hasta === hasta) return r.valor;
  }
  return null;
}

/* ───────────── Tablero ───────────── */

/** Cuántos pedidos hay en cada estado. */
export function conteoPorEstado(pedidos: Pick<PedidoDelivery, 'estado'>[]): Record<EstadoDelivery, number> {
  const c: Record<EstadoDelivery, number> = { por_tomar: 0, aceptado: 0, en_ruta: 0, entregado: 0, cancelado: 0 };
  for (const p of pedidos) if (p.estado in c) c[p.estado]++;
  return c;
}

/** El supervisor puede cancelar un pedido trabado: tomado y sin entregar. */
export function sePuedeCancelar(p: Pick<PedidoDelivery, 'estado' | 'pedido_id'>): boolean {
  return !!p.pedido_id && (p.estado === 'aceptado' || p.estado === 'en_ruta');
}

/** El mensaje de WhatsApp del último paso del pedido, para volver a enviarlo. */
export function mensajeDelPedido(p: PedidoDelivery): { titulo: string; texto: string } | null {
  const rep = p.repartidor_nombre || 'Delivery';
  const que = esRetiroAlmacen(p) ? 'Retiro' : 'Pedido';
  switch (p.estado) {
    case 'aceptado': return { titulo: `${que} aceptado`, texto: mensajeAceptado(p, rep, p.aceptado_en) };
    case 'en_ruta': return { titulo: 'Delivery en camino', texto: mensajeEnRuta(p, rep, p.en_ruta_en) };
    case 'entregado':
      return { titulo: `${que} entregado`, texto: mensajeEntregado(p, rep, destinoDe(p), p.nota_entrega, p.entregado_en) };
    case 'cancelado':
      return { titulo: `${que} cancelado`, texto: mensajeCancelado(p, rep, p.motivo_cancel || 'Sin motivo', p.detalle_cancel, p.cancelado_en) };
    default: return null;
  }
}

/** Duración legible: «45 min», «1 h 05 min», «—». */
export function duracionTxt(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
}

/* ───────────── Mapa ───────────── */

/** ¿La última ubicación es tan vieja que el motorizado está «sin señal reciente»? */
export function ubicacionVieja(actualizadoEn: string | null | undefined, ahora: number = Date.now()): boolean {
  const t = actualizadoEn ? new Date(actualizadoEn).getTime() : NaN;
  return !Number.isFinite(t) || ahora - t > UBICACION_VIEJA_MS;
}

/** Texto seguro para meterlo en el HTML del marcador o del globo del mapa. */
export function escaparHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/* ───────────── Histórico y resumen por delivery ───────────── */

type FilaCruda = FilaHistorialCruda;

export interface FilaHistorialDelivery {
  id: string;
  orden_id: string;
  /** 02/11/2026: la OC (compra) o el retiro en Almacén Los Pinos. */
  origen: OrigenDelivery;
  /** Cuándo lo tomó (aceptado_en). */
  fecha: string;
  /** La OC (o la SP en un retiro de Almacén). */
  oc: string;
  /** El proveedor, o «Almacén Los Pinos» en un retiro. */
  proveedor: string;
  repartidor: string;
  estado: EstadoDelivery;
  en_ruta_en: string | null;
  entregado_en: string | null;
  cancelado_en: string | null;
  motivo_cancel: string | null;
  almacen_entrega: string | null;
  /** GT: nota de la entrega y fotos (recibo + entrega), para el reporte. */
  nota_entrega: string | null;
  fotos: number;
  total: number;
  moneda: string;
  /** Minutos desde que lo tomó hasta que lo entregó (solo entregados). */
  minutos: number | null;
}

/** Las filas del histórico con el nombre del proveedor y el tiempo de entrega. */
export function armarFilasHistorial(rows: FilaCruda[], proveedores: Map<string, string>): FilaHistorialDelivery[] {
  return rows.map((r) => {
    const o = r.orden;
    const retiro = r.origen === 'almacen';
    // 02/11/2026: toma viva de una OC que Almacén ya recibió por su cuenta → cerrada «Recibida por Almacén»
    // (igual que la muestra delivery_listado).
    const recibidaPorAlmacen = !retiro && (r.estado === 'aceptado' || r.estado === 'en_ruta') && !!o?.recibida_en;
    const estado = (recibidaPorAlmacen ? 'cancelado' : r.estado) as EstadoDelivery;
    return {
      id: r.id,
      orden_id: r.orden_id,
      origen: retiro ? 'almacen' : 'compra',
      fecha: r.aceptado_en,
      // Un retiro se nombra por la SP aunque esa SP ya tenga su OC.
      oc: o ? (retiro ? o.codigo : (o.oc_codigo || o.codigo)) : '—',
      proveedor: retiro ? ALMACEN_RETIRO : ((o?.proveedor_id && proveedores.get(o.proveedor_id)) || '—'),
      repartidor: r.repartidor_nombre || r.repartidor_email || '—',
      estado,
      en_ruta_en: r.en_ruta_en,
      entregado_en: r.entregado_en,
      cancelado_en: recibidaPorAlmacen ? (o?.recibida_en ?? null) : r.cancelado_en,
      motivo_cancel: recibidaPorAlmacen ? MOTIVO_RECIBIDA_ALMACEN : r.motivo_cancel,
      almacen_entrega: r.almacen_entrega,
      nota_entrega: r.nota_entrega ?? null,
      fotos: (Array.isArray(r.fotos_recibo) ? r.fotos_recibo.length : 0) + (Array.isArray(r.fotos_entrega) ? r.fotos_entrega.length : 0),
      // Un retiro de Almacén no tiene monto (no se paga nada).
      total: retiro ? 0 : (Number(o?.total) || 0),
      moneda: o?.moneda || 'USD',
      minutos: estado === 'entregado' ? minutosEntre(r.aceptado_en, r.entregado_en) : null,
    };
  });
}

/** Los motorizados que aparecen en el histórico, en orden alfabético. */
export function repartidoresDe(filas: Pick<FilaHistorialDelivery, 'repartidor'>[]): string[] {
  return [...new Set(filas.map((f) => f.repartidor).filter((x) => x && x !== '—'))].sort((a, b) => a.localeCompare(b, 'es'));
}

/** 02/11/2026: Compras / Almacén / Todos ('' = todos). */
export function filtrarPorOrigen<T extends Pick<FilaHistorialDelivery, 'origen'>>(filas: T[], origen: OrigenDelivery | '' | null | undefined): T[] {
  return origen ? filas.filter((f) => f.origen === origen) : filas;
}

export function filtrarPorRepartidor<T extends Pick<FilaHistorialDelivery, 'repartidor'>>(filas: T[], repartidor: string): T[] {
  return repartidor ? filas.filter((f) => f.repartidor === repartidor) : filas;
}

export type ResumenDelivery = ReturnType<typeof resumenPorDelivery>[number];

/** Cuántos pedidos lleva cada delivery en el rango (cada cancelación cuenta, aunque la OC se haya retomado). */
export function resumenHistorial(filas: FilaHistorialDelivery[]): ResumenDelivery[] {
  // resumenPorDelivery solo lee estado, motivo_cancel, repartidor_nombre, aceptado_en y entregado_en.
  const comoPedidos = filas.map((f) => ({
    estado: f.estado, motivo_cancel: f.motivo_cancel, repartidor_nombre: f.repartidor === '—' ? null : f.repartidor,
    aceptado_en: f.fecha, entregado_en: f.entregado_en,
  })) as unknown as PedidoDelivery[];
  return resumenPorDelivery(comoPedidos);
}

/** Totales del resumen (el promedio pondera por entregados). */
export function totalesResumen(r: ResumenDelivery[]): { entregados: number; cancelados: number; enCurso: number; minutosPromedio: number | null } {
  let entregados = 0; let cancelados = 0; let enCurso = 0; let suma = 0; let n = 0;
  for (const x of r) {
    entregados += x.entregados; cancelados += x.cancelados; enCurso += x.enCurso;
    if (x.minutosPromedio != null && x.entregados > 0) { suma += x.minutosPromedio * x.entregados; n += x.entregados; }
  }
  return { entregados, cancelados, enCurso, minutosPromedio: n ? Math.round(suma / n) : null };
}

/** 10/11/2026 (maqueta): minutos promedio de tomarlo a entregarlo (solo entregados con tiempo). */
export function minutosPromedio(filas: Pick<FilaHistorialDelivery, 'estado' | 'minutos'>[]): number | null {
  const ms = filas.filter((f) => f.estado === 'entregado' && f.minutos != null && Number.isFinite(f.minutos) && f.minutos >= 0)
    .map((f) => Number(f.minutos));
  if (!ms.length) return null;
  return Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
}

/** «21 min» / «1 h 05 min»; sin dato, «—». */
export function minutosTxt(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
