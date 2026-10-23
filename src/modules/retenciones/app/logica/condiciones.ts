/* ============================================================
   MGG · Retenciones · Cuándo aplica una regla

   Antes de calcular: qué versión rige a la fecha de la factura y si sus
   condiciones (dirección, documento, operación, sujeto, contribuyente,
   condición del agente) se cumplen. Todo sale de las columnas de la
   versión; nada del nombre del impuesto.

   La vigencia incluye los dos extremos, como en la base
   (`daterange(vigente_desde, vigente_hasta, '[]')`).
   ============================================================ */

import type { Contribuyente, Direccion, Operacion, Sujeto, TipoDocumento, VersionRegla } from './regla';

/** La versión que rige en la fecha. Las «en prueba» solo cuentan para el simulador. */
export function versionVigente(
  versiones: readonly VersionRegla[], fecha: string, opciones: { incluirPrueba?: boolean } = {},
): VersionRegla | null {
  const candidatas = versiones.filter((v) =>
    (v.estado === 'vigente' || (opciones.incluirPrueba && v.estado === 'prueba'))
    && v.vigente_desde <= fecha && (v.vigente_hasta == null || fecha <= v.vigente_hasta));
  // Si se solapan (no debería: la base lo impide), gana la que empezó más tarde.
  candidatas.sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : a.vigente_desde > b.vigente_desde ? -1 : 0));
  return candidatas[0] ?? null;
}

/** Lo que se sabe del documento y de la contraparte para decidir si la regla aplica. */
export interface DocumentoCondiciones {
  direccion: Direccion;
  tipo: TipoDocumento;
  /** 'ambos' = el documento trae bienes y servicios. */
  operacion: Operacion;
  /** null = el perfil de la contraparte no lo dice. */
  sujeto: Sujeto | null;
  contribuyente: Contribuyente | null;
}

/** Qué hacer cuando el parámetro de la condición del agente no tiene valor a la fecha (interruptor regimen_sin_configurar). */
export type SinConfigurar = 'avisar' | 'bloquear';

export type Aplicacion =
  | { aplica: true; aviso: string | null }
  | { aplica: false; motivo: string }
  | { aplica: 'falta_dato'; falta: 'sujeto' | 'contribuyente' | 'condicion_agente'; motivo: string };

const ETIQUETA_DOC: Record<TipoDocumento, string> = { factura: 'factura', nd: 'nota de débito', nc: 'nota de crédito', pago: 'pago' };

/**
 * ¿Aplica la versión a este documento? `agente` es el valor del parámetro
 * `condicion_agente` a la fecha de la factura (1 = sí, 0 = no, null = sin valor).
 */
export function aplicaRegla(
  v: VersionRegla, doc: DocumentoCondiciones, agente: number | null, sinConfigurar: SinConfigurar = 'avisar',
): Aplicacion {
  // Una versión sin dirección no se aplica: nunca se supone (revisión de REG-1, C1).
  if (!v.direccion) return { aplica: false, motivo: 'La regla no dice si es para retenciones practicadas o recibidas. Revisarla en ⚙ Parámetros.' };
  if (v.direccion !== doc.direccion) return { aplica: false, motivo: `La regla es para retenciones ${v.direccion === 'practicada' ? 'practicadas' : 'recibidas'}.` };
  if (!(v.documentos ?? []).includes(doc.tipo)) return { aplica: false, motivo: `La regla no aplica a una ${ETIQUETA_DOC[doc.tipo]}.` };
  // Un documento con bienes y servicios no se descarta entero: se decide por línea (motor.ts). null = 'ambos'.
  const operacion = v.operacion ?? 'ambos';
  if (operacion !== 'ambos' && doc.operacion !== 'ambos' && doc.operacion !== operacion) {
    return { aplica: false, motivo: `La regla aplica solo a ${operacion === 'bienes' ? 'compras de bienes' : 'servicios'}.` };
  }
  const sujetos = v.sujetos ?? [];
  if (sujetos.length) {
    // El sujeto no se adivina por la letra del RIF: si falta, se pide.
    if (!doc.sujeto) return { aplica: 'falta_dato', falta: 'sujeto', motivo: 'Falta el tipo de sujeto de la contraparte en su perfil fiscal.' };
    if (!sujetos.includes(doc.sujeto)) return { aplica: false, motivo: 'La regla no aplica a este tipo de sujeto.' };
  }
  const contribuyentes = v.contribuyentes ?? [];
  if (contribuyentes.length) {
    if (!doc.contribuyente) return { aplica: 'falta_dato', falta: 'contribuyente', motivo: 'Falta el tipo de contribuyente de la contraparte en su perfil fiscal.' };
    if (!contribuyentes.includes(doc.contribuyente)) return { aplica: false, motivo: 'La regla no aplica a este tipo de contribuyente.' };
  }
  if (v.condicion_agente) {
    if (agente == null) {
      const motivo = 'La condición de agente de la empresa para este impuesto no está cargada a esa fecha.';
      return sinConfigurar === 'bloquear' ? { aplica: 'falta_dato', falta: 'condicion_agente', motivo } : { aplica: true, aviso: motivo };
    }
    if (!agente) return { aplica: false, motivo: 'La empresa no es agente de este impuesto a esa fecha.' };
  }
  return { aplica: true, aviso: null };
}
