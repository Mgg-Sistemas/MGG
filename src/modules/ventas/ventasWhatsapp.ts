/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Mensajes de WhatsApp por etapa (10/11/2026)

   Adaptados de La Cantera. Uno por paso de la venta: cotización, despacho por
   aprobar, despacho aprobado / no aprobado, factura, cobro o abono,
   recordatorio de cobro, venta finalizada y anulada.

   Reglas del formato (las mismas del resto del sistema):
     · Una línea sin dato no sale (nada de «Detalle: —»).
     · Sin el selector invisible U+FE0F: WhatsApp lo pierde en algunos
       teléfonos y el emoji sale roto.
   No se manda nada solo: el texto se muestra para copiarlo o enviarlo.
   ============================================================ */
import { identidadEmpresa } from '@/shared/lib/empresa';
import type { Venta, VentaRenglon } from './ventas.repository';
import { esNoProcede, fechaCorta, MOTIVO_NO_DESPACHO, PREFIJO_NO_PROCEDE, validaHasta, type TarjetaVenta } from './ventasTablero';

type Renglon = Pick<VentaRenglon, 'producto_nombre' | 'producto_sku' | 'cantidad' | 'unidad'>;

function num(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function monto(n: number | null | undefined, moneda: string | null | undefined): string {
  return moneda === 'Bs' ? `Bs ${num(n)}` : `$ ${num(n)}`;
}

/** dd/mm/aaaa hh:mm (hora de Venezuela). */
function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const pie = () => `🏢 *${identidadEmpresa('MGG').nombre.toUpperCase()}*`;

function cliente(v: Venta): string {
  const n = (v.cliente_nombre ?? '').trim() || '—';
  return `👤 *Cliente:* ${n}${v.cliente_rif ? ` · ${v.cliente_rif}` : ''}`;
}

function productos(rs: Renglon[]): string[] {
  if (!rs.length) return [];
  return [
    `📦 *Productos (${rs.length}):*`,
    ...rs.map((r) => {
      const nombre = (r.producto_nombre || r.producto_sku || 'Producto').trim();
      const cant = (Number(r.cantidad) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 });
      return `• ${nombre} — ${cant}${r.unidad ? ` ${r.unidad}` : ''}`;
    }),
  ];
}

/** «💵 *Total:* $ 120,00 · Bs 4.380,00» (la equivalencia, si hay tasa). */
function total(v: Venta, etiqueta = 'Total', n: number = v.total): string {
  const tasa = Number(v.tasa_bs) || 0;
  let eq = '';
  if (tasa > 0 && v.moneda !== 'Bs') eq = ` · Bs ${num(n * tasa)}`;
  else if (tasa > 0 && v.moneda === 'Bs') eq = ` · $ ${num(n / tasa)}`;
  return `💵 *${etiqueta}:* ${monto(n, v.moneda)}${eq}`;
}

const condicion = (v: Venta) => (v.condicion === 'credito' ? 'Crédito' : 'Contado');
const documento = (v: Venta) => (v.documento === 'factura' ? 'Factura' : 'Nota de entrega');

function armar(lineas: Array<string | null | undefined | false>): string {
  return lineas.filter((l): l is string => typeof l === 'string' && l.trim() !== '').join('\n');
}

export function textoCotizacion(v: Venta, rs: Renglon[]): string {
  return armar([
    `📝 *COTIZACIÓN ${v.codigo}*`,
    cliente(v),
    ...productos(rs),
    total(v),
    `📅 *Válida hasta:* ${fechaCorta(validaHasta(v))}`,
    v.actor_name && `🙋 *Atiende:* ${v.actor_name}`,
    pie(),
  ]);
}

export function textoDespachoPorAprobar(v: Venta, rs: Renglon[]): string {
  return armar([
    `🚚 *DESPACHO POR APROBAR · ${v.codigo}*`,
    cliente(v),
    `📄 *Documento:* ${documento(v)} · ${condicion(v)}`,
    ...productos(rs),
    v.cobrar_el && `📅 *Paga el:* ${fechaCorta(v.cobrar_el)}`,
    total(v),
    v.no_despacho_motivo && `⏳ *Pendiente:* ${MOTIVO_NO_DESPACHO[v.no_despacho_motivo].largo}${v.no_despacho_detalle ? `: ${v.no_despacho_detalle}` : ''}`,
    (v.enviada_por || v.actor_name) && `🙋 *Pide:* ${v.enviada_por || v.actor_name}`,
    '➡ *Sigue:* aprobar el despacho',
    pie(),
  ]);
}

export function textoDespachoAprobado(v: Venta, rs: Renglon[]): string {
  return armar([
    `✅ *DESPACHO APROBADO · ${documento(v).toUpperCase()} ${v.codigo}*`,
    cliente(v),
    ...productos(rs),
    total(v),
    v.autorizada_por && `👔 *Autorizó:* ${v.autorizada_por}`,
    v.entregada_at && `📅 *Fecha:* ${fechaHora(v.entregada_at)}`,
    v.cobrar_el && `💳 *Paga el:* ${fechaCorta(v.cobrar_el)}`,
    pie(),
  ]);
}

/** «No aprobado por ahora» (sigue por aprobar) o «no procede» (anulada). */
export function textoDespachoNoAprobado(v: Venta, rs: Renglon[]): string {
  const noProcede = v.estado === 'anulada' && esNoProcede(v);
  const motivo = noProcede
    ? (v.motivo_anulacion ?? '').replace(PREFIJO_NO_PROCEDE, 'No procede:').trim()
    : v.no_despacho_motivo
      ? `${MOTIVO_NO_DESPACHO[v.no_despacho_motivo].largo}${v.no_despacho_detalle ? `: ${v.no_despacho_detalle}` : ''}`
      : '';
  return armar([
    noProcede ? `🚫 *DESPACHO NO APROBADO · ${v.codigo}*` : `⏳ *DESPACHO NO APROBADO POR AHORA · ${v.codigo}*`,
    cliente(v),
    ...productos(rs),
    total(v),
    motivo && `📌 *Motivo:* ${motivo}`,
    noProcede ? '➡ *Sigue:* no se despacha' : '➡ *Sigue:* por aprobar; se aprueba cuando se resuelva',
    pie(),
  ]);
}

export function textoFactura(v: Venta, rs: Renglon[]): string {
  return armar([
    `🧾 *FACTURA ${v.numero_factura ?? ''} · Nº DE CONTROL ${v.numero_control ?? ''}*`,
    cliente(v),
    `📄 *Venta:* ${v.codigo}`,
    ...productos(rs),
    v.iva_monto > 0 && `🧮 *IVA (${num(v.iva_pct)} %):* ${monto(v.iva_monto, v.moneda)}`,
    v.igtf_monto > 0 && `💱 *IGTF (${num(v.igtf_pct)} %):* ${monto(v.igtf_monto, v.moneda)}`,
    total(v),
    `📋 *Condición:* ${condicion(v)}${v.cobrar_el ? ` · vence ${fechaCorta(v.cobrar_el)}` : ''}`,
    pie(),
  ]);
}

export function textoCobro(v: Venta, cobro: { monto: number; saldo: number; caja?: string | null; nota?: string | null; at?: string }): string {
  const saldado = cobro.saldo <= 0.01;
  return armar([
    saldado ? `✅ *VENTA COBRADA · ${v.codigo}*` : `💵 *ABONO REGISTRADO · ${v.codigo}*`,
    cliente(v),
    cobro.caja && `💳 *Entró a:* ${cobro.caja}`,
    cobro.nota && `🧾 *Referencia:* ${cobro.nota}`,
    `💵 *Monto:* ${monto(cobro.monto, v.moneda)}`,
    saldado ? `✓ *Saldo:* ${monto(0, v.moneda)}` : `📉 *Saldo pendiente:* ${monto(cobro.saldo, v.moneda)}`,
    `📅 *Fecha:* ${fechaHora(cobro.at ?? new Date().toISOString())}`,
    pie(),
  ]);
}

export function textoRecordatorio(t: TarjetaVenta, hoy: string): string {
  const v = t.venta;
  const fecha = v.cobrar_el
    ? `📅 *${v.cobrar_el.slice(0, 10) < hoy ? 'Venció el' : 'Vence el'}:* ${fechaCorta(v.cobrar_el)}`
    : null;
  return armar([
    `🔔 *RECORDATORIO DE COBRO · ${v.codigo}*`,
    cliente(v),
    fecha,
    total(v, t.etapa === 'facturada' ? 'Total factura' : 'Total nota'),
    t.cobrado > 0.01 && `💵 *Abonado:* ${monto(t.cobrado, v.moneda)}`,
    `📉 *Saldo:* ${monto(t.saldo, v.moneda)}`,
    '🏦 Puede pagar por transferencia o pago móvil y enviar el comprobante por aquí.',
    pie(),
  ]);
}

export function textoVentaFinalizada(t: TarjetaVenta, rs: Renglon[]): string {
  const v = t.venta;
  return armar([
    `🏁 *VENTA FINALIZADA · ${v.codigo}*`,
    cliente(v),
    tieneNumeros(v) && `🔗 ${v.codigo} → Factura ${v.numero_factura} · Control ${v.numero_control}`,
    ...productos(rs),
    total(v, 'Total cobrado', t.cobrado > 0 ? t.cobrado : v.diferencia),
    pie(),
  ]);
}

function tieneNumeros(v: Venta): boolean {
  return !!(v.numero_factura && v.numero_control);
}

export function textoAnulada(v: Venta, rs: Renglon[]): string {
  if (esNoProcede(v)) return textoDespachoNoAprobado(v, rs);
  return armar([
    `⊘ *VENTA ANULADA · ${v.codigo}*`,
    cliente(v),
    ...productos(rs),
    v.motivo_anulacion && `📌 *Motivo:* ${v.motivo_anulacion}`,
    pie(),
  ]);
}

/** El mensaje que corresponde a la etapa actual de la tarjeta. */
export function whatsappDe(t: TarjetaVenta, rs: Renglon[]): { titulo: string; texto: string } {
  const v = t.venta;
  switch (t.etapa) {
    case 'cot': return { titulo: `Cotización · ${v.codigo}`, texto: textoCotizacion(v, rs) };
    case 'aprobar':
      return v.no_despacho_motivo
        ? { titulo: `Despacho no aprobado por ahora · ${v.codigo}`, texto: textoDespachoNoAprobado(v, rs) }
        : { titulo: `Despacho por aprobar · ${v.codigo}`, texto: textoDespachoPorAprobar(v, rs) };
    case 'despachada': return { titulo: `Despacho aprobado · ${v.codigo}`, texto: textoDespachoAprobado(v, rs) };
    case 'facturada': return { titulo: `Factura · ${v.numero_factura ?? v.codigo}`, texto: textoFactura(v, rs) };
    case 'cobrada': return { titulo: `Venta finalizada · ${v.codigo}`, texto: textoVentaFinalizada(t, rs) };
    case 'anulada': return { titulo: `Anulada · ${v.codigo}`, texto: textoAnulada(v, rs) };
    default: return { titulo: v.codigo, texto: textoCotizacion(v, rs) };
  }
}
