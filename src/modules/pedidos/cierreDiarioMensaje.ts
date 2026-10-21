/* ============================================================
   MGG · Compras · Cierre diario en un mensaje de WhatsApp · 21-10-2026
   Títulos generales, actividad por analista (cotizaciones realizadas
   y órdenes finalizadas), período y fecha/hora de impresión.
   Sin selectores U+FE0F para compatibilidad total con WhatsApp.
   ============================================================ */
import type { ResumenCierre } from './cierreDiario';
import { fechaReporteTexto } from './comprasReporteMensaje';

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
    L.push(`${i.emoji} *${i.titulo}:* ${i.cantidad}`);
    L.push('');
  });

  if (r.analistas && r.analistas.length > 0) {
    L.push('👥 *Actividad por analista:*');
    L.push('');
    r.analistas.forEach((a) => {
      L.push(`• *${a.nombre}:* ${a.cotizaciones} cotizaciones realizadas · ${a.ordenesFinalizadas} órdenes finalizadas`);
      L.push('');
    });
    L.push(`*Total cotizaciones realizadas:* ${r.totalCotizaciones ?? 0}`);
    L.push('');
    L.push(`*Total órdenes finalizadas:* ${r.totalFinalizadas ?? 0}`);
    L.push('');
  }

  L.push('_MGG · Mineral Group Guayana_');

  return L.join('\n');
}

