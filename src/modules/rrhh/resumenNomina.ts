/* ============================================================
   MGG · RRHH · «📊 Resumen de nómina» (09-10-2026)

   Una tabla con lo que cobró cada persona: por una nómina (un período) o
   en general (todas las nóminas, con rango de fechas y estado), eligiendo
   con casillas QUÉ columnas salen, con una fila de totales al pie, y en
   Excel o PDF para imprimir.

   Los montos NO se recalculan acá: salen de `calcularRecibo`, el mismo
   que arma el recibo de cada trabajador. Así el resumen dice exactamente
   lo que dicen los recibos (20 % sueldo en Bs, 80 % bono en divisas,
   préstamos y anticipos descontados del bono, tasa congelada de la
   quincena). Acá vive la parte pura; los archivos se generan en
   `resumenNominaArchivos.ts` y la pantalla en `ResumenNominaModal.tsx`.
   ============================================================ */
import type { NominaPeriodo, NominaRenglon, Personal } from '@/shared/lib/types';
import { CONCEPTOS_DEDUCCION, calcularRecibo, round2, type ClaveDeduccion } from './sueldoQuincena';
import { nombreNomina } from './nominaLote';

/* ───────── Períodos: fecha, estado y etiqueta ───────── */

/** Lo que hace falta de un período (acepta el resumen con conteos de la lista). */
export type PeriodoResumen = NominaPeriodo & { total_renglones?: number; pagados?: number; pendientes?: number };

export type EstadoPeriodo = 'cargada' | 'en_pago' | 'pagada';

/** La fecha por la que se ordena y se filtra: la del período o, si no tiene, la de carga. */
export function fechaPeriodo(p: Pick<NominaPeriodo, 'periodo_desde' | 'created_at'>): string {
  const d = String(p.periodo_desde ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return String(p.created_at ?? '').slice(0, 10);
}

/**
 * El estado real del período. Si vienen los conteos de la lista se usan
 * (es lo que muestra la pestaña); si no, el campo `estado` de la base.
 */
export function estadoPeriodo(p: PeriodoResumen): EstadoPeriodo {
  if (typeof p.total_renglones === 'number' && typeof p.pendientes === 'number') {
    if (p.total_renglones > 0 && p.pendientes === 0) return 'pagada';
    if ((p.pagados ?? 0) > 0) return 'en_pago';
    return 'cargada';
  }
  return p.estado === 'pagada' || p.estado === 'en_pago' ? p.estado : 'cargada';
}

export function labelEstadoPeriodo(e: EstadoPeriodo): string {
  return e === 'pagada' ? 'Pagada' : e === 'en_pago' ? 'En pago' : 'Cargada';
}

/** dd/mm/aaaa sin pasar por zona horaria (son días, no instantes). */
export function fechaCortaIso(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Cómo se nombra un período en el resumen: su nombre (o código) y la fecha. */
export function etiquetaPeriodo(p: PeriodoResumen): string {
  const f = fechaCortaIso(fechaPeriodo(p));
  return f ? `${nombreNomina(p)} · ${f}` : nombreNomina(p);
}

/** Más nuevas primero (por fecha del período; desempata por la de carga). */
export function ordenarPeriodos<T extends PeriodoResumen>(periodos: readonly T[]): T[] {
  return [...periodos].sort((a, b) => {
    const c = fechaPeriodo(b).localeCompare(fechaPeriodo(a));
    return c !== 0 ? c : String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

export interface FiltroGeneral {
  /** aaaa-mm-dd, inclusive. Vacío = sin tope. */
  desde?: string | null;
  hasta?: string | null;
  /** Vacío o 'todos' = cualquier estado. */
  estado?: EstadoPeriodo | 'todos' | '' | null;
}

export function filtrarPeriodos<T extends PeriodoResumen>(periodos: readonly T[], f: FiltroGeneral): T[] {
  const desde = String(f.desde ?? '').slice(0, 10);
  const hasta = String(f.hasta ?? '').slice(0, 10);
  const estado = f.estado && f.estado !== 'todos' ? f.estado : null;
  return periodos.filter((p) => {
    const fecha = fechaPeriodo(p);
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    if (estado && estadoPeriodo(p) !== estado) return false;
    return true;
  });
}

/* ───────── La fila del resumen ───────── */

export interface FilaResumen {
  personalId: string | null;
  empleado: string;
  cedula: string;
  cargo: string;
  departamento: string;
  /** Nombre de la nómina (o «3 nóminas» cuando se agrupa por empleado). */
  periodo: string;
  /** aaaa-mm-dd del período; agrupado: la más reciente. */
  fechaPeriodo: string;
  /** Cuántas nóminas suma la fila (1 si no está agrupada). */
  nominas: number;
  diasTrabajados: number;
  diasDescanso: number;
  /** Lo devengado de la quincena, tal como lo liquidó la nómina. */
  bruto: number;
  /** La parte sueldo (20 %) en $ y en Bs a la tasa del período. */
  sueldoUsd: number;
  sueldoBs: number;
  /** La parte bono (80 %), antes de descuentos. */
  bonoUsd: number;
  bonosExtra: number;
  viaticos: number;
  ded: Record<ClaveDeduccion, number>;
  totalDeducciones: number;
  /** El neto de la tabla en bolívares (sueldo + extras − deducciones de ley), en $ y en Bs. */
  netoUsd: number;
  netoBs: number;
  /** Bono − préstamos − anticipos: lo que se entrega en divisas. */
  bonoNetoUsd: number;
  /** Lo que la persona se lleva: neto en Bs (en $) + bono neto. */
  totalRecibidoUsd: number;
  /** Tasa del recibo; agrupado queda en null porque cada nómina tiene la suya. */
  tasa: number | null;
  pagadas: number;
  estadoPago: string;
  /** aaaa-mm-dd del pago (agrupado: el último). */
  fechaPago: string;
  pagadoPor: string;
  caja: string;
}

export interface FuentesResumen {
  periodos: readonly PeriodoResumen[];
  renglones: readonly NominaRenglon[];
  /** Para la cédula (y el nombre completo si el renglón lo trae distinto). */
  personal?: readonly Pick<Personal, 'id' | 'cedula'>[];
  /** Para el nombre de la caja con la que se pagó. */
  cajas?: readonly { id: string; nombre: string }[];
}

const t = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Los montos del recibo, con la MISMA cuenta que el recibo impreso. */
export function construirFila(r: NominaRenglon, periodo: PeriodoResumen | null, cedula?: string | null, caja?: string | null): FilaResumen {
  // La tasa del recibo: la del pago si ya se pagó con una propia; si no, la de la quincena.
  const tasa = Number(r.tasa_pago) || Number(periodo?.tasa_bcv) || 0;
  const ded: Record<ClaveDeduccion, number> = {
    ivss: round2(Number(r.deduc_ivss) || 0),
    rpe: round2(Number(r.deduc_rpe) || 0),
    faov: round2(Number(r.deduc_faov) || 0),
    sindicato: round2(Number(r.deduc_sindicato) || 0),
    prestamos: round2(Number(r.deduc_prestamos) || 0),
    anticipos: round2(Number(r.deduc_anticipos) || 0),
    otros: round2(Number(r.deduc_otros) || 0),
  };
  const c = calcularRecibo({
    brutoQuincena: Number(r.salario_bruto) || 0,
    diasTrabajados: Number(r.dias_trabajados) || 0,
    diasDescanso: Number(r.dias_descanso) || 0,
    bonosExtra: Number(r.asignaciones) || 0,
    viaticos: Number(r.viaticos) || 0,
    deducciones: ded,
    tasa,
  });
  const pagada = r.estado === 'pagada';
  return {
    personalId: r.personal_id ?? null,
    empleado: t(r.nombre),
    cedula: t(cedula),
    cargo: t(r.cargo),
    departamento: t(r.departamento),
    periodo: periodo ? nombreNomina(periodo) : '',
    fechaPeriodo: periodo ? fechaPeriodo(periodo) : '',
    nominas: 1,
    diasTrabajados: Number(r.dias_trabajados) || 0,
    diasDescanso: Number(r.dias_descanso) || 0,
    bruto: c.reparto.bruto,
    sueldoUsd: c.reparto.sueldo,
    sueldoBs: round2(c.reparto.sueldo * tasa),
    bonoUsd: c.bonoUsd,
    bonosExtra: round2(Number(r.asignaciones) || 0),
    viaticos: round2(Number(r.viaticos) || 0),
    ded,
    totalDeducciones: round2(CONCEPTOS_DEDUCCION.reduce((a, d) => a + ded[d.key], 0)),
    netoUsd: c.netoUsd,
    netoBs: c.netoBs,
    bonoNetoUsd: c.bonoNetoUsd,
    totalRecibidoUsd: c.totalRecibidoUsd,
    tasa: tasa > 0 ? tasa : null,
    pagadas: pagada ? 1 : 0,
    estadoPago: pagada ? 'Pagada' : 'Por pagar',
    fechaPago: pagada ? String(r.pagada_en ?? '').slice(0, 10) : '',
    pagadoPor: pagada ? t(r.pagada_por) : '',
    caja: pagada ? t(caja) : '',
  };
}

/**
 * Una fila por renglón (persona × nómina), solo de los períodos que vienen
 * en `periodos`: los renglones de otros períodos se ignoran. Ordenadas por
 * fecha del período (más nuevas primero) y nombre.
 */
export function construirFilas(f: FuentesResumen): FilaResumen[] {
  const periodos = new Map(f.periodos.map((p) => [p.id, p]));
  const cedulas = new Map((f.personal ?? []).map((p) => [p.id, p.cedula ?? '']));
  const cajas = new Map((f.cajas ?? []).map((c) => [c.id, c.nombre]));
  const filas: FilaResumen[] = [];
  for (const r of f.renglones) {
    const p = periodos.get(r.periodo_id);
    if (!p) continue;
    filas.push(construirFila(r, p, r.personal_id ? cedulas.get(r.personal_id) : null, r.caja_id ? cajas.get(r.caja_id) : null));
  }
  return filas.sort((a, b) => b.fechaPeriodo.localeCompare(a.fechaPeriodo) || a.empleado.localeCompare(b.empleado, 'es'));
}

/* ───────── Agrupar por empleado ───────── */

const CLAVES_SUMA = [
  'diasTrabajados', 'diasDescanso', 'bruto', 'sueldoUsd', 'sueldoBs', 'bonoUsd', 'bonosExtra', 'viaticos',
  'totalDeducciones', 'netoUsd', 'netoBs', 'bonoNetoUsd', 'totalRecibidoUsd', 'pagadas', 'nominas',
] as const;

function unir(valores: string[]): string {
  return [...new Set(valores.filter(Boolean))].join(', ');
}

/**
 * Suma las nóminas de cada persona en una sola fila. Los Bs se suman tal
 * como salieron en cada recibo (cada uno con su tasa), por eso la tasa de
 * la fila agrupada queda vacía: no hay UNA tasa que las represente.
 */
export function agruparPorEmpleado(filas: readonly FilaResumen[]): FilaResumen[] {
  const mapa = new Map<string, FilaResumen[]>();
  for (const f of filas) {
    const k = f.personalId ?? `nombre:${f.empleado.toLowerCase()}`;
    mapa.set(k, [...(mapa.get(k) ?? []), f]);
  }
  const out: FilaResumen[] = [];
  for (const grupo of mapa.values()) {
    const base = { ...grupo[0] };
    for (const k of CLAVES_SUMA) base[k] = round2(grupo.reduce((a, f) => a + f[k], 0));
    base.ded = Object.fromEntries(CONCEPTOS_DEDUCCION.map((d) => [d.key, round2(grupo.reduce((a, f) => a + f.ded[d.key], 0))])) as Record<ClaveDeduccion, number>;
    const n = grupo.length;
    base.periodo = n === 1 ? grupo[0].periodo : `${n} nóminas`;
    base.fechaPeriodo = grupo.map((f) => f.fechaPeriodo).sort().at(-1) ?? '';
    base.tasa = n === 1 ? grupo[0].tasa : null;
    base.estadoPago = base.pagadas === n ? (n === 1 ? 'Pagada' : 'Pagadas') : base.pagadas === 0 ? 'Por pagar' : `${base.pagadas}/${n} pagadas`;
    base.fechaPago = grupo.map((f) => f.fechaPago).sort().at(-1) ?? '';
    base.pagadoPor = unir(grupo.map((f) => f.pagadoPor));
    base.caja = unir(grupo.map((f) => f.caja));
    // Los datos de la persona: los de la nómina más reciente (cargo puede cambiar).
    const reciente = [...grupo].sort((a, b) => b.fechaPeriodo.localeCompare(a.fechaPeriodo))[0];
    base.cargo = reciente.cargo; base.departamento = reciente.departamento; base.cedula = reciente.cedula || base.cedula;
    out.push(base);
  }
  return out.sort((a, b) => a.empleado.localeCompare(b.empleado, 'es'));
}

/* ───────── Columnas ───────── */

export type GrupoColumna = 'persona' | 'periodo' | 'dias' | 'devengado' | 'deducciones' | 'neto' | 'pago';

export const GRUPOS_COLUMNA: { key: GrupoColumna; label: string }[] = [
  { key: 'persona', label: 'Trabajador' },
  { key: 'periodo', label: 'Nómina' },
  { key: 'dias', label: 'Días' },
  { key: 'devengado', label: 'Devengado' },
  { key: 'deducciones', label: 'Deducciones ($)' },
  { key: 'neto', label: 'Neto' },
  { key: 'pago', label: 'Pago' },
];

export type TipoColumna = 'texto' | 'entero' | 'monto';

export interface ColumnaResumen {
  key: string;
  label: string;
  grupo: GrupoColumna;
  tipo: TipoColumna;
  /** Ancho sugerido en Excel (caracteres). */
  ancho: number;
  /** Si entra en la fila de totales. */
  suma: boolean;
  valor: (f: FilaResumen) => string | number;
}

const monto = (key: string, label: string, grupo: GrupoColumna, ancho: number, valor: (f: FilaResumen) => number): ColumnaResumen =>
  ({ key, label, grupo, tipo: 'monto', ancho, suma: true, valor });

export const COLUMNAS_RESUMEN: ColumnaResumen[] = [
  { key: 'empleado', label: 'Trabajador', grupo: 'persona', tipo: 'texto', ancho: 30, suma: false, valor: (f) => f.empleado },
  { key: 'cedula', label: 'Cédula', grupo: 'persona', tipo: 'texto', ancho: 13, suma: false, valor: (f) => f.cedula },
  { key: 'cargo', label: 'Cargo', grupo: 'persona', tipo: 'texto', ancho: 20, suma: false, valor: (f) => f.cargo },
  { key: 'departamento', label: 'Departamento', grupo: 'persona', tipo: 'texto', ancho: 18, suma: false, valor: (f) => f.departamento },

  { key: 'periodo', label: 'Nómina', grupo: 'periodo', tipo: 'texto', ancho: 28, suma: false, valor: (f) => f.periodo },
  { key: 'fecha_periodo', label: 'Fecha', grupo: 'periodo', tipo: 'texto', ancho: 11, suma: false, valor: (f) => fechaCortaIso(f.fechaPeriodo) },
  { key: 'tasa', label: 'Tasa (Bs/$)', grupo: 'periodo', tipo: 'monto', ancho: 11, suma: false, valor: (f) => f.tasa ?? '' },

  { key: 'dias_trabajados', label: 'Días trab.', grupo: 'dias', tipo: 'entero', ancho: 9, suma: true, valor: (f) => f.diasTrabajados },
  { key: 'dias_descanso', label: 'Días desc.', grupo: 'dias', tipo: 'entero', ancho: 9, suma: true, valor: (f) => f.diasDescanso },

  monto('bruto', 'Sueldo quincena ($)', 'devengado', 14, (f) => f.bruto),
  monto('sueldo_usd', 'Sueldo 20 % ($)', 'devengado', 13, (f) => f.sueldoUsd),
  monto('sueldo_bs', 'Sueldo 20 % (Bs)', 'devengado', 15, (f) => f.sueldoBs),
  monto('bono_usd', 'Bono 80 % ($)', 'devengado', 13, (f) => f.bonoUsd),
  monto('bonos_extra', 'Bonos extra ($)', 'devengado', 12, (f) => f.bonosExtra),
  monto('viaticos', 'Viáticos ($)', 'devengado', 11, (f) => f.viaticos),

  ...CONCEPTOS_DEDUCCION.map((d) => monto(`ded_${d.key}`, d.key === 'ivss' ? 'IVSS' : d.key === 'rpe' ? 'RPE' : d.key === 'faov' ? 'FAOV' : d.label, 'deducciones', 11, (f) => f.ded[d.key])),
  monto('total_deducciones', 'Total deducciones ($)', 'deducciones', 14, (f) => f.totalDeducciones),

  monto('neto_usd', 'Neto en Bs ($)', 'neto', 13, (f) => f.netoUsd),
  monto('neto_bs', 'Neto en Bs (Bs)', 'neto', 15, (f) => f.netoBs),
  monto('bono_neto_usd', 'Bono neto ($)', 'neto', 13, (f) => f.bonoNetoUsd),
  monto('total_recibido_usd', 'Total recibido ($)', 'neto', 14, (f) => f.totalRecibidoUsd),

  { key: 'estado_pago', label: 'Estado', grupo: 'pago', tipo: 'texto', ancho: 11, suma: false, valor: (f) => f.estadoPago },
  { key: 'fecha_pago', label: 'Fecha de pago', grupo: 'pago', tipo: 'texto', ancho: 12, suma: false, valor: (f) => fechaCortaIso(f.fechaPago) },
  { key: 'pagado_por', label: 'Pagado por', grupo: 'pago', tipo: 'texto', ancho: 24, suma: false, valor: (f) => f.pagadoPor },
  { key: 'caja', label: 'Caja', grupo: 'pago', tipo: 'texto', ancho: 18, suma: false, valor: (f) => f.caja },
];

/** Lo que trae marcado «Básico»: quién, cuánto y en qué quedó. */
export const COLUMNAS_BASICO = [
  'empleado', 'cedula', 'periodo', 'dias_trabajados', 'dias_descanso', 'bruto',
  'sueldo_usd', 'sueldo_bs', 'bono_neto_usd', 'total_recibido_usd', 'estado_pago',
];

export const COLUMNAS_TODAS = COLUMNAS_RESUMEN.map((c) => c.key);

/** Las columnas elegidas, en el orden del catálogo (no en el que se marcaron). */
export function columnasElegidas(keys: readonly string[]): ColumnaResumen[] {
  const set = new Set(keys);
  return COLUMNAS_RESUMEN.filter((c) => set.has(c.key));
}

/* ───────── La tabla lista para pantalla, Excel y PDF ───────── */

export interface TablaResumen {
  head: string[];
  filas: (string | number)[][];
  /** La fila de totales: «TOTAL» en el N°, la suma en las columnas que suman, vacío en el resto. */
  totales: (string | number)[];
  columnas: ColumnaResumen[];
  /** Personas distintas (por id, o por nombre si el renglón no tiene id). */
  personas: number;
}

export function contarPersonas(filas: readonly FilaResumen[]): number {
  return new Set(filas.map((f) => f.personalId ?? `nombre:${f.empleado.toLowerCase()}`)).size;
}

export function totalesDe(filas: readonly FilaResumen[], columnas: readonly ColumnaResumen[]): (string | number)[] {
  return columnas.map((c) => (c.suma ? round2(filas.reduce((a, f) => a + (Number(c.valor(f)) || 0), 0)) : ''));
}

/** Encabezado, filas y totales. La primera columna es el N° de renglón. */
export function tablaResumen(filas: readonly FilaResumen[], keys: readonly string[]): TablaResumen {
  const columnas = columnasElegidas(keys);
  return {
    head: ['N°', ...columnas.map((c) => c.label)],
    filas: filas.map((f, i) => [i + 1, ...columnas.map((c) => c.valor(f))]),
    totales: ['TOTAL', ...totalesDe(filas, columnas)],
    columnas,
    personas: contarPersonas(filas),
  };
}

/** Cómo se muestra un valor en pantalla y en el PDF (Excel guarda el número). */
export function formatearValor(col: ColumnaResumen | null, v: string | number): string {
  if (v === '' || v == null) return '';
  if (typeof v !== 'number') return String(v);
  if (col?.tipo === 'monto') return v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (col?.tipo === 'entero') return Number.isInteger(v) ? String(v) : v.toLocaleString('es-VE', { maximumFractionDigits: 2 });
  return String(v);
}

/* ───────── El alcance, para el encabezado ───────── */

export type ModoResumen = 'periodo' | 'general';

export interface AlcanceResumen {
  modo: ModoResumen;
  periodo?: PeriodoResumen | null;
  filtro?: FiltroGeneral;
  agrupado?: boolean;
}

/** La línea que dice de qué es el resumen: «Primera quincena… · 15/10/2026» o «Todas las nóminas · del … al …». */
export function textoAlcance(a: AlcanceResumen): string {
  if (a.modo === 'periodo') return a.periodo ? etiquetaPeriodo(a.periodo) : 'Sin nómina elegida';
  const partes = ['Todas las nóminas'];
  const d = fechaCortaIso(a.filtro?.desde), h = fechaCortaIso(a.filtro?.hasta);
  if (d && h) partes.push(`del ${d} al ${h}`);
  else if (d) partes.push(`desde el ${d}`);
  else if (h) partes.push(`hasta el ${h}`);
  const e = a.filtro?.estado;
  if (e && e !== 'todos') partes.push(e === 'pagada' ? 'solo pagadas' : e === 'en_pago' ? 'solo en pago' : 'solo cargadas');
  if (a.agrupado) partes.push('agrupado por trabajador');
  return partes.join(' · ');
}
