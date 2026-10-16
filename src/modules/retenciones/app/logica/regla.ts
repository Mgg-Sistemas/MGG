/* ============================================================
   MGG · Retenciones · La regla: condiciones y 8 pasos (modelo del 16/10)

   El impuesto es un contenedor (quién lo cobra, serie, periodicidad,
   formato). CÓMO se calcula y CUÁNDO aplica lo dice la versión vigente de
   su regla, que es dato: unas condiciones y un cálculo en 8 pasos fijos,
   cada uno con una operación de una lista cerrada. No hay fórmulas libres
   ni comparaciones por el nombre del impuesto.

   La forma es la del paquete de reglas de la base (retencion_reglas y
   retencion_regla_versiones; `pasos` es un jsonb validado por
   retencion_regla_pasos_validos). Los nombres de las claves son los de
   la base, para leerla sin traducir.

   Las cinco reglas de hoy, armadas con estas piezas:
   · IVA:        base {suma [iva]} → retiene {pct, supuesto (75)} → topes
   · ISLR PNR:   base {subtotal, porción} → moneda → mínimo → tasa → sustraendo
   · ISLR PJND:  base → moneda → tasa {tramos, Tarifa N° 2}
   · ISAE:       base {subtotal − descuento} → moneda → mínimo → tasa {tabla} → retiene todo
   · IGTF:       base {pagado_divisas} → moneda → tasa {parámetro}
   ============================================================ */

/** Los montos del documento con los que se compone la base (paso 1). */
export type Componente =
  | 'subtotal' | 'exento' | 'descuento' | 'iva' | 'igtf' | 'otros_cargos' | 'total' | 'pagado_divisas';

/** Las columnas de una fila de la tabla de clasificación que una fuente puede leer. */
export type ColumnaTabla = 'pct' | 'base_pct' | 'minimo' | 'sustraendo_factor';

/** De dónde sale un número. Lista cerrada. */
export type Fuente =
  | { tipo: 'fijo'; valor: number }
  /** Por CLAVE (no por id): se resuelve a la fecha de la factura. */
  | { tipo: 'parametro'; clave: string }
  /** Una columna de la fila de clasificación elegida (concepto, actividad, rubro). */
  | { tipo: 'tabla'; columna: ColumnaTabla }
  /** El mayor % de los supuestos marcados o, si no hay ninguno, el defecto. */
  | { tipo: 'supuesto'; defecto: Fuente };

/** Si el mínimo o el sustraendo van por línea o una vez por documento. Por defecto, línea (14/10 13:27). */
export type Alcance = 'linea' | 'factura';

export type UnidadMinimo = 'ut' | 'bs' | 'mmv';

export interface PasoBase { suma: Componente[]; resta: Componente[]; porcion: Fuente | null; alicuota: Fuente | null }
export interface PasoMoneda { convertir: boolean }
export interface PasoMinimo { fuente: Fuente; unidad: UnidadMinimo; alcance?: Alcance }
export type PasoTasa =
  | { op: 'pct'; fuente: Fuente }
  | { op: 'tramos'; tarifa_id: string }
  | { op: 'monto_fijo'; fuente: Fuente };
export type PasoSustraendo =
  | { op: 'ut_factor_pct'; factor: Fuente; alcance?: Alcance }
  | { op: 'monto'; fuente: Fuente; alcance?: Alcance };
export type PasoRetiene = { op: 'todo' } | { op: 'pct'; fuente: Fuente };
export interface PasoTopes { no_negativo: true; max_causado: boolean; max_base: boolean }
export interface PasoRedondeo { decimales: number; modo: 'mitad_arriba' }

/** El jsonb `pasos` de una versión. Un paso ausente o null no hace nada. */
export interface PasosRegla {
  base?: PasoBase | null;
  moneda?: PasoMoneda | null;
  minimo?: PasoMinimo | null;
  tasa?: PasoTasa | null;
  sustraendo?: PasoSustraendo | null;
  retiene?: PasoRetiene | null;
  topes?: PasoTopes | null;
  redondeo?: PasoRedondeo | null;
}

/** El orden fijo de los pasos. */
export const ORDEN_PASOS = ['base', 'moneda', 'minimo', 'tasa', 'sustraendo', 'retiene', 'topes', 'redondeo'] as const;
export type NombrePaso = (typeof ORDEN_PASOS)[number];

export type Direccion = 'practicada' | 'recibida';
export type TipoDocumento = 'factura' | 'nd' | 'nc' | 'pago';
export type Operacion = 'bienes' | 'servicios' | 'ambos';
export type Sujeto = 'pn_residente' | 'pn_no_residente' | 'pj_domiciliada' | 'pj_no_domiciliada';
export type Contribuyente = 'ordinario' | 'especial' | 'formal' | 'percepcion';
export type EstadoVersion = 'prueba' | 'vigente' | 'retirada';

/** Una fila de retencion_regla_versiones: las condiciones en columnas y los pasos en jsonb. */
export interface VersionRegla {
  id: string;
  regla_id: string;
  /** La clave del impuesto (FK a retencion_impuestos.clave). Solo para mostrar: el cálculo no la mira. */
  impuesto: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  estado: EstadoVersion;
  motivo: string | null;
  /** null = la versión no lo dice: no se aplica (nunca se supone una dirección). */
  direccion: Direccion | null;
  documentos: TipoDocumento[];
  /** null = 'ambos'. */
  operacion: Operacion | null;
  /** Vacío o null = todos. */
  sujetos: Sujeto[] | null;
  /** Vacío o null = todos. */
  contribuyentes: Contribuyente[] | null;
  /** La clave del parámetro que dice si la empresa es agente de ese impuesto; null = no se exige. */
  condicion_agente: string | null;
  /** La tabla de clasificación que la regla exige; null = no exige fila. */
  clasificacion_id: string | null;
  pasos: PasosRegla;
}

/** Una fila de retencion_clasificacion_filas (concepto del ISLR, actividad del ISAE, rubro…). */
export interface FilaClasificacion {
  id: string;
  clasificacion_id: string;
  codigo: string;
  descripcion: string;
  /** null = para todos los sujetos. */
  sujeto: Sujeto | null;
  pct: number | null;
  base_pct: number | null;
  minimo: number | null;
  minimo_unidad: UnidadMinimo | null;
  sustraendo_factor: number | null;
  tarifa_id: string | null;
}

/** Un tramo de retencion_tarifa_tramos, ya vigente a la fecha. `hasta` null = sin tope. */
export interface TramoTarifa { desde: number; hasta: number | null; pct: number; sustraendo: number }
export interface TarifaVigente { id: string; nombre: string; unidad: 'ut' | 'bs'; tramos: TramoTarifa[] }

/** Un supuesto de retencion_supuestos (los casos del 100 % del art. 5), marcado en el documento. */
export interface SupuestoMarcado { id: string; texto: string; pct: number }

/**
 * Una tasa a la fecha de la factura, tal como la dan retencion_tasa_bcv y
 * retencion_tasa_mmv: `fecha_tasa` es el día cuya tasa vale (el fin de
 * semana ya pasado), `regla` dice cómo se eligió y `provisional` avisa que
 * aún no es la definitiva.
 */
export interface TasaFecha { moneda: string; tasa: number; fecha_tasa: string; regla: string; provisional: boolean; fuente?: string }
