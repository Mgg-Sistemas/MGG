/* ============================================================
   MGG · Compras · El reporte por renglón en un mensaje de WhatsApp

   Pedido de la administradora (19-10-2026): el mismo reporte tiene que
   poder salir por WhatsApp. Acá se arma el texto UNA vez desde las filas
   del reporte (las mismas del PDF y del Excel): no se escribe a mano ni
   se recalcula en la pantalla.

   Los emojis NO son adorno: en una lista de chat dicen de un vistazo en
   qué renglón está cada compra. Y son de COLOR POR SÍ MISMOS, sin el
   selector U+FE0F: WhatsApp normaliza el texto del enlace y se lleva ese
   selector puesto, así que del otro lado llegaría un cuadrito (ver el
   comentario largo en `combustible/mensajeMovimiento.ts`).
   `comprasReporteMensaje.test.ts` lo verifica y rompe si alguien mete uno
   con selector, o si el enlace pasa por `wa.me` (que se come los emojis).
   ============================================================ */
import { agruparReporte, fmtMonto, GRUPOS_REPORTE, totalesTexto, totalesPorMoneda, type FilaReporteCompras } from './comprasReporte';
import { enlaceWhatsapp, puedeCompartir, compartirMovimiento } from '@/modules/combustible/mensajeMovimiento';

// El enlace y el compartir son los MISMOS de Combustible/Alimentación: una sola
// implementación del «no wa.me» y de la hoja de compartir del teléfono.
export { enlaceWhatsapp, puedeCompartir, compartirMovimiento };

/** Cuántos renglones se listan por grupo antes de mandar al Excel/PDF. */
export const MAX_POR_GRUPO_WHATSAPP = 30;
/** Cuánto se recorta el motivo en el mensaje (un chat no es una hoja de cálculo). */
export const MAX_MOTIVO_WHATSAPP = 70;

/** Fecha y hora de planta, en el formato corto que se lee en un chat. */
export function fechaReporteTexto(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const fecha = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
  const hora = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  return `${fecha} · ${hora}`;
}

/** El motivo, recortado con puntos suspensivos si no cabe en una línea de chat. */
function motivoCorto(motivo: string, max = MAX_MOTIVO_WHATSAPP): string {
  const m = String(motivo ?? '').trim();
  if (!m || m === '—') return '';
  return m.length > max ? `${m.slice(0, max - 1).trimEnd()}…` : m;
}

/** Una fila del renglón en una línea: código · motivo — monto (y en crédito, abonado/saldo). */
function lineaFila(f: FilaReporteCompras, i: number, esCredito: boolean): string {
  const partes = [f.codigo, motivoCorto(f.motivo)].filter(Boolean).join(' · ');
  const monto = fmtMonto(esCredito ? f.saldo : f.monto, f.moneda);
  const extra = esCredito
    ? ` (abonado ${fmtMonto(f.abonado, f.moneda)} · saldo ${fmtMonto(f.saldo, f.moneda)})`
    : '';
  return `${i + 1}. ${partes} — ${monto}${extra}`;
}

/**
 * El reporte listo para copiar o mandar por WhatsApp, con sus emojis.
 * Los cuatro renglones en el orden pedido; los vacíos no se escriben.
 */
export function mensajeReporteCompras(
  filas: FilaReporteCompras[],
  opts: { fecha?: string; maxPorGrupo?: number } = {},
): string {
  const max = Math.max(1, opts.maxPorGrupo ?? MAX_POR_GRUPO_WHATSAPP);
  const grupos = agruparReporte(filas).filter((g) => g.filas.length > 0);
  const lineas: string[] = [
    '📊 *REPORTE DE COMPRAS POR RENGLÓN*',
    `📅 ${fechaReporteTexto(opts.fecha ?? new Date().toISOString())}`,
    `🧾 ${filas.length} renglón(es) pendiente(s)`,
  ];

  if (!grupos.length) {
    lineas.push('', '✅ No hay compras pendientes en este momento.');
  }

  for (const g of grupos) {
    lineas.push('', `${g.emoji} *${g.titulo} · ${g.filas.length}*`);
    const visibles = g.filas.slice(0, max);
    visibles.forEach((f, i) => lineas.push(lineaFila(f, i, g.key === 'cuenta_abierta')));
    if (g.filas.length > visibles.length) {
      lineas.push(`   • … y ${g.filas.length - visibles.length} más (mirá el Excel o el PDF)`);
    }
    lineas.push(`*Subtotal${g.key === 'cuenta_abierta' ? ' (saldo)' : ''}:* ${totalesTexto(g)}`);
  }

  if (grupos.length) {
    const { usd, bs } = totalesPorMoneda(filas);
    const total = [fmtMonto(usd, 'USD'), ...(bs > 0 ? [fmtMonto(bs, 'Bs')] : [])].join('  ·  ');
    lineas.push('', '💰 *TOTAL GENERAL*', total);
  }

  lineas.push('', '_MGG · Mineral Group Guayana_');
  return lineas.join('\n');
}

/** Los renglones tal como los nombra el mensaje (para pruebas y pantalla). */
export const TITULOS_WHATSAPP = GRUPOS_REPORTE.map((g) => `${g.emoji} ${g.titulo}`);
