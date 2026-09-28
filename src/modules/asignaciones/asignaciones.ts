/* ============================================================
   MGG · Asignaciones · Lo que la empresa le entrega a un trabajador

   Dotación de uniformes, líneas telefónicas, laptops, material de
   oficina, herramientas. Dos cosas distintas conviven acá:

   · Lo que VUELVE cuando la persona se va —la laptop, el teléfono, la
     herramienta—: queda pendiente de devolución hasta que se devuelve.
   · Lo que NO vuelve —el uniforme, las resmas de papel, los guantes—:
     se entrega y se acabó. Registrarlo igual sirve para saber cuándo
     le tocó la última dotación y cuánto material consume una oficina.

   Un uniforme «pendiente de devolución» sería un pendiente eterno, así
   que lo retornable es una propiedad de CADA asignación, con un valor
   por defecto por tipo que se puede cambiar: hay laptops que se
   regalan y uniformes que se devuelven.

   Acá vive solo la lógica que se puede probar sin base de datos.
   ============================================================ */

/** Qué clase de cosa se asignó. */
export type TipoAsignacion =
  | 'dotacion'
  | 'linea_telefonica'
  | 'equipo_electronico'
  | 'material_oficina'
  | 'herramienta'
  | 'epp'
  | 'otro';

/** En qué anda la asignación. */
export type EstadoAsignacion = 'asignado' | 'devuelto' | 'perdido' | 'danado';

export interface DefinicionTipo {
  key: TipoAsignacion;
  label: string;
  icon: string;
  /** Valor por defecto de «tiene que volver» al elegir este tipo. */
  retornable: boolean;
  /** Pide el número de línea (solo telefonía). */
  pideLinea?: boolean;
  /** Pide el serial (equipos y herramientas: es lo que los identifica). */
  pideSerial?: boolean;
}

/**
 * Los tipos, con lo que cada uno pide y si vuelve por defecto.
 *
 * El default de `retornable` sale de la realidad del almacén, no de una regla
 * pareja: un uniforme entregado no se recibe de vuelta, una laptop sí.
 */
export const TIPOS_ASIGNACION: DefinicionTipo[] = [
  { key: 'dotacion',           label: 'Dotación / Uniformes',   icon: '👕', retornable: false },
  { key: 'linea_telefonica',   label: 'Línea telefónica',       icon: '📱', retornable: true,  pideLinea: true },
  { key: 'equipo_electronico', label: 'Equipo electrónico',     icon: '💻', retornable: true,  pideSerial: true },
  { key: 'material_oficina',   label: 'Material de oficina',    icon: '📎', retornable: false },
  { key: 'herramienta',        label: 'Herramienta',            icon: '🔧', retornable: true,  pideSerial: true },
  { key: 'epp',                label: 'Implementos de seguridad', icon: '🦺', retornable: false },
  { key: 'otro',               label: 'Otro',                   icon: '📦', retornable: true },
];

export function definicionTipo(t: string | null | undefined): DefinicionTipo | null {
  return TIPOS_ASIGNACION.find((x) => x.key === t) ?? null;
}

export function labelTipo(t: string | null | undefined): string {
  return definicionTipo(t)?.label ?? String(t ?? '—');
}

export function iconoTipo(t: string | null | undefined): string {
  return definicionTipo(t)?.icon ?? '📦';
}

/** ¿Este tipo vuelve, por defecto? Un tipo desconocido se asume retornable. */
export function retornablePorDefecto(t: string | null | undefined): boolean {
  return definicionTipo(t)?.retornable ?? true;
}

export const ESTADOS_ASIGNACION: { key: EstadoAsignacion; label: string }[] = [
  { key: 'asignado', label: 'En poder del trabajador' },
  { key: 'devuelto', label: 'Devuelto' },
  { key: 'perdido',  label: 'Perdido' },
  { key: 'danado',   label: 'Dañado' },
];

export function labelEstado(e: string | null | undefined): string {
  return ESTADOS_ASIGNACION.find((x) => x.key === e)?.label ?? String(e ?? '—');
}

/**
 * Cómo se lee el estado EN PANTALLA, que no es lo mismo que el estado guardado.
 *
 * Un uniforme en estado «asignado» no está pendiente de nada: se entregó y no
 * vuelve. Mostrarlo igual que una laptop prestada haría que la lista de
 * pendientes no sirva para nada.
 */
export function textoEstado(estado: string | null | undefined, retornable: boolean): string {
  if (estado === 'asignado') return retornable ? 'Pendiente de devolución' : 'Entregado · no retorna';
  return labelEstado(estado);
}

/** La forma mínima de una asignación para todo lo que se calcula acá. */
export interface AsignacionBase {
  id?: string;
  personal_id?: string | null;
  tipo?: string | null;
  descripcion?: string | null;
  producto_id?: string | null;
  cantidad?: number | string | null;
  serial?: string | null;
  numero_linea?: string | null;
  fecha_asignacion?: string | null;
  retornable?: boolean | null;
  estado?: string | null;
  fecha_retorno?: string | null;
  historico?: boolean | null;
  descontado?: boolean | null;
}

/**
 * ¿Está pendiente de que la devuelvan?
 *
 * Solo lo retornable que todavía está en poder del trabajador. Lo perdido y lo
 * dañado ya se resolvió —mal, pero se resolvió—: dejarlos pendientes obligaría
 * a arrastrar para siempre una laptop que se cayó al río.
 */
export function estaPendiente(a: AsignacionBase): boolean {
  return a.retornable !== false && (a.estado ?? 'asignado') === 'asignado';
}

/** ¿Ya se cerró? Devuelto, perdido o dañado: la cosa ya no está en la calle. */
export function estaCerrada(a: AsignacionBase): boolean {
  const e = a.estado ?? 'asignado';
  return e === 'devuelto' || e === 'perdido' || e === 'danado';
}

/**
 * ¿Esta asignación tiene que descontar del inventario al guardarse?
 *
 * Solo si sale de una ficha del inventario Y no es una carga histórica. Lo
 * histórico ya salió del almacén hace rato: descontarlo hoy lo contaría dos
 * veces y dejaría el stock corto sin que nadie sepa por qué.
 */
export function descuentaInventario(a: AsignacionBase): boolean {
  return !!a.producto_id && a.historico !== true;
}

export const MIN_DESCRIPCION = 3;
export const MAX_DESCRIPCION = 160;

/**
 * Qué está mal en una asignación, en palabras que se puedan mostrar.
 *
 * Devuelve null cuando se puede guardar. Un solo mensaje por vez: corregir de
 * a uno es más fácil que leer una lista de seis cosas.
 */
export function errorAsignacion(a: AsignacionBase): string | null {
  if (!a.personal_id) return 'Elegí el trabajador.';
  if (!definicionTipo(a.tipo)) return 'Elegí qué tipo de asignación es.';

  const desc = (a.descripcion ?? '').trim();
  if (desc.length < MIN_DESCRIPCION) return `Describí qué se le asignó (mínimo ${MIN_DESCRIPCION} caracteres).`;
  if (desc.length > MAX_DESCRIPCION) return `La descripción no puede pasar de ${MAX_DESCRIPCION} caracteres.`;

  if (!a.fecha_asignacion) return 'Indicá la fecha de la asignación.';

  const cant = Number(a.cantidad);
  if (!Number.isFinite(cant) || cant <= 0) return 'La cantidad tiene que ser mayor que cero.';

  // Un producto del inventario se descuenta por unidades: media laptop no existe.
  // Sin ficha (una línea telefónica) la cantidad es libre.

  const def = definicionTipo(a.tipo);
  if (def?.pideLinea && !(a.numero_linea ?? '').trim()) return 'Indicá el número de la línea telefónica.';

  if (a.fecha_retorno && a.fecha_asignacion && a.fecha_retorno < a.fecha_asignacion) {
    return 'La fecha de devolución no puede ser anterior a la de asignación.';
  }
  return null;
}

/** Qué está mal en una devolución. Null si se puede cerrar. */
export function errorDevolucion(a: AsignacionBase, fechaRetorno: string, estado: string): string | null {
  if (estaCerrada(a)) return 'Esta asignación ya está cerrada.';
  if (!fechaRetorno) return 'Indicá la fecha de la devolución.';
  if (a.fecha_asignacion && fechaRetorno < a.fecha_asignacion) {
    return 'La fecha de devolución no puede ser anterior a la de asignación.';
  }
  if (estado !== 'devuelto' && estado !== 'perdido' && estado !== 'danado') {
    return 'Elegí cómo se cierra: devuelto, perdido o dañado.';
  }
  return null;
}

/**
 * ¿Al cerrar así, el material vuelve al inventario?
 *
 * Solo lo devuelto y solo si había salido del inventario por esta asignación.
 * Lo perdido y lo dañado no reingresan: no están. Meterlos de vuelta al stock
 * haría que el almacén dijera que hay una laptop que nadie puede encontrar.
 */
export function reingresaAlInventario(a: AsignacionBase, estadoCierre: string): boolean {
  return a.descontado === true && estadoCierre === 'devuelto';
}

/* ── Filtros ───────────────────────────────────────────────── */

export interface FiltroAsignaciones {
  texto: string;
  personalId: string;
  tipo: string;
  estado: string;
  desde: string;
  hasta: string;
  /** Solo lo que está pendiente de devolución. */
  soloPendientes: boolean;
  /** Solo las cargas históricas (las que ya existían antes del sistema). */
  soloHistoricas: boolean;
}

export const FILTRO_ASIGNACIONES_VACIO: FiltroAsignaciones = {
  texto: '', personalId: '', tipo: '', estado: '',
  desde: '', hasta: '', soloPendientes: false, soloHistoricas: false,
};

/** ¿Hay algún filtro puesto? Sirve para mostrar el botón de limpiar. */
export function hayFiltro(f: FiltroAsignaciones): boolean {
  return !!(f.texto.trim() || f.personalId || f.tipo || f.estado || f.desde || f.hasta
    || f.soloPendientes || f.soloHistoricas);
}

/** Sin acentos y en minúsculas, para que «línea» encuentre «linea». */
function plano(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * ¿La asignación cae en el rango de fechas?
 *
 * Mira la FECHA DE ASIGNACIÓN, que es la que le importa a quien pregunta «qué
 * le dimos a Pedro este año». La devolución tiene su propia columna en la
 * tabla, para el que quiera verla.
 */
export function enRango(a: AsignacionBase, desde: string, hasta: string): boolean {
  const f = a.fecha_asignacion ?? '';
  if (!f) return !desde && !hasta;
  if (desde && f < desde) return false;
  if (hasta && f > hasta) return false;
  return true;
}

/**
 * Filtra la lista. El texto busca en descripción, serial, línea y en el nombre
 * del trabajador, que se resuelve afuera y llega por `nombrePersonal`.
 */
export function filtrarAsignaciones<T extends AsignacionBase>(
  filas: readonly T[],
  f: FiltroAsignaciones,
  nombrePersonal: (id: string | null | undefined) => string = () => '',
): T[] {
  const q = plano(f.texto.trim());
  return filas.filter((a) => {
    if (f.personalId && a.personal_id !== f.personalId) return false;
    if (f.tipo && a.tipo !== f.tipo) return false;
    if (f.estado && (a.estado ?? 'asignado') !== f.estado) return false;
    if (f.soloPendientes && !estaPendiente(a)) return false;
    if (f.soloHistoricas && a.historico !== true) return false;
    if (!enRango(a, f.desde, f.hasta)) return false;
    if (!q) return true;
    const heno = plano([
      a.descripcion, a.serial, a.numero_linea, labelTipo(a.tipo), nombrePersonal(a.personal_id),
    ].join(' '));
    return heno.includes(q);
  });
}

/* ── Resumen para las tarjetas ─────────────────────────────── */

export interface ResumenAsignaciones {
  /** Cuántas cosas están pendientes de devolución. */
  pendientes: number;
  /** Cuántas personas distintas tienen algo pendiente. */
  personasConPendientes: number;
  /** Cuántas asignaciones hay en lo que se está mirando. */
  total: number;
  /** Cuántas de esas ya se cerraron. */
  cerradas: number;
}

export function resumenAsignaciones(filas: readonly AsignacionBase[]): ResumenAsignaciones {
  const personas = new Set<string>();
  let pendientes = 0;
  let cerradas = 0;
  for (const a of filas) {
    if (estaPendiente(a)) {
      pendientes += 1;
      if (a.personal_id) personas.add(a.personal_id);
    }
    if (estaCerrada(a)) cerradas += 1;
  }
  return { pendientes, personasConPendientes: personas.size, total: filas.length, cerradas };
}

/** Una persona con lo que tiene pendiente, para la lista clickeable. */
export interface PendientePorPersona {
  personalId: string;
  pendientes: number;
}

/**
 * Quiénes tienen algo sin devolver, de mayor a menor.
 *
 * Es la lista que se mira cuando alguien renuncia: qué hay que pedirle antes
 * de firmarle la liquidación.
 */
export function pendientesPorPersona(filas: readonly AsignacionBase[]): PendientePorPersona[] {
  const acc = new Map<string, number>();
  for (const a of filas) {
    if (!estaPendiente(a) || !a.personal_id) continue;
    acc.set(a.personal_id, (acc.get(a.personal_id) ?? 0) + 1);
  }
  return [...acc.entries()]
    .map(([personalId, pendientes]) => ({ personalId, pendientes }))
    .sort((x, y) => y.pendientes - x.pendientes);
}

/** Cuántas hay de cada tipo, para el resumen del reporte. */
export function conteoPorTipo(filas: readonly AsignacionBase[]): { tipo: string; label: string; cantidad: number }[] {
  const acc = new Map<string, number>();
  for (const a of filas) {
    const t = a.tipo ?? 'otro';
    acc.set(t, (acc.get(t) ?? 0) + 1);
  }
  return TIPOS_ASIGNACION
    .filter((t) => acc.has(t.key))
    .map((t) => ({ tipo: t.key, label: t.label, cantidad: acc.get(t.key) ?? 0 }));
}

/* ── Rangos rápidos ────────────────────────────────────────── */

const dd = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;

/**
 * Los rangos de un clic. Se calculan contra `hoy` (inyectable) para que la
 * prueba no dependa del día en que se corra.
 */
export function rangosRapidos(hoy: Date = new Date()): { label: string; desde: string; hasta: string }[] {
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const hace = (dias: number) => { const d = new Date(hoy); d.setDate(d.getDate() - dias); return iso(d); };
  return [
    { label: 'Este mes',      desde: iso(new Date(y, m, 1)),     hasta: iso(new Date(y, m + 1, 0)) },
    { label: 'Mes pasado',    desde: iso(new Date(y, m - 1, 1)), hasta: iso(new Date(y, m, 0)) },
    { label: 'Últimos 90 días', desde: hace(90),                 hasta: iso(hoy) },
    { label: 'Este año',      desde: `${y}-01-01`,               hasta: `${y}-12-31` },
  ];
}
