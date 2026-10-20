/* ============================================================
   MGG · Retenciones · Impresión · Tipos de entrada

   Lo que necesitan las hojas impresas (los 3 comprobantes y las 3
   relaciones). Los llena la capa de datos; acá no se consulta la base.

   Fechas en ISO (aaaa-mm-dd): la hoja las escribe dd/mm/aaaa.
   Montos en número: la hoja los escribe como el ejemplar.
   ============================================================ */

export type Impuesto = 'iva' | 'islr' | 'isae';
export type Orientacion = 'horizontal' | 'vertical';

export type IdComprobante = 'comp_iva' | 'comp_islr' | 'comp_isae';
export type IdRelacion = 'rel_iva' | 'rel_islr' | 'rel_isae';
export type IdDocumento = IdComprobante | IdRelacion;

/** Una imagen que va en la hoja (firma y sello, logo del ente). */
export interface ImagenImpresion {
  /** URL (firmada o data:) de la imagen. */
  src: string;
  alt?: string;
}

/** El agente de retención (la empresa), según la emisión. */
export interface AgenteComprobante {
  razon: string;
  rif: string;
  direccion: string;
  /** N° de licencia de actividad económica (solo el ISAE). */
  licencia?: string;
}

/** El sujeto retenido (el proveedor). */
export interface SujetoComprobante {
  nombre: string;
  rif: string;
  direccion: string;
  /** N° de licencia municipal (solo el ISAE). */
  licencia?: string;
  /** N° de ID municipal (solo el ISAE). */
  idMunicipal?: string;
}

/**
 * Una fila de la tabla del comprobante. Hay una por factura (o nota) y,
 * con varias líneas, una por concepto (ISLR) o por actividad (ISAE).
 * Cada impuesto usa sus columnas; lo que no aplica puede faltar.
 */
export interface FilaComprobante {
  /** «Oper. No.»: en el IVA, el orden de la fila (1, 2…); en el ISAE, el correlativo de operaciones del año. */
  oper?: string;
  /** Fecha del documento (aaaa-mm-dd). */
  fecha: string;
  /** N° de la factura. En una nota de crédito va vacío: el número va en `nc`. */
  factura?: string;
  /** N° de control: el guardado en la retención (`retenciones.factura_control`), no el de Compras. */
  control: string;
  /** N° de la nota de débito. */
  nd?: string;
  /** N° de la nota de crédito. */
  nc?: string;
  /** Clase de operación («01-reg»). */
  clase?: string;
  /** N° de la factura afectada (en una nota de crédito). */
  afectada?: string;
  /** Monto total del documento (en una nota de crédito, negativo). */
  total?: number;
  /** Monto sin derecho a crédito fiscal. */
  sinDerecho?: number;
  /** Base imponible (en una nota de crédito, negativa: resta). */
  base: number;
  /** % de alícuota del IVA. */
  alic?: number;
  /** Impuesto causado (IVA de la factura). */
  causado?: number;
  /** Monto retenido. */
  retenido: number;
  /** ISLR: el documento (N° de factura). */
  documento?: string;
  /** ISLR: la descripción del concepto, como sale en la hoja (en mayúsculas). */
  descripcion?: string;
  /** ISLR: % del concepto. */
  pct?: number;
  /** ISLR: sustraendo. */
  sustraendo?: number;
  /** ISAE: código de la actividad económica. */
  actividad?: string;
  /** ISAE: % de la alícuota de la actividad. */
  alicIsae?: number;
}

export type ClaveTotal = 'total' | 'sinDerecho' | 'base' | 'causado' | 'retenido';
export type TotalesComprobante = Record<ClaveTotal, number>;

/** Todo lo que lleva un comprobante (la foto de la emisión manda). */
export interface DatosComprobante {
  impuesto: Impuesto;
  /** N° del comprobante, tal como se emitió (la serie interna). En el ISAE la hoja lo presenta «AAAAMM 9 dígitos». */
  numero: string;
  /** Fecha de emisión (aaaa-mm-dd). */
  fecha: string;
  /** Período fiscal: año (4 dígitos) y mes (2 dígitos). */
  periodo: { anio: string; mes: string };
  agente: AgenteComprobante;
  sujeto: SujetoComprobante;
  filas: FilaComprobante[];
  /** Totales. Si faltan, se suman de las filas. */
  totales?: Partial<TotalesComprobante>;
  /** Firma y sello del agente (la versión con que se emitió). Sin imagen, el recuadro queda en blanco. */
  firma?: ImagenImpresion | null;
  /** Logo del ente (la alcaldía, en el ISAE). Sin imagen, el recuadro rotulado «Logo de la Alcaldía». */
  logoEnte?: ImagenImpresion | null;
}

/** Una fila de una relación: una retención practicada (o una línea suya). */
export interface FilaRelacion {
  /** RIF del proveedor. También es el «Código» de la relación, como en el ejemplar. */
  rif: string;
  /** Nombre o razón social del proveedor. */
  nombre: string;
  /** N° de la retención (el comprobante), tal como se emitió. */
  comp: string;
  /** N° del documento (factura o nota). */
  documento: string;
  /** N° de control: el guardado en la retención (`retenciones.factura_control`). */
  control: string;
  /** Fecha de emisión de la retención (aaaa-mm-dd). */
  fecha: string;
  exento?: number;
  base: number;
  impuesto?: number;
  total?: number;
  retenido: number;
  /** ISLR: tipo de documento («FCM»). */
  tipodoc?: string;
  /** ISLR: literal del concepto. */
  literal?: string;
  /** ISLR: código del concepto. */
  concepto?: string;
  /** ISLR: descripción del concepto (en mayúsculas). */
  descripcion?: string;
  /** ISLR: % del concepto. */
  pct?: number;
}

/** Todo lo que lleva una relación. */
export interface DatosRelacion {
  impuesto: Impuesto;
  /** Razón social de la empresa (primera línea de la cabecera). */
  empresa: string;
  /** Período de la relación (aaaa-mm-dd). */
  desde: string;
  hasta: string;
  /** Momento de la generación («Fecha: dd/mm/aaaa hh:mm am»). Fijo, para que la vista previa y la hoja impresa coincidan. */
  generado: Date;
  filas: FilaRelacion[];
}
