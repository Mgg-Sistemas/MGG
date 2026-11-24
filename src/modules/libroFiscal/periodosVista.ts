/* ============================================================
   Golden Touch · Retenciones · Períodos visibles
   La tabla `retencion_periodos` se genera para todo el catálogo. Esta
   función aplica lo que el usuario desactivó en Parámetros y el régimen
   vigente de la empresa, SIN borrar ni ocultar en base las filas históricas:
   · `activos` (Parámetros › Impuestos) filtra siempre que se pudo leer.
   · `practicaClaves` (régimen) filtra solo el año en curso; años anteriores
     siguen visibles para auditoría.
   Si alguna lectura falló (null), se deja pasar: degradación segura.
   ============================================================ */
import type { ImpuestosActivos } from '@/modules/retenciones/impuestosVista';
import { tipoDeGt } from './retencionesFiscal.repository';

export function periodosAplicables<T extends { tipo: string }>(
  periodos: readonly T[],
  activos: ImpuestosActivos | null,
  practicaClaves: ReadonlySet<string> | null,
  anio: number,
  anioActual: number,
): T[] {
  return periodos.filter((p) => {
    const clave = String(p.tipo ?? '').toUpperCase();
    if (activos && !activos.claves.has(tipoDeGt(clave))) return false;
    if (practicaClaves && anio === anioActual && !practicaClaves.has(clave)) return false;
    return true;
  });
}
