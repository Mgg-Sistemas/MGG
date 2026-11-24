/* ============================================================
   Golden Touch · Contabilidad · Motor del Reporte Dinámico
   (18/11/2026)

   Motor de datos PURO, DETERMINISTA y SÍNCRONO para el reporte
   dinámico del módulo de Contabilidad. Sigue el estándar de los
   reportes dinámicos del sistema (Compras, Administración):
     1. Asientos y Movimientos (análisis analítico transaccional bimoneda).
     2. Plan de Cuentas (catálogo estructural jerárquico, niveles y atributos).
     3. Balances y Saldos (balance de comprobación dinámico con partida doble).
     4. Períodos y Cierres (auditoría mensual de ejercicios, cierres y diferencial AJ).

   REGLA ARQUITECTÓNICA: Aquí NO se hacen llamadas a Supabase ni
   efectos colaterales. Recibe la fuente y devuelve los datos listos.
   ============================================================ */

import type {
  ContAuxiliar, ContCentroCosto, ContCierre, ContComprobante, ContComprobanteLinea,
  ContCuenta, ContEjercicio, ContPeriodo, ContTipoComprobante, Moneda,
} from '../tipos';
import {
  balanceComprobacion, balanceConEquivalente,
} from './reportes';
import {
  codigoPadre, nivelDe, NOMBRE_CLASE, NOMBRE_NATURALEZA,
} from './planCuentas';
import { nombreTipoAuxiliar } from './catalogos';

/* ───────────── Ámbitos del reporte contable ───────────── */

export type AmbitoReporteContable = 'asientos' | 'cuentas' | 'balances' | 'periodos';

export interface InfoAmbitoContable {
  id: AmbitoReporteContable;
  icon: string;
  label: string;
  desc: string;
}

export const AMBITOS_REPORTE_CONTABLE: InfoAmbitoContable[] = [
  { id: 'asientos', icon: '📑', label: 'Asientos y Movimientos', desc: 'Análisis analítico transaccional bimoneda por comprobante, cuenta y centro' },
  { id: 'cuentas', icon: '🗂', label: 'Plan de Cuentas', desc: 'Catálogo estructural de cuentas, niveles 1 al 5, naturalezas y requisitos' },
  { id: 'balances', icon: '⚖', label: 'Balances y Saldos', desc: 'Balance de comprobación analítico con saldos iniciales, movimientos y finales' },
  { id: 'periodos', icon: '📅', label: 'Períodos y Cierres', desc: 'Control de meses abiertos, cierres mensuales, diferencial cambiario y auditoría' },
];

/* ───────────── Modos de agrupación y presets ───────────── */

export type ModoAgrupacionContable =
  | 'comprobante'
  | 'cuenta'
  | 'centro'
  | 'auxiliar'
  | 'tipo'
  | 'detallado';

export const MODOS_AGRUPACION_CONTABLE: { id: ModoAgrupacionContable; icon: string; label: string }[] = [
  { id: 'comprobante', icon: '📑', label: 'Por Comprobante' },
  { id: 'cuenta', icon: '📒', label: 'Por Cuenta Contable' },
  { id: 'centro', icon: '🏢', label: 'Por Centro de Costo' },
  { id: 'auxiliar', icon: '👥', label: 'Por Tercero / Auxiliar' },
  { id: 'tipo', icon: '🏷️', label: 'Por Tipo de Comprobante' },
  { id: 'detallado', icon: '📋', label: 'Detallado (Asiento por Asiento)' },
];

export const ETIQUETA_MODO_CONTABLE: Record<ModoAgrupacionContable, string> = {
  comprobante: 'Comprobante',
  cuenta: 'Cuenta Contable',
  centro: 'Centro de Costo',
  auxiliar: 'Tercero / Auxiliar',
  tipo: 'Tipo de Comprobante',
  detallado: 'Detallado',
};

export type PresetPeriodoContable =
  | 'mes_actual'
  | 'mes_anterior'
  | 'ejercicio'
  | 'este_ano'
  | 'todos'
  | 'personalizado';

/* ───────────── Catálogo de columnas seleccionables ───────────── */

export interface CampoColumnaContable {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  anchoPdf: number;
  anchoExcel: number;
  alineacion: 'left' | 'right' | 'center';
  formato?: 'texto' | 'numero' | 'moneda' | 'moneda_bs';
}

/** Columnas para Asientos y Movimientos */
export const CAMPOS_REPORTE_ASIENTOS: CampoColumnaContable[] = [
  { clave: 'fecha', etiqueta: 'Fecha', anchoPdf: 14, anchoExcel: 13, alineacion: 'center', formato: 'texto', descripcion: 'Fecha del comprobante' },
  { clave: 'comprobante', etiqueta: 'Comprobante', anchoPdf: 16, anchoExcel: 15, alineacion: 'center', formato: 'texto', descripcion: 'Código correlativo oficial (Mes-Consecutivo)' },
  { clave: 'tipo', etiqueta: 'Tipo', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Tipo de comprobante oficial' },
  { clave: 'origen', etiqueta: 'Generado Por', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Módulo de origen o Usuario' },
  { clave: 'referencia', etiqueta: 'N° Doc. Origen', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Documento o soporte de origen' },
  { clave: 'descripcion', etiqueta: 'Descripción', anchoPdf: 32, anchoExcel: 30, alineacion: 'left', formato: 'texto', descripcion: 'Concepto del comprobante o renglón' },
  { clave: 'cuenta_codigo', etiqueta: 'Código Cuenta', anchoPdf: 18, anchoExcel: 18, alineacion: 'left', formato: 'texto', descripcion: 'Código contable estructurado' },
  { clave: 'cuenta_nombre', etiqueta: 'Nombre Cuenta', anchoPdf: 28, anchoExcel: 26, alineacion: 'left', formato: 'texto', descripcion: 'Descripción de la cuenta contable' },
  { clave: 'centro', etiqueta: 'Centro de Costo', anchoPdf: 20, anchoExcel: 20, alineacion: 'left', formato: 'texto', descripcion: 'Centro o faena operativa asignada' },
  { clave: 'auxiliar', etiqueta: 'Tercero / Auxiliar', anchoPdf: 22, anchoExcel: 22, alineacion: 'left', formato: 'texto', descripcion: 'Tercero, proveedor o beneficiario' },
  { clave: 'moneda', etiqueta: 'Moneda Doc.', anchoPdf: 12, anchoExcel: 12, alineacion: 'center', formato: 'texto', descripcion: 'Moneda de la transacción' },
  { clave: 'debe_ves', etiqueta: 'Debe (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Cargos en moneda funcional (VES)' },
  { clave: 'haber_ves', etiqueta: 'Haber (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Abonos en moneda funcional (VES)' },
  { clave: 'debe_usd', etiqueta: 'Debe ($)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda', descripcion: 'Cargos en moneda referencial (USD)' },
  { clave: 'haber_usd', etiqueta: 'Haber ($)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda', descripcion: 'Abonos en moneda referencial (USD)' },
  { clave: 'saldo_ves', etiqueta: 'Saldo (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Saldo acumulado en VES (Debe - Haber)' },
  { clave: 'saldo_usd', etiqueta: 'Saldo ($)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda', descripcion: 'Saldo acumulado en USD (Debe - Haber)' },
];

export const CLAVES_COLUMNAS_ASIENTOS_DEFECTO: string[] = [
  'fecha',
  'comprobante',
  'cuenta_codigo',
  'cuenta_nombre',
  'descripcion',
  'debe_ves',
  'haber_ves',
  'debe_usd',
  'haber_usd',
];

/** Columnas para Plan de Cuentas */
export const CAMPOS_REPORTE_CUENTAS: CampoColumnaContable[] = [
  { clave: 'cuenta_codigo', etiqueta: 'Código Cuenta', anchoPdf: 18, anchoExcel: 18, alineacion: 'left', formato: 'texto', descripcion: 'Código estructurado de la cuenta' },
  { clave: 'cuenta_nombre', etiqueta: 'Nombre de Cuenta', anchoPdf: 32, anchoExcel: 30, alineacion: 'left', formato: 'texto', descripcion: 'Descripción o denominación contable' },
  { clave: 'nivel', etiqueta: 'Nivel', anchoPdf: 10, anchoExcel: 10, alineacion: 'center', formato: 'numero', descripcion: 'Nivel jerárquico (1 al 5)' },
  { clave: 'clase', etiqueta: 'Clase', anchoPdf: 16, anchoExcel: 16, alineacion: 'left', formato: 'texto', descripcion: 'Activo, Pasivo, Patrimonio, etc.' },
  { clave: 'naturaleza', etiqueta: 'Naturaleza', anchoPdf: 14, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Deudora o Acreedora' },
  { clave: 'moneda', etiqueta: 'Moneda', anchoPdf: 12, anchoExcel: 12, alineacion: 'center', formato: 'texto', descripcion: 'Moneda asignada a la cuenta' },
  { clave: 'es_monetaria', etiqueta: 'Monetaria', anchoPdf: 12, anchoExcel: 12, alineacion: 'center', formato: 'texto', descripcion: 'Sujeta a revaluación por diferencial cambiario' },
  { clave: 'exige_centro', etiqueta: 'Exige Centro C.', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Obliga a imputar un centro de costo' },
  { clave: 'exige_auxiliar', etiqueta: 'Exige Auxiliar', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Obliga a imputar tercero o auxiliar' },
  { clave: 'tipo_auxiliar', etiqueta: 'Tipo Auxiliar', anchoPdf: 16, anchoExcel: 16, alineacion: 'left', formato: 'texto', descripcion: 'Proveedor, cliente, empleado u otro' },
  { clave: 'activa', etiqueta: 'Estado', anchoPdf: 12, anchoExcel: 12, alineacion: 'center', formato: 'texto', descripcion: 'Activa o inactiva' },
  { clave: 'padre_codigo', etiqueta: 'Cuenta Padre', anchoPdf: 16, anchoExcel: 16, alineacion: 'left', formato: 'texto', descripcion: 'Código de la cuenta superior inmediata' },
];

export const CLAVES_COLUMNAS_CUENTAS_DEFECTO: string[] = [
  'cuenta_codigo',
  'cuenta_nombre',
  'nivel',
  'clase',
  'naturaleza',
  'moneda',
  'exige_centro',
  'exige_auxiliar',
  'activa',
];

/** Columnas para Balances y Saldos */
export const CAMPOS_REPORTE_BALANCES: CampoColumnaContable[] = [
  { clave: 'cuenta_codigo', etiqueta: 'Código Cuenta', anchoPdf: 18, anchoExcel: 18, alineacion: 'left', formato: 'texto', descripcion: 'Código contable' },
  { clave: 'cuenta_nombre', etiqueta: 'Nombre Cuenta', anchoPdf: 30, anchoExcel: 28, alineacion: 'left', formato: 'texto', descripcion: 'Descripción contable' },
  { clave: 'nivel', etiqueta: 'Nivel', anchoPdf: 10, anchoExcel: 10, alineacion: 'center', formato: 'numero', descripcion: 'Nivel de la cuenta' },
  { clave: 'saldo_inicial_ves', etiqueta: 'Saldo Inicial (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Saldo al inicio del período en Bs' },
  { clave: 'debe_ves', etiqueta: 'Debe (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Cargos del período en Bs' },
  { clave: 'haber_ves', etiqueta: 'Haber (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Abonos del período en Bs' },
  { clave: 'saldo_final_ves', etiqueta: 'Saldo Final (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Saldo final resultante en Bs' },
  { clave: 'saldo_inicial_usd', etiqueta: 'Saldo Inicial ($)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda', descripcion: 'Saldo inicial en dólares' },
  { clave: 'debe_usd', etiqueta: 'Debe ($)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda', descripcion: 'Cargos del período en dólares' },
  { clave: 'haber_usd', etiqueta: 'Haber ($)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda', descripcion: 'Abonos del período en dólares' },
  { clave: 'saldo_final_usd', etiqueta: 'Saldo Final ($)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda', descripcion: 'Saldo final resultante en dólares' },
];

export const CLAVES_COLUMNAS_BALANCES_DEFECTO: string[] = [
  'cuenta_codigo',
  'cuenta_nombre',
  'nivel',
  'saldo_inicial_ves',
  'debe_ves',
  'haber_ves',
  'saldo_final_ves',
  'saldo_final_usd',
];

/** Columnas para Períodos y Cierres */
export const CAMPOS_REPORTE_PERIODOS: CampoColumnaContable[] = [
  { clave: 'ejercicio', etiqueta: 'Ejercicio', anchoPdf: 14, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Año o ejercicio fiscal' },
  { clave: 'periodo_numero', etiqueta: 'N° Mes', anchoPdf: 10, anchoExcel: 10, alineacion: 'center', formato: 'numero', descripcion: 'Número de mes (1 al 12, 13)' },
  { clave: 'periodo_nombre', etiqueta: 'Nombre Período', anchoPdf: 22, anchoExcel: 22, alineacion: 'left', formato: 'texto', descripcion: 'Mes o período correspondiente' },
  { clave: 'fecha_inicio', etiqueta: 'Fecha Inicio', anchoPdf: 14, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Primer día del período' },
  { clave: 'fecha_fin', etiqueta: 'Fecha Corte', anchoPdf: 14, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Último día del período' },
  { clave: 'periodo_estado', etiqueta: 'Estado', anchoPdf: 14, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Abierto, Cerrado o Pre-cierre' },
  { clave: 'fecha_cierre', etiqueta: 'Fecha de Cierre', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Momento en que se ejecutó el cierre' },
  { clave: 'cerrado_por', etiqueta: 'Cerrado Por', anchoPdf: 20, anchoExcel: 20, alineacion: 'left', formato: 'texto', descripcion: 'Usuario responsable del cierre' },
  { clave: 'diferencial_aj_ves', etiqueta: 'Diferencial AJ (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Asiento de ajuste por tipo de cambio en Bs' },
  { clave: 'diferencial_aj_usd', etiqueta: 'Diferencial AJ ($)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda', descripcion: 'Asiento de ajuste en dólares' },
  { clave: 'comprobantes_count', etiqueta: 'N° Comprobantes', anchoPdf: 14, anchoExcel: 14, alineacion: 'right', formato: 'numero', descripcion: 'Comprobantes emitidos en el mes' },
  { clave: 'debe_ves', etiqueta: 'Total Debe (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Total de cargos en el período' },
  { clave: 'haber_ves', etiqueta: 'Total Haber (Bs)', anchoPdf: 18, anchoExcel: 17, alineacion: 'right', formato: 'moneda_bs', descripcion: 'Total de abonos en el período' },
];

export const CLAVES_COLUMNAS_PERIODOS_DEFECTO: string[] = [
  'ejercicio',
  'periodo_numero',
  'periodo_nombre',
  'fecha_inicio',
  'fecha_fin',
  'periodo_estado',
  'diferencial_aj_ves',
  'comprobantes_count',
  'debe_ves',
  'haber_ves',
];

// Compatibilidad retroactiva
export const CAMPOS_REPORTE_CONTABLE = CAMPOS_REPORTE_ASIENTOS;
export const CLAVES_COLUMNAS_DEFECTO = CLAVES_COLUMNAS_ASIENTOS_DEFECTO;

export function obtenerCamposPorAmbito(ambito: AmbitoReporteContable = 'asientos'): CampoColumnaContable[] {
  switch (ambito) {
    case 'cuentas': return CAMPOS_REPORTE_CUENTAS;
    case 'balances': return CAMPOS_REPORTE_BALANCES;
    case 'periodos': return CAMPOS_REPORTE_PERIODOS;
    case 'asientos':
    default:
      return CAMPOS_REPORTE_ASIENTOS;
  }
}

export function obtenerColumnasDefectoPorAmbito(ambito: AmbitoReporteContable = 'asientos'): string[] {
  switch (ambito) {
    case 'cuentas': return CLAVES_COLUMNAS_CUENTAS_DEFECTO;
    case 'balances': return CLAVES_COLUMNAS_BALANCES_DEFECTO;
    case 'periodos': return CLAVES_COLUMNAS_PERIODOS_DEFECTO;
    case 'asientos':
    default:
      return CLAVES_COLUMNAS_ASIENTOS_DEFECTO;
  }
}

/* ───────────── Estructura de filas del reporte ───────────── */

export interface FilaReporteContable {
  id: string;
  ambito?: AmbitoReporteContable;
  linea_id: string;
  comprobante_id: string;
  fecha: string;
  comprobante: string;
  tipo: string;
  tipo_id: string;
  origen: string;
  referencia: string;
  descripcion: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  centro: string;
  auxiliar: string;
  auxiliar_rif: string | null;
  moneda: Moneda | string | null;
  monto_moneda: number;
  tasa: number;
  debe_ves: number;
  haber_ves: number;
  debe_usd: number;
  haber_usd: number;
  saldo_ves: number;
  saldo_usd: number;

  // Campos específicos de Plan de Cuentas:
  nivel?: number;
  clase?: string;
  naturaleza?: string;
  es_monetaria?: string;
  exige_centro?: string;
  exige_auxiliar?: string;
  tipo_auxiliar?: string;
  activa?: string;
  padre_codigo?: string;

  // Campos específicos de Balances:
  saldo_inicial_ves?: number;
  saldo_final_ves?: number;
  saldo_inicial_usd?: number;
  saldo_final_usd?: number;

  // Campos específicos de Períodos:
  ejercicio?: string;
  periodo_numero?: number;
  periodo_nombre?: string;
  periodo_estado?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  fecha_cierre?: string;
  cerrado_por?: string;
  diferencial_aj_ves?: number;
  diferencial_aj_usd?: number;
  comprobantes_count?: number;
}

export interface GrupoReporteContable {
  clave: string;
  etiqueta: string;
  subetiqueta?: string;
  totalAsientos: number;
  debe_ves: number;
  haber_ves: number;
  debe_usd: number;
  haber_usd: number;
  saldo_ves: number;
  saldo_usd: number;
  filas: FilaReporteContable[];
}

export interface ResumenReporteContable {
  ambito: AmbitoReporteContable;
  totalComprobantes: number;
  totalAsientos: number;
  totalDebeVes: number;
  totalHaberVes: number;
  totalDebeUsd: number;
  totalHaberUsd: number;
  diferenciaVes: number;
  diferenciaUsd: number;
  cuadra: boolean;
  porTipo: Array<{ tipo: string; cantidad: number; totalVes: number; totalUsd: number }>;
  topCuentas: Array<{ codigo: string; nombre: string; movimientoVes: number; movimientoUsd: number }>;

  // Métricas de Cuentas:
  totalCuentas?: number;
  cuentasActivas?: number;
  cuentasInactivas?: number;
  cuentasMovimiento?: number;
  maxNivel?: number;

  // Métricas de Balances:
  totalSaldoInicialVes?: number;
  totalSaldoFinalVes?: number;
  totalSaldoInicialUsd?: number;
  totalSaldoFinalUsd?: number;

  // Métricas de Períodos:
  mesesAbiertos?: number;
  mesesCerrados?: number;
  totalDiferencialAjVes?: number;
  totalDiferencialAjUsd?: number;
}

export interface ReporteContableGenerado {
  grupos: GrupoReporteContable[];
  filas: FilaReporteContable[];
  resumen: ResumenReporteContable;
  config: ConfiguracionFiltroContable;
}

export interface ConfiguracionFiltroContable {
  ambito?: AmbitoReporteContable;
  empresaClave: string;
  empresaNombre?: string;
  empresaRif?: string | null;
  desde: string;
  hasta: string;
  agrupacion: ModoAgrupacionContable;
  columnasVisibles: string[];
  soloContabilizados?: boolean;
  tipoComprobanteId?: string;
  cuentaId?: string;
  centroCostoId?: string;
  auxiliarId?: string;
  busqueda?: string;
  monedaVista?: 'todas' | 'VES' | 'USD';

  // Filtros de Cuentas:
  nivelCuentas?: number;
  claseCuenta?: string;
  naturalezaCuenta?: string;
  soloCuentasActivas?: boolean;

  // Filtros de Balances:
  nivelBalance?: number;
  incluirSinMovimiento?: boolean;

  // Filtros de Períodos:
  ejercicioId?: string;
  estadoPeriodo?: string;
}

export interface FuenteReporteContable {
  comprobantes: ContComprobante[];
  lineas: ContComprobanteLinea[];
  cuentas: ContCuenta[];
  centros?: ContCentroCosto[];
  auxiliares?: ContAuxiliar[];
  tipos: ContTipoComprobante[];
  periodos?: ContPeriodo[];
  ejercicios?: ContEjercicio[];
  cierres?: ContCierre[];
}

const MESES_NOMBRES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/* ───────────── Motor de datos del reporte ───────────── */

export function generarReporteContableDinamico(
  fuente: FuenteReporteContable,
  config: ConfiguracionFiltroContable,
): ReporteContableGenerado {
  const ambito: AmbitoReporteContable = config.ambito ?? 'asientos';

  if (ambito === 'cuentas') {
    return generarReportePlanCuentas(fuente, config);
  }
  if (ambito === 'balances') {
    return generarReporteBalances(fuente, config);
  }
  if (ambito === 'periodos') {
    return generarReportePeriodos(fuente, config);
  }

  // Por omisión: Asientos y Movimientos
  return generarReporteAsientos(fuente, config);
}

/* ───────────── Sub-motor 1: Asientos y Movimientos ───────────── */

function generarReporteAsientos(
  fuente: FuenteReporteContable,
  config: ConfiguracionFiltroContable,
): ReporteContableGenerado {
  const mapaTipos = new Map(fuente.tipos.map((t) => [t.id, t]));
  const mapaCuentas = new Map(fuente.cuentas.map((c) => [c.id, c]));
  const mapaCentros = new Map((fuente.centros ?? []).map((c) => [c.id, c]));
  const mapaAuxiliares = new Map((fuente.auxiliares ?? []).map((a) => [a.id, a]));

  const comprobantesFiltrados = fuente.comprobantes.filter((c) => {
    if (config.empresaClave && (c as any).empresa_clave && (c as any).empresa_clave !== config.empresaClave) return false;
    if (c.fecha < config.desde || c.fecha > config.hasta) return false;
    if (config.soloContabilizados && c.estado !== 'contabilizado') return false;
    if (config.tipoComprobanteId && c.tipo_id !== config.tipoComprobanteId) return false;
    return true;
  });

  const idsComprobantesValidos = new Set(comprobantesFiltrados.map((c) => c.id));
  const mapaComprobantes = new Map(comprobantesFiltrados.map((c) => [c.id, c]));

  let lineasFiltradas = fuente.lineas.filter((l) => idsComprobantesValidos.has(l.comprobante_id));

  if (config.cuentaId) {
    lineasFiltradas = lineasFiltradas.filter((l) => l.cuenta_id === config.cuentaId);
  }
  if (config.centroCostoId) {
    lineasFiltradas = lineasFiltradas.filter((l) => l.centro_costo_id === config.centroCostoId);
  }
  if (config.auxiliarId) {
    lineasFiltradas = lineasFiltradas.filter((l) => l.auxiliar_id === config.auxiliarId);
  }
  if (config.monedaVista && config.monedaVista !== 'todas') {
    lineasFiltradas = lineasFiltradas.filter((l) => l.moneda === config.monedaVista);
  }

  const busqueda = (config.busqueda ?? '').trim().toLowerCase();

  const filas: FilaReporteContable[] = [];
  for (const l of lineasFiltradas) {
    const cbte = mapaComprobantes.get(l.comprobante_id);
    if (!cbte) continue;

    const tipo = mapaTipos.get(cbte.tipo_id);
    const cuenta = mapaCuentas.get(l.cuenta_id);
    const centro = l.centro_costo_id ? mapaCentros.get(l.centro_costo_id) : null;
    const auxiliar = l.auxiliar_id ? mapaAuxiliares.get(l.auxiliar_id) : null;

    const fila: FilaReporteContable = {
      id: `${cbte.id}-${l.id}`,
      ambito: 'asientos',
      linea_id: l.id,
      comprobante_id: cbte.id,
      fecha: cbte.fecha,
      comprobante: cbte.codigo,
      tipo: tipo ? `${tipo.codigo} · ${tipo.nombre}` : '—',
      tipo_id: cbte.tipo_id,
      origen: cbte.origen_modulo ? `Módulo ${cbte.origen_modulo.toUpperCase()}` : (cbte.created_by || 'Manual'),
      referencia: l.referencia || cbte.origen_ref || '—',
      descripcion: l.descripcion || cbte.concepto,
      cuenta_codigo: cuenta?.codigo || '—',
      cuenta_nombre: cuenta?.nombre || '—',
      centro: centro ? `${centro.codigo} · ${centro.nombre}` : '—',
      auxiliar: auxiliar ? `${auxiliar.codigo} · ${auxiliar.nombre}` : '—',
      auxiliar_rif: auxiliar?.rif || null,
      moneda: l.moneda,
      monto_moneda: l.monto_moneda,
      tasa: l.tasa,
      debe_ves: l.debe_ves,
      haber_ves: l.haber_ves,
      debe_usd: l.debe_usd,
      haber_usd: l.haber_usd,
      saldo_ves: l.debe_ves - l.haber_ves,
      saldo_usd: l.debe_usd - l.haber_usd,
    };

    if (busqueda) {
      const match =
        fila.comprobante.toLowerCase().includes(busqueda) ||
        fila.descripcion.toLowerCase().includes(busqueda) ||
        fila.cuenta_codigo.toLowerCase().includes(busqueda) ||
        fila.cuenta_nombre.toLowerCase().includes(busqueda) ||
        fila.centro.toLowerCase().includes(busqueda) ||
        fila.auxiliar.toLowerCase().includes(busqueda) ||
        fila.referencia.toLowerCase().includes(busqueda);
      if (!match) continue;
    }

    filas.push(fila);
  }

  filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.comprobante.localeCompare(b.comprobante));

  const mapaGrupos = new Map<string, GrupoReporteContable>();
  for (const fila of filas) {
    let clave = '';
    let etiqueta = '';
    let subetiqueta: string | undefined;

    switch (config.agrupacion) {
      case 'comprobante':
        clave = fila.comprobante_id;
        etiqueta = `${fila.comprobante} · ${fila.fecha}`;
        subetiqueta = `${fila.tipo} · ${fila.origen}`;
        break;
      case 'cuenta':
        clave = fila.cuenta_codigo;
        etiqueta = `${fila.cuenta_codigo} · ${fila.cuenta_nombre}`;
        break;
      case 'centro':
        clave = fila.centro;
        etiqueta = fila.centro !== '—' ? fila.centro : 'Sin Centro de Costo';
        break;
      case 'auxiliar':
        clave = fila.auxiliar;
        etiqueta = fila.auxiliar !== '—' ? fila.auxiliar : 'Sin Tercero Asignado';
        break;
      case 'tipo':
        clave = fila.tipo_id;
        etiqueta = fila.tipo;
        break;
      case 'detallado':
      default:
        clave = 'TODOS';
        etiqueta = 'Todos los asientos';
        break;
    }

    let g = mapaGrupos.get(clave);
    if (!g) {
      g = {
        clave,
        etiqueta,
        subetiqueta,
        totalAsientos: 0,
        debe_ves: 0,
        haber_ves: 0,
        debe_usd: 0,
        haber_usd: 0,
        saldo_ves: 0,
        saldo_usd: 0,
        filas: [],
      };
      mapaGrupos.set(clave, g);
    }

    g.totalAsientos++;
    g.debe_ves += fila.debe_ves;
    g.haber_ves += fila.haber_ves;
    g.debe_usd += fila.debe_usd;
    g.haber_usd += fila.haber_usd;
    g.saldo_ves += fila.saldo_ves;
    g.saldo_usd += fila.saldo_usd;
    g.filas.push(fila);
  }

  const grupos = Array.from(mapaGrupos.values());

  let totalDebeVes = 0;
  let totalHaberVes = 0;
  let totalDebeUsd = 0;
  let totalHaberUsd = 0;
  const mapaTiposTotales = new Map<string, { tipo: string; cantidad: number; totalVes: number; totalUsd: number }>();
  const mapaCuentasTotales = new Map<string, { codigo: string; nombre: string; movimientoVes: number; movimientoUsd: number }>();

  for (const f of filas) {
    totalDebeVes += f.debe_ves;
    totalHaberVes += f.haber_ves;
    totalDebeUsd += f.debe_usd;
    totalHaberUsd += f.haber_usd;

    const tObj = mapaTiposTotales.get(f.tipo) ?? { tipo: f.tipo, cantidad: 0, totalVes: 0, totalUsd: 0 };
    tObj.cantidad++;
    tObj.totalVes += f.debe_ves + f.haber_ves;
    tObj.totalUsd += f.debe_usd + f.haber_usd;
    mapaTiposTotales.set(f.tipo, tObj);

    const cObj = mapaCuentasTotales.get(f.cuenta_codigo) ?? { codigo: f.cuenta_codigo, nombre: f.cuenta_nombre, movimientoVes: 0, movimientoUsd: 0 };
    cObj.movimientoVes += f.debe_ves + f.haber_ves;
    cObj.movimientoUsd += f.debe_usd + f.haber_usd;
    mapaCuentasTotales.set(f.cuenta_codigo, cObj);
  }

  const difVes = Math.abs(totalDebeVes - totalHaberVes);
  const difUsd = Math.abs(totalDebeUsd - totalHaberUsd);
  const cuadra = difVes <= 0.05 && difUsd <= 0.05;

  const topCuentas = Array.from(mapaCuentasTotales.values())
    .sort((a, b) => b.movimientoVes - a.movimientoVes)
    .slice(0, 5);

  const resumen: ResumenReporteContable = {
    ambito: 'asientos',
    totalComprobantes: new Set(filas.map((f) => f.comprobante_id)).size,
    totalAsientos: filas.length,
    totalDebeVes,
    totalHaberVes,
    totalDebeUsd,
    totalHaberUsd,
    diferenciaVes: difVes,
    diferenciaUsd: difUsd,
    cuadra,
    porTipo: Array.from(mapaTiposTotales.values()),
    topCuentas,
  };

  return { grupos, filas, resumen, config };
}

/* ───────────── Sub-motor 2: Plan de Cuentas ───────────── */

function generarReportePlanCuentas(
  fuente: FuenteReporteContable,
  config: ConfiguracionFiltroContable,
): ReporteContableGenerado {
  const busqueda = (config.busqueda ?? '').trim().toLowerCase();

  const cuentasFiltradas = fuente.cuentas.filter((c) => {
    const niv = nivelDe(c.codigo);
    if (config.nivelCuentas && niv > config.nivelCuentas) return false;
    if (config.claseCuenta && c.clase !== config.claseCuenta) return false;
    if (config.naturalezaCuenta && c.naturaleza !== config.naturalezaCuenta) return false;
    if (config.soloCuentasActivas && !c.activa) return false;
    if (busqueda && !c.codigo.toLowerCase().includes(busqueda) && !c.nombre.toLowerCase().includes(busqueda)) return false;
    return true;
  }).sort((a, b) => a.codigo.localeCompare(b.codigo));

  let activasCount = 0;
  let inactivasCount = 0;
  let movimientosCount = 0;
  let maxNivel = 1;

  const filas: FilaReporteContable[] = cuentasFiltradas.map((c) => {
    const niv = nivelDe(c.codigo);
    if (niv > maxNivel) maxNivel = niv;
    if (c.activa) activasCount++; else inactivasCount++;
    if (c.es_movimiento) movimientosCount++;

    return {
      id: c.id,
      ambito: 'cuentas',
      linea_id: c.id,
      comprobante_id: '',
      fecha: c.created_at?.slice(0, 10) || '',
      comprobante: '',
      tipo: '',
      tipo_id: '',
      origen: '',
      referencia: '',
      descripcion: c.notas || '',
      cuenta_codigo: c.codigo,
      cuenta_nombre: c.nombre,
      centro: '',
      auxiliar: '',
      auxiliar_rif: null,
      moneda: c.moneda,
      monto_moneda: 0,
      tasa: 0,
      debe_ves: 0,
      haber_ves: 0,
      debe_usd: 0,
      haber_usd: 0,
      saldo_ves: 0,
      saldo_usd: 0,
      nivel: niv,
      clase: NOMBRE_CLASE[c.clase] ?? c.clase,
      naturaleza: NOMBRE_NATURALEZA[c.naturaleza] ?? c.naturaleza,
      es_monetaria: c.es_monetaria ? 'Sí' : 'No',
      exige_centro: c.exige_centro_costo ? 'Sí' : 'No',
      exige_auxiliar: c.exige_auxiliar ? 'Sí' : 'No',
      tipo_auxiliar: c.tipo_auxiliar ? nombreTipoAuxiliar(c.tipo_auxiliar) : '—',
      activa: c.activa ? 'Activa' : 'Inactiva',
      padre_codigo: codigoPadre(c.codigo) || '—',
    };
  });

  const grupos: GrupoReporteContable[] = [{
    clave: 'CUENTAS',
    etiqueta: `Plan de Cuentas · ${filas.length} Cuentas Catalogadas`,
    totalAsientos: filas.length,
    debe_ves: 0,
    haber_ves: 0,
    debe_usd: 0,
    haber_usd: 0,
    saldo_ves: 0,
    saldo_usd: 0,
    filas,
  }];

  const resumen: ResumenReporteContable = {
    ambito: 'cuentas',
    totalComprobantes: 0,
    totalAsientos: filas.length,
    totalDebeVes: 0,
    totalHaberVes: 0,
    totalDebeUsd: 0,
    totalHaberUsd: 0,
    diferenciaVes: 0,
    diferenciaUsd: 0,
    cuadra: true,
    porTipo: [],
    topCuentas: [],
    totalCuentas: filas.length,
    cuentasActivas: activasCount,
    cuentasInactivas: inactivasCount,
    cuentasMovimiento: movimientosCount,
    maxNivel,
  };

  return { grupos, filas, resumen, config };
}

/* ───────────── Sub-motor 3: Balances y Saldos ───────────── */

function generarReporteBalances(
  fuente: FuenteReporteContable,
  config: ConfiguracionFiltroContable,
): ReporteContableGenerado {
  const niv = config.nivelBalance ?? 3;
  const bVes = balanceComprobacion(fuente, {
    desde: config.desde,
    hasta: config.hasta,
    moneda: 'VES',
    nivel: niv,
    incluirSinMovimiento: config.incluirSinMovimiento ?? false,
  });

  const bUsd = balanceComprobacion(fuente, {
    desde: config.desde,
    hasta: config.hasta,
    moneda: 'USD',
    nivel: niv,
    incluirSinMovimiento: config.incluirSinMovimiento ?? false,
  });

  const balanceCompleto = balanceConEquivalente(bVes, bUsd);
  const busqueda = (config.busqueda ?? '').trim().toLowerCase();

  const filas: FilaReporteContable[] = [];
  for (const f of balanceCompleto.filas) {
    if (busqueda && !f.cuenta.codigo.toLowerCase().includes(busqueda) && !f.cuenta.nombre.toLowerCase().includes(busqueda)) {
      continue;
    }

    const eq = f.eq ?? { saldoInicial: 0, debe: 0, haber: 0, saldoActual: 0 };
    filas.push({
      id: f.cuenta.id,
      ambito: 'balances',
      linea_id: f.cuenta.id,
      comprobante_id: '',
      fecha: config.hasta,
      comprobante: '',
      tipo: '',
      tipo_id: '',
      origen: '',
      referencia: '',
      descripcion: `Nivel ${f.nivel} · ${f.cuenta.clase.toUpperCase()}`,
      cuenta_codigo: f.cuenta.codigo,
      cuenta_nombre: f.cuenta.nombre,
      centro: '',
      auxiliar: '',
      auxiliar_rif: null,
      moneda: 'VES',
      monto_moneda: f.saldoActual,
      tasa: 0,
      debe_ves: f.debe,
      haber_ves: f.haber,
      debe_usd: eq.debe,
      haber_usd: eq.haber,
      saldo_ves: f.saldoActual,
      saldo_usd: eq.saldoActual,
      nivel: f.nivel,
      saldo_inicial_ves: f.saldoInicial,
      saldo_final_ves: f.saldoActual,
      saldo_inicial_usd: eq.saldoInicial,
      saldo_final_usd: eq.saldoActual,
    });
  }

  const tot = balanceCompleto.totales;
  let debeVes = tot.debe;
  let haberVes = tot.haber;
  const totEq = tot.eq ?? { saldoInicial: 0, debe: 0, haber: 0, saldoActual: 0 };
  let debeUsd = totEq.debe;
  let haberUsd = totEq.haber;

  // Respaldo de cálculo si el catálogo carece de cuentas raíz de nivel 1:
  if (debeVes === 0 && haberVes === 0 && filas.length > 0) {
    const maxNiv = Math.max(...filas.map((x) => x.nivel ?? 1));
    const filasBase = filas.filter((f) => f.nivel === maxNiv);
    debeVes = filasBase.reduce((acc, f) => acc + f.debe_ves, 0);
    haberVes = filasBase.reduce((acc, f) => acc + f.haber_ves, 0);
    debeUsd = filasBase.reduce((acc, f) => acc + f.debe_usd, 0);
    haberUsd = filasBase.reduce((acc, f) => acc + f.haber_usd, 0);
  }

  const difVes = Math.abs(debeVes - haberVes);
  const difUsd = Math.abs(debeUsd - haberUsd);
  const cuadra = difVes <= 0.05 && difUsd <= 0.05;

  const grupos: GrupoReporteContable[] = [{
    clave: 'BALANCES',
    etiqueta: `Balance de Comprobación · ${filas.length} Cuentas (Nivel ${niv})`,
    totalAsientos: filas.length,
    debe_ves: debeVes,
    haber_ves: haberVes,
    debe_usd: debeUsd,
    haber_usd: haberUsd,
    saldo_ves: tot.saldoActual,
    saldo_usd: totEq.saldoActual,
    filas,
  }];

  const resumen: ResumenReporteContable = {
    ambito: 'balances',
    totalComprobantes: 0,
    totalAsientos: filas.length,
    totalDebeVes: debeVes,
    totalHaberVes: haberVes,
    totalDebeUsd: debeUsd,
    totalHaberUsd: haberUsd,
    diferenciaVes: difVes,
    diferenciaUsd: difUsd,
    cuadra,
    porTipo: [],
    topCuentas: [],
    totalSaldoInicialVes: tot.saldoInicial,
    totalSaldoFinalVes: tot.saldoActual,
    totalSaldoInicialUsd: totEq.saldoInicial,
    totalSaldoFinalUsd: totEq.saldoActual,
  };

  return { grupos, filas, resumen, config };
}

/* ───────────── Sub-motor 4: Períodos y Cierres ───────────── */

function generarReportePeriodos(
  fuente: FuenteReporteContable,
  config: ConfiguracionFiltroContable,
): ReporteContableGenerado {
  const periodos = fuente.periodos ?? [];
  const ejercicios = fuente.ejercicios ?? [];
  const cierres = fuente.cierres ?? [];
  const comprobantes = fuente.comprobantes ?? [];

  const mapaEjercicios = new Map(ejercicios.map((e) => [e.id, e]));
  const busqueda = (config.busqueda ?? '').trim().toLowerCase();

  const periodosFiltrados = periodos.filter((p) => {
    if (config.ejercicioId && p.ejercicio_id !== config.ejercicioId) return false;
    if (config.estadoPeriodo && config.estadoPeriodo !== 'todos' && p.estado !== config.estadoPeriodo) return false;
    if (busqueda) {
      const ej = mapaEjercicios.get(p.ejercicio_id);
      const nombreMes = p.numero === 13 ? 'Cierre del ejercicio' : MESES_NOMBRES[p.numero - 1] || '';
      const match =
        nombreMes.toLowerCase().includes(busqueda) ||
        (ej?.fecha_inicio.slice(0, 4) || '').includes(busqueda) ||
        p.estado.toLowerCase().includes(busqueda);
      if (!match) return false;
    }
    return true;
  }).sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio) || a.numero - b.numero);

  let totalDebeVes = 0;
  let totalHaberVes = 0;
  let totalDifAjVes = 0;
  let totalDifAjUsd = 0;
  let mesesAbiertos = 0;
  let mesesCerrados = 0;
  let totalComprobantesPeriodos = 0;

  const filas: FilaReporteContable[] = periodosFiltrados.map((p) => {
    const ej = mapaEjercicios.get(p.ejercicio_id);
    const nombreMes = p.numero === 13 ? '13 · Cierre del Ejercicio' : `${p.numero} · ${MESES_NOMBRES[p.numero - 1]}`;

    if (p.estado === 'abierto') mesesAbiertos++; else mesesCerrados++;

    // Comprobantes del mes
    const cbtesMes = comprobantes.filter((c) => c.fecha >= p.fecha_inicio && c.fecha <= p.fecha_fin);
    let dVes = 0;
    let hVes = 0;
    for (const c of cbtesMes) {
      dVes += c.total_debe_ves || 0;
      hVes += c.total_haber_ves || 0;
    }
    totalDebeVes += dVes;
    totalHaberVes += hVes;
    totalComprobantesPeriodos += cbtesMes.length;

    // Cierre asociado
    const cierre = cierres.find((ci) => ci.periodo_id === p.id || ci.id === `cie-${p.id}`);
    const difVes = (cierre as unknown as Record<string, unknown>)?.diferencial_cambiario_ves ? Number((cierre as unknown as Record<string, unknown>).diferencial_cambiario_ves) : 0;
    const difUsd = (cierre as unknown as Record<string, unknown>)?.diferencial_cambiario_usd ? Number((cierre as unknown as Record<string, unknown>).diferencial_cambiario_usd) : 0;
    totalDifAjVes += difVes;
    totalDifAjUsd += difUsd;

    return {
      id: p.id,
      ambito: 'periodos',
      linea_id: p.id,
      comprobante_id: '',
      fecha: p.fecha_fin,
      comprobante: '',
      tipo: '',
      tipo_id: '',
      origen: '',
      referencia: '',
      descripcion: `Período ${nombreMes} (${p.fecha_inicio} al ${p.fecha_fin})`,
      cuenta_codigo: '',
      cuenta_nombre: '',
      centro: '',
      auxiliar: '',
      auxiliar_rif: null,
      moneda: 'VES',
      monto_moneda: 0,
      tasa: 0,
      debe_ves: dVes,
      haber_ves: hVes,
      debe_usd: 0,
      haber_usd: 0,
      saldo_ves: dVes - hVes,
      saldo_usd: 0,
      ejercicio: ej ? `${ej.fecha_inicio.slice(0, 4)}` : '—',
      periodo_numero: p.numero,
      periodo_nombre: nombreMes,
      periodo_estado: p.estado === 'abierto' ? 'Abierto' : 'Cerrado',
      fecha_inicio: p.fecha_inicio,
      fecha_fin: p.fecha_fin,
      fecha_cierre: cierre?.hecho_en?.slice(0, 16).replace('T', ' ') || '—',
      cerrado_por: cierre?.hecho_por || '—',
      diferencial_aj_ves: difVes,
      diferencial_aj_usd: difUsd,
      comprobantes_count: cbtesMes.length,
    };
  });

  const grupos: GrupoReporteContable[] = [{
    clave: 'PERIODOS',
    etiqueta: `Auditoría de Períodos y Cierres Mensuales · ${filas.length} Meses`,
    totalAsientos: filas.length,
    debe_ves: totalDebeVes,
    haber_ves: totalHaberVes,
    debe_usd: 0,
    haber_usd: 0,
    saldo_ves: totalDebeVes - totalHaberVes,
    saldo_usd: 0,
    filas,
  }];

  const resumen: ResumenReporteContable = {
    ambito: 'periodos',
    totalComprobantes: totalComprobantesPeriodos,
    totalAsientos: filas.length,
    totalDebeVes,
    totalHaberVes,
    totalDebeUsd: 0,
    totalHaberUsd: 0,
    diferenciaVes: Math.abs(totalDebeVes - totalHaberVes),
    diferenciaUsd: 0,
    cuadra: true,
    porTipo: [],
    topCuentas: [],
    mesesAbiertos,
    mesesCerrados,
    totalDiferencialAjVes: totalDifAjVes,
    totalDiferencialAjUsd: totalDifAjUsd,
  };

  return { grupos, filas, resumen, config };
}

/* ───────────── Utilidades de fechas ───────────── */

export function calcularRangoPreset(preset: PresetPeriodoContable, base = new Date()): { desde: string; hasta: string } {
  const y = base.getFullYear();
  const m = base.getMonth();

  switch (preset) {
    case 'mes_actual': {
      const d = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const h = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
      return { desde: d, hasta: h };
    }
    case 'mes_anterior': {
      const d = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
      const h = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return { desde: d, hasta: h };
    }
    case 'este_ano': {
      return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
    }
    case 'ejercicio': {
      return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
    }
    case 'todos': {
      return { desde: '2020-01-01', hasta: '2030-12-31' };
    }
    case 'personalizado':
    default: {
      const d = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const h = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
      return { desde: d, hasta: h };
    }
  }
}
