/* ============================================================
   MGG · Tesorería · Cierre de mes (caja)
   Cada mes se "cierra" la caja: se calcula un reporte (ingresos,
   gastos, resultado, cuentas por cobrar/pagar y saldos disponibles)
   y se ARCHIVAN los movimientos del período marcándolos con un
   cierre_id. Las vistas de Tesorería filtran cierre_id IS NULL, así
   el mes nuevo arranca limpio. Es REVERSIBLE: reabrir el cierre quita
   la marca y los movimientos vuelven a la vista actual.
   No borra nada, no toca inventario ni resetea saldos.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { round2 } from './tasas.repository';
import { listCuentasPorCobrar } from './cuentasPorCobrar.repository';
import { listCuentasPorPagar } from './cuentasPorPagar.repository';

const TABLE = 'cierres_caja';
const LIBRO = 'movimientos_caja';

/** Saldo de una caja en una moneda/cuenta (puede ser negativo). */
export interface SaldoCierre {
  caja: string;
  moneda: string;
  cuenta: string | null;
  saldo: number;
}

/** Reporte del período (lo que se guarda como snapshot al cerrar). */
export interface ReporteCierre {
  periodo: string;                      // 'YYYY-MM'
  desde: string;                        // 'YYYY-MM-DD'
  hasta: string;
  ingresos: Record<string, number>;     // por moneda (entradas)
  gastos: Record<string, number>;       // por moneda (egresos)
  resultado: Record<string, number>;    // ingresos - gastos, por moneda
  cxc: Record<string, number>;          // cuentas por cobrar abiertas, por moneda
  cxp: Record<string, number>;          // cuentas por pagar abiertas, por moneda
  saldos: SaldoCierre[];                // saldos disponibles por caja/moneda (+/-)
  movimientos: number;                  // cantidad de movimientos del período
}

export interface Cierre {
  id: string;
  periodo: string;
  desde: string;
  hasta: string;
  snapshot: ReporteCierre;
  estado: 'cerrado' | 'reabierto';
  movimientos: number;
  actor?: string | null;
  actor_name?: string | null;
  reabierto_por?: string | null;
  reabierto_en?: string | null;
  created_at: string;
}

/** Primer y último día del mes 'YYYY-MM'. */
export function rangoMes(periodo: string): { desde: string; hasta: string } {
  const [y, m] = periodo.split('-').map(Number);
  const desde = `${periodo}-01`;
  const ultimoDia = new Date(y, m, 0).getDate(); // m es 1-based → día 0 del mes siguiente = último de este
  const hasta = `${periodo}-${String(ultimoDia).padStart(2, '0')}`;
  return { desde, hasta };
}

function sumarPorMoneda(acc: Record<string, number>, moneda: string, valor: number): void {
  acc[moneda] = round2((acc[moneda] || 0) + valor);
}

/**
 * Calcula el reporte del período sobre los movimientos AÚN abiertos (cierre_id null).
 * Ingresos = tipo 'entrada'; gastos = tipo 'salida'. Los traslados internos no cuentan
 * (mueven dinero entre cajas propias, netean a cero). CxC/CxP = saldos abiertos actuales.
 * Saldos = caja_saldos de cajas propias (no externas).
 */
export async function computeReporteCierre(periodo: string): Promise<ReporteCierre> {
  const { desde, hasta } = rangoMes(periodo);

  // Movimientos del período, sin archivar.
  const { data: movs, error } = await supabase.from(LIBRO)
    .select('tipo, monto, moneda')
    .is('cierre_id', null)
    .gte('at', `${desde}T00:00:00`)
    .lte('at', `${hasta}T23:59:59`);
  if (error) throw error;

  const ingresos: Record<string, number> = {};
  const gastos: Record<string, number> = {};
  for (const m of (movs ?? []) as Array<{ tipo: string; monto: number; moneda: string }>) {
    const v = Number(m.monto) || 0;
    if (m.tipo === 'entrada') sumarPorMoneda(ingresos, m.moneda, v);
    else if (m.tipo === 'salida') sumarPorMoneda(gastos, m.moneda, v);
  }
  const resultado: Record<string, number> = {};
  for (const mon of new Set([...Object.keys(ingresos), ...Object.keys(gastos)]))
    resultado[mon] = round2((ingresos[mon] || 0) - (gastos[mon] || 0));

  // Cuentas por cobrar / pagar abiertas (saldo = monto - abonado).
  const [cxcRows, cxpRows] = await Promise.all([listCuentasPorCobrar(true), listCuentasPorPagar(true)]);
  const cxc: Record<string, number> = {};
  for (const c of cxcRows) sumarPorMoneda(cxc, c.moneda, round2((Number(c.monto) || 0) - (Number(c.abonado) || 0)));
  const cxp: Record<string, number> = {};
  for (const c of cxpRows) sumarPorMoneda(cxp, c.moneda, round2((Number(c.monto) || 0) - (Number(c.abonado) || 0)));

  // Saldos disponibles por caja/moneda (solo cajas propias).
  const { data: internas } = await supabase.from('cajas').select('id, nombre').eq('externo', false);
  const idToNombre = new Map((internas ?? []).map((c) => [(c as { id: string }).id, (c as { nombre: string }).nombre]));
  const ids = Array.from(idToNombre.keys());
  const saldos: SaldoCierre[] = [];
  if (ids.length) {
    const { data: sal } = await supabase.from('caja_saldos').select('caja_id, moneda, cuenta, saldo').in('caja_id', ids);
    for (const s of (sal ?? []) as Array<{ caja_id: string; moneda: string; cuenta: string | null; saldo: number }>) {
      const v = round2(Number(s.saldo) || 0);
      if (v === 0) continue;
      saldos.push({ caja: idToNombre.get(s.caja_id) ?? '—', moneda: s.moneda, cuenta: s.cuenta, saldo: v });
    }
    saldos.sort((a, b) => a.caja.localeCompare(b.caja, 'es') || a.moneda.localeCompare(b.moneda));
  }

  return { periodo, desde, hasta, ingresos, gastos, resultado, cxc, cxp, saldos, movimientos: (movs ?? []).length };
}

/** Cierres existentes (más recientes primero). */
export async function listCierres(): Promise<Cierre[]> {
  const { data, error } = await supabase.from(TABLE).select('*').order('periodo', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Cierre[];
}

/** ¿Ya hay un cierre vigente (cerrado) para ese período? */
export async function cierreVigenteDe(periodo: string): Promise<Cierre | null> {
  const { data } = await supabase.from(TABLE).select('*').eq('periodo', periodo).eq('estado', 'cerrado').maybeSingle();
  return (data as Cierre) ?? null;
}

/**
 * Cierra el mes: guarda el snapshot y marca con cierre_id todos los movimientos del
 * período que estén abiertos. Devuelve el cierre creado. Falla si ya hay uno vigente.
 */
export async function crearCierre(input: {
  periodo: string; snapshot: ReporteCierre; actor: string; actorName?: string | null;
}): Promise<Cierre> {
  const ya = await cierreVigenteDe(input.periodo);
  if (ya) throw new Error(`El mes ${input.periodo} ya está cerrado. Reabrilo si necesitás modificarlo.`);
  const { desde, hasta } = rangoMes(input.periodo);

  const { data, error } = await supabase.from(TABLE).insert({
    periodo: input.periodo, desde, hasta, snapshot: input.snapshot,
    estado: 'cerrado', movimientos: input.snapshot.movimientos,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  const cierre = data as Cierre;

  // Archiva los movimientos del período (los que aún no estén archivados).
  const { error: upErr } = await supabase.from(LIBRO)
    .update({ cierre_id: cierre.id })
    .is('cierre_id', null)
    .gte('at', `${desde}T00:00:00`)
    .lte('at', `${hasta}T23:59:59`);
  if (upErr) throw upErr;

  return cierre;
}

/** Reabre un cierre: quita la marca de los movimientos y lo deja como 'reabierto'. */
export async function reabrirCierre(id: string, actor: string): Promise<void> {
  const { error: upErr } = await supabase.from(LIBRO).update({ cierre_id: null }).eq('cierre_id', id);
  if (upErr) throw upErr;
  const { error } = await supabase.from(TABLE)
    .update({ estado: 'reabierto', reabierto_por: actor, reabierto_en: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
