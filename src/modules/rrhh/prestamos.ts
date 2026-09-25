/* ============================================================
   MGG · RRHH · Préstamos y anticipos · cuentas y filtros

   Las cuentas del módulo, sin base de datos y sin pantalla, para poder
   probarlas: cuánto se prestó, cuánto se pagó, cuánto se debe, quién debe, y
   qué queda cuando se filtra por fecha o por cualquier otra cosa.

   POR QUÉ NO SE SUMA `saldo` Y LISTO
   Porque el saldo solo contesta «cuánto falta». El estado de cuenta que firma
   el trabajador tiene que mostrar las tres cifras —prestado, pagado, debe— y
   los abonos uno por uno con su fecha. Eso sale de cruzar los préstamos con
   sus abonos, no de un número suelto.

   POR QUÉ LA FECHA DEL PRÉSTAMO NO ES `created_at`
   Un préstamo viejo se carga hoy: se dio en marzo y se registró en septiembre.
   Filtrar por la fecha de carga metería todo el histórico en el mismo día.
   ============================================================ */

/** Lo mínimo que necesita este módulo de un préstamo. */
export interface PrestamoBase {
  id: string;
  personal_id: string;
  tipo: 'anticipo' | 'prestamo';
  monto_total: number;
  saldo: number;
  estado: 'activo' | 'saldado';
  motivo?: string | null;
  fecha?: string | null;
  created_at?: string;
}

/** Lo mínimo que necesita este módulo de un abono. */
export interface PagoBase {
  id: string;
  anticipo_id: string;
  fecha: string;
  monto: number;
  origen: 'nomina' | 'manual' | 'historico';
  nota?: string | null;
}

const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

/** La fecha que vale para este préstamo: la que se dio, no la que se cargó. */
export function fechaDePrestamo(p: PrestamoBase): string {
  return (p.fecha ?? p.created_at ?? '').slice(0, 10);
}

/* ─────────────────── Abonos ─────────────────── */

/** Los abonos de cada préstamo, agrupados por su id. */
export function pagosPorPrestamo<T extends PagoBase>(pagos: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const p of pagos ?? []) {
    const l = m.get(p.anticipo_id);
    if (l) l.push(p); else m.set(p.anticipo_id, [p]);
  }
  // Del más viejo al más nuevo: un estado de cuenta se lee hacia adelante.
  for (const l of m.values()) l.sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''));
  return m;
}

export function totalPagado(pagos: readonly PagoBase[]): number {
  return n2((pagos ?? []).reduce((a, p) => a + (Number(p.monto) || 0), 0));
}

export const LABEL_ORIGEN: Record<PagoBase['origen'], string> = {
  nomina: 'Nómina',
  manual: 'Abono directo',
  historico: 'Carga histórica',
};

export function labelOrigen(o: string): string {
  return LABEL_ORIGEN[o as PagoBase['origen']] ?? o;
}

/**
 * Qué está mal con un abono. `null` si se puede guardar.
 *
 * `restante` es lo que todavía se debe SIN contar este abono. Pagar de más no
 * se acepta: dejaría el saldo en cero y la diferencia sin rastro, cuando lo
 * que en realidad pasó fue otra cosa (un préstamo nuevo, o un monto mal
 * cargado) y conviene que alguien lo mire.
 */
export function errorPago(monto: unknown, restante: number, fecha?: string | null): string | null {
  const m = Number(monto);
  if (!Number.isFinite(m) || m <= 0) return 'El abono tiene que ser mayor que 0.';
  if (n2(m) > n2(restante) + 0.004) {
    return `El abono es mayor que lo que se debe (${n2(restante).toLocaleString('es-VE', { minimumFractionDigits: 2 })}). Si sobra, cargá un préstamo aparte.`;
  }
  if (fecha && fecha.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
    return 'La fecha del abono no puede ser futura.';
  }
  return null;
}

/* ─────────────── Estado de cuenta ─────────────── */

export interface RenglonEstadoCuenta<P extends PrestamoBase = PrestamoBase, G extends PagoBase = PagoBase> {
  prestamo: P;
  pagos: G[];
  pagado: number;
  debe: number;
}

export interface EstadoCuenta<P extends PrestamoBase = PrestamoBase, G extends PagoBase = PagoBase> {
  personalId: string;
  renglones: RenglonEstadoCuenta<P, G>[];
  /** Σ de lo prestado. */
  total: number;
  /** Σ de lo abonado. */
  pagado: number;
  /** Lo que todavía debe. */
  debe: number;
  /** Cuántos préstamos siguen abiertos. */
  abiertos: number;
}

/**
 * El estado de cuenta de una persona: sus préstamos, sus abonos y las tres
 * cifras. Es lo que sale impreso en el PDF.
 *
 * `debe` se toma del `saldo` de la fila y no de la resta: el saldo lo mantiene
 * la base con un disparador, así que es el número que mandaría si alguna vez
 * los dos no coincidieran.
 */
export function estadoDeCuenta<P extends PrestamoBase, G extends PagoBase>(
  personalId: string,
  prestamos: readonly P[],
  pagos: readonly G[],
): EstadoCuenta<P, G> {
  const porId = pagosPorPrestamo(pagos);
  const mios = (prestamos ?? [])
    .filter((p) => p.personal_id === personalId)
    .sort((a, b) => fechaDePrestamo(b).localeCompare(fechaDePrestamo(a)));
  const renglones = mios.map((prestamo) => {
    const ps = porId.get(prestamo.id) ?? [];
    return { prestamo, pagos: ps, pagado: totalPagado(ps), debe: n2(prestamo.saldo) };
  });
  return {
    personalId,
    renglones,
    total: n2(renglones.reduce((a, r) => a + n2(r.prestamo.monto_total), 0)),
    pagado: n2(renglones.reduce((a, r) => a + r.pagado, 0)),
    debe: n2(renglones.reduce((a, r) => a + r.debe, 0)),
    abiertos: renglones.filter((r) => r.debe > 0).length,
  };
}

/* ─────────────── Resumen de las tarjetas ─────────────── */

export interface ResumenPrestamos {
  /** Lo que la empresa tiene prestado y todavía no volvió. */
  totalPendiente: number;
  /** Cuánta gente tiene algo pendiente. */
  trabajadoresConSaldo: number;
  /** Cuántos préstamos siguen abiertos. */
  prestamosAbiertos: number;
  totalPrestado: number;
  totalPagado: number;
}

export function resumenPrestamos(
  prestamos: readonly PrestamoBase[],
  pagos: readonly PagoBase[] = [],
): ResumenPrestamos {
  const lista = prestamos ?? [];
  const conSaldo = lista.filter((p) => n2(p.saldo) > 0);
  return {
    totalPendiente: n2(conSaldo.reduce((a, p) => a + n2(p.saldo), 0)),
    trabajadoresConSaldo: new Set(conSaldo.map((p) => p.personal_id)).size,
    prestamosAbiertos: conSaldo.length,
    totalPrestado: n2(lista.reduce((a, p) => a + n2(p.monto_total), 0)),
    // Solo los abonos de los préstamos que se están mirando: si no, al
    // filtrar por un mes la tarjeta de pagado seguiría mostrando todo.
    totalPagado: totalPagado((pagos ?? []).filter((g) => lista.some((p) => p.id === g.anticipo_id))),
  };
}

/* ─────────────── Agrupado por trabajador ─────────────── */

export interface DeudaTrabajador {
  personalId: string;
  nombre: string;
  prestamos: PrestamoBase[];
  total: number;
  pagado: number;
  debe: number;
  abiertos: number;
  /** El préstamo más viejo que sigue abierto. Ordena la lista de morosos. */
  desde: string;
}

/**
 * Cuánto debe cada uno, de mayor a menor.
 *
 * Ordenado por lo que debe y no por nombre: la lista se abre para ver a quién
 * hay que cobrarle, y el que más debe es el que primero hay que mirar.
 */
export function deudaPorTrabajador(
  prestamos: readonly PrestamoBase[],
  pagos: readonly PagoBase[],
  nombreDe: (id: string) => string,
): DeudaTrabajador[] {
  const porId = pagosPorPrestamo(pagos);
  const grupos = new Map<string, PrestamoBase[]>();
  for (const p of prestamos ?? []) {
    const l = grupos.get(p.personal_id);
    if (l) l.push(p); else grupos.set(p.personal_id, [p]);
  }
  return [...grupos.entries()]
    .map(([personalId, ps]) => {
      const abiertos = ps.filter((p) => n2(p.saldo) > 0);
      const fechas = (abiertos.length ? abiertos : ps).map(fechaDePrestamo).filter(Boolean).sort();
      return {
        personalId,
        nombre: nombreDe(personalId),
        prestamos: [...ps].sort((a, b) => fechaDePrestamo(b).localeCompare(fechaDePrestamo(a))),
        total: n2(ps.reduce((a, p) => a + n2(p.monto_total), 0)),
        pagado: n2(ps.reduce((a, p) => a + totalPagado(porId.get(p.id) ?? []), 0)),
        debe: n2(ps.reduce((a, p) => a + n2(p.saldo), 0)),
        abiertos: abiertos.length,
        desde: fechas[0] ?? '',
      };
    })
    .sort((a, b) => (b.debe - a.debe) || a.nombre.localeCompare(b.nombre, 'es'));
}

/* ─────────────── Filtros ─────────────── */

export type EstadoPrestamoFiltro = 'todos' | 'activos' | 'saldados';
export type TipoPrestamoFiltro = '' | 'anticipo' | 'prestamo';

export interface FiltroPrestamos {
  /** Busca en el nombre del trabajador y en el motivo. */
  texto?: string;
  trabajadorId?: string;
  tipo?: TipoPrestamoFiltro;
  estado?: EstadoPrestamoFiltro;
  /** Rango por la fecha en que se DIO el préstamo (inclusive los dos extremos). */
  desde?: string;
  hasta?: string;
  /** Rango por el monto prestado. */
  montoMin?: number | null;
  montoMax?: number | null;
  /** Rango por lo que todavía se debe. */
  saldoMin?: number | null;
  /** Solo los que se cargaron como histórico. */
  soloHistoricos?: boolean;
}

export const FILTRO_PRESTAMOS_VACIO: FiltroPrestamos = {
  texto: '', trabajadorId: '', tipo: '', estado: 'todos',
  desde: '', hasta: '', montoMin: null, montoMax: null, saldoMin: null, soloHistoricos: false,
};

/** ¿Hay algún filtro puesto? Para poder ofrecer «limpiar». */
export function hayFiltro(f: FiltroPrestamos): boolean {
  return !!(f.texto?.trim() || f.trabajadorId || f.tipo || (f.estado && f.estado !== 'todos')
    || f.desde || f.hasta || f.montoMin != null || f.montoMax != null || f.saldoMin != null
    || f.soloHistoricos);
}

/**
 * Aplica todos los filtros. `nombreDe` se recibe de afuera porque el nombre
 * vive en otra tabla y este módulo no habla con la base.
 *
 * Un préstamo se considera HISTÓRICO cuando la fecha en que se dio es anterior
 * al día en que se cargó: es exactamente lo que significa cargarlo a mano
 * después de que pasó.
 */
export function filtrarPrestamos<T extends PrestamoBase>(
  lista: readonly T[],
  f: FiltroPrestamos,
  nombreDe: (id: string) => string = () => '',
): T[] {
  const q = (f.texto ?? '').trim().toLowerCase();
  return (lista ?? []).filter((p) => {
    if (f.trabajadorId && p.personal_id !== f.trabajadorId) return false;
    if (f.tipo && p.tipo !== f.tipo) return false;
    if (f.estado === 'activos' && n2(p.saldo) <= 0) return false;
    if (f.estado === 'saldados' && n2(p.saldo) > 0) return false;
    const fecha = fechaDePrestamo(p);
    if (f.desde && (!fecha || fecha < f.desde)) return false;
    if (f.hasta && (!fecha || fecha > f.hasta)) return false;
    if (f.montoMin != null && n2(p.monto_total) < f.montoMin) return false;
    if (f.montoMax != null && n2(p.monto_total) > f.montoMax) return false;
    if (f.saldoMin != null && n2(p.saldo) < f.saldoMin) return false;
    if (f.soloHistoricos && !esHistorico(p)) return false;
    if (q) {
      const hay = `${nombreDe(p.personal_id)} ${p.motivo ?? ''} ${p.tipo}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Se dio antes del día en que se cargó: es una carga histórica. */
export function esHistorico(p: PrestamoBase): boolean {
  const dado = fechaDePrestamo(p);
  const cargado = (p.created_at ?? '').slice(0, 10);
  return !!dado && !!cargado && dado < cargado;
}

/** Los abonos que caen dentro del rango de fechas del filtro. */
export function filtrarPagos(pagos: readonly PagoBase[], f: FiltroPrestamos): PagoBase[] {
  return (pagos ?? []).filter((p) => {
    const d = (p.fecha ?? '').slice(0, 10);
    if (f.desde && (!d || d < f.desde)) return false;
    if (f.hasta && (!d || d > f.hasta)) return false;
    return true;
  });
}

/* ─────────────── Rangos rápidos ─────────────── */

export interface RangoRapido { key: string; label: string; desde: string; hasta: string }

/**
 * Los rangos que se piden siempre, ya calculados. Escribir dos fechas a mano
 * para ver «este mes» es pedirle al usuario que haga la cuenta del calendario.
 */
export function rangosRapidos(hoyIso: string = new Date().toISOString().slice(0, 10)): RangoRapido[] {
  const hoy = new Date(`${hoyIso}T00:00:00`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const primero = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 1)));
  const ultimo = (y: number, m: number) => iso(new Date(Date.UTC(y, m + 1, 0)));
  const y = hoy.getFullYear(); const m = hoy.getMonth();
  const hace = (dias: number) => { const d = new Date(hoy); d.setDate(d.getDate() - dias); return iso(d); };
  return [
    { key: 'mes', label: 'Este mes', desde: primero(y, m), hasta: ultimo(y, m) },
    { key: 'mes_ant', label: 'Mes pasado', desde: primero(y, m - 1), hasta: ultimo(y, m - 1) },
    { key: 'trim', label: 'Últimos 90 días', desde: hace(90), hasta: hoyIso },
    { key: 'anio', label: 'Este año', desde: `${y}-01-01`, hasta: `${y}-12-31` },
  ];
}
