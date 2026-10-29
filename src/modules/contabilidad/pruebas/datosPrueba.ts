/* ============================================================
   MGG · Contabilidad · Datos CHICOS para las pruebas de la lógica

   Datos FICTICIOS (identidad.md: sin RIF, nombres de personas ni montos
   reales): 118 cuentas y 11 comprobantes de 2026. Antes eran los datos
   de ejemplo de la pantalla; desde que la maqueta usa los del Carril BD
   (simulacion/datosBd.ts) quedan solo para las pruebas, que no deben
   depender del dataset que se muestra. Viven fuera de simulacion/ para
   sobrevivir a la migración, cuando esa carpeta se borre.
   ============================================================ */

import { claseSugerida, codigoPadre, nivelDe, naturalezaSugerida } from '../logica/planCuentas';
import { esTipoDelSistema } from '../logica/catalogos';
import { auxiliaresDeEjemplo, centrosDeEjemplo, comprobantesDeEjemplo, tasasDeEjemplo } from './comprobantesPrueba';
import type {
  ContCuenta, ContEjercicio, ContMoneda, ContParametros, ContPeriodo, ContTipoComprobante,
  EstadoSimulacion, Moneda, Naturaleza, TipoAuxiliar,
} from '../tipos';

/** Versión de los datos de prueba (la del almacén la fija cada estado base). */
export const VERSION_SIMULACION = 3;

const MASCARA = '9.9.99.99.999';
const CREADO = '2026-01-01T08:00:00.000Z';

/** Opciones de una cuenta que no salen de su código. */
interface Extra {
  naturaleza?: Naturaleza;
  auxiliar?: TipoAuxiliar;
  centro?: boolean;
  moneda?: Moneda;
  monetaria?: boolean;
  rubro?: string;
}

/** [código, nombre, extra]. Las de nivel 5 son de movimiento; las demás, de título. */
type Fila = [string, string, Extra?];

const PLAN: Fila[] = [
  ['1', 'ACTIVO'],
  ['1.1', 'ACTIVO CORRIENTE'],
  ['1.1.01', 'EFECTIVO Y EQUIVALENTES'],
  ['1.1.01.01', 'CAJAS'],
  ['1.1.01.01.001', 'CAJA PRINCIPAL BS', { monetaria: true, rubro: 'efectivo' }],
  ['1.1.01.01.002', 'CAJA PRINCIPAL USD', { moneda: 'USD', monetaria: true, rubro: 'efectivo' }],
  ['1.1.01.01.003', 'CAJA CHICA ADMINISTRACIÓN', { monetaria: true, rubro: 'efectivo' }],
  ['1.1.01.02', 'BANCOS NACIONALES'],
  ['1.1.01.02.001', 'BANCO EJEMPLO UNO · CUENTA CORRIENTE', { auxiliar: 'banco', monetaria: true, rubro: 'efectivo' }],
  ['1.1.01.02.002', 'BANCO EJEMPLO DOS · CUENTA CORRIENTE', { auxiliar: 'banco', monetaria: true, rubro: 'efectivo' }],
  ['1.1.01.03', 'DIVISAS Y BILLETERAS'],
  ['1.1.01.03.001', 'CUENTA EN DIVISAS', { moneda: 'USD', monetaria: true, rubro: 'efectivo' }],
  ['1.1.01.03.002', 'BILLETERA USDT', { moneda: 'USDT', monetaria: true, rubro: 'efectivo' }],
  ['1.1.02', 'CUENTAS POR COBRAR'],
  ['1.1.02.01', 'CLIENTES'],
  ['1.1.02.01.001', 'CLIENTES NACIONALES', { auxiliar: 'cliente', monetaria: true, rubro: 'cxc_comerciales' }],
  ['1.1.02.01.002', 'CLIENTES DEL EXTERIOR', { auxiliar: 'cliente', moneda: 'USD', monetaria: true, rubro: 'cxc_comerciales' }],
  ['1.1.02.02', 'ANTICIPOS Y OTRAS CUENTAS POR COBRAR'],
  ['1.1.02.02.001', 'ANTICIPOS A PROVEEDORES', { auxiliar: 'proveedor', monetaria: true, rubro: 'otras_cxc' }],
  ['1.1.02.02.002', 'ANTICIPOS Y PRÉSTAMOS AL PERSONAL', { auxiliar: 'empleado', monetaria: true, rubro: 'otras_cxc' }],
  ['1.1.02.02.003', 'FONDOS EN CENTROS DE ACOPIO POR RENDIR', { auxiliar: 'centro_acopio', centro: true, monetaria: true, rubro: 'otras_cxc' }],
  ['1.1.03', 'INVENTARIOS'],
  ['1.1.03.01', 'MINERAL Y PRODUCTO'],
  ['1.1.03.01.001', 'CASITERITA EN EXISTENCIA', { centro: true, rubro: 'inventarios' }],
  ['1.1.03.01.002', 'ESTAÑO EN BRUTO', { rubro: 'inventarios' }],
  ['1.1.03.01.003', 'ESTAÑO REFINADO', { rubro: 'inventarios' }],
  ['1.1.03.02', 'MATERIALES Y SUMINISTROS'],
  ['1.1.03.02.001', 'REPUESTOS Y MATERIALES', { centro: true, rubro: 'inventarios' }],
  ['1.1.03.02.002', 'COMBUSTIBLES Y LUBRICANTES', { centro: true, rubro: 'inventarios' }],
  ['1.1.03.02.003', 'VÍVERES DEL COMEDOR', { centro: true, rubro: 'inventarios' }],
  ['1.1.04', 'IMPUESTOS POR RECUPERAR'],
  ['1.1.04.01', 'IVA'],
  ['1.1.04.01.001', 'IVA CRÉDITO FISCAL', { monetaria: true, rubro: 'impuestos_por_recuperar' }],
  ['1.1.04.01.002', 'IVA RETENIDO POR CLIENTES', { auxiliar: 'cliente', monetaria: true, rubro: 'impuestos_por_recuperar' }],
  ['1.1.04.02', 'ISLR'],
  ['1.1.04.02.001', 'ISLR RETENIDO POR CLIENTES', { auxiliar: 'cliente', monetaria: true, rubro: 'impuestos_por_recuperar' }],
  ['1.2', 'ACTIVO NO CORRIENTE'],
  ['1.2.01', 'PROPIEDAD, PLANTA Y EQUIPO'],
  ['1.2.01.01', 'COSTO'],
  ['1.2.01.01.001', 'TERRENOS', { rubro: 'ppe' }],
  ['1.2.01.01.002', 'EDIFICACIONES E INSTALACIONES', { rubro: 'ppe' }],
  ['1.2.01.01.003', 'MAQUINARIA Y EQUIPO PESADO', { centro: true, rubro: 'ppe' }],
  ['1.2.01.01.004', 'VEHÍCULOS', { centro: true, rubro: 'ppe' }],
  ['1.2.01.01.005', 'HORNOS Y EQUIPO DE FUNDICIÓN', { centro: true, rubro: 'ppe' }],
  ['1.2.01.02', 'DEPRECIACIÓN ACUMULADA'],
  ['1.2.01.02.001', 'DEPRECIACIÓN ACUMULADA EDIFICACIONES', { naturaleza: 'acreedora', rubro: 'ppe' }],
  ['1.2.01.02.002', 'DEPRECIACIÓN ACUMULADA MAQUINARIA', { naturaleza: 'acreedora', rubro: 'ppe' }],
  ['1.2.01.02.003', 'DEPRECIACIÓN ACUMULADA VEHÍCULOS', { naturaleza: 'acreedora', rubro: 'ppe' }],
  ['2', 'PASIVO'],
  ['2.1', 'PASIVO CORRIENTE'],
  ['2.1.01', 'CUENTAS POR PAGAR'],
  ['2.1.01.01', 'PROVEEDORES'],
  ['2.1.01.01.001', 'PROVEEDORES NACIONALES', { auxiliar: 'proveedor', monetaria: true, rubro: 'cxp_comerciales' }],
  ['2.1.01.01.002', 'PROVEEDORES DEL EXTERIOR', { auxiliar: 'proveedor', moneda: 'USD', monetaria: true, rubro: 'cxp_comerciales' }],
  ['2.1.01.02', 'OTRAS CUENTAS POR PAGAR'],
  ['2.1.01.02.001', 'ALIADOS DE ACOPIO POR PAGAR', { auxiliar: 'centro_acopio', monetaria: true, rubro: 'otras_cxp' }],
  ['2.1.02', 'OBLIGACIONES LABORALES'],
  ['2.1.02.01', 'NÓMINA'],
  ['2.1.02.01.001', 'SUELDOS POR PAGAR', { auxiliar: 'empleado', monetaria: true, rubro: 'obligaciones_laborales' }],
  ['2.1.02.01.002', 'PRESTACIONES SOCIALES', { auxiliar: 'empleado', monetaria: true, rubro: 'obligaciones_laborales' }],
  ['2.1.02.01.003', 'APORTES IVSS Y FAOV POR PAGAR', { monetaria: true, rubro: 'obligaciones_laborales' }],
  ['2.1.03', 'IMPUESTOS POR PAGAR'],
  ['2.1.03.01', 'RETENCIONES POR ENTERAR'],
  ['2.1.03.01.001', 'RETENCIONES DE IVA POR ENTERAR', { monetaria: true, rubro: 'impuestos_por_pagar' }],
  ['2.1.03.01.002', 'RETENCIONES DE ISLR POR ENTERAR', { monetaria: true, rubro: 'impuestos_por_pagar' }],
  ['2.1.03.01.003', 'RETENCIONES MUNICIPALES POR ENTERAR', { monetaria: true, rubro: 'impuestos_por_pagar' }],
  ['2.1.03.02', 'IMPUESTOS'],
  ['2.1.03.02.001', 'IVA DÉBITO FISCAL', { monetaria: true, rubro: 'impuestos_por_pagar' }],
  ['2.1.03.02.002', 'ISLR POR PAGAR', { monetaria: true, rubro: 'impuestos_por_pagar' }],
  ['2.2', 'PASIVO NO CORRIENTE'],
  ['2.2.01', 'PRÉSTAMOS A LARGO PLAZO'],
  ['2.2.01.01', 'PRÉSTAMOS'],
  ['2.2.01.01.001', 'PRÉSTAMOS DE ACCIONISTAS', { moneda: 'USD', monetaria: true, rubro: 'prestamos' }],
  ['3', 'PATRIMONIO'],
  ['3.1', 'CAPITAL'],
  ['3.1.01', 'CAPITAL SOCIAL'],
  ['3.1.01.01', 'CAPITAL'],
  ['3.1.01.01.001', 'CAPITAL SUSCRITO Y PAGADO', { rubro: 'capital' }],
  ['3.2', 'RESULTADOS'],
  ['3.2.01', 'RESULTADOS ACUMULADOS'],
  ['3.2.01.01', 'RESULTADOS'],
  ['3.2.01.01.001', 'UTILIDADES (PÉRDIDAS) ACUMULADAS', { rubro: 'resultados' }],
  ['3.2.01.01.002', 'RESULTADO DEL EJERCICIO', { rubro: 'resultados' }],
  ['4', 'INGRESOS'],
  ['4.1', 'INGRESOS OPERACIONALES'],
  ['4.1.01', 'VENTAS'],
  ['4.1.01.01', 'VENTAS DE MINERAL'],
  ['4.1.01.01.001', 'VENTAS DE CASITERITA', { auxiliar: 'cliente', rubro: 'ventas' }],
  ['4.1.01.01.002', 'VENTAS DE ESTAÑO', { auxiliar: 'cliente', rubro: 'ventas' }],
  ['4.2', 'OTROS INGRESOS'],
  ['4.2.01', 'INGRESOS FINANCIEROS'],
  ['4.2.01.01', 'FINANCIEROS'],
  ['4.2.01.01.001', 'GANANCIA POR DIFERENCIAL CAMBIARIO', { rubro: 'otros_ingresos' }],
  ['5', 'COSTOS'],
  ['5.1', 'COSTO DE VENTAS'],
  ['5.1.01', 'COSTO DE PRODUCCIÓN'],
  ['5.1.01.01', 'COSTOS DIRECTOS'],
  ['5.1.01.01.001', 'COMPRA DE MINERAL EN ACOPIO', { centro: true, rubro: 'costo_ventas' }],
  ['5.1.01.01.002', 'COSTO DE FUNDICIÓN', { centro: true, rubro: 'costo_ventas' }],
  ['5.1.01.01.003', 'COSTO DE REFINACIÓN', { centro: true, rubro: 'costo_ventas' }],
  ['6', 'GASTOS'],
  ['6.1', 'GASTOS DE OPERACIÓN Y ADMINISTRACIÓN'],
  ['6.1.01', 'GASTOS DE PERSONAL'],
  ['6.1.01.01', 'PERSONAL'],
  ['6.1.01.01.001', 'SUELDOS Y SALARIOS', { centro: true, rubro: 'gastos_personal' }],
  ['6.1.01.01.002', 'ALIMENTACIÓN DEL PERSONAL', { centro: true, rubro: 'gastos_personal' }],
  ['6.1.02', 'GASTOS GENERALES'],
  ['6.1.02.01', 'GENERALES'],
  ['6.1.02.01.001', 'COMBUSTIBLE', { centro: true, rubro: 'gastos_generales' }],
  ['6.1.02.01.002', 'MANTENIMIENTO DE MAQUINARIA', { centro: true, rubro: 'gastos_generales' }],
  ['6.1.02.01.003', 'SERVICIOS', { centro: true, rubro: 'gastos_generales' }],
  ['6.1.02.01.004', 'DEPRECIACIÓN DEL EJERCICIO', { centro: true, rubro: 'gastos_generales' }],
  ['6.2', 'GASTOS FINANCIEROS'],
  ['6.2.01', 'GASTOS FINANCIEROS'],
  ['6.2.01.01', 'FINANCIEROS'],
  ['6.2.01.01.001', 'COMISIONES BANCARIAS', { rubro: 'gastos_financieros' }],
  ['6.2.01.01.002', 'IMPUESTO A LAS GRANDES TRANSACCIONES (IGTF)', { rubro: 'gastos_financieros' }],
  ['6.2.01.01.003', 'PÉRDIDA POR DIFERENCIAL CAMBIARIO', { rubro: 'gastos_financieros' }],
];

const idCuenta = (codigo: string): string => `cta-${codigo}`;

function cuentasDeEjemplo(): ContCuenta[] {
  return PLAN.map(([codigo, nombre, extra = {}]) => {
    const clase = claseSugerida(codigo);
    const padre = codigoPadre(codigo);
    const nivel = nivelDe(codigo);
    return {
      id: idCuenta(codigo),
      codigo,
      nombre,
      nivel,
      padre_id: padre ? idCuenta(padre) : null,
      clase,
      naturaleza: extra.naturaleza ?? naturalezaSugerida(clase),
      es_movimiento: nivel === 5,
      exige_centro_costo: extra.centro ?? false,
      exige_auxiliar: extra.auxiliar != null,
      tipo_auxiliar: extra.auxiliar ?? null,
      moneda: extra.moneda ?? null,
      es_monetaria: extra.monetaria ?? false,
      rubro: extra.rubro ?? null,
      activa: true,
      notas: null,
      created_at: CREADO,
      created_by: 'simulacion',
    };
  });
}

const EJERCICIO_ID = 'ej-2026';

function ejercicioDeEjemplo(): ContEjercicio {
  return {
    id: EJERCICIO_ID, nombre: '2026', fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31',
    estado: 'abierto', cerrado_en: null, cerrado_por: null, comprobante_cierre_id: null,
  };
}

/** Los 12 meses de 2026 y el período 13 (cierre), todos abiertos. */
function periodosDeEjemplo(): ContPeriodo[] {
  const periodos: ContPeriodo[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const ultimo = new Date(Date.UTC(2026, m, 0)).getUTCDate();
    periodos.push({
      id: `per-2026${mm}`, ejercicio_id: EJERCICIO_ID, numero: m, codigo: `2026${mm}`,
      fecha_inicio: `2026-${mm}-01`, fecha_fin: `2026-${mm}-${ultimo}`, estado: 'abierto',
      cerrado_en: null, cerrado_por: null, reabierto_en: null, reabierto_por: null, reabierto_motivo: null,
    });
  }
  periodos.push({
    id: 'per-202613', ejercicio_id: EJERCICIO_ID, numero: 13, codigo: '202613',
    fecha_inicio: '2026-12-31', fecha_fin: '2026-12-31', estado: 'abierto',
    cerrado_en: null, cerrado_por: null, reabierto_en: null, reabierto_por: null, reabierto_motivo: null,
  });
  return periodos;
}

const MONEDAS: ContMoneda[] = [
  { codigo: 'VES', nombre: 'Bolívar', simbolo: 'Bs', decimales: 2, activa: true },
  { codigo: 'USD', nombre: 'Dólar estadounidense', simbolo: '$', decimales: 2, activa: true },
  { codigo: 'USDT', nombre: 'Tether', simbolo: '₮', decimales: 2, activa: true },
  { codigo: 'EUR', nombre: 'Euro', simbolo: '€', decimales: 2, activa: false },
  { codigo: 'COP', nombre: 'Peso colombiano', simbolo: 'COL$', decimales: 2, activa: false },
];

const TIPOS_COMPROBANTE: Array<[string, string, ContTipoComprobante['origen']]> = [
  ['09', 'Diario', 'manual'],
  ['02', 'Ingreso', 'ambos'],
  ['01', 'Egreso', 'ambos'],
  ['04', 'Compras', 'ambos'],
  ['05', 'Ventas', 'ambos'],
  ['07', 'Nómina', 'ambos'],
  ['08', 'Inventario', 'automatico'],
  ['10', 'Ajuste', 'manual'],
  ['93', 'Apertura', 'manual'],
  ['11', 'Cierre', 'automatico'],
];

function parametrosDeEjemplo(): ContParametros {
  return {
    id: true,
    mascara_codigo: MASCARA,
    niveles: MASCARA.split('.').length,
    moneda_funcional: 'VES',
    moneda_referencia: 'USD',
    fuente_tasa: 'bcv',
    tolerancia_cuadre: 0.01,
    cuenta_resultado_ejercicio_id: idCuenta('3.2.01.01.002'),
    cuenta_utilidades_retenidas_id: idCuenta('3.2.01.01.001'),
    cuenta_dif_cambio_ganancia_id: idCuenta('4.2.01.01.001'),
    cuenta_dif_cambio_perdida_id: idCuenta('6.2.01.01.003'),
    tipo_numeracion: 'mes_consecutivo',
    permite_descuadrados: true,
    permite_fecha_futura: false,
    empresa_nombre: 'EMPRESA DE EJEMPLO, C.A.',
    centro_costo_defecto_id: 'cc-CC-01',
    tipo_comprobante_defecto_id: 'tc-09', tipo_diferencial_id: 'tc-10', tipo_cierre_id: 'tc-11', tipo_apertura_id: 'tc-93',
  };
}

/** Un estado nuevo, sin compartir referencias con otro (cada llamada arma el suyo). */
export function estadoDePrueba(): EstadoSimulacion {
  const cuentas = cuentasDeEjemplo();
  const periodos = periodosDeEjemplo();
  const tipos: ContTipoComprobante[] = TIPOS_COMPROBANTE.map(([codigo, nombre, origen]) => ({
    id: `tc-${codigo}`, codigo, nombre, origen, activo: true, sistema: esTipoDelSistema(codigo),
  }));
  const tasas = tasasDeEjemplo();
  const parametros = parametrosDeEjemplo();
  const { comprobantes, lineas } = comprobantesDeEjemplo({
    cuentas, periodos, tipos, tasas, tipoNumeracion: parametros.tipo_numeracion, tolerancia: parametros.tolerancia_cuadre,
  });
  return {
    version: VERSION_SIMULACION,
    cont_parametros: parametros,
    cont_ejercicios: [ejercicioDeEjemplo()],
    cont_periodos: periodos,
    cont_cuentas: cuentas,
    cont_monedas: MONEDAS.map((m) => ({ ...m })),
    cont_tipos_comprobante: tipos,
    cont_centros_costo: centrosDeEjemplo(),
    cont_auxiliares: auxiliaresDeEjemplo(),
    cont_tasas: tasas,
    cont_comprobantes: comprobantes,
    cont_comprobante_lineas: lineas,
    cont_reglas: [],
    cont_regla_lineas: [],
    cont_mapeos: [],
    cont_cierres: [],
    cont_integraciones: [],
    cont_esquemas_ef: [],
    cont_paises: [{ codigo: 'VE', nombre: 'Venezuela', activo: true }],
    cont_monedas_locales: [],
  };
}
