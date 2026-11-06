/* ============================================================
   Golden Touch · Tesorería · Motor del Reporte Moldeable
   (02/11/2026)

   Motor de datos PURO y SÍNCRONO para el reporte financiero flexible,
   calcado del de Combustible (reporteMoldeable.ts). Consolida las tres
   vertientes de Tesorería en una sola fila normalizada:
     · movimientos  → libro de caja (ingresos/egresos/traslados)
     · por_pagar    → compromisos (OC, CS, servicios y compras directas)
     · creditos_cartera → cuentas a crédito (CxP proveedores + CxC clientes)

   REGLA DE ORO: aquí NO se lee de Supabase. Las funciones reciben los datos
   YA leídos por la capa de repositorios/modal, más un `ContextoTasas` con la
   tasa BCV del día (y opcionalmente las tasas históricas por fecha). Así todo
   el cálculo es determinista y testeable con fixtures.

   Valuación: cada fila guarda su monto en la moneda original y su equivalente
   consolidado en USD y en Bs, con la tasa BCV aplicada (del día o histórica).
   ============================================================ */

import type { MovimientoCaja } from '@/shared/lib/types';
import type { DatosPendientesPorPagar, ClaveSegmento } from './pendientesPorPagar';
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

/** Moneda en la que se consolida/presenta el reporte. */
export type MonedaConsolidacion = 'usd' | 'bs' | 'original';

/** Criterio de tasa de cambio para la valuación. */
export type BaseTasaTesoreria = 'bcv_dia' | 'historica';

/** Signo del flujo de caja (lo que suma vs lo que resta). */
export type TipoFlujoTesoreria = 'ingreso' | 'egreso' | 'traslado';

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
  hora?: string | null;          // HH:mm:ss
  codigo?: string | null;        // OC-2026-0181, CS-…, SD-…, o correlativo de gasto
  caja_origen?: string | null;   // Nombre de la caja/banco
  caja_destino?: string | null;  // En traslados
  moneda_original: string;       // USD, Bs, USDT, COP…
  monto_original: number;        // Monto en moneda nativa
  tipo_movimiento: TipoFlujoTesoreria;
  categoria: string;             // Categoría / rubro
  subcategoria?: string | null;
  contraparte: string;           // Proveedor, empleado o cliente
  concepto: string;              // Motivo / descripción
  origen_documento: string;      // Tipo de documento (OC, CS, SD, Gasto, Movimiento…)
  estado?: string | null;        // Pagado, Lista para pagar, A crédito…
  metodo_pago?: string | null;   // Transferencia, Pago móvil, Efectivo…
  datos_pago_resumen?: string | null;

  // Normalizaciones multimoneda calculadas
  tasa_bcv_aplicada: number;     // Bs por 1 USD usada en esta fila
  monto_usd: number;             // Equivalente consolidado en USD
  monto_bs: number;              // Equivalente consolidado en Bs
  saldo_caja_momento?: number | null;

  // Métricas de grupo (cuando la fila representa un grupo agrupado)
  total_operaciones?: number;
  pct_del_total?: number;        // % respecto al total del período (por |USD|)
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
  colorHex: string;
  colorRgb: [number, number, number];
}

/* ───────────── Catálogo de columnas ───────────── */

export interface CampoColumnaTesoreria {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  anchoPdf: number;
  anchoExcel: number;
  alineacion: 'left' | 'right' | 'center';
  formato?: 'texto' | 'numero' | 'moneda' | 'moneda_bs' | 'porcentaje';
}

export const CAMPOS_REPORTE_TESORERIA: CampoColumnaTesoreria[] = [
  { clave: 'fecha', etiqueta: 'Fecha', anchoPdf: 14, anchoExcel: 13, alineacion: 'center', formato: 'texto', descripcion: 'Fecha de emisión o ejecución' },
  { clave: 'hora', etiqueta: 'Hora', anchoPdf: 11, anchoExcel: 11, alineacion: 'center', formato: 'texto', descripcion: 'Hora exacta del registro (solo detallado)' },
  { clave: 'codigo', etiqueta: 'N° Código / Ref', anchoPdf: 18, anchoExcel: 18, alineacion: 'left', formato: 'texto', descripcion: 'Código OC/CS/SD o referencia' },
  { clave: 'operaciones', etiqueta: 'N° Operaciones', anchoPdf: 15, anchoExcel: 14, alineacion: 'center', formato: 'numero', descripcion: 'Cantidad de registros u operaciones en el grupo' },
  { clave: 'caja', etiqueta: 'Caja / Banco', anchoPdf: 20, anchoExcel: 20, alineacion: 'left', formato: 'texto', descripcion: 'Cuenta bancaria o billetera de origen' },
  { clave: 'contraparte', etiqueta: 'Proveedor / Beneficiario', anchoPdf: 26, anchoExcel: 26, alineacion: 'left', formato: 'texto', descripcion: 'Razón social de la contraparte' },
  { clave: 'tipo_mov', etiqueta: 'Tipo de Movimiento', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Ingreso, Egreso o Traslado' },
  { clave: 'categoria', etiqueta: 'Categoría de Gasto', anchoPdf: 20, anchoExcel: 20, alineacion: 'left', formato: 'texto', descripcion: 'Rubro contable / operativo' },
  { clave: 'concepto', etiqueta: 'Concepto / Motivo', anchoPdf: 28, anchoExcel: 30, alineacion: 'left', formato: 'texto', descripcion: 'Detalle descriptivo' },
  { clave: 'estado', etiqueta: 'Estado', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Lista para pagar, Pagado, A crédito' },
  { clave: 'metodo_pago', etiqueta: 'Método y Datos de Pago', anchoPdf: 26, anchoExcel: 28, alineacion: 'left', formato: 'texto', descripcion: 'Banco, cuenta, cédula/RIF destino' },
  { clave: 'monto_usd', etiqueta: 'Monto ($ USD)', anchoPdf: 16, anchoExcel: 16, alineacion: 'right', formato: 'moneda', descripcion: 'Valor expresado en Dólares' },
  { clave: 'monto_bs', etiqueta: 'Monto (Bs)', anchoPdf: 18, anchoExcel: 18, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Valor expresado en Bolívares' },
  { clave: 'monto_original', etiqueta: 'Monto Moneda Orig.', anchoPdf: 16, anchoExcel: 16, alineacion: 'right', formato: 'numero', descripcion: 'Monto en divisa original' },
  { clave: 'tasa_bcv', etiqueta: 'Tasa BCV ($/Bs)', anchoPdf: 15, anchoExcel: 14, alineacion: 'right', formato: 'numero', descripcion: 'Tasa de cambio aplicada' },
  { clave: 'pct_total', etiqueta: '% del Total', anchoPdf: 13, anchoExcel: 12, alineacion: 'right', formato: 'porcentaje', descripcion: 'Peso sobre el total del período' },
  { clave: 'saldo_caja', etiqueta: 'Saldo Resultante', anchoPdf: 16, anchoExcel: 16, alineacion: 'right', formato: 'numero', descripcion: 'Saldo tras el movimiento' },
];

export const CAMPOS_POR_DEFECTO_POR_MODO: Record<ModoAgrupacionTesoreria, string[]> = {
  caja: ['caja', 'operaciones', 'tipo_mov', 'monto_usd', 'monto_bs', 'pct_total'],
  moneda: ['monto_original', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  tipo_movimiento: ['tipo_mov', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  categoria_gasto: ['categoria', 'operaciones', 'tipo_mov', 'monto_usd', 'monto_bs', 'pct_total'],
  contraparte: ['contraparte', 'operaciones', 'categoria', 'monto_usd', 'monto_bs', 'pct_total'],
  origen_documento: ['origen_documento', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  dia: ['fecha', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  mes: ['fecha', 'operaciones', 'monto_usd', 'monto_bs', 'pct_total'],
  detallado: ['fecha', 'codigo', 'caja', 'contraparte', 'tipo_mov', 'categoria', 'estado', 'metodo_pago', 'monto_usd', 'monto_bs'],
};

/** Columnas que solo tienen sentido a nivel de transacción individual (no en resúmenes consolidados). */
export const COLUMNAS_SOLO_DETALLE_TESORERIA = ['hora', 'codigo', 'saldo_caja', 'concepto'] as const;

/**
 * Determina si una columna es aplicable según el modo de agrupación activo.
 * En agrupaciones consolidadas (Por Categoría, Caja, etc.), campos individuales
 * como Hora, Código o Saldo Resultante no tienen significado y se descartan
 * para evitar llenar la tabla con columnas de guiones vacíos ('-').
 */
export function esColumnaAplicableModoTesoreria(
  colClave: string,
  modo: ModoAgrupacionTesoreria,
): boolean {
  if (modo === 'detallado') {
    return true; // En detallado cada fila es 1 op individual
  }

  // En modos agrupados:
  if (colClave === 'hora' || colClave === 'codigo' || colClave === 'saldo_caja' || colClave === 'concepto') {
    return false;
  }
  if (colClave === 'fecha') {
    return modo === 'dia' || modo === 'mes';
  }
  return true;
}

/* ───────────── Opciones del reporte ───────────── */

export interface FiltrosTesoreria {
  cajasSel?: string[];
  monedasSel?: string[];
  tiposSel?: TipoFlujoTesoreria[];
  categoriasSel?: string[];
  contrapartesSel?: string[];
  estadosSel?: string[];
}

export interface OpcionesReporteTesoreria extends FiltrosTesoreria {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  ambito: AmbitoTesoreria;
  agrupacion: ModoAgrupacionTesoreria;
  baseTasa: BaseTasaTesoreria;
  monedaConsolidacion: MonedaConsolidacion;
  mostrarUsd: boolean;
  mostrarBs: boolean;
  columnas: string[];
  ordenarPor?: OrdenReporteTesoreria;
  incluirResumen: boolean;
  soloResumen?: boolean;
}

export type OrdenReporteTesoreria = 'usd' | 'bs' | 'fecha' | 'contraparte';

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

/** Día (YYYY-MM-DD) de un instante ISO o de una fecha ya en ese formato. */
export function diaDe(valor: string | null | undefined): string {
  const s = (valor ?? '').trim();
  if (!s) return '';
  // Ya viene como YYYY-MM-DD (o con hora pegada): tomamos los 10 primeros.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Hora (HH:mm) de un instante ISO, o null si no se puede derivar. */
export function horaDe(valor: string | null | undefined): string | null {
  const s = (valor ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(11, 16);
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
  if (moneda === 'Bs') {
    return { usd: R > 0 ? round2(k / R) : 0, bs: round2(k), tasa: R };
  }
  if (moneda === 'USD' || moneda === 'USDT') {
    // USDT se valora 1:1 con el dólar para la consolidación (cripto-dólar).
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

/** Mapea el tipo del libro al flujo de tesorería (ingreso/egreso/traslado). */
function flujoDeMovimiento(m: MovimientoCaja): TipoFlujoTesoreria {
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

const LABEL_CATEGORIA_MOV: Record<string, string> = {
  gasto: 'Gasto operativo',
  pago_personal: 'Pago a personal',
  pago_oc: 'Pago de orden',
  pago_nomina: 'Nómina',
  ingreso: 'Ingreso',
  cobro_venta: 'Cobro de venta',
  reverso_venta: 'Reverso de venta',
  reembolso_oc: 'Reembolso de orden',
  compra_directa: 'Compra directa',
  servicio_directo: 'Servicio directo',
  abono_cxp: 'Abono por pagar',
  cobro_cxc: 'Cobro por cobrar',
  combustible: 'Combustible',
  comision_bancaria: 'Comisión bancaria',
  conversion: 'Conversión',
  traslado: 'Traslado',
  venta: 'Venta',
  venta_reintegro: 'Reintegro de venta',
  venta_anulada: 'Venta anulada',
  pago_viaje_chofer: 'Pago de viaje (chofer)',
  viatico_chofer: 'Viático de chofer',
};

/** El código de la orden que paga el movimiento («Pago OC SV-2026-0021 · …»); si no, el correlativo del gasto. */
export function codigoDeMovimiento(m: Pick<MovimientoCaja, 'motivo' | 'gasto_correlativo'>): string | null {
  const cod = /\b(?:OC|SV|CD|SD|OS|SP)-\d{4}-\d{3,5}(?:-\d+)?\b/i.exec(m.motivo ?? '');
  if (cod) return cod[0].toUpperCase();
  return m.gasto_correlativo != null ? String(m.gasto_correlativo) : null;
}

/** Rubro visible de un movimiento: subcategoría de gasto > categoría de gasto > etiqueta base. */
function categoriaDeMovimiento(m: MovimientoCaja): string {
  if (m.tipo === 'ajuste') return 'Ajuste';
  const cat = (m.gasto_categoria ?? '').trim();
  if (cat) return cat;
  const base = (m.categoria ?? '').trim();
  if (base) return LABEL_CATEGORIA_MOV[base] ?? base;
  return m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso';
}

/** Tipo de documento origen de un movimiento. */
function origenDeMovimiento(m: MovimientoCaja): string {
  if (m.ref_orden_id) return 'Pago de orden';
  if ((m as unknown as { ref_venta_id?: string }).ref_venta_id) return 'Venta';
  if (m.ref_nomina_renglon_id) return 'Nómina';
  if (m.gasto_correlativo != null) return 'Gasto con correlativo';
  return 'Movimiento de caja';
}

/**
 * Normaliza los movimientos del libro mayor a filas del reporte.
 * `base` elige la valuación (BCV del día o histórica por fecha del movimiento).
 */
export function normalizarMovimientosTesoreria(
  movs: MovimientoCaja[],
  ctx: ContextoTasas,
  base: BaseTasaTesoreria = 'bcv_dia',
  /** 04/11/2026: método y datos de pago de la OC que pagó cada movimiento (por ref_orden_id). */
  pagoPorOrden?: Map<string, string>,
): FilaReporteTesoreria[] {
  return movs.map((m, idx) => {
    const pago = (m.ref_orden_id && pagoPorOrden?.get(m.ref_orden_id)) || null;
    const fecha = diaDe(m.at);
    const R = tasaDeFecha(ctx, fecha, base);
    const conv = convertirMonto(m.monto, m.moneda, R, m.tasa_bs);
    const flujo = flujoDeMovimiento(m);
    return {
      id: m.id || `mov-${idx}`,
      ambito: 'movimientos',
      fecha,
      hora: horaDe(m.at),
      codigo: codigoDeMovimiento(m),
      caja_origen: m.caja?.nombre ?? '—',
      caja_destino: m.destino ?? null,
      moneda_original: m.moneda,
      monto_original: round2(m.monto),
      tipo_movimiento: flujo,
      categoria: categoriaDeMovimiento(m),
      subcategoria: (m.gasto_subcategoria ?? null) || null,
      contraparte: (m.beneficiario ?? '').trim() || '—',
      concepto: (m.motivo ?? '').trim(),
      origen_documento: origenDeMovimiento(m),
      estado: null,
      metodo_pago: pago,
      datos_pago_resumen: pago,
      tasa_bcv_aplicada: R,
      monto_usd: conv.usd,
      monto_bs: conv.bs,
      saldo_caja_momento: m.saldo_despues ?? null,
    };
  });
}

/* ───────────── Normalizador: pendientes por pagar ───────────── */

const ORIGEN_POR_SEGMENTO: Record<ClaveSegmento, string> = {
  compras_directas: 'Compra directa',
  oc: 'Orden de compra',
  servicios: 'Control de servicio',
  servicios_directos: 'Servicio directo',
  credito: 'Crédito (orden)',
};

/**
 * Aplana el reporte de «pendientes por pagar» (ya armado, con montos en $ y Bs
 * a la tasa BCV del día) a filas del reporte. Solo los segmentos por pagar; las
 * cuentas a crédito van en el ámbito `creditos_cartera`.
 */
export function normalizarPendientesPorPagar(datos: DatosPendientesPorPagar): FilaReporteTesoreria[] {
  const fecha = diaDe(datos.generadoEn);
  const R = Number(datos.tasa) || 0;
  const filas: FilaReporteTesoreria[] = [];
  for (const seg of datos.segmentos) {
    const origen = ORIGEN_POR_SEGMENTO[seg.clave] ?? seg.titulo;
    for (let i = 0; i < seg.filas.length; i++) {
      const f = seg.filas[i];
      // 04/11/2026: todas las patas del pago (no solo la primera).
      const textoPago = f.pagos.map((l) => l.texto).filter(Boolean).join(' · ') || null;
      filas.push({
        id: `pp-${seg.clave}-${f.codigo || i}`,
        ambito: 'por_pagar',
        fecha,
        hora: null,
        codigo: f.codigo,
        caja_origen: null,
        caja_destino: null,
        moneda_original: 'USD',
        monto_original: round2(f.usd),
        tipo_movimiento: 'egreso',
        categoria: origen,
        subcategoria: null,
        contraparte: f.proveedor,
        concepto: seg.titulo,
        origen_documento: origen,
        estado: f.estado,
        metodo_pago: textoPago,
        datos_pago_resumen: textoPago,
        tasa_bcv_aplicada: R,
        monto_usd: round2(f.usd),
        monto_bs: round2(f.bs),
        saldo_caja_momento: null,
      });
    }
  }
  return filas;
}

/* ───────────── Normalizador: cuentas a crédito (cartera) ───────────── */

/**
 * Normaliza las cuentas a crédito abiertas: CxP (lo que debemos, egreso) y CxC
 * (lo que nos deben, ingreso). El saldo pendiente es monto − abonado/cobrado.
 */
export function normalizarCreditosCartera(
  cxp: CuentaPorPagar[],
  cxc: CuentaPorCobrar[],
  ctx: ContextoTasas,
  base: BaseTasaTesoreria = 'bcv_dia',
): FilaReporteTesoreria[] {
  const filas: FilaReporteTesoreria[] = [];

  for (const c of cxp) {
    if (c.estado !== 'abierta') continue;
    const saldo = round2((Number(c.monto) || 0) - (Number(c.abonado) || 0));
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
      contraparte: c.contraparte,
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
    const cobrado = Number((c as { cobrado?: number; abonado?: number }).cobrado ?? (c as { cobrado?: number; abonado?: number }).abonado ?? 0);
    const saldo = round2((Number(c.monto) || 0) - cobrado);
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
      contraparte: c.contraparte,
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

/** Filtra las filas por las selecciones de chips/checks (vacío = sin filtro). */
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
  tipo: TipoFlujoTesoreria;
  categoria: string;
  contraparte: string;
  origen: string;
  monedasUsadas: Set<string>;
  /** Valores distintos del grupo: si hay más de uno, la fila no puede mostrar solo el primero. */
  distintos: { caja: Set<string>; categoria: Set<string>; contraparte: Set<string>; origen: Set<string>; fecha: Set<string>; metodo: Set<string>; estado: Set<string>; codigo: Set<string> };
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

export const ETIQUETA_FLUJO: Record<TipoFlujoTesoreria, string> = {
  ingreso: 'Ingreso / Cobro',
  egreso: 'Egreso / Pago',
  traslado: 'Traslado entre cajas',
};

/**
 * Nombre formal y amigable de cada dimensión de agrupación para membretes y títulos.
 */
export const ETIQUETA_MODO_TESORERIA: Record<ModoAgrupacionTesoreria, string> = {
  caja: 'Caja / Banco',
  moneda: 'Moneda',
  tipo_movimiento: 'Tipo de Flujo',
  categoria_gasto: 'Categoría de Gasto',
  contraparte: 'Proveedor / Contraparte',
  origen_documento: 'Documento / Tipo de Comprobante',
  dia: 'Día / Fecha',
  mes: 'Mes / Período',
  detallado: 'Detallado (sin agrupar)',
};

/**
 * Rótulo corto para tarjetas ejecutivas (fichas).
 */
export const ROTULO_DIMENSION_TESORERIA: Record<ModoAgrupacionTesoreria, string> = {
  caja: 'Caja / Banco',
  moneda: 'Moneda',
  tipo_movimiento: 'Tipo de Flujo',
  categoria_gasto: 'Categoría',
  contraparte: 'Proveedor',
  origen_documento: 'Documento',
  dia: 'Día',
  mes: 'Mes',
  detallado: 'Movimiento',
};

export interface CabeceraTarjetaTesoreria {
  rotulo: string;
  titulo: string;
  subtitulo: string;
  tituloCompleto: string;
}

/**
 * Resuelve el rótulo explícito, el título protagónico de la dimensión y su contexto secundario
 * para que cada ficha ejecutiva responda con exactitud: ¿Por categoría, qué categoría?
 * ¿Por documento, qué documento? ¿Por tipo, qué tipo? ¿Por moneda, qué moneda?
 * ¿Por caja, qué caja? ¿Por mes, qué mes? ¿Por día, qué día?
 */
export function resolverCabeceraTarjetaTesoreria(
  f: FilaReporteTesoreria,
  modo: ModoAgrupacionTesoreria,
  fmtFechaFn: (d: string) => string = (d) => d,
  columnasClaves?: string[],
): CabeceraTarjetaTesoreria {
  let rotulo = 'Movimiento';
  let titulo = '';
  let partesSub: (string | null | undefined)[] = [];

  const permitirCampo = (clave: string) => !columnasClaves || columnasClaves.includes(clave);

  switch (modo) {
    case 'categoria_gasto': {
      rotulo = 'Categoría';
      titulo = f.categoria || f.concepto || 'Sin categoría';
      partesSub = [
        permitirCampo('contraparte') && f.contraparte && f.contraparte !== '—' ? f.contraparte : null,
        permitirCampo('origen_documento') && f.origen_documento && f.origen_documento !== titulo && f.origen_documento !== 'Sin clasificar' ? f.origen_documento : null,
        permitirCampo('caja') && f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null,
        permitirCampo('fecha') && f.fecha ? fmtFechaFn(f.fecha) : null,
      ];
      break;
    }
    case 'origen_documento': {
      rotulo = 'Documento';
      titulo = f.origen_documento || f.concepto || 'Sin documento';
      partesSub = [
        permitirCampo('categoria') && f.categoria && f.categoria !== titulo ? ('Cat: ' + f.categoria) : null,
        permitirCampo('contraparte') && f.contraparte && f.contraparte !== '—' ? f.contraparte : null,
        permitirCampo('caja') && f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null,
        permitirCampo('fecha') && f.fecha ? fmtFechaFn(f.fecha) : null,
      ];
      break;
    }
    case 'tipo_movimiento': {
      rotulo = 'Tipo de Flujo';
      titulo = ETIQUETA_FLUJO[f.tipo_movimiento] || f.tipo_movimiento;
      partesSub = [
        permitirCampo('categoria') && f.categoria ? ('Cat: ' + f.categoria) : null,
        permitirCampo('contraparte') && f.contraparte && f.contraparte !== '—' ? f.contraparte : null,
        permitirCampo('caja') && f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null,
        permitirCampo('fecha') && f.fecha ? fmtFechaFn(f.fecha) : null,
      ];
      break;
    }
    case 'moneda': {
      rotulo = 'Moneda';
      const m = (f.moneda_original || '').toUpperCase();
      titulo = m === 'USD' ? 'USD · Dólares Americanos' : (m === 'BS' ? 'Bs · Bolívares' : (f.moneda_original || 'Moneda'));
      partesSub = [
        permitirCampo('caja') && f.caja_origen && f.caja_origen !== '—' ? ('Caja: ' + f.caja_origen) : null,
        permitirCampo('categoria') && f.categoria ? ('Cat: ' + f.categoria) : null,
        permitirCampo('contraparte') && f.contraparte && f.contraparte !== '—' ? f.contraparte : null,
        permitirCampo('fecha') && f.fecha ? fmtFechaFn(f.fecha) : null,
      ];
      break;
    }
    case 'caja': {
      rotulo = 'Caja / Banco';
      titulo = f.caja_origen || 'Sin caja asignada';
      partesSub = [
        permitirCampo('moneda') && f.moneda_original && f.moneda_original !== 'Varias' ? ('Moneda: ' + f.moneda_original) : null,
        permitirCampo('categoria') && f.categoria ? ('Cat: ' + f.categoria) : null,
        permitirCampo('contraparte') && f.contraparte && f.contraparte !== '—' ? f.contraparte : null,
        permitirCampo('fecha') && f.fecha ? fmtFechaFn(f.fecha) : null,
      ];
      break;
    }
    case 'mes': {
      rotulo = 'Mes';
      titulo = f.concepto && /^[A-Z][a-z]{2}\s\d{4}$/.test(f.concepto)
        ? f.concepto
        : (f.fecha ? mesEtiqueta(f.fecha) : (f.concepto || 'Sin mes'));
      partesSub = [
        permitirCampo('categoria') && f.categoria ? ('Cat: ' + f.categoria) : null,
        permitirCampo('contraparte') && f.contraparte && f.contraparte !== '—' ? f.contraparte : null,
        permitirCampo('caja') && f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null,
      ];
      break;
    }
    case 'dia': {
      rotulo = 'Día / Fecha';
      titulo = f.fecha ? fmtFechaFn(f.fecha) : (f.concepto || 'Sin fecha');
      partesSub = [
        permitirCampo('categoria') && f.categoria ? ('Cat: ' + f.categoria) : null,
        permitirCampo('contraparte') && f.contraparte && f.contraparte !== '—' ? f.contraparte : null,
        permitirCampo('caja') && f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null,
      ];
      break;
    }
    case 'contraparte': {
      rotulo = 'Proveedor';
      titulo = f.contraparte && f.contraparte !== '—' ? f.contraparte : (f.concepto || 'Sin proveedor / beneficiario');
      partesSub = [
        permitirCampo('codigo') && f.codigo && f.codigo !== '—' ? f.codigo : null,
        permitirCampo('categoria') && f.categoria ? ('Cat: ' + f.categoria) : null,
        permitirCampo('origen_documento') && f.origen_documento ? f.origen_documento : null,
        permitirCampo('caja') && f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null,
        permitirCampo('fecha') && f.fecha ? fmtFechaFn(f.fecha) : null,
      ];
      break;
    }
    case 'detallado':
    default: {
      rotulo = permitirCampo('codigo') && f.codigo && f.codigo !== '—'
        ? ('Op: ' + f.codigo)
        : (permitirCampo('origen_documento') ? (f.origen_documento || 'Movimiento') : 'Movimiento');
      titulo = permitirCampo('contraparte') && f.contraparte && f.contraparte !== '—'
        ? f.contraparte
        : (permitirCampo('concepto') && f.concepto
          ? f.concepto
          : (permitirCampo('categoria') && f.categoria
            ? f.categoria
            : (permitirCampo('codigo') && f.codigo && f.codigo !== '—'
              ? f.codigo
              : (f.origen_documento || f.contraparte || 'Movimiento'))));
      partesSub = [
        permitirCampo('categoria') && f.categoria && f.categoria !== titulo ? ('Cat: ' + f.categoria) : null,
        permitirCampo('concepto') && f.concepto && f.concepto !== titulo ? f.concepto : null,
        permitirCampo('origen_documento') && f.origen_documento && f.origen_documento !== rotulo && f.origen_documento !== titulo ? f.origen_documento : null,
        permitirCampo('caja') && f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null,
        permitirCampo('fecha') && f.fecha ? fmtFechaFn(f.fecha) : null,
      ];
      break;
    }
  }

  const subtitulo = partesSub.filter(Boolean).join(' · ');
  const tituloCompleto = rotulo + ': ' + titulo;

  return { rotulo, titulo, subtitulo, tituloCompleto };
}

/**
 * Genera las filas del reporte según la dimensión de agrupación, más el resumen.
 * El % del total se calcula sobre el |USD| de todas las filas del período.
 * El resumen (KPIs) siempre sale del detalle completo, no de los grupos.
 */
export function procesarFilasReporteTesoreria(
  filasDetalle: FilaReporteTesoreria[],
  agrupacion: ModoAgrupacionTesoreria,
  opciones: { ordenarPor?: OrdenReporteTesoreria } = {},
): { filas: FilaReporteTesoreria[]; resumen: ResumenReporteTesoreria } {
  const ordenarPor = opciones.ordenarPor ?? 'usd';
  const tasaRef = filasDetalle.find((f) => f.tasa_bcv_aplicada > 0)?.tasa_bcv_aplicada ?? 0;
  const resumen = resumenTesoreria(filasDetalle, tasaRef);

  // El % de cada fila es relativo al total de su PROPIO tipo de flujo (egreso sobre
  // el total de egresos, etc.), coherente con el resumen: los traslados tienen su
  // propio denominador y no diluyen a egresos/ingresos.
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
        tipo: f.tipo_movimiento,
        categoria: f.categoria,
        contraparte: f.contraparte,
        origen: f.origen_documento,
        monedasUsadas: new Set<string>(),
        distintos: { caja: new Set(), categoria: new Set(), contraparte: new Set(), origen: new Set(), fecha: new Set(), metodo: new Set(), estado: new Set(), codigo: new Set() },
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
    g.distintos.caja.add(f.caja_origen ?? '');
    g.distintos.categoria.add(f.categoria ?? '');
    g.distintos.contraparte.add(f.contraparte ?? '');
    g.distintos.origen.add(f.origen_documento ?? '');
    g.distintos.fecha.add(f.fecha ?? '');
    const met = f.metodo_pago || f.datos_pago_resumen; if (met) g.distintos.metodo.add(met);
    if (f.estado) g.distintos.estado.add(f.estado);
    if (f.codigo) g.distintos.codigo.add(f.codigo);
    g.porTipo[f.tipo_movimiento] += Math.abs(f.monto_usd);
  }

  const filas: FilaReporteTesoreria[] = Array.from(mapa.values()).map((g) => {
    const monedaRep = g.monedasUsadas.size === 1 ? g.moneda : 'Varias';
    // 03/11/2026: un grupo que junta varios proveedores (o categorías, cajas, orígenes)
    // ya no se titula con el de la primera fila: dice cuántos son.
    const uno = (set: Set<string>, valor: string, plural: string) => (set.size > 1 ? `${set.size} ${plural}` : valor);
    const unico = (set: Set<string>, plural: string): string | null => (set.size === 0 ? null : set.size === 1 ? [...set][0] : `${set.size} ${plural}`);
    const dom = tipoDominante(g.porTipo);
    return {
      id: g.clave || g.etiqueta,
      ambito: filasDetalle[0]?.ambito ?? 'movimientos',
      fecha: g.distintos.fecha.size > 1 ? '' : g.fecha,
      hora: null,
      codigo: g.distintos.codigo.size === 0 ? null : [...g.distintos.codigo].join(', '),
      caja_origen: agrupacion === 'caja' ? g.etiqueta : (g.distintos.caja.size > 1 ? `${g.distintos.caja.size} cajas` : g.caja),
      caja_destino: null,
      moneda_original: monedaRep,
      monto_original: monedaRep === 'Varias' ? 0 : round2(g.original),
      tipo_movimiento: dom,
      categoria: agrupacion === 'categoria_gasto' ? g.etiqueta : uno(g.distintos.categoria, g.categoria, 'categorías'),
      subcategoria: null,
      contraparte: agrupacion === 'contraparte' ? g.etiqueta : uno(g.distintos.contraparte, g.contraparte, 'proveedores / beneficiarios'),
      concepto: agrupacion === 'categoria_gasto' ? `Consolidado (${g.operaciones} ops)` : g.etiqueta,
      origen_documento: agrupacion === 'origen_documento' ? g.etiqueta : uno(g.distintos.origen, g.origen, 'orígenes'),
      // 04/11/2026: el grupo conserva el método/datos de pago y el estado (antes salía «—»).
      estado: unico(g.distintos.estado, 'estados'),
      metodo_pago: unico(g.distintos.metodo, 'métodos de pago'),
      datos_pago_resumen: unico(g.distintos.metodo, 'métodos de pago'),
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

function ordenarFilas(filas: FilaReporteTesoreria[], ordenarPor: OrdenReporteTesoreria): void {
  switch (ordenarPor) {
    case 'bs': filas.sort((a, b) => Math.abs(b.monto_bs) - Math.abs(a.monto_bs)); break;
    case 'fecha': filas.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')); break;
    case 'contraparte': filas.sort((a, b) => a.contraparte.localeCompare(b.contraparte)); break;
    default: filas.sort((a, b) => Math.abs(b.monto_usd) - Math.abs(a.monto_usd));
  }
}

/* ───────────── Métricas de la ficha ejecutiva ───────────── */

/**
 * Métricas visibles de una ficha ejecutiva según las columnas marcadas y los
 * interruptores maestros de moneda. Si se desmarca USD (o su toggle), el
 * recuadro de dólares no aparece y se redistribuye; máximo 4 recuadros.
 */
export function obtenerMetricasFichaTesoreria(
  f: FilaReporteTesoreria,
  columnasClaves: string[],
  toggles: { mostrarUsd: boolean; mostrarBs: boolean },
): MetricaFichaTesoreria[] {
  const metricas: MetricaFichaTesoreria[] = [];
  const tasaTxt = f.tasa_bcv_aplicada > 0 ? `Tasa: Bs ${f.tasa_bcv_aplicada.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/$` : 'Sin tasa';

  // 1. Monto en USD (solo si está marcado Y el toggle maestro de USD está activo)
  if (toggles.mostrarUsd && columnasClaves.includes('monto_usd')) {
    metricas.push({
      clave: 'monto_usd',
      etiqueta: 'MONTO ($ USD)',
      valor: `$ ${f.monto_usd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: columnasClaves.includes('tasa_bcv') ? tasaTxt : undefined,
      colorHex: '#22c55e',
      colorRgb: [22, 163, 74],
    });
  }

  // 2. Monto en Bs (solo si está marcado Y el toggle maestro de Bs está activo)
  if (toggles.mostrarBs && columnasClaves.includes('monto_bs')) {
    metricas.push({
      clave: 'monto_bs',
      etiqueta: 'MONTO (Bs)',
      valor: `Bs ${f.monto_bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: undefined,
      colorHex: '#FF8A00',
      colorRgb: [255, 138, 0],
    });
  }

  // 3. Monto en moneda original (si está marcado y la moneda no es ya USD/Bs)
  if (columnasClaves.includes('monto_original') && f.moneda_original !== 'USD' && f.moneda_original !== 'Bs') {
    metricas.push({
      clave: 'monto_original',
      etiqueta: `MONTO (${f.moneda_original})`,
      valor: `${f.monto_original.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: 'Moneda original',
      colorHex: '#38bdf8',
      colorRgb: [2, 132, 199],
    });
  }

  // 4. Operaciones (SOLO si está marcado explícitamente en columnasClaves)
  if (columnasClaves.includes('operaciones') && f.total_operaciones != null) {
    metricas.push({
      clave: 'operaciones',
      etiqueta: 'OPERACIONES',
      valor: `${f.total_operaciones}`,
      sub: f.total_operaciones === 1 ? 'registro' : 'registros',
      colorHex: '#a855f7',
      colorRgb: [147, 51, 234],
    });
  }

  // 5. % del total (solo si está marcado explícitamente en columnasClaves)
  if (columnasClaves.includes('pct_total') && f.pct_del_total != null) {
    metricas.push({
      clave: 'pct_total',
      etiqueta: '% DEL TOTAL',
      valor: `${f.pct_del_total.toFixed(1)}%`,
      sub: 'del período',
      colorHex: '#eab308',
      colorRgb: [202, 138, 4],
    });
  }

  // 6. Tasa BCV aplicada (solo si está marcada explícitamente en columnasClaves)
  if (columnasClaves.includes('tasa_bcv') && f.tasa_bcv_aplicada > 0) {
    metricas.push({
      clave: 'tasa_bcv',
      etiqueta: 'TASA BCV',
      valor: `Bs ${f.tasa_bcv_aplicada.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/$`,
      sub: 'Tasa aplicada',
      colorHex: '#38bdf8',
      colorRgb: [56, 189, 248],
    });
  }

  // 7. Método y datos de pago (si está marcado)
  if (columnasClaves.includes('metodo_pago')) {
    const textoPago = (f.datos_pago_resumen || f.metodo_pago || '').trim();
    const corte = textoPago.indexOf(' — ');
    const metodo = corte >= 0 ? textoPago.slice(0, corte) : textoPago;
    const datos = corte >= 0 ? textoPago.slice(corte + 3) : '';
    metricas.push({
      clave: 'metodo_pago',
      etiqueta: 'MÉTODO Y DATOS DE PAGO',
      valor: metodo || 'Sin método cargado',
      sub: datos || undefined,
      colorHex: '#10b981',
      colorRgb: [16, 185, 129],
    });
  }

  // 8. Estado (si está marcado)
  if (columnasClaves.includes('estado')) {
    metricas.push({
      clave: 'estado',
      etiqueta: 'ESTADO',
      valor: f.estado || '—',
      colorHex: '#10b981',
      colorRgb: [16, 185, 129],
    });
  }

  // 9. Fecha
  if (columnasClaves.includes('fecha') && f.fecha) {
    const [y, m, d] = (f.fecha || '').split('-');
    const fechaFmt = y && m && d ? `${d}/${m}/${y}` : f.fecha;
    metricas.push({
      clave: 'fecha',
      etiqueta: 'FECHA',
      valor: fechaFmt,
      colorHex: '#94a3b8',
      colorRgb: [148, 163, 184],
    });
  }

  // 10. Hora (solo transacciones con hora)
  if (columnasClaves.includes('hora') && f.hora) {
    metricas.push({
      clave: 'hora',
      etiqueta: 'HORA',
      valor: f.hora,
      colorHex: '#94a3b8',
      colorRgb: [148, 163, 184],
    });
  }

  // 11. Código / Ref
  if (columnasClaves.includes('codigo') && (f.codigo || f.origen_documento)) {
    metricas.push({
      clave: 'codigo',
      etiqueta: 'N° CÓDIGO / REF',
      valor: f.codigo && f.codigo !== '—' ? f.codigo : (f.origen_documento || '—'),
      colorHex: '#6366f1',
      colorRgb: [99, 102, 241],
    });
  }

  // 12. Caja / Banco
  if (columnasClaves.includes('caja') && (f.caja_origen || f.caja_destino)) {
    metricas.push({
      clave: 'caja',
      etiqueta: 'CAJA / BANCO',
      valor: f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : (f.caja_destino || '—'),
      colorHex: '#0284c7',
      colorRgb: [2, 132, 199],
    });
  }

  // 13. Proveedor / Beneficiario (Contraparte)
  if (columnasClaves.includes('contraparte') && f.contraparte) {
    metricas.push({
      clave: 'contraparte',
      etiqueta: 'PROVEEDOR / BENEFICIARIO',
      valor: f.contraparte,
      colorHex: '#ea580c',
      colorRgb: [234, 88, 12],
    });
  }

  // 14. Tipo de Movimiento (Flujo)
  if (columnasClaves.includes('tipo_mov') && f.tipo_movimiento) {
    const acentoHex = f.tipo_movimiento === 'ingreso' ? '#10b981' : f.tipo_movimiento === 'traslado' ? '#38bdf8' : '#FF8A00';
    const acentoRgb: [number, number, number] = f.tipo_movimiento === 'ingreso' ? [16, 185, 129] : f.tipo_movimiento === 'traslado' ? [56, 189, 248] : [255, 138, 0];
    metricas.push({
      clave: 'tipo_mov',
      etiqueta: 'TIPO DE FLUJO',
      valor: ETIQUETA_FLUJO[f.tipo_movimiento] || f.tipo_movimiento,
      colorHex: acentoHex,
      colorRgb: acentoRgb,
    });
  }

  // 15. Categoría de Gasto
  if (columnasClaves.includes('categoria') && f.categoria) {
    metricas.push({
      clave: 'categoria',
      etiqueta: 'CATEGORÍA DE GASTO',
      valor: f.categoria,
      colorHex: '#d97706',
      colorRgb: [217, 119, 6],
    });
  }

  // 16. Concepto / Motivo
  if (columnasClaves.includes('concepto') && f.concepto) {
    metricas.push({
      clave: 'concepto',
      etiqueta: 'CONCEPTO / MOTIVO',
      valor: f.concepto,
      colorHex: '#64748b',
      colorRgb: [100, 116, 139],
    });
  }

  // 17. Saldo Resultante
  if (columnasClaves.includes('saldo_caja') && f.saldo_caja_momento != null) {
    metricas.push({
      clave: 'saldo_caja',
      etiqueta: 'SALDO RESULTANTE',
      valor: `$ ${f.saldo_caja_momento.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      colorHex: '#38bdf8',
      colorRgb: [56, 189, 248],
    });
  }

  // Respaldo de seguridad ejecutiva: ÚNICAMENTE si no se especificaron columnas (array vacío)
  if (columnasClaves.length === 0 && metricas.length === 0) {
    if (toggles.mostrarUsd) {
      metricas.push({
        clave: 'monto_usd',
        etiqueta: 'MONTO ($ USD)',
        valor: `$ ${f.monto_usd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        sub: tasaTxt,
        colorHex: '#22c55e',
        colorRgb: [22, 163, 74],
      });
    } else if (toggles.mostrarBs) {
      metricas.push({
        clave: 'monto_bs',
        etiqueta: 'MONTO (Bs)',
        valor: `Bs ${f.monto_bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        sub: 'Total consolidado',
        colorHex: '#FF8A00',
        colorRgb: [255, 138, 0],
      });
    } else {
      metricas.push({
        clave: 'monto_usd',
        etiqueta: 'MONTO ($ USD)',
        valor: `$ ${f.monto_usd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        sub: tasaTxt,
        colorHex: '#22c55e',
        colorRgb: [22, 163, 74],
      });
    }
  }

  return metricas;
}


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
export function rangoPresetTesoreria(preset: PresetRangoTesoreria, hoyIso: string): { desde: string; hasta: string } {
  const [y, m] = (hoyIso || '').split('-');
  const anio = Number(y) || new Date().getFullYear();
  const mes = Number(m) || (new Date().getMonth() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (preset) {
    case 'hoy': return { desde: hoyIso, hasta: hoyIso };
    case 'ayer': {
      const d = new Date(hoyIso + 'T12:00:00Z');
      d.setDate(d.getDate() - 1);
      const ayer = d.toISOString().slice(0, 10);
      return { desde: ayer, hasta: ayer };
    }
    case 'mes': return { desde: `${anio}-${pad(mes)}-01`, hasta: hoyIso };
    case 'mes_anterior': {
      const mAnt = mes === 1 ? 12 : mes - 1;
      const aAnt = mes === 1 ? anio - 1 : anio;
      const ultDia = new Date(aAnt, mAnt, 0).getDate();
      return { desde: `${aAnt}-${pad(mAnt)}-01`, hasta: `${aAnt}-${pad(mAnt)}-${pad(ultDia)}` };
    }
    case 'ult30': {
      const d = new Date(hoyIso + 'T12:00:00Z');
      d.setDate(d.getDate() - 30);
      return { desde: d.toISOString().slice(0, 10), hasta: hoyIso };
    }
    case 'ult90': {
      const d = new Date(hoyIso + 'T12:00:00Z');
      d.setDate(d.getDate() - 90);
      return { desde: d.toISOString().slice(0, 10), hasta: hoyIso };
    }
    case 'anio': return { desde: `${anio}-01-01`, hasta: hoyIso };
  }
}
