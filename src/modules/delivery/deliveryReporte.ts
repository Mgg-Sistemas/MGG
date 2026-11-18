/* ============================================================
   MGG · Delivery · Reportes (31/10/2026)

   Pedido de la usuaria: sacar los reportes de Delivery en PDF (vista
   previa) y como mensaje de WhatsApp, en la PC y en el teléfono.
     · Por pedido: OC, proveedor, motorizado (nombre y apellido), estados con
       su hora, almacén de entrega, nota y cuántas fotos lleva.
     · General (PC): rango de fechas + estado + motorizado → totales por
       estado, resumen por motorizado, tiempo promedio de entrega y la lista.
   Funciones puras (sin pantalla ni base): las usan deliveryPdf.ts, la PC y
   el teléfono, y se prueban en deliveryReporte.test.ts. Emojis sin el
   selector U+FE0F (WhatsApp lo pierde).
   02/11/2026: con el ORIGEN (OC pagada / retiro en Almacén Los Pinos): el
   retiro se nombra por la SP, sale de «Almacén Los Pinos», se entrega A la
   unidad / persona y no tiene monto. El general se filtra por origen.
   ============================================================ */
import {
  ALMACEN_RETIRO, ESTADO_DELIVERY, ORIGEN_DELIVERY, PIE_DELIVERY, destinoDe, esRetiroAlmacen, etiquetaEstado, fechaHoraVE,
  minutosEntre, montoTxt, ocDe, type EstadoDelivery, type OrigenDelivery, type PedidoDelivery,
} from './delivery';
import {
  duracionTxt, resumenHistorial, totalesResumen, type FilaHistorialDelivery, type ResumenDelivery,
} from './deliveryPanel';

/** Resuelve el nombre visible (nombre y apellido) de quien se guardó; por defecto, tal cual. */
export type ResolverNombre = (guardado: string | null | undefined, correo?: string | null) => string;
const tal: ResolverNombre = (g, c) => (g?.trim() || c?.trim() || '');

/* ───────────── Por pedido ───────────── */

export interface PasoPedido { paso: string; hora: string }

export interface DetallePedidoDelivery {
  /** 02/11/2026: 'compra' | 'almacen'. */
  origen: OrigenDelivery;
  /** «Orden de compra» o «Solicitud de pedido» (rótulo de `oc`). */
  rotuloOrden: string;
  oc: string;
  estado: string;
  urgente: boolean;
  proveedor: string;
  direccion: string | null;
  telefonoProveedor: string | null;
  motorizado: string;
  /** En la OC el analista de Compras; en el retiro, el almacenista que revisó. */
  analista: string | null;
  /** Almacén de entrega (OC) o «Entregado a» / destino (retiro). */
  almacen: string;
  /** '—' en un retiro de Almacén (no se paga nada). */
  monto: string;
  pasos: PasoPedido[];
  /** «45 min», «1 h 05 min» o «—» (de tomado a entregado). */
  tiempo: string;
  motivoCancel: string | null;
  nota: string | null;
  fotosRecibo: number;
  fotosEntrega: number;
  productos: Array<{ nombre: string; cantidad: string }>;
}

const cant = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 });

/** Lo que muestran el PDF y el WhatsApp de UN pedido. */
export function detallePedido(p: PedidoDelivery, quien: ResolverNombre = tal): DetallePedidoDelivery {
  const retiro = esRetiroAlmacen(p);
  const pasos: PasoPedido[] = [];
  if (retiro && p.revisada_en) pasos.push({ paso: 'Revisada por Almacén (hay en Los Pinos)', hora: fechaHoraVE(p.revisada_en) });
  if (!retiro && p.pagada_en) pasos.push({ paso: 'Pagada por Tesorería', hora: fechaHoraVE(p.pagada_en) });
  if (p.aceptado_en) pasos.push({ paso: 'Tomada por el delivery', hora: fechaHoraVE(p.aceptado_en) });
  if (p.en_ruta_en) pasos.push({ paso: 'En camino', hora: fechaHoraVE(p.en_ruta_en) });
  if (p.entregado_en) pasos.push({ paso: retiro ? 'Entregada a quien la pidió' : 'Entregada en almacén', hora: fechaHoraVE(p.entregado_en) });
  if (p.cancelado_en) pasos.push({ paso: 'Cancelada', hora: fechaHoraVE(p.cancelado_en) });
  const rep = p.repartidor_nombre ? quien(p.repartidor_nombre, null) : '';
  return {
    origen: retiro ? 'almacen' : 'compra',
    rotuloOrden: retiro ? 'Solicitud de pedido' : 'Orden de compra',
    oc: retiro ? p.codigo : ocDe(p),
    estado: etiquetaEstado(p.estado, p.origen, p.motivo_cancel),
    urgente: !!p.urgente,
    proveedor: retiro ? ALMACEN_RETIRO : (p.proveedor_nombre?.trim() || '—'),
    direccion: retiro ? null : (p.proveedor_direccion?.trim() || null),
    telefonoProveedor: retiro ? null : (p.proveedor_telefono?.trim() || null),
    motorizado: rep || '—',
    analista: (p.analista_nombre || p.analista_email) ? (quien(p.analista_nombre, p.analista_email) || null) : null,
    almacen: destinoDe(p),
    monto: retiro ? '—' : montoTxt(p.total, p.moneda),
    pasos,
    tiempo: p.estado === 'entregado' ? duracionTxt(minutosEntre(p.aceptado_en, p.entregado_en)) : '—',
    motivoCancel: p.estado === 'cancelado'
      ? [p.motivo_cancel?.trim(), p.detalle_cancel?.trim()].filter(Boolean).join(' · ') || null
      : null,
    nota: p.nota_entrega?.trim() || null,
    fotosRecibo: p.fotos_recibo?.length ?? 0,
    fotosEntrega: p.fotos_entrega?.length ?? 0,
    productos: (p.items ?? []).filter((i) => i.comprar !== false)
      .map((i) => ({ nombre: i.nombre, cantidad: `${cant(i.cantidad)}${i.unidad ? ` ${i.unidad}` : ''}` })),
  };
}

/** WhatsApp con el reporte de UN pedido. */
export function textoReportePedido(p: PedidoDelivery, quien: ResolverNombre = tal, generado?: string | null): string {
  const d = detallePedido(p, quien);
  const retiro = d.origen === 'almacen';
  const l = [
    retiro ? '📋 *REPORTE DE DELIVERY · RETIRO EN ALMACÉN*' : '📋 *REPORTE DE DELIVERY*',
    `🔹 *${retiro ? 'Solicitud' : 'Orden'}:* ${d.oc}${d.urgente ? ' · 🚨 URGENTE' : ''}`,
    `📌 *Estado:* ${d.estado}`,
    retiro ? `📦 *Retirar en:* ${d.proveedor}` : `🏭 *Proveedor:* ${d.proveedor}`,
  ];
  if (d.direccion) l.push(`📍 *Dirección:* ${d.direccion}`);
  l.push(`👤 *Delivery:* ${d.motorizado}`);
  if (retiro) {
    l.push(`🏬 *${p.estado === 'entregado' ? 'Entregado a' : 'Entregar a'}:* ${d.almacen}`);
  } else {
    l.push(`🏬 *Almacén de entrega:* ${d.almacen}`);
    l.push(`💵 *Monto OC:* ${d.monto}`);
  }
  if (d.pasos.length) {
    l.push('', '🕒 *Pasos:*');
    for (const x of d.pasos) l.push(`• ${x.paso}: ${x.hora}`);
  }
  if (d.tiempo !== '—') l.push(`⏳ *Tiempo de entrega:* ${d.tiempo}`);
  if (d.motivoCancel) l.push(`❌ *Motivo de cancelación:* ${d.motivoCancel}`);
  if (d.nota) l.push(`📝 *Nota:* ${d.nota}`);
  l.push(`📷 *Fotos:* ${d.fotosRecibo} ${retiro ? 'al retirar en Almacén' : 'al recibir'} · ${d.fotosEntrega} de la entrega`);
  if (d.productos.length) {
    l.push('', `📦 *Productos (${d.productos.length}):*`, ...d.productos.map((x) => `• ${x.nombre} — ${x.cantidad}`));
  }
  l.push('', `🕒 Generado ${generado ?? fechaHoraVE(new Date().toISOString())}`, PIE_DELIVERY);
  return l.join('\n');
}

/* ───────────── General (histórico de la PC) ───────────── */

export type FiltroEstadoDelivery = '' | Exclude<EstadoDelivery, 'por_tomar'>;

/** Estados que se pueden filtrar en el histórico (lo tomado: nunca «por tomar»). */
export const ESTADOS_FILTRO: Array<{ valor: FiltroEstadoDelivery; label: string }> = [
  { valor: '', label: 'Todos los estados' },
  { valor: 'aceptado', label: ESTADO_DELIVERY.aceptado.label },
  { valor: 'en_ruta', label: ESTADO_DELIVERY.en_ruta.label },
  { valor: 'entregado', label: ESTADO_DELIVERY.entregado.label },
  { valor: 'cancelado', label: ESTADO_DELIVERY.cancelado.label },
];

/** 02/11/2026: origen en el histórico ('' = todos). */
export type FiltroOrigenDelivery = '' | OrigenDelivery;

export const ORIGENES_FILTRO: Array<{ valor: FiltroOrigenDelivery; label: string }> = [
  { valor: '', label: 'Compras y Almacén' },
  { valor: 'compra', label: '🏭 Compras (OC pagadas)' },
  { valor: 'almacen', label: '📦 Almacén Los Pinos' },
];

export function filtrarHistorial<T extends Pick<FilaHistorialDelivery, 'estado' | 'repartidor'> & { origen?: OrigenDelivery }>(
  filas: T[], f: { estado?: FiltroEstadoDelivery | null; repartidor?: string | null; origen?: FiltroOrigenDelivery | null },
): T[] {
  return filas.filter((x) => (!f.estado || x.estado === f.estado) && (!f.repartidor || x.repartidor === f.repartidor)
    && (!f.origen || (x.origen ?? 'compra') === f.origen));
}

export interface ResumenReporteDelivery {
  total: number;
  porEstado: Record<Exclude<EstadoDelivery, 'por_tomar'>, number>;
  /** 02/11/2026: cuántos de Compras (OC) y cuántos retiros de Almacén. */
  porOrigen: Record<OrigenDelivery, number>;
  porDelivery: ResumenDelivery[];
  minutosPromedio: number | null;
}

export function resumenReporte(filas: FilaHistorialDelivery[]): ResumenReporteDelivery {
  const porEstado = { aceptado: 0, en_ruta: 0, entregado: 0, cancelado: 0 };
  const porOrigen: Record<OrigenDelivery, number> = { compra: 0, almacen: 0 };
  for (const f of filas) {
    if (f.estado in porEstado) porEstado[f.estado as keyof typeof porEstado]++;
    porOrigen[f.origen === 'almacen' ? 'almacen' : 'compra']++;
  }
  const porDelivery = resumenHistorial(filas);
  return { total: filas.length, porEstado, porOrigen, porDelivery, minutosPromedio: totalesResumen(porDelivery).minutosPromedio };
}

const ddmmaaaa = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);

/** «Del 26/10/2026 al 31/10/2026 · Origen: Almacén Los Pinos · Estado: Entregado en almacén · Delivery: Ana Pérez». */
export function textoFiltros(f: {
  desde: string; hasta: string; estado?: FiltroEstadoDelivery | null; repartidor?: string | null; origen?: FiltroOrigenDelivery | null;
}): string {
  const partes = [f.desde === f.hasta ? `Día ${ddmmaaaa(f.desde)}` : `Del ${ddmmaaaa(f.desde)} al ${ddmmaaaa(f.hasta)}`];
  if (f.origen) partes.push(`Origen: ${f.origen === 'almacen' ? ALMACEN_RETIRO : 'Compras (OC pagadas)'}`);
  if (f.estado) partes.push(`Estado: ${ESTADO_DELIVERY[f.estado]?.label ?? f.estado}`);
  if (f.repartidor) partes.push(`Delivery: ${f.repartidor}`);
  return partes.join(' · ');
}

/** Cuántos pedidos se listan en el WhatsApp (el PDF los trae todos). */
export const MAX_PEDIDOS_WHATSAPP = 40;

/** WhatsApp con el reporte general del rango filtrado. */
export function textoReporteGeneral(data: {
  desde: string; hasta: string; estado?: FiltroEstadoDelivery | null; repartidor?: string | null;
  origen?: FiltroOrigenDelivery | null; filas: FilaHistorialDelivery[]; generado?: string | null;
}): string {
  const r = resumenReporte(data.filas);
  const l = [
    '📊 *REPORTE DE DELIVERY*',
    `📅 ${textoFiltros(data)}`,
    '',
    `📦 *Pedidos tomados:* ${r.total}`,
    `${ORIGEN_DELIVERY.compra.emoji} De Compras (OC): ${r.porOrigen.compra} · ${ORIGEN_DELIVERY.almacen.emoji} Retiros en ${ALMACEN_RETIRO}: ${r.porOrigen.almacen}`,
    `✅ Entregados: ${r.porEstado.entregado}`,
    `🚚 En camino: ${r.porEstado.en_ruta}`,
    `🛵 Aceptados: ${r.porEstado.aceptado}`,
    `⛔ Cancelados: ${r.porEstado.cancelado}`,
    `⏳ *Tiempo promedio de entrega:* ${duracionTxt(r.minutosPromedio)}`,
  ];
  if (r.porDelivery.length) {
    l.push('', '👤 *Por delivery:*');
    for (const x of r.porDelivery) {
      l.push(`• ${x.repartidor}: ${x.entregados} entregado(s), ${x.cancelados} cancelado(s), ${x.enCurso} en curso · ${duracionTxt(x.minutosPromedio)}`);
    }
  }
  if (data.filas.length) {
    l.push('', '📋 *Pedidos:*');
    for (const f of data.filas.slice(0, MAX_PEDIDOS_WHATSAPP)) {
      const est = ESTADO_DELIVERY[f.estado];
      const extra = f.estado === 'cancelado' ? (f.motivo_cancel ? ` · ${f.motivo_cancel}` : '')
        : f.estado === 'entregado' ? ` · ${duracionTxt(f.minutos)}${f.almacen_entrega ? ` · ${f.almacen_entrega}` : ''}` : '';
      const de = f.origen === 'almacen' ? `📦 ${ALMACEN_RETIRO}` : f.proveedor;
      l.push(`${est?.emoji ?? '•'} ${f.oc} · ${de} · ${f.repartidor} · ${fechaHoraVE(f.fecha)}${extra}`);
    }
    if (data.filas.length > MAX_PEDIDOS_WHATSAPP) l.push(`… y ${data.filas.length - MAX_PEDIDOS_WHATSAPP} más (ver el PDF).`);
  } else {
    l.push('', 'No hay pedidos tomados con esos filtros.');
  }
  l.push('', `🕒 Generado ${data.generado ?? fechaHoraVE(new Date().toISOString())}`, PIE_DELIVERY);
  return l.join('\n');
}
