/* ============================================================
   Golden Touch · Administración · tasa Bs/USD para los equivalentes
   Toma la tasa BCV del día (la misma que usa Tesorería, `getTasaHoy`). Si no
   hay sesión/base (p. ej. la página demo) o falla, cae a un valor de respaldo
   para no romper los cálculos. Bs por 1 USD.
   ============================================================ */
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';

export const TASA_FALLBACK = 40;

export async function cargarTasaBcv(): Promise<{ tasa: number; fecha: string | null }> {
  try {
    const t = await getTasaHoy();
    const usd = Number(t?.usd);
    return { tasa: Number.isFinite(usd) && usd > 0 ? usd : TASA_FALLBACK, fecha: t?.fecha ?? null };
  } catch {
    return { tasa: TASA_FALLBACK, fecha: null };
  }
}
