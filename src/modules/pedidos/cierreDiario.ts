/* ============================================================
   MGG · Compras · Cierre diario (lógica pura) · 21-10-2026
   Resumen de CUATRO cantidades, filtrable por día, semana, mes o rango de fechas:
     · Total de pedidos                     → solicitudes CREADAS en el período.
     · Total órdenes pendientes por aprobar → OC en «Pendiente por aprobación» que
                                              ENTRARON ahí en el período y siguen ahí.
     · Total órdenes por pagar              → OC confirmadas (por indicar método o ya
                                              en Tesorería) que ENTRARON a pago en el
                                              período y siguen sin pagarse.
     · Total órdenes pagadas                → OC PAGADAS en el período.
   Así «HOY» muestra lo de hoy y nada más; «semana» y «mes» igual, sucesivamente.
   Las fechas se leen en horario de Venezuela (America/Caracas, UTC−4 sin horario de
   verano): una orden de las 9 p. m. del 20 no cuenta como del 21.
   Son órdenes de compra y servicios; las compras y servicios DIRECTOS no entran.
   ============================================================ */

export type ModoCierre = 'dia' | 'semana' | 'mes' | 'rango';

export interface FiltroCierre {
  modo: ModoCierre;
  /** Día (modo «dia») o un día cualquiera de la semana (modo «semana»), YYYY-MM-DD. */
  dia: string;
  /** Mes (modo «mes»), YYYY-MM. */
  mes: string;
  /** Rango personalizado (modo «rango»), YYYY-MM-DD. */
  desde: string;
  hasta: string;
}

export interface RangoCierre {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD (incluido)
  /** Cómo se lee en pantalla, PDF, Excel y WhatsApp. */
  etiqueta: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TZ = 'America/Caracas';
/** Venezuela está en UTC−4 todo el año: la medianoche de Caracas es 04:00 UTC. */
const OFFSET_HORAS = 4;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha (YYYY-MM-DD) de un instante, en horario de Venezuela. null si no hay fecha válida. */
export function fechaVE(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** Hoy (YYYY-MM-DD) en horario de Venezuela. */
export function hoyVE(): string {
  return fechaVE(new Date().toISOString()) as string;
}

const esYmd = (s: string | null | undefined): s is string => !!s && YMD.test(s);

function aUtc(ymd: string): Date {
  const m = YMD.exec(ymd) as RegExpExecArray;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
const deUtc = (d: Date): string => d.toISOString().slice(0, 10);
export function sumarDias(ymd: string, n: number): string {
  const d = aUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return deUtc(d);
}

/** 21/10/2026 */
export function fechaCorta(ymd: string): string {
  const m = YMD.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}

/**
 * El rango que dice el filtro. Semana = de lunes a domingo. Si falta un dato se usa HOY
 * (un campo vacío no deja la pantalla en blanco); un rango al revés se endereza.
 */
export function rangoCierre(f: FiltroCierre, hoy: string = hoyVE()): RangoCierre {
  if (f.modo === 'semana') {
    const base = esYmd(f.dia) ? f.dia : hoy;
    const dow = (aUtc(base).getUTCDay() + 6) % 7; // 0 = lunes
    const desde = sumarDias(base, -dow);
    const hasta = sumarDias(desde, 6);
    return { desde, hasta, etiqueta: `Semana del ${fechaCorta(desde)} al ${fechaCorta(hasta)}` };
  }
  if (f.modo === 'mes') {
    const m = /^(\d{4})-(\d{2})$/.exec(f.mes ?? '');
    const ym = m ? { y: Number(m[1]), mo: Number(m[2]) } : { y: Number(hoy.slice(0, 4)), mo: Number(hoy.slice(5, 7)) };
    const ultimo = new Date(Date.UTC(ym.y, ym.mo, 0)).getUTCDate();
    const pref = `${String(ym.y).padStart(4, '0')}-${String(ym.mo).padStart(2, '0')}`;
    const desde = `${pref}-01`;
    const hasta = `${pref}-${String(ultimo).padStart(2, '0')}`;
    const nombre = `${MESES[ym.mo - 1].charAt(0).toUpperCase()}${MESES[ym.mo - 1].slice(1)} ${ym.y}`;
    return { desde, hasta, etiqueta: `${nombre} (${fechaCorta(desde)} al ${fechaCorta(hasta)})` };
  }
  if (f.modo === 'rango') {
    let a = esYmd(f.desde) ? f.desde : esYmd(f.hasta) ? f.hasta : hoy;
    let b = esYmd(f.hasta) ? f.hasta : a;
    if (a > b) [a, b] = [b, a];
    return { desde: a, hasta: b, etiqueta: a === b ? `Día ${fechaCorta(a)}` : `Del ${fechaCorta(a)} al ${fechaCorta(b)}` };
  }
  const dia = esYmd(f.dia) ? f.dia : hoy;
  return { desde: dia, hasta: dia, etiqueta: dia === hoy ? `Hoy · ${fechaCorta(dia)}` : `Día ${fechaCorta(dia)}` };
}

/** Los instantes (UTC) en que empieza y termina el rango, para filtrar en la base. */
export function limitesISO(r: Pick<RangoCierre, 'desde' | 'hasta'>): { inicio: string; fin: string } {
  const inicio = new Date(aUtc(r.desde).getTime() + OFFSET_HORAS * 3600_000);
  const fin = new Date(aUtc(sumarDias(r.hasta, 1)).getTime() + OFFSET_HORAS * 3600_000 - 1);
  return { inicio: inicio.toISOString(), fin: fin.toISOString() };
}

/** ¿El instante cae dentro del rango (por día de Venezuela)? Sin fecha no cuenta. */
export function enRango(iso: string | null | undefined, r: Pick<RangoCierre, 'desde' | 'hasta'>): boolean {
  const f = fechaVE(iso);
  return !!f && f >= r.desde && f <= r.hasta;
}

export type ClaveCierre = 'pedidos' | 'pendientes_aprobar' | 'por_pagar' | 'pagadas';

export interface ItemCierre {
  key: ClaveCierre;
  titulo: string;
  /** Sin el selector U+FE0F: va en el mensaje de WhatsApp (ver comprasReporteMensaje.ts). */
  emoji: string;
  cantidad: number;
}

/** Los títulos, en el orden pedido. */
export const ITEMS_CIERRE: { key: ClaveCierre; titulo: string; emoji: string; ayuda: string }[] = [
  { key: 'pedidos', titulo: 'Total de pedidos', emoji: '📋', ayuda: 'Solicitudes creadas en el período' },
  { key: 'pendientes_aprobar', titulo: 'Total órdenes pendientes por aprobar', emoji: '⏳', ayuda: 'Pendientes del Gerente General que entraron en el período' },
  { key: 'por_pagar', titulo: 'Total órdenes por pagar', emoji: '💰', ayuda: 'Confirmadas en el período que siguen sin pagarse' },
  { key: 'pagadas', titulo: 'Total órdenes pagadas', emoji: '✅', ayuda: 'Pagadas en el período' },
];

export interface ResumenCierre {
  rango: RangoCierre;
  items: ItemCierre[];
}

export interface EntradasCierre {
  /** Solicitudes creadas en el rango (ya contadas por la base). */
  pedidos: number;
  /** Órdenes pagadas en el rango (ya contadas por la base). */
  pagadas: number;
  /** Fecha (ISO) en que cada orden pendiente de aprobar entró a ese estado. */
  pendientesAprobar: (string | null | undefined)[];
  /** Fecha (ISO) en que cada orden por pagar entró a pago. */
  porPagar: (string | null | undefined)[];
}

export function armarCierre(e: EntradasCierre, rango: RangoCierre): ResumenCierre {
  const cantidad: Record<ClaveCierre, number> = {
    pedidos: Math.max(0, Math.trunc(Number(e.pedidos) || 0)),
    pendientes_aprobar: e.pendientesAprobar.filter((f) => enRango(f, rango)).length,
    por_pagar: e.porPagar.filter((f) => enRango(f, rango)).length,
    pagadas: Math.max(0, Math.trunc(Number(e.pagadas) || 0)),
  };
  return { rango, items: ITEMS_CIERRE.map(({ key, titulo, emoji }) => ({ key, titulo, emoji, cantidad: cantidad[key] })) };
}

/** Lo mínimo de una orden para saber cuándo entró a su estado actual. */
export interface OrdenFechas {
  estado?: string | null;
  created_at?: string | null;
  oc_creada_en?: string | null;
  oc_aprobada_en?: string | null;
  metodo_pago_en?: string | null;
  historial?: { at?: string; evento?: string }[] | null;
}

/** Cuándo entró a «Pendiente por aprobación»: cuando se creó la OC (la oferta elegida). */
export function fechaEntradaAprobacion(o: OrdenFechas): string | null {
  return o.oc_creada_en ?? o.created_at ?? null;
}

/**
 * Cuándo entró a «por pagar». Confirmada y sin método: cuando la confirmó el Gerente. Ya enviada a
 * pagar: la ÚLTIMA vez que se indicó el método (si la OC volvió a cotizarse, cuenta la nueva), y no
 * la fecha de una corrección posterior del método, que no la saca ni la devuelve a la cola.
 */
export function fechaEntradaPago(o: OrdenFechas): string | null {
  if (o.estado === 'oc_aprobada') {
    const evs = (o.historial ?? []).filter((h) => h?.evento === 'metodo_pago' && h.at);
    const ultimo = evs.length ? evs[evs.length - 1].at : null;
    return ultimo ?? o.metodo_pago_en ?? o.oc_aprobada_en ?? o.created_at ?? null;
  }
  return o.oc_aprobada_en ?? o.created_at ?? null;
}
