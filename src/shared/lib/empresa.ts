/* ============================================================
   MGG · Identidad de la empresa en los documentos

   Razón social y RIF que salen impresos en los PDF y Excel del sistema.
   Están aquí y en ningún otro lado a propósito: si cambian, se edita este
   archivo y listo.
   ============================================================ */

/** Razón social tal como va en los documentos formales. */
export const EMPRESA_NOMBRE = 'MINERAL GROUP GUAYANA C.A.';

/** RIF fiscal, para el membrete de los documentos formales. */
export const EMPRESA_RIF = 'J-50221930-7';

export interface IdentidadEmpresa {
  nombre: string;
  rif: string;
}

/** Identidad de la empresa (una sola en MGG). El parámetro existe por compatibilidad con pantallas traídas de Golden Touch. */
export function identidadEmpresa(_empresa?: string | null): IdentidadEmpresa {
  void _empresa;
  return { nombre: EMPRESA_NOMBRE, rif: EMPRESA_RIF };
}
