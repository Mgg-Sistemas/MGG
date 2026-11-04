/* ============================================================
   MGG · Inventario · Comprobante y aviso de una RECEPCIÓN (04-11-2026)

   Pedido de la administradora: «las recepciones también tendrán su respectivo
   PDF y msj de WhatsApp, se seguirá viendo en los históricos de recepciones»,
   en la vista de teléfono y en la PC. Sirve igual para la recepción recién
   hecha y para una del histórico. Emojis sin U+FE0F.
   ============================================================ */
import { nombreAlmacenVisible } from './sectorizacion';

export interface ItemRecepcionReporte { nombre: string; unidad: string | null; cantidad: number; pedido?: number | null; precio: number | null }

export interface DatosRecepcion {
  /** «OC-2026-0238 · R1» o el código de la compra directa. */
  codigo: string;
  documento: string | null;
  proveedor: string | null;
  almacen: string | null;
  at: string;
  /** Quién recibió (nombre y apellido). */
  quien: string | null;
  nota?: string | null;
  /** «HECTOR ALAGAL · entregó en LOS PINOS 03/11 05:01 p. m.» si la trajo un delivery. */
  delivery?: string | null;
  items: ItemRecepcionReporte[];
  fotos?: number;
}

const num = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 4 });
const usd = (n: number) => `$${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function fechaHoraRecepcion(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

/** Valor de lo recibido (solo los renglones con precio). */
export function totalRecepcion(items: ItemRecepcionReporte[]): number {
  return Math.round(items.reduce((a, it) => a + (it.precio && it.precio > 0 ? it.precio * it.cantidad : 0), 0) * 100) / 100;
}

/** El aviso de WhatsApp de una recepción. */
export function mensajeRecepcion(d: DatosRecepcion): string {
  const l = [
    '📥 *RECEPCIÓN EN ALMACÉN*',
    `🔖 *N°:* ${d.codigo}`,
    ...(d.documento && d.documento !== d.codigo ? [`📄 *Orden:* ${d.documento}`] : []),
    ...(d.proveedor ? [`🏭 *Proveedor:* ${d.proveedor}`] : []),
    `🏬 *Almacén:* ${d.almacen ? nombreAlmacenVisible(d.almacen) : '—'}`,
    ...(d.delivery ? [`🛵 *Delivery:* ${d.delivery}`] : []),
    '',
    `📦 *Materiales (${d.items.length}):*`,
    ...d.items.map((it) => {
      const falta = it.pedido != null && it.pedido > it.cantidad ? ` (de ${num(it.pedido)})` : '';
      return `• ${it.nombre}: ${num(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ''}${falta}`;
    }),
  ];
  const total = totalRecepcion(d.items);
  if (total > 0) l.push(`💵 *Valor recibido:* ${usd(total)}`);
  if (d.nota?.trim()) l.push(`📝 *Nota:* ${d.nota.trim()}`);
  if (d.fotos) l.push(`📷 *Fotos:* ${d.fotos}`);
  l.push('');
  if (d.quien) l.push(`👷 *Recibido por:* ${d.quien}`);
  const f = fechaHoraRecepcion(d.at);
  if (f) l.push(`🕒 ${f}`);
  l.push('', `🏢 *MINERAL GROUP GUAYANA C.A.*${d.almacen ? ` · ${nombreAlmacenVisible(d.almacen)}` : ''}`);
  return l.join('\n');
}
