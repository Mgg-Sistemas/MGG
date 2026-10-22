/* ============================================================
   MGG · Compras · «Pendientes por pagar» en un mensaje de WhatsApp (20-10-2026)
   Se arma UNA vez desde las mismas filas que la pantalla y el Excel. Cada
   segmento lleva su emoji (de color por sí mismo, sin el selector U+FE0F: WhatsApp
   se lo come y llegaría un cuadrito; ver comprasReporteMensaje.ts) y el enlace va
   derecho a api.whatsapp.com (nunca wa.me). La prueba lo verifica.
   ============================================================ */
import { fmtMonto } from './comprasReporte';
import { enlaceWhatsapp, puedeCompartir, compartirMovimiento, fechaReporteTexto } from './comprasReporteMensaje';
import { CREDITO_ESTILO, EMOJI_TOTAL, subtotalSegmento, usdABs, type ReportePorPagar } from './pendientesPorPagarReporte';

// Mismo enlace y mismo «compartir» que el resto de reportes: una sola implementación.
export { enlaceWhatsapp, puedeCompartir, compartirMovimiento };

/** Cuántas filas se listan por segmento antes de mandar al Excel o al PDF. */
export const MAX_POR_SEGMENTO_WHATSAPP = 30;
/** Antes del método de pago (todavía sin elegir lleva el reloj de arena). */
const EMOJI_METODO = '🏦';
const EMOJI_ESPERA = '⏳';
const MAX_TEXTO = 60;

const corto = (s: string, max = MAX_TEXTO): string => {
  const t = String(s ?? '').trim();
  if (!t || t === '—') return '';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * El método de pago con sus datos, DEBAJO de la fila (sangría de tres espacios). No se recorta:
 * quien paga necesita el banco, la cédula y la cuenta completos. Las líneas de datos ya vienen con sangría.
 */
function lineasPago(pago: string): string[] {
  return String(pago ?? '').split('\n').filter((l) => l.trim()).map((l, i) => {
    if (i > 0 && l.startsWith('   ')) return `   ${l.trim()}`;
    return `   ${/^Esperando/.test(l) ? EMOJI_ESPERA : EMOJI_METODO} ${l.trim()}`;
  });
}

/** «$ 1.204,88 (Bs 44.000,00)»; sin tasa, solo en $. */
function montoDoble(usd: number, tasa: number): string {
  return tasa > 0 ? `${fmtMonto(usd, 'USD')} (${fmtMonto(usdABs(usd, tasa), 'Bs')})` : fmtMonto(usd, 'USD');
}

export function mensajePendientesPorPagar(
  rep: ReportePorPagar,
  opts: { fecha?: string; tasaFecha?: string | null; maxPorSegmento?: number } = {},
): string {
  const max = Math.max(1, opts.maxPorSegmento ?? MAX_POR_SEGMENTO_WHATSAPP);
  const lineas: string[] = [
    '📊 *PENDIENTES POR PAGAR*',
    `📅 ${fechaReporteTexto(opts.fecha ?? new Date().toISOString())}`,
  ];
  if (rep.tasa > 0) {
    lineas.push(`💱 Tasa BCV: ${fmtMonto(rep.tasa, 'Bs')} por $${opts.tasaFecha ? ` · ${opts.tasaFecha}` : ''}`);
  }
  lineas.push(`🧾 ${rep.pendientes} pendiente(s)${rep.credito.length ? ` · ${rep.credito.length} a crédito` : ''}`);

  if (!rep.segmentos.length && !rep.credito.length) {
    lineas.push('', '✅ No hay pendientes por pagar en este momento.');
  }

  for (const s of rep.segmentos) {
    lineas.push('', `${s.emoji} *${s.titulo} · ${s.filas.length}*`);
    const visibles = s.filas.slice(0, max);
    visibles.forEach((f, i) => {
      const quien = [f.codigo, corto(f.nombre)].filter(Boolean).join(' · ');
      lineas.push(`${i + 1}. ${quien} — ${montoDoble(f.montoUsd, rep.tasa)}`, ...lineasPago(f.pago));
    });
    if (s.filas.length > visibles.length) lineas.push(`   • … y ${s.filas.length - visibles.length} más (mirá el Excel o el PDF)`);
    lineas.push(`*Subtotal:* ${montoDoble(subtotalSegmento(s), rep.tasa)}`);
  }

  if (rep.segmentos.length) lineas.push('', `${EMOJI_TOTAL} *TOTAL GENERAL*`, montoDoble(rep.totalUsd, rep.tasa));

  if (rep.credito.length) {
    lineas.push('', `${CREDITO_ESTILO.emoji} *CUENTAS A CRÉDITO · ${rep.credito.length}* (saldo pendiente, aparte del total)`);
    // En cuentas a crédito no se muestra método de pago: se pagan mediante abonos en Tesorería.
    rep.credito.slice(0, max).forEach((c, i) => {
      lineas.push(`${i + 1}. ${[c.codigo, corto(c.nombre)].filter(Boolean).join(' · ')} — saldo ${montoDoble(c.saldo, rep.tasa)} (abonado ${fmtMonto(c.abonado, 'USD')} de ${fmtMonto(c.total, 'USD')})`);
    });
    if (rep.credito.length > max) lineas.push(`   • … y ${rep.credito.length - max} más (mirá el Excel o el PDF)`);
    lineas.push(`*Total a crédito:* ${montoDoble(rep.creditoTotal, rep.tasa)}`);
  }

  lineas.push('', '🏢 *MINERAL GROUP GUAYANA C.A.*');
  return lineas.join('\n');
}
