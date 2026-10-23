/* ============================================================
   MGG · Retenciones · Impresión · Formatos (maqueta v8, v8-1-formatos.js)

   Cada documento es un dato con versiones. La versión de fábrica
   reproduce el ejemplar: «no se le cambia ni se le añade ni se le resta»
   (usuario, 14/10). Lo emitido guarda la versión con la que salió.

   Anchos en px de la hoja carta horizontal (1056 × 816), medidos sobre
   el ejemplar.
   ============================================================ */
import type { IdComprobante, IdDocumento, IdRelacion, Impuesto, Orientacion } from './tipos';

/** Una columna de la hoja, tal como la midió la maqueta. */
export interface DefColumna {
  id: string;
  /** Rótulo, una línea por elemento. */
  rotulo: string[];
  /** Ancho en px de la hoja. */
  ancho: number;
  /** Número: a la derecha, con formato de monto. */
  numero?: boolean;
  /** Lleva total al pie. */
  total?: boolean;
  /** El dato, centrado. */
  centrado?: boolean;
  /** El rótulo, centrado. */
  rotuloCentrado?: boolean;
  /** El dato, en negrita. */
  negrita?: boolean;
  /** Sangría a la izquierda (el % del ISLR). */
  sangria?: boolean;
}

/** Una columna en un formato: si se ve y, en las relaciones, en qué hoja va. */
export interface ColumnaFormato {
  id: string;
  visible: boolean;
  /** Relaciones: la hoja del ejemplar (1 o 2). */
  hoja?: number;
}

export interface FormatoDocumento {
  nombre: string;
  ejemplar: string;
  tipo: 'comprobante' | 'relacion';
  impuesto: Impuesto;
  /** Orientación por defecto (horizontal); al imprimir se elige. */
  orientacion: Orientacion;
  /** Comprobantes: lleva el recuadro de firma y sello. */
  firma?: boolean;
  /** Comprobante de ISAE: lleva el logo del ente. */
  logoEnte?: boolean;
  textos: Record<string, string>;
  columnas: ColumnaFormato[];
}

/** Una versión del formato, vigente desde una fecha (la de fábrica, desde siempre). */
export interface VersionFormato {
  v: number;
  /** aaaa-mm-dd, o null: desde siempre. */
  desde: string | null;
  fabrica?: boolean;
  datos: FormatoDocumento;
}

/* ───────── Las columnas de los comprobantes ───────── */
export const COLS_COMP_IVA: DefColumna[] = [
  { id: 'oper', rotulo: ['Oper.', 'No.'], ancho: 29, centrado: true },
  { id: 'fecha', rotulo: ['Fecha del', 'Documento'], ancho: 59 },
  { id: 'factura', rotulo: ['Número de', 'Factura'], ancho: 110 },
  { id: 'control', rotulo: ['Num. Control', 'Doc.'], ancho: 67 },
  { id: 'nd', rotulo: ['Número', '(Nota Débito)'], ancho: 77 },
  { id: 'nc', rotulo: ['Número', '(Nota Crédito)'], ancho: 80 },
  { id: 'clase', rotulo: ['Clase de', 'Operacion'], ancho: 39 },
  { id: 'afectada', rotulo: ['Número', 'de factura', 'afectada'], ancho: 80, rotuloCentrado: true },
  { id: 'total', rotulo: ['Monto Total de', 'La Factura o Nota', 'de Debito'], ancho: 87, numero: true, total: true, rotuloCentrado: true },
  { id: 'sinDerecho', rotulo: ['Monto sin', 'derecho a', 'Crédito IVA'], ancho: 87, numero: true, total: true, rotuloCentrado: true },
  { id: 'base', rotulo: ['Base', 'Imponible'], ancho: 93, numero: true, total: true, rotuloCentrado: true },
  { id: 'alic', rotulo: ['%', 'Alícuota'], ancho: 47, numero: true, rotuloCentrado: true },
  { id: 'causado', rotulo: ['Impuesto', 'Causado'], ancho: 87, numero: true, total: true, rotuloCentrado: true },
];
export const COLS_COMP_ISAE: DefColumna[] = [
  { id: 'oper', rotulo: ['Oper', 'No.'], ancho: 23, centrado: true },
  { id: 'fecha', rotulo: ['Fecha de la', 'Factura'], ancho: 59 },
  { id: 'factura', rotulo: ['Número de', 'Factura'], ancho: 110 },
  { id: 'control', rotulo: ['Num. Control', 'Doc.'], ancho: 67 },
  { id: 'nd', rotulo: ['Número', '(Nota Débito)'], ancho: 77 },
  { id: 'nc', rotulo: ['Número', '(Nota Crédito)'], ancho: 80 },
  { id: 'clase', rotulo: ['Tipo de', 'Trans'], ancho: 39 },
  { id: 'afectada', rotulo: ['Número', 'de factura', 'afectada'], ancho: 80, rotuloCentrado: true },
  { id: 'total', rotulo: ['Total Compras', 'Incluyendo', 'el IVA'], ancho: 87, numero: true, rotuloCentrado: true },
  { id: 'sinDerecho', rotulo: ['Compras sin', 'derecho a', 'Crédito IVA'], ancho: 87, numero: true, total: true, rotuloCentrado: true },
  { id: 'base', rotulo: ['Base', 'Imponible'], ancho: 93, numero: true, total: true, rotuloCentrado: true },
  { id: 'alic', rotulo: ['%', 'Alícuota'], ancho: 47, numero: true, rotuloCentrado: true },
  { id: 'actividad', rotulo: ['Codigo', 'Actividad'], ancho: 86, centrado: true, negrita: true, rotuloCentrado: true },
];
export const COLS_COMP_ISLR: DefColumna[] = [
  { id: 'documento', rotulo: ['Documento'], ancho: 83 },
  { id: 'control', rotulo: ['Núm. Control'], ancho: 84 },
  { id: 'fecha', rotulo: ['Fecha Emision'], ancho: 83 },
  { id: 'descripcion', rotulo: ['Descripción'], ancho: 300, rotuloCentrado: true },
  { id: 'base', rotulo: ['Monto base'], ancho: 62, numero: true, total: true },
  { id: 'pct', rotulo: ['%'], ancho: 76, sangria: true },
  { id: 'sustraendo', rotulo: ['Sustraendo'], ancho: 78, numero: true },
  { id: 'retenido', rotulo: ['Monto Retenido'], ancho: 104, numero: true, total: true },
];

/* ───────── Las columnas de las relaciones: cada grupo es una hoja del ejemplar ───────── */
// Las columnas que no caben pasan a la hoja siguiente, con las mismas filas.
export const COLS_REL_IVA: DefColumna[][] = [
  [
    { id: 'codigo', rotulo: ['Código'], ancho: 107 },
    { id: 'nombre', rotulo: ['Nombre'], ancho: 163 },
    { id: 'rif', rotulo: ['Rif'], ancho: 89 },
    { id: 'comp', rotulo: ['No. Retención'], ancho: 111 },
    { id: 'documento', rotulo: ['Documento'], ancho: 72 },
    { id: 'control', rotulo: ['Numero Control'], ancho: 85 },
    { id: 'fecha', rotulo: ['Fecha Emisión'], ancho: 68 },
    { id: 'exento', rotulo: ['Total Exento'], ancho: 75, numero: true, total: true },
    { id: 'base', rotulo: ['Total Base Imponible'], ancho: 97, numero: true, total: true },
    { id: 'impuesto', rotulo: ['Total Impuesto'], ancho: 83, numero: true, total: true },
  ],
  [
    { id: 'total', rotulo: ['Total Operación'], ancho: 84, numero: true, total: true },
    { id: 'retenido', rotulo: ['Total Retención'], ancho: 95, numero: true, total: true },
  ],
];
export const COLS_REL_ISLR: DefColumna[][] = [
  [
    { id: 'rif', rotulo: ['Proveedor Rif'], ancho: 101 },
    { id: 'nombre', rotulo: ['Proveedor Nombre'], ancho: 217 },
    { id: 'fecha', rotulo: ['Fecha Emisión'], ancho: 64 },
    { id: 'comp', rotulo: ['No. Retención'], ancho: 87 },
    { id: 'tipodoc', rotulo: ['Tipo Doc.'], ancho: 43 },
    { id: 'documento', rotulo: ['Documento Afectado'], ancho: 84 },
    { id: 'control', rotulo: ['Numero Control'], ancho: 96 },
    { id: 'literal', rotulo: ['Literal'], ancho: 52 },
    { id: 'concepto', rotulo: ['Código Concepto'], ancho: 73 },
  ],
  [
    { id: 'descripcion', rotulo: ['Descripción'], ancho: 229 },
    { id: 'base', rotulo: ['Base Imponible de Retención'], ancho: 88, numero: true, total: true },
    { id: 'retenido', rotulo: ['Retención'], ancho: 72, numero: true, total: true },
    { id: 'pct', rotulo: ['%'], ancho: 34, numero: true },
  ],
];
export const COLS_REL_ISAE: DefColumna[][] = [
  [
    { id: 'codigo', rotulo: ['Código'], ancho: 68 },
    { id: 'nombre', rotulo: ['Nombre'], ancho: 205 },
    { id: 'rif', rotulo: ['Rif'], ancho: 73 },
    { id: 'comp', rotulo: ['No. Retención'], ancho: 69 },
    { id: 'documento', rotulo: ['Documento'], ancho: 90 },
    { id: 'control', rotulo: ['Numero Control'], ancho: 85 },
    { id: 'fecha', rotulo: ['Fecha Emisión'], ancho: 67 },
    { id: 'exento', rotulo: ['Total Exento'], ancho: 74, numero: true, total: true },
    { id: 'base', rotulo: ['Total Base Imponible'], ancho: 73, numero: true, total: true },
    { id: 'impuesto', rotulo: ['Total Impuesto'], ancho: 72, numero: true, total: true },
    { id: 'total', rotulo: ['Total Operación'], ancho: 72, numero: true, total: true },
    { id: 'retenido', rotulo: ['Total Retención'], ancho: 70, numero: true, total: true },
  ],
];

export const COLUMNAS_COMPROBANTE: Record<IdComprobante, DefColumna[]> = {
  comp_iva: COLS_COMP_IVA,
  comp_islr: COLS_COMP_ISLR,
  comp_isae: COLS_COMP_ISAE,
};
export const COLUMNAS_RELACION: Record<IdRelacion, DefColumna[][]> = {
  rel_iva: COLS_REL_IVA,
  rel_islr: COLS_REL_ISLR,
  rel_isae: COLS_REL_ISAE,
};

/** La hoja de cada relación: margen izquierdo, interlineado de la cabecera, margen de arriba y caracteres por línea del nombre. */
export interface HojaRelacionMedidas {
  izq: number;
  linea: number;
  arriba: number;
  nombre: number;
}
export const HOJA_RELACION: Record<Impuesto, HojaRelacionMedidas> = {
  iva: { izq: 15, linea: 16, arriba: 48, nombre: 26 },
  islr: { izq: 49, linea: 13.3, arriba: 54, nombre: 36 },
  isae: { izq: 15, linea: 13.3, arriba: 54, nombre: 34 },
};
/** Margen derecho de las relaciones, en px de la hoja. */
export const MARGEN_DERECHO_RELACION = 18;

/** La hoja carta, en px (96 por pulgada). */
export function medidasHoja(orientacion: Orientacion): { ancho: number; alto: number } {
  return orientacion === 'vertical' ? { ancho: 816, alto: 1056 } : { ancho: 1056, alto: 816 };
}

/* ───────── Los formatos de fábrica: el ejemplar, campo por campo ───────── */
const ROT_AGENTE_IVA = {
  nroComp: 'NRO. COMPROBANTE:', fecha: 'FECHA:', periodo: 'PERÍODO FISCAL:', anio: 'AÑO:', mes: 'MES:',
  agNombre: 'NOMBRE Ó RAZON SOCIAL DEL AGENTE DE RETENCIÓN', agRif: 'REGISTRO DE INFORMACIÓN FISCAL DEL AGENTE DE RETENCIÓN', agDir: 'DIRECCIÓN FISCAL DEL AGENTE DE RETENCIÓN',
  sjNombre: 'NOMBRE Ó RAZON SOCIAL DEL SUJETO RETENIDO', sjRif: 'REGISTRO DE INFORMACIÓN FISCAL DEL SUJETO RETENIDO', sjDir: 'DIRECCIÓN FISCAL DEL SUJETO RETENIDO',
};
const columnasDe = (cols: DefColumna[]): ColumnaFormato[] => cols.map((c) => ({ id: c.id, visible: true }));
const columnasPorHoja = (grupos: DefColumna[][]): ColumnaFormato[] =>
  grupos.flatMap((g, i) => g.map((c) => ({ id: c.id, visible: true, hoja: i + 1 })));

export const FORMATO_FABRICA: Record<IdDocumento, FormatoDocumento> = {
  comp_iva: {
    nombre: 'Comprobante de retención de IVA', ejemplar: 'Comprobante de retención de IVA (1 hoja)', tipo: 'comprobante', impuesto: 'iva', orientacion: 'horizontal', firma: true, logoEnte: false,
    textos: {
      leg1: 'Providencia Administrativa Nro. SNAT/2025/000054 de Fecha 02 de Julio 2025.',
      leg2: 'Decreto Constituyente de Reforma Parcial del Decreto con Rango y Fuerza de Ley que establece el Impuesto al Valor',
      leg3: 'Agregado  Gaceta Oficial Nro. 6.507 ext. del 29-01-2020',
      art: 'Articulo 11: "La Administracion Tributaria Podra Designar como responsables del pago del impuesto, en calidad de agentes de retencion, a quienes por sus funciones publicas o por razon de sus actividades privadas intervengan en operaciones gravadas con el impuesto establecido en esta Ley, (...)"',
      titulo: 'COMPROBANTE DE RETENCION DE IVA',
      ...ROT_AGENTE_IVA,
      retenido: 'Impuesto|Retenido',
      pie: 'Este Comprobante se emite segun lo establecido en el Articulo Nro. 16 de la Providencia Administrativa Nro. SNAT/2025/000054 de fecha 02 de Julio de 2025, Publicada en Gaceta Oficial  Nro. 43.171 de fecha 16 de Julio de 2025.',
      fechaEmision: 'FECHA  EMISION:', fechaEntrega: 'FECHA DE ENTREGA:',
    },
    columnas: columnasDe(COLS_COMP_IVA),
  },
  comp_islr: {
    nombre: 'Comprobante de retención de ISLR', ejemplar: 'Comprobante de retención de ISLR (1 hoja)', tipo: 'comprobante', impuesto: 'islr', orientacion: 'horizontal', firma: true, logoEnte: false,
    textos: {
      titulo: 'COMPROBANTE DE RETENCION DE IMPUESTO SOBRE LA RENTA',
      subtitulo: 'Decreto N° 1.808 · Gaceta Oficial N° 36.203 · Reglamento Parcial de la Ley de ISLR en materia de Retenciones',
      nroComp: 'NRO. COMPROBANTE', periodo: 'PERÍODO FISCAL', anio: 'AÑO:', mes: 'MES:', fecha: 'FECHA',
      agNombre: 'NOMBRE DEL AGENTE DE RETENCIÓN', agRif: 'REGISTRO DE INFORMACIÓN FISCAL DEL AGENTE DE RETENCIÓN', agDir: 'DIRECCIÓN FISCAL DEL AGENTE DE RETENCIÓN',
      sjNombre: 'NOMBRE Ó RAZON SOCIAL DEL SUJETO RETENIDO', sjRif: 'REGISTRO DE INFORMACIÓN FISCAL DEL SUJETO RETENIDO', sjDir: 'DIRECCIÓN FISCAL DEL SUJETO RETENIDO',
      porConcepto: 'Retención de I.S.L.R. por concepto de:', total: 'Total...', agente: 'Agente de Retención:', sujeto: 'Sujeto Retenido:', por: 'Por',
    },
    columnas: columnasDe(COLS_COMP_ISLR),
  },
  comp_isae: {
    nombre: 'Comprobante de retención de ISAE', ejemplar: 'Comprobante de retención de ISAE (1 hoja)', tipo: 'comprobante', impuesto: 'isae', orientacion: 'horizontal', firma: true, logoEnte: true,
    textos: {
      titulo: 'COMPROBANTE DE RETENCION DEL IMPUESTO  DE ACTIVIDAD  ECONOMICA',
      ordenanza: 'ORDENANZA SOBRE AGENTE DE RETENCION DE IMPUESTO DE ACTIVIDADES ECONOMICAS Art. 1 "La Presente ordenanza tiene por objeto establecer las personas que son responsables en calidad de agente de retencion del pago de impuesto de Patente de Industria y Comercio, en los casos y bajo las condiciones previstas en esta ordenanza"',
      r1: '(1)  NRO. COMPROBANTE:', r2: '(2)', agNombre: 'NOMBRE Ó RAZON SOCIAL DEL AGENTE DE RETENCIÓN', agDir: 'DIRECCIÓN FISCAL DEL AGENTE DE RETENCIÓN',
      r3: '(3)  N° LICENCIA ACTIVIDAD ECONOMICA', r4: '(04) N° DE RIF', r5: '(5)  FECHA:', r11: '(11)  PERÍODO FISCAL:', anio: 'AÑO:', mes: 'MES:',
      r7: '(7)  NOMBRE Ó RAZON SOCIAL DEL SUJETO RETENIDO', r9: '(9)  REGISTRO DE INFORMACIÓN FISCAL DEL SUJETO RETENIDO', r12: '(12) DIRECCIÓN FISCAL DEL SUJETO RETENIDO',
      r8: '(8)N° LICENCIA', id: 'N° DE ID', compras: 'C O M P R A S  I N T E R N A S', retenido: 'Impuesto|Municipal|Retenido',
      agente: 'Agente de Retención:', sujeto: 'Sujeto Retenido:', por: 'Por', firmaSujeto: 'FIRMA Y SELLO DEL SUJETO RETENIDO',
    },
    columnas: columnasDe(COLS_COMP_ISAE),
  },
  rel_iva: {
    nombre: 'Relación de retenciones de IVA a proveedores', ejemplar: 'Relación de IVA (2 hojas: 10 columnas y 2 columnas)', tipo: 'relacion', impuesto: 'iva', orientacion: 'horizontal',
    textos: { titulo: 'Retenciones de I.V.A. a Proveedores', modo: 'Resumido', entre: 'Entre los Días  Desde:{desde} Hasta:{hasta}', fecha: 'Fecha: {fecha}', banda: 'DOCUMENTO' },
    columnas: columnasPorHoja(COLS_REL_IVA),
  },
  rel_islr: {
    nombre: 'Relación de retenciones de ISLR a proveedores', ejemplar: 'Relación de ISLR (2 hojas: 9 columnas y 4 columnas)', tipo: 'relacion', impuesto: 'islr', orientacion: 'horizontal',
    textos: { titulo: 'Retenciones de I.S.L.R. de Proveedores', modo: 'Resumido', entre: 'Entre los Días Desde:{desde} Hasta:{hasta}', fecha: 'Fecha: {fecha}', banda: '' },
    columnas: columnasPorHoja(COLS_REL_ISLR),
  },
  rel_isae: {
    nombre: 'Relación de retenciones municipales a proveedores', ejemplar: 'Relación de ISAE (1 hoja, 12 columnas)', tipo: 'relacion', impuesto: 'isae', orientacion: 'horizontal',
    textos: { titulo: 'Retenciones Municipales a Proveedores', modo: 'Resumido', entre: 'Entre los Días  Desde:{desde} Hasta:{hasta}', fecha: 'Fecha: {fecha}', banda: 'DOCUMENTO' },
    columnas: columnasPorHoja(COLS_REL_ISAE),
  },
};

/** El formato de cada impuesto, por su clave interna (no por su nombre, que puede cambiar). */
export const FORMATO_COMPROBANTE: Record<Impuesto, IdComprobante> = { iva: 'comp_iva', islr: 'comp_islr', isae: 'comp_isae' };
export const FORMATO_RELACION: Record<Impuesto, IdRelacion> = { iva: 'rel_iva', islr: 'rel_islr', isae: 'rel_isae' };

/* ───────── Versiones ───────── */

/** La versión de fábrica (v1, desde siempre): el ejemplar. Una copia, para que nadie toque el original. */
export function versionFabrica(id: IdDocumento): VersionFormato {
  return { v: 1, desde: null, fabrica: true, datos: structuredClone(FORMATO_FABRICA[id]) };
}

/**
 * Completa un formato guardado con lo de fábrica que le falte (un texto o
 * las columnas). Lo que trae, manda: no se cambia nada de lo guardado.
 */
export function completarFormato(id: IdDocumento, datos: Partial<FormatoDocumento>): FormatoDocumento {
  const fab = FORMATO_FABRICA[id];
  return {
    ...structuredClone(fab),
    ...datos,
    textos: { ...fab.textos, ...(datos.textos ?? {}) },
    columnas: datos.columnas?.length ? datos.columnas : structuredClone(fab.columnas),
  };
}

/**
 * La versión vigente a una fecha (aaaa-mm-dd): la última cuyo «desde» no
 * pasa de la fecha (a igual fecha, la de número mayor). Sin versiones, o
 * si ninguna aplica todavía, la de fábrica.
 */
export function formatoVigente(id: IdDocumento, versiones: readonly VersionFormato[], fecha: string): VersionFormato {
  const aplican = versiones
    .filter((x) => !x.desde || x.desde <= fecha)
    .sort((a, b) => (a.desde ?? '').localeCompare(b.desde ?? '') || a.v - b.v);
  const ver = aplican[aplican.length - 1];
  return ver ? { ...ver, datos: completarFormato(id, ver.datos) } : versionFabrica(id);
}

/** La versión con la que salió un documento ya emitido (si no está en la lista y es la 1, la de fábrica). */
export function formatoPorVersion(id: IdDocumento, versiones: readonly VersionFormato[], v: number): VersionFormato | null {
  const ver = versiones.find((x) => x.v === v);
  if (ver) return { ...ver, datos: completarFormato(id, ver.datos) };
  return v === 1 ? versionFabrica(id) : null;
}

/* ───────── Qué columnas lleva cada hoja ───────── */

/** Las columnas visibles de un comprobante, en el orden del formato. */
export function columnasComprobante(id: IdComprobante, formato: FormatoDocumento): DefColumna[] {
  const defs = COLUMNAS_COMPROBANTE[id];
  return formato.columnas
    .filter((c) => c.visible)
    .map((c) => defs.find((d) => d.id === c.id))
    .filter((c): c is DefColumna => Boolean(c));
}

/**
 * Las columnas de cada hoja de una relación (una lista por hoja, en el
 * orden del formato). Qué columna va en qué hoja lo dice el formato; una
 * hoja sin columnas visibles no sale.
 */
export function gruposRelacion(id: IdRelacion, formato: FormatoDocumento): DefColumna[][] {
  const defs = COLUMNAS_RELACION[id].flat();
  const nHojas = Math.max(1, ...formato.columnas.map((c) => c.hoja || 1));
  return Array.from({ length: nHojas }, (_, i) =>
    formato.columnas
      .filter((c) => c.visible && (c.hoja || 1) === i + 1)
      .map((c) => defs.find((d) => d.id === c.id))
      .filter((c): c is DefColumna => Boolean(c)),
  ).filter((g) => g.length > 0);
}
