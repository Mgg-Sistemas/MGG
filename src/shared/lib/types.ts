/**
 * Los roles ahora se manejan dinámicamente vía la tabla `custom_roles` en Supabase.
 * Se mantiene el alias `string` para conservar la firma histórica sin restringir nuevos valores.
 */
export type Role = string;
export type EstadoGenerico = 'activo' | 'inactivo';
export type EstadoOrden = 'pendiente' | 'aprobada' | 'oc_creada' | 'confirmada_metodo' | 'oc_aprobada' | 'pagada' | 'oc_emitida' | 'rechazada' | 'recibida' | 'finalizada' | 'cancelada' | 'desistida_proveedor' | 'reasignada' | 'por_recibir' | 'cuenta_abierta';

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

/** Cuentas dentro de una caja (Bs se divide en jurídica/personal). */
export type CuentaCaja = 'general' | 'juridica' | 'personal';

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
}

export type TipoMovimientoCaja = 'ingreso' | 'salida' | 'traslado_salida' | 'traslado_entrada' | 'ajuste';
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
  estado: EstadoGenerico;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
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
export interface SolicitudSalida {
  id: string;
  codigo: string;
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
  receta_fundicion?: RecetaFundicion | null;
  precio_promedio?: number | null;
  /** Precio de venta (para calcular posible ganancia en fundición). */
  precio_venta?: number | null;
  /** Es un insumo de receta (aparece en el checklist de fundición). */
  es_receta?: boolean;
  /** Es un producto terminado producible (catálogo de "qué producir"). */
  es_producible?: boolean;
  en_fundicion?: boolean;
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
  at: string;
  created_at: string;
}

export interface ItemOrden {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number;
  productoId?: string;
  /** Unidad de medida del producto (KG, L, und…), traída del inventario. */
  unidad?: string;
  /** Si se compra este ítem. La OP guarda todos; solo los marcados se cotizan/compran. Falta = true. */
  comprar?: boolean;
  /** Finalidad de la compra de este producto en concreto (para qué se pide). */
  finalidad?: string;
  /** Cantidad realmente recibida (recepción parcial). Si falta = aún no recibido. */
  cantidad_recibida?: number;
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
  oc_codigo?: string | null;
  proveedor_id: string | null;
  solicitante_email: string;
  solicitante?: string | null;
  ci_solicitante?: string | null;
  items: ItemOrden[];
  total: number;
  estado: EstadoOrden;
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
  /** Seriales de los billetes entregados al pagar la OC en USD físico (efectivo). */
  seriales_billetes?: string[] | null;
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
  at: string;
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

export interface OfertaProveedor {
  id: string;
  orden_id: string;
  proveedor_id: string;
  items: ItemOrden[];
  precio_total: number;
  fecha_entrega_prometida?: string | null;
  condiciones_pago?: string | null;
  notas?: string | null;
  estado: EstadoOferta;
  score_calculado?: number | null;
  registrada_por_email: string;
  registrada_en: string;
  decidida_por_email?: string | null;
  decidida_en?: string | null;
  motivo_descarte?: string | null;
  pdf_path?: string | null;
  pdf_filename?: string | null;
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
  inicio_at: string;
  fin_at?: string | null;
  created_by?: string | null;
  created_at: string;
  materiales?: ProduccionMaterial[];
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
