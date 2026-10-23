import type { TipoImpuesto } from './retencionesCalculo';

export interface ValidacionCero {
  requiereMotivo: boolean;
  mensaje: string | null;
}

export function validarMotivoCero(
  porcentaje: number,
  montoRetenido: number,
  motivo: string | null | undefined,
  tipo: TipoImpuesto,
): ValidacionCero {
  const esCero = porcentaje === 0 || montoRetenido === 0;
  if (!esCero) return { requiereMotivo: false, mensaje: null };

  const textoMotivo = (motivo ?? '').trim();
  if (textoMotivo.length > 0) return { requiereMotivo: true, mensaje: null };

  const label = LABEL_TIPO[tipo] ?? 'la retención';
  return {
    requiereMotivo: true,
    mensaje: `${label} da 0 %: escriba el motivo antes de registrar.`,
  };
}

export function esCeroSinMotivo(
  porcentaje: number,
  montoRetenido: number,
  motivo: string | null | undefined,
): boolean {
  return (porcentaje === 0 || montoRetenido === 0) && !(motivo ?? '').trim();
}

const LABEL_TIPO: Record<string, string> = {
  iva: 'La retención de IVA',
  islr: 'La retención de ISLR',
  municipal: 'La retención de ISAE',
  regional: 'El timbre estadal',
  igtf: 'La percepción de IGTF',
};
