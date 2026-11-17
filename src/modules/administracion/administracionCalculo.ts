/* ============================================================================
   Golden Touch · Administración (Gastos fijos) · cálculos puros
   Períodos, vencimientos y totales. Sin React, sin base, deterministas.
   Fuente única de los tipos de valor del módulo (Periodicidad, Moneda).
   El token de período coincide con el CHECK de BD:
     mensual 2026-11 · bimensual 2026-B6 · trimestral 2026-T4 ·
     semestral 2026-S2 · anual 2026.
   (El bimestre/trimestre/semestre se numera por el mes: nov = mes 11 →
   B6, T4, S2.)
   ============================================================================ */

export type Periodicidad = 'mensual' | 'bimensual' | 'trimestral' | 'semestral' | 'anual';
export type Moneda = 'Bs' | 'USD';

/** Meses que dura cada período. */
export const MESES_PERIODO: Record<Periodicidad, number> = {
  mensual: 1, bimensual: 2, trimestral: 3, semestral: 6, anual: 12,
};

export interface GastoFijoCalc {
  periodicidad: Periodicidad;
  /** Día del período en que vence (1–31). Sin valor → día 1. */
  diaVencimiento?: number | null;
  vigenteDesde: Date | string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Partes de calendario (año, mes 1–12, día) de una fecha o 'AAAA-MM-DD'. */
function partes(f: Date | string): { y: number; m: number; d: number } {
  if (typeof f === 'string') {
    const [y, m, d] = f.slice(0, 10).split('-').map(Number);
    return { y, m: m || 1, d: d || 1 };
  }
  return { y: f.getFullYear(), m: f.getMonth() + 1, d: f.getDate() };
}
const fecha = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const ultimoDia = (y: number, m: number) => new Date(y, m, 0).getDate();

/** Primer mes (1–12) del período que contiene el mes `m`. */
function primerMes(m: number, p: Periodicidad): number {
  const n = MESES_PERIODO[p];
  return Math.floor((m - 1) / n) * n + 1;
}
function sumarMeses(y: number, m: number, meses: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + meses;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

/** El token canónico del período que contiene `f`. */
export function tokenPeriodo(f: Date | string, p: Periodicidad): string {
  const { y, m } = partes(f);
  switch (p) {
    case 'mensual': return `${y}-${pad2(m)}`;
    case 'bimensual': return `${y}-B${Math.ceil(m / 2)}`;
    case 'trimestral': return `${y}-T${Math.ceil(m / 3)}`;
    case 'semestral': return `${y}-S${Math.ceil(m / 6)}`;
    case 'anual': return `${y}`;
    default: return `${y}`;
  }
}

/** Vencimiento del período que contiene `f`: primer mes del período +
 *  díaVencimiento (recortado al último día de ese mes; sin valor → día 1). */
export function vencimientoDe(f: Date | string, p: Periodicidad, diaVencimiento?: number | null): Date {
  const { y, m } = partes(f);
  const pm = primerMes(m, p);
  const dia = diaVencimiento ? Math.min(Math.max(1, Math.trunc(diaVencimiento)), ultimoDia(y, pm)) : 1;
  return fecha(y, pm, dia);
}

/** Próximo vencimiento a partir de `hoy` (nunca antes de vigenteDesde). */
export function proximoVencimiento(g: GastoFijoCalc, hoy: Date = new Date()): Date {
  const desde = partes(g.vigenteDesde);
  const h = partes(hoy);
  // Arranca en el período del MÁS TARDÍO entre vigenteDesde y hoy.
  const masTarde = desde.y * 12 + desde.m >= h.y * 12 + h.m ? desde : h;
  let { y } = masTarde;
  let m = primerMes(masTarde.m, g.periodicidad);
  const vigenteT = fecha(desde.y, desde.m, desde.d).getTime();
  const hoyT = fecha(h.y, h.m, h.d).getTime();
  for (let i = 0; i < 600; i += 1) {
    const venc = vencimientoDe(fecha(y, m, 1), g.periodicidad, g.diaVencimiento);
    if (venc.getTime() >= hoyT && venc.getTime() >= vigenteT) return venc;
    ({ y, m } = sumarMeses(y, m, MESES_PERIODO[g.periodicidad]));
  }
  return vencimientoDe(fecha(y, m, 1), g.periodicidad, g.diaVencimiento); // tope defensivo
}

/** Los períodos desde vigenteDesde hasta `hasta` (inclusive): para «generar
 *  pendientes del período». Cada uno con su token y su vencimiento. */
export function periodosEntre(g: GastoFijoCalc, hasta: Date | string): { token: string; vence: Date }[] {
  const desde = partes(g.vigenteDesde);
  const fin = partes(hasta);
  const finT = fecha(fin.y, fin.m, fin.d).getTime();
  const out: { token: string; vence: Date }[] = [];
  let y = desde.y;
  let m = primerMes(desde.m, g.periodicidad);
  for (let i = 0; i < 600; i += 1) {
    const ref = fecha(y, m, 1);
    if (ref.getTime() > finT) break; // el período ya empieza después de `hasta`
    out.push({ token: tokenPeriodo(ref, g.periodicidad), vence: vencimientoDe(ref, g.periodicidad, g.diaVencimiento) });
    ({ y, m } = sumarMeses(y, m, MESES_PERIODO[g.periodicidad]));
  }
  return out;
}

/* ───────── Totales (reporte) ───────── */

export interface MovimientoCalc {
  empresaClave: string;
  categoria?: string | null;
  moneda: Moneda;
  monto: number;
}
export interface GrupoTotal {
  clave: string;
  bs: number;
  usd: number;
  /** Convertido a USD (Bs ÷ tasa) y a Bs (USD × tasa). tasa = Bs por USD; sin tasa, no convierte. */
  equivUsd: number;
  equivBs: number;
  n: number;
}

function sumar(movs: readonly MovimientoCalc[], tasa?: number): Omit<GrupoTotal, 'clave'> {
  let bs = 0;
  let usd = 0;
  for (const mv of movs) {
    const monto = Number(mv.monto) || 0;
    if (mv.moneda === 'Bs') bs += monto; else usd += monto;
  }
  bs = r2(bs); usd = r2(usd);
  const t = tasa && tasa > 0 ? tasa : 0;
  return { bs, usd, equivUsd: r2(usd + (t ? bs / t : 0)), equivBs: r2(bs + usd * t), n: movs.length };
}

const CLAVE: Record<'empresa' | 'categoria' | 'moneda', (m: MovimientoCalc) => string> = {
  empresa: (m) => m.empresaClave,
  categoria: (m) => m.categoria || 'Sin categoría',
  moneda: (m) => m.moneda,
};

/** Totales agrupados por empresa, categoría o moneda, del mayor al menor (en USD equivalente). */
export function agruparTotales(
  movs: readonly MovimientoCalc[], por: 'empresa' | 'categoria' | 'moneda', opts?: { tasa?: number },
): GrupoTotal[] {
  const grupos = new Map<string, MovimientoCalc[]>();
  for (const m of movs) {
    const k = CLAVE[por](m);
    grupos.set(k, [...(grupos.get(k) ?? []), m]);
  }
  return [...grupos.entries()]
    .map(([clave, ms]) => ({ clave, ...sumar(ms, opts?.tasa) }))
    .sort((a, b) => b.equivUsd - a.equivUsd || a.clave.localeCompare(b.clave, 'es'));
}

export function totalGeneral(movs: readonly MovimientoCalc[], tasa?: number): Omit<GrupoTotal, 'clave'> {
  return sumar(movs, tasa);
}
