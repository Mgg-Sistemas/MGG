/* ============================================================================
   Golden Touch · Administración · reporte para WhatsApp (texto puro)
   Arma el resumen de gastos fijos con el marcado de WhatsApp (*negrita*),
   listo para PEGAR en el chat (mismo patrón que pedidos/confirmadasPagarTxt).
   Reusa kpisTablero (resumen) y proximoVencimiento (detalle). Determinista.
   ============================================================================ */
import { proximoVencimiento, type GrupoTotal } from './administracionCalculo';
import { kpisTablero, type GastoTablero } from './administracionTablero';

const num = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 0 });
const monto2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => `$ ${num(n)}`;
const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const diasA = (d: Date, hoy: Date) => Math.ceil((d.getTime() - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()) / 86400000);

export interface OpcionesReporteWa {
  empresaNombre?: string | null;
  /** Etiqueta del período, p. ej. «Noviembre 2026». */
  periodoLabel: string;
  /** Tasa Bs/USD para los equivalentes. */
  tasa: number;
  hoy?: Date;
}

/** Resumen de gastos fijos en marcado de WhatsApp, listo para pegar. */
export function reporteGastosFijosTxt(filas: readonly GastoTablero[], o: OpcionesReporteWa): string {
  const hoy = o.hoy ?? new Date();
  const k = kpisTablero(filas, o.tasa, hoy);
  const activos = filas
    .filter((f) => f.estado === 'activo')
    .map((f) => ({ f, venc: proximoVencimiento(f, hoy) }))
    .sort((a, b) => a.venc.getTime() - b.venc.getTime() || a.f.concepto.localeCompare(b.f.concepto, 'es'));

  const L: string[] = [];
  L.push(`*🧾 Gastos fijos · ${o.empresaNombre?.trim() || 'Todas las empresas'}*`);
  L.push(o.periodoLabel);
  L.push('');
  L.push('*Resumen*');
  L.push(`• Gasto fijo/mes: ${usd(k.gastoMes.equivUsd)}  (${num(k.gastoMes.bs)} Bs · ${num(k.gastoMes.usd)} $)`);
  L.push(`• Por pagar este mes: ${usd(k.esteMes.equivUsd)} (${k.esteMes.n})`);
  if (k.venceEn.n > 0) L.push(`• Vence en ${k.venceEn.dias} días: ${k.venceEn.n} ⚠`);
  L.push('');
  L.push(`*Detalle (${activos.length} ${activos.length === 1 ? 'activo' : 'activos'})*`);
  for (const { f, venc } of activos) {
    const d = diasA(venc, hoy);
    const urg = d < 0 ? ' ‼️ vencido' : d <= 7 ? ' ⚠' : '';
    L.push(`• ${f.concepto} — ${f.empresaNombre} — ${f.moneda} ${monto2(f.monto)} — vence ${ddmm(venc)}${urg}`);
  }
  if (!activos.length) L.push('• (sin gastos fijos activos)');
  return L.join('\n');
}

/** Nombre de archivo sugerido para el TXT. */
export function nombreArchivoReporte(periodoLabel: string): string {
  return `gastos-fijos-${slugArchivo(periodoLabel)}.txt`;
}

function slugArchivo(periodoLabel: string): string {
  return periodoLabel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'periodo';
}

export interface OpcionesReporteMovWa {
  empresaNombre?: string | null;
  /** Etiqueta del alcance, p. ej. «Octubre 2026» o «Todo el histórico». */
  periodoLabel: string;
  /** Dimensión del desglose en minúscula (categoría, empresa, proveedor…). */
  dimLabel?: string;
}

/** Reporte del HISTÓRICO (egresos efectivos) en marcado de WhatsApp: total del
 *  alcance y desglose por la dimensión elegida. Sobre los totales ya calculados. */
export function reporteMovimientosTxt(
  grupos: readonly GrupoTotal[], total: Omit<GrupoTotal, 'clave'>, o: OpcionesReporteMovWa,
): string {
  const L: string[] = [];
  L.push(`*📊 Reporte de gastos · ${o.empresaNombre?.trim() || 'Todas las empresas'}*`);
  L.push(o.periodoLabel);
  L.push('');
  L.push('*Total del período*');
  L.push(`• ${usd(total.equivUsd)}  (${num(total.bs)} Bs · ${num(total.usd)} $) — ${total.n} mov.`);
  L.push('');
  L.push(`*Por ${o.dimLabel || 'categoría'}*`);
  for (const g of grupos) L.push(`• ${g.clave}: ${usd(g.equivUsd)}  (${num(g.bs)} Bs · ${num(g.usd)} $)`);
  if (!grupos.length) L.push('• (sin movimientos en el período)');
  return L.join('\n');
}

/** Nombre de archivo para el reporte del histórico. */
export function nombreArchivoReporteMov(periodoLabel: string): string {
  return `reporte-gastos-${slugArchivo(periodoLabel)}.txt`;
}
