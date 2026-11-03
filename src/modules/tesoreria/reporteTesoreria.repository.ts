/* ============================================================
   MGG · Tesorería · Lecturas del «Reporte de Tesorería» (03-11-2026)
   Datos crudos para el reporte moldeable (ExportarTesoreriaModal). Todo lo
   que puede pasar de 1.000 filas se pide POR PÁGINAS con todasLasFilas:
   Supabase corta en 1.000 sin avisar y el reporte quedaría incompleto.
   Solo lectura: aquí no se escribe nada.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { MovimientoCaja } from '@/shared/lib/types';
import type { CuentaPorPagar } from './cuentasPorPagar.repository';
import type { CuentaPorCobrar } from './cuentasPorCobrar.repository';

const SELECT_LIBRO = '*, caja:cajas!movimientos_caja_caja_id_fkey(nombre, moneda)';

/**
 * TODOS los movimientos de caja del rango (hora de Venezuela, -04:00), por páginas.
 * `incluirCerrados`: también los archivados por un cierre de mes (el cierre solo
 * marca `cierre_id`, no crea filas nuevas, así que no se duplica nada).
 */
export async function listMovimientosReporte(filtros: { desde: string; hasta: string; incluirCerrados: boolean }): Promise<MovimientoCaja[]> {
  return todasLasFilas<MovimientoCaja>((d, h) => {
    let q = supabase.from('movimientos_caja').select(SELECT_LIBRO);
    if (filtros.desde) q = q.gte('at', `${filtros.desde}T00:00:00-04:00`);
    if (filtros.hasta) q = q.lte('at', `${filtros.hasta}T23:59:59.999-04:00`);
    if (!filtros.incluirCerrados) q = q.is('cierre_id', null);
    return q.order('at', { ascending: false }).order('id', { ascending: false }).range(d, h);
  });
}

/**
 * Tasas USD del BCV por día dentro del rango (fecha → Bs por $; la manual manda),
 * para la valuación histórica. Por páginas: un año con varias fuentes por día
 * puede pasar de 1.000 filas.
 */
export async function tasasUsdDelRango(desde: string, hasta: string): Promise<Map<string, number>> {
  const filas = await todasLasFilas<{ fecha: string; tasa: number; fuente: string | null }>((d, h) => {
    let q = supabase.from('tasa_cambio').select('fecha, tasa, fuente, id').eq('moneda', 'USD');
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    return q.order('fecha', { ascending: true }).order('id', { ascending: true }).range(d, h);
  });
  const out = new Map<string, number>();
  for (const r of filas) {
    const t = Number(r.tasa);
    if (!(t > 0)) continue;
    if (!out.has(r.fecha) || r.fuente === 'manual') out.set(r.fecha, t);
  }
  return out;
}

/** Cuentas por pagar manuales abiertas (todas, por páginas). */
export async function listCuentasPorPagarAbiertasReporte(): Promise<CuentaPorPagar[]> {
  return todasLasFilas<CuentaPorPagar>((d, h) =>
    supabase.from('cuentas_por_pagar').select('*').eq('estado', 'abierta')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(d, h));
}

/** Cuentas por cobrar abiertas (todas, por páginas). */
export async function listCuentasPorCobrarAbiertasReporte(): Promise<CuentaPorCobrar[]> {
  return todasLasFilas<CuentaPorCobrar>((d, h) =>
    supabase.from('cuentas_por_cobrar').select('*').eq('estado', 'abierta')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(d, h));
}
