/**
 * La moneda de una OC en Retenciones. Sale de `ordenes.moneda`: las OC de
 * servicios pueden ser en Bs, y antes Retenciones las mostraba todas como $.
 * Vacía = USD (el valor por defecto de la orden). Retenciones solo maneja Bs y
 * USD: otra moneda se muestra como $ y se avisa, en vez de pasar en silencio.
 */
export interface MonedaDeOrden { moneda: 'Bs' | 'USD'; aviso: string | null }

const BS = new Set(['BS', 'BS.', 'BSS', 'BSD', 'VES']);
const USD = new Set(['USD', '$', 'DIVISA']);

export function monedaDeOrden(moneda: string | null | undefined): MonedaDeOrden {
  const m = String(moneda ?? '').trim().toUpperCase();
  if (!m || USD.has(m)) return { moneda: 'USD', aviso: null };
  if (BS.has(m)) return { moneda: 'Bs', aviso: null };
  return {
    moneda: 'USD',
    aviso: `La OC indica la moneda «${String(moneda).trim()}», que Retenciones no maneja (solo Bs y USD): el monto se muestra como $. Revisar la moneda de la OC.`,
  };
}
