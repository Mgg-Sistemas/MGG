/* ============================================================
   MGG · Identidad de la empresa en los documentos

   Razón social y RIF que salen impresos en los PDF y Excel del sistema.
   MGG es la de siempre. Desde el 14-10-2026 hay más de una nómina posible
   (rrhh_empresas): si se pide la identidad de otra empresa y está en el
   registro de RRHH, salen SU razón social y SU RIF (recibos de nómina,
   constancias, hoja de ingreso de esa nómina).
   ============================================================ */
import { definicionEmpresa, normalizarEmpresa } from '@/modules/rrhh/empresa';

/** Razón social tal como va en los documentos formales. */
export const EMPRESA_NOMBRE = 'MINERAL GROUP GUAYANA C.A.';

/** RIF fiscal, para el membrete de los documentos formales. */
export const EMPRESA_RIF = 'J-50221930-7';

export interface IdentidadEmpresa {
  nombre: string;
  rif: string;
}

/** Identidad de la empresa: MGG por defecto; otra nómina trae la suya. */
export function identidadEmpresa(empresa?: string | null): IdentidadEmpresa {
  const key = normalizarEmpresa(empresa);
  if (key === 'MGG') return { nombre: EMPRESA_NOMBRE, rif: EMPRESA_RIF };
  const d = definicionEmpresa(key);
  if (d.razonSocial === d.key) return { nombre: EMPRESA_NOMBRE, rif: EMPRESA_RIF };
  return { nombre: d.razonSocial.toUpperCase(), rif: d.rif ?? '' };
}
