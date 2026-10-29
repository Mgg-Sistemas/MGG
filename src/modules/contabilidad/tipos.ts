/* ============================================================
   MGG · Contabilidad · Tipos del módulo (maqueta)

   Siguen el modelo de datos v0 del Carril BD (docs/cuaderno/informes/
   contabilidad-modelo-v0.md, 20/10): mismas entidades `cont_*` y mismos
   nombres de columna en snake_case, para que el día que el módulo pase a
   Supabase el repositorio cambie de almacén y las pantallas no.

   Viven dentro del módulo y no en shared/lib/types.ts: la maqueta corre
   sobre datos simulados y los términos son provisionales hasta que llegue
   la investigación de Galac.

   Se omiten las columnas de auditoría comunes salvo created_at/created_by.
   ============================================================ */

export type Moneda = 'VES' | 'USD' | 'USDT' | 'EUR' | 'COP';

export type TipoNumeracion = 'tipo_mes_numero' | 'consecutivo' | 'mes_consecutivo';

/** cont_parametros: una sola fila. */
export interface ContParametros {
  id: true;
  /** «9.9.99.99.999»: cada grupo es un nivel y su ancho. */
  mascara_codigo: string;
  niveles: number;
  moneda_funcional: Moneda;
  moneda_referencia: Moneda;
  fuente_tasa: 'bcv' | 'binance_p2p' | 'manual';
  tolerancia_cuadre: number;
  cuenta_resultado_ejercicio_id: string | null;
  cuenta_utilidades_retenidas_id: string | null;
  cuenta_dif_cambio_ganancia_id: string | null;
  cuenta_dif_cambio_perdida_id: string | null;
  /** Galac §3.4: «06-000003», «000003» o «EG-06-000003». Cambio aprobado el 20/10 12:16 (antes numeracion_por). */
  tipo_numeracion: TipoNumeracion;
  /** Galac «Permitir Comprobantes descuadrados»: con false no se graba un descuadrado. Nuevo, 20/10 12:16. */
  permite_descuadrados: boolean;
  permite_fecha_futura: boolean;
  /** Encabezado de los reportes (DDL v0.4: opcional). */
  empresa_nombre: string | null;
  /** Para los asientos automáticos en cuentas que exigen centro y el hecho no lo trae (DDL v0.4). */
  centro_costo_defecto_id: string | null;
  /*
   * Los tipos de comprobante de los procesos (DDL v0.8, Master 29/10 05:26): ya no son códigos
   * fijos. Con los datos v1.7: 09, 10, 11 y 93.
   */
  /** El de la carga manual cuando no se elige tipo. */
  tipo_comprobante_defecto_id: string | null;
  /** El del diferencial cambiario del cierre de mes. */
  tipo_diferencial_id: string | null;
  /** El del cierre del ejercicio (cuentas de resultado y traslado). */
  tipo_cierre_id: string | null;
  /** El de la apertura del ejercicio siguiente. */
  tipo_apertura_id: string | null;
}

/** cont_ejercicios */
export interface ContEjercicio {
  id: string;
  nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
  /** pre_cierre (Galac lo recomienda): cerrado, pero se puede reabrir; cerrado = definitivo. DDL v0.4. */
  estado: 'abierto' | 'pre_cierre' | 'cerrado';
  cerrado_en: string | null;
  cerrado_por: string | null;
  comprobante_cierre_id: string | null;
}

/** cont_periodos: 1 a 12, y 13 = período de cierre. */
export interface ContPeriodo {
  id: string;
  ejercicio_id: string;
  numero: number;
  /** AAAAMM; el 13 es AAAA13. */
  codigo: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado: 'abierto' | 'cerrado';
  cerrado_en: string | null;
  cerrado_por: string | null;
  reabierto_en: string | null;
  reabierto_por: string | null;
  reabierto_motivo: string | null;
}

export type ClaseCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto' | 'orden';
export type Naturaleza = 'deudora' | 'acreedora';
export type TipoAuxiliar = 'proveedor' | 'cliente' | 'empleado' | 'banco' | 'centro_acopio' | 'intercompania' | 'otro';

/** cont_cuentas: el plan de cuentas. */
export interface ContCuenta {
  id: string;
  /** Único; respeta la máscara («1.1.01.01.001»). */
  codigo: string;
  nombre: string;
  nivel: number;
  /** Null solo en el nivel 1. Se asigna siempre a partir del código. */
  padre_id: string | null;
  clase: ClaseCuenta;
  naturaleza: Naturaleza;
  /** false = de título (agrupa, no recibe asientos); true = de movimiento. */
  es_movimiento: boolean;
  exige_centro_costo: boolean;
  exige_auxiliar: boolean;
  tipo_auxiliar: TipoAuxiliar | null;
  /** null = cualquiera; una divisa = cuenta en divisa (se revalúa al cierre). */
  moneda: Moneda | null;
  es_monetaria: boolean;
  rubro: string | null;
  /** Una cuenta no se borra: se inactiva. */
  activa: boolean;
  notas: string | null;
  created_at: string;
  created_by: string | null;
}

/** Lo que pide la pantalla para crear una cuenta; el resto lo deriva el repositorio. */
export interface CuentaInput {
  codigo: string;
  nombre: string;
  es_movimiento: boolean;
  naturaleza: Naturaleza;
  clase: ClaseCuenta;
  exige_centro_costo: boolean;
  exige_auxiliar: boolean;
  tipo_auxiliar: TipoAuxiliar | null;
  moneda: Moneda | null;
  es_monetaria: boolean;
}

/**
 * cont_monedas: el catálogo de monedas (Galac «Moneda»). El código es texto (ISO o los de
 * Galac, como «1BT» o «9E1»); las monedas con las que opera la maqueta son las de `Moneda`.
 */
export interface ContMoneda {
  codigo: string;
  nombre: string;
  /** Vacío si Galac no trae símbolo. */
  simbolo: string;
  decimales: number;
  activa: boolean;
}

/**
 * cont_tipos_comprobante (DDL v0.8). Código de 2 DÍGITOS de Galac (^[0-9]{2}$); el 90-98 es del
 * sistema (Master, 29/10 05:13). Los procesos (diferencial, cierre, apertura) NO son «sistema»:
 * toman su tipo de Parámetros.
 */
export interface ContTipoComprobante {
  id: string;
  codigo: string;
  nombre: string;
  origen: 'manual' | 'automatico' | 'ambos';
  activo: boolean;
  /** Columna GENERADA en la base (codigo ~ '^9[0-8]$'): se calcula, nunca se escribe. */
  readonly sistema: boolean;
}

/** cont_centros_costo */
export interface ContCentroCosto {
  id: string;
  codigo: string;
  nombre: string;
  padre_id: string | null;
  tipo: 'sede' | 'centro_acopio' | 'area' | 'equipo';
  origen_clave: string | null;
  activo: boolean;
}

/** cont_auxiliares: terceros. En la simulación, el RIF siempre es ficticio o nulo. */
export interface ContAuxiliar {
  id: string;
  tipo: TipoAuxiliar;
  codigo: string;
  nombre: string;
  rif: string | null;
  origen_tabla: string | null;
  origen_id: string | null;
  activo: boolean;
}

/** cont_paises: la tabla «País» de Galac (DDL v0.8, aprobada por Master 29/10 05:13). */
export interface ContPais {
  /** 2 letras ISO. */
  codigo: string;
  nombre: string;
  activo: boolean;
}

/**
 * cont_monedas_locales: «Moneda Local» de Galac: la moneda de curso de cada país, con sus
 * reconversiones. DDL v0.8: sin id; la PK es (codigo_pais, codigo_moneda, vigencia_desde), y
 * vigencia_hasta vale por defecto 2079-06-06 (la vigencia abierta de Galac).
 */
export interface ContMonedaLocal {
  codigo_pais: string;
  codigo_moneda: string;
  factor_conversion: number;
  codigo_moneda_anterior: string | null;
  vigencia_desde: string;
  vigencia_hasta: string;
  activo: boolean;
}

/**
 * cont_cambios: «Cambio» de Galac, las tasas que carga el usuario. Misma forma que cont_tasas, en su
 * propia tabla: Contabilidad no escribe en las tasas del sistema (aislamiento, §4 quater). La manual
 * manda en su fecha (Master, 29/10 05:13).
 */
export interface ContCambio {
  id: string;
  fecha: string;
  moneda: string;
  tasa_ves: number;
  fuente: 'manual';
  activo: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** cont_tasas: bolívares por unidad de moneda, por día. */
export interface ContTasa {
  id: string;
  fecha: string;
  moneda: Moneda;
  tasa_ves: number;
  /** DDL v0.6: cont_tasas es una vista sobre tasa_cambio; suma 'trm' y 'er_api' (COP). Contabilidad no escribe tasas. */
  fuente: 'bcv' | 'binance_p2p' | 'manual' | 'trm' | 'er_api';
}

/**
 * Galac: el status lo decide el cuadre. Un descuadrado se graba pero no
 * entra en saldos ni informes. No hay borrador ni anulado: se reversa.
 * (Cambio aprobado el 20/10 12:16; antes borrador/contabilizado/anulado.)
 */
export type EstadoComprobante = 'contabilizado' | 'descuadrado';
export type OrigenComprobante = 'manual' | 'automatico' | 'apertura' | 'cierre' | 'reverso';

/** Un evento del historial del comprobante: solo se agrega, nunca se reescribe (decisión del usuario, 20/10 13:04). */
export interface EventoComprobante {
  at: string;
  evento: 'grabado' | 'modificado' | 'reversado';
  actor: string;
  [extra: string]: unknown;
}

/** cont_comprobantes: cabecera del asiento (DDL v0.4 + historial aprobado para la v0.5). */
export interface ContComprobante {
  id: string;
  /** El código se repite cada año: es único por ejercicio. */
  ejercicio_id: string;
  tipo_id: string;
  periodo_id: string;
  /** Se asigna al grabar, también si queda descuadrado. Correlativo según cont_parametros.tipo_numeracion. */
  numero: number;
  /** «06-000003», «000003» o «EG-06-000003». */
  codigo: string;
  fecha: string;
  /** «Descripción» del comprobante en Galac. */
  concepto: string;
  estado: EstadoComprobante;
  origen: OrigenComprobante;
  origen_modulo: string | null;
  origen_tabla: string | null;
  origen_id: string | null;
  origen_ref: string | null;
  /** «Número de Lote» de Galac: reglas por lote e importaciones. */
  numero_lote: string | null;
  /** Un contabilizado que alguien modificó (con el mes abierto). */
  modificado: boolean;
  regla_id: string | null;
  moneda_documento: Moneda;
  /** VES por USD de la fecha. */
  tasa: number | null;
  total_debe_ves: number;
  total_haber_ves: number;
  total_debe_usd: number;
  total_haber_usd: number;
  /** En el reverso: el comprobante que reversa. «Reversado por N°…» del original se deriva de aquí. */
  reverso_de_id: string | null;
  /** «grabado», «modificado» (con el antes y el después) y «reversado». Aprobado para la v0.5 (20/10 13:07). */
  historial: EventoComprobante[];
  /** «Operador». */
  created_at: string;
  created_by: string | null;
  /** «Última Modificación». */
  updated_at: string | null;
  updated_by: string | null;
}

/** cont_comprobante_lineas: renglones. Uno de debe/haber > 0 y el otro 0, del mismo lado en VES y en USD. */
export interface ContComprobanteLinea {
  id: string;
  comprobante_id: string;
  renglon: number;
  cuenta_id: string;
  centro_costo_id: string | null;
  auxiliar_id: string | null;
  descripcion: string | null;
  /** Galac «Referencia» (n.° de cheque o soporte). Antes `documento`; cambio aprobado el 20/10 12:16. */
  referencia: string | null;
  /** Galac «Fecha Ref.»: solo si difiere de la del comprobante. Nuevo, 20/10 12:16. */
  fecha_referencia: string | null;
  moneda: Moneda;
  monto_moneda: number;
  /** VES por unidad de `moneda` (1 si es VES). */
  tasa: number;
  debe_ves: number;
  haber_ves: number;
  debe_usd: number;
  haber_usd: number;
}

/** cont_cierres: un cierre de mes o de ejercicio, con la foto de saldos (DDL v0.5). Uno vigente por mes y por ejercicio. */
export interface ContCierre {
  id: string;
  tipo: 'mes' | 'ejercicio';
  /** Solo de ejercicio: pre_cierre (reabrible) o definitivo. */
  tipo_cierre: 'pre_cierre' | 'definitivo' | null;
  periodo_id: string | null;
  ejercicio_id: string | null;
  estado: 'vigente' | 'reabierto';
  /** El diferencial cambiario (mes) o el primer comprobante de cierre de resultados (ejercicio). */
  comprobante_id: string | null;
  /** Foto de saldos al cerrar: código de cuenta → saldo en Bs y en $. */
  saldos: Record<string, { saldo_ves: number; saldo_usd: number }>;
  hecho_en: string;
  hecho_por: string;
  reabierto_en: string | null;
  reabierto_por: string | null;
  reabierto_motivo: string | null;
}

/**
 * cont_integraciones: un documento de otro módulo frente a Contabilidad (DDL v0.6, 1.15).
 * Única (origen_tabla, origen_id, evento): un hecho no se contabiliza dos veces.
 */
export interface ContIntegracion {
  id: string;
  origen_modulo: string;
  origen_tabla: string;
  origen_id: string;
  evento: string;
  fecha: string;
  estado: 'pendiente' | 'contabilizado' | 'error' | 'excluido';
  comprobante_id: string | null;
  /** Obligatorio con estado «error». */
  error: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * cont_esquemas_ef: la estructura de un estado financiero (DDL v0.7, C44). `definicion` es
 * estructura_ef[tipo] de los datos, sin transformar. Uno por defecto por tipo.
 */
export interface ContEsquemaEf {
  id: string;
  /** Minúsculas, dígitos y guion bajo. */
  codigo: string;
  tipo: 'balance_general' | 'estado_resultados';
  nombre: string;
  definicion: Record<string, unknown>;
  por_defecto: boolean;
  activo: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export type TipoMapeo = 'caja' | 'categoria_gasto' | 'almacen' | 'categoria_producto' | 'centro_acopio';

/** cont_reglas: de un hecho de un módulo a un comprobante (DDL v0.4, con los datos de Galac). */
export interface ContRegla {
  id: string;
  codigo: string;
  nombre: string;
  origen_modulo: string;
  /** La pestaña de Galac donde vive la regla: «Pagos», «Caja Chica», «Producción»… */
  pestana: string;
  evento: string;
  tipo_comprobante_id: string;
  /** Filtro opcional sobre los campos del hecho: { "clase": "servicio" }. */
  condicion: Record<string, string> | null;
  como_contabilizar: 'inmediata' | 'pospuesta';
  tipo_contabilizacion: 'cada_documento' | 'por_lote';
  editar_al_generar: boolean;
  version: number;
  vigente_desde: string;
  vigente_hasta: string | null;
  activa: boolean;
}

/** cont_regla_lineas: la plantilla de renglones de una regla. */
export interface ContReglaLinea {
  id: string;
  regla_id: string;
  renglon: number;
  lado: 'debe' | 'haber';
  cuenta_fuente: 'fija' | 'por_mapeo';
  cuenta_id: string | null;
  mapeo_tipo: TipoMapeo | null;
  /** De qué campo del hecho sale la clave del mapeo; null = el mismo nombre que mapeo_tipo. */
  mapeo_campo: string | null;
  /** Nombre de un importe del hecho (lista abierta: total, base, iva, neto, recibido…). */
  importe: string;
  centro_fuente: 'ninguno' | 'del_evento' | 'fijo';
  centro_costo_id: string | null;
  auxiliar_fuente: 'ninguno' | 'proveedor' | 'cliente' | 'empleado' | 'intercompania' | 'caja' | 'centro_acopio';
  descripcion: string | null;
}

/** cont_mapeos: qué cuenta corresponde a cada cosa de MGG (caja, categoría de gasto, almacén…). */
export interface ContMapeo {
  id: string;
  tipo: TipoMapeo;
  clave: string;
  cuenta_id: string;
  centro_costo_id: string | null;
}

/** Todo lo que guarda la simulación. Lleva versión para descartar estados viejos. */
export interface EstadoSimulacion {
  version: number;
  cont_parametros: ContParametros;
  cont_ejercicios: ContEjercicio[];
  cont_periodos: ContPeriodo[];
  cont_cuentas: ContCuenta[];
  cont_monedas: ContMoneda[];
  cont_tipos_comprobante: ContTipoComprobante[];
  cont_centros_costo: ContCentroCosto[];
  cont_auxiliares: ContAuxiliar[];
  cont_tasas: ContTasa[];
  cont_comprobantes: ContComprobante[];
  cont_comprobante_lineas: ContComprobanteLinea[];
  cont_reglas: ContRegla[];
  cont_regla_lineas: ContReglaLinea[];
  cont_mapeos: ContMapeo[];
  cont_cierres: ContCierre[];
  cont_integraciones: ContIntegracion[];
  cont_esquemas_ef: ContEsquemaEf[];
  cont_paises: ContPais[];
  cont_monedas_locales: ContMonedaLocal[];
}
