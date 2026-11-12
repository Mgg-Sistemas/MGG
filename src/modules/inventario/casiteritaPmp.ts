/* ============================================================
   MGG · Los Pinos · Casiterita — Libro de promedios (PMP)
   Reemplaza las hojas «Cierre Promedio» del Excel «ALMACÉN LOS PINOS CON
   PROMEDIOS MGG». Cada entrada y salida es un movimiento; el saldo global, el
   inventario MGG, el resguardo (lo de los aliados) y el PMP se calculan solos.

   Reglas (validadas al centavo contra los cierres del Excel):
   · apertura / entrada: suma kg global, kg MGG (kg × % MGG de la procedencia) y
     costo (kg MGG × tasa). El resto del kg es RESGUARDO (sin costo para MGG).
   · exportación (lote): sale `kg` del global; de MGG sale la misma PROPORCIÓN
     (pct = kg ÷ saldo global antes) al PMP vigente; lo demás es resguardo.
   · muestra / merma / ajuste / fundición: sale todo de MGG al PMP vigente
     (la merma puede marcarse «no afecta MGG»: baja solo el global, como se
     anotó alguna en el Excel). Un ajuste con kg negativo es un sobrante: entra.
   · recuperación (sacudida de bolsas): entra a MGG a costo 0.
   ============================================================ */

export type TipoMovPmp = 'apertura' | 'entrada' | 'recuperacion' | 'exportacion' | 'muestra' | 'merma' | 'ajuste' | 'fundicion';

export const TIPOS_SALIDA: TipoMovPmp[] = ['exportacion', 'muestra', 'merma', 'ajuste', 'fundicion'];

export const ETIQUETA_TIPO: Record<TipoMovPmp, string> = {
  apertura: 'Saldo inicial', entrada: 'Entrada', recuperacion: 'Recuperación', exportacion: 'Lote de exportación',
  muestra: 'Muestra', merma: 'Merma', ajuste: 'Ajuste', fundicion: 'Fundición',
};
export const BADGE_TIPO: Record<TipoMovPmp, string> = {
  apertura: 'primary', entrada: 'success', recuperacion: 'success', exportacion: 'info',
  muestra: 'warning', merma: 'warning', ajuste: 'warning', fundicion: 'danger',
};

export interface MovPmp {
  id: string;
  fecha: string;            // AAAA-MM-DD
  tipo: TipoMovPmp;
  descripcion: string;
  /** Salidas, recuperación y ajuste (ajuste negativo = sobrante que entra). */
  kg: number | null;
  /** Apertura y entrada. */
  kg_global: number | null;
  kg_mgg: number | null;
  costo: number | null;
  afecta_mgg: boolean;
  procedencia: string | null;
  pct_mgg: number | null;
  tasa: number | null;
  recepcion_numero: number | null;
  cierre_id: string | null;
  lote_id: string | null;
  colada_id: string | null;
  origen: 'excel' | 'sistema';
  orden: number;
  nota: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface FilaLibro extends MovPmp {
  dG: number;      // cambio en el saldo global
  dM: number;      // cambio en el inventario MGG
  dC: number;      // cambio en el costo MGG
  dResg: number;   // cambio en el resguardo
  /** Exportación: proporción del saldo global que se lleva el lote. */
  pct: number | null;
  pmpAntes: number;
  G: number; M: number; C: number;
  pmp: number;
  resguardo: number;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function ordenarMovs<T extends Pick<MovPmp, 'fecha' | 'orden'>>(movs: T[]): T[] {
  return [...movs].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : n(a.orden) - n(b.orden)));
}

/** Recorre el libro en orden y devuelve cada movimiento con su efecto y los saldos después. */
export function calcularLibro(movs: MovPmp[]): FilaLibro[] {
  let G = 0, M = 0, C = 0;
  const out: FilaLibro[] = [];
  for (const m of ordenarMovs(movs)) {
    const pmpAntes = M > 0 ? C / M : 0;
    let dG = 0, dM = 0, dC = 0, pct: number | null = null;
    switch (m.tipo) {
      case 'apertura':
      case 'entrada':
        dG = n(m.kg_global); dM = n(m.kg_mgg); dC = n(m.costo);
        break;
      case 'recuperacion':
        dG = n(m.kg); dM = n(m.kg); dC = 0;
        break;
      case 'exportacion':
        pct = G > 0 ? n(m.kg) / G : 0;
        dG = -n(m.kg); dM = -(M * pct); dC = dM * pmpAntes;
        break;
      default: // muestra · merma · ajuste · fundición
        dG = -n(m.kg);
        dM = m.afecta_mgg === false ? 0 : -n(m.kg);
        dC = dM * pmpAntes;
    }
    G += dG; M += dM; C += dC;
    out.push({ ...m, dG, dM, dC, dResg: dG - dM, pct, pmpAntes, G, M, C, pmp: M > 0 ? C / M : 0, resguardo: G - M });
  }
  return out;
}

export interface Saldo {
  fecha: string | null;
  global: number;
  mgg: number;
  costo: number;
  pmp: number;
  resguardo: number;
}

export const SALDO_VACIO: Saldo = { fecha: null, global: 0, mgg: 0, costo: 0, pmp: 0, resguardo: 0 };

export function saldoDe(f: FilaLibro | undefined): Saldo {
  if (!f) return SALDO_VACIO;
  return { fecha: f.fecha, global: f.G, mgg: f.M, costo: f.C, pmp: f.pmp, resguardo: f.resguardo };
}

export const saldoFinal = (filas: FilaLibro[]) => saldoDe(filas[filas.length - 1]);

/** Saldo al cierre del día `fecha` (incluido). */
export function saldoAl(filas: FilaLibro[], fecha: string): Saldo {
  let u: FilaLibro | undefined;
  for (const f of filas) { if (f.fecha <= fecha) u = f; else break; }
  return saldoDe(u);
}

export interface ResumenMes {
  mes: string;            // AAAA-MM
  apertura: Saldo;        // saldo al cierre del mes anterior
  cierre: Saldo;
  entradasKg: number;     // global que entró (entradas + recuperaciones + sobrantes)
  entradasCosto: number;
  salidasKg: number;      // global que salió
  salidasCosto: number;   // costo MGG que salió (al PMP)
  exportadoKg: number;
  movimientos: number;
}

export const mesDe = (fecha: string) => fecha.slice(0, 7);

/** Un resumen por mes con movimientos (las «hojas Cierre Promedio»). */
export function resumenPorMes(filas: FilaLibro[]): ResumenMes[] {
  const out: ResumenMes[] = [];
  let previo: Saldo = SALDO_VACIO;
  let actual: ResumenMes | null = null;
  for (const f of filas) {
    const mes = mesDe(f.fecha);
    if (!actual || actual.mes !== mes) {
      if (actual) { previo = actual.cierre; out.push(actual); }
      actual = { mes, apertura: previo, cierre: previo, entradasKg: 0, entradasCosto: 0, salidasKg: 0, salidasCosto: 0, exportadoKg: 0, movimientos: 0 };
    }
    actual.movimientos += 1;
    if (f.tipo !== 'apertura') {
      if (f.dG >= 0) { actual.entradasKg += f.dG; actual.entradasCosto += f.dC; }
      else { actual.salidasKg += -f.dG; actual.salidasCosto += -f.dC; }
      if (f.tipo === 'exportacion') actual.exportadoKg += -f.dG;
    }
    actual.cierre = saldoDe(f);
  }
  if (actual) out.push(actual);
  return out;
}

/* ───────── Entradas ───────── */

/** kg MGG y costo de una entrada: kg × % MGG, y ese kg MGG × tasa. */
export function calcularEntrada(kgGlobal: number, pctMgg: number, tasa: number): { kgMgg: number; costo: number } {
  const kgMgg = n(kgGlobal) * n(pctMgg) / 100;
  return { kgMgg: Math.round(kgMgg * 1e6) / 1e6, costo: Math.round(kgMgg * n(tasa) * 100) / 100 };
}

export interface ProcedenciaPmp {
  clave: string;
  nombre: string;
  pct_mgg: number;
  patron: string | null;
  nota: string | null;
  activo: boolean;
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Reconoce la procedencia por el nombre del grupo de recepción (EL BURRO NAVIL → P-MGG11-A). */
export function procedenciaDeGrupo(grupo: string | null | undefined, procs: ProcedenciaPmp[]): ProcedenciaPmp | null {
  const g = sinAcentos(grupo ?? '');
  if (!g) return null;
  for (const p of procs) {
    if (!p.activo || !p.patron) continue;
    const palabras = p.patron.split(/[|,]/).map((x) => sinAcentos(x.trim())).filter(Boolean);
    if (palabras.some((w) => g.includes(w))) return p;
  }
  return null;
}

/* ───────── Validaciones (las mismas que hace la base) ───────── */

export interface NuevoMovPmp {
  fecha: string;
  tipo: Exclude<TipoMovPmp, 'apertura'>;
  descripcion: string;
  kg?: number | null;
  kg_global?: number | null;
  pct_mgg?: number | null;
  tasa?: number | null;
  afecta_mgg?: boolean;
  procedencia?: string | null;
}

export function errorNuevoMov(m: NuevoMovPmp, filas: FilaLibro[]): string | null {
  if (!m.fecha) return 'Indica la fecha.';
  const ap = filas.find((f) => f.tipo === 'apertura');
  if (ap && m.fecha < ap.fecha) return `El libro abre el ${fechaTxt(ap.fecha)}: no se cargan movimientos anteriores.`;
  if (!m.descripcion?.trim()) return 'Escribe una descripción.';
  if (m.tipo === 'entrada') {
    if (!(n(m.kg_global) > 0)) return 'Indica los kg que entran.';
    if (!(n(m.pct_mgg) >= 0 && n(m.pct_mgg) <= 100)) return 'El % MGG va de 0 a 100.';
    if (!(n(m.tasa) > 0) && n(m.pct_mgg) > 0) return 'Indica la tasa ($/kg) de la parte MGG.';
    return null;
  }
  const kg = n(m.kg);
  if (m.tipo === 'ajuste') { if (kg === 0) return 'Indica los kg del ajuste.'; }
  else if (!(kg > 0)) return 'Indica los kg.';
  const s = saldoAl(filas, m.fecha);
  const fin = saldoFinal(filas);
  const sale = m.tipo === 'recuperacion' ? 0 : kg;
  if (sale > 0) {
    const disp = Math.min(s.global, fin.global);
    if (sale > disp + 0.001) return `No hay tanto: el saldo global es ${kgTxt(disp)}.`;
    const tocaMgg = m.tipo !== 'exportacion' && m.afecta_mgg !== false;
    const dispM = Math.min(s.mgg, fin.mgg);
    if (tocaMgg && sale > dispM + 0.001) return `Sale todo del inventario MGG y solo hay ${kgTxt(dispM)}.`;
  }
  return null;
}

/** Lee un número escrito a la venezolana («1.234,5») o con punto decimal («1234.5»). */
export function leerNumero(v: string | number | null | undefined): number | null {
  const t = String(v ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  if (/^-?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  const x = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : null;
}

/** Hoy (AAAA-MM-DD) en hora de Venezuela. */
export const hoyVE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });

/* ───────── Formato ───────── */
const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v : 0).toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
export const kgTxt = (v: number) => `${fmt(v)} kg`;
export const usdTxt = (v: number) => `$${fmt(v)}`;
export const pmpTxt = (v: number) => `$${fmt(v, 4)}`;
export const pctTxt = (v: number) => `${fmt(v * 100, 2)} %`;
export const fechaTxt = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombreMes = (ym: string) => { const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1] ?? ym} ${y}`.replace(/^./, (c) => c.toUpperCase()); };
export { fmt as numTxt };
