/* ============================================================
   MGG · Retenciones v8 · Las secciones de ⚙ Parámetros

   Las tarjetas de la maqueta (SECCIONES_PA, ORDEN_AJUSTES y ORDEN_AVANZADOS
   después de v8-2, v8-5 y v8-11), con su título y su línea. Cada una dice qué
   vista abre hoy; las que necesitan la base de Retenciones (paquete 2.1) no
   abren nada: en local se ven desactivadas y marcadas, y en producción no
   se muestran.
   ============================================================ */

/** La vista de Parámetros que abre una tarjeta (null = necesita la base nueva). */
export type VistaSeccion = 'empresa' | 'impuestos' | 'regimen' | null;

export interface Seccion {
  clave: string;
  titulo: string;
  linea: string;
  vista: VistaSeccion;
}

type Grupo = 'ajustes' | 'impuesto' | 'empresa';

const SECCIONES: Record<Grupo, Seccion[]> = {
  ajustes: [
    { clave: 'motivos', titulo: 'Motivos de «No aplica»', linea: 'Las razones para marcar que una factura no lleva retención.', vista: null },
    { clave: 'entes', titulo: 'Entes y logos', linea: 'Quién recibe cada retención y el logo de su comprobante.', vista: null },
    { clave: 'perfiles', titulo: 'Perfiles fiscales de proveedores', linea: 'Tipo de contribuyente, persona, actividades y licencia de cada proveedor.', vista: null },
    { clave: 'licencias', titulo: 'Tipos de licencia', linea: 'Los tipos de licencia de actividad económica que se eligen en el perfil.', vista: null },
    { clave: 'empresa', titulo: 'Datos de la empresa', linea: 'Los datos del agente de retención que van en cada comprobante.', vista: 'empresa' },
    { clave: 'firma', titulo: 'Firma y sello', linea: 'La imagen de la firma y el sello del agente de retención en los comprobantes.', vista: null },
    { clave: 'otro', titulo: 'Otro sistema', linea: 'Lo gestionado fuera de MGG: si entra en los totales y el nombre del otro sistema.', vista: null },
    { clave: 'vencimientos', titulo: 'Avisos de vencimiento', linea: 'Cuándo avisar de licencias, declaraciones y actividades que vencen.', vista: null },
  ],
  impuesto: [
    { clave: 'impuestos', titulo: 'Impuestos y reglas', linea: 'La ficha de cada impuesto: regla y vigencia, tablas, período y numeración, paso inicial, formato e interruptores.', vista: 'impuestos' },
    { clave: 'formatos', titulo: 'Formatos de impresión', linea: 'Comprobantes y relaciones, fieles a los ejemplares; con versiones y «volver a fábrica».', vista: null },
    { clave: 'convivencia', titulo: 'Convivencia con otro sistema', linea: 'Por impuesto: si convive con otro sistema o es «Solo MGG» desde una fecha.', vista: null },
  ],
  empresa: [
    { clave: 'regimen', titulo: 'Régimen fiscal de la empresa', linea: 'Agente de retención de IVA y contribuyente especial: desde cuándo, con motivo.', vista: 'regimen' },
    { clave: 'valores', titulo: 'Valores compartidos', linea: 'UT, % de IVA y % de IGTF: de toda la empresa; cada uno dice qué impuesto lo usa.', vista: 'regimen' },
    { clave: 'interruptores', titulo: 'Interruptores generales', linea: 'Reglas de todo el módulo. Las de cada impuesto están en su ficha.', vista: null },
  ],
};

/** Las tarjetas de un grupo. Fuera de local, solo las que abren algo hoy. */
export function seccionesDe(grupo: Grupo, local: boolean): Seccion[] {
  return SECCIONES[grupo].filter((s) => local || s.vista);
}

export const AVISO_AVANZADOS = 'Estos cambios afectan cálculos, números o fechas de declaración. Lo ya emitido no cambia.';

export const CADENA: [string, string][] = [
  ['Empresa', 'régimen y valores compartidos'], ['Impuesto', 'datos y ente'], ['Regla y vigencia', 'versiones con su «desde» y sus tablas'],
  ['Período y numeración', 'periodicidad, serie y paso inicial'], ['Formato', 'comprobante y relación, con versiones'],
];

