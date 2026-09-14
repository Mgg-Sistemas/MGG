/* ============================================================
   MGG · Salidas · Código correlativo de la solicitud (SAL-/TRA-AAAA-NNNN)

   Antes el número salía de CONTAR las solicitudes del scope y sumar 1.
   Se borró TRA-2026-0004: quedaron 5 traslados, el siguiente se calculó
   como TRA-2026-0006 —que ya existía— y la base rechazó el alta con
   «No se pudo crear la solicitud» el 14-09-2026. Ahora se toma el MAYOR
   número usado en el año y se le suma 1: un hueco nunca hace chocar.
   ============================================================ */

export const prefijoCodigo = (scope: 'salida' | 'traslado') => (scope === 'traslado' ? 'TRA' : 'SAL');

/** Siguiente código a partir del último usado (`null` si es el primero del año). */
export function siguienteCodigo(prefijo: string, year: number, ultimo: string | null | undefined): string {
  const m = (ultimo ?? '').match(/-(\d+)$/);
  const n = m ? Number(m[1]) : 0;
  return `${prefijo}-${year}-${String(n + 1).padStart(4, '0')}`;
}
