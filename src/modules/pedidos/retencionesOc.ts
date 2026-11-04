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
   ============================================================ */

export type TipoRetencion = 'IVA' | 'IGTF' | 'ISLR' | 'ISAE';
export const TIPOS_RETENCION: TipoRetencion[] = ['IVA', 'IGTF', 'ISLR', 'ISAE'];

export interface RetencionOc {
  tipo: TipoRetencion;
  /** 'pct' = porcentaje del total de la OC · 'monto' = monto fijo en la moneda de la OC. */
  modo: 'pct' | 'monto';
  valor: number;
  /** Lo que se retiene, en la moneda de la OC (2 decimales). */
  monto: number;
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
  marcadas: Partial<Record<TipoRetencion, { modo: 'pct' | 'monto'; valor: number }>>, base: number,
): RetencionOc[] {
  const out: RetencionOc[] = [];
  for (const tipo of TIPOS_RETENCION) {
    const m = marcadas[tipo];
    if (!m) continue;
    const monto = montoRetencion(m.modo, m.valor, base);
    if (monto > 0) out.push({ tipo, modo: m.modo, valor: Number(m.valor) || 0, monto });
  }
  return out;
}

/** Lee lo guardado en la orden (tolera null o basura). */
export function retencionesDe(o: { retenciones?: unknown }): RetencionOc[] {
  const raw = Array.isArray(o.retenciones) ? o.retenciones : [];
  return raw
    .map((x) => x as Partial<RetencionOc>)
    .filter((x): x is RetencionOc => !!x && TIPOS_RETENCION.includes(x.tipo as TipoRetencion) && Number(x.monto) > 0)
    .map((x) => ({ tipo: x.tipo, modo: x.modo === 'monto' ? 'monto' : 'pct', valor: Number(x.valor) || 0, monto: r2(Number(x.monto)) }));
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
