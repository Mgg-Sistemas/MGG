/* ============================================================
   MGG · Alimentación · La comida contada en un mensaje

   Igual que en Combustible: lo que se sirvió se avisa por WhatsApp, y
   el texto se arma UNA vez desde la comida guardada. Si dice 32
   personas y 3 kg de arroz es porque en la base dice eso.

   ⚠ Todos los emojis son de COLOR POR SÍ MISMOS (sin el selector
   U+FE0F): WhatsApp se lo come y del otro lado llega un cuadrito. Por
   eso el almuerzo va con 🍛 y no con 🍽 (que es texto sin selector).
   `mensajeComida.test.ts` lo verifica.
   ============================================================ */
import type { CocinaComida, TipoComida } from '@/shared/lib/types';
import { enlaceWhatsapp } from '@/modules/combustible/mensajeMovimiento';

export { enlaceWhatsapp };

/** El emoji de cada servicio, en el mensaje y en los botones del teléfono. */
export const EMOJI_COMIDA: Record<TipoComida, string> = {
  desayuno: '🍳',
  almuerzo: '🍛',
  cena: '🌙',
};

export const TITULO_COMIDA: Record<TipoComida, string> = {
  desayuno: 'DESAYUNO',
  almuerzo: 'ALMUERZO',
  cena: 'CENA',
};

const nf = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 3 });

/** «30/09/2026», en la fecha de planta (una comida de «otro día» se guarda a mediodía). */
export function fechaComidaTexto(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

/**
 * El mensaje listo para copiar o mandar por WhatsApp.
 *
 * Lleva lo que se pregunta del otro lado: qué servicio, de qué cocina, qué día,
 * para cuántas personas y qué se gastó. Los precios NO van: el mensaje lo lee
 * gente que no tiene por qué ver el costo; el valor está en el sistema.
 */
export function mensajeComida(c: Pick<CocinaComida, 'tipo_comida' | 'platos' | 'items' | 'at' | 'codigo' | 'nota'>, ctx: { cocina?: string | null; fotos?: number } = {}): string {
  const emoji = EMOJI_COMIDA[c.tipo_comida] ?? '🍳';
  const lineas: string[] = [`${emoji} *${TITULO_COMIDA[c.tipo_comida] ?? 'COMIDA'}*`, ''];
  if (ctx.cocina) lineas.push(`🏠 Cocina: ${ctx.cocina}`);
  lineas.push(`📅 Fecha: ${fechaComidaTexto(c.at)}`);
  lineas.push(`👥 Personas: *${nf.format(Number(c.platos) || 0)}*`);
  const items = c.items ?? [];
  if (items.length) {
    lineas.push('', `📦 *Consumo (${items.length})*`);
    for (const it of items) {
      lineas.push(`• ${it.nombre}: ${nf.format(Number(it.cantidad) || 0)} ${(it.unidad ?? '').toLowerCase()}`.trimEnd());
    }
  }
  const nota = (c.nota ?? '').trim();
  if (nota) lineas.push('', `📝 Nota: ${nota}`);
  if (ctx.fotos) lineas.push(`📷 Fotos: ${ctx.fotos} en el sistema`);
  if (c.codigo) lineas.push(`🧾 ${c.codigo}`);
  lineas.push('', '_MGG · Mineral Group Guayana_');
  return lineas.join('\n');
}
