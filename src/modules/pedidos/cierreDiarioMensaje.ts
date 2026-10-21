/* ============================================================
   MGG · Compras · Cierre diario en un mensaje de WhatsApp · 21-10-2026
   Solo los cuatro títulos con sus cantidades, el período y la fecha y hora en que se
   imprime. Cada título lleva su emoji, de color por sí mismo y SIN el selector U+FE0F
   (WhatsApp se lo come y llega un cuadrito; ver comprasReporteMensaje.ts). Se ve y se
   envía desde la ventana «Avisar» (copiar o enviar por WhatsApp).
   ============================================================ */
import type { ResumenCierre } from './cierreDiario';
import { fechaReporteTexto } from './comprasReporteMensaje';

export function mensajeCierreDiario(r: ResumenCierre, impresoIso: string = new Date().toISOString()): string {
  const L: string[] = [
    '📊 *CIERRE DIARIO · COMPRAS*',
    `📅 *Período:* ${r.rango.etiqueta}`,
    `🕒 *Impreso:* ${fechaReporteTexto(impresoIso)}`,
    '',
    ...r.items.map((i) => `${i.emoji} *${i.titulo}:* ${i.cantidad}`),
    '',
    '_MGG · Mineral Group Guayana_',
  ];
  return L.join('\n');
}
