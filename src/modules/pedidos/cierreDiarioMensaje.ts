/* ============================================================
   MGG · Compras · Cierre diario en un mensaje de WhatsApp · 21-10-2026
   Títulos generales, actividad por analista (cotizaciones realizadas
   y órdenes finalizadas), período y fecha/hora de impresión.
   Sin selectores U+FE0F para compatibilidad total con WhatsApp.
   ============================================================ */
import type { ResumenCierre } from './cierreDiario';
import { fechaReporteTexto } from './comprasReporteMensaje';

/** Rótulo y emoji del mensaje (formato acordado, igual al de Golden Touch). */
const EN_MENSAJE: Record<string, { emoji: string; titulo: string }> = {
  pedidos: { emoji: '📥', titulo: 'Pedidos' },
  pendientes_aprobar: { emoji: '⏳', titulo: 'Órdenes pendientes por aprobar' },
  por_pagar: { emoji: '💵', titulo: 'Órdenes por pagar' },
  pagadas: { emoji: '✅', titulo: 'Órdenes pagadas' },
};

export function mensajeCierreDiario(r: ResumenCierre, impresoIso: string = new Date().toISOString()): string {
  const L: string[] = [
    '📊 *CIERRE DIARIO · COMPRAS*',
    '',
    `📅 *Período:* ${r.rango.etiqueta}`,
    '',
    `🕒 *Impreso:* ${fechaReporteTexto(impresoIso)}`,
    '',
  ];

  r.items.forEach((i) => {
    const m = EN_MENSAJE[i.key] ?? { emoji: i.emoji, titulo: i.titulo };
    L.push(`${m.emoji} *${m.titulo}:* ${i.cantidad}`);
    L.push('');
  });

  if (r.analistas && r.analistas.length > 0) {
    L.push('👥 *POR ANALISTA*');
    L.push('');
    r.analistas.forEach((a) => {
      L.push(`👤 *${a.nombre.toUpperCase()}:*`);
      L.push(`Total de cotizaciones realizadas: *${a.cotizaciones}*`);
      L.push(`Total de órdenes finalizadas: *${a.ordenesFinalizadas}*`);
      L.push('');
    });
  }

  L.push('🏢 *MINERAL GROUP GUAYANA C.A.*');

  return L.join('\n');
}

