/* ============================================================
   MGG · Conciliación (12-11-2026) · solo lectura

   Una fila por OC, con lo que cada módulo sabe de ella:
     · Compras     → código, proveedor, monto, estado.
     · Tesorería   → referencia del pago (últimos 4 dígitos: Bs o Binance)
                     y la tasa: la BCV del DÍA EN QUE SE PAGÓ (sin pagar: la de hoy).
     · Retenciones → qué se retiene (IVA, IGTF, ISLR, ISAE) y el N° de comprobante.
     · Delivery / almacén / Compras → la factura cargada (vista previa).
   Lo único que se edita aquí (12-11-2026): la REFERENCIA de pago (✎) y el
   COMPROBANTE de pago, si Tesorería no lo dejó. Queda en el historial de la OC
   (evento «referencia_conciliacion»); lo de Tesorería no se toca.
   ============================================================ */
import type { EstadoOrden, Orden } from '@/shared/lib/types';
import { statusBadge } from '@/shared/lib/format';
import { retencionesDe } from '@/modules/pedidos/retencionesOc';
import { cruzarDrive, driveDe, pagadoBsTesoreria, type ResultadoDrive } from './conciliacionDrive';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Estados que no son una compra en curso ni hecha: no entran a la conciliación. */
export const ESTADOS_FUERA: EstadoOrden[] = ['cancelada', 'anulada', 'rechazada', 'reasignada', 'desistida_proveedor'];

export type GrupoEstado = 'por_aprobar' | 'esperando_pago' | 'credito' | 'pagada' | 'recibida' | 'finalizada' | 'otro';

/** Estado legible, tal como lo maneja Compras. «Confirmada pagar» = ESPERANDO PAGO. */
export function estadoConciliacion(estado: EstadoOrden | string | null | undefined): { grupo: GrupoEstado; label: string; className: string } {
  switch (estado) {
    case 'oc_creada': return { grupo: 'por_aprobar', label: 'Por aprobar', className: 'warning' };
    case 'confirmada_metodo':
    case 'oc_aprobada': return { grupo: 'esperando_pago', label: 'Esperando pago', className: 'warning' };
    case 'cuenta_abierta': return { grupo: 'credito', label: 'Crédito · por pagar', className: 'warning' };
    case 'pagada':
    case 'por_recibir': return { grupo: 'pagada', label: estado === 'por_recibir' ? 'Pagada · por recibir' : 'Pagada', className: 'info' };
    case 'recibida': return { grupo: 'recibida', label: 'Recibida', className: 'info' };
    case 'finalizada': return { grupo: 'finalizada', label: 'Finalizada', className: 'success' };
    default: { const b = statusBadge(String(estado ?? '')); return { grupo: 'otro', label: b.label, className: b.className }; }
  }
}

export interface ReferenciaPago {
  bs: string | null;
  binance: string | null;
  /** La que se colocó en Conciliación con el lápiz (✎). */
  manual?: string | null;
}

/** Evento del historial con lo que se cargó en Conciliación. */
export const EVENTO_REF_CONCILIACION = 'referencia_conciliacion';

const evsDe = (historial: unknown) => (Array.isArray(historial) ? historial as Array<Record<string, unknown>> : []);
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Lo último que se guardó en Conciliación (referencia y comprobante). */
export function datosConciliacion(historial: unknown): { referencia: string | null; comprobante: { path: string; nombre: string } | null } | null {
  const evs = evsDe(historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== EVENTO_REF_CONCILIACION) continue;
    const path = txt(e.comprobante_path);
    return { referencia: txt(e.referencia), comprobante: path ? { path, nombre: txt(e.comprobante_nombre) ?? 'comprobante' } : null };
  }
  return null;
}

/** La referencia que Tesorería cargó al pagar (traza «pagada»; la última manda) + la de Conciliación. */
export function referenciaDePago(historial: unknown): ReferenciaPago {
  const evs = evsDe(historial);
  const manual = datosConciliacion(historial)?.referencia ?? null;
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== 'pagada') continue;
    const bs = txt(e.referencia_bs);
    const binance = txt(e.binance_orden);
    if (bs || binance) return { bs, binance, manual };
  }
  return { bs: null, binance: null, manual };
}

export const tieneReferencia = (r: ReferenciaPago) => !!(r.bs || r.binance || r.manual);

export function textoReferenciaPago(r: ReferenciaPago): string {
  return [r.bs ? `Bs …${r.bs}` : '', r.binance ? `Binance …${r.binance}` : '', r.manual ? `Ref. ${r.manual}` : ''].filter(Boolean).join(' · ');
}

export interface ComprobantePagoConciliacion {
  path: string;
  nombre: string;
  /** De dónde salió: lo cargó Tesorería al pagar o se cargó en Conciliación. */
  fuente: 'tesoreria' | 'conciliacion';
}

/**
 * El comprobante de pago que se conoce sin mirar el storage: el de Tesorería anotado en
 * el pago (manda) o, si no, el que se cargó en Conciliación.
 */
export function comprobanteDePago(historial: unknown): ComprobantePagoConciliacion | null {
  const evs = evsDe(historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== 'pagada' && e?.evento !== 'pagada_sin_caja') continue;
    const path = txt(e.comprobante_path);
    if (path) return { path, nombre: txt(e.comprobante_nombre) ?? 'comprobante', fuente: 'tesoreria' };
  }
  const c = datosConciliacion(historial)?.comprobante;
  return c ? { ...c, fuente: 'conciliacion' } : null;
}

/** Comprobante de retención del libro fiscal (módulo Retenciones). */
export interface RetencionFiscalOc { tipo: string; numero: string | null }

export interface RetencionConciliacion {
  lleva: boolean;
  /** IVA, IGTF, ISLR, ISAE (de Compras) + los del libro fiscal (IVA, ISLR, MUNICIPAL…). */
  tipos: string[];
  /** N° de comprobante de retención, si ya se emitió. */
  codigos: string[];
  /** ¿Ya se hizo? (certificado cargado, marcada como hecha o en el libro). */
  hecha: boolean;
}

const TIPO_FISCAL: Record<string, string> = { iva: 'IVA', islr: 'ISLR', municipal: 'ISAE', regional: 'REGIONAL', igtf: 'IGTF' };

export function retencionDeOrden(o: Partial<Orden>, fiscales: RetencionFiscalOc[] = []): RetencionConciliacion {
  const tipos = new Set<string>(retencionesDe(o).map((r) => r.tipo));
  for (const f of fiscales) tipos.add(TIPO_FISCAL[f.tipo] ?? f.tipo.toUpperCase());
  if (o.retencion_iva_path) tipos.add('IVA');
  if (o.retencion_islr_path) tipos.add('ISLR');
  if (o.retencion_municipal_path) tipos.add('ISAE');
  const codigos = [...new Set(fiscales.map((f) => f.numero).filter((x): x is string => !!x))];
  const hecha = codigos.length > 0 || !!o.retencion_hecha_en || !!o.retencion_finalizada
    || !!(o.retencion_iva_path || o.retencion_islr_path || o.retencion_municipal_path);
  const lleva = tipos.size > 0 || !!o.retencion_momento;
  const orden = ['IVA', 'IGTF', 'ISLR', 'ISAE'];
  const pos = (t: string) => (orden.includes(t) ? orden.indexOf(t) : orden.length);
  return { lleva, tipos: [...tipos].sort((a, b) => pos(a) - pos(b) || a.localeCompare(b)), codigos, hecha };
}

export type TipoOrdenConciliacion = 'oc' | 'servicio';

/** Orden de servicio (Control de Servicio, código SV-…): misma tabla `ordenes`, clase 'servicio'. */
export const esServicio = (o: Pick<Orden, 'clase'>) => o.clase === 'servicio';

export type MonedaPagoConciliacion = 'Bs' | 'USD' | 'Mixto' | 'Sin pagar';

/**
 * Detecta si la OC fue pagada en Bs o USD ($) según lo que Tesorería registró:
 *   · En Bs (multipago en Bs, referencia_bs o modalidad en Bs) → SÍ SE CRUZA contra el Drive/banco.
 *   · En USD (divisas, Zelle, efectivo, USDT/Binance) → NO SE CRUZA contra cuenta en Bs.
 *   · Sin pagar → no aplica cruce.
 */
export function detectarMonedaPago(o: Partial<Orden>): {
  monedaPago: MonedaPagoConciliacion;
  seCruza: boolean;
  detalle: string;
} {
  const pagado = !!o.pagada_en || (Number(o.abonado_total) || 0) > 0 || ['pagada', 'por_recibir', 'recibida', 'finalizada'].includes(String(o.estado ?? ''));

  if (!pagado) {
    return { monedaPago: 'Sin pagar', seCruza: false, detalle: 'Orden sin pagar aún' };
  }

  const evs = evsDe(o.historial);

  // 1. Revisar los eventos de pago en el historial (el más reciente manda)
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento === 'pagada' || e?.evento === 'abono' || e?.evento === 'credito_saldado' || e?.evento === 'pagada_sin_caja') {
      // a) Multipago
      if (Array.isArray(e.multipago) && e.multipago.length > 0) {
        const legs = e.multipago as Array<Record<string, unknown>>;
        const hasBs = legs.some((l) => /^bs$|^ves$|^bolivares$/i.test(String(l?.moneda ?? '').trim()) && (Number(l?.monto) || 0) > 0);
        const hasUsd = legs.some((l) => /^(usd|usdt|\$|zelle|divisa|divisas|efectivo)$/i.test(String(l?.moneda ?? '').trim()) && (Number(l?.monto) || 0) > 0);
        if (hasBs && hasUsd) {
          return { monedaPago: 'Mixto', seCruza: true, detalle: 'Pago mixto (Bs y Divisas)' };
        }
        if (hasBs) {
          return { monedaPago: 'Bs', seCruza: true, detalle: 'Pagada en Bolívares (Tesorería)' };
        }
        if (hasUsd) {
          return { monedaPago: 'USD', seCruza: false, detalle: 'Pagada en Divisas / USD (no cruza)' };
        }
      }

      // b) Referencia específica cargada por Tesorería
      if (typeof e.referencia_bs === 'string' && e.referencia_bs.trim()) {
        return { monedaPago: 'Bs', seCruza: true, detalle: 'Referencia en Bs indicada por Tesorería' };
      }
      if (typeof e.binance_orden === 'string' && e.binance_orden.trim()) {
        return { monedaPago: 'USD', seCruza: false, detalle: 'Pagada por Binance USDT (no cruza)' };
      }
    }
  }

  // 2. Si hay referencia en Bs en cualquier evento
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (typeof e?.referencia_bs === 'string' && e.referencia_bs.trim()) {
      return { monedaPago: 'Bs', seCruza: true, detalle: 'Referencia en Bs registrada' };
    }
  }

  // 3. Modalidad de pago
  if (o.modalidad_pago === 'bs') {
    return { monedaPago: 'Bs', seCruza: true, detalle: 'Modalidad de pago en Bs' };
  }
  if (o.modalidad_pago === 'usd' || o.pago_en_divisa === true) {
    return { monedaPago: 'USD', seCruza: false, detalle: 'Modalidad de pago en divisas ($)' };
  }

  // 4. Método de pago registrado
  if (Array.isArray(o.metodo_pago) && o.metodo_pago.length > 0) {
    const hasBs = o.metodo_pago.some((m) => /^bs$|^ves$/i.test(String(m?.moneda ?? '').trim()));
    const hasUsd = o.metodo_pago.some((m) => /^(usd|usdt|\$|zelle)$/i.test(String(m?.moneda ?? '').trim()));
    if (hasBs && !hasUsd) return { monedaPago: 'Bs', seCruza: true, detalle: 'Método de pago en Bs' };
    if (hasUsd && !hasBs) return { monedaPago: 'USD', seCruza: false, detalle: 'Método de pago en USD ($)' };
    if (hasBs && hasUsd) return { monedaPago: 'Mixto', seCruza: true, detalle: 'Método mixto' };
  }

  // 5. Moneda base de la orden
  if (String(o.moneda ?? '').toUpperCase() === 'BS' || String(o.total_moneda ?? '').toUpperCase() === 'BS') {
    return { monedaPago: 'Bs', seCruza: true, detalle: 'Orden en Bolívares' };
  }

  // Por defecto en MGG: las órdenes cotizan en USD y si Tesorería no indicó Bs, se liquidan en divisas
  return { monedaPago: 'USD', seCruza: false, detalle: 'Pagada en USD / divisas (no cruza)' };
}

export interface FilaConciliacion {
  id: string;
  item: number;
  /** OC de compra o orden de servicio. */
  tipo: TipoOrdenConciliacion;
  codigo: string;
  sp: string;
  proveedor: string;
  fechaOc: string | null;
  pagadaEn: string | null;
  montoUsd: number;
  montoBs: number | null;
  /** Tasa con la que se pagó (BCV del día de pago) o la de hoy si no se ha pagado. */
  tasa: number | null;
  tasaEsDeHoy: boolean;
  pagado: boolean;
  /** Lo pagado en $ (la OC completa si se pagó; en un crédito, lo abonado). */
  pagadoUsd: number;
  /** Moneda en que Tesorería pagó la OC ('Bs' | 'USD' | 'Mixto' | 'Sin pagar'). */
  monedaPago: MonedaPagoConciliacion;
  /** ¿Tesorería pagó en Bs y por tanto sí se cruza contra el Drive/banco? */
  seCruza: boolean;
  referencia: ReferenciaPago;
  comprobantePago: ComprobantePagoConciliacion | null;
  retencion: RetencionConciliacion;
  facturas: number;
  estado: ReturnType<typeof estadoConciliacion>;
  /** Cruce con el archivo del Drive (null = la OC no se ha cotejado). */
  drive: ResultadoDrive | null;
}

/** Recalcula el DRIVE de la fila con su referencia y monto actuales. */
export function conDrive<T extends Omit<FilaConciliacion, 'drive'>>(f: T, historial: unknown): T & { drive: ResultadoDrive | null } {
  // Solo se van a cruzar las órdenes que estén pagadas por tesorería en el sistema y en Bs
  if (!f.pagado || !f.seCruza) {
    return { ...f, drive: null };
  }
  const datos = driveDe(historial);
  return { ...f, drive: datos ? cruzarDrive(f, datos, pagadoBsTesoreria(historial)) : null };
}

export interface EntradaFila {
  orden: Orden;
  proveedor: string;
  /** Tasa BCV del día de pago (null si no hay registro). */
  tasaPago: number | null;
  tasaHoy: number | null;
  fiscales?: RetencionFiscalOc[];
  facturas?: number;
}

/** Monto de la OC en $: las viejas en Bs se pasan a $ con la tasa que corresponda. */
function totalUsd(o: Orden, tasa: number | null): number {
  const t = Number(o.total) || 0;
  if ((o.moneda ?? 'USD').toUpperCase() !== 'BS') return r2(t);
  return tasa && tasa > 0 ? r2(t / tasa) : 0;
}

export function armarFila(e: EntradaFila, item: number): FilaConciliacion {
  const o = e.orden;
  const diaPago = fechaPagoTesoreria(o);
  const pagado = !!o.pagada_en || !!diaPago;
  const tasa = pagado ? (e.tasaPago ?? null) : (e.tasaHoy ?? null);
  const usd = totalUsd(o, tasa);
  const abonado = Number(o.abonado_total) || 0;
  const pagadoUsd = pagado ? usd : r2(Math.min(abonado, usd));
  const { monedaPago, seCruza } = detectarMonedaPago(o);
  return conDrive({
    id: o.id,
    item,
    tipo: esServicio(o) ? 'servicio' : 'oc',
    codigo: o.oc_codigo ?? o.codigo,
    sp: o.codigo,
    proveedor: e.proveedor || '—',
    fechaOc: o.oc_creada_en ?? o.created_at ?? null,
    pagadaEn: o.pagada_en ?? (diaPago ? `${diaPago}T12:00:00Z` : null),
    montoUsd: usd,
    montoBs: tasa && tasa > 0 ? ((o.moneda ?? 'USD').toUpperCase() === 'BS' ? r2(Number(o.total) || 0) : r2(usd * tasa)) : null,
    tasa,
    tasaEsDeHoy: !pagado,
    pagado: pagado || pagadoUsd > 0,
    pagadoUsd,
    monedaPago,
    seCruza,
    referencia: referenciaDePago(o.historial),
    comprobantePago: comprobanteDePago(o.historial),
    retencion: retencionDeOrden(o, e.fiscales ?? []),
    facturas: e.facturas ?? 0,
    estado: estadoConciliacion(o.estado),
  }, o.historial);
}

export const FECHA_MINIMA_CONCILIACION = '2026-11-01';

/**
 * Fecha en que Tesorería pagó la orden (Venezuela: YYYY-MM-DD).
 * Busca en `pagada_en` o en el evento 'pagada' del historial.
 */
export function fechaPagoTesoreria(o: Partial<Orden>): string | null {
  if (o.pagada_en) {
    const raw = String(o.pagada_en).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      try { return diaCaracas(o.pagada_en); } catch { return raw; }
    }
  }
  const evs = Array.isArray(o.historial) ? (o.historial as unknown as Array<Record<string, unknown>>) : [];
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento === 'pagada') {
      const fecha = typeof e.fecha_pago === 'string' ? e.fecha_pago : (typeof e.at === 'string' ? e.at : null);
      if (fecha) {
        const raw = fecha.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          try { return diaCaracas(fecha); } catch { return raw; }
        }
      }
    }
  }
  return null;
}

export const fechaOrdenConciliable = fechaPagoTesoreria;

/**
 * REGLA ESTRICTA DE CONCILIACIÓN (13-11-2026):
 * Toma SOLO los pagos que se hicieron por Tesorería desde NOVIEMBRE (fecha de pago >= 2026-11-01).
 * Sin canceladas/anuladas.
 * Las más nuevas primero (por fecha de pago).
 */
export function ordenesConciliables(ordenes: Orden[]): Orden[] {
  return ordenes
    .filter((o) => {
      if (!o.oc_codigo && (!esServicio(o) || !o.oc_creada_en)) return false;
      if (ESTADOS_FUERA.includes(o.estado)) return false;
      const diaPago = fechaPagoTesoreria(o);
      if (!diaPago || diaPago < FECHA_MINIMA_CONCILIACION) return false;
      return true;
    })
    .sort((a, b) => {
      const fA = String(a.pagada_en ?? a.oc_creada_en ?? a.created_at ?? '');
      const fB = String(b.pagada_en ?? b.oc_creada_en ?? b.created_at ?? '');
      return fB.localeCompare(fA);
    });
}

export interface Tarjetas {
  /** Todas las órdenes (OC + servicios); `oc` y `servicios` desglosan la cantidad. */
  totalOc: { cantidad: number; oc: number; servicios: number; usd: number; bs: number; ids: string[] };
  pagado: { cantidad: number; usd: number; bs: number; ids: string[] };
  conRetencion: { cantidad: number; usd: number; ids: string[] };
}

export function tarjetas(filas: FilaConciliacion[]): Tarjetas {
  const pagadas = filas.filter((f) => f.pagado);
  const ret = filas.filter((f) => f.retencion.lleva);
  const bsDe = (f: FilaConciliacion, usd: number) => (f.tasa && f.tasa > 0 ? usd * f.tasa : 0);
  return {
    totalOc: {
      cantidad: filas.length, oc: filas.filter((f) => f.tipo === 'oc').length, servicios: filas.filter((f) => f.tipo === 'servicio').length,
      usd: r2(filas.reduce((a, f) => a + f.montoUsd, 0)),
      bs: r2(filas.reduce((a, f) => a + (f.montoBs ?? 0), 0)), ids: filas.map((f) => f.id),
    },
    pagado: {
      cantidad: pagadas.length, usd: r2(pagadas.reduce((a, f) => a + f.pagadoUsd, 0)),
      bs: r2(pagadas.reduce((a, f) => a + bsDe(f, f.pagadoUsd), 0)), ids: pagadas.map((f) => f.id),
    },
    conRetencion: { cantidad: ret.length, usd: r2(ret.reduce((a, f) => a + f.montoUsd, 0)), ids: ret.map((f) => f.id) },
  };
}

/* ───────── Filtros ───────── */
/* Los filtros de lista son de casillas (12-11-2026): se marcan varias opciones;
   ninguna marcada = todas. */
export type FiltroPago = 'pagadas' | 'sin_pagar';
export type FiltroMonedaPago = 'bs' | 'usd' | 'mixto' | 'sin_pagar';
export type FiltroRetencion = 'si' | 'no';
export type FiltroReferencia = 'con' | 'sin';
export type FiltroDrive = 'cuadra' | 'no_cuadra' | 'sin' | 'no_aplica';
export const valorFiltroDrive = (f: Pick<FilaConciliacion, 'drive'> & { seCruza?: boolean; pagado?: boolean }): FiltroDrive => {
  if (f.pagado && f.seCruza === false) return 'no_aplica';
  if (!f.drive) return 'sin';
  return f.drive.estado === 'CUADRA' ? 'cuadra' : 'no_cuadra';
};

export interface FiltrosConciliacion {
  texto?: string;
  /** Vacío = OC y servicios. */
  tipo?: TipoOrdenConciliacion[];
  grupo?: GrupoEstado[];
  retencion?: FiltroRetencion[];
  referencia?: FiltroReferencia[];
  pago?: FiltroPago[];
  /** Moneda en la que se pagó: Bs, USD, mixto o sin pagar. */
  monedaPago?: FiltroMonedaPago[];
  /** DRIVE: cuadra / no cuadra / sin cotejar / no aplica (USD). */
  drive?: FiltroDrive[];
  /** Rango AAAA-MM-DD (día de Venezuela) sobre la fecha que diga `fechaBase`. */
  desde?: string;
  hasta?: string;
  /** 'oc' (por defecto): fecha de creación de la OC · 'pago': fecha en que Tesorería la pagó. */
  fechaBase?: 'oc' | 'pago';
}

/** Día AAAA-MM-DD en hora de Venezuela. */
export function diaCaracas(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** ¿Pasa un filtro de casillas? (ninguna marcada = pasan todas). */
const pasa = <T,>(marcadas: T[] | undefined, valor: T) => !marcadas?.length || marcadas.includes(valor);

/** ¿Hay algún filtro puesto? (las listas vacías no cuentan). */
export const hayFiltrosActivos = (f: FiltrosConciliacion) =>
  Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));

export function filtrar(filas: FilaConciliacion[], f: FiltrosConciliacion): FilaConciliacion[] {
  const q = sinAcentos((f.texto ?? '').trim());
  return filas.filter((x) => {
    if (!pasa(f.tipo, x.tipo)) return false;
    if (!pasa(f.grupo, x.estado.grupo)) return false;
    if (!pasa<FiltroRetencion>(f.retencion, x.retencion.lleva ? 'si' : 'no')) return false;
    if (!pasa<FiltroReferencia>(f.referencia, tieneReferencia(x.referencia) ? 'con' : 'sin')) return false;
    if (!pasa<FiltroPago>(f.pago, x.pagado ? 'pagadas' : 'sin_pagar')) return false;
    if (!pasa<FiltroMonedaPago>(f.monedaPago,
      x.monedaPago === 'Bs' ? 'bs'
      : x.monedaPago === 'USD' ? 'usd'
      : x.monedaPago === 'Mixto' ? 'mixto'
      : 'sin_pagar')) return false;
    if (!pasa<FiltroDrive>(f.drive, valorFiltroDrive(x))) return false;
    if (f.desde || f.hasta) {
      const iso = f.fechaBase === 'pago' ? x.pagadaEn : x.fechaOc;
      if (!iso) { if (f.fechaBase === 'pago') return false; } // sin pagar no entra en un rango por fecha de pago
      else {
        const dia = diaCaracas(iso);
        if (f.desde && dia < f.desde) return false;
        if (f.hasta && dia > f.hasta) return false;
      }
    }
    if (q) {
      const hay = sinAcentos([x.codigo, x.sp, x.proveedor, x.estado.label, x.tipo === 'servicio' ? 'servicio' : 'compra',
        x.monedaPago, x.seCruza ? 'si cruza' : 'no cruza', textoReferenciaPago(x.referencia),
        x.retencion.tipos.join(' '), x.retencion.codigos.join(' '), x.drive?.estado ?? ''].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  }).map((x, i) => ({ ...x, item: i + 1 }));
}

/* ───────── Reporte dinámico: columnas ───────── */
export type ColumnaConciliacion = 'item' | 'codigo' | 'tipo' | 'proveedor' | 'monto_usd' | 'monto_bs' | 'tasa' | 'moneda_pago' | 'se_cruza' | 'referencia' | 'retencion' | 'factura' | 'estado' | 'drive';

export const COLUMNAS_CONCILIACION: { clave: ColumnaConciliacion; label: string; porDefecto: boolean }[] = [
  { clave: 'item', label: 'Ítem', porDefecto: true },
  { clave: 'codigo', label: 'Código', porDefecto: true },
  { clave: 'tipo', label: 'Tipo', porDefecto: true },
  { clave: 'proveedor', label: 'Proveedor', porDefecto: true },
  { clave: 'monto_usd', label: 'Monto $', porDefecto: true },
  { clave: 'monto_bs', label: 'Monto Bs', porDefecto: true },
  { clave: 'tasa', label: 'Tasa', porDefecto: false },
  { clave: 'moneda_pago', label: 'Moneda de pago', porDefecto: true },
  { clave: 'se_cruza', label: '¿Se cruza?', porDefecto: true },
  { clave: 'referencia', label: 'Referencia de pago', porDefecto: true },
  { clave: 'retencion', label: 'Retención', porDefecto: true },
  { clave: 'factura', label: 'Factura', porDefecto: true },
  { clave: 'estado', label: 'Status', porDefecto: true },
  { clave: 'drive', label: 'DRIVE/BANCO', porDefecto: true },
];

const fmt = (n: number, d = 2) => n.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
export const usdTxt = (n: number) => `$${fmt(n)}`;
export const bsTxt = (n: number) => `Bs ${fmt(n)}`;

export function textoRetencion(r: RetencionConciliacion): string {
  if (!r.lleva) return 'No';
  const tipos = r.tipos.length ? r.tipos.join(', ') : 'Sí';
  return r.codigos.length ? `${tipos} · N° ${r.codigos.join(', ')}` : `${tipos}${r.hecha ? '' : ' · pendiente'}`;
}

/** Texto de una celda del reporte. */
export function celda(f: FilaConciliacion, c: ColumnaConciliacion): string {
  switch (c) {
    case 'item': return String(f.item);
    case 'codigo': return f.codigo;
    case 'tipo': return f.tipo === 'servicio' ? 'Servicio' : 'OC';
    case 'proveedor': return f.proveedor;
    case 'monto_usd': return usdTxt(f.montoUsd);
    case 'monto_bs': return f.montoBs != null ? bsTxt(f.montoBs) : '—';
    case 'tasa': return f.tasa ? `${fmt(f.tasa, 4)}${f.tasaEsDeHoy ? ' (hoy)' : ''}` : '—';
    case 'moneda_pago': return f.monedaPago;
    case 'se_cruza': return f.seCruza ? 'Sí (cruza)' : f.monedaPago === 'Sin pagar' ? '—' : 'No (divisas)';
    case 'referencia': return textoReferenciaPago(f.referencia) || '—';
    case 'drive': return f.drive?.estado ?? (f.pagado && !f.seCruza ? 'No aplica (USD)' : '—');
    case 'retencion': return textoRetencion(f.retencion);
    case 'factura': return f.facturas ? `${f.facturas} archivo(s)` : 'Sin factura';
    case 'estado': return f.estado.label;
  }
}

export const TITULO_CONCILIACION = 'CONCILIACIÓN DE ÓRDENES DE COMPRA Y DE SERVICIO';

/** «12 OC · 3 servicios» (solo lo que haya). */
export function desgloseTipos(t: Tarjetas): string {
  const p: string[] = [];
  if (t.totalOc.oc || !t.totalOc.servicios) p.push(`${t.totalOc.oc} OC`);
  if (t.totalOc.servicios) p.push(`${t.totalOc.servicios} servicio${t.totalOc.servicios === 1 ? '' : 's'}`);
  return p.join(' · ');
}

/* ───────── WhatsApp (sin selector U+FE0F en los emojis) ───────── */
export function textoWhatsappConciliacion(filas: FilaConciliacion[], opts: { titulo?: string; filtroTexto?: string; columnas?: ColumnaConciliacion[]; fecha?: string } = {}): string {
  const cols = new Set(opts.columnas ?? COLUMNAS_CONCILIACION.filter((c) => c.porDefecto).map((c) => c.clave));
  const t = tarjetas(filas);
  const L: string[] = [];
  L.push(`📊 *${opts.titulo ?? TITULO_CONCILIACION}*`);
  if (opts.fecha) L.push(`📅 ${opts.fecha}`);
  if (opts.filtroTexto) L.push(`🔎 ${opts.filtroTexto}`);
  L.push('');
  L.push(`🧾 *Total de órdenes:* ${t.totalOc.cantidad} (${desgloseTipos(t)}) · ${usdTxt(t.totalOc.usd)}`);
  L.push(`💵 *Total pagado:* ${t.pagado.cantidad} · ${usdTxt(t.pagado.usd)} · ${bsTxt(t.pagado.bs)}`);
  L.push(`🏛 *Con retención:* ${t.conRetencion.cantidad}`);
  if (!filas.length) { L.push(''); L.push('Sin órdenes para los filtros elegidos.'); }
  for (const f of filas) {
    L.push('');
    const cab = [cols.has('item') ? `${f.item}.` : '', cols.has('tipo') && f.tipo === 'servicio' ? '🔧' : '', cols.has('codigo') ? `*${f.codigo}*` : '',
      cols.has('tipo') && f.tipo === 'servicio' ? '(servicio)' : '', cols.has('proveedor') ? f.proveedor : ''].filter(Boolean).join(' ');
    if (cab) L.push(cab);
    const monto = [cols.has('monto_usd') ? usdTxt(f.montoUsd) : '', cols.has('monto_bs') && f.montoBs != null ? bsTxt(f.montoBs) : '', cols.has('tasa') && f.tasa ? `tasa ${fmt(f.tasa, 2)}${f.tasaEsDeHoy ? ' (hoy)' : ''}` : ''].filter(Boolean).join(' · ');
    if (monto) L.push(`   💰 ${monto}`);
    if (cols.has('moneda_pago')) L.push(`   💵 Pagada en: ${f.monedaPago}`);
    if (cols.has('se_cruza')) L.push(`   🔄 ¿Se cruza con Drive?: ${f.seCruza ? 'Sí (en Bs)' : 'No (divisas)'}`);
    if (cols.has('referencia')) L.push(`   🔢 Ref.: ${textoReferenciaPago(f.referencia) || '—'}`);
    if (cols.has('drive') && f.drive) L.push(`   ${f.drive.estado === 'CUADRA' ? '✅' : '❌'} DRIVE/BANCO: ${f.drive.estado}`);
    if (cols.has('retencion')) L.push(`   🏛 Retención: ${textoRetencion(f.retencion)}`);
    if (cols.has('factura')) L.push(`   🧾 Factura: ${f.facturas ? 'cargada' : 'sin cargar'}`);
    if (cols.has('estado')) L.push(`   📌 ${f.estado.label}`);
  }
  L.push('');
  L.push('🏢 *MINERAL GROUP GUAYANA C.A.*');
  return L.join('\n');
}
