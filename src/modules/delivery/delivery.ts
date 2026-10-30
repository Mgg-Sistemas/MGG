/* ============================================================
   MGG · Delivery (30-10-2026)

   La OC que Compras cotizó y Tesorería pagó pasa a Delivery: el motorizado
   la TOMA (solo uno), va EN RUTA donde el proveedor y la ENTREGA en el
   almacén, con fotos al recibirla y al entregarla. Si no puede buscarla, la
   CANCELA con motivo y la OC queda libre para otro. Cada paso deja su
   mensaje de WhatsApp. Está construido pero DESCONECTADO hasta que la
   administradora lo active (config compras.delivery).

   Acá vive lo que no toca la base: estados, motivos y mensajes. Emojis de
   color por sí mismos, sin el selector U+FE0F (ver mensajeMovimiento.ts).
   ============================================================ */

export type EstadoDelivery = 'por_tomar' | 'aceptado' | 'en_ruta' | 'entregado' | 'cancelado';

export interface FotoDelivery { path: string; filename: string }

export interface EventoDelivery { at: string; evento: string; actor?: string | null; motivo?: string | null }

/** Una fila de `delivery_pedidos_listado`: la OC con su toma (si la hay). */
export interface PedidoDelivery {
  orden_id: string;
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
  historial: EventoDelivery[];
  es_mio: boolean;
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
  aceptado: { label: 'Aceptado', emoji: '🛵', badge: 'info' },
  en_ruta: { label: 'En ruta', emoji: '🚚', badge: 'info' },
  entregado: { label: 'Entregado en almacén', emoji: '✅', badge: 'success' },
  cancelado: { label: 'Cancelado', emoji: '⛔', badge: 'danger' },
};

/** Motivos de cancelación (el último deja escribir). */
export const MOTIVOS_CANCELACION: string[] = [
  'El proveedor no tiene el pedido listo',
  'Proveedor cerrado o no atiende',
  'Dirección errada o zona inaccesible',
  'Avería del vehículo',
  'Condiciones climáticas / lluvia fuerte',
  'Falta de combustible',
  'Otro motivo',
];

/** Centro de Puerto Ordaz, estado Bolívar (para centrar el mapa). */
export const PUERTO_ORDAZ: [number, number] = [8.2869, -62.7467];

/** Una ubicación con más de este tiempo se muestra como «sin señal reciente». */
export const UBICACION_VIEJA_MS = 10 * 60 * 1000;

export const MAX_FOTOS_DELIVERY = 6;

export function ocDe(p: Pick<PedidoDelivery, 'oc_codigo' | 'codigo'>): string {
  return p.oc_codigo || p.codigo;
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

function pie(): string[] {
  return ['', '🏢 *MINERAL GROUP GUAYANA C.A.* · Delivery'];
}

/** Aceptó el pedido. */
export function mensajeAceptado(p: PedidoDelivery, repartidor: string, cuando?: string | null): string {
  const l = [
    '🛵 *PEDIDO ACEPTADO POR DELIVERY*',
    `🔹 *Orden:* ${ocDe(p)}`,
    p.urgente ? '🚨 *Requerimiento:* URGENTE' : '🟢 *Requerimiento:* Normal',
    `👤 *Delivery:* ${repartidor}`,
    `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`,
  ];
  if (p.proveedor_direccion) l.push(`📍 *Dirección:* ${p.proveedor_direccion}`);
  if (p.almacen_destino) l.push(`🏬 *Entregar en:* ${p.almacen_destino}`);
  const items = lineasItems(p);
  if (items.length) l.push('', `📦 *Productos (${items.length}):*`, ...items);
  l.push('', `🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

/** No va a poder buscar el pedido. */
export function mensajeCancelado(p: PedidoDelivery, repartidor: string, motivo: string, detalle?: string | null, cuando?: string | null): string {
  const l = [
    '⛔ *PEDIDO CANCELADO POR DELIVERY*',
    `🔹 *Orden:* ${ocDe(p)}`,
    `👤 *Delivery:* ${repartidor}`,
    `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`,
    '',
    `❌ *Motivo:* ${motivo}`,
  ];
  if (detalle?.trim()) l.push(`📝 *Detalle:* ${detalle.trim()}`);
  l.push('', '🔄 La orden queda disponible para otro delivery.', `🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

/** Va en ruta. */
export function mensajeEnRuta(p: PedidoDelivery, repartidor: string, cuando?: string | null): string {
  const l = [
    '🚚 *DELIVERY EN RUTA*',
    `🔹 *Orden:* ${ocDe(p)}`,
    `👤 *Delivery:* ${repartidor}`,
    `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`,
  ];
  if (p.fotos_recibo?.length) l.push(`📷 *Fotos al recibir:* ${p.fotos_recibo.length}`);
  if (p.almacen_destino) l.push(`🏬 *Va hacia:* ${p.almacen_destino}`);
  l.push(`🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

/** Entregó en el almacén. */
export function mensajeEntregado(p: PedidoDelivery, repartidor: string, almacen: string, nota?: string | null, cuando?: string | null): string {
  const l = [
    '✅ *PEDIDO ENTREGADO EN ALMACÉN*',
    `🔹 *Orden:* ${ocDe(p)}`,
    `👤 *Delivery:* ${repartidor}`,
    `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`,
    `🏬 *Almacén:* ${almacen}`,
  ];
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
    if (!p.repartidor_nombre || p.estado === 'por_tomar') continue;
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
