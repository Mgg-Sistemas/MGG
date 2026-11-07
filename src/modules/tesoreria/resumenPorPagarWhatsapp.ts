/* ============================================================
   MGG · Tesorería · Resumen por lote de las órdenes por pagar (04-11-2026)

   Pedido de la administradora: en «Órdenes pendientes por pagar», un WhatsApp
   tipo resumen como el individual pero por lote. Se seleccionan todas o una a
   una, y sale el código de cada orden, el proveedor y el monto a pagar (solo $),
   el total de todas, el motivo de pago de cada una (¿se pagará?) y la fecha en
   que se generó el mensaje.

   Builder PURO: no toca Supabase ni la pantalla. Emojis sin el selector U+FE0F.
   ============================================================ */
import { identidadEmpresa } from '@/shared/lib/empresa';

/** El motivo de pago, como en la ventana individual. */
export type MotivoPagoLote = 'si' | 'sin_fondos' | 'esperando_jefe' | 'otro';

export const ETIQUETA_MOTIVO_LOTE: Record<MotivoPagoLote, string> = {
  si: 'Sí, se pagará',
  sin_fondos: 'Sin fondos en estos momentos',
  esperando_jefe: 'Esperando respuestas por el jefe',
  otro: 'Otro motivo',
};

export interface ItemResumenPorPagar {
  codigo: string;
  proveedor: string;
  /** Lo que se paga, en $. */
  montoUsd: number;
  motivo: MotivoPagoLote;
  /** Lo escrito cuando el motivo es «otro». */
  motivoOtro?: string | null;
}

function num(n: number): string {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const usd = (n: number) => `$${num(n)}`;
const unaLinea = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** «04/11/2026 07:30 p. m.» en la hora de Venezuela. */
export function fechaHoraResumen(d: Date): string {
  const f = d.toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' });
  const h = d.toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true });
  return `${f} ${h}`;
}

/** El estado de una orden en el resumen: «✅ Se pagará» o «⏸ No se pagará · <motivo>». */
export function estadoItemResumen(it: Pick<ItemResumenPorPagar, 'motivo' | 'motivoOtro'>): string {
  if (it.motivo === 'si') return '✅ *Se pagará*';
  const desc = it.motivo === 'otro' ? (unaLinea(it.motivoOtro) || 'Otro motivo') : ETIQUETA_MOTIVO_LOTE[it.motivo];
  return `⏸ *No se pagará* · ${desc}`;
}

/** Qué falta para armar el resumen (null si está bien). */
export function errorResumenPorPagar(items: ItemResumenPorPagar[]): string | null {
  if (!items.length) return 'Selecciona al menos una orden.';
  const sinMotivo = items.find((i) => i.motivo === 'otro' && !unaLinea(i.motivoOtro));
  if (sinMotivo) return `Escribe el motivo de ${sinMotivo.codigo}.`;
  return null;
}

/** 07-11-2026: no hay ninguna orden por pagar → «Tesorería al día». */
export function textoTesoreriaAlDia(ahora: Date): string {
  return [
    '🧾 *RESUMEN · ÓRDENES POR PAGAR*',
    `📅 *Generado:* ${fechaHoraResumen(ahora)}`,
    '',
    '🧾 *ÓRDENES PENDIENTES POR PAGAR: 0*',
    '',
    '✅ *TESORERÍA AL DÍA EN PAGOS PENDIENTES*',
    '',
    `🏢 *${identidadEmpresa().nombre}*`,
  ].join('\n');
}

export function textoResumenPorPagar(items: ItemResumenPorPagar[], ahora: Date): string {
  const L: string[] = [];
  L.push('🧾 *RESUMEN · ÓRDENES POR PAGAR*');
  L.push(`📅 *Generado:* ${fechaHoraResumen(ahora)}`);
  L.push('');
  items.forEach((it, i) => {
    L.push(`${i + 1}. 🔹 *${unaLinea(it.codigo) || '—'}* · ${unaLinea(it.proveedor) || '—'}`);
    L.push(`    💵 *A pagar:* ${usd(it.montoUsd)} · ${estadoItemResumen(it)}`);
  });
  const total = items.reduce((a, it) => a + (Number(it.montoUsd) || 0), 0);
  const sePagan = items.filter((it) => it.motivo === 'si');
  const totalSi = sePagan.reduce((a, it) => a + (Number(it.montoUsd) || 0), 0);
  L.push('');
  L.push(`💰 *Total (${items.length} ${items.length === 1 ? 'orden' : 'órdenes'}):* *${usd(total)}*`);
  // Si no todas se pagan, cuánto sí sale hoy.
  if (sePagan.length !== items.length) {
    L.push(`✅ *Se pagarán (${sePagan.length}):* *${usd(totalSi)}*`);
    L.push(`⏸ *No se pagarán (${items.length - sePagan.length}):* *${usd(total - totalSi)}*`);
  }
  L.push(`🏢 *${identidadEmpresa().nombre}*`);
  return L.join('\n');
}
