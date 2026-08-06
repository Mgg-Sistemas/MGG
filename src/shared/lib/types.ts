/**
 * Los roles ahora se manejan dinámicamente vía la tabla `custom_roles` en Supabase.
 * Se mantiene el alias `string` para conservar la firma histórica sin restringir nuevos valores.
 */
export type Role = string;
export type EstadoGenerico = 'activo' | 'inactivo';
export type EstadoOrden = 'pendiente' | 'aprobada' | 'oc_creada' | 'confirmada_metodo' | 'oc_aprobada' | 'pagada' | 'oc_emitida' | 'rechazada' | 'recibida' | 'finalizada' | 'cancelada' | 'anulada' | 'desistida_proveedor' | 'reasignada' | 'por_recibir' | 'cuenta_abierta' | 'asignada';

/** Condiciones de pago de una oferta. */
export type CondicionPago = 'contra_entrega' | 'anticipado' | 'credito';

/** Una pata del pago de una OC (puede haber varias = multipago). */
export interface PagoMetodo {
  metodo: string;   // 'efectivo' | 'divisas_efectivo' | 'transferencia' | 'pago_movil' | 'binance_usdt' | 'zelle' | 'otro'
  moneda: string;   // Bs, USD, USDT, COP, …
  monto: number;
  datos?: Record<string, string>; // datos de pago del proveedor (pago móvil / transferencia / zelle / binance)
}
export type EstadoFactura = 'pendiente' | 'pagada' | 'anulada';
export type TipoMovimiento = 'creacion' | 'entrada' | 'salida' | 'consumo' | 'transferencia' | 'ajuste' | 'fundicion' | 'fin_fundicion';
export type NotifKind = 'info' | 'success' | 'warning' | 'error';
export type TipoInventario = 'inicial' | 'proceso' | 'final';

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  apellido?: string | null;
  role: Role;
  ci?: string | null;
  telefono?: string | null;
  departamento?: string | null;
  estado: EstadoGenerico;
  must_change_password?: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface Almacen {
  id: string;
  nombre: string;
  ubicacion?: string | null;
  /** Sede física (Matanzas, Los Pinos…) que agrupa la vista de almacenes. */
  sede?: string | null;
  /** Subalmacén: id del almacén padre. null/ausente = almacén principal. */
  parent_id?: string | null;
  /** Espacio de inventario al que pertenece: 'principal' (Inventario) o 'deposito'. */
  espacio?: string | null;
  estado: EstadoGenerico;
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
}

/** Horno de fundición/fundición. Se administra como las categorías:
 *  alta, renombrado e inhabilitación (con motivo). */
export interface Horno {
  id: string;
  nombre: string;
  estado: EstadoGenerico;
  /** Motivo por el cual se deshabilitó (obligatorio al inhabilitar). */
  motivo_inhabilitacion?: string | null;
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
}

/** Moneda de la tesorería (legacy, caja de una sola moneda). */
export type Moneda = 'USD' | 'Bs';

/** Monedas de la caja multimoneda. */
export type MonedaCaja = 'Bs' | 'USD' | 'USDT' | 'COP';

/** Cuentas/billeteras dentro de una caja. Bs se divide en jurídica/personal; las
 *  divisas usan 'general' o billeteras NOMBRADAS por el usuario (ej. usdt1, usdt2),
 *  que se guardan tal cual en `cuenta` y se muestran por separado. Por eso admite
 *  cualquier texto además de los valores base. */
export type CuentaCaja = 'general' | 'juridica' | 'personal' | (string & {});

/** Moneda con tasa de cambio referenciada (BCV/Binance/TRM). */
export type MonedaTasa = 'USD' | 'EUR' | 'USDT' | 'COP';

/** Saldo de una caja por (cuenta, moneda) con su tasa promedio ponderada.
 *  `moneda` es texto libre: además de las base (Bs/USD/USDT/COP) admite
 *  monedas registradas por el usuario. */
export interface CajaSaldo {
  id: string;
  caja_id: string;
  cuenta: CuentaCaja;
  moneda: string;
  saldo: number;
  /** Costo promedio ponderado en Bs por 1 unidad de la moneda (null/1 para Bs). */
  tasa_prom?: number | null;
  updated_at?: string | null;
  /** Solo en consultas con join. */
  caja?: { nombre: string } | null;
}

/** Lote de ingreso de divisa (trazabilidad de a qué tasa entró cada parte). */
export interface CajaLote {
  id: string;
  caja_id: string;
  cuenta: CuentaCaja;
  moneda: string;
  monto: number;
  tasa_bs?: number | null;   // Bs por 1 unidad al comprar
  origen?: string | null;
  motivo?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/** Punto de la serie histórica de tasas (para el gráfico). */
export interface TasaSnapshot {
  id: string;
  par: string;       // 'USDT_VES','USD_VES','COP_USD'
  tasa: number;
  fuente: string;
  at: string;
}

/** Fila del historial de tasas de cambio (BCV). */
export interface TasaCambio {
  id: string;
  fecha: string;        // YYYY-MM-DD
  moneda: MonedaTasa;
  tasa: number;         // Bs por 1 unidad de la moneda
  fuente: string;       // 'bcv' | 'manual'
  created_by?: string | null;
  at: string;
}

/** Tasa del día (snapshot): Bs por 1 USD y por 1 EUR. */
export interface TasaHoy {
  usd: number | null;
  eur: number | null;
  fecha: string | null;
}

/** Caja de la tesorería (cuenta de dinero con saldo). */
export interface Caja {
  id: string;
  nombre: string;
  moneda: Moneda;
  saldo: number;
  estado: EstadoGenerico;
  tipo?: string;   // 'caja' (normal) | 'centro_acopio'
  /** El centro de acopio vive en otra Supabase (otro sistema): el traslado se replica vía puente. */
  externo?: boolean;
  /** Identificador acordado entre ambos sistemas (ej. 'peramanal'). */
  empresa_codigo?: string | null;
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
}

/* ───────── Transferencias inter-sistema (puente entre dos Supabase) ───────── */
export type DireccionTransfer = 'saliente' | 'entrante';
export type EstadoTransfer = 'enviada' | 'por_confirmar' | 'recibida' | 'rechazada' | 'error';

/** Una pata por moneda de la transferencia (igual que un leg de traslado). */
export interface TransferLeg { cuenta: CuentaCaja; moneda: string; monto: number; tasa_bs?: number | null; }

/** Transferencia de dinero entre dos sistemas independientes (cada uno su Supabase).
 *  `transf_id` es el id GLOBAL compartido por ambos lados (idempotencia). */
export interface TransferenciaInter {
  id: string;
  transf_id: string;
  direccion: DireccionTransfer;
  estado: EstadoTransfer;
  empresa_origen: string;
  empresa_destino: string;
  caja_id?: string | null;
  caja_nombre?: string | null;
  legs: TransferLeg[];
  resumen?: string | null;
  motivo?: string | null;
  callback_base?: string | null;
  mensaje_error?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  confirmada_at?: string | null;
  /** Aceptación por módulo de una entrante (mismo monto en Tesorería y en el Centro de Acopio). */
  recibida_tesoreria?: boolean | null;
  recibida_acopio?: boolean | null;
}

export type TipoMovimientoCaja = 'ingreso' | 'entrada' | 'salida' | 'traslado_salida' | 'traslado_entrada' | 'ajuste';
export type EstadoMineral = 'pendiente' | 'conciliada';

/** Movimiento del libro de una caja. Para `tipo='salida'` puede llevar la
 *  conciliación con la recepción de mineral equivalente al dinero enviado. */
export interface MovimientoCaja {
  id: string;
  caja_id: string;
  tipo: TipoMovimientoCaja;
  monto: number;
  moneda: Moneda;
  saldo_antes: number;
  saldo_despues: number;
  motivo?: string | null;
  destino?: string | null;
  /** Texto de la nota de entrega (se imprime en el PDF cuando está marcada). */
  nota_entrega?: string | null;
  ref_caja_id?: string | null;
  estado_mineral?: EstadoMineral | null;
  mineral_producto_id?: string | null;
  mineral_producto_nombre?: string | null;
  mineral_cantidad?: number | null;
  mineral_unidad?: string | null;
  mineral_costo_unit?: number | null;
  mineral_descripcion?: string | null;
  mineral_mov_id?: string | null;
  conciliada_at?: string | null;
  /** Tesorería: etiqueta del egreso ('gasto' / 'pago_personal' / 'pago_oc'). */
  categoria?: string | null;
  /** Gasto: categoría y subcategoría del catálogo de gastos (obligatorias al registrar). */
  gasto_categoria?: string | null;
  gasto_subcategoria?: string | null;
  /** Correlativo numérico (solo categorías numeradas: RECEPCION / EXPORTACION). */
  gasto_correlativo?: number | null;
  beneficiario?: string | null;
  beneficiario_id?: string | null;
  ref_orden_id?: string | null;
  /** Enlace al renglón de nómina pagado (categoría 'pago_nomina'). */
  ref_nomina_renglon_id?: string | null;
  /** Multimoneda: cuenta (Bs jurídica/personal) y tasa aplicada (Bs por unidad). */
  cuenta?: string | null;
  tasa_bs?: number | null;
  actor: string;
  actor_name?: string | null;
  at: string;
  /** Solo en consultas con join: la caja de este movimiento. */
  caja?: { nombre: string; moneda: Moneda } | null;
}

/* ───────────── Retenciones e impuestos (Tesorería) ───────────── */

export type TipoRetencion = 'IVA' | 'ISLR' | 'MUNICIPAL';

export interface Retencion {
  id: string;
  tipo: TipoRetencion;
  proveedor_id?: string | null;
  orden_id?: string | null;
  base: number;
  porcentaje: number;
  monto: number;
  moneda: string;
  comprobante_nro?: string | null;
  fecha: string;
  descripcion?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/* ───────────── Combustible ───────────── */

/** Tipo de combustible con su stock (litros) y costo promedio por litro. */
export interface Combustible {
  id: string;
  nombre: string;
  /** Sede dueña del combustible (LOS PINOS, MATANZAS…). */
  sede?: string | null;
  litros: number;
  costo_litro: number;
  estado: EstadoGenerico;
  /** Producto del inventario al que está vinculado este combustible. */
  producto_id?: string | null;
  /** Almacén "casa" del combustible (el del producto vinculado). Derivado al listar. */
  home_almacen?: string | null;
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
}

/** Tanque/depósito físico de combustible: capacidad, ubicación y litros propios. */
export interface Tanque {
  id: string;
  nombre: string;
  /** Combustible que almacena (puede quedar null si se borra el combustible). */
  combustible_id?: string | null;
  /** Nombre del combustible, derivado al listar (join). */
  combustible_nombre?: string | null;
  capacidad_litros: number;
  /** Litros actuales en el tanque (suben con ingresos, bajan con salidas). */
  litros: number;
  ubicacion?: string | null;
  /** Sede dueña del tanque (LOS PINOS, MATANZAS…). */
  sede?: string | null;
  /** Tasa del tanque (p. ej. 0.50), editable. */
  tasa?: number | null;
  /** Nota de cubicación del tanque (editable). */
  cubicacion?: string | null;
  /** Forma del tanque para la cubicación. */
  forma?: 'cilindro' | 'rectangular' | null;
  /** Geometría (cm). Cilindro: diámetro + longitud(largo). Rectangular: longitud(largo) + ancho + altura. */
  diametro_cm?: number | null;
  longitud_cm?: number | null;
  ancho_cm?: number | null;
  altura_cm?: number | null;
  estado: EstadoGenerico;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** Movimiento de consumo de una Planta Eléctrica (por horómetro), atado a un tanque.
 *  HRS = horómetro_final − horómetro_inicial · litros = HRS × litros_por_hora (12 por defecto). */
export interface PlantaMovimiento {
  id: string;
  planta?: string | null;
  tanque_id?: string | null;
  tanque_nombre?: string | null;
  fecha: string;
  horometro_inicial: number;
  horometro_final: number;
  horas: number;
  litros_por_hora: number;
  tasa?: number | null;
  litros_consumidos: number;
  /** Litros acumulados consumidos (para la alerta de 100 L). */
  litros_acumulados?: number | null;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/** Vehículo o máquina al que se destina una salida de combustible. */
export interface VehiculoMaquina {
  id: string;
  nombre: string;
  descripcion?: string | null;
  estado: EstadoGenerico;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** Ítem de catálogo simple del módulo Combustible (autorizados, ubicaciones). */
export interface CatalogoCombustible {
  id: string;
  nombre: string;
  estado: EstadoGenerico;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** Tipo de movimiento de tanque: ingreso/retorno suman, consumo/merma restan. */
export type TipoMovimientoTanque = 'ingreso' | 'consumo' | 'retorno' | 'merma';

/** Movimiento de un tanque (botón "Registrar Movimiento" / vista "MOVIMIENTOS"). */
export interface TanqueMovimiento {
  id: string;
  tanque_id?: string | null;
  tanque_nombre?: string | null;
  tipo: TipoMovimientoTanque;
  fecha: string;
  litros: number;
  litros_antes?: number | null;
  litros_despues?: number | null;
  horometro_inicial?: number | null;
  horometro_final?: number | null;
  contador_global_ini?: number | null;
  contador_global_fin?: number | null;
  equipo?: string | null;
  autorizado_por?: string | null;
  despachado_por?: string | null;
  destino?: string | null;
  observacion?: string | null;
  combustible_id?: string | null;
  costo_litro?: number | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/** Traslado de combustible (litros) entre dos sistemas independientes (cada uno
 *  su Supabase). Mismo patrón que TransferenciaInter pero el recurso son litros
 *  que, al confirmar, entran a un tanque de MGG. `transf_id` es el id global. */
export interface TransferenciaCombustibleInter {
  id: string;
  transf_id: string;
  direccion: DireccionTransfer;
  estado: EstadoTransfer;
  empresa_origen: string;
  empresa_destino: string;
  combustible_nombre: string;
  litros: number;
  costo_litro?: number | null;
  /** Tanque MGG que recibe (se elige al confirmar la entrante). */
  tanque_id?: string | null;
  tanque_nombre?: string | null;
  resumen?: string | null;
  motivo?: string | null;
  callback_base?: string | null;
  mensaje_error?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  confirmada_at?: string | null;
}

export type TipoMovCombustible = 'ingreso' | 'salida' | 'ajuste';

export interface MovimientoCombustible {
  id: string;
  combustible_id: string;
  tipo: TipoMovCombustible;
  litros: number;
  costo_litro?: number | null;
  litros_antes: number;
  litros_despues: number;
  ref_solicitud_id?: string | null;
  detalle?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  at: string;
}

export type EstadoSolicitudCombustible = 'por_aprobar' | 'aprobada' | 'finalizada' | 'cancelada';

/** Solicitud de salida de combustible (flujo por aprobar → aprobada → finalizada). */
export interface SolicitudCombustible {
  id: string;
  codigo: string;
  combustible_id: string | null;
  combustible_nombre: string;
  solicitante: string;
  destino: string;
  /** Almacén del inventario de donde sale el combustible al finalizar. */
  almacen?: string | null;
  /** Tanque origen (opcional): al finalizar descuenta del tanque y del inventario. */
  tanque_id?: string | null;
  tanque_nombre?: string | null;
  litros: number;
  /** Litros realmente surtidos al finalizar (puede diferir de lo solicitado). */
  litros_reales?: number | null;
  /** Telemetría capturada al surtir: horómetro del equipo e indicadores del surtidor. */
  horometro_inicial?: number | null;
  horometro_final?: number | null;
  contador_ini?: number | null;
  contador_fin?: number | null;
  /** Movimiento de tanque (consumo) generado al finalizar, para la cadena/telemetría. */
  tanque_mov_id?: string | null;
  estado: EstadoSolicitudCombustible;
  motivo?: string | null;
  historial: EventoHistorial[];
  aprobada_por?: string | null;
  aprobada_en?: string | null;
  finalizada_por?: string | null;
  finalizada_en?: string | null;
  mov_id?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/* ───────────── Solicitudes de salida/traslado (con aprobación) ───────────── */

export type EstadoSolicitudSalida = 'por_aprobar' | 'aprobada' | 'ejecutada' | 'cancelada';
export type ScopeSalida = 'salida' | 'traslado';
export type TipoSalida = 'material' | 'dinero';

/**
 * Solicitud unificada de salida/traslado (material o dinero) con flujo de
 * aprobación: el obrero la crea (por_aprobar); admin/analista la aprueba y la
 * ejecuta (recién ahí se descuenta el stock / sale el dinero).
 */
/** Una línea de material en una solicitud de salida/traslado multi-producto (como una OC). */
export interface ItemSolicitudSalida {
  producto_id: string;
  producto_nombre?: string | null;
  cantidad: number;
  precio_unit?: number | null;
  unidad?: string | null;
  /** Almacén de origen de ESTA línea (autoasignado: el que tiene el stock). */
  almacen?: string | null;
  /** Observación de la línea (ej. seriales, "será trasladado para reparación"). */
  observacion?: string | null;
}

/** Chofer responsable del despacho (catálogo modificable). */
export interface Chofer {
  id: string;
  nombre: string;
  cedula?: string | null;
  activo: boolean;
  actor?: string | null;
  created_at: string;
}

/** Vehículo del despacho (catálogo modificable, con placa). */
export interface Vehiculo {
  id: string;
  nombre: string;
  placa?: string | null;
  activo: boolean;
  actor?: string | null;
  created_at: string;
}

export interface SolicitudSalida {
  id: string;
  codigo: string;
  /** Correlativo POR USUARIO (por actor + scope): Isner 1,2,3… y Kelvin 1,2,3… independientes. */
  num_usuario?: number | null;
  scope: ScopeSalida;
  tipo: TipoSalida;
  estado: EstadoSolicitudSalida;
  // material
  producto_id?: string | null;
  producto_nombre?: string | null;
  almacen_origen?: string | null;
  almacen_destino?: string | null;
  cantidad?: number | null;
  precio_unit?: number | null;
  fecha_entrega?: string | null;
  nota_entrega?: string | null;
  /** Detalle multi-producto (varias líneas). Vacío/1 ítem ⇒ se usa la cabecera. */
  items?: ItemSolicitudSalida[] | null;
  // dinero
  caja_id?: string | null;
  caja_destino_id?: string | null;
  monto?: number | null;
  moneda?: Moneda | null;
  cuenta?: string | null;
  // comunes
  solicitante: string;
  destino?: string | null;
  motivo?: string | null;
  /** Chofer/responsable del despacho + su cédula (de la nota de salida). */
  chofer?: string | null;
  chofer_cedula?: string | null;
  /** Vehículo + placa del despacho. */
  vehiculo?: string | null;
  vehiculo_placa?: string | null;
  /** Direcciones de la nota de salida en tránsito (origen → destino). */
  direccion_despacho?: string | null;
  direccion_destino?: string | null;
  /** Sede/centro de acopio destino (almacén padre o centro de acopio elegido del desplegable). */
  sede_destino?: string | null;
  /** Salida a CLIENTE: genera una cuenta por cobrar al ejecutar. */
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  /** Monto de la cuenta por cobrar (valor del material, editable) y su moneda. */
  cxc_monto?: number | null;
  cxc_moneda?: string | null;
  /** Id de la cuenta por cobrar generada al ejecutar (trazabilidad). */
  cxc_id?: string | null;
  /** Marca que la salida/traslado es para consumo interno de la empresa. */
  consumo_interno?: boolean | null;
  historial: EventoHistorial[];
  aprobada_por?: string | null;
  aprobada_en?: string | null;
  ejecutada_por?: string | null;
  ejecutada_en?: string | null;
  mov_id?: string | null;
  mov_ref?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/* ───────────── Salidas Temporales (material a mantenimiento, con retorno) ───────────── */

export type EstadoSalidaTemporal = 'por_aprobar' | 'aprobada' | 'en_transito' | 'finalizada';

/** Aprobador fijo de una salida temporal: define la firma que se estampa en el PDF. */
export type AprobadorSalidaTemporal = 'leidys' | 'jesus';

/**
 * Una línea de material de una salida temporal. Puede venir del inventario
 * (producto_id + almacen → descuenta/reingresa stock) o ser "nuevo" (no está en
 * el inventario: solo se documenta, no mueve stock).
 */
export interface ItemSalidaTemporal {
  producto_id: string | null;         // null = material "nuevo" (no está en inventario)
  producto_nombre: string;
  sku?: string | null;
  cantidad: number;
  unidad?: string | null;
  /** Almacén de origen (para descontar al aprobar y reingresar al finalizar). Solo ítems de inventario. */
  almacen?: string | null;
  precio_unit?: number | null;
  /** true = material que NO está en inventario (no mueve stock, solo se documenta). */
  es_nuevo?: boolean;
  observacion?: string | null;
}

/**
 * Solicitud de SALIDA TEMPORAL: saca material a mantenimiento y lo retorna al
 * inventario. Flujo: por_aprobar → aprobada (descuenta stock + firma) →
 * en_transito (lo entregan de vuelta) → finalizada (reingresa stock + tiempos).
 */
export interface SalidaTemporal {
  id: string;
  codigo: string;                     // ST-AAAA-NNNN (global, único)
  num_usuario?: number | null;        // correlativo POR USUARIO (001, 002…)
  estado: EstadoSalidaTemporal;
  items: ItemSalidaTemporal[];
  unidad_solicitante?: string | null;
  solicitante: string;
  /** Responsable del despacho (nombre y apellido) + cédula, reutilizable (catálogo de choferes). */
  responsable?: string | null;
  responsable_cedula?: string | null;
  direccion_despacho?: string | null;
  direccion_destino?: string | null;
  /** Motivo / descripción del mantenimiento. */
  motivo?: string | null;
  nota?: string | null;
  /** Aprobador que firma (nombre visible) + su clave de firma. */
  aprobador?: string | null;          // 'Leidys Rengel' | 'Jesús Lozada'
  aprobador_firma?: AprobadorSalidaTemporal | null;
  aprobada_por?: string | null; aprobada_en?: string | null;
  transito_por?: string | null; transito_en?: string | null;
  finalizada_por?: string | null; finalizada_en?: string | null;
  historial: EventoHistorial[];
  /** Ids de los movimientos de descuento (al aprobar) y de reingreso (al finalizar), para trazabilidad. */
  mov_out_ids?: string[] | null;
  mov_in_ids?: string[] | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/** Stock y costo (PMP) de un producto en un almacén concreto. */
export interface Existencia {
  producto_id: string;
  almacen: string;
  stock: number;
  costo_promedio: number;
  updated_at?: string | null;
}

export interface Proveedor {
  id: string;
  rif: string;
  razon_social: string;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  categorias: string[];
  origen: OrigenProveedor;
  estado: EstadoGenerico;
  created_at: string;
  updated_at?: string | null;
}

export type OrigenProveedor = 'nacional' | 'internacional';

export type RecetaFundicion = 'RECETA 1' | 'RECETA 2' | 'RECETA 3';
export const RECETAS_FUNDICION: RecetaFundicion[] = ['RECETA 1', 'RECETA 2', 'RECETA 3'];

export interface Producto {
  id: string;
  sku: string;
  nombre: string;
  categoria: string;
  unidad: string;
  stock: number;
  stock_min: number;
  precio: number;
  almacen: string;
  estado: EstadoGenerico;
  restock_pct?: number | null;
  /** Empaque sugerido para el conversor de bultos (ej. "Caja"). Default editable. */
  presentacion?: string | null;
  /** Unidades por bulto sugeridas (ej. 24). Solo un default; el stock va en unidades. */
  unidades_empaque?: number | null;
  tipo?: TipoInventario | null;
  /** Espacio de inventario: 'principal' (Inventario) o 'deposito'. Su total no se mezcla. */
  espacio?: string | null;
  receta_fundicion?: RecetaFundicion | null;
  precio_promedio?: number | null;
  /** Precio de venta (para calcular posible ganancia en fundición). */
  precio_venta?: number | null;
  /** Es un insumo de receta (aparece en el checklist de fundición). */
  es_receta?: boolean;
  /** Es un producto terminado producible (catálogo de "qué producir"). */
  es_producible?: boolean;
  en_fundicion?: boolean;
  /** Detalle del producto (todos opcionales): identificación física del artículo. */
  nombre_busqueda?: string | null;  // alias corto para buscar (ej. CLORO)
  marca?: string | null;
  modelo?: string | null;
  fabricante?: string | null;
  color?: string | null;
  serial?: string | null;            // número de serie
  numero?: string | null;            // N° (parte / activo)
  codigo?: string | null;            // código interno / de barras
  ubicacion_fisica?: string | null;  // estante / ubicación física
  descripcion?: string | null;       // descripción libre
  created_at: string;
  updated_at?: string | null;
}

export interface Movimiento {
  id: string;
  producto_id: string;
  tipo: TipoMovimiento;
  delta: number;
  stock_antes: number;
  stock_despues: number;
  actor: string;
  actor_name?: string | null;
  ref_tipo?: string | null;
  ref_id?: string | null;
  ref_codigo?: string | null;
  proveedor_id?: string | null;
  detalle?: string | null;
  /** A quién va dirigida la salida/traslado de material. */
  destino?: string | null;
  /** Texto de la nota de entrega (se imprime en el PDF cuando está marcada). */
  nota_entrega?: string | null;
  /** Fecha en que se entregó la salida/traslado de material al destino (YYYY-MM-DD). */
  fecha_entrega?: string | null;
  /** Almacén donde ocurrió el movimiento. */
  almacen?: string | null;
  /** Solo en consultas con join: el producto del movimiento. */
  producto?: { sku: string; nombre: string; unidad: string } | null;
  /** Costo unitario informado en este movimiento (lo pagado al proveedor en una entrada). */
  precio_unitario?: number | null;
  /** Costo base resultante (PMP) del producto tras aplicar este movimiento. */
  costo_promedio?: number | null;
  /** Marca que la salida/traslado es para consumo interno de la empresa. */
  consumo_interno?: boolean | null;
  /** Quién solicitó la salida/traslado (se muestra en el historial). */
  solicitante?: string | null;
  at: string;
  created_at: string;
}

export interface ItemOrden {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number;
  /** Precio unitario si se paga en divisa efectivo (USD), por producto. Para la
   *  comparativa BCV vs USD por línea (diferencia y % por producto). */
  precio_usd?: number | null;
  productoId?: string;
  /** Unidad de medida del producto (KG, L, und…), traída del inventario. */
  unidad?: string;
  /** Si se compra este ítem. La OP guarda todos; solo los marcados se cotizan/compran. Falta = true. */
  comprar?: boolean;
  /** Finalidad de la compra de este producto en concreto (para qué se pide). */
  finalidad?: string;
  /** Área a la que pertenece la compra de este ítem: Administrativa / Fundición. */
  area?: string;
  /** Cantidad realmente recibida (recepción parcial). Si falta = aún no recibido. */
  cantidad_recibida?: number;
  /** Marca/modelo ofertados para ESTE renglón. Un proveedor puede cotizar el mismo
   *  producto en varias marcas: cada variante es un renglón propio con su precio. */
  marca?: string | null;
  modelo?: string | null;
  /** Servicios (clase='servicio'): categoría del servicio (recarga de gas, mantenimiento…). */
  servicio_categoria?: string | null;
  /** Servicios: tipo de servicio elegido (cambio de aceite, cauchos, repuestos…). */
  servicio_tipo?: string | null;
  /** Servicios · mantenimiento de maquinaria: equipo de Control de Maquinaria al que se hace. */
  equipo_id?: string | null;
  equipo_nombre?: string | null;
  /** Servicios de recarga (gas / oxígeno / extintores): nº de bombonas y KG a recargar. */
  bombonas?: number | null;
  kg_recarga?: number | null;
  /** Servicios · mantenimiento: repuesto tomado del inventario para este renglón (si aplica).
   *  Se descuenta del stock al crear el servicio y se restituye si el servicio se cancela. */
  repuesto_producto_id?: string | null;
  repuesto_nombre?: string | null;
  repuesto_cantidad?: number | null;
  repuesto_almacen?: string | null;
}

export interface EventoHistorial {
  at: string;
  evento: string;
  actor: string;
  motivo?: string;
  /** Documentos adjuntos a la OC (nota de entrega / despacho). */
  documentos?: string[];
}

export interface Orden {
  id: string;
  codigo: string;
  /** 'producto' (compra normal) | 'servicio' (recarga de gas, mantenimiento…). Falta = 'producto'. */
  clase?: 'producto' | 'servicio' | null;
  oc_codigo?: string | null;
  /** Si es una OC hija (sub-OC por proveedor), apunta a su OP padre. */
  parent_orden_id?: string | null;
  proveedor_id: string | null;
  solicitante_email: string;
  solicitante?: string | null;
  /** Persona que solicita (nombre). En servicios va junto a la unidad solicitante. */
  solicitante_persona?: string | null;
  ci_solicitante?: string | null;
  items: ItemOrden[];
  total: number;
  estado: EstadoOrden;
  /** Moneda de la orden (la usan los Servicios: 'USD' o 'Bs'). Por defecto 'USD'. */
  moneda?: string | null;
  notas?: string | null;
  /** Motivo y finalidad de la OP (el "porqué" de la solicitud). */
  motivo?: string | null;
  finalidad?: string | null;
  /** Clasificación del pedido: Fundición, Bienes, Servicios (multi-selección). */
  clasificacion?: string[] | null;
  historial: EventoHistorial[];
  aprobada_por?: string | null;
  aprobada_en?: string | null;
  oc_emitida_por?: string | null;
  oc_emitida_en?: string | null;
  /** OC creada (oferta elegida, proveedor casado · sin confirmar). */
  oc_creada_por?: string | null;
  oc_creada_en?: string | null;
  /** OC aprobada/confirmada en lote (checklist). */
  oc_aprobada_por?: string | null;
  oc_aprobada_en?: string | null;
  /** Almacén destino de la mercancía (se elige al confirmar la OC). */
  almacen_destino?: string | null;
  /** Condiciones de pago (copiadas de la oferta elegida). */
  condiciones_pago?: string | null;
  /** Snapshot de los datos técnicos/logísticos de la oferta elegida (se ven en la OC y su PDF). */
  oferta_detalle?: OfertaDetalle | null;
  /** Precio total en divisa efectivo de la oferta elegida (el BCV es `total`). */
  oferta_precio_efectivo?: number | null;
  /** Total BCV/general original de la OC cuando se aplicó el descuento por efectivo
   *  (el `total` ya pasa a ser el efectivo). Solo para mostrar el ahorro. */
  oferta_precio_bcv?: number | null;
  /** Observación del analista al elegir la oferta (por qué la eligió) + adjuntos
   *  (imágenes/PDF). La ven el Gerente General (al aprobar) y Tesorería (al pagar). */
  oferta_motivo?: string | null;
  oferta_motivo_adjuntos?: OfertaAdjunto[] | null;
  /** Método(s) de pago indicados antes de enviar a pagar (multipago). */
  metodo_pago?: PagoMetodo[] | null;
  metodo_pago_por?: string | null;
  metodo_pago_en?: string | null;
  /** Pago de la OC desde Tesorería. */
  pagada_por?: string | null;
  pagada_en?: string | null;
  caja_id?: string | null;
  caja_mov_id?: string | null;
  factura_path?: string | null;
  factura_nombre?: string | null;
  retencion_path?: string | null;
  retencion_nombre?: string | null;
  /** Imagen / QR de pago (ej. QR de Binance) cargado al indicar el método; Tesorería lo escanea al pagar. */
  pago_qr_path?: string | null;
  pago_qr_nombre?: string | null;
  /** Retenciones fiscales (módulo Retenciones): comprobantes por tipo + estado. */
  comprobante_tipo?: 'nota_entrega' | 'factura' | null;
  retencion_modo?: 'se_paga_despues' | 'completo_reembolso' | null;
  retencion_iva_path?: string | null;
  retencion_iva_nombre?: string | null;
  retencion_islr_path?: string | null;
  retencion_islr_nombre?: string | null;
  retencion_municipal_path?: string | null;
  retencion_municipal_nombre?: string | null;
  retencion_finalizada?: boolean | null;
  retencion_finalizada_por?: string | null;
  retencion_finalizada_en?: string | null;
  retencion_pagada?: boolean | null;
  retencion_pagada_en?: string | null;
  /** Recepción (parcial): total realmente recibido + nota de diferencias. */
  recibido_total?: number | null;
  nota_recepcion?: string | null;
  recibida_por?: string | null;
  recibida_en?: string | null;
  /** Compras a crédito: total abonado acumulado. */
  abonado_total?: number | null;
  /** Productos ya ingresados manualmente al inventario: al recibir NO suma stock (evita duplicar). */
  sin_inventario?: boolean | null;
  /** Descuento obtenido (negociado) que reduce el monto a pagar: total = Σ ítems − descuento. */
  descuento_obtenido?: number | null;
  /** Descuento indicado al confirmar el MÉTODO DE PAGO (desde la OC): reduce el monto a pagar
   *  en Tesorería (a pagar = total − descuento_pago). El `total` de la OC NO cambia. */
  descuento_pago?: number | null;
  /** IVA (monto) de la oferta elegida, copiado a la OC: ya está incluido en `total`. */
  iva?: number | null;
  /** IGTF (monto) de la oferta elegida, copiado a la OC: ya está incluido en `total`. */
  igtf?: number | null;
  /** Seriales de los billetes entregados al pagar la OC en USD físico (efectivo). */
  seriales_billetes?: string[] | null;
  /** Marca de prioridad: ORDEN URGENTE (se refleja en el PDF y la trazabilidad). */
  urgente?: boolean | null;
  /** Imagen de referencia adjunta a la OP (path en el bucket de adjuntos de OC). */
  imagen_path?: string | null;
  finalizada_por?: string | null;
  finalizada_en?: string | null;
  rechazada_por?: string | null;
  rechazada_en?: string | null;
  motivo_rechazo?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** Abono de una compra a crédito (egreso real de caja). */
export interface AbonoCredito {
  id: string;
  orden_id: string;
  monto: number;
  moneda: string;
  caja_id?: string | null;
  caja_mov_id?: string | null;
  saldo_restante?: number | null;
  actor: string;
  actor_name?: string | null;
  nota?: string | null;
  comprobante_path?: string | null;
  comprobante_nombre?: string | null;
  /** Comisión bancaria del abono (egreso extra de la caja; NO reduce la deuda de la OC). */
  comision_monto?: number | null;
  comision_moneda?: string | null;
  at: string;
}

/** Mensaje del chat interno de una Orden de Compra (seguimiento gerente ↔ analista). */
export interface OcMensaje {
  id: string;
  orden_id: string;
  texto: string;
  autor?: string | null;          // auth.uid() del autor
  autor_email?: string | null;
  autor_nombre?: string | null;
  leido_por: string[];            // ids de usuarios que ya lo leyeron
  created_at: string;
}

/** Personal de nómina (no necesariamente usuario del sistema). */
export interface Personal {
  id: string;
  nombre: string;
  apellido: string;
  cedula?: string | null;
  cargo?: string | null;
  departamento?: string | null;
  sueldo_base: number;          // sueldo MENSUAL (USD)
  activo: boolean;
  fecha_ingreso?: string | null;
  telefono?: string | null;
  contacto_emergencia?: string | null;
  contacto_emergencia_tlf?: string | null;
  foto_url?: string | null;
  /** Encuadre de la foto del carnet (lo ajusta el usuario): posición 0..1 y zoom ≥1. */
  foto_pos_x?: number | null;
  foto_pos_y?: number | null;
  foto_zoom?: number | null;
  datos_pago?: Record<string, unknown> | null;
  created_at: string;
  created_by?: string | null;
}

/** Anticipo o préstamo a una persona; se descuenta de la nómina hasta saldar. */
export interface AnticipoPrestamo {
  id: string;
  personal_id: string;
  tipo: 'anticipo' | 'prestamo';
  monto_total: number;
  saldo: number;
  cuota_sugerida?: number | null;
  estado: 'activo' | 'saldado';
  motivo?: string | null;
  creado_por?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/** Período de nómina (una por quincena), cargado desde RRHH. */
export interface NominaPeriodo {
  id: string;
  codigo: string;
  tipo: string;
  periodo_desde?: string | null;
  periodo_hasta?: string | null;
  dias_base: number;
  tasa_bcv?: number | null;
  estado: 'cargada' | 'en_pago' | 'pagada';
  total_usd: number;
  notas?: string | null;
  creada_por?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/** Una deducción concreta aplicada a un renglón (referencia al anticipo/préstamo). */
export interface DeduccionRef {
  id: string;                   // id del anticipo_prestamo
  tipo: 'anticipo' | 'prestamo';
  monto: number;
}

/** Renglón de nómina = pago individual de una persona (su histórico quincenal). */
export interface NominaRenglon {
  id: string;
  periodo_id: string;
  personal_id?: string | null;
  nombre: string;
  cargo?: string | null;
  departamento?: string | null;
  sueldo_base_mensual: number;
  dias_trabajados: number;
  salario_bruto: number;
  asignaciones: number;
  deduc_anticipos: number;
  deduc_prestamos: number;
  deduc_ivss: number;
  deduc_faov: number;
  deducciones: DeduccionRef[];
  neto_usd: number;
  estado: 'por_pagar' | 'pagada';
  pagada_por?: string | null;
  pagada_en?: string | null;
  caja_id?: string | null;
  caja_mov_id?: string | null;
  monto_pagado?: number | null;
  moneda_pago?: string | null;
  tasa_pago?: number | null;
  seriales_billetes?: string[] | null;
  comprobante_path?: string | null;
  comprobante_nombre?: string | null;
  created_at: string;
  /** Solo en consultas con join: el período al que pertenece. */
  periodo?: Pick<NominaPeriodo, 'codigo' | 'tipo' | 'periodo_desde' | 'periodo_hasta' | 'tasa_bcv'> | null;
}

/** Evento administrativo de RRHH (Fase 3): vacaciones, permisos, utilidades, notas. */
export interface RrhhEvento {
  id: string;
  personal_id: string;
  tipo: 'vacacion' | 'permiso' | 'utilidad' | 'nota';
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  dias?: number | null;
  monto?: number | null;
  descripcion?: string | null;
  estado: string;
  procesada?: boolean;
  nomina_renglon_id?: string | null;
  creado_por?: string | null;
  actor_name?: string | null;
  created_at: string;
}

export interface Factura {
  id: string;
  numero: string;
  orden_id?: string | null;
  proveedor_id: string;
  items: ItemOrden[];
  subtotal: number;
  iva: number;
  total: number;
  estado: EstadoFactura;
  emision: string;
  vencimiento?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface Notificacion {
  id: string;
  destino: string;
  kind: NotifKind;
  title: string;
  message?: string | null;
  link?: string | null;
  dedup_key?: string | null;
  read: boolean;
  at: string;
}

export type EstadoOferta = 'pendiente' | 'aceptada' | 'descartada';

/** Modo de un costo logístico: incluido en el precio o por cuenta del comprador. */
export type CostoLogistico = 'incluido' | 'por_cuenta' | null;

/** Datos técnicos y logísticos opcionales que el proveedor declara en su oferta. */
export interface OfertaDetalle {
  marca?: string | null;
  modelo?: string | null;
  procedencia?: string | null;
  materiales?: string | null;
  dimensiones?: string | null;
  peso?: string | null;
  calidad?: string | null;
  logistica?: {
    flete?: CostoLogistico;
    transporte?: CostoLogistico;
    embalaje?: CostoLogistico;
    seguros?: CostoLogistico;
  } | null;
}

export interface OfertaProveedor {
  id: string;
  orden_id: string;
  proveedor_id: string;
  items: ItemOrden[];
  /** Precio total de la cotización a tasa BCV (precio nominal / facturado). */
  precio_total: number;
  /** Precio total si se paga en divisa efectivo (descuento por pago en efectivo).
   *  Si está cargado y es menor al BCV, la comparativa muestra la diferencia y el % de ahorro. */
  precio_efectivo?: number | null;
  /** Descuento (sobre el total BCV) aplicado a la cotización: BCV total = subtotal − descuento. */
  descuento?: number | null;
  /** IVA (monto) de la oferta: se calcula sobre la factura neta (subtotal − descuento)
   *  y se SUMA al total a pagar. null/0 = la oferta no lleva IVA. */
  iva?: number | null;
  /** IGTF (monto) de la oferta: se suma al total a pagar (típico en pagos en divisas). */
  igtf?: number | null;
  fecha_entrega_prometida?: string | null;
  condiciones_pago?: string | null;
  notas?: string | null;
  /** Datos técnicos/logísticos declarados por el proveedor (marca, modelo, fletes…). */
  detalle?: OfertaDetalle | null;
  estado: EstadoOferta;
  score_calculado?: number | null;
  registrada_por_email: string;
  registrada_en: string;
  decidida_por_email?: string | null;
  decidida_en?: string | null;
  motivo_descarte?: string | null;
  pdf_path?: string | null;
  pdf_filename?: string | null;
  /** Adjuntos de la oferta (varias fotos/PDF de la cotización). El `pdf_path` legacy
   *  sigue valiendo como primer adjunto. */
  adjuntos?: OfertaAdjunto[] | null;
}

/** Un archivo adjunto a una oferta (PDF o imagen) guardado en el bucket. */
export interface OfertaAdjunto {
  path: string;
  filename: string;
}

export interface EvaluacionRecepcion {
  id: string;
  orden_id: string;
  proveedor_id: string;
  calidad: number;                  // 1-5
  puntualidad_dias: number;         // signed
  comentario?: string | null;
  evaluado_por_email: string;
  evaluado_por_rol: string;
  evaluado_en: string;
  ajustado_por_jefe: boolean;
  rating_original?: number | null;
  ajustado_en?: string | null;
}

export type EstadoProduccion = 'produccion' | 'finalizado';

export interface ProduccionMaterial {
  id: string;
  produccion_id: string;
  producto_id?: string | null;
  material_nombre: string;
  almacen: string;
  cantidad: number;
  costo_unitario: number;
  subtotal: number;
}

export interface Produccion {
  id: string;
  producto_id?: string | null;
  producto_nombre: string;
  cantidad: number;
  almacen_destino: string;
  estado: EstadoProduccion;
  costo_material: number;       // CTM
  mano_obra: number;
  costos_indirectos: number;
  costo_unitario: number;       // CP / cantidad
  precio_venta?: number | null;
  ganancia?: number | null;
  receta_num?: number | null;   // nº de receta secuencial por producto (1, 2, 3…)
  horno?: string | null;        // nombre del horno utilizado
  tipo?: 'fundicion' | 'refinacion'; // 'fundicion' (default) | 'refinacion' (refinación de material)
  inicio_at: string;
  fin_at?: string | null;
  created_by?: string | null;
  created_at: string;
  materiales?: ProduccionMaterial[];
}

/* ───────── Reporte de Colada (MGG-FR-001, horno de fundición primaria) ───────── */

/** Una fila del control de temperatura horario (cada ~1 h) durante la colada. */
export interface ColadaTemperatura {
  hora: string;                 // 'HH:MM' o texto libre
  temp_int: number | null;      // temperatura interna (°C)
  temp_ext: number | null;      // temperatura externa (°C)
  obs: string;                  // observación / acción
}

/** Un análisis de laboratorio (letra) del Sn de un big bag: A, B, C… */
export interface ColadaBigBagLey { letra: string; valor: number | null }
/**
 * Un big bag de casiterita con su detalle de recepción (formato "INVENTARIO
 * CASITERITA MATANZAS"): peso, aliado, precinto, nº de análisis, las leyes de
 * laboratorio por letra (A/B/C…, se pueden agregar), su promedio (ley del big
 * bag), la tasa de recepción y el costo total (kg × tasa) que salen solos.
 */
export interface ColadaBigBag {
  kg: number | null;
  precinto: string;
  aliado?: string;              // Aliado / centro de acopio de ese big bag
  analisis?: string;            // Nº(s) de análisis de laboratorio (ej. "2214, 2217")
  leyes?: ColadaBigBagLey[];    // Sn de laboratorio por letra (A, B, C…)
  ley_prom?: number | null;     // Promedio de las leyes (% Sn) — editable si no hay letras
  tasa?: number | null;         // Tasa de recepción ($/kg casiterita) del big bag
}

/**
 * Detalle del formato MGG-FR-001 que no vive en columnas propias de
 * `produccion_colada` (se guarda en su columna `datos` jsonb). Todos los campos
 * son opcionales para permitir cargas y ediciones parciales a lo largo del ciclo.
 */
export interface ColadaDatos {
  // Identificación
  turno?: string;
  responsable?: string;
  // Materias primas
  big_bags?: ColadaBigBag[];
  total_casiterita?: number | null;   // kg (Σ big bags)
  ley_sn?: number | null;             // Ley de Sn / Tenor (%)
  sn_kg?: number | null;              // total_casiterita × ley_sn / 100
  coque_kg?: number | null;
  coque_proveedor?: string;           // CARBOMORCA | CIVCA | otro
  coque_granulometria?: string;       // 2-6 mm | 25-50 mm | 25-100 mm
  otro_fundente?: string;             // p.ej. Pirulita
  otro_fundente_kg?: number | null;
  caco3_tipo?: string;                // p.ej. Caliza
  caco3_kg?: number | null;
  caco3_granulometria?: string;       // malla 4 | 6 | 10 | 20 | 200
  // Proceso
  homogeneizacion?: string;           // Manual (pala) | Trompo hidráulico
  carga_horno?: string;               // Manual (pala) | Minicargador (mini shower)
  // Temperaturas y tiempos de carga
  temp_int_abrir?: number | null;
  temp_ext_abrir?: number | null;
  fecha_inicio_carga?: string;        // yyyy-mm-dd (separada de la hora)
  hora_inicio_carga?: string;         // HH:mm (en registros viejos puede venir fecha+hora junta)
  fecha_fin_carga?: string;           // yyyy-mm-dd
  hora_fin_carga?: string;            // HH:mm
  jornada_horas?: number | null;      // (fecha+hora fin) − (fecha+hora inicio), en horas
  temp_int_cerrar?: number | null;
  temp_ext_cerrar?: number | null;
  // Control de temperatura del proceso (cada ~1 h)
  temperaturas?: ColadaTemperatura[];
  // Sangrado y tiempos de colada
  hora_inicio_proceso?: string;
  hora_fin_proceso?: string;
  hora_sangrado?: string;
  temp_colada?: number | null;
  duracion_horas?: number | null;
  // Resultados (se cargan al finalizar)
  estano_kg?: number | null;          // Estaño obtenido (kg)
  escoria_kg?: number | null;         // Escoria generada (kg)
  destino_almacen?: string;
  n_lingotes?: number | null;
  rendimiento?: number | null;        // %
  // Observaciones
  merma_kg?: number | null;
  observaciones?: string;
  // Involucrados (nombres)
  involucrados?: string[];
}

export interface ProduccionColada {
  id: string;
  produccion_id: string;
  colada_num: number;
  fecha: string;                // YYYY-MM-DD
  datos: ColadaDatos;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Refinación de lingotes de estaño (MGG-FR-002) ──────────────────────────
/** Una colada de origen aportada al lote de refinación (estaño crudo). */
export interface RefinacionColadaOrigen {
  produccion_id: string;
  colada_num: number;
  fecha: string;
  producto_id: string | null;
  producto_nombre: string;
  almacen: string;
  estano_kg: number;            // kg de estaño tomados de esta colada (default = obtenido)
  costo_unitario: number;       // costo/kg de esa colada (referencia)
  /** Origen del material: colada (crudo), refinación finalizada (2ª refinación) o MANUAL (cargado a mano). */
  origen?: 'colada' | 'refinacion' | 'manual';
  /** Etiqueta para mostrar: "Colada #5" / "Refinación #2" / lo que se escriba en manual. */
  etiqueta?: string;
}

/** Una fila del control de temperatura y etapas del proceso de refinación. */
export interface RefinacionEtapa {
  etapa?: string;               // "Fusión de la carga cruda", etc.
  hora?: string;
  temp_bano?: number | null;    // Temp. baño (°C)
  temp_quemador?: number | null;
  accion?: string;              // Acción operativa / reactivo añadido
}

export interface RefinacionDatos {
  // Identificación del lote / proceso
  turno?: string;               // Mañana | Tarde | Noche
  responsable?: string;
  n_horno_olla?: string;
  // Origen del estaño crudo (varias coladas)
  coladas?: RefinacionColadaOrigen[];
  estano_crudo_kg?: number | null;   // Σ coladas (editable)
  pureza_inicial?: number | null;    // % Sn
  // Parámetros de operación
  metodo_agitacion?: string;         // Mecánica (hélice) | Neumática | Manual
  desespumado?: string;              // Raspado manual de dross | Separador mecánico
  // Etapas / control de temperatura
  etapas?: RefinacionEtapa[];
  // Jornada de refinación (inicio/fin + total automático)
  fecha_inicio_jornada?: string;     // yyyy-mm-dd
  hora_inicio_jornada?: string;      // HH:mm
  fecha_fin_jornada?: string;        // yyyy-mm-dd
  hora_fin_jornada?: string;         // HH:mm
  jornada_horas?: number | null;     // (fecha+hora fin) − (fecha+hora inicio), en horas
  // Tiempos de colada y moldeo de lingotes (al finalizar)
  hora_inicio_refinacion?: string;
  hora_fin_refinacion?: string;
  hora_inicio_vaciado?: string;
  temp_colada?: number | null;       // Temp. de colada (°C)
  tiempo_total_horas?: number | null;
  // Resultados de producción y balance de masa (al finalizar)
  estano_refinado_kg?: number | null;
  n_lingotes?: number | null;
  peso_prom_lingote?: number | null; // refinado ÷ n_lingotes
  n_precinto?: string;               // N° de precinto / lote final
  dross_kg?: number | null;          // Dross / escoria de refinación
  rendimiento?: number | null;       // % = refinado ÷ crudo × 100
  pureza_final?: number | null;      // % Sn
  destino_almacen?: string;
  merma_kg?: number | null;          // crudo − refinado − dross
  observaciones?: string;
  involucrados?: string[];
}

export interface ProduccionRefinacion {
  id: string;
  produccion_id: string;
  refinacion_num: number;
  fecha: string;                // YYYY-MM-DD
  datos: RefinacionDatos;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PesosScore {
  precio: number;
  puntualidad: number;
  calidad: number;
  cumplimiento: number;
}

export const DEFAULT_PESOS_SCORE: PesosScore = {
  precio: 0.40,
  puntualidad: 0.25,
  calidad: 0.25,
  cumplimiento: 0.10,
};

/* ============================================================
   Centro de Acopio (LA ESPERANZA) — tipos portados de Golden Touch
   Módulo standalone: integraciones con otros módulos desacopladas.
   ============================================================ */

export type EstadoRecepcionAcopio = 'abierta' | 'cerrada' | 'anulada';

/** Un renglón de lote dentro de una recepción. Los campos `*_calc`/diferencias
 *  son columnas GENERADAS en la base (no se envían al guardar). */
export interface RecepcionAcopioLote {
  id: string;
  recepcion_id: string;
  orden: number;
  nro_lote?: string | null;
  cantidad_bolsas: number;
  peso_bolsa_kg: number;
  /** 🧮 generado: cantidad_bolsas × peso_bolsa_kg */
  peso_bruto_total: number;
  peso_neto_kg: number;
  /** 🧮 generado: peso_bruto_total − peso_neto_kg */
  dif_bruto_neto: number;
  precinto_inicio?: string | null;
  peso_recepcionado_kg: number;
  /** 🧮 generado: peso_neto_kg − peso_recepcionado_kg */
  dif_neto_recepcionado: number;
  precinto_final?: string | null;
  verificado: boolean;
  created_at?: string;
}

/** Recepción de mineral por centro de acopio (maestro). Al cerrar suma stock. */
export interface RecepcionAcopio {
  id: string;
  numero: string;
  fecha: string;
  centro_acopio?: string | null;
  aliado?: string | null;
  /** Producto del inventario al que se suma el mineral recibido al cerrar. */
  producto_id?: string | null;
  /** Almacén destino del stock al cerrar. */
  almacen?: string | null;
  entregado_nombre?: string | null;
  entregado_ci?: string | null;
  recibido_nombre?: string | null;
  recibido_ci?: string | null;
  observaciones?: string | null;
  estado: EstadoRecepcionAcopio;
  /** Traza del movimiento de inventario generado al cerrar (para revertir al anular). */
  mov_id?: string | null;
  mov_producto_id?: string | null;
  mov_almacen?: string | null;
  mov_cantidad?: number | null;
  cerrada_por?: string | null;
  cerrada_en?: string | null;
  anulada_por?: string | null;
  anulada_en?: string | null;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
  /** Lotes embebidos (cuando se cargan juntos). */
  lotes?: RecepcionAcopioLote[];
}

/* ───────────── Contratos de producción (Centro de Acopio) ───────────── */

export type TipoCatalogoAcopio = 'lugar_extraccion' | 'supervisor';

/** Catálogo editable del acopio (lugares de extracción, etc.). */
export interface CatalogoAcopio {
  id: string;
  tipo: TipoCatalogoAcopio;
  valor: string;
  activo: boolean;
  orden: number;
  created_at: string;
}

export type EstadoContratoAcopio = 'activo' | 'cerrado';

/** Contrato de producción correlativo ("Producción GT-01", -02, …). */
export interface ContratoAcopio {
  id: string;
  numero: string;
  seq: number;
  fecha: string;
  hora?: string | null;
  supervisor?: string | null;
  lugar_extraccion?: string | null;
  molino?: string | null;
  // Inputs principales (réplica del Excel).
  ton_procesadas: number;
  kg_humedo: number;
  kg_secos: number;
  /** Kg seco, limpio = Casiterita final obtenida (= Kg seco Limpio Finales). */
  kg_seco_limpio: number;
  // Fórmulas automáticas (columnas generadas en la BD).
  tolva?: number | null;
  pct_recuperado_impurezas?: number | null;
  pct_humedad?: number | null;
  pct_recuperacion_casiterita?: number | null;
  kg_hierro?: number | null;
  pct_hierro?: number | null;
  // KG MESAS (merma por humedad): inputs manuales + fórmulas de la BD.
  mesa_peso_mojado?: number | null;
  mesa_peso_seco?: number | null;
  mesa_merma_kg?: number | null;     // = mesa_peso_seco − mesa_peso_mojado (admite negativo)
  mesa_pct_merma?: number | null;    // = merma / mesa_peso_mojado × 100
  estado: EstadoContratoAcopio;
  cerrado_at?: string | null;
  cerrado_por?: string | null;
  // Enlace con el inventario al cerrar (entrada de casiterita; para revertir al reabrir).
  mov_id?: string | null;
  mov_producto_id?: string | null;
  mov_almacen?: string | null;
  mov_cantidad?: number | null;
  observaciones?: string | null;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/* ───────────── Caja Peramanal (Centro de Acopio) ───────────── */

/** Los 5 grupos de clasificación de la hoja CLASIFICACIONES del Excel. */
export type GrupoClasificacion = 'contratos' | 'gastos_caja' | 'movimientos_caja' | 'nomina' | 'traslado';

export interface ClasificacionAcopio {
  id: string;
  grupo: GrupoClasificacion;
  valor: string;
  orden: number;
  activo: boolean;
}

/** Un movimiento del libro de caja (réplica de una fila de "CAJA PERAMANAL"). */
export interface CajaMovimiento {
  id: string;
  fecha: string;
  descripcion?: string | null;
  usd_entregado: number;   // D · entrada de caja
  kg_cerrados: number;     // E · Kg de casiterita cerrados
  facturados: number;      // G · $Usd facturados
  gastos: number;          // H · Gastos GT
  nominas: number;         // I · Nóminas GT
  traslado: number;        // J · Traslado de caja
  compra_material: number; // $ Compra de material (egreso · baja el Saldo $)
  kg_recibidos: number;    // L · Kg recibidos por MGG
  clasif_grupo?: GrupoClasificacion | null;
  clasif_valor?: string | null;
  /** Clasificación de costo en 2 niveles (análisis de costos del cierre). */
  costo_clasificacion?: string | null;
  costo_subclasificacion?: string | null;
  /** Vehículo/maquinaria (catálogo de Combustible) imputado, cuando la categoría
   *  es de REPUESTOS - REPARACIONES - SERVICIOS. Opcional. */
  vehiculo?: string | null;
  /** Caja/cierre al que pertenece el movimiento. */
  caja_id?: string | null;
  orden: number;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
  /** Saldos corrientes calculados en el front (K y M del Excel). */
  saldo_usd?: number;
  saldo_kg?: number;
}

/** Taxonomía de costos en 2 niveles (Clasificación → Sub-clasificación). */
export interface CostoClase {
  id: string;
  clasificacion: string;
  subclasificacion: string;
  orden: number;
  activo: boolean;
}

/** Una caja / cierre de la Caja Peramanal (período con número y recepción). */
export interface CajaCierre {
  id: string;
  numero: string;
  nombre?: string | null;
  recepcion?: string | null;
  fecha_inicio: string;
  fecha_fin?: string | null;
  estado: 'abierta' | 'cerrada';
  saldo_final?: number | null;
  cerrada_por?: string | null;
  cerrada_en?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** Agregados de la caja (cabecera del Excel: D3,E3,F3,G3,H3,I3,J3,K3,M3). */
export interface CajaResumen {
  usdEntregado: number;   // D3
  kgCerrados: number;     // E3
  facturados: number;     // G3
  gastos: number;         // H3
  nominas: number;        // I3
  traslado: number;       // J3
  compraMaterial: number; // $ Compra de material (egreso)
  saldoUsd: number;       // K3 = D - G - H - I - J - Compra material
  kgRecibidos: number;    // L3
  saldoKg: number;        // M3 = E - L
  /** Tasa del material = (facturados + gastos + nominas) / kgCerrados (F3). */
  tasa: number;
}

/* ───────────── Sub-ledgers del acopio (Por aliado · Cuentas por cobrar) ───────────── */

/** Aliado/proveedor del centro de acopio (cabecera de la hoja «CENTRO ACOPIO - {ALIADO}»). */
export interface AliadoAcopio {
  id: string;
  nombre: string;
  centro_nombre: string;
  activo: boolean;
  created_by?: string | null;
  created_at: string;
}

/** Destino de un «Traslado de caja» del acopio (catálogo). 'aliado_interno' refleja
 *  el monto como $Usd entregado en el ledger de un aliado de ESTE sistema; 'externo'
 *  lo empuja por el puente inter-sistema a otra empresa/Supabase. */
export type TipoDestinoTraslado = 'aliado_interno' | 'externo';
export interface DestinoTraslado {
  id: string;
  centro_nombre: string;
  nombre: string;
  tipo: TipoDestinoTraslado;
  aliado_id: string | null;        // si 'aliado_interno'
  caja_externa_id: string | null;  // si 'externo' (caja espejo local del centro externo)
  empresa_codigo: string | null;   // si 'externo'
  activo: boolean;
  orden: number;
  created_by?: string | null;
  created_at: string;
}

/** Una fila del libro por aliado. tipo 'cierre' = entrega $ + compromete Kg; 'abono' = entrega Kg. */
export interface AliadoMovimiento {
  id: string;
  aliado_id: string;
  fecha: string;
  corte?: number | null;
  tipo: 'cierre' | 'abono';
  descripcion?: string | null;
  usd_entregado: number;     // E
  kg_cerrados: number;       // F
  precio_usd_kg: number;     // G  (facturado H = F*G, corrido en el front)
  kg_recibidos: number;      // K
  gastos: number;            // salidas de gasto del aliado (plantilla Entrada/Salida/Gastos)
  caja_mov_id?: string | null;        // traslado reflejado en la caja general
  reflejo_casiterita: boolean;
  recepcion_mov_id?: string | null;   // entrada a stock de CASITERITA si aplicó
  orden: number;
  periodo?: number;                    // periodo de caja del aliado (1 = primero)
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/** Un cierre de caja de un aliado (historial). */
export interface AliadoCierre {
  id: string;
  aliado_id: string;
  periodo: number;
  fecha_inicio?: string | null;
  fecha_fin: string;
  saldo_usd?: number | null;
  saldo_kg?: number | null;
  tasa?: number | null;
  almacen?: string | null;
  inv_mov_id?: string | null;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/** Cuenta por cobrar (cabecera): deuda en $ que se paga con mineral. */
export interface CuentaCobrarAcopio {
  id: string;
  centro_nombre: string;
  cliente: string;
  descripcion?: string | null;
  monto_factura: number;     // D inicial
  precio_usd_kg: number;     // F referencia
  estado: 'abierta' | 'saldada';
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** Abono de una cuenta por cobrar (en Kg de mineral). */
export interface CobrarAbono {
  id: string;
  cuenta_id: string;
  fecha: string;
  descripcion?: string | null;
  monto_factura: number;     // D (normalmente 0; permite cargos extra)
  kg_entregados: number;     // E
  precio_usd_kg: number;     // F  (G total usd = E*F, corrido en el front)
  reflejo_casiterita: boolean;
  recepcion_mov_id?: string | null;
  orden: number;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
}

/* ───────────── Cuadre de Caja (Efectivo) · Centro de Acopio ───────────── */

export type TipoMovCuadre = 'entrada' | 'salida';
export type CategoriaCuadre = 'nomina' | 'adelanto_vale' | 'compra_casiterita' | 'compra_comida' | 'refuerzo' | 'traslado' | 'otro';

/** Conteo físico de billetes (denominación × cantidad). */
export interface ConteoBillete {
  denom: number;
  cantidad: number;
}

export interface CuadreMovimiento {
  id: string;
  cuadre_id: string;
  fecha?: string | null;
  tipo: TipoMovCuadre;
  categoria?: CategoriaCuadre | null;
  descripcion?: string | null;
  beneficiario?: string | null;
  monto: number;
  monto_bs: number;
  es_vale: boolean;
  pagado: boolean;
  nota?: string | null;
  orden: number;
  created_at?: string;
  /** Saldo corriente tras este movimiento (calculado en el front). */
  saldo?: number;
}

export interface Cuadre {
  id: string;
  numero: string;
  fecha: string;
  fuente?: string | null;
  responsable?: string | null;
  monto_recibido: number;
  billetes: ConteoBillete[];
  verificado: boolean;
  observaciones?: string | null;
  estado: 'abierto' | 'cerrado';
  cerrado_por?: string | null;
  cerrado_en?: string | null;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
  movimientos?: CuadreMovimiento[];
}

/** Una celda de una hoja del Excel montada como grilla fiel. */
export interface CeldaExcel {
  v?: string;   // texto mostrado
  c?: string;   // color de fondo (#hex)
  t?: string;   // color de texto (#hex)
  b?: 1;        // negrita
  cs?: number;  // colspan
  rs?: number;  // rowspan
  x?: 1;        // cubierta por un merge (no se renderiza)
}

/** Una hoja del libro Excel, como snapshot de referencia. */
export interface HojaExcel {
  id: string;
  nombre: string;
  orden: number;
  cols: number;
  datos: CeldaExcel[][];
  updated_at?: string | null;
}

/* ───────── Control de Alimentación (Cocina) ───────── */
export type TipoComida = 'desayuno' | 'almuerzo' | 'cena';

/** Una línea de víveres consumida en una comida (precio tomado del inventario). */
export interface ItemCocina {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  precio: number;       // precio unitario del inventario al momento
  subtotal: number;     // cantidad × precio
  almacen?: string | null; // de dónde se descontó el stock
}

/** Movimiento de cocina: consumo de víveres para un servicio (desayuno/almuerzo/cena). */
export interface CocinaComida {
  id: string;
  codigo: string;
  tipo_comida: TipoComida;
  platos: number;
  items: ItemCocina[];
  valor_total: number;
  nota?: string | null;
  /** Cocina donde se preparó (null = legado, antes de tener cocinas). */
  cocina_id?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  at: string;
  created_at?: string | null;
}

/** Una cocina: se vincula a un almacén/subalmacén de donde toma sus víveres. */
export interface Cocina {
  id: string;
  nombre: string;
  almacen_id?: string | null;
  activa: boolean;
  created_at: string;
  created_by?: string | null;
}
