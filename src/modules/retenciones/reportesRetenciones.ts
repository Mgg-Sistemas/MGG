/* ============================================================
   Golden Touch · Retenciones · Reportes (piezas puras)

   Lo que arma un reporte a partir de las retenciones del libro: el rango del
   período, los filtros de la pantalla, la tabla (detalle, agrupada o cruzada
   proveedor × período), los totales por moneda y el CSV. No toca la base ni
   el DOM: los archivos (CSV, Excel, PDF) se dibujan con esta tabla en
   reportesRetencionesArchivos.ts.

   Lo fiscal se informa en bolívares: cada fila lleva lo retenido en Bs (el
   guardado, o el monto por la tasa del registro) y los totales lo ponen
   primero. Bs y $ no se suman entre sí.
   ============================================================ */
import { norm } from '@/shared/lib/texto';
import {
  TIPOS_IMPUESTO, enBolivares, labelDireccion, labelEstadoRetencion, type TipoImpuesto,
} from '@/modules/libroFiscal/retencionesCalculo';
import type { RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { rotuloImpuesto } from '@/modules/libroFiscal/rotulos';

const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/* ───────── Período del reporte ───────── */

export type PeriodoReporte =
  | 'semana_actual' | 'semana_anterior' | 'quincena_actual' | 'quincena_anterior'
  | 'mes_actual' | 'mes_anterior' | 'anio_actual' | 'anio_anterior'
  | 'semana' | 'quincena' | 'mes' | 'anio' | 'rango';

/** Lo que se elige a mano en «Elegir»: un día (semana/quincena), un mes AAAA-MM, un año o un rango. */
export interface EleccionPeriodo {
  dia?: string;
  mes?: string;
  anio?: string;
  desde?: string;
  hasta?: string;
}

export interface Rango { desde: string; hasta: string }

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const fechaUtc = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const finDeMes = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
const sumarDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

function semanaDe(dia: string): Rango {
  const d = fechaUtc(dia);
  const lunes = sumarDias(d, -((d.getUTCDay() + 6) % 7));
  return { desde: iso(lunes), hasta: iso(sumarDias(lunes, 6)) };
}

function quincenaDe(dia: string): Rango {
  const d = fechaUtc(dia);
  const y = d.getUTCFullYear(); const m = d.getUTCMonth();
  return d.getUTCDate() <= 15
    ? { desde: iso(new Date(Date.UTC(y, m, 1))), hasta: iso(new Date(Date.UTC(y, m, 15))) }
    : { desde: iso(new Date(Date.UTC(y, m, 16))), hasta: iso(finDeMes(y, m)) };
}

function mesDe(y: number, m: number): Rango {
  return { desde: iso(new Date(Date.UTC(y, m, 1))), hasta: iso(finDeMes(y, m)) };
}

const anioDe = (y: number): Rango => ({ desde: `${y}-01-01`, hasta: `${y}-12-31` });

/**
 * El rango de fechas (ISO, ambos incluidos) de un período del reporte. `hoy` es
 * el día de referencia (AAAA-MM-DD). Si lo elegido a mano está incompleto, da
 * null y la pantalla lo pide.
 */
export function rangoDePeriodo(p: PeriodoReporte, hoy: string, e: EleccionPeriodo = {}): Rango | null {
  const d = fechaUtc(hoy);
  const y = d.getUTCFullYear(); const m = d.getUTCMonth();
  switch (p) {
    case 'semana_actual': return semanaDe(hoy);
    case 'semana_anterior': return semanaDe(iso(sumarDias(d, -7)));
    case 'quincena_actual': return quincenaDe(hoy);
    case 'quincena_anterior': return quincenaDe(iso(sumarDias(fechaUtc(quincenaDe(hoy).desde), -1)));
    case 'mes_actual': return mesDe(y, m);
    case 'mes_anterior': return mesDe(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);
    case 'anio_actual': return anioDe(y);
    case 'anio_anterior': return anioDe(y - 1);
    case 'semana': return e.dia && /^\d{4}-\d{2}-\d{2}$/.test(e.dia) ? semanaDe(e.dia) : null;
    case 'quincena': return e.dia && /^\d{4}-\d{2}-\d{2}$/.test(e.dia) ? quincenaDe(e.dia) : null;
    case 'mes': {
      const mm = /^(\d{4})-(\d{2})$/.exec(e.mes ?? '');
      return mm ? mesDe(Number(mm[1]), Number(mm[2]) - 1) : null;
    }
    case 'anio': return /^\d{4}$/.test(e.anio ?? '') ? anioDe(Number(e.anio)) : null;
    case 'rango':
      if (!e.desde || !e.hasta || !/^\d{4}-\d{2}-\d{2}$/.test(e.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(e.hasta)) return null;
      return e.desde <= e.hasta ? { desde: e.desde, hasta: e.hasta } : { desde: e.hasta, hasta: e.desde };
    default: return null;
  }
}

/* ───────── Filtros ───────── */

/** Las teclas de impuesto de la pantalla y el impuesto del libro que representan. */
export const IMPUESTOS_REPORTE: { key: string; label: string; tipo: TipoImpuesto }[] = [
  { key: 'iva', label: 'IVA', tipo: 'iva' },
  { key: 'islr', label: 'ISLR', tipo: 'islr' },
  { key: 'isae', label: 'ISAE', tipo: 'municipal' },
  { key: 'estadal', label: 'Estadal', tipo: 'regional' },
  { key: 'igtf', label: 'IGTF', tipo: 'igtf' },
];

export type EstadoFiltro = '' | 'ok' | 'declarada' | 'anulada' | 'todas';
export type FechaBase = 'factura' | 'registro';
export type Agrupar = 'ninguno' | 'proveedor' | 'periodo' | 'tipo' | 'semana' | 'quincena' | 'mes' | 'anio';
export type OrdenReporte = 'fecha' | 'proveedor' | 'retenido';

export interface FiltroReporte {
  impuestos: Record<string, boolean>;
  direccion: '' | 'practicada' | 'recibida';
  estado: EstadoFiltro;
  moneda: '' | 'Bs' | 'USD';
  proveedor: string;
  fechaBase: FechaBase;
}

/** La fecha con la que la fila entra al rango y a los cortes. */
export function fechaDe(r: RetencionPracticada, base: FechaBase): string {
  return (base === 'registro' ? r.createdAt : (r.facturaFecha ?? r.createdAt) ?? '').slice(0, 10);
}

/** Lo retenido en Bs: lo guardado o, si no está, el monto por la tasa del registro. Null si no hay cómo. */
export function retenidoBs(r: RetencionPracticada): number | null {
  if (r.montoBs != null) return r2(r.montoBs);
  if (String(r.moneda).toUpperCase() === 'BS') return r2(r.montoRetenido);
  return r.tasa && r.tasa > 0 ? enBolivares(r.montoRetenido, r.moneda, r.tasa) : null;
}

export function filtrarReporte(filas: RetencionPracticada[], f: FiltroReporte, rango: Rango): RetencionPracticada[] {
  const tipos = new Set(IMPUESTOS_REPORTE.filter((i) => f.impuestos[i.key]).map((i) => i.tipo));
  const q = norm(f.proveedor.trim());
  const qRif = f.proveedor.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return filas.filter((r) => {
    if (!tipos.has(r.tipo)) return false;
    if (f.direccion && r.direccion !== f.direccion) return false;
    if (f.estado === '' && r.anulada) return false;
    if (f.estado === 'ok' && (r.anulada || r.estado !== 'registrada')) return false;
    if (f.estado === 'declarada' && (r.anulada || r.estado !== 'declarada')) return false;
    if (f.estado === 'anulada' && !r.anulada) return false;
    if (f.moneda && (f.moneda === 'Bs') !== (String(r.moneda).toUpperCase() === 'BS')) return false;
    if (q) {
      const enNombre = norm(r.contraparteNombre).includes(q);
      const enRif = qRif.length > 0 && String(r.contraparteRif ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(qRif);
      if (!enNombre && !enRif) return false;
    }
    const fecha = fechaDe(r, f.fechaBase);
    return fecha >= rango.desde && fecha <= rango.hasta;
  });
}

export function ordenarReporte(filas: RetencionPracticada[], orden: OrdenReporte, base: FechaBase): RetencionPracticada[] {
  const xs = [...filas];
  if (orden === 'proveedor') {
    xs.sort((a, b) => (a.contraparteNombre ?? '').localeCompare(b.contraparteNombre ?? '', 'es') || fechaDe(a, base).localeCompare(fechaDe(b, base)));
  } else if (orden === 'retenido') {
    xs.sort((a, b) => (retenidoBs(b) ?? 0) - (retenidoBs(a) ?? 0));
  } else {
    xs.sort((a, b) => fechaDe(a, base).localeCompare(fechaDe(b, base)) || (a.numeroComprobante ?? '').localeCompare(b.numeroComprobante ?? ''));
  }
  return xs;
}

/* ───────── Totales ───────── */

export interface TotalMoneda { moneda: string; registros: number; base: number; retenido: number }
export interface Totales { retenidoBs: number; sinTasa: number; porMoneda: TotalMoneda[] }

/** Totales del reporte: Bs primero (lo que se declara) y, aparte, uno por moneda de origen. Las anuladas no suman. */
export function totalesReporte(filas: RetencionPracticada[]): Totales {
  const porMoneda = new Map<string, TotalMoneda>();
  let bs = 0; let sinTasa = 0;
  for (const r of filas) {
    if (r.anulada) continue;
    const b = retenidoBs(r);
    if (b == null) sinTasa += 1; else bs += b;
    const t = porMoneda.get(r.moneda) ?? { moneda: r.moneda, registros: 0, base: 0, retenido: 0 };
    t.registros += 1; t.base = r2(t.base + r.baseImponible); t.retenido = r2(t.retenido + r.montoRetenido);
    porMoneda.set(r.moneda, t);
  }
  return { retenidoBs: r2(bs), sinTasa, porMoneda: [...porMoneda.values()].sort((a, b) => a.moneda.localeCompare(b.moneda)) };
}

/* ───────── Columnas del detalle ───────── */

export type Celda = string | number | null;

export interface ColumnaReporte {
  id: string;
  label: string;
  numerica?: boolean;
  valor: (r: RetencionPracticada, base: FechaBase) => Celda;
}

const corto = (t: string) => TIPOS_IMPUESTO.find((x) => x.key === t)?.corto ?? rotuloImpuesto(t);
const fechaVe = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-'); return y && m && d ? `${d}/${m}/${y}` : ''; };
const estadoDe = (r: RetencionPracticada) => (r.anulada ? 'Anulada' : labelEstadoRetencion(r.estado));

export const COLUMNAS_REPORTE: ColumnaReporte[] = [
  { id: 'comprobante', label: 'N° comprobante', valor: (r) => r.numeroComprobante },
  { id: 'fecha', label: 'Fecha', valor: (r, b) => fechaVe(fechaDe(r, b)) },
  { id: 'periodo', label: 'Período', valor: (r) => r.periodo },
  { id: 'tipo', label: 'Impuesto', valor: (r) => corto(r.tipo) },
  { id: 'direccion', label: 'Dirección', valor: (r) => labelDireccion(r.direccion) },
  { id: 'nombre', label: 'Proveedor', valor: (r) => r.contraparteNombre },
  { id: 'rif', label: 'RIF', valor: (r) => r.contraparteRif },
  { id: 'factura', label: 'N° factura', valor: (r) => r.facturaNumero },
  { id: 'control', label: 'N° control', valor: (r) => r.facturaControl },
  { id: 'moneda', label: 'Moneda', valor: (r) => r.moneda },
  { id: 'base', label: 'Base imponible', numerica: true, valor: (r) => r2(r.baseImponible) },
  { id: 'pct', label: '% retención', numerica: true, valor: (r) => r.porcentaje },
  { id: 'retenido', label: 'Monto retenido', numerica: true, valor: (r) => r2(r.montoRetenido) },
  { id: 'retenido_bs', label: 'Retenido (Bs)', numerica: true, valor: (r) => retenidoBs(r) },
  { id: 'estado', label: 'Estado', valor: (r) => estadoDe(r) },
];

export const COLUMNAS_POR_DEFECTO = ['comprobante', 'fecha', 'tipo', 'nombre', 'rif', 'factura', 'moneda', 'base', 'pct', 'retenido', 'retenido_bs', 'estado'];

/* ───────── La tabla del reporte ───────── */

/** Una tabla lista para la pantalla, el CSV, el Excel y el PDF. */
export interface TablaReporte {
  encabezados: string[];
  filas: Celda[][];
  /** Columnas numéricas (0-based): a la derecha, con formato de monto. */
  numeros: number[];
  /** Filas que son subtotal o total (0-based): en negrita. */
  totales: number[];
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** La clave y el rótulo del corte de una fila. */
export function corteDe(r: RetencionPracticada, modo: Agrupar, base: FechaBase): { clave: string; etiqueta: string } {
  const f = fechaDe(r, base);
  switch (modo) {
    case 'proveedor': {
      const clave = String(r.contraparteRif ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || norm(r.contraparteNombre) || '—';
      return { clave, etiqueta: `${r.contraparteNombre ?? 'Sin nombre'}${r.contraparteRif ? ` · ${r.contraparteRif}` : ''}` };
    }
    case 'periodo': return { clave: r.periodo, etiqueta: etiquetaPeriodo(r.periodo) };
    case 'tipo': return { clave: r.tipo, etiqueta: corto(r.tipo) };
    case 'semana': { const s = f ? semanaDe(f) : null; return { clave: s?.desde ?? '', etiqueta: s ? `Semana del ${fechaVe(s.desde)} al ${fechaVe(s.hasta)}` : 'Sin fecha' }; }
    case 'quincena': { const q = f ? quincenaDe(f) : null; return { clave: q?.desde ?? '', etiqueta: q ? `Quincena del ${fechaVe(q.desde)} al ${fechaVe(q.hasta)}` : 'Sin fecha' }; }
    case 'mes': return { clave: f.slice(0, 7), etiqueta: f ? etiquetaPeriodo(f.slice(0, 4) + f.slice(5, 7)) : 'Sin fecha' };
    case 'anio': return { clave: f.slice(0, 4), etiqueta: f.slice(0, 4) || 'Sin fecha' };
    default: return { clave: '', etiqueta: '' };
  }
}

/** «202610» → «octubre 2026». */
export function etiquetaPeriodo(p: string): string {
  const m = /^(\d{4})(\d{2})$/.exec(p ?? '');
  return m ? `${MESES[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : (p || 'Sin período');
}

/**
 * La tabla del detalle. Con un corte, cada grupo cierra con su subtotal en Bs;
 * al final va el total en Bs. Las anuladas se listan pero no suman.
 */
export function tablaDetalle(filas: RetencionPracticada[], columnas: string[], agrupar: Agrupar, base: FechaBase): TablaReporte {
  const cols = COLUMNAS_REPORTE.filter((c) => columnas.includes(c.id));
  if (!cols.length) throw new Error('Elige al menos una columna del detalle.');
  const encabezados = cols.map((c) => c.label);
  const numeros = cols.flatMap((c, i) => (c.numerica ? [i] : []));
  const out: Celda[][] = [];
  const totales: number[] = [];
  const iBs = cols.findIndex((c) => c.id === 'retenido_bs');
  const fila = (r: RetencionPracticada) => cols.map((c) => c.valor(r, base));
  const filaTotal = (rotulo: string, xs: RetencionPracticada[]) => {
    const t = totalesReporte(xs);
    const f: Celda[] = cols.map(() => null);
    f[0] = rotulo;
    if (iBs >= 0) f[iBs] = t.retenidoBs;
    else f[cols.length - 1] = `Bs ${formatoMonto(t.retenidoBs)}`;
    totales.push(out.length);
    out.push(f);
  };

  if (agrupar === 'ninguno') {
    filas.forEach((r) => out.push(fila(r)));
  } else {
    const grupos = new Map<string, { etiqueta: string; xs: RetencionPracticada[] }>();
    for (const r of filas) {
      const { clave, etiqueta } = corteDe(r, agrupar, base);
      const g = grupos.get(clave);
      if (g) g.xs.push(r); else grupos.set(clave, { etiqueta, xs: [r] });
    }
    for (const g of grupos.values()) {
      g.xs.forEach((r) => out.push(fila(r)));
      filaTotal(`Subtotal · ${g.etiqueta}`, g.xs);
    }
  }
  if (filas.length) filaTotal('Total', filas);
  return { encabezados, filas: out, numeros, totales };
}

/* ───────── Retenido por proveedor y período ───────── */

export interface TablaCruzada {
  periodos: string[];
  proveedores: { clave: string; nombre: string; rif: string | null; porPeriodo: Record<string, number>; total: number }[];
  totalPorPeriodo: Record<string, number>;
  total: number;
}

/** Proveedor × período fiscal, en Bs. Las anuladas no suman; los proveedores, de mayor a menor. */
export function tablaCruzada(filas: RetencionPracticada[]): TablaCruzada {
  const periodos = new Set<string>();
  const provs = new Map<string, TablaCruzada['proveedores'][number]>();
  const totalPorPeriodo: Record<string, number> = {};
  let total = 0;
  for (const r of filas) {
    if (r.anulada) continue;
    const bs = retenidoBs(r) ?? 0;
    const per = r.periodo || 'Sin período';
    periodos.add(per);
    const { clave } = corteDe(r, 'proveedor', 'factura');
    const p = provs.get(clave) ?? { clave, nombre: r.contraparteNombre ?? 'Sin nombre', rif: r.contraparteRif, porPeriodo: {}, total: 0 };
    p.porPeriodo[per] = r2((p.porPeriodo[per] ?? 0) + bs);
    p.total = r2(p.total + bs);
    provs.set(clave, p);
    totalPorPeriodo[per] = r2((totalPorPeriodo[per] ?? 0) + bs);
    total = r2(total + bs);
  }
  return {
    periodos: [...periodos].sort(),
    proveedores: [...provs.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es')),
    totalPorPeriodo,
    total,
  };
}

export function tablaDeCruzada(c: TablaCruzada): TablaReporte {
  const encabezados = ['Proveedor', 'RIF', ...c.periodos.map(etiquetaPeriodo), 'Total (Bs)'];
  const filas: Celda[][] = c.proveedores.map((p) => [p.nombre, p.rif, ...c.periodos.map((per) => p.porPeriodo[per] ?? 0), p.total]);
  const totales: number[] = [];
  if (c.proveedores.length) {
    totales.push(filas.length);
    filas.push(['Total (Bs)', null, ...c.periodos.map((per) => c.totalPorPeriodo[per] ?? 0), c.total]);
  }
  const numeros = [...c.periodos.map((_, i) => i + 2), c.periodos.length + 2];
  return { encabezados, filas, numeros, totales };
}

/* ───────── CSV ───────── */

/** 1234.5 → «1.234,50» (para mostrar). */
export function formatoMonto(n: number): string {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Un número para el CSV: coma decimal, sin separador de miles (Excel en español lo lee como número). */
export function numeroCsv(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

function celdaCsv(v: Celda, numerica: boolean): string {
  if (v == null) return '';
  const s = typeof v === 'number' && numerica ? numeroCsv(v) : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** El CSV de una tabla: «;» como separador, coma decimal, CRLF. Sin BOM: lo agrega quien descarga. */
export function armarCsv(t: TablaReporte): string {
  const lineas = [t.encabezados.map((h) => celdaCsv(h, false)).join(';')];
  for (const f of t.filas) lineas.push(f.map((v, i) => celdaCsv(v, t.numeros.includes(i))).join(';'));
  return `${lineas.join('\r\n')}\r\n`;
}

/* ───────── Mis plantillas (en este navegador) ───────── */

export interface PlantillaPropia {
  id: string;
  nombre: string;
  /** Plantilla del sistema de la que partió (define el tipo de tabla). */
  base: string;
  periodo: PeriodoReporte;
  eleccion: EleccionPeriodo;
  filtro: FiltroReporte;
  agrupar: Agrupar;
  orden: OrdenReporte;
  columnas: string[];
  orientacion: 'horizontal' | 'vertical';
  creada: string;
}

const clavePlantillas = (usuario: string) => `gt.retenciones.reportes.plantillas:${usuario.toLowerCase()}`;

/** El localStorage, o null si el navegador lo bloquea (con solo leerlo puede lanzar). */
function almacenLocal(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function leerPlantillas(usuario: string, almacen: Pick<Storage, 'getItem'> | null = almacenLocal()): PlantillaPropia[] {
  try {
    const raw = almacen?.getItem(clavePlantillas(usuario));
    const xs = raw ? JSON.parse(raw) : [];
    return Array.isArray(xs) ? xs.filter((x) => x && typeof x.id === 'string' && typeof x.nombre === 'string') : [];
  } catch {
    return [];
  }
}

/** Guarda (o reemplaza por nombre) una plantilla. Devuelve la lista nueva; si el navegador no deja guardar, lanza. */
export function guardarPlantilla(
  usuario: string, p: Omit<PlantillaPropia, 'id' | 'creada'>,
  almacen: Pick<Storage, 'getItem' | 'setItem'> | null = almacenLocal(),
): PlantillaPropia[] {
  const nombre = p.nombre.trim();
  if (!nombre) throw new Error('Indica un nombre para la plantilla.');
  const previas = leerPlantillas(usuario, almacen);
  const misma = previas.find((x) => norm(x.nombre) === norm(nombre));
  const nueva: PlantillaPropia = { ...p, nombre, id: misma?.id ?? `pl-${Date.now().toString(36)}`, creada: new Date().toISOString() };
  const lista = misma ? previas.map((x) => (x.id === misma.id ? nueva : x)) : [...previas, nueva];
  try {
    if (!almacen) throw new Error('sin almacenamiento');
    almacen.setItem(clavePlantillas(usuario), JSON.stringify(lista));
  } catch {
    throw new Error('El navegador no deja guardar la plantilla (almacenamiento bloqueado o lleno).');
  }
  return lista;
}

export function borrarPlantilla(
  usuario: string, id: string,
  almacen: Pick<Storage, 'getItem' | 'setItem'> | null = almacenLocal(),
): PlantillaPropia[] {
  const lista = leerPlantillas(usuario, almacen).filter((x) => x.id !== id);
  try { almacen?.setItem(clavePlantillas(usuario), JSON.stringify(lista)); } catch { /* queda como estaba */ }
  return lista;
}
