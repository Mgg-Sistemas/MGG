/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Tablero como el de Compras (10/11/2026)

   Adaptado de La Cantera. Una tarjeta por venta, en su etapa:

     Cotización → Despacho por aprobar → Despachada · por cobrar
                → Facturada · por cobrar → Cobrada      (y Anuladas · no aprobadas)

   La etapa NO se guarda: sale del estado de la venta y de lo cobrado.
     borrador                        → Cotización
     por_autorizar                   → Despacho por aprobar
     (autorizada / confirmada: ventas a medio camino del flujo viejo → por aprobar)
     entregada sin factura, con saldo → Despachada · por cobrar
     entregada con factura, con saldo → Facturada · por cobrar
     entregada sin saldo              → Cobrada
     anulada                          → Anuladas · no aprobadas

   Lógica pura (sin Supabase ni React): la prueban los tests.
   ============================================================ */
import { round2 } from './ventasCalculos';
import { sumaPagoLegs, type MotivoNoDespacho, type Venta, type VentaRenglon } from './ventas.repository';

export type EtapaVenta = 'cot' | 'aprobar' | 'despachada' | 'facturada' | 'cobrada' | 'anulada';
export type TonoVenta = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

export const COLUMNAS_VENTAS: { etapa: EtapaVenta; titulo: string; ayuda: string; estadoCss: string }[] = [
  { etapa: 'cot', titulo: 'Cotizaciones', ayuda: 'Enviadas al cliente', estadoCss: 'recibida' },
  { etapa: 'aprobar', titulo: 'Despacho por aprobar', ayuda: 'Se pidió despachar', estadoCss: 'pendiente' },
  { etapa: 'despachada', titulo: 'Despachada · por cobrar', ayuda: 'Salió con su nota de entrega', estadoCss: 'por_retirar' },
  { etapa: 'facturada', titulo: 'Facturada · por cobrar', ayuda: 'Con número de control', estadoCss: 'por_retirar' },
  { etapa: 'cobrada', titulo: 'Cobrada', ayuda: 'Venta finalizada', estadoCss: 'pagada' },
  { etapa: 'anulada', titulo: 'Anuladas · no aprobadas', ayuda: 'Con su motivo', estadoCss: 'anulada' },
];

export const TITULO_ETAPA: Record<EtapaVenta, string> = Object.fromEntries(
  COLUMNAS_VENTAS.map((c) => [c.etapa, c.titulo]),
) as Record<EtapaVenta, string>;

/** Una cotización vale 15 días desde que se hizo. */
export const VALIDEZ_COTIZACION_DIAS = 15;
/** Tarjetas por columna; el resto, en el histórico. */
export const TOPE_POR_COLUMNA = 10;

export const MOTIVO_NO_DESPACHO: Record<MotivoNoDespacho, { icono: string; largo: string; corto: string }> = {
  deuda_vencida: { icono: '⏳', largo: 'Cliente con deuda vencida', corto: 'Deuda vencida' },
  sin_cupo: { icono: '💳', largo: 'Cliente sin cupo de crédito', corto: 'Sin cupo' },
  sin_existencia: { icono: '📦', largo: 'No hay existencia en el inventario', corto: 'Sin existencia' },
  otro: { icono: '📝', largo: 'Otro', corto: 'No aprobado' },
};

/** Prefijo con el que la base guarda el motivo de un despacho que NO PROCEDE. */
export const PREFIJO_NO_PROCEDE = 'NO PROCEDE:';

export interface TarjetaVenta {
  venta: Venta;
  etapa: EtapaVenta;
  /** Lo cobrado: patas de pago al despachar + cobros registrados a la venta. */
  cobrado: number;
  /** Lo que falta cobrar (nunca negativo). */
  saldo: number;
  /** Tiene saldo y ya pasó la fecha acordada de pago. */
  vencida: boolean;
  /** «PRODUCTO · 2 UND · OTRO · 4 KG». */
  resumen: string;
}

/** Hoy en aaaa-mm-dd, hora local. */
export function hoyIso(ahora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
}

/** dd/mm/aaaa de un ISO (fecha o fecha-hora), sin depender de la zona horaria. */
export function fechaCorta(iso: string | null | undefined): string {
  const [a, m, d] = (iso || '').slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : '—';
}

/** aaaa-mm-dd + n días. */
export function sumarDias(isoFecha: string, dias: number): string {
  const [a, m, d] = isoFecha.slice(0, 10).split('-').map(Number);
  const f = new Date(a, (m || 1) - 1, d || 1);
  f.setDate(f.getDate() + dias);
  return hoyIso(f);
}

/** Hasta cuándo vale la cotización (aaaa-mm-dd). */
export function validaHasta(v: Pick<Venta, 'created_at'>): string {
  return sumarDias((v.created_at || hoyIso()).slice(0, 10), VALIDEZ_COTIZACION_DIAS);
}

export function cobradoDe(v: Pick<Venta, 'pago_legs'>, cobradoAbonos = 0): number {
  return round2(sumaPagoLegs(v.pago_legs) + (Number(cobradoAbonos) || 0));
}

export function tieneFactura(v: Pick<Venta, 'documento' | 'numero_control' | 'facturada_at'>): boolean {
  return !!v.facturada_at || (v.documento === 'factura' && !!(v.numero_control ?? '').trim());
}

export function esNoProcede(v: Pick<Venta, 'motivo_anulacion'>): boolean {
  return (v.motivo_anulacion ?? '').trim().toUpperCase().startsWith(PREFIJO_NO_PROCEDE);
}

export function etapaDe(v: Venta, cobrado: number): EtapaVenta {
  switch (v.estado) {
    case 'anulada': return 'anulada';
    case 'borrador': return 'cot';
    case 'por_autorizar':
    case 'autorizada':
    case 'confirmada':
      return 'aprobar';
    case 'entregada': {
      const saldo = round2((Number(v.diferencia) || 0) - cobrado);
      if (saldo <= 0.01) return 'cobrada';
      return tieneFactura(v) ? 'facturada' : 'despachada';
    }
    default: return 'cot';
  }
}

export function resumenProductos(renglones: Pick<VentaRenglon, 'producto_nombre' | 'producto_sku' | 'cantidad' | 'unidad'>[]): string {
  return renglones
    .map((r) => {
      const nombre = (r.producto_nombre || r.producto_sku || 'PRODUCTO').trim().toUpperCase();
      const cant = (Number(r.cantidad) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 });
      return `${nombre} · ${cant}${r.unidad ? ` ${r.unidad.toUpperCase()}` : ''}`;
    })
    .join(' · ');
}

export function armarTarjeta(
  v: Venta, renglones: VentaRenglon[], cobradoAbonos = 0, hoy: string = hoyIso(),
): TarjetaVenta {
  const cobrado = cobradoDe(v, cobradoAbonos);
  const etapa = etapaDe(v, cobrado);
  const saldo = Math.max(0, round2((Number(v.diferencia) || 0) - cobrado));
  const porCobrar = etapa === 'despachada' || etapa === 'facturada';
  const vencida = porCobrar && saldo > 0.01 && !!v.cobrar_el && v.cobrar_el.slice(0, 10) < hoy;
  return { venta: v, etapa, cobrado, saldo, vencida, resumen: resumenProductos(renglones) };
}

export interface ChipVenta { texto: string; tono: TonoVenta; titulo?: string }

export function chipsDe(t: TarjetaVenta, hoy: string = hoyIso()): ChipVenta[] {
  const v = t.venta;
  const out: ChipVenta[] = [];
  const sinCliente = !(v.cliente_nombre ?? '').trim();
  if (t.etapa === 'cot') {
    const hasta = validaHasta(v);
    out.push(hasta < hoy
      ? { texto: 'Cotización vencida', tono: 'danger' }
      : { texto: `Válida hasta ${fechaCorta(hasta).slice(0, 5)}`, tono: 'neutral' });
    if (v.rechazo_motivo) out.push({ texto: 'Devuelta', tono: 'warning', titulo: v.rechazo_motivo });
  }
  if (t.etapa === 'aprobar') {
    if (v.estado === 'autorizada') out.push({ texto: 'Aprobada · falta despachar', tono: 'info' });
    if (v.estado === 'confirmada') out.push({ texto: 'Falta sacar el material', tono: 'info' });
    if (v.no_despacho_motivo) {
      const m = MOTIVO_NO_DESPACHO[v.no_despacho_motivo];
      const titulo = `${m.largo}${v.no_despacho_detalle ? `: ${v.no_despacho_detalle}` : ''}`;
      out.push({ texto: `${m.icono} ${m.corto}`, tono: 'warning', titulo });
    }
  }
  if ((t.etapa === 'cot' || t.etapa === 'aprobar') && sinCliente) out.push({ texto: 'Falta cliente', tono: 'warning' });
  if (v.documento === 'factura' && (t.etapa === 'cot' || t.etapa === 'aprobar')) out.push({ texto: 'Con factura', tono: 'info' });
  if (t.etapa === 'despachada' || t.etapa === 'facturada') {
    if (v.condicion === 'credito') out.push({ texto: 'Crédito', tono: 'warning' });
    if (t.etapa === 'facturada' && v.numero_control) out.push({ texto: `Control ${v.numero_control}`, tono: 'info' });
    if (t.etapa === 'despachada' && v.documento === 'factura') out.push({ texto: 'Falta nº de control', tono: 'warning' });
    if (t.cobrado > 0.01) out.push({ texto: `Abonado ${monto(t.cobrado, v.moneda)}`, tono: 'success' });
  }
  if ((t.etapa === 'despachada' || t.etapa === 'facturada' || t.etapa === 'aprobar') && v.cobrar_el) {
    const f = fechaCorta(v.cobrar_el).slice(0, 5);
    out.push(v.cobrar_el.slice(0, 10) < hoy && t.etapa !== 'aprobar'
      ? { texto: `Venció el ${f}`, tono: 'danger' }
      : { texto: `Cobrar el ${f}`, tono: 'warning' });
  }
  if (t.etapa === 'anulada') {
    out.push(esNoProcede(v)
      ? { texto: 'No aprobada', tono: 'danger', titulo: v.motivo_anulacion ?? undefined }
      : { texto: 'Anulada', tono: 'danger', titulo: v.motivo_anulacion ?? undefined });
  }
  return out;
}

function monto(n: number, moneda: string): string {
  const s = (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${s}` : `$ ${s}`;
}

/** El monto de la tarjeta: en las por cobrar, el saldo; si no, el total. */
export function montoDe(t: TarjetaVenta): { texto: string; etiqueta: string | null } {
  const v = t.venta;
  if (t.etapa === 'despachada' || t.etapa === 'facturada') {
    return { texto: monto(t.saldo, v.moneda), etiqueta: t.cobrado > 0.01 ? 'saldo' : null };
  }
  return { texto: monto(v.total, v.moneda), etiqueta: null };
}

/** Cada palabra buscada tiene que aparecer en algún dato de la venta. */
export function coincide(t: TarjetaVenta, q: string): boolean {
  const palabras = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!palabras.length) return true;
  const v = t.venta;
  const heno = [
    v.codigo, v.cliente_nombre, v.cliente_rif, t.resumen, v.numero_factura, v.numero_control, v.nota,
    TITULO_ETAPA[t.etapa],
  ].filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return palabras.every((p) => heno.includes(p.normalize('NFD').replace(/[̀-ͯ]/g, '')));
}

/* ───────────── Indicadores de arriba (tocarlos filtra) ───────────── */

export type FocoVentas = 'cot' | 'aprobar' | 'despachada' | 'porcobrar' | 'vencidas';

export interface IndicadoresVentas {
  cot: number;
  aprobar: number;
  despachada: number;
  /** Saldo por cobrar, por moneda. */
  porCobrar: { moneda: string; monto: number }[];
  vencidas: number;
}

export function indicadores(ts: TarjetaVenta[]): IndicadoresVentas {
  const porMoneda = new Map<string, number>();
  let cot = 0; let aprobar = 0; let despachada = 0; let vencidas = 0;
  for (const t of ts) {
    if (t.etapa === 'cot') cot++;
    else if (t.etapa === 'aprobar') aprobar++;
    else if (t.etapa === 'despachada') despachada++;
    if (t.etapa === 'despachada' || t.etapa === 'facturada') {
      porMoneda.set(t.venta.moneda, round2((porMoneda.get(t.venta.moneda) ?? 0) + t.saldo));
      if (t.vencida) vencidas++;
    }
  }
  // $ primero, Bs después, el resto al final.
  const rango = (m: string) => (m === 'USD' ? 0 : m === 'Bs' ? 1 : 2);
  const porCobrar = [...porMoneda.entries()]
    .map(([moneda, m]) => ({ moneda, monto: m }))
    .sort((a, b) => rango(a.moneda) - rango(b.moneda));
  return { cot, aprobar, despachada, porCobrar, vencidas };
}

export const FOCO_LABEL: Record<FocoVentas, string> = {
  cot: 'Cotizaciones abiertas',
  aprobar: 'Despachos por aprobar',
  despachada: 'Despachadas por cobrar',
  porcobrar: 'Por cobrar',
  vencidas: 'Vencidas',
};

/** Qué columnas se ven con el foco puesto (sin foco: todas). */
export function columnasConFoco(foco: FocoVentas | null): EtapaVenta[] {
  if (!foco) return COLUMNAS_VENTAS.map((c) => c.etapa);
  if (foco === 'porcobrar' || foco === 'vencidas') return ['despachada', 'facturada'];
  return [foco];
}

/** Las tarjetas que deja ver el foco (además de la columna). */
export function pasaFoco(t: TarjetaVenta, foco: FocoVentas | null): boolean {
  if (foco === 'vencidas') return t.vencida;
  return true;
}

/* ───────────── Cobradas y anuladas: solo las recientes ───────────── */

export type VentanaDias = 7 | 30 | 90;

/** Fecha que manda para saber si una cerrada es «reciente». */
function fechaCierre(v: Venta): string {
  return (v.anulada_at || v.facturada_at || v.entregada_at || v.updated_at || v.created_at || '').slice(0, 10);
}

/** Lo abierto se ve siempre; cobradas y anuladas, solo las de los últimos `dias`. */
export function visibleEnTablero(t: TarjetaVenta, dias: VentanaDias, hoy: string = hoyIso()): boolean {
  if (t.etapa !== 'cobrada' && t.etapa !== 'anulada') return true;
  return fechaCierre(t.venta) >= sumarDias(hoy, -dias);
}
