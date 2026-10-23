/* ============================================================
   Golden Touch · Retenciones · Datos de la empresa y valores sin R3 (D41, Lote 2)

   Antes de guardar Parámetros («Datos de la empresa» y «Valores» mientras no
   hay R3): el RIF de la empresa se completa (dígito verificador) y se valida
   como cualquier RIF; la UT es mayor que 0; los % van de 0 a 100. El RIF se
   guarda con guiones (J-50129993-5): es el que se imprime en el comprobante.
   ============================================================ */
import { completarRif, formatearRif, rifValido } from '@/shared/lib/rif';

/** El RIF de la empresa listo para guardar, o el texto del error. Vacío = sin cambio de criterio (se guarda vacío). */
export function rifEmpresaParaGuardar(rif: string | null | undefined): { rif: string; error: string | null } {
  const escrito = String(rif ?? '').trim();
  if (!escrito) return { rif: '', error: null };
  const completo = completarRif(escrito);
  if (!completo || !rifValido(completo)) {
    return { rif: escrito, error: `El RIF de la empresa «${escrito}» no es válido: letra (J, G, V, E, P o C), 8 dígitos y el verificador.` };
  }
  return { rif: formatearRif(completo), error: null };
}

/** Lo que falta en los valores que se guardan sin R3; null si están bien. */
export function faltaEnValoresSinR3(v: { valorUt: number; pctIgtf: number; municipal: number; estadal: number }): string | null {
  if (!(v.valorUt > 0)) return 'El valor de la UT tiene que ser mayor que 0.';
  if (v.pctIgtf < 0 || v.pctIgtf > 100) return 'El % de IGTF va de 0 a 100.';
  if (v.municipal < 0 || v.municipal > 100) return 'La alícuota municipal (ISAE) va de 0 a 100.';
  if (v.estadal < 0 || v.estadal > 100) return 'El timbre fiscal estadal va de 0 a 100.';
  return null;
}

/** El % de un concepto del ISLR: de 0 a 100. */
export const faltaEnPctConcepto = (pct: number): string | null => (pct < 0 || pct > 100 ? 'El porcentaje va de 0 a 100.' : null);
