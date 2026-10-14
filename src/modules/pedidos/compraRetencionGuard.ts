/* ============================================================
   MGG · Compra directa · guarda del montaje con retención finalizada (14-10-2026)
   Una compra cuya retención de IVA ya se finalizó o declaró NO puede volver a
   montarse con otro IVA, otro % de retención ni otra moneda: el libro de
   retenciones quedaría descuadrado (o la compra desaparecería del libro si el
   IVA pasa a 0). Los demás datos (precios, factura, nota) sí se pueden corregir.
   ============================================================ */

export interface CompraConRetencion {
  retencion_finalizada?: boolean | null;
  moneda?: string | null;
  iva?: number | null;
  retencion_pct?: number | null;
}

export interface MontajeNuevo {
  moneda?: string;
  iva?: number | null;
  retencionPct?: number | null;
}

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const monedaDe = (m: string | null | undefined) => (m === 'Bs' ? 'Bs' : 'USD');

/** Texto del error si el montaje cambia lo que ya está declarado; null si se puede montar. */
export function errorMontajeConRetencion(compra: CompraConRetencion, nuevo: MontajeNuevo): string | null {
  if (!compra.retencion_finalizada) return null;
  const monedaNueva = monedaDe(nuevo.moneda);
  const ivaNuevo = monedaNueva === 'Bs' ? r2(Math.max(0, Number(nuevo.iva) || 0)) : 0;
  const pctNuevo = ivaNuevo > 0 ? Math.max(0, Number(nuevo.retencionPct) || 0) : 0;
  const cambia = monedaNueva !== monedaDe(compra.moneda) || ivaNuevo !== r2(compra.iva) || pctNuevo !== (Number(compra.retencion_pct) || 0);
  if (!cambia) return null;
  return 'La retención de IVA de esta compra ya está finalizada o declarada: no se puede cambiar el IVA, el % de retención ni la moneda. Si hay que corregirla, reábrela primero en Retenciones.';
}
