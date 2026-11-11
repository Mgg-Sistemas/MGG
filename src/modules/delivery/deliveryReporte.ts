/* ============================================================
   MGG · Delivery · reportes (31-10-2026)

   Lo que llevan los reportes de Delivery, sin tocar pantalla ni base:
     · Comprobante de un pedido: ficha (OC, proveedor, delivery, almacén,
       monto, notas), tiempos (pagada / tomada / en ruta / entregada o
       cancelada), productos e historial.
     · Lista de pedidos tal como se ve (Tablero en la PC, chips del teléfono).
     · Histórico y «Pedidos por delivery» con su rango y filtro.
   De acá salen las filas del PDF (deliveryPdf.ts) y el texto de WhatsApp
   (negritas con *…*, un renglón por pedido). Nada se manda ni se descarga
   solo: los botones «📄 Ver PDF» y «💬 WhatsApp» lo abren.
   Emojis sin el selector U+FE0F (ver mensajeMovimiento.ts).
   ============================================================ */
import {
  ESTADO_DELIVERY, fechaHoraVE, lineasItems, minutosEntre, montoTxt, ocDe, type EstadoDelivery, type PedidoDelivery,
} from './delivery';
import { duracionTxt, totalesResumen, type FilaHistorialDelivery, type ResumenDelivery } from './deliveryPanel';

/** Cómo se muestra el nombre de un almacén (el teléfono usa nombreAlmacenVisible). */
export type VerAlmacen = (a: string) => string;
const tal: VerAlmacen = (a) => a;

const PIE = '🏢 *MINERAL GROUP GUAYANA C.A.* · Delivery';

/** AAAA-MM-DD → DD/MM/AAAA. */
export function fechaTxt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** «Día 30/10/2026» o «Del 26/10/2026 al 30/10/2026». */
export function rangoTxt(desde: string, hasta: string): string {
  return desde === hasta ? `Día ${fechaTxt(desde)}` : `Del ${fechaTxt(desde)} al ${fechaTxt(hasta)}`;
}

export function estadoTxt(e: EstadoDelivery | string): string {
  return ESTADO_DELIVERY[e as EstadoDelivery]?.label ?? String(e);
}

const emojiEstado = (e: EstadoDelivery | string) => ESTADO_DELIVERY[e as EstadoDelivery]?.emoji ?? '•';
const cant = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 });
const limpio = (s: string | null | undefined) => (s ?? '').trim();

/** Montos sumados por moneda: «$1.200,00 + Bs 3.500,00» (o «$0,00»). */
export function totalPorMoneda(xs: Array<{ total: number; moneda: string }>): string {
  const acc = new Map<string, number>();
  for (const x of xs) {
    const m = (x.moneda || 'USD').toUpperCase() === 'BS' ? 'BS' : 'USD';
    acc.set(m, (acc.get(m) ?? 0) + (Number(x.total) || 0));
  }
  if (!acc.size) return montoTxt(0, 'USD');
  return ['USD', 'BS'].filter((m) => acc.has(m)).map((m) => montoTxt(acc.get(m) ?? 0, m)).join(' + ');
}

/* ───────────── Comprobante de un pedido ───────────── */

/** La ficha del comprobante: [rótulo, valor]. Solo lleva lo que tiene dato. */
export function fichaComprobanteDelivery(p: PedidoDelivery, ver: VerAlmacen = tal): Array<[string, string]> {
  const f: Array<[string, string]> = [['Orden de compra', ocDe(p)]];
  if (p.oc_codigo && p.codigo && p.codigo !== p.oc_codigo) f.push(['Solicitud', p.codigo]);
  f.push(['Estado', estadoTxt(p.estado)], ['Requerimiento', p.urgente ? 'URGENTE' : 'Normal']);
  f.push(['Proveedor', p.proveedor_nombre || '—']);
  if (limpio(p.proveedor_direccion)) f.push(['Dirección del proveedor', limpio(p.proveedor_direccion)]);
  if (limpio(p.proveedor_contacto)) f.push(['Contacto', limpio(p.proveedor_contacto)]);
  if (limpio(p.proveedor_telefono)) f.push(['Teléfono del proveedor', limpio(p.proveedor_telefono)]);
  const analista = limpio(p.analista_nombre) || limpio(p.analista_email);
  if (analista) f.push(['Analista de Compras', analista]);
  f.push(['Delivery (motorizado)', p.repartidor_nombre || '—']);
  if (p.almacen_destino) f.push(['Almacén destino (OC)', ver(p.almacen_destino)]);
  if (p.almacen_entrega) f.push(['Entregado en', ver(p.almacen_entrega)]);
  f.push(['Monto de la OC', montoTxt(p.total, p.moneda)]);
  if (limpio(p.motivo)) f.push(['Motivo de la compra', limpio(p.motivo)]);
  if (limpio(p.finalidad)) f.push(['Finalidad', limpio(p.finalidad)]);
  if (limpio(p.notas)) f.push(['Notas de la OC', limpio(p.notas)]);
  if (p.estado === 'cancelado') {
    f.push(['Motivo de cancelación', limpio(p.motivo_cancel) || '—']);
    if (limpio(p.detalle_cancel)) f.push(['Detalle', limpio(p.detalle_cancel)]);
  }
  if (limpio(p.nota_entrega)) f.push(['Nota de entrega', limpio(p.nota_entrega)]);
  f.push(['Fotos', `${p.fotos_recibo?.length ?? 0} de factura · ${p.fotos_entrega?.length ?? 0} de entrega en almacén`]);
  return f;
}

/** Los tiempos del pedido: [paso, fecha y hora]. */
export function tiemposComprobanteDelivery(p: PedidoDelivery): Array<[string, string]> {
  const t: Array<[string, string]> = [
    ['Pagada por Tesorería', fechaHoraVE(p.pagada_en) || '—'],
    ['Tomada por el delivery', fechaHoraVE(p.aceptado_en) || '—'],
    ['En ruta', fechaHoraVE(p.en_ruta_en) || '—'],
  ];
  if (p.estado === 'cancelado') t.push(['Cancelada', fechaHoraVE(p.cancelado_en) || '—']);
  else t.push(['Entregada en almacén', fechaHoraVE(p.entregado_en) || '—']);
  if (p.estado === 'entregado') t.push(['Tiempo (tomada → entregada)', duracionTxt(minutosEntre(p.aceptado_en, p.entregado_en))]);
  return t;
}

/** Productos que se compran: [#, producto, cantidad, unidad]. */
export function itemsComprobanteDelivery(p: PedidoDelivery): string[][] {
  return (p.items ?? []).filter((i) => i.comprar !== false)
    .map((i, k) => [String(k + 1), i.nombre, cant(i.cantidad), i.unidad ?? '']);
}

/** El historial guardado del pedido: [fecha, evento, quién, motivo]. */
/** `nombre` pasa el correo guardado a «Nombre Apellido» (04-11-2026: en el PDF salía el correo). */
export function historialComprobanteDelivery(p: PedidoDelivery, nombre: (correo: string) => string = (c) => c): string[][] {
  return (p.historial ?? []).map((e) => [
    fechaHoraVE(e.at) || '—', estadoTxt(e.evento), limpio(e.actor) ? (nombre(limpio(e.actor)) || limpio(e.actor)) : '—', limpio(e.motivo) || '—',
  ]);
}

/** El reporte de un pedido para WhatsApp (en cualquier estado). */
export function mensajeReporteDelivery(p: PedidoDelivery, ver: VerAlmacen = tal, ahora?: string): string {
  const l = [
    `📋 *REPORTE DE DELIVERY · ${ocDe(p)}*`,
    `${emojiEstado(p.estado)} *Estado:* ${estadoTxt(p.estado)}`,
    p.urgente ? '🚨 *Requerimiento:* URGENTE' : '🟢 *Requerimiento:* Normal',
    `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`,
  ];
  if (limpio(p.proveedor_direccion)) l.push(`📍 *Dirección:* ${limpio(p.proveedor_direccion)}`);
  l.push(`👤 *Delivery:* ${p.repartidor_nombre ?? '—'}`);
  if (p.almacen_destino) l.push(`🏬 *Almacén destino:* ${ver(p.almacen_destino)}`);
  if (p.almacen_entrega) l.push(`🏬 *Entregado en:* ${ver(p.almacen_entrega)}`);
  l.push(`💵 *Monto:* ${montoTxt(p.total, p.moneda)}`);

  l.push('', '🕒 *Tiempos:*');
  if (p.pagada_en) l.push(`• Pagada: ${fechaHoraVE(p.pagada_en)}`);
  if (p.aceptado_en) l.push(`• Tomada: ${fechaHoraVE(p.aceptado_en)}`);
  if (p.en_ruta_en) l.push(`• En ruta: ${fechaHoraVE(p.en_ruta_en)}`);
  if (p.estado === 'entregado' && p.entregado_en) {
    l.push(`• Entregada: ${fechaHoraVE(p.entregado_en)}`);
    const m = minutosEntre(p.aceptado_en, p.entregado_en);
    if (m != null) l.push(`⏳ *Tiempo desde que lo tomó:* ${duracionTxt(m)}`);
  }
  if (p.estado === 'cancelado' && p.cancelado_en) l.push(`• Cancelada: ${fechaHoraVE(p.cancelado_en)}`);
  if (!p.pagada_en && !p.aceptado_en) l.push('• Sin movimientos todavía');

  const items = lineasItems(p);
  if (items.length) l.push('', `📦 *Productos (${items.length}):*`, ...items);

  if (p.estado === 'cancelado') {
    l.push('', `❌ *Motivo:* ${limpio(p.motivo_cancel) || '—'}`);
    if (limpio(p.detalle_cancel)) l.push(`📝 *Detalle:* ${limpio(p.detalle_cancel)}`);
  }
  if (limpio(p.nota_entrega)) l.push(`📝 *Nota de entrega:* ${limpio(p.nota_entrega)}`);
  const nFotos = (p.fotos_recibo?.length ?? 0) + (p.fotos_entrega?.length ?? 0);
  if (nFotos) l.push(`📷 *Fotos:* ${p.fotos_recibo?.length ?? 0} al recibir · ${p.fotos_entrega?.length ?? 0} de la entrega`);
  l.push('', `🗓 Generado ${fechaHoraVE(ahora ?? new Date().toISOString())}`, '', PIE);
  return l.join('\n');
}

/* ───────────── Lista de pedidos (Tablero / teléfono) ───────────── */

/**
 * En el teléfono un pedido «cancelado» que quedó libre otra vez se muestra
 * «Por tomar»: la lista del reporte lo cuenta igual que la pantalla.
 */
export function pedidosDelFeed(feed: Array<{ p: PedidoDelivery; disponible: boolean }>): PedidoDelivery[] {
  return feed.map((f) => (f.disponible && f.p.estado !== 'por_tomar' ? { ...f.p, estado: 'por_tomar' as const } : f.p));
}

const fin = (p: PedidoDelivery) => (p.estado === 'cancelado' ? p.cancelado_en : p.estado === 'entregado' ? p.entregado_en : null);

/** Columnas del PDF de la lista. */
export const COLUMNAS_LISTA_DELIVERY = ['OC', 'Proveedor', 'Delivery', 'Estado', 'Pagada', 'Tomada', 'En ruta', 'Entregada / Cancelada', 'Tiempo', 'Almacén / Motivo', 'Monto'];

/** Una fila por pedido, en el orden de COLUMNAS_LISTA_DELIVERY. */
export function filasListaDelivery(pedidos: PedidoDelivery[], ver: VerAlmacen = tal): string[][] {
  return pedidos.map((p) => {
    const almacen = p.almacen_entrega ?? p.almacen_destino;
    return [
      `${ocDe(p)}${p.urgente ? ' (URGENTE)' : ''}`,
      p.proveedor_nombre ?? '—',
      p.repartidor_nombre ?? '—',
      estadoTxt(p.estado),
      fechaHoraVE(p.pagada_en) || '—',
      fechaHoraVE(p.aceptado_en) || '—',
      fechaHoraVE(p.en_ruta_en) || '—',
      fechaHoraVE(fin(p)) || '—',
      p.estado === 'entregado' ? duracionTxt(minutosEntre(p.aceptado_en, p.entregado_en)) : '—',
      (p.estado === 'cancelado' ? limpio(p.motivo_cancel) : almacen ? ver(almacen) : '') || '—',
      montoTxt(p.total, p.moneda),
    ];
  });
}

/** Conteo por estado en una línea: «💰 2 por tomar · 🚚 1 en ruta…» (solo los que hay). */
function conteoTxt(estados: EstadoDelivery[]): string {
  const orden: EstadoDelivery[] = ['por_tomar', 'aceptado', 'en_ruta', 'entregado', 'cancelado'];
  const corto: Record<EstadoDelivery, string> = {
    por_tomar: 'por tomar', aceptado: 'aceptado(s)', en_ruta: 'en ruta', entregado: 'entregado(s)', cancelado: 'cancelado(s)',
  };
  return orden.map((e) => [e, estados.filter((x) => x === e).length] as const)
    .filter(([, n]) => n > 0).map(([e, n]) => `${ESTADO_DELIVERY[e].emoji} ${n} ${corto[e]}`).join(' · ');
}

/** WhatsApp de la lista que se está viendo, un renglón por pedido. */
export function mensajeListaDelivery(data: {
  pedidos: PedidoDelivery[]; filtro?: string | null; ver?: VerAlmacen; ahora?: string;
}): string {
  const ver = data.ver ?? tal;
  const l = ['📋 *DELIVERY · PEDIDOS*'];
  if (limpio(data.filtro)) l.push(`🔎 *Vista:* ${limpio(data.filtro)}`);
  l.push(`📦 *Pedidos:* ${data.pedidos.length}`);
  if (data.pedidos.length) {
    l.push(conteoTxt(data.pedidos.map((p) => p.estado)), `💵 *Monto:* ${totalPorMoneda(data.pedidos)}`, '');
    for (const p of data.pedidos) {
      const partes = [`${p.urgente ? '🚨 ' : '• '}*${ocDe(p)}*`, p.proveedor_nombre ?? '—', `${emojiEstado(p.estado)} ${estadoTxt(p.estado)}`];
      if (p.repartidor_nombre) partes.push(`🛵 ${p.repartidor_nombre}`);
      const almacen = p.almacen_entrega ?? p.almacen_destino;
      if (almacen && p.estado !== 'cancelado') partes.push(`🏬 ${ver(almacen)}`);
      partes.push(montoTxt(p.total, p.moneda));
      l.push(partes.join(' · '));
    }
  }
  l.push('', `🗓 Generado ${fechaHoraVE(data.ahora ?? new Date().toISOString())}`, '', PIE);
  return l.join('\n');
}

/* ───────────── Histórico y Por delivery ───────────── */

/** WhatsApp del Histórico (rango y filtro de motorizado), un renglón por registro. */
export function mensajeHistorialDelivery(data: {
  desde: string; hasta: string; repartidor?: string | null; filas: FilaHistorialDelivery[]; ahora?: string;
}): string {
  const l = ['📜 *HISTÓRICO DE DELIVERY*', `📅 *Rango:* ${rangoTxt(data.desde, data.hasta)}`];
  if (limpio(data.repartidor)) l.push(`🛵 *Delivery:* ${limpio(data.repartidor)}`);
  l.push(`📦 *Registros:* ${data.filas.length}`);
  if (data.filas.length) {
    l.push(conteoTxt(data.filas.map((f) => f.estado)), `💵 *Monto:* ${totalPorMoneda(data.filas)}`, '');
    for (const f of data.filas) {
      const partes = [`• ${fechaHoraVE(f.fecha) || '—'}`, `*${f.oc}*`, f.proveedor];
      if (!limpio(data.repartidor)) partes.push(`🛵 ${f.repartidor}`);
      partes.push(`${emojiEstado(f.estado)} ${estadoTxt(f.estado)}`);
      if (f.estado === 'entregado' && f.minutos != null) partes.push(`⏳ ${duracionTxt(f.minutos)}`);
      if (f.estado === 'cancelado' && limpio(f.motivo_cancel)) partes.push(limpio(f.motivo_cancel));
      partes.push(montoTxt(f.total, f.moneda));
      l.push(partes.join(' · '));
    }
  }
  l.push('', `🗓 Generado ${fechaHoraVE(data.ahora ?? new Date().toISOString())}`, '', PIE);
  return l.join('\n');
}

/** WhatsApp de «Pedidos por delivery»: un renglón por motorizado y el total. */
export function mensajePorDelivery(data: { desde: string; hasta: string; resumen: ResumenDelivery[]; ahora?: string }): string {
  const l = ['🛵 *PEDIDOS POR DELIVERY*', `📅 *Rango:* ${rangoTxt(data.desde, data.hasta)}`];
  if (!data.resumen.length) l.push('', 'Ningún delivery tomó pedidos en ese rango.');
  else {
    l.push('');
    for (const r of data.resumen) {
      l.push(`• *${r.repartidor}* — ✅ ${r.entregados} · ⛔ ${r.cancelados} · 🚚 ${r.enCurso} en curso · ⏳ ${duracionTxt(r.minutosPromedio)}`);
    }
    const t = totalesResumen(data.resumen);
    l.push('', `📊 *Total:* ✅ ${t.entregados} entregados · ⛔ ${t.cancelados} cancelados · 🚚 ${t.enCurso} en curso`);
    l.push(`⏳ *Tiempo promedio:* ${duracionTxt(t.minutosPromedio)}`);
  }
  l.push('', `🗓 Generado ${fechaHoraVE(data.ahora ?? new Date().toISOString())}`, '', PIE);
  return l.join('\n');
}
