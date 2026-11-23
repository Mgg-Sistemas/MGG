/* ============================================================
   MGG · Delivery (31/10/2026)

   La OC de productos que Compras cotizó y Tesorería pagó pasa a Delivery:
   el motorizado la TOMA (solo uno), va EN RUTA donde el proveedor y la
   ENTREGA en el almacén, con fotos al recibirla y al entregarla. Si no
   puede buscarla, la CANCELA con motivo y la OC queda libre para otro.
   Cada paso deja su mensaje de WhatsApp. Está construido pero
   DESCONECTADO hasta que la administración lo active (interruptor
   `compras_delivery` o config compras.delivery). Solo entran las OC creadas
   desde que se encendió, y entran apenas quedan pagadas (sin esperar la
   retención).

   Acá vive lo
   que no toca la base: estados, motivos y mensajes. Emojis de color por sí
   mismos, sin el selector U+FE0F (WhatsApp lo pierde).

   02/11/2026 · RETIRO EN ALMACÉN LOS PINOS: cuando la revisión de Almacén
   de una Solicitud de Pedido marca existencias en Los Pinos, ese retiro
   también llega a Delivery (origen 'almacen'): el motorizado lo retira en
   el Almacén Los Pinos y lo entrega A la unidad / persona que lo pidió.
   ============================================================ */
import { etiquetaSedeEntrega } from '@/shared/lib/types';
import type { TipoFotoDeliveryRuta } from './rutaFotosDelivery';

/** Clave del interruptor en `sistema_interruptores` / config. */
export const INTERRUPTOR_DELIVERY = 'compras_delivery';

export type EstadoDelivery = 'por_tomar' | 'aceptado' | 'en_ruta' | 'entregado' | 'cancelado';

/** 02/11/2026: de dónde sale el pedido: la OC pagada (proveedor) o el retiro en Almacén Los Pinos. */
export type OrigenDelivery = 'compra' | 'almacen';

/** Compatibilidad MGG: 'oc' = 'compra', 'retiro_almacen' = 'almacen'. */
export type TipoDelivery = 'oc' | 'retiro_almacen';

/** Nombre visible del almacén de donde se retira (va en vez del proveedor). */
export const ALMACEN_RETIRO = 'Almacén Los Pinos';

export interface FotoDelivery { path: string; filename: string }

export interface EventoDelivery { at: string; evento: string; actor?: string | null; motivo?: string | null }

/** Una fila de `delivery_pedidos_listado`: la OC con su toma (si la hay). */
export interface PedidoDelivery {
  orden_id: string;
  /** Compatibilidad MGG */
  tipo?: TipoDelivery;
  oc_codigo: string | null;
  codigo: string;
  total: number;
  moneda: string;
  urgente: boolean;
  pagada_en: string | null;
  items: Array<{ nombre: string; cantidad: number; unidad?: string | null; comprar?: boolean }>;
  notas: string | null;
  motivo: string | null;
  finalidad: string | null;
  almacen_destino: string | null;
  /** Dónde entregar (04/11/2026, se elige en la solicitud): 'los_pinos' o 'matanza'. */
  sede_entrega?: 'los_pinos' | 'matanza' | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  proveedor_telefono: string | null;
  proveedor_direccion: string | null;
  proveedor_contacto: string | null;
  analista_email: string | null;
  analista_nombre: string | null;
  analista_telefono: string | null;
  pedido_id: string | null;
  estado: EstadoDelivery;
  repartidor_id: string | null;
  repartidor_nombre: string | null;
  aceptado_en: string | null;
  en_ruta_en: string | null;
  entregado_en: string | null;
  cancelado_en: string | null;
  motivo_cancel: string | null;
  detalle_cancel: string | null;
  almacen_entrega: string | null;
  nota_entrega: string | null;
  fotos_recibo: FotoDelivery[];
  fotos_entrega: FotoDelivery[];
  /** 11/11/2026: fotos de la factura del proveedor («CARGAR FACTURA»). */
  fotos_factura: FotoDelivery[];
  historial: EventoDelivery[];
  es_mio: boolean;
  /** 02/11/2026: sin dato = 'compra' (filas viejas / pruebas). */
  origen?: OrigenDelivery;
  /** Destino de un retiro de Almacén: la unidad y la persona que pidió la SP. */
  unidad_solicitante?: string | null;
  solicitante_nombre?: string | null;
  solicitante_telefono?: string | null;
  /** Cuándo Almacén revisó la SP (el «listo» de un retiro, como pagada_en en la OC). */
  revisada_en?: string | null;
}

/** Ubicación del motorizado (una por motorizado). */
export interface UbicacionDelivery {
  repartidor_id: string;
  repartidor_email: string | null;
  repartidor_nombre: string | null;
  lat: number;
  lng: number;
  precision_m: number | null;
  velocidad: number | null;
  rumbo: number | null;
  pedido_id: string | null;
  actualizado_en: string;
}

export const ESTADO_DELIVERY: Record<EstadoDelivery, { label: string; emoji: string; badge: string }> = {
  por_tomar: { label: 'Por tomar', emoji: '💰', badge: 'warning' },
  // (un retiro de Almacén «entregado» se rotula con etiquetaEstado())
  aceptado: { label: 'Aceptado', emoji: '🛵', badge: 'info' },
  // 02/11/2026: al aceptar queda directo «En camino» (ya no hay paso intermedio «tomado»).
  en_ruta: { label: 'En camino', emoji: '🚚', badge: 'info' },
  entregado: { label: 'Entregado en almacén', emoji: '✅', badge: 'success' },
  cancelado: { label: 'Cancelado', emoji: '⛔', badge: 'danger' },
};

/** Motivos de cancelación (el último deja escribir). */
export const MOTIVOS_CANCELACION: string[] = [
  'Tomado por error / Desasignar',
  'El proveedor no tiene el pedido listo',
  'Proveedor cerrado o no atiende',
  'Dirección errada o zona inaccesible',
  'Avería del vehículo',
  'Condiciones climáticas / lluvia fuerte',
  'Falta de combustible',
  'Otro motivo',
];

/** 02/11/2026: motivos de «No disponible» en un pedido por tomar (el último deja escribir). */
export const MOTIVOS_NO_DISPONIBLE: string[] = [
  'Estoy en otra entrega',
  'Fuera de mi horario / zona',
  'Avería del vehículo',
  'Falta de combustible',
  'Condiciones climáticas / lluvia fuerte',
  'Otro motivo',
];

/** Arma el motivo a guardar: la opción elegida y el detalle (con «Otro motivo», solo el detalle). */
export function motivoNoDisponible(opcion: string, detalle?: string | null): string {
  const d = (detalle ?? '').trim();
  if (opcion === MOTIVOS_NO_DISPONIBLE[MOTIVOS_NO_DISPONIBLE.length - 1]) return d;
  return d ? `${opcion} · ${d}` : opcion;
}

/** Centro de Puerto Ordaz, estado Bolívar (para centrar el mapa). */
export const PUERTO_ORDAZ: [number, number] = [8.2869, -62.7467];

/** Una ubicación con más de este tiempo se muestra como «sin señal reciente». */
export const UBICACION_VIEJA_MS = 10 * 60 * 1000;

export const MAX_FOTOS_DELIVERY = 6;

export function ocDe(p: Pick<PedidoDelivery, 'oc_codigo' | 'codigo'>): string {
  return p.oc_codigo || p.codigo;
}

/* ───────────── 02/11/2026 · Origen (OC pagada / retiro en Almacén) ───────────── */

/** ¿Es un retiro en Almacén Los Pinos? (sin origen = OC, como antes) */
export function esRetiroAlmacen(p: { origen?: OrigenDelivery; tipo?: TipoDelivery }): boolean {
  return p.origen === 'almacen' || p.tipo === 'retiro_almacen';
}

/** Alias para compatibilidad */
export const esRetiro = esRetiroAlmacen;

export const ORIGEN_DELIVERY: Record<OrigenDelivery, { label: string; emoji: string; corto: string }> = {
  compra: { label: 'OC pagada (proveedor)', emoji: '🏭', corto: 'Compras' },
  almacen: { label: `Retiro en ${ALMACEN_RETIRO}`, emoji: '📦', corto: 'Almacén' },
};

/** Una fila por (orden, origen): la misma SP puede tener su retiro de Almacén y su OC. */
export function claveDelivery(p: Pick<PedidoDelivery, 'orden_id' | 'origen'>): string {
  return `${p.orden_id}:${p.origen ?? 'compra'}`;
}

/** De dónde se busca: el proveedor de la OC o «📦 Retiro en Almacén Los Pinos». */
export function origenTxt(p: Pick<PedidoDelivery, 'origen' | 'proveedor_nombre'>): string {
  return esRetiroAlmacen(p) ? `📦 Retiro en ${ALMACEN_RETIRO}` : (p.proveedor_nombre?.trim() || '—');
}

/** Destino de un retiro de Almacén: «UNIDAD · Persona» (la unidad / el solicitante de la SP). */
export function destinoRetiro(p: Pick<PedidoDelivery, 'unidad_solicitante' | 'solicitante_nombre'>): string {
  return [p.unidad_solicitante?.trim(), p.solicitante_nombre?.trim()].filter(Boolean).join(' · ');
}

/** A dónde va: el almacén de la OC, o la unidad / solicitante del retiro (lo entregado manda). */
export function destinoDe(p: Pick<PedidoDelivery, 'origen' | 'almacen_entrega' | 'almacen_destino' | 'unidad_solicitante' | 'solicitante_nombre'>): string {
  const d = esRetiroAlmacen(p) ? (p.almacen_entrega || destinoRetiro(p)) : (p.almacen_entrega || p.almacen_destino);
  return (d ?? '').trim() || '—';
}

/**
 * 02/11/2026: Almacén recibió la OC por su cuenta mientras el delivery la tenía (aceptada / en
 * camino): la base la muestra cerrada como 'cancelado' con este motivo (supabase/2026-11-02-
 * delivery-recepcion.sql). No es una cancelación del motorizado.
 */
export const MOTIVO_RECIBIDA_ALMACEN = 'Recibida por Almacén';

/** ¿Quedó cerrada porque Almacén la recibió por su cuenta? */
export function cerradoPorRecepcion(p: Pick<PedidoDelivery, 'estado' | 'motivo_cancel'>): boolean {
  return p.estado === 'cancelado' && p.motivo_cancel === MOTIVO_RECIBIDA_ALMACEN;
}

/** ¿El motorizado ya tomó foto al recibir del proveedor pero aún no confirmó el inicio de retorno a sede? */
export function esRetornoPendiente(p: Pick<PedidoDelivery, 'estado' | 'fotos_recibo'>): boolean {
  return p.estado === 'aceptado' && (p.fotos_recibo?.length ?? 0) > 0;
}

/** Etiqueta del estado: un retiro «entregado» no va a un almacén sino a quien lo pidió. */
export function etiquetaEstado(estado: EstadoDelivery, origen?: OrigenDelivery | null, motivoCancel?: string | null): string {
  if (estado === 'entregado' && origen === 'almacen') return 'Entregado';
  if (estado === 'cancelado' && motivoCancel === MOTIVO_RECIBIDA_ALMACEN) return MOTIVO_RECIBIDA_ALMACEN;
  return ESTADO_DELIVERY[estado]?.label ?? estado;
}

/** 02/11/2026: al entregar la OC queda recibida en Inventario en este almacén (Los Pinos = General). */
export function almacenRecepcion(p: Pick<PedidoDelivery, 'almacen_destino'>): string {
  return (p.almacen_destino ?? '').trim() || 'General';
}

/** «General» es el inventario de Los Pinos: así se le muestra al motorizado. */
export function almacenVisible(a: string | null | undefined): string {
  const x = (a ?? '').trim();
  if (!x) return '—';
  return x === 'General' ? `${ALMACEN_RETIRO} (General)` : x;
}

/** Cómo se rotulan las fotos: «al recibir» del proveedor o «al retirar en Almacén». */
/** 11/11/2026: 'factura' = fotos de la factura del proveedor que sube el delivery. */
export type TipoFotoDelivery = TipoFotoDeliveryRuta;

// 23/11/2026: se reexporta para los componentes y se prueba sin imports en `rutaFotosDelivery.ts`.
export type { RutaFotosDelivery } from './rutaFotosDelivery';
export { rutaGuardadoFotos } from './rutaFotosDelivery';

export function rotuloFotos(origen: OrigenDelivery | null | undefined, tipo: TipoFotoDelivery): string {
  if (tipo === 'factura') return 'Factura del proveedor';
  if (tipo === 'entrega') return origen === 'almacen' ? 'De la entrega' : 'De la entrega en el almacén';
  return origen === 'almacen' ? 'Al retirar en Almacén' : 'Fotos del producto (al recibir del proveedor)';
}

/** «🔹 *Orden:* OC-…» o «🔹 *Solicitud:* SP-…». */
function lineaOrden(p: PedidoDelivery): string {
  return esRetiroAlmacen(p) ? `🔹 *Solicitud:* ${p.codigo}` : `🔹 *Orden:* ${ocDe(p)}`;
}

/** «🏭 *Proveedor:* …» o «📦 *Retirar en:* Almacén Los Pinos». */
function lineaOrigen(p: PedidoDelivery): string {
  return esRetiroAlmacen(p) ? `📦 *Retirar en:* ${ALMACEN_RETIRO}` : `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`;
}

export function montoTxt(n: number, moneda: string): string {
  const v = (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (moneda || 'USD').toUpperCase() === 'BS' ? `Bs ${v}` : `$${v}`;
}

export function fechaHoraVE(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Minutos entre dos marcas (null si falta alguna). */
export function minutosEntre(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const m = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return Number.isFinite(m) && m >= 0 ? Math.round(m) : null;
}

/** Los renglones que se compran, en una línea cada uno. */
function lineasItems(p: PedidoDelivery): string[] {
  return (p.items ?? []).filter((i) => i.comprar !== false)
    .map((i) => `• ${i.nombre} — ${(Number(i.cantidad) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 })}${i.unidad ? ` ${i.unidad}` : ''}`);
}

/** Pie de todos los mensajes (MGG). */
export const PIE_DELIVERY = '🏢 *MINERAL GROUP GUAYANA C.A.* · Delivery';

function pie(): string[] {
  return ['', PIE_DELIVERY];
}

/** Aceptó el pedido: desde el 02/11/2026 queda directo EN CAMINO. */
export function mensajeAceptado(p: PedidoDelivery, repartidor: string, cuando?: string | null): string {
  const retiro = esRetiroAlmacen(p);
  const l = [
    retiro ? '🚚 *EN CAMINO · RETIRO EN ALMACÉN LOS PINOS*' : '🚚 *EN CAMINO · PEDIDO ACEPTADO POR DELIVERY*',
    lineaOrden(p),
    p.urgente ? '🚨 *Requerimiento:* URGENTE' : '🟢 *Requerimiento:* Normal',
    `👤 *Delivery:* ${repartidor}`,
    lineaOrigen(p),
  ];
  if (!retiro && p.proveedor_direccion) l.push(`📍 *Dirección:* ${p.proveedor_direccion}`);
  if (retiro) {
    const destino = destinoRetiro(p);
    if (destino) l.push(`🏬 *Entregar a:* ${destino}`);
  } else if (p.almacen_destino) l.push(`🏬 *Entregar en:* ${p.almacen_destino}`);
  if (!retiro && etiquetaSedeEntrega(p.sede_entrega)) l.push(`📍 *Dirección de recepción:* Almacén ${etiquetaSedeEntrega(p.sede_entrega)}`);
  const items = lineasItems(p);
  if (items.length) l.push('', `📦 *Productos (${items.length}):*`, ...items);
  l.push('', `🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

/** 02/11/2026: el motorizado marca «No disponible» en un pedido por tomar (sigue libre para los demás). */
export function mensajeNoDisponible(p: PedidoDelivery, repartidor: string, motivo: string, cuando?: string | null): string {
  const l = [
    '🛵 *DELIVERY NO DISPONIBLE*',
    lineaOrden(p),
    lineaOrigen(p),
    `👤 *Delivery:* ${repartidor}`,
    `📝 *Motivo:* ${motivo.trim()}`,
    '',
    '🔄 El pedido sigue disponible para otro delivery.',
    `🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`,
    ...pie(),
  ];
  return l.join('\n');
}

/** «No disponible» guardado (tabla delivery_rechazos). */
export interface RechazoDelivery {
  id: string;
  orden_id: string;
  origen: OrigenDelivery;
  repartidor_id: string;
  repartidor_email: string | null;
  repartidor_nombre: string | null;
  motivo: string;
  created_at: string;
}

/** Los «No disponible» de un pedido (misma orden y mismo origen), del más nuevo al más viejo. */
export function rechazosDe(p: Pick<PedidoDelivery, 'orden_id' | 'origen'>, rechazos: RechazoDelivery[]): RechazoDelivery[] {
  const k = claveDelivery(p);
  return rechazos.filter((r) => claveDelivery(r) === k).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** No va a poder buscar el pedido. */
export function mensajeCancelado(p: PedidoDelivery, repartidor: string, motivo: string, detalle?: string | null, cuando?: string | null): string {
  const retiro = esRetiroAlmacen(p);
  const l = [
    retiro ? '⛔ *RETIRO EN ALMACÉN CANCELADO POR DELIVERY*' : '⛔ *PEDIDO CANCELADO POR DELIVERY*',
    lineaOrden(p),
    `👤 *Delivery:* ${repartidor}`,
    lineaOrigen(p),
    '',
    `❌ *Motivo:* ${motivo}`,
  ];
  if (detalle?.trim()) l.push(`📝 *Detalle:* ${detalle.trim()}`);
  l.push('', retiro ? '🔄 El retiro queda disponible para otro delivery.' : '🔄 La orden queda disponible para otro delivery.',
    `🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

/** Va en ruta. */
export function mensajeEnRuta(p: PedidoDelivery, repartidor: string, cuando?: string | null): string {
  const retiro = esRetiroAlmacen(p);
  const l = [
    '🚚 *DELIVERY EN CAMINO*',
    lineaOrden(p),
    `👤 *Delivery:* ${repartidor}`,
    lineaOrigen(p),
  ];
  if (p.fotos_recibo?.length) l.push(`📷 *Fotos ${retiro ? 'al retirar en Almacén' : 'al recibir'}:* ${p.fotos_recibo.length}`);
  if (retiro) {
    const destino = destinoRetiro(p);
    if (destino) l.push(`🏬 *Va hacia:* ${destino}`);
  } else if (p.almacen_destino) l.push(`🏬 *Va hacia:* ${p.almacen_destino}`);
  if (!retiro && etiquetaSedeEntrega(p.sede_entrega)) l.push(`📍 *Dirección de recepción:* Almacén ${etiquetaSedeEntrega(p.sede_entrega)}`);
  l.push(`🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

/** Entregó en el almacén (OC) o a la unidad / persona que lo pidió (retiro de Almacén). */
export function mensajeEntregado(p: PedidoDelivery, repartidor: string, almacen: string, nota?: string | null, cuando?: string | null): string {
  const retiro = esRetiroAlmacen(p);
  const l = [
    retiro ? '✅ *RETIRO DE ALMACÉN ENTREGADO*' : '✅ *PEDIDO ENTREGADO EN ALMACÉN*',
    lineaOrden(p),
    `👤 *Delivery:* ${repartidor}`,
    lineaOrigen(p),
    retiro ? `🏬 *Entregado a:* ${almacen}` : `🏬 *Almacén:* ${almacen}`,
  ];
  // 02/11/2026: la OC entregada queda recibida en Inventario (el retiro no mueve stock).
  // 04/11/2026: ya no entra sola: el almacenista la recepciona desde su teléfono.
  if (!retiro) l.push('📥 *Por recepcionar en almacén* (el almacenista la recibe en Inventario)');
  const items = lineasItems(p);
  if (items.length) l.push('', `📦 *Productos (${items.length}):*`, ...items);
  if (p.fotos_entrega?.length) l.push(`📷 *Fotos de la entrega:* ${p.fotos_entrega.length}`);
  if (nota?.trim()) l.push(`📝 *Nota:* ${nota.trim()}`);
  const t = minutosEntre(p.aceptado_en, cuando ?? new Date().toISOString());
  if (t != null) l.push(`⏳ *Tiempo desde que lo tomó:* ${t} min`);
  l.push(`🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

/** Cuántos pedidos lleva cada delivery (para el histórico y el PDF). */
export function resumenPorDelivery(pedidos: PedidoDelivery[]): Array<{
  repartidor: string; entregados: number; cancelados: number; enCurso: number; minutosPromedio: number | null;
}> {
  const acc = new Map<string, { entregados: number; cancelados: number; enCurso: number; minutos: number[] }>();
  for (const p of pedidos) {
    // «Recibida por Almacén» no es trabajo ni cancelación del motorizado: no cuenta.
    if (!p.repartidor_nombre || p.estado === 'por_tomar' || cerradoPorRecepcion(p)) continue;
    const a = acc.get(p.repartidor_nombre) ?? { entregados: 0, cancelados: 0, enCurso: 0, minutos: [] };
    if (p.estado === 'entregado') {
      a.entregados++;
      const m = minutosEntre(p.aceptado_en, p.entregado_en);
      if (m != null) a.minutos.push(m);
    } else if (p.estado === 'cancelado') a.cancelados++;
    else a.enCurso++;
    acc.set(p.repartidor_nombre, a);
  }
  return [...acc.entries()].map(([repartidor, a]) => ({
    repartidor, entregados: a.entregados, cancelados: a.cancelados, enCurso: a.enCurso,
    minutosPromedio: a.minutos.length ? Math.round(a.minutos.reduce((s, x) => s + x, 0) / a.minutos.length) : null,
  })).sort((x, y) => y.entregados - x.entregados || x.repartidor.localeCompare(y.repartidor, 'es'));
}


/* ───────────── 04/11/2026 · Canales: Delivery y Carga pesada (mismo flujo, rol propio) ───────────── */

export type CanalDelivery = 'delivery' | 'carga_pesada';

export const CANALES_DELIVERY: Record<CanalDelivery, { titulo: string; icono: string; modulo: 'delivery' | 'carga_pesada'; ruta: string; rutaTelefono: string }> = {
  delivery: { titulo: 'Delivery', icono: '🛵', modulo: 'delivery', ruta: '/app/delivery', rutaTelefono: '/app/delivery/telefono' },
  carga_pesada: { titulo: 'Carga pesada', icono: '🚚', modulo: 'carga_pesada', ruta: '/app/carga-pesada', rutaTelefono: '/app/carga-pesada/telefono' },
};

/** Título grande de la pantalla: en Carga pesada dice «CARGA PESADA» (en mayúsculas); en Delivery, «Delivery». */
export function tituloPantallaCanal(canal: CanalDelivery): string {
  return canal === 'carga_pesada' ? 'CARGA PESADA' : CANALES_DELIVERY[canal].titulo;
}

/** ¿La OC (por su modalidad de entrega) es de este canal? Sin dato = Delivery; «a domicilio» = ninguno. */
export function esDelCanal(modalidad: string | null | undefined, canal: CanalDelivery): boolean {
  const m = modalidad === 'carga_pesada' || modalidad === 'proveedor' ? modalidad : 'delivery';
  return canal === 'carga_pesada' ? m === 'carga_pesada' : m !== 'carga_pesada';
}
