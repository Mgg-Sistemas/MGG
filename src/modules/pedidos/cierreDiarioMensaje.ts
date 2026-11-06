/* ============================================================
   MGG · Compras · Cierre diario en un mensaje de WhatsApp · 21-10-2026
   Títulos generales, actividad por analista (cotizaciones realizadas
   y órdenes finalizadas), período y fecha/hora de impresión.
   Sin selectores U+FE0F para compatibilidad total con WhatsApp.
   ============================================================ */
import type { ResumenCierre } from './cierreDiario';
import { fechaReporteTexto } from './comprasReporteMensaje';
import { fmtMonto } from './comprasReporte';

/** Rótulo y emoji del mensaje (formato acordado, igual al de Golden Touch). */
const EN_MENSAJE: Record<string, { emoji: string; titulo: string }> = {
  pedidos: { emoji: '📥', titulo: 'Pedidos' },
  por_pagar: { emoji: '💵', titulo: 'Órdenes por pagar' },
  pagadas: { emoji: '✅', titulo: 'Órdenes pagadas' },
  por_retirar: { emoji: '🚚', titulo: 'Órdenes pendientes por retirar' },
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

  const d = r.porPagarDetalle;
  if (d && d.filas.length > 0) {
    L.push(`💵 *DETALLE · ÓRDENES POR PAGAR (${d.filas.length})*`);
    L.push('');
    d.filas.forEach((f, i) => {
      const monto = f.montoUsd == null ? 'sin tasa BCV' : fmtMonto(f.montoUsd, 'USD');
      L.push(`${i + 1}. ${f.codigo} · ${f.proveedor} — ${monto}`);
    });
    L.push('');
    L.push(`💰 *TOTAL PENDIENTE POR PAGAR:* ${fmtMonto(d.totalUsd, 'USD')}`);
    if (d.enBs > 0) {
      L.push(d.tasa > 0
        ? `(${d.enBs} orden(es) en Bs pasada(s) a $ con la tasa BCV: ${fmtMonto(d.tasa, 'Bs')} por $)`
        : `❗ ${d.sinTasa} orden(es) en Bs no suman al total: no hay tasa BCV disponible.`);
    }
    L.push('');
  }

  const pr = r.porRetirarDetalle ?? [];
  if (pr.length > 0) {
    L.push(`🚚 *ÓRDENES PENDIENTES POR RETIRAR (${pr.length})*`);
    L.push('');
    pr.forEach((f, i) => L.push(`${i + 1}. ${f.codigo} · ${f.proveedor} — ${f.entrega} · pagada ${f.pagada}`));
    L.push('');
  }

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

