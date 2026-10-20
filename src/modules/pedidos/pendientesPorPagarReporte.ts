/* ============================================================
   MGG · Compras · «Pendientes por pagar»: las filas del reporte (lógica pura)
   Unifica lo que se debe pagar (compras directas, órdenes de compra, servicios,
   servicios directos) con su TOTAL GENERAL en $ y las CUENTAS A CRÉDITO aparte.
   Antes esta cuenta vivía dentro del modal; ahora la leen igual la pantalla, el
   Excel y el mensaje de WhatsApp (20-10-2026), así los tres dicen siempre lo mismo.
   Los emojis van SIN el selector U+FE0F (WhatsApp se lo come y llega un cuadrito).
   ============================================================ */
import type { OrdenPorPagar } from './pedidos.repository';
import type { DirectoFila } from './DirectosPorPagarModal';

export type SegmentoKey = 'compras_directas' | 'ordenes' | 'servicios' | 'servicios_directos';

export interface FilaPorPagar { codigo: string; nombre: string; detalle: string; montoUsd: number }
export interface SegmentoPorPagar {
  key: SegmentoKey;
  titulo: string;
  emoji: string;
  /** Color pleno de la pantalla. */
  color: string;
  /** Par pastel (fondo / letra oscura) para el Excel. */
  pastel: string;
  pastelTexto: string;
  filas: FilaPorPagar[];
}
export interface FilaCredito { codigo: string; nombre: string; abonado: number; total: number; saldo: number }
export interface ReportePorPagar {
  segmentos: SegmentoPorPagar[];
  totalUsd: number;
  credito: FilaCredito[];
  creditoTotal: number;
  /** Bs por $ (tasa BCV del día); 0 si no hay. */
  tasa: number;
  /** Cuántas cosas esperan pago (sin contar las cuentas a crédito). */
  pendientes: number;
}

/** Credito: mismo color en pantalla y Excel. */
export const CREDITO_ESTILO = { titulo: 'CUENTAS A CRÉDITO · se saldan con abonos', emoji: '💳', color: '#dc2626', pastel: '#ffd2d2', pastelTexto: '#9b1c1c' };
export const EMOJI_TOTAL = '💰';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const esBsMoneda = (m: string | null | undefined): boolean => /bs|ves/i.test(String(m ?? ''));
/** Bs → $ con la tasa BCV (0 si no hay tasa): igual que aExtranjero de Tesorería. */
const bsAUsd = (bs: number, tasa: number) => (Number(tasa) > 0 ? round2((Number(bs) || 0) / Number(tasa)) : 0);
/** $ → Bs con la tasa BCV: igual que aBs de Tesorería. */
export const usdABs = (usd: number, tasa: number) => round2((Number(usd) || 0) * (Number(tasa) || 0));

export function armarReportePorPagar(
  rows: OrdenPorPagar[],
  directos: DirectoFila[],
  creditos: OrdenPorPagar[],
  tasa: number,
): ReportePorPagar {
  const ocRows = rows.filter((r) => r.orden.clase !== 'servicio');
  const servRows = rows.filter((r) => r.orden.clase === 'servicio');
  const comprasDir = directos.filter((d) => d.kind === 'compra');
  const servDir = directos.filter((d) => d.kind === 'servicio');

  const deOrden = (r: OrdenPorPagar): FilaPorPagar => ({
    codigo: r.orden.oc_codigo ?? r.orden.codigo, nombre: r.proveedorNombre,
    detalle: r.esperandoMetodo ? 'Esperando método' : 'Lista para pagar',
    montoUsd: Number(r.montoAPagar) || 0,
  });
  const deDirecto = (d: DirectoFila): FilaPorPagar => ({
    codigo: d.codigo, nombre: d.titulo, detalle: d.detalle || '—',
    montoUsd: esBsMoneda(d.moneda) ? bsAUsd(Number(d.total) || 0, tasa) : (Number(d.total) || 0),
  });

  const segmentos: SegmentoPorPagar[] = ([
    { key: 'compras_directas', titulo: 'COMPRAS DIRECTAS', emoji: '🛒', color: '#2563eb', pastel: '#dbe7ff', pastelTexto: '#1e4696', filas: comprasDir.map(deDirecto) },
    { key: 'ordenes', titulo: 'ÓRDENES DE COMPRA', emoji: '📦', color: '#ff8a00', pastel: '#ffe0bd', pastelTexto: '#8a4b00', filas: ocRows.map(deOrden) },
    { key: 'servicios', titulo: 'SERVICIOS', emoji: '🔧', color: '#7c5cff', pastel: '#e3dcff', pastelTexto: '#4a37a8', filas: servRows.map(deOrden) },
    { key: 'servicios_directos', titulo: 'SERVICIOS DIRECTOS', emoji: '⚡', color: '#108a78', pastel: '#d4f1ea', pastelTexto: '#0b5d50', filas: servDir.map(deDirecto) },
  ] as SegmentoPorPagar[]).filter((s) => s.filas.length > 0);
  const totalUsd = segmentos.reduce((a, s) => a + s.filas.reduce((b, f) => b + f.montoUsd, 0), 0);

  const credito = creditos.map((r): FilaCredito => {
    const total = Number(r.montoAPagar) || 0;
    const abonado = Math.max(0, Number(r.orden.abonado_total) || 0);
    return { codigo: r.orden.oc_codigo ?? r.orden.codigo, nombre: r.proveedorNombre, abonado, total, saldo: Math.max(0, round2(total - abonado)) };
  });
  const creditoTotal = credito.reduce((a, f) => a + f.saldo, 0);
  return { segmentos, totalUsd, credito, creditoTotal, tasa: Number(tasa) || 0, pendientes: rows.length + directos.length };
}

/** Subtotal en $ de un segmento. */
export const subtotalSegmento = (s: SegmentoPorPagar): number => s.filas.reduce((a, f) => a + f.montoUsd, 0);
