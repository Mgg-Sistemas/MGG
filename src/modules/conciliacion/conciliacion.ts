/* ============================================================
   MGG · Conciliación (12-11-2026) · solo lectura

   Una fila por OC, con lo que cada módulo sabe de ella:
     · Compras     → código, proveedor, monto, estado.
     · Tesorería   → referencia del pago (últimos 4 dígitos: Bs o Binance)
                     y la tasa: la BCV del DÍA EN QUE SE PAGÓ (sin pagar: la de hoy).
     · Retenciones → qué se retiene (IVA, IGTF, ISLR, ISAE) y el N° de comprobante.
     · Delivery / almacén → la factura cargada (vista previa).
   Nada se edita aquí: tocar una OC la abre en su módulo.
   ============================================================ */
import type { EstadoOrden, Orden } from '@/shared/lib/types';
import { statusBadge } from '@/shared/lib/format';
import { retencionesDe } from '@/modules/pedidos/retencionesOc';

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

export interface ReferenciaPago { bs: string | null; binance: string | null }

/** La referencia que Tesorería cargó al pagar (traza «pagada»). La última manda. */
export function referenciaDePago(historial: unknown): ReferenciaPago {
  const evs = Array.isArray(historial) ? historial as Array<Record<string, unknown>> : [];
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== 'pagada') continue;
    const bs = typeof e.referencia_bs === 'string' && e.referencia_bs ? e.referencia_bs : null;
    const binance = typeof e.binance_orden === 'string' && e.binance_orden ? e.binance_orden : null;
    if (bs || binance) return { bs, binance };
  }
  return { bs: null, binance: null };
}

export function textoReferenciaPago(r: ReferenciaPago): string {
  return [r.bs ? `Bs …${r.bs}` : '', r.binance ? `Binance …${r.binance}` : ''].filter(Boolean).join(' · ');
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
  referencia: ReferenciaPago;
  retencion: RetencionConciliacion;
  facturas: number;
  estado: ReturnType<typeof estadoConciliacion>;
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
  const pagado = !!o.pagada_en;
  const tasa = pagado ? (e.tasaPago ?? null) : (e.tasaHoy ?? null);
  const usd = totalUsd(o, tasa);
  const abonado = Number(o.abonado_total) || 0;
  const pagadoUsd = pagado ? usd : r2(Math.min(abonado, usd));
  return {
    id: o.id,
    item,
    tipo: esServicio(o) ? 'servicio' : 'oc',
    codigo: o.oc_codigo ?? o.codigo,
    sp: o.codigo,
    proveedor: e.proveedor || '—',
    fechaOc: o.oc_creada_en ?? o.created_at ?? null,
    pagadaEn: o.pagada_en ?? null,
    montoUsd: usd,
    montoBs: tasa && tasa > 0 ? ((o.moneda ?? 'USD').toUpperCase() === 'BS' ? r2(Number(o.total) || 0) : r2(usd * tasa)) : null,
    tasa,
    tasaEsDeHoy: !pagado,
    pagado: pagado || pagadoUsd > 0,
    pagadoUsd,
    referencia: referenciaDePago(o.historial),
    retencion: retencionDeOrden(o, e.fiscales ?? []),
    facturas: e.facturas ?? 0,
    estado: estadoConciliacion(o.estado),
  };
}

/**
 * Las que entran: las OC (con código de OC) y las órdenes de servicio que ya pasaron a
 * Control de Servicio (oc_creada_en; casi nunca llevan código de OC, se ven con su SV-…).
 * Sin canceladas/anuladas. Las más nuevas primero.
 */
export function ordenesConciliables(ordenes: Orden[]): Orden[] {
  return ordenes
    .filter((o) => (!!o.oc_codigo || (esServicio(o) && !!o.oc_creada_en)) && !ESTADOS_FUERA.includes(o.estado))
    .sort((a, b) => String(b.oc_creada_en ?? b.created_at ?? '').localeCompare(String(a.oc_creada_en ?? a.created_at ?? '')));
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
export interface FiltrosConciliacion {
  texto?: string;
  /** '' = OC y servicios. */
  tipo?: '' | TipoOrdenConciliacion;
  grupo?: GrupoEstado | '';
  retencion?: '' | 'si' | 'no';
  referencia?: '' | 'con' | 'sin';
  pago?: '' | 'pagadas' | 'sin_pagar';
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

export function filtrar(filas: FilaConciliacion[], f: FiltrosConciliacion): FilaConciliacion[] {
  const q = sinAcentos((f.texto ?? '').trim());
  return filas.filter((x) => {
    if (f.tipo && x.tipo !== f.tipo) return false;
    if (f.grupo && x.estado.grupo !== f.grupo) return false;
    if (f.retencion === 'si' && !x.retencion.lleva) return false;
    if (f.retencion === 'no' && x.retencion.lleva) return false;
    const tieneRef = !!(x.referencia.bs || x.referencia.binance);
    if (f.referencia === 'con' && !tieneRef) return false;
    if (f.referencia === 'sin' && tieneRef) return false;
    if (f.pago === 'pagadas' && !x.pagado) return false;
    if (f.pago === 'sin_pagar' && x.pagado) return false;
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
      const hay = sinAcentos([x.codigo, x.sp, x.proveedor, x.estado.label, x.tipo === 'servicio' ? 'servicio' : 'compra', textoReferenciaPago(x.referencia),
        x.retencion.tipos.join(' '), x.retencion.codigos.join(' ')].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  }).map((x, i) => ({ ...x, item: i + 1 }));
}

/* ───────── Reporte dinámico: columnas ───────── */
export type ColumnaConciliacion = 'item' | 'codigo' | 'tipo' | 'proveedor' | 'monto_usd' | 'monto_bs' | 'tasa' | 'referencia' | 'retencion' | 'factura' | 'estado';

export const COLUMNAS_CONCILIACION: { clave: ColumnaConciliacion; label: string; porDefecto: boolean }[] = [
  { clave: 'item', label: 'Ítem', porDefecto: true },
  { clave: 'codigo', label: 'Código', porDefecto: true },
  { clave: 'tipo', label: 'Tipo', porDefecto: true },
  { clave: 'proveedor', label: 'Proveedor', porDefecto: true },
  { clave: 'monto_usd', label: 'Monto $', porDefecto: true },
  { clave: 'monto_bs', label: 'Monto Bs', porDefecto: true },
  { clave: 'tasa', label: 'Tasa', porDefecto: false },
  { clave: 'referencia', label: 'Referencia de pago', porDefecto: true },
  { clave: 'retencion', label: 'Retención', porDefecto: true },
  { clave: 'factura', label: 'Factura', porDefecto: true },
  { clave: 'estado', label: 'Status', porDefecto: true },
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
    case 'referencia': return textoReferenciaPago(f.referencia) || '—';
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
    if (cols.has('referencia')) L.push(`   🔢 Ref.: ${textoReferenciaPago(f.referencia) || '—'}`);
    if (cols.has('retencion')) L.push(`   🏛 Retención: ${textoRetencion(f.retencion)}`);
    if (cols.has('factura')) L.push(`   🧾 Factura: ${f.facturas ? 'cargada' : 'sin cargar'}`);
    if (cols.has('estado')) L.push(`   📌 ${f.estado.label}`);
  }
  L.push('');
  L.push('🏢 *MINERAL GROUP GUAYANA C.A.*');
  return L.join('\n');
}
