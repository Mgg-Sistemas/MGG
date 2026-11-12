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
    // El mes de la apertura «abre» con el saldo inicial, no con cero.
    if (f.tipo === 'apertura') actual.apertura = saldoDe(f);
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

export function errorNuevoMov(m: NuevoMovPmp, filas: FilaLibro[], cerradoHastaMes: string | null = null): string | null {
  if (!m.fecha) return 'Indica la fecha.';
  const cerrado = errorMesCerrado(m.fecha, cerradoHastaMes);
  if (cerrado) return cerrado;
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
  // Con coma: la coma es el decimal y los puntos, miles («1.431,5»).
  // Sin coma: puntos en grupos de tres son miles («11.500» = 11500); si no, punto decimal («15.75»).
  const x = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.'))
    : /^-?\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, ''))
      : Number(t);
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

/* ───────── Fase 2 · Entradas desde los cierres de recepción ───────── */

/** Lo que hace falta de un cierre de recepción (recepcion_cierres). */
export interface CierreRecepcionPmp {
  id: string;
  numero: number;
  grupo_nombre: string | null;
  fecha: string;            // timestamp del cierre
  neto_seco: number | null; // kg que entraron al almacén de casiterita
  tasa_final: number | null;
  almacen_neto: string | null;
}

export interface PropuestaEntrada {
  cierre: CierreRecepcionPmp;
  fecha: string;            // día del cierre (Venezuela)
  procedencia: ProcedenciaPmp | null;
  kg: number;
  pct: number;
  tasa: number;
  kgMgg: number;
  costo: number;
}

const diaVE = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });

/**
 * Cierres de recepción que entraron casiterita al almacén y todavía no están en el
 * libro: desde la apertura del libro, con kg, y sin un movimiento que los nombre.
 */
export function cierresPorPasar(cierres: CierreRecepcionPmp[], movs: MovPmp[], procs: ProcedenciaPmp[]): PropuestaEntrada[] {
  const apertura = movs.find((m) => m.tipo === 'apertura')?.fecha ?? null;
  const yaEnLibro = new Set(movs.map((m) => m.cierre_id).filter(Boolean) as string[]);
  return cierres
    .filter((c) => (Number(c.neto_seco) || 0) > 0 && /CASITERITA/i.test(c.almacen_neto ?? '') && !yaEnLibro.has(c.id))
    .map((c) => {
      const fecha = diaVE(c.fecha);
      const p = procedenciaDeGrupo(c.grupo_nombre, procs);
      const kg = Number(c.neto_seco) || 0;
      const pct = p?.pct_mgg ?? 100;
      const tasa = Number(c.tasa_final) || 0;
      const { kgMgg, costo } = calcularEntrada(kg, pct, tasa);
      return { cierre: c, fecha, procedencia: p, kg, pct, tasa, kgMgg, costo };
    })
    .filter((x) => !apertura || x.fecha >= apertura)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.cierre.numero - b.cierre.numero));
}

/** El movimiento de entrada que propone un cierre. */
export function movDePropuesta(p: PropuestaEntrada, procedencia: ProcedenciaPmp | null, pct: number, tasa: number): NuevoMovPmp {
  return {
    fecha: p.fecha, tipo: 'entrada', kg_global: p.kg, pct_mgg: pct, tasa, procedencia: procedencia?.clave ?? null,
    descripcion: `Recepción #${p.cierre.numero} · ${procedencia ? `${procedencia.clave} ${procedencia.nombre}` : (p.cierre.grupo_nombre ?? 'sin procedencia')}`,
  };
}

/* ───────── Fase 3 · Lotes y exportaciones ───────── */

export const CONTENEDOR_KG = 28000;

export interface ExportacionCas {
  id: string;
  numero: number;
  fecha: string;
  comprador: string | null;
  destino: string | null;
  nota: string | null;
  historico: boolean;
}

export interface LoteCas {
  id: string;
  codigo: string;
  exportacion_id: string;
  fecha: string;
  kg: number;
  muestras_kg: number;
  merma_kg: number;
  ley_sgs: number | null;
  informe_sgs_path: string | null;
  precintos: string | null;
  motivo: string | null;
  estado: 'galpon' | 'despachado';
  despachado_en: string | null;
  despachado_por_name: string | null;
  historico: boolean;
  kg_mgg_hist: number | null;
  costo_hist: number | null;
  actor_name: string | null;
}

export interface LoteCalculado extends LoteCas {
  /** kg MGG que se llevó el lote y su costo (al PMP de ese momento). */
  kgMgg: number | null;
  costo: number | null;
  pmp: number | null;
  resguardoKg: number | null;
  /** Proporción del galpón que se llevó (solo lotes del libro). */
  pct: number | null;
  /** Ley SGS × kg ÷ 100 (estaño contenido). */
  snKg: number | null;
  /** true si sus movimientos son del Excel (no se deshace). */
  delExcel: boolean;
}

/** Cada lote con lo que se llevó de MGG y a qué costo, leído del libro (o del Excel si es anterior). */
export function calcularLotes(lotes: LoteCas[], filas: FilaLibro[]): LoteCalculado[] {
  return lotes.map((l) => {
    const mov = filas.find((f) => f.lote_id === l.id && f.tipo === 'exportacion');
    const snKg = l.ley_sgs ? (l.kg * l.ley_sgs) / 100 : null;
    if (mov) {
      const kgMgg = -mov.dM;
      return { ...l, kgMgg, costo: -mov.dC, pmp: mov.pmpAntes, resguardoKg: l.kg - kgMgg, pct: mov.pct, snKg, delExcel: mov.origen === 'excel' };
    }
    if (l.historico && l.kg_mgg_hist != null) {
      const kgMgg = Number(l.kg_mgg_hist);
      const costo = Number(l.costo_hist ?? 0);
      return { ...l, kgMgg, costo, pmp: kgMgg > 0 ? costo / kgMgg : null, resguardoKg: l.kg - kgMgg, pct: null, snKg, delExcel: true };
    }
    return { ...l, kgMgg: null, costo: null, pmp: null, resguardoKg: null, pct: null, snKg, delExcel: l.historico };
  });
}

export interface NuevoLote {
  fecha: string;
  kg: number;
  muestras: number;
  merma: number;
  motivo?: string | null;
}

/** Lo que dejaría el lote en el libro (para la vista previa y la validación). */
export function simularLote(n: NuevoLote, filas: FilaLibro[]): { lote: FilaLibro; fin: Saldo } | null {
  const base: Omit<MovPmp, 'id' | 'tipo' | 'descripcion' | 'kg' | 'orden'> = {
    fecha: n.fecha, kg_global: null, kg_mgg: null, costo: null, afecta_mgg: true, procedencia: null, pct_mgg: null, tasa: null,
    recepcion_numero: null, cierre_id: null, lote_id: 'nuevo', colada_id: null, origen: 'sistema', nota: null, actor_name: null, created_at: '',
  };
  const tope = Number.MAX_SAFE_INTEGER - 10;
  const extra: MovPmp[] = [{ ...base, id: 'l', tipo: 'exportacion', descripcion: 'Lote', kg: n.kg, orden: tope }];
  if (n.muestras > 0) extra.push({ ...base, id: 'm', tipo: 'muestra', descripcion: 'Muestras', kg: n.muestras, orden: tope + 1 });
  if (n.merma > 0) extra.push({ ...base, id: 'e', tipo: 'merma', descripcion: 'Merma', kg: n.merma, orden: tope + 2 });
  const f = calcularLibro([...filas, ...extra]);
  const lote = f.find((x) => x.id === 'l');
  return lote ? { lote, fin: saldoFinal(f) } : null;
}

export function errorNuevoLote(n: NuevoLote, filas: FilaLibro[], cerradoHastaMes: string | null = null): string | null {
  if (!n.fecha) return 'Indica la fecha.';
  const cerrado = errorMesCerrado(n.fecha, cerradoHastaMes);
  if (cerrado) return cerrado;
  const ap = filas.find((f) => f.tipo === 'apertura');
  if (ap && n.fecha < ap.fecha) return `El libro abre el ${fechaTxt(ap.fecha)}.`;
  if (!(n.kg > 0)) return 'Indica los kg del lote.';
  if (n.muestras < 0 || n.merma < 0) return 'Muestras y merma no pueden ser negativas.';
  if (Math.abs(n.kg - CONTENEDOR_KG) > 0.001 && !n.motivo?.trim()) return `El lote no es de ${numTxtEntero(CONTENEDOR_KG)} kg: indica el motivo.`;
  const fin = saldoFinal(filas);
  const al = saldoAl(filas, n.fecha);
  const disp = Math.min(fin.global, al.global);
  const total = n.kg + n.muestras + n.merma;
  if (total > disp + 0.001) return `No hay tanto en el galpón: hay ${kgTxt(disp)} y el lote con muestras y merma suma ${kgTxt(total)}.`;
  const sim = simularLote(n, filas);
  if (sim && sim.fin.mgg < -0.001) return 'Las muestras y la merma superan lo que queda del inventario MGG.';
  return null;
}

const numTxtEntero = (v: number) => v.toLocaleString('es-VE', { maximumFractionDigits: 0 });

/* ───────── Fase 3 · Fundición desde las coladas ───────── */

export interface ColadaCas {
  id: string;
  colada_num: number;
  fecha: string | null;
  /** kg de casiterita (big bags del inventario detallado) que consumió. */
  kg: number;
  bags: number;
}

/** Coladas que quemaron casiterita, desde la apertura, y que ninguna salida a fundición cubre todavía. */
export function coladasPorPasar(coladas: ColadaCas[], cubiertas: Set<string>, filas: FilaLibro[]): ColadaCas[] {
  const ap = filas.find((f) => f.tipo === 'apertura')?.fecha ?? null;
  return coladas
    .filter((c) => c.kg > 0 && !cubiertas.has(c.id) && (!ap || !c.fecha || c.fecha >= ap))
    .sort((a, b) => a.colada_num - b.colada_num);
}

/* ───────── Fase 4 · Cierres, conteo, reportes y simulador ───────── */

export interface CierreMesPmp {
  mes: string;
  kg_global: number;
  kg_mgg: number;
  costo: number;
  pmp: number;
  resguardo: number;
  movimientos: number;
  cerrado_por_name: string | null;
  cerrado_en: string;
}

export interface ConteoPmp {
  id: string;
  fecha: string;
  renglones: Array<{ descripcion: string; kg: number }>;
  kg_fisico: number;
  kg_libro: number;
  diferencia: number;
  ajuste_id: string | null;
  nota: string | null;
  actor_name: string | null;
  created_at: string;
}

/** Último mes cerrado (AAAA-MM) o null. */
export const cerradoHasta = (cierres: Pick<CierreMesPmp, 'mes'>[]): string | null =>
  cierres.reduce<string | null>((m, c) => (!m || c.mes > m ? c.mes : m), null);

/** Error si la fecha cae en un mes cerrado (o antes). */
export function errorMesCerrado(fecha: string, hasta: string | null): string | null {
  if (hasta && fecha && mesDe(fecha) <= hasta) return `El libro está cerrado hasta ${nombreMes(hasta)}: usa una fecha posterior.`;
  return null;
}

/** Meses del libro que se pueden cerrar: terminados, después del último cierre, en orden. */
export function mesesPorCerrar(filas: FilaLibro[], cierres: Pick<CierreMesPmp, 'mes'>[], hoy: string): string[] {
  const hasta = cerradoHasta(cierres);
  const actual = mesDe(hoy);
  const ap = filas.find((f) => f.tipo === 'apertura');
  if (!ap) return [];
  const out: string[] = [];
  let [y, m] = mesDe(ap.fecha).split('-').map(Number);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym >= actual) break;
    if (!hasta || ym > hasta) out.push(ym);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Último día (AAAA-MM-DD) de un mes AAAA-MM. */
export function finDeMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, '0')}`;
}

/** Mes anterior de AAAA-MM. */
export function mesAnterior(ym: string): string {
  let [y, m] = ym.split('-').map(Number);
  m -= 1; if (m < 1) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Un renglón del reporte «Cierre de promedios» (mismo orden de columnas que el Excel). */
export interface FilaCierreRep {
  clase: 'saldo' | 'mov' | 'promedio';
  fecha: string | null;
  recepcion: number | null;
  descripcion: string;
  global: number;           // mov: Δ global · saldo/promedio: saldo global
  pctExportado: number | null;
  mgg: number;              // mov: Δ MGG · saldo/promedio: inventario MGG
  costoProm: number | null; // mov: tasa (entrada) o PMP aplicado · saldo/promedio: PMP
  costoTotal: number;       // mov: Δ costo · saldo/promedio: costo MGG
  resguardo: number;        // mov: Δ resguardo · saldo/promedio: resguardo
  tipo: TipoMovPmp | null;
}

export function filasCierrePromedio(filas: FilaLibro[], mes: string): FilaCierreRep[] {
  const out: FilaCierreRep[] = [];
  const del = filas.filter((f) => mesDe(f.fecha) === mes);
  const previo = saldoAl(filas, `${mesAnterior(mes)}-31`);
  const tieneApertura = del.some((f) => f.tipo === 'apertura');
  if (!tieneApertura) {
    out.push({
      clase: 'saldo', fecha: `${mes}-01`, recepcion: null, descripcion: `Saldos ${nombreMes(mesAnterior(mes))}`,
      global: previo.global, pctExportado: null, mgg: previo.mgg, costoProm: previo.pmp, costoTotal: previo.costo, resguardo: previo.resguardo, tipo: null,
    });
  }
  let i = 0;
  while (i < del.length) {
    const dia = del[i].fecha;
    while (i < del.length && del[i].fecha === dia) {
      const f = del[i];
      const entrada = f.tipo === 'apertura' || f.tipo === 'entrada';
      out.push({
        clase: f.tipo === 'apertura' ? 'saldo' : 'mov', fecha: f.fecha, recepcion: f.recepcion_numero, descripcion: f.descripcion,
        global: f.dG, pctExportado: f.tipo === 'exportacion' ? f.pct : null, mgg: f.dM,
        costoProm: entrada ? (f.dM > 0 ? f.dC / f.dM : null) : f.tipo === 'recuperacion' ? 0 : f.pmpAntes,
        costoTotal: f.dC, resguardo: f.dResg, tipo: f.tipo,
      });
      i += 1;
    }
    const u = del[i - 1];
    out.push({
      clase: 'promedio', fecha: null, recepcion: null, descripcion: 'PROMEDIO', global: u.G, pctExportado: null, mgg: u.M,
      costoProm: u.pmp, costoTotal: u.C, resguardo: u.resguardo, tipo: null,
    });
  }
  return out;
}

/* Simulador: qué deja un lote vendido con la ley y el precio del día. */
export interface EntradaSimulador {
  kg: number;
  ley: number;            // % Sn (SGS)
  precioTonSn: number;    // $ por tonelada de estaño contenido
  deduccionPct: number;   // TC/RC, fletes, etc.
}

export interface ResultadoSimulador {
  alcanza: boolean;
  pct: number;
  snKg: number;
  bruto: number;
  neto: number;
  kgMgg: number;
  kgResguardo: number;
  costoMgg: number;
  ingresoMgg: number;
  valorResguardo: number;
  margenMgg: number;
  margenPct: number | null;
  /** Precio por tonelada de Sn con el que MGG no gana ni pierde. */
  precioEquilibrio: number | null;
}

export function simularVenta(e: EntradaSimulador, s: Saldo): ResultadoSimulador {
  const kg = Math.max(0, n(e.kg));
  const pct = s.global > 0 ? Math.min(1, kg / s.global) : 0;
  const snKg = (kg * n(e.ley)) / 100;
  const bruto = (snKg / 1000) * n(e.precioTonSn);
  const neto = bruto * (1 - n(e.deduccionPct) / 100);
  const kgMgg = s.mgg * pct;
  const costoMgg = kgMgg * s.pmp;
  const parte = kg > 0 ? kgMgg / kg : 0;
  const ingresoMgg = neto * parte;
  const margenMgg = ingresoMgg - costoMgg;
  const factor = (snKg / 1000) * (1 - n(e.deduccionPct) / 100) * parte;
  return {
    alcanza: kg <= s.global + 0.001, pct, snKg, bruto, neto, kgMgg, kgResguardo: kg - kgMgg, costoMgg, ingresoMgg,
    valorResguardo: neto - ingresoMgg, margenMgg, margenPct: ingresoMgg > 0 ? margenMgg / ingresoMgg : null,
    precioEquilibrio: factor > 0 ? costoMgg / factor : null,
  };
}
