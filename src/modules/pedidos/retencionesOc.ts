/* ============================================================
   MGG · Compras · Retenciones por tipo al indicar el método de pago (03-11-2026)

   Pedido de la administradora: el check «Tiene retención» que se ocultó en
   Tesorería pasa a Compras. Al indicar el método de pago (OC y servicios),
   con soporte Factura, se marca si retienen IVA, IGTF, ISLR o ISAE, cada uno
   en % (sobre el total de la OC) o como monto fijo, y el monto de la OC baja.
   · ANTES de pagar: Tesorería paga el total menos las retenciones.
   · DESPUÉS de pagar: Tesorería paga completo; las retenciones quedan
     anotadas para Retenciones.
   Se guarda en `ordenes.retenciones` (jsonb). Emojis sin U+FE0F.
   08-11-2026: cada impuesto dice si se paga en $ o en Bs (`moneda_pago`). El que
   se paga en Bs NO sale en el WhatsApp: solo Tesorería lo ve, como «Pago de
   impuestos en Bs» con su monto en bolívares a la tasa del día.
   ============================================================ */

export type TipoRetencion = 'IVA' | 'IGTF' | 'ISLR' | 'ISAE';
export const TIPOS_RETENCION: TipoRetencion[] = ['IVA', 'IGTF', 'ISLR', 'ISAE'];

export interface RetencionOc {
  tipo: TipoRetencion;
  /** 'pct' = porcentaje según la base legal correspondiente · 'monto' = monto fijo en la moneda de la OC. */
  modo: 'pct' | 'monto';
  valor: number;
  /** Lo que se retiene, en la moneda de la OC (2 decimales). */
  monto: number;
  /**
   * En qué moneda se PAGA el impuesto (08-11-2026). 'Bs' = Tesorería lo paga aparte en
   * bolívares (al cambio del día) y NO sale en el WhatsApp. Sin dato = en $ (las de antes).
   */
  moneda_pago?: MonedaImpuesto;
}

/** Moneda en que se paga un impuesto retenido (08-11-2026). */
export type MonedaImpuesto = 'USD' | 'Bs';

/** Bases imponibles legales para el cálculo de retenciones según la normativa venezolana. */
export interface BasesRetencionOc {
  /** Monto total de la orden a pagar (con IVA / IGTF / ajustes). Base legal para IGTF (Ley de Reforma del IGTF). */
  total: number;
  /** Base imponible neta (sin IVA ni renglones exentos). Base legal para ISLR (Decreto 1.808) e ISAE municipal. */
  baseImponible: number;
  /** Monto de IVA liquidado en la orden. Base legal para Retención de IVA (Providencia SNAT/2025/000054). */
  iva: number;
}

/**
 * Porcentajes sugeridos de retención según la normativa tributaria venezolana:
 * - IVA: 75% del IVA facturado (Providencia SNAT/2025/000054 para contribuyentes especiales).
 * - ISLR: 2% sobre la base imponible (Decreto 1.808 para personas jurídicas por servicios/ventas).
 * - ISAE: 1% sobre la base imponible (ordenanzas municipales bajo LOCAPTEM).
 * - IGTF: 3% sobre el total en divisa/moneda extranjera (Ley de Reforma del IGTF).
 */
export const PCT_SUGERIDO_RETENCION: Record<TipoRetencion, number> = {
  IVA: 75,
  ISLR: 2,
  ISAE: 1,
  IGTF: 3,
};

/**
 * Determina la base legal de cálculo según el tipo de retención:
 * - IVA: aplica sobre el monto del impuesto IVA facturado.
 * - ISLR e ISAE: aplican sobre la base imponible neta (excluye IVA y renglones exentos).
 * - IGTF: aplica sobre el monto total en divisas.
 * Si se pasa un número plano (retrocompatibilidad), se utiliza directamente como base.
 */
export function baseParaTipoRetencion(tipo: TipoRetencion, bases: number | BasesRetencionOc): number {
  if (typeof bases === 'number') return Math.max(0, bases);
  switch (tipo) {
    case 'IVA':
      return Math.max(0, Number(bases.iva) || 0);
    case 'ISLR':
    case 'ISAE':
      return Math.max(0, Number(bases.baseImponible) || 0);
    case 'IGTF':
      return Math.max(0, Number(bases.total) || 0);
    default:
      return Math.max(0, Number(bases.total) || 0);
  }
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Lo que se retiene de un tipo sobre la base. Un % fuera de 0–100 o un monto negativo cuentan 0. */
export function montoRetencion(modo: 'pct' | 'monto', valor: number, base: number): number {
  const v = Number(valor) || 0;
  if (v <= 0) return 0;
  return modo === 'pct' ? r2((Number(base) || 0) * Math.min(v, 100) / 100) : r2(v);
}

/** Arma la lista que se guarda con los tipos marcados (en el orden IVA, IGTF, ISLR, ISAE). */
export function armarRetenciones(
  marcadas: Partial<Record<TipoRetencion, { modo: 'pct' | 'monto'; valor: number; moneda_pago?: MonedaImpuesto }>>,
  bases: number | BasesRetencionOc,
): RetencionOc[] {
  const out: RetencionOc[] = [];
  for (const tipo of TIPOS_RETENCION) {
    const m = marcadas[tipo];
    if (!m) continue;
    const base = baseParaTipoRetencion(tipo, bases);
    const monto = montoRetencion(m.modo, m.valor, base);
    if (monto > 0) out.push({ tipo, modo: m.modo, valor: Number(m.valor) || 0, monto, ...(m.moneda_pago === 'Bs' ? { moneda_pago: 'Bs' as const } : {}) });
  }
  return out;
}

/** Lee lo guardado en la orden (tolera null o basura). */
export function retencionesDe(o: { retenciones?: unknown }): RetencionOc[] {
  const raw = Array.isArray(o.retenciones) ? o.retenciones : [];
  return raw
    .map((x) => x as Partial<RetencionOc>)
    .filter((x): x is RetencionOc => !!x && TIPOS_RETENCION.includes(x.tipo as TipoRetencion) && Number(x.monto) > 0)
    .map((x) => ({
      tipo: x.tipo, modo: x.modo === 'monto' ? 'monto' : 'pct', valor: Number(x.valor) || 0, monto: r2(Number(x.monto)),
      ...(x.moneda_pago === 'Bs' ? { moneda_pago: 'Bs' as const } : {}),
    }));
}

/** ¿Este impuesto se paga en bolívares? (08-11-2026) */
export function sePagaEnBs(r: Pick<RetencionOc, 'moneda_pago'>): boolean {
  return r.moneda_pago === 'Bs';
}

/** Los impuestos que se pagan en $ (los únicos que salen en el WhatsApp). */
export function impuestosEnUsd(rs: RetencionOc[]): RetencionOc[] {
  return rs.filter((r) => !sePagaEnBs(r));
}

/** Los impuestos que Tesorería paga en Bs: solo se muestran en Tesorería. */
export function impuestosEnBs(rs: RetencionOc[]): RetencionOc[] {
  return rs.filter(sePagaEnBs);
}

/**
 * Lo que se paga en Bs de un impuesto: en una OC en $ es monto × tasa (null sin tasa);
 * en una OC vieja en Bs el monto ya está en Bs.
 */
export function montoImpuestoEnBs(r: Pick<RetencionOc, 'monto'>, monedaOrden: string | null | undefined, tasa: number | null | undefined): number | null {
  if ((monedaOrden ?? 'USD').toUpperCase() === 'BS') return r2(r.monto);
  const t = Number(tasa) || 0;
  return t > 0 ? r2(r.monto * t) : null;
}

export function totalRetenciones(rs: RetencionOc[]): number {
  return r2(rs.reduce((a, r) => a + r.monto, 0));
}

/** Cuánto le restan las retenciones a lo que paga Tesorería: solo si se retiene ANTES de pagar. */
export function retencionQueBajaElPago(o: { retenciones?: unknown; retencion_momento?: string | null }): number {
  return o.retencion_momento === 'antes' ? totalRetenciones(retencionesDe(o)) : 0;
}

/** «IVA 75 %» o «ISLR monto fijo». */
export function etiquetaRetencion(r: Pick<RetencionOc, 'tipo' | 'modo' | 'valor'>): string {
  return r.modo === 'pct' ? `${r.tipo} ${String(r.valor).replace('.', ',')} %` : `${r.tipo} (monto fijo)`;
}
