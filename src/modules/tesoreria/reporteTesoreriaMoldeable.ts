/* ============================================================
   MGG · Tesorería · Motor del Reporte Moldeable (03-11-2026)
   Traído de Golden Touch (reporteTesoreriaMoldeable.ts, 02-11-2026) y
   adaptado a los datos de MGG. Consolida las tres vertientes de Tesorería
   en una sola fila normalizada:
     · movimientos      → libro de caja (ingresos/egresos/traslados)
     · por_pagar        → órdenes de compra, servicios y compras/servicios
                          directos que esperan pago
     · creditos_cartera → compras a crédito (OC con cuenta abierta) + cuentas
                          por pagar manuales + cuentas por cobrar

   REGLA DE ORO: aquí NO se lee de Supabase. Las funciones reciben los datos
   YA leídos por reporteTesoreria.repository.ts, más un `ContextoTasas` con la
   tasa BCV del día (y opcionalmente las tasas históricas por fecha). Así todo
   el cálculo es determinista y se prueba con datos de ejemplo.

   Diferencias con GT: el libro de MGG tiene el tipo 'entrada' (cuenta como
   ingreso) y sus propias categorías; la cuenta por cobrar lleva `abonado`
   (no `cobrado`); las compras directas pueden venir en Bs.
   ============================================================ */

import type { MovimientoCaja } from '@/shared/lib/types';
import type { OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';
import type { DirectoFila } from '@/modules/pedidos/DirectosPorPagarModal';
import { textoPagoOrden, textoPagoDirecto } from '@/modules/pedidos/pendientesPorPagarReporte';
import type { CuentaPorPagar } from './cuentasPorPagar.repository';
import type { CuentaPorCobrar } from './cuentasPorCobrar.repository';

/* ───────────── Tipos de configuración ───────────── */

/** Qué contexto operativo de Tesorería se está reportando. */
export type AmbitoTesoreria = 'movimientos' | 'por_pagar' | 'creditos_cartera';

/** Dimensión principal de agrupación de las filas. */
export type ModoAgrupacionTesoreria =
  | 'caja'
  | 'moneda'
  | 'tipo_movimiento'
  | 'categoria_gasto'
  | 'contraparte'
  | 'origen_documento'
  | 'dia'
  | 'mes'
  | 'detallado';

/** Criterio de tasa de cambio para la valuación. */
export type BaseTasaTesoreria = 'bcv_dia' | 'historica';

/** Signo del flujo de caja (lo que suma vs lo que resta). */
export type TipoFlujoTesoreria = 'ingreso' | 'egreso' | 'traslado';

/** Criterio de orden de las filas. */
export type OrdenReporteTesoreria = 'usd' | 'bs' | 'fecha' | 'contraparte';

/**
 * Tasas ya resueltas por la capa de datos, para que el motor sea puro.
 * `tasaBcvHoy` = Bs por 1 USD (BCV del día). `tasasPorFecha` (opcional) mapea
 * 'YYYY-MM-DD' → Bs por 1 USD para la valuación histórica.
 */
export interface ContextoTasas {
  tasaBcvHoy: number;
  tasaFecha: string | null;
  tasasPorFecha?: Map<string, number>;
}

/* ───────────── Fila normalizada ───────────── */

export interface FilaReporteTesoreria {
  id: string;
  ambito: AmbitoTesoreria;
  fecha: string;                 // YYYY-MM-DD
  hora?: string | null;          // HH:mm
  codigo?: string | null;        // OC-2026-0181, CD-…, SV-…, o correlativo de gasto
  caja_origen?: string | null;   // Nombre de la caja/banco
  caja_destino?: string | null;  // En traslados
  moneda_original: string;       // USD, Bs, USDT, COP…
  monto_original: number;        // Monto en moneda nativa
  tipo_movimiento: TipoFlujoTesoreria;
  categoria: string;             // Categoría / rubro
  subcategoria?: string | null;
  contraparte: string;           // Proveedor, beneficiario o cliente
  concepto: string;              // Motivo / descripción
  origen_documento: string;      // Tipo de documento (OC, compra directa, gasto, movimiento…)
  estado?: string | null;        // Lista para pagar, A crédito…
  metodo_pago?: string | null;   // Transferencia, pago móvil, efectivo…
  datos_pago_resumen?: string | null;

  // Normalizaciones multimoneda calculadas
  tasa_bcv_aplicada: number;     // Bs por 1 USD usada en esta fila
  monto_usd: number;             // Equivalente consolidado en USD
  monto_bs: number;              // Equivalente consolidado en Bs
  saldo_caja_momento?: number | null;

  // Métricas de grupo (cuando la fila representa un grupo)
  total_operaciones?: number;
  pct_del_total?: number;        // % respecto al total de su tipo de flujo (por |USD|)
}

/* ───────────── Resumen / KPIs ───────────── */

export interface TopItemTesoreria {
  nombre: string;
  montoUsd: number;
  porcentaje: number;
}

export interface ResumenReporteTesoreria {
  totalEgresosUsd: number;
  totalEgresosBs: number;
  totalIngresosUsd: number;
  totalIngresosBs: number;
  saldoNetoUsd: number;
  saldoNetoBs: number;
  totalOperaciones: number;
  tasaBcvReferencia: number;
  topCategorias: TopItemTesoreria[];
  topProveedores: TopItemTesoreria[];
}

/* ───────────── Métrica de ficha ejecutiva ───────────── */

export interface MetricaFichaTesoreria {
  clave: string;
  etiqueta: string;
  valor: string;
  sub?: string;
  /** Color en pantalla: variable del tema de MGG. */
  colorCss: string;
  /** Color en el PDF (RGB). */
  colorRgb: [number, number, number];
}

/* ───────────── Catálogo de columnas ───────────── */

export interface CampoColumnaTesoreria {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  anchoExcel: number;
  alineacion: 'left' | 'right' | 'center';
  formato?: 'texto' | 'numero' | 'moneda' | 'moneda_bs' | 'porcentaje';
}

export const CAMPOS_REPORTE_TESORERIA: CampoColumnaTesoreria[] = [
  { clave: 'fecha', etiqueta: 'Fecha', anchoExcel: 13, alineacion: 'center', formato: 'texto', descripcion: 'Fecha de emisión o ejecución' },
  { clave: 'hora', etiqueta: 'Hora', anchoExcel: 11, alineacion: 'center', formato: 'texto', descripcion: 'Hora del registro' },
  { clave: 'codigo', etiqueta: 'N° Código / Ref', anchoExcel: 18, alineacion: 'left', formato: 'texto', descripcion: 'Código OC/CD/SV o correlativo' },
  { clave: 'caja', etiqueta: 'Caja / Banco', anchoExcel: 20, alineacion: 'left', formato: 'texto', descripcion: 'Caja o billetera de origen' },
  { clave: 'contraparte', etiqueta: 'Proveedor / Beneficiario', anchoExcel: 26, alineacion: 'left', formato: 'texto', descripcion: 'Razón social de la contraparte' },
  { clave: 'tipo_mov', etiqueta: 'Tipo de Movimiento', anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Ingreso, Egreso o Traslado' },
  { clave: 'categoria', etiqueta: 'Categoría', anchoExcel: 20, alineacion: 'left', formato: 'texto', descripcion: 'Rubro contable / operativo' },
  { clave: 'origen_documento', etiqueta: 'Documento', anchoExcel: 20, alineacion: 'left', formato: 'texto', descripcion: 'Tipo de documento de origen' },
  { clave: 'concepto', etiqueta: 'Concepto / Motivo', anchoExcel: 30, alineacion: 'left', formato: 'texto', descripcion: 'Detalle descriptivo' },
  { clave: 'estado', etiqueta: 'Estado', anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Lista para pagar, A crédito…' },
  { clave: 'metodo_pago', etiqueta: 'Método y Datos de Pago', anchoExcel: 28, alineacion: 'left', formato: 'texto', descripcion: 'Banco, cuenta, cédula/RIF destino' },
  { clave: 'monto_usd', etiqueta: 'Monto ($ USD)', anchoExcel: 16, alineacion: 'right', formato: 'moneda', descripcion: 'Valor expresado en dólares' },
  { clave: 'monto_bs', etiqueta: 'Monto (Bs)', anchoExcel: 18, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Valor expresado en bolívares' },
  { clave: 'monto_original', etiqueta: 'Monto Moneda Orig.', anchoExcel: 16, alineacion: 'right', formato: 'numero', descripcion: 'Monto en la moneda original' },
  { clave: 'tasa_bcv', etiqueta: 'Tasa BCV (Bs/$)', anchoExcel: 14, alineacion: 'right', formato: 'numero', descripcion: 'Tasa de cambio aplicada' },
  { clave: 'pct_total', etiqueta: '% del Total', anchoExcel: 12, alineacion: 'right', formato: 'porcentaje', descripcion: 'Peso sobre el total del período' },
  { clave: 'saldo_caja', etiqueta: 'Saldo Resultante', anchoExcel: 16, alineacion: 'right', formato: 'numero', descripcion: 'Saldo de la caja tras el movimiento' },
];

export const CAMPOS_POR_DEFECTO_POR_MODO: Record<ModoAgrupacionTesoreria, string[]> = {
  caja: ['caja', 'tipo_mov', 'monto_usd', 'monto_bs', 'pct_total'],
  moneda: ['monto_original', 'monto_usd', 'monto_bs', 'pct_total'],
  tipo_movimiento: ['tipo_mov', 'monto_usd', 'monto_bs', 'pct_total'],
  categoria_gasto: ['categoria', 'monto_usd', 'monto_bs', 'pct_total'],
  contraparte: ['contraparte', 'categoria', 'monto_usd', 'monto_bs', 'pct_total'],
  origen_documento: ['origen_documento', 'monto_usd', 'monto_bs', 'pct_total'],
  dia: ['fecha', 'monto_usd', 'monto_bs', 'pct_total'],
  mes: ['fecha', 'monto_usd', 'monto_bs', 'pct_total'],
  detallado: ['fecha', 'codigo', 'caja', 'contraparte', 'tipo_mov', 'categoria', 'estado', 'metodo_pago', 'monto_usd', 'monto_bs'],
};

export const ETIQUETA_FLUJO: Record<TipoFlujoTesoreria, string> = {
  ingreso: 'Ingreso / Cobro',
  egreso: 'Egreso / Pago',
  traslado: 'Traslado entre cajas',
};

/* ───────────── Filtros ───────────── */

export interface FiltrosTesoreria {
  cajasSel?: string[];
  monedasSel?: string[];
  tiposSel?: TipoFlujoTesoreria[];
  categoriasSel?: string[];
  contrapartesSel?: string[];
  estadosSel?: string[];
}

/* ───────────── Utilidades numéricas y de fecha ───────────── */

const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Redondeo a 2 decimales. */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Etiqueta "Mes Año" a partir de un YYYY-MM o YYYY-MM-DD. */
export function mesEtiqueta(fechaIso: string): string {
  const [y, m] = (fechaIso || '').split('-');
  const mesIdx = Number(m) - 1;
  if (mesIdx >= 0 && mesIdx < 12 && y) return `${MESES_ES[mesIdx]} ${y}`;
  return fechaIso || 'Sin fecha';
}

const FMT_DIA_VE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' });
const FMT_HORA_VE = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Día (YYYY-MM-DD) en hora de Venezuela de un instante ISO. Si ya viene como
 * fecha sola (YYYY-MM-DD) se respeta tal cual. (GT usaba el día UTC: un
 * movimiento de las 21:00 caía al día siguiente; aquí manda Caracas).
 */
export function diaDe(valor: string | null | undefined): string {
  const s = (valor ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  return FMT_DIA_VE.format(d);
}

/** Hora (HH:mm) en hora de Venezuela de un instante ISO, o null si no se puede derivar. */
export function horaDe(valor: string | null | undefined): string | null {
  const s = (valor ?? '').trim();
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return FMT_HORA_VE.format(d);
}

/** Atajos del rango de fechas del reporte. */
export type PresetRangoTesoreria = 'hoy' | 'ayer' | 'mes' | 'mes_anterior' | 'ult30' | 'ult90' | 'anio';

export const PRESETS_RANGO_TESORERIA: { id: PresetRangoTesoreria; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mes_anterior', label: 'Mes anterior' },
  { id: 'ult30', label: 'Últimos 30d' },
  { id: 'ult90', label: 'Últimos 90d' },
  { id: 'anio', label: 'Este año' },
];

/** Suma días a un YYYY-MM-DD (aritmética de calendario, sin zona horaria). */
function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/**
 * Rango { desde, hasta } de un atajo, a partir de `hoy` (YYYY-MM-DD en hora de
 * Venezuela). GT calculaba «ayer» y «últimos N días» con el día UTC; aquí todo
 * parte del día de Caracas.
 */
export function rangoPresetTesoreria(preset: PresetRangoTesoreria, hoy: string): { desde: string; hasta: string } {
  const [y, m] = hoy.split('-').map(Number);
  switch (preset) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case 'ayer': { const a = sumarDias(hoy, -1); return { desde: a, hasta: a }; }
    case 'mes': return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
    case 'mes_anterior': {
      const primeroEste = `${hoy.slice(0, 7)}-01`;
      const ultimoAnt = sumarDias(primeroEste, -1);
      return { desde: `${ultimoAnt.slice(0, 7)}-01`, hasta: ultimoAnt };
    }
    case 'ult30': return { desde: sumarDias(hoy, -30), hasta: hoy };
    case 'ult90': return { desde: sumarDias(hoy, -90), hasta: hoy };
    case 'anio': return { desde: `${y}-01-01`, hasta: hoy };
    default: return { desde: `${y}-${String(m).padStart(2, '0')}-01`, hasta: hoy };
  }
}

/** La tasa (Bs por 1 USD) a aplicar a una fila según la base y su fecha. */
function tasaDeFecha(ctx: ContextoTasas, fecha: string, base: BaseTasaTesoreria): number {
  if (base === 'historica' && ctx.tasasPorFecha) {
    const t = ctx.tasasPorFecha.get(diaDe(fecha));
    if (t && t > 0) return t;
  }
  return Number(ctx.tasaBcvHoy) || 0;
}

export interface Equivalencias { usd: number; bs: number; tasa: number; }

const esBs = (moneda: string): boolean => /^(bs|ves)$/i.test(String(moneda ?? '').trim());

/**
 * Convierte un monto en su moneda a { usd, bs } con la tasa BCV dada.
 * Para monedas que no son Bs/USD/USDT (p. ej. COP) se usa `tasaBsUnidad`
 * (Bs por unidad, del propio movimiento) si está; si no, no hay equivalencia.
 */
export function convertirMonto(
  monto: number,
  moneda: string,
  tasaUsd: number,
  tasaBsUnidad?: number | null,
): Equivalencias {
  const k = Number(monto) || 0;
  const R = Number(tasaUsd) || 0;
  if (esBs(moneda)) {
    return { usd: R > 0 ? round2(k / R) : 0, bs: round2(k), tasa: R };
  }
  if (moneda === 'USD' || moneda === 'USDT') {
    // USDT se valora 1:1 con el dólar para la consolidación.
    return { usd: round2(k), bs: round2(k * R), tasa: R };
  }
  const tbu = Number(tasaBsUnidad) || 0;
  if (tbu > 0) {
    const bs = round2(k * tbu);
    return { usd: R > 0 ? round2(bs / R) : 0, bs, tasa: R };
  }
  return { usd: 0, bs: 0, tasa: R };
}

/* ───────────── Normalizador: movimientos de caja ───────────── */

/** Mapea el tipo del libro de MGG al flujo de tesorería (ingreso/egreso/traslado). */
export function flujoDeMovimiento(m: Pick<MovimientoCaja, 'tipo' | 'saldo_antes' | 'saldo_despues'>): TipoFlujoTesoreria {
  switch (m.tipo) {
    case 'ingreso':
    case 'entrada': return 'ingreso';
    case 'salida': return 'egreso';
    case 'traslado_salida':
    case 'traslado_entrada': return 'traslado';
    case 'ajuste':
      return (Number(m.saldo_despues) || 0) >= (Number(m.saldo_antes) || 0) ? 'ingreso' : 'egreso';
    default: return 'egreso';
  }
}

/** Etiquetas de las categorías del libro de MGG (mismas que la pantalla de Tesorería). */
const LABEL_CATEGORIA_MOV: Record<string, string> = {
  gasto: 'Gasto',
  pago_personal: 'Pago a personal',
  pago_oc: 'Pago de compra',
  pago_nomina: 'Pago de nómina',
  traslado: 'Traslado',
  conversion: 'Conversión',
  compra_directa: 'Compra directa',
  servicio_directo: 'Servicio directo',
  cobro_cxc: 'Cobro por cobrar',
  abono_cxp: 'Abono por pagar',
  combustible: 'Combustible',
  reembolso_oc: 'Reembolso de pago',
  comision_bancaria: 'Comisión bancaria',
  venta: 'Venta',
  venta_reintegro: 'Reintegro de venta',
  venta_anulada: 'Venta anulada',
  pago_viaje_chofer: 'Pago de viaje (chofer)',
  viatico_chofer: 'Viático de chofer',
  ingreso: 'Ingreso',
};

/** Rubro visible de un movimiento: categoría de gasto > categoría base > ingreso/egreso. */
function categoriaDeMovimiento(m: MovimientoCaja): string {
  if (m.tipo === 'ajuste') return 'Ajuste';
  const cat = (m.gasto_categoria ?? '').trim();
  if (cat) return cat;
  const base = (m.categoria ?? '').trim();
  if (base) return LABEL_CATEGORIA_MOV[base] ?? base;
  if (m.tipo === 'traslado_salida' || m.tipo === 'traslado_entrada') return 'Traslado';
  return m.tipo === 'ingreso' || m.tipo === 'entrada' ? 'Ingreso' : 'Egreso';
}

/** Tipo de documento de origen de un movimiento. */
function origenDeMovimiento(m: MovimientoCaja): string {
  if (m.ref_orden_id) return 'Pago de orden';
  if (m.ref_nomina_renglon_id) return 'Nómina';
  const base = (m.categoria ?? '').trim();
  if (base === 'compra_directa') return 'Compra directa';
  if (base === 'servicio_directo') return 'Servicio directo';
  if (base === 'abono_cxp') return 'Cuenta por pagar';
  if (base === 'cobro_cxc') return 'Cuenta por cobrar';
  if (base.startsWith('venta')) return 'Venta';
  if (base === 'conversion') return 'Conversión';
  if (m.tipo === 'traslado_salida' || m.tipo === 'traslado_entrada') return 'Traslado';
  if (m.gasto_correlativo != null) return 'Gasto con correlativo';
  return 'Movimiento de caja';
}

/** Nombre de la caja con su billetera/cuenta cuando no es la general. */
function nombreCaja(m: MovimientoCaja): string {
  const caja = (m.caja?.nombre ?? '').trim();
  if (!caja) return '—';
  const c = (m.cuenta ?? '').trim();
  if (!c || c === 'general') return caja;
  const etq = c === 'juridica' ? 'Jurídica' : c === 'personal' ? 'Personal' : c;
  return `${caja} · ${etq}`;
}

/**
 * Normaliza los movimientos del libro a filas del reporte.
 * `base` elige la valuación (BCV del día o histórica por fecha del movimiento).
 */
export function normalizarMovimientosTesoreria(
  movs: MovimientoCaja[],
  ctx: ContextoTasas,
  base: BaseTasaTesoreria = 'bcv_dia',
): FilaReporteTesoreria[] {
  return movs.map((m, idx) => {
    const fecha = diaDe(m.at);
    const R = tasaDeFecha(ctx, fecha, base);
    const conv = convertirMonto(m.monto, m.moneda, R, m.tasa_bs);
    return {
      id: m.id || `mov-${idx}`,
      ambito: 'movimientos',
      fecha,
      hora: horaDe(m.at),
      codigo: m.gasto_correlativo != null ? String(m.gasto_correlativo) : null,
      caja_origen: nombreCaja(m),
      caja_destino: m.destino ?? null,
      moneda_original: m.moneda,
      monto_original: round2(m.monto),
      tipo_movimiento: flujoDeMovimiento(m),
      categoria: categoriaDeMovimiento(m),
      subcategoria: (m.gasto_subcategoria ?? null) || null,
      contraparte: (m.beneficiario ?? '').trim() || '—',
      concepto: (m.motivo ?? '').trim(),
      origen_documento: origenDeMovimiento(m),
      estado: null,
      metodo_pago: null,
      datos_pago_resumen: null,
      tasa_bcv_aplicada: R,
      monto_usd: conv.usd,
      monto_bs: conv.bs,
      saldo_caja_momento: m.saldo_despues ?? null,
    };
  });
}

/* ───────────── Normalizador: pendientes por pagar ───────────── */

/** Lo que espera pago en MGG, ya leído (los mismos datos que «Órdenes pendientes por pagar»). */
export interface DatosPendientesPorPagar {
  ordenes: OrdenPorPagar[];
  directos: DirectoFila[];
  /** Bs por $ (BCV del día). */
  tasa: number;
  /** Instante en que se armó (la fecha de las filas). */
  generadoEn: string;
}

/** Texto de pago en una sola línea (las patas del multipago separadas por « | »). */
function pagoEnLinea(t: string): string {
  return t.split('\n').map((x) => x.trim()).filter(Boolean).join(' | ');
}

/**
 * Aplana lo pendiente por pagar a filas del reporte: órdenes de compra, servicios
 * (OC de clase servicio) y compras/servicios directos. Todo es egreso a la tasa
 * BCV del día. Las compras a crédito van en el ámbito `creditos_cartera`.
 */
export function normalizarPendientesPorPagar(datos: DatosPendientesPorPagar): FilaReporteTesoreria[] {
  const fecha = diaDe(datos.generadoEn);
  const R = Number(datos.tasa) || 0;
  const filas: FilaReporteTesoreria[] = [];

  for (const r of datos.ordenes) {
    const origen = r.orden.clase === 'servicio' ? 'Servicio' : 'Orden de compra';
    const usd = round2(Number(r.montoAPagar) || 0);
    const pago = pagoEnLinea(textoPagoOrden(r.orden));
    const fechaOrden = diaDe(r.orden.oc_aprobada_en ?? null) || fecha;
    filas.push({
      id: `pp-oc-${r.orden.id}`,
      ambito: 'por_pagar',
      fecha: fechaOrden,
      hora: null,
      codigo: r.orden.oc_codigo ?? r.orden.codigo ?? null,
      caja_origen: null,
      caja_destino: null,
      moneda_original: 'USD',
      monto_original: usd,
      tipo_movimiento: 'egreso',
      categoria: origen,
      subcategoria: null,
      contraparte: (r.proveedorNombre || '').trim() || '—',
      concepto: origen,
      origen_documento: origen,
      estado: r.esperandoMetodo ? 'Esperando método de pago' : 'Lista para pagar',
      metodo_pago: pago,
      datos_pago_resumen: pago,
      tasa_bcv_aplicada: R,
      monto_usd: usd,
      monto_bs: round2(usd * R),
      saldo_caja_momento: null,
    });
  }

  for (const d of datos.directos) {
    const origen = d.kind === 'servicio' ? 'Servicio directo' : 'Compra directa';
    const moneda = esBs(d.moneda) ? 'Bs' : 'USD';
    const conv = convertirMonto(Number(d.total) || 0, moneda, R);
    const pago = pagoEnLinea(textoPagoDirecto(d));
    filas.push({
      id: `pp-${d.kind}-${d.id}`,
      ambito: 'por_pagar',
      fecha,
      hora: null,
      codigo: d.codigo && d.codigo !== '—' ? d.codigo : null,
      caja_origen: null,
      caja_destino: null,
      moneda_original: moneda,
      monto_original: round2(Number(d.total) || 0),
      tipo_movimiento: 'egreso',
      categoria: origen,
      subcategoria: d.categoria || null,
      contraparte: (d.titulo || '').trim() || '—',
      concepto: [d.detalle, d.categoria].filter(Boolean).join(' · ') || origen,
      origen_documento: origen,
      estado: d.pagoExterno ? 'Reintegro a externo' : 'Lista para pagar',
      metodo_pago: pago,
      datos_pago_resumen: pago,
      tasa_bcv_aplicada: R,
      monto_usd: conv.usd,
      monto_bs: conv.bs,
      saldo_caja_momento: null,
    });
  }

  return filas;
}

/* ───────────── Normalizador: cuentas a crédito (cartera) ───────────── */

/**
 * Normaliza las cuentas a crédito abiertas:
 *  · compras a crédito (OC con cuenta abierta): saldo = total − abonado (egreso);
 *  · cuentas por pagar manuales: saldo = monto − abonado (egreso);
 *  · cuentas por cobrar: saldo = monto − abonado (ingreso, nos lo deben).
 * Las saldadas o en cero no salen.
 */
export function normalizarCreditosCartera(
  creditosOc: OrdenPorPagar[],
  cxp: CuentaPorPagar[],
  cxc: CuentaPorCobrar[],
  ctx: ContextoTasas,
  base: BaseTasaTesoreria = 'bcv_dia',
): FilaReporteTesoreria[] {
  const filas: FilaReporteTesoreria[] = [];

  for (const r of creditosOc) {
    const total = Number(r.montoAPagar) || 0;
    const abonado = Math.max(0, Number(r.orden.abonado_total) || 0);
    const saldo = Math.max(0, round2(total - abonado));
    if (saldo <= 0) continue;
    const fecha = diaDe(r.orden.oc_aprobada_en ?? r.orden.created_at ?? null);
    const R = tasaDeFecha(ctx, fecha, base);
    const conv = convertirMonto(saldo, 'USD', R);
    const pago = pagoEnLinea(textoPagoOrden(r.orden));
    filas.push({
      id: `cred-oc-${r.orden.id}`,
      ambito: 'creditos_cartera',
      fecha,
      hora: null,
      codigo: r.orden.oc_codigo ?? r.orden.codigo ?? null,
      caja_origen: null,
      caja_destino: null,
      moneda_original: 'USD',
      monto_original: saldo,
      tipo_movimiento: 'egreso',
      categoria: 'Compra a crédito',
      subcategoria: null,
      contraparte: (r.proveedorNombre || '').trim() || '—',
      concepto: `Total $ ${round2(total)} · abonado $ ${round2(abonado)}`,
      origen_documento: 'Compra a crédito',
      estado: 'A crédito',
      metodo_pago: pago,
      datos_pago_resumen: pago,
      tasa_bcv_aplicada: R,
      monto_usd: conv.usd,
      monto_bs: conv.bs,
      saldo_caja_momento: null,
    });
  }

  for (const c of cxp) {
    if (c.estado !== 'abierta') continue;
    const saldo = round2((Number(c.monto) || 0) - (Number(c.abonado) || 0));
    if (saldo <= 0) continue;
    const fecha = diaDe(c.created_at);
    const R = tasaDeFecha(ctx, fecha, base);
    const conv = convertirMonto(saldo, c.moneda, R);
    filas.push({
      id: `cxp-${c.id}`,
      ambito: 'creditos_cartera',
      fecha,
      hora: null,
      codigo: null,
      caja_origen: null,
      caja_destino: null,
      moneda_original: c.moneda,
      monto_original: saldo,
      tipo_movimiento: 'egreso',
      categoria: 'Cuenta por pagar',
      subcategoria: null,
      contraparte: (c.contraparte || '').trim() || '—',
      concepto: (c.nota ?? '').trim() || 'Crédito a pagar',
      origen_documento: 'Cuenta por pagar',
      estado: 'A crédito',
      metodo_pago: null,
      datos_pago_resumen: null,
      tasa_bcv_aplicada: R,
      monto_usd: conv.usd,
      monto_bs: conv.bs,
      saldo_caja_momento: null,
    });
  }

  for (const c of cxc) {
    if (c.estado !== 'abierta') continue;
    const saldo = round2((Number(c.monto) || 0) - (Number(c.abonado) || 0));
    if (saldo <= 0) continue;
    const fecha = diaDe(c.created_at);
    const R = tasaDeFecha(ctx, fecha, base);
    const conv = convertirMonto(saldo, c.moneda, R);
    filas.push({
      id: `cxc-${c.id}`,
      ambito: 'creditos_cartera',
      fecha,
      hora: null,
      codigo: null,
      caja_origen: null,
      caja_destino: null,
      moneda_original: c.moneda,
      monto_original: saldo,
      tipo_movimiento: 'ingreso',
      categoria: 'Cuenta por cobrar',
      subcategoria: null,
      contraparte: (c.contraparte || '').trim() || '—',
      concepto: (c.nota ?? '').trim() || 'Crédito a cobrar',
      origen_documento: 'Cuenta por cobrar',
      estado: 'A crédito',
      metodo_pago: null,
      datos_pago_resumen: null,
      tasa_bcv_aplicada: R,
      monto_usd: conv.usd,
      monto_bs: conv.bs,
      saldo_caja_momento: null,
    });
  }

  return filas;
}

/* ───────────── Filtros ───────────── */

/** Filtra las filas por las selecciones de los filtros (vacío = sin filtro). */
export function filtrarFilasTesoreria(filas: FilaReporteTesoreria[], f: FiltrosTesoreria): FilaReporteTesoreria[] {
  const { cajasSel, monedasSel, tiposSel, categoriasSel, contrapartesSel, estadosSel } = f;
  return filas.filter((row) => {
    if (cajasSel && cajasSel.length > 0) {
      if (!row.caja_origen || !cajasSel.includes(row.caja_origen)) return false;
    }
    if (monedasSel && monedasSel.length > 0) {
      if (!monedasSel.includes(row.moneda_original)) return false;
    }
    if (tiposSel && tiposSel.length > 0) {
      if (!tiposSel.includes(row.tipo_movimiento)) return false;
    }
    if (categoriasSel && categoriasSel.length > 0) {
      if (!categoriasSel.includes(row.categoria)) return false;
    }
    if (contrapartesSel && contrapartesSel.length > 0) {
      if (!contrapartesSel.includes(row.contraparte)) return false;
    }
    if (estadosSel && estadosSel.length > 0) {
      if (!row.estado || !estadosSel.includes(row.estado)) return false;
    }
    return true;
  });
}

/* ───────────── Resumen / KPIs ───────────── */

function topPor(
  filas: FilaReporteTesoreria[],
  clave: (f: FilaReporteTesoreria) => string,
  soloEgresos: boolean,
): TopItemTesoreria[] {
  const map = new Map<string, number>();
  let base = 0;
  for (const f of filas) {
    if (soloEgresos && f.tipo_movimiento !== 'egreso') continue;
    const usd = Math.abs(f.monto_usd);
    map.set(clave(f), (map.get(clave(f)) || 0) + usd);
    base += usd;
  }
  return Array.from(map.entries())
    .map(([nombre, montoUsd]) => ({
      nombre,
      montoUsd: round2(montoUsd),
      porcentaje: base > 0 ? Math.round((montoUsd / base) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.montoUsd - a.montoUsd)
    .slice(0, 5);
}

/** KPIs del período a partir de las filas de detalle (ya filtradas). */
export function resumenTesoreria(filas: FilaReporteTesoreria[], tasaReferencia: number): ResumenReporteTesoreria {
  let egUsd = 0, egBs = 0, inUsd = 0, inBs = 0;
  for (const f of filas) {
    if (f.tipo_movimiento === 'egreso') { egUsd += f.monto_usd; egBs += f.monto_bs; }
    else if (f.tipo_movimiento === 'ingreso') { inUsd += f.monto_usd; inBs += f.monto_bs; }
    // Los traslados no suman a ingresos ni egresos (movimiento entre cajas propias).
  }
  return {
    totalEgresosUsd: round2(egUsd),
    totalEgresosBs: round2(egBs),
    totalIngresosUsd: round2(inUsd),
    totalIngresosBs: round2(inBs),
    saldoNetoUsd: round2(inUsd - egUsd),
    saldoNetoBs: round2(inBs - egBs),
    totalOperaciones: filas.length,
    tasaBcvReferencia: Number(tasaReferencia) || 0,
    topCategorias: topPor(filas, (f) => f.categoria, true),
    topProveedores: topPor(filas, (f) => f.contraparte, true),
  };
}

/* ───────────── Agrupación y procesamiento ───────────── */

interface AcumuladorTesoreria {
  clave: string;
  etiqueta: string;
  fecha: string;
  caja: string | null;
  moneda: string;
  categoria: string;
  contraparte: string;
  origen: string;
  monedasUsadas: Set<string>;
  usd: number;
  bs: number;
  original: number;
  operaciones: number;
  /** |USD| acumulado por tipo de flujo, para el % relativo al propio tipo. */
  porTipo: Record<TipoFlujoTesoreria, number>;
}

/** El tipo de flujo que más pesa (|USD|) dentro de un grupo. */
function tipoDominante(porTipo: Record<TipoFlujoTesoreria, number>): TipoFlujoTesoreria {
  const tipos: TipoFlujoTesoreria[] = ['egreso', 'ingreso', 'traslado'];
  return tipos.reduce((best, t) => (porTipo[t] > porTipo[best] ? t : best), 'egreso' as TipoFlujoTesoreria);
}

/** Clave + etiqueta del grupo de una fila según la dimensión elegida. */
function claveGrupo(f: FilaReporteTesoreria, modo: ModoAgrupacionTesoreria): { clave: string; etiqueta: string } {
  switch (modo) {
    case 'caja': return { clave: f.caja_origen || 'Sin caja', etiqueta: f.caja_origen || 'Sin caja' };
    case 'moneda': return { clave: f.moneda_original, etiqueta: f.moneda_original };
    case 'tipo_movimiento': return { clave: f.tipo_movimiento, etiqueta: ETIQUETA_FLUJO[f.tipo_movimiento] };
    case 'categoria_gasto': return { clave: f.categoria, etiqueta: f.categoria };
    case 'contraparte': return { clave: f.contraparte, etiqueta: f.contraparte };
    case 'origen_documento': return { clave: f.origen_documento, etiqueta: f.origen_documento };
    case 'dia': return { clave: f.fecha || 'Sin fecha', etiqueta: f.fecha || 'Sin fecha' };
    case 'mes': return { clave: (f.fecha || '').slice(0, 7) || 'Sin fecha', etiqueta: mesEtiqueta(f.fecha) };
    default: return { clave: f.id, etiqueta: f.contraparte || f.categoria };
  }
}

function ordenarFilas(filas: FilaReporteTesoreria[], ordenarPor: OrdenReporteTesoreria): void {
  switch (ordenarPor) {
    case 'bs': filas.sort((a, b) => Math.abs(b.monto_bs) - Math.abs(a.monto_bs)); break;
    case 'fecha': filas.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.hora || '').localeCompare(b.hora || '')); break;
    case 'contraparte': filas.sort((a, b) => a.contraparte.localeCompare(b.contraparte, 'es')); break;
    default: filas.sort((a, b) => Math.abs(b.monto_usd) - Math.abs(a.monto_usd));
  }
}

/**
 * Genera las filas del reporte según la dimensión de agrupación, más el resumen.
 * El % de cada fila es relativo al total de su PROPIO tipo de flujo (egreso sobre
 * el total de egresos, etc.). El resumen (KPIs) siempre sale del detalle completo.
 */
export function procesarFilasReporteTesoreria(
  filasDetalle: FilaReporteTesoreria[],
  agrupacion: ModoAgrupacionTesoreria,
  opciones: { ordenarPor?: OrdenReporteTesoreria } = {},
): { filas: FilaReporteTesoreria[]; resumen: ResumenReporteTesoreria } {
  const ordenarPor = opciones.ordenarPor ?? 'usd';
  const tasaRef = filasDetalle.find((f) => f.tasa_bcv_aplicada > 0)?.tasa_bcv_aplicada ?? 0;
  const resumen = resumenTesoreria(filasDetalle, tasaRef);

  const totPorTipo: Record<TipoFlujoTesoreria, number> = { ingreso: 0, egreso: 0, traslado: 0 };
  for (const f of filasDetalle) totPorTipo[f.tipo_movimiento] += Math.abs(f.monto_usd);
  const pctDe = (usd: number, tipo: TipoFlujoTesoreria): number => {
    const den = totPorTipo[tipo];
    return den > 0 ? Math.round((Math.abs(usd) / den) * 1000) / 10 : 0;
  };

  if (agrupacion === 'detallado') {
    const filas = filasDetalle.map((f) => ({
      ...f,
      total_operaciones: 1,
      pct_del_total: pctDe(f.monto_usd, f.tipo_movimiento),
    }));
    ordenarFilas(filas, ordenarPor);
    return { filas, resumen };
  }

  const mapa = new Map<string, AcumuladorTesoreria>();
  for (const f of filasDetalle) {
    const { clave, etiqueta } = claveGrupo(f, agrupacion);
    let g = mapa.get(clave);
    if (!g) {
      g = {
        clave, etiqueta,
        fecha: f.fecha,
        caja: f.caja_origen ?? null,
        moneda: f.moneda_original,
        categoria: f.categoria,
        contraparte: f.contraparte,
        origen: f.origen_documento,
        monedasUsadas: new Set<string>(),
        usd: 0, bs: 0, original: 0, operaciones: 0,
        porTipo: { ingreso: 0, egreso: 0, traslado: 0 },
      };
      mapa.set(clave, g);
    }
    g.usd += f.monto_usd;
    g.bs += f.monto_bs;
    g.original += f.monto_original;
    g.operaciones += 1;
    g.monedasUsadas.add(f.moneda_original);
    g.porTipo[f.tipo_movimiento] += Math.abs(f.monto_usd);
  }

  const filas: FilaReporteTesoreria[] = Array.from(mapa.values()).map((g) => {
    const monedaRep = g.monedasUsadas.size === 1 ? g.moneda : 'Varias';
    const dom = tipoDominante(g.porTipo);
    return {
      id: g.clave || g.etiqueta,
      ambito: filasDetalle[0]?.ambito ?? 'movimientos',
      fecha: g.fecha,
      hora: null,
      codigo: null,
      caja_origen: agrupacion === 'caja' ? g.etiqueta : g.caja,
      caja_destino: null,
      moneda_original: monedaRep,
      monto_original: monedaRep === 'Varias' ? 0 : round2(g.original),
      tipo_movimiento: dom,
      categoria: agrupacion === 'categoria_gasto' ? g.etiqueta : g.categoria,
      subcategoria: null,
      contraparte: agrupacion === 'contraparte' ? g.etiqueta : g.contraparte,
      concepto: g.etiqueta,
      origen_documento: agrupacion === 'origen_documento' ? g.etiqueta : g.origen,
      estado: null,
      metodo_pago: null,
      datos_pago_resumen: null,
      tasa_bcv_aplicada: tasaRef,
      monto_usd: round2(g.usd),
      monto_bs: round2(g.bs),
      saldo_caja_momento: null,
      total_operaciones: g.operaciones,
      pct_del_total: pctDe(g.porTipo[dom], dom),
    };
  });

  if (agrupacion === 'mes' || agrupacion === 'dia') {
    filas.sort((a, b) => a.id.localeCompare(b.id));
  } else {
    ordenarFilas(filas, ordenarPor);
  }

  return { filas, resumen };
}

/* ───────────── Métricas de la ficha ejecutiva ───────────── */

const fmt2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Métricas visibles de una ficha ejecutiva según las columnas marcadas y los
 * interruptores maestros de moneda. Si se apaga USD, el recuadro de dólares no
 * aparece y se redistribuye; máximo 4 recuadros.
 */
export function obtenerMetricasFichaTesoreria(
  f: FilaReporteTesoreria,
  columnasClaves: string[],
  toggles: { mostrarUsd: boolean; mostrarBs: boolean },
): MetricaFichaTesoreria[] {
  const metricas: MetricaFichaTesoreria[] = [];
  const tasaTxt = f.tasa_bcv_aplicada > 0 ? `Tasa: Bs ${fmt2(f.tasa_bcv_aplicada)}/$` : 'Sin tasa';
  const usd: MetricaFichaTesoreria = {
    clave: 'monto_usd', etiqueta: 'MONTO ($ USD)', valor: `$ ${fmt2(f.monto_usd)}`, sub: tasaTxt,
    colorCss: 'var(--success)', colorRgb: [22, 163, 74],
  };

  if (toggles.mostrarUsd && columnasClaves.includes('monto_usd')) metricas.push(usd);

  if (toggles.mostrarBs && columnasClaves.includes('monto_bs')) {
    metricas.push({
      clave: 'monto_bs', etiqueta: 'MONTO (Bs)', valor: `Bs ${fmt2(f.monto_bs)}`, sub: 'Total consolidado',
      colorCss: 'var(--primary)', colorRgb: [255, 138, 0],
    });
  }

  if (columnasClaves.includes('monto_original') && metricas.length < 4 && f.moneda_original !== 'USD' && !esBs(f.moneda_original)) {
    metricas.push({
      clave: 'monto_original', etiqueta: `MONTO (${f.moneda_original})`, valor: fmt2(f.monto_original), sub: 'Moneda original',
      colorCss: 'var(--info)', colorRgb: [2, 132, 199],
    });
  }

  if (metricas.length < 4 && f.total_operaciones != null) {
    metricas.push({
      clave: 'operaciones', etiqueta: 'OPERACIONES', valor: `${f.total_operaciones}`,
      sub: f.total_operaciones === 1 ? 'registro' : 'registros',
      colorCss: 'var(--text)', colorRgb: [71, 85, 105],
    });
  }

  if (columnasClaves.includes('pct_total') && metricas.length < 4 && f.pct_del_total != null) {
    metricas.push({
      clave: 'pct_total', etiqueta: '% DEL TOTAL', valor: `${f.pct_del_total.toFixed(1)}%`, sub: 'del período',
      colorCss: 'var(--warning)', colorRgb: [202, 138, 4],
    });
  }

  if ((columnasClaves.includes('metodo_pago') || columnasClaves.includes('estado')) && metricas.length < 4) {
    metricas.push({
      clave: 'metodo_pago', etiqueta: 'MÉTODO / ESTADO', valor: f.estado || '—', sub: f.datos_pago_resumen || f.metodo_pago || '',
      colorCss: 'var(--success)', colorRgb: [16, 185, 129],
    });
  }

  // Respaldo: si nada quedó marcado, al menos el monto en USD.
  if (metricas.length === 0) metricas.push(usd);

  return metricas.slice(0, 4);
}
