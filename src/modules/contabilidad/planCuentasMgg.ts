/* ============================================================
   MGG · Plan de Cuentas y Parametrización Oficial
   Frente 2: Configuración y catálogo contable adaptado a la operación
   minera, bancos nacionales, divisas, centros de costo e impuestos de MGG.
   ============================================================ */

import { EMPRESA_NOMBRE, EMPRESA_RIF, EMPRESA_DOMICILIO } from '@/shared/lib/empresa';
import type { ClaseCuenta, ContCentroCosto, ContCuenta, ContParametros, Naturaleza, TipoAuxiliar } from './tipos';

/** Datos de identidad fiscal contable de MINERAL GROUP GUAYANA C.A. */
export const IDENTIDAD_FISCAL_MGG = {
  nombre: EMPRESA_NOMBRE,
  rif: EMPRESA_RIF,
  domicilio: EMPRESA_DOMICILIO,
};

/** Máscara oficial de 5 niveles para MGG */
export const MASCARA_MGG = '9.9.99.99.999';

/** Parámetros contables oficiales para MINERAL GROUP GUAYANA C.A. */
export const PARAMETROS_MGG: ContParametros = {
  id: true,
  empresa_clave: 'MGG',
  empresa_nombre: EMPRESA_NOMBRE,
  centro_costo_defecto_id: 'cc-los-pinos',
  mascara_codigo: MASCARA_MGG,
  niveles: 5,
  moneda_funcional: 'VES',
  moneda_referencia: 'USD',
  fuente_tasa: 'bcv',
  tolerancia_cuadre: 0.01,
  cuenta_resultado_ejercicio_id: 'cta-3-3-01-01-002',
  cuenta_utilidades_retenidas_id: 'cta-3-3-01-01-001',
  cuenta_dif_cambio_ganancia_id: 'cta-4-2-01-01-001',
  cuenta_dif_cambio_perdida_id: 'cta-6-3-01-01-003',
  tipo_numeracion: 'mes_consecutivo',
  permite_descuadrados: false,
  permite_fecha_futura: false,
  tipo_comprobante_defecto_id: 'tip-02',
  tipo_diferencial_id: 'tip-09',
  tipo_cierre_id: 'tip-10',
  tipo_apertura_id: 'tip-11',
};

/** Centros de Costo operativos de MINERAL GROUP GUAYANA C.A. */
export const CENTROS_COSTO_MGG: ContCentroCosto[] = [
  { id: 'cc-admin', codigo: 'CC-01', nombre: 'Administración Central (Puerto Ordaz)', padre_id: null, tipo: 'area', origen_clave: 'MGG', activo: true, empresa_clave: 'MGG' },
  { id: 'cc-los-pinos', codigo: 'CC-02', nombre: 'Almacén Central Los Pinos', padre_id: null, tipo: 'sede', origen_clave: 'LOS_PINOS', activo: true, empresa_clave: 'MGG' },
  { id: 'cc-matanzas', codigo: 'CC-03', nombre: 'Planta Matanzas / Procesamiento', padre_id: null, tipo: 'sede', origen_clave: 'MATANZAS', activo: true, empresa_clave: 'MGG' },
  { id: 'cc-maquinaria', codigo: 'CC-04', nombre: 'Flota y Maquinaria Pesada', padre_id: null, tipo: 'area', origen_clave: null, activo: true, empresa_clave: 'MGG' },
  { id: 'cc-comedor', codigo: 'CC-05', nombre: 'Comedor y Servicios', padre_id: null, tipo: 'area', origen_clave: null, activo: true, empresa_clave: 'MGG' },
  { id: 'cc-combustible', codigo: 'CC-06', nombre: 'Surtidor y Estación de Combustible', padre_id: null, tipo: 'area', origen_clave: null, activo: true, empresa_clave: 'MGG' },
];

/** Definición auxiliar para armar el plan jerárquico */
interface CuentaDef {
  codigo: string;
  nombre: string;
  nivel: number;
  padreCodigo: string | null;
  clase: ClaseCuenta;
  naturaleza: Naturaleza;
  esMovimiento: boolean;
  moneda?: 'USD' | 'USDT' | 'EUR' | null;
  esMonetaria?: boolean;
  rubro?: string | null;
  exigeCentro?: boolean;
  exigeAuxiliar?: boolean;
  tipoAuxiliar?: TipoAuxiliar | null;
}

export const DEFINICION_PLAN_CUENTAS_MGG: CuentaDef[] = [
  // ── 1. ACTIVO ──
  { codigo: '1', nombre: 'ACTIVO', nivel: 1, padreCodigo: null, clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1', nombre: 'ACTIVO CORRIENTE', nivel: 2, padreCodigo: '1', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },

  // 1.1.01 Efectivo y Equivalentes
  { codigo: '1.1.01', nombre: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', nivel: 3, padreCodigo: '1.1', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.01.01', nombre: 'CAJAS Y FONDOS EN EFECTIVO', nivel: 4, padreCodigo: '1.1.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.01.01.001', nombre: 'Caja Principal Bolívares (VES)', nivel: 5, padreCodigo: '1.1.01.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, esMonetaria: true, rubro: 'efectivo' },
  { codigo: '1.1.01.01.002', nombre: 'Caja Principal Dólares Efectivo (USD)', nivel: 5, padreCodigo: '1.1.01.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'efectivo' },
  { codigo: '1.1.01.01.003', nombre: 'Billetera Criptoactivos / USDT (Binance)', nivel: 5, padreCodigo: '1.1.01.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USDT', esMonetaria: true, rubro: 'efectivo' },
  { codigo: '1.1.01.01.004', nombre: 'Caja Chica Los Pinos / Operaciones (USD)', nivel: 5, padreCodigo: '1.1.01.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'efectivo', exigeCentro: true },

  // 1.1.01.02 Bancos Nacionales
  { codigo: '1.1.01.02', nombre: 'BANCOS NACIONALES (VES)', nivel: 4, padreCodigo: '1.1.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.01.02.001', nombre: 'Banco Banesco · Cuenta Corriente', nivel: 5, padreCodigo: '1.1.01.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, esMonetaria: true, rubro: 'efectivo' },
  { codigo: '1.1.01.02.002', nombre: 'Banco Mercantil · Cuenta Corriente', nivel: 5, padreCodigo: '1.1.01.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, esMonetaria: true, rubro: 'efectivo' },
  { codigo: '1.1.01.02.003', nombre: 'Banco de Venezuela · Cuenta Corriente', nivel: 5, padreCodigo: '1.1.01.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, esMonetaria: true, rubro: 'efectivo' },

  // 1.1.01.03 Cuentas Custodia en Divisas
  { codigo: '1.1.01.03', nombre: 'CUENTAS EN DIVISAS NACIONALES (USD)', nivel: 4, padreCodigo: '1.1.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.01.03.001', nombre: 'Banco Banesco · Cuenta Custodia Divisas USD', nivel: 5, padreCodigo: '1.1.01.03', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'efectivo' },
  { codigo: '1.1.01.03.002', nombre: 'Banco Mercantil · Cuenta Custodia Divisas USD', nivel: 5, padreCodigo: '1.1.01.03', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'efectivo' },

  // 1.1.01.04 Fondos Operativos
  { codigo: '1.1.01.04', nombre: 'FONDOS EN SEDES OPERATIVAS', nivel: 4, padreCodigo: '1.1.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.01.04.001', nombre: 'Fondo Caja Operaciones Los Pinos (USD)', nivel: 5, padreCodigo: '1.1.01.04', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'efectivo', exigeCentro: true },
  { codigo: '1.1.01.04.002', nombre: 'Fondo Planta Matanzas (USD)', nivel: 5, padreCodigo: '1.1.01.04', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'efectivo', exigeCentro: true },

  // 1.1.02 Cuentas por Cobrar
  { codigo: '1.1.02', nombre: 'CUENTAS POR COBRAR COMERCIALES', nivel: 3, padreCodigo: '1.1', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.02.01', nombre: 'CLIENTES Y COBRANZAS', nivel: 4, padreCodigo: '1.1.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.02.01.001', nombre: 'Clientes Nacionales · Venta de Mineral (USD)', nivel: 5, padreCodigo: '1.1.02.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'cxc_comerciales', exigeAuxiliar: true, tipoAuxiliar: 'cliente' },
  { codigo: '1.1.02.01.002', nombre: 'Clientes Nacionales · Venta de Mineral (VES)', nivel: 5, padreCodigo: '1.1.02.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, esMonetaria: true, rubro: 'cxc_comerciales', exigeAuxiliar: true, tipoAuxiliar: 'cliente' },
  { codigo: '1.1.02.01.003', nombre: 'Cuentas por Cobrar Intercompañía / Afiliadas', nivel: 5, padreCodigo: '1.1.02.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'cxc_comerciales', exigeAuxiliar: true, tipoAuxiliar: 'intercompania' },
  { codigo: '1.1.02.02', nombre: 'ANTICIPOS A PROVEEDORES', nivel: 4, padreCodigo: '1.1.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.02.02.001', nombre: 'Anticipos a Proveedores de Repuestos y Bienes', nivel: 5, padreCodigo: '1.1.02.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'cxc_comerciales', exigeAuxiliar: true, tipoAuxiliar: 'proveedor' },

  // 1.1.03 Inventarios Mineros y Suministros
  { codigo: '1.1.03', nombre: 'INVENTARIOS', nivel: 3, padreCodigo: '1.1', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.03.01', nombre: 'MINERAL Y METALES EN STOCK', nivel: 4, padreCodigo: '1.1.03', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.03.01.001', nombre: 'Inventario de Mineral Aurífero en Bruto', nivel: 5, padreCodigo: '1.1.03.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'inventarios', exigeCentro: true },
  { codigo: '1.1.03.01.002', nombre: 'Inventario de Concentrado de Casiterita (Estaño)', nivel: 5, padreCodigo: '1.1.03.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'inventarios', exigeCentro: true },
  { codigo: '1.1.03.01.003', nombre: 'Inventario de Oro Fundido / Barras', nivel: 5, padreCodigo: '1.1.03.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'inventarios', exigeCentro: true },
  { codigo: '1.1.03.02', nombre: 'COMBUSTIBLES, REPUESTOS Y SUMINISTROS', nivel: 4, padreCodigo: '1.1.03', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.03.02.001', nombre: 'Inventario de Combustible (Diesel / Gasoil)', nivel: 5, padreCodigo: '1.1.03.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'inventarios', exigeCentro: true },
  { codigo: '1.1.03.02.002', nombre: 'Inventario de Lubricantes, Grasas y Aceites', nivel: 5, padreCodigo: '1.1.03.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'inventarios', exigeCentro: true },
  { codigo: '1.1.03.02.003', nombre: 'Inventario de Repuestos y Martillos de Molino', nivel: 5, padreCodigo: '1.1.03.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'inventarios', exigeCentro: true },
  { codigo: '1.1.03.02.004', nombre: 'Inventario de Víveres y Alimentos (Comedor)', nivel: 5, padreCodigo: '1.1.03.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'inventarios', exigeCentro: true },

  // 1.1.04 Créditos Fiscales
  { codigo: '1.1.04', nombre: 'CRÉDITOS Y ANTICIPOS FISCALES', nivel: 3, padreCodigo: '1.1', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.04.01', nombre: 'IMPUESTOS FISCALES A FAVOR', nivel: 4, padreCodigo: '1.1.04', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.1.04.01.001', nombre: 'IVA Crédito Fiscal (Compras y Servicios)', nivel: 5, padreCodigo: '1.1.04.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, esMonetaria: true, rubro: 'otros_activos_corrientes' },
  { codigo: '1.1.04.01.002', nombre: 'Anticipos de ISLR Retenido por Clientes', nivel: 5, padreCodigo: '1.1.04.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, esMonetaria: true, rubro: 'otros_activos_corrientes' },

  // 1.2 ACTIVO NO CORRIENTE (Propiedad, Planta y Equipos)
  { codigo: '1.2', nombre: 'ACTIVO NO CORRIENTE', nivel: 2, padreCodigo: '1', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.2.01', nombre: 'PROPIEDAD, PLANTA Y EQUIPO', nivel: 3, padreCodigo: '1.2', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.2.01.01', nombre: 'MAQUINARIA Y EQUIPOS MINEROS', nivel: 4, padreCodigo: '1.2.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.2.01.01.001', nombre: 'Maquinaria Pesada (Excavadoras / Retroexcavadoras)', nivel: 5, padreCodigo: '1.2.01.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'propiedad_planta_equipo', exigeCentro: true },
  { codigo: '1.2.01.01.002', nombre: 'Equipos de Molienda y Procesamiento (Molinos / Trommel)', nivel: 5, padreCodigo: '1.2.01.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'propiedad_planta_equipo', exigeCentro: true },
  { codigo: '1.2.01.01.003', nombre: 'Plantas Eléctricas y Generadores Perkins', nivel: 5, padreCodigo: '1.2.01.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'propiedad_planta_equipo', exigeCentro: true },
  { codigo: '1.2.01.02', nombre: 'VEHÍCULOS Y EQUIPOS DE TRANSPORTE', nivel: 4, padreCodigo: '1.2.01', clase: 'activo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '1.2.01.02.001', nombre: 'Flota de Camiones y Carga Pesada', nivel: 5, padreCodigo: '1.2.01.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'propiedad_planta_equipo', exigeCentro: true },
  { codigo: '1.2.01.02.002', nombre: 'Vehículos Operativos de Transporte Liviano', nivel: 5, padreCodigo: '1.2.01.02', clase: 'activo', naturaleza: 'deudora', esMovimiento: true, rubro: 'propiedad_planta_equipo', exigeCentro: true },
  { codigo: '1.2.01.03', nombre: 'DEPRECIACIÓN ACUMULADA', nivel: 4, padreCodigo: '1.2.01', clase: 'activo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '1.2.01.03.001', nombre: 'Depreciación Acumulada Maquinaria y Equipos', nivel: 5, padreCodigo: '1.2.01.03', clase: 'activo', naturaleza: 'acreedora', esMovimiento: true, rubro: 'propiedad_planta_equipo' },

  // ── 2. PASIVO ──
  { codigo: '2', nombre: 'PASIVO', nivel: 1, padreCodigo: null, clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1', nombre: 'PASIVO CORRIENTE', nivel: 2, padreCodigo: '2', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },

  // 2.1.01 Cuentas por Pagar Comerciales
  { codigo: '2.1.01', nombre: 'CUENTAS POR PAGAR COMERCIALES', nivel: 3, padreCodigo: '2.1', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.01.01', nombre: 'PROVEEDORES Y CONTRATISTAS', nivel: 4, padreCodigo: '2.1.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.01.01.001', nombre: 'Proveedores Nacionales · Divisas (USD)', nivel: 5, padreCodigo: '2.1.01.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'cxp_comerciales', exigeAuxiliar: true, tipoAuxiliar: 'proveedor' },
  { codigo: '2.1.01.01.002', nombre: 'Proveedores Nacionales · Bolívares (VES)', nivel: 5, padreCodigo: '2.1.01.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, esMonetaria: true, rubro: 'cxp_comerciales', exigeAuxiliar: true, tipoAuxiliar: 'proveedor' },

  // 2.1.02 Retenciones Fiscales y Municipales por Enterar
  { codigo: '2.1.02', nombre: 'RETENCIONES TRIBUTARIAS POR ENTERAR', nivel: 3, padreCodigo: '2.1', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.02.01', nombre: 'RETENCIONES SENIAT', nivel: 4, padreCodigo: '2.1.02', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.02.01.001', nombre: 'Retenciones IVA por Enterar (75% / 100%)', nivel: 5, padreCodigo: '2.1.02.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, esMonetaria: true, rubro: 'otras_obligaciones_corrientes' },
  { codigo: '2.1.02.01.002', nombre: 'Retenciones ISLR Compras y Servicios por Enterar', nivel: 5, padreCodigo: '2.1.02.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, esMonetaria: true, rubro: 'otras_obligaciones_corrientes' },
  { codigo: '2.1.02.02', nombre: 'RETENCIONES MUNICIPALES', nivel: 4, padreCodigo: '2.1.02', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.02.02.001', nombre: 'Retenciones ISAE por Enterar (Alcaldías)', nivel: 5, padreCodigo: '2.1.02.02', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, esMonetaria: true, rubro: 'otras_obligaciones_corrientes' },

  // 2.1.03 Pasivos Laborales
  { codigo: '2.1.03', nombre: 'OBLIGACIONES LABORALES', nivel: 3, padreCodigo: '2.1', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.03.01', nombre: 'SUELDOS Y BENEFICIOS POR PAGAR', nivel: 4, padreCodigo: '2.1.03', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.03.01.001', nombre: 'Nómina y Sueldos por Pagar', nivel: 5, padreCodigo: '2.1.03.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'otras_obligaciones_corrientes' },
  { codigo: '2.1.03.01.002', nombre: 'Prestaciones Sociales y Liquidaciones Acumuladas', nivel: 5, padreCodigo: '2.1.03.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'otras_obligaciones_corrientes' },

  // 2.1.04 Honorarios y Cuentas de Administración
  { codigo: '2.1.04', nombre: 'HONORARIOS Y GASTOS ADMINISTRATIVOS POR PAGAR', nivel: 3, padreCodigo: '2.1', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.04.01', nombre: 'HONORARIOS PROFESIONALES', nivel: 4, padreCodigo: '2.1.04', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '2.1.04.01.001', nombre: 'Honorarios Legales y Gestoría por Pagar', nivel: 5, padreCodigo: '2.1.04.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'cxp_comerciales', exigeAuxiliar: true, tipoAuxiliar: 'proveedor' },
  { codigo: '2.1.04.01.002', nombre: 'Honorarios Contables y Auditoría por Pagar', nivel: 5, padreCodigo: '2.1.04.01', clase: 'pasivo', naturaleza: 'acreedora', esMovimiento: true, moneda: 'USD', esMonetaria: true, rubro: 'cxp_comerciales', exigeAuxiliar: true, tipoAuxiliar: 'proveedor' },

  // ── 3. PATRIMONIO ──
  { codigo: '3', nombre: 'PATRIMONIO', nivel: 1, padreCodigo: null, clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.1', nombre: 'CAPITAL SOCIAL', nivel: 2, padreCodigo: '3', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.1.01', nombre: 'CAPITAL SUSCRITO Y PAGADO', nivel: 3, padreCodigo: '3.1', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.1.01.01', nombre: 'ACCIONES COMUNES', nivel: 4, padreCodigo: '3.1.01', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.1.01.01.001', nombre: 'Capital Social Suscrito y Pagado', nivel: 5, padreCodigo: '3.1.01.01', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: true, rubro: 'capital_social' },

  { codigo: '3.2', nombre: 'RESERVAS', nivel: 2, padreCodigo: '3', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.2.01', nombre: 'RESERVA LEGAL', nivel: 3, padreCodigo: '3.2', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.2.01.01', nombre: 'FONDO DE RESERVA', nivel: 4, padreCodigo: '3.2.01', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.2.01.01.001', nombre: 'Reserva Legal Estatutaria', nivel: 5, padreCodigo: '3.2.01.01', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: true, rubro: 'reservas' },

  { codigo: '3.3', nombre: 'RESULTADOS ACUMULADOS', nivel: 2, padreCodigo: '3', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.3.01', nombre: 'RESULTADOS DE EJERCICIOS ANTERIORES Y ACTUAL', nivel: 3, padreCodigo: '3.3', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.3.01.01', nombre: 'UTILIDADES Y PÉRDIDAS', nivel: 4, padreCodigo: '3.3.01', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '3.3.01.01.001', nombre: 'Utilidades Retenidas / Superávit Acumulado', nivel: 5, padreCodigo: '3.3.01.01', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: true, rubro: 'resultados_acumulados' },
  { codigo: '3.3.01.01.002', nombre: 'Resultado del Ejercicio Económico', nivel: 5, padreCodigo: '3.3.01.01', clase: 'patrimonio', naturaleza: 'acreedora', esMovimiento: true, rubro: 'resultado_ejercicio' },

  // ── 4. INGRESOS ──
  { codigo: '4', nombre: 'INGRESOS', nivel: 1, padreCodigo: null, clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.1', nombre: 'INGRESOS DE OPERACIÓN', nivel: 2, padreCodigo: '4', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.1.01', nombre: 'VENTAS DE MINERALES Y METALES', nivel: 3, padreCodigo: '4.1', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.1.01.01', nombre: 'VENTAS DE PRODUCCIÓN', nivel: 4, padreCodigo: '4.1.01', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.1.01.01.001', nombre: 'Ingresos por Venta de Mineral Aurífero (Oro)', nivel: 5, padreCodigo: '4.1.01.01', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: true, rubro: 'ingresos_operacionales', exigeCentro: true },
  { codigo: '4.1.01.01.002', nombre: 'Ingresos por Venta de Casiterita (Estaño)', nivel: 5, padreCodigo: '4.1.01.01', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: true, rubro: 'ingresos_operacionales', exigeCentro: true },
  { codigo: '4.1.02', nombre: 'INGRESOS POR SERVICIOS OPERATIVOS', nivel: 3, padreCodigo: '4.1', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.1.02.01', nombre: 'SERVICIOS DE PROCESAMIENTO', nivel: 4, padreCodigo: '4.1.02', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.1.02.01.001', nombre: 'Ingresos por Servicio de Molienda y Trituración', nivel: 5, padreCodigo: '4.1.02.01', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: true, rubro: 'ingresos_operacionales', exigeCentro: true },

  { codigo: '4.2', nombre: 'OTROS INGRESOS Y GANANCIAS', nivel: 2, padreCodigo: '4', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.2.01', nombre: 'INGRESOS FINANCIEROS Y CAMBIARIOS', nivel: 3, padreCodigo: '4.2', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.2.01.01', nombre: 'DIFERENCIAL CAMBIARIO', nivel: 4, padreCodigo: '4.2.01', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: false },
  { codigo: '4.2.01.01.001', nombre: 'Ganancia por Diferencial Cambiario', nivel: 5, padreCodigo: '4.2.01.01', clase: 'ingreso', naturaleza: 'acreedora', esMovimiento: true, rubro: 'otros_ingresos' },

  // ── 5. COSTOS ──
  { codigo: '5', nombre: 'COSTOS', nivel: 1, padreCodigo: null, clase: 'costo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '5.1', nombre: 'COSTOS DE PRODUCCIÓN Y EXTRACCIÓN', nivel: 2, padreCodigo: '5', clase: 'costo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '5.1.01', nombre: 'COSTOS DIRECTOS OPERATIVOS', nivel: 3, padreCodigo: '5.1', clase: 'costo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '5.1.01.01', nombre: 'EXTRACCIÓN Y RECEPCIÓN', nivel: 4, padreCodigo: '5.1.01', clase: 'costo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '5.1.01.01.001', nombre: 'Mano de Obra Directa · Cuadrillas de Planta', nivel: 5, padreCodigo: '5.1.01.01', clase: 'costo', naturaleza: 'deudora', esMovimiento: true, rubro: 'costo_ventas', exigeCentro: true },
  { codigo: '5.1.01.01.002', nombre: 'Liquidación y Compra de Mineral a Productores', nivel: 5, padreCodigo: '5.1.01.01', clase: 'costo', naturaleza: 'deudora', esMovimiento: true, rubro: 'costo_ventas', exigeCentro: true },
  { codigo: '5.1.02', nombre: 'COMBUSTIBLE Y MANTENIMIENTO MAQUINARIA', nivel: 3, padreCodigo: '5.1', clase: 'costo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '5.1.02.01', nombre: 'OPERACIÓN DE MAQUINARIA', nivel: 4, padreCodigo: '5.1.02', clase: 'costo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '5.1.02.01.001', nombre: 'Consumo de Combustible Diesel / Gasoil Maquinaria', nivel: 5, padreCodigo: '5.1.02.01', clase: 'costo', naturaleza: 'deudora', esMovimiento: true, rubro: 'costo_ventas', exigeCentro: true },
  { codigo: '5.1.02.01.002', nombre: 'Mantenimiento Preventivo y Correctivo de Maquinaria', nivel: 5, padreCodigo: '5.1.02.01', clase: 'costo', naturaleza: 'deudora', esMovimiento: true, rubro: 'costo_ventas', exigeCentro: true },
  { codigo: '5.1.02.01.003', nombre: 'Consumo de Aceites, Grasas y Filtros', nivel: 5, padreCodigo: '5.1.02.01', clase: 'costo', naturaleza: 'deudora', esMovimiento: true, rubro: 'costo_ventas', exigeCentro: true },
  { codigo: '5.1.03', nombre: 'CAMPAMENTO Y SERVICIOS', nivel: 3, padreCodigo: '5.1', clase: 'costo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '5.1.03.01', nombre: 'COCINA Y COMEDOR', nivel: 4, padreCodigo: '5.1.03', clase: 'costo', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '5.1.03.01.001', nombre: 'Consumo de Víveres y Comida Personal Operativo', nivel: 5, padreCodigo: '5.1.03.01', clase: 'costo', naturaleza: 'deudora', esMovimiento: true, rubro: 'costo_ventas', exigeCentro: true },

  // ── 6. GASTOS ──
  { codigo: '6', nombre: 'GASTOS', nivel: 1, padreCodigo: null, clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.1', nombre: 'GASTOS DE OPERACIÓN', nivel: 2, padreCodigo: '6', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.1.01', nombre: 'SERVICIOS Y FLETES OPERATIVOS', nivel: 3, padreCodigo: '6.1', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.1.01.01', nombre: 'LOGÍSTICA Y TRANSPORTE', nivel: 4, padreCodigo: '6.1.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.1.01.01.001', nombre: 'Fletes y Envíos de Carga Pesada / Delivery', nivel: 5, padreCodigo: '6.1.01.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_operacionales', exigeCentro: true },

  { codigo: '6.2', nombre: 'GASTOS DE ADMINISTRACIÓN', nivel: 2, padreCodigo: '6', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.2.01', nombre: 'SERVICIOS BÁSICOS Y DE SEDE', nivel: 3, padreCodigo: '6.2', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.2.01.01', nombre: 'SERVICIOS GENERALES', nivel: 4, padreCodigo: '6.2.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.2.01.01.001', nombre: 'Electricidad y Suministro Eléctrico', nivel: 5, padreCodigo: '6.2.01.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_operacionales', exigeCentro: true },
  { codigo: '6.2.01.01.002', nombre: 'Agua y Servicios Sanitarios', nivel: 5, padreCodigo: '6.2.01.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_operacionales', exigeCentro: true },
  { codigo: '6.2.01.01.003', nombre: 'Telecomunicaciones, Internet y Telefonía', nivel: 5, padreCodigo: '6.2.01.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_operacionales', exigeCentro: true },
  { codigo: '6.2.01.01.004', nombre: 'Alquiler de Inmuebles y Oficinas', nivel: 5, padreCodigo: '6.2.01.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_operacionales', exigeCentro: true },
  { codigo: '6.2.02', nombre: 'HONORARIOS Y GESTIONES PROFESIONALES', nivel: 3, padreCodigo: '6.2', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.2.02.01', nombre: 'HONORARIOS LEGALES Y CONTABLES', nivel: 4, padreCodigo: '6.2.02', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.2.02.01.001', nombre: 'Honorarios Profesionales Legales y Gestoría', nivel: 5, padreCodigo: '6.2.02.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_operacionales', exigeAuxiliar: true, tipoAuxiliar: 'proveedor', exigeCentro: true },
  { codigo: '6.2.02.01.002', nombre: 'Honorarios Contables, Tributarios y Auditoría', nivel: 5, padreCodigo: '6.2.02.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_operacionales', exigeAuxiliar: true, tipoAuxiliar: 'proveedor', exigeCentro: true },

  { codigo: '6.3', nombre: 'GASTOS FINANCIEROS', nivel: 2, padreCodigo: '6', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.3.01', nombre: 'COMISIONES Y DIFERENCIAL CAMBIARIO', nivel: 3, padreCodigo: '6.3', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.3.01.01', nombre: 'GASTOS BANCARIOS Y CAMBIARIOS', nivel: 4, padreCodigo: '6.3.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: false },
  { codigo: '6.3.01.01.001', nombre: 'Comisiones y Gastos Bancarios', nivel: 5, padreCodigo: '6.3.01.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_financieros' },
  { codigo: '6.3.01.01.003', nombre: 'Pérdida por Diferencial Cambiario', nivel: 5, padreCodigo: '6.3.01.01', clase: 'gasto', naturaleza: 'deudora', esMovimiento: true, rubro: 'gastos_financieros' },
];

/** Construye la lista completa de ContCuenta tipadas con IDs canónicos para MGG */
export function generarPlanCuentasMGG(): ContCuenta[] {
  const ahora = new Date().toISOString();
  return DEFINICION_PLAN_CUENTAS_MGG.map((c) => ({
    id: `cta-${c.codigo.replace(/\./g, '-')}`,
    empresa_clave: 'MGG',
    codigo: c.codigo,
    nombre: c.nombre,
    nivel: c.nivel,
    padre_id: c.padreCodigo ? `cta-${c.padreCodigo.replace(/\./g, '-')}` : null,
    clase: c.clase,
    naturaleza: c.naturaleza,
    es_movimiento: c.esMovimiento,
    moneda: c.moneda ?? null,
    es_monetaria: Boolean(c.esMonetaria),
    rubro: c.rubro ?? null,
    exige_centro_costo: Boolean(c.exigeCentro),
    exige_auxiliar: Boolean(c.exigeAuxiliar),
    tipo_auxiliar: c.tipoAuxiliar ?? null,
    activa: true,
    notas: null,
    created_at: ahora,
    created_by: 'sistema',
  }));
}

export const generarPlanCuentas = generarPlanCuentasMGG;
