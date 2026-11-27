import { dateTime, money } from '@/shared/lib/format';

export function mensajeReintegroRecibido(p: {
  codigo: string; proveedor: string; monto: number; moneda: string; caja: string; cuenta: string;
  referencia: string; motivo: string; fecha: string; productos: { sku: string; nombre: string; cantidad: number }[];
}): string {
  return [
    '↩️ *REINTEGRO RECIBIDO · TESORERÍA*', '',
    `🧾 *OC:* ${p.codigo}`, `🏪 *Proveedor:* ${p.proveedor}`,
    `💰 *Importe recibido:* ${money(p.monto, p.moneda)}`, `📅 *Confirmado:* ${dateTime(p.fecha)}`,
    `🏦 *Caja:* ${p.caja}`, `💳 *Cuenta:* ${p.cuenta}`, `🔎 *Referencia:* ${p.referencia}`,
    `📝 *Motivo:* ${p.motivo}`, '', '📦 *Productos del reintegro:*',
    ...p.productos.map(i => `• ${i.sku} · ${i.nombre} · ${i.cantidad}`), '',
    '✅ Ingreso registrado en Tesorería y disponible en Conciliación · Entradas por reintegro.',
    '📎 Se adjunta el comprobante del ingreso.',
  ].join('\n');
}
