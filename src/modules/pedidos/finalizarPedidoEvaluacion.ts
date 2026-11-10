export const CALIDAD_LABELS: Record<number, string> = {
  5: '5 estrellas · Excelente',
  4: '4 estrellas · Buena',
  3: '3 estrellas · Aceptable',
  2: '2 estrellas · Deficiente',
  1: '1 estrella · Muy mala',
};

export const LIMITE_FACTURA_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Valida el archivo de la factura adjunta (tamaño máximo 10 MB).
 */
export function validarArchivoFactura(file?: { size: number } | null): string | null {
  if (!file) return null;
  if (file.size > LIMITE_FACTURA_BYTES) {
    return 'La factura no puede superar 10 MB.';
  }
  return null;
}

/**
 * Calcula automáticamente la puntualidad en días según la fecha prometida de la oferta y la fecha de recepción.
 * Si no hay fecha prometida o no es válida, retorna 0 (en fecha, neutro).
 * Signo: positivo = recibido antes de la fecha prometida (adelantado),
 *        cero = recibido en la fecha prometida o sin fecha comprometida,
 *        negativo = recibido después de la fecha prometida (atrasado).
 */
export function calcularPuntualidadAutomatica(
  fechaPrometida?: string | null,
  fechaRecibidoIso?: string | null
): number {
  if (!fechaPrometida || !fechaRecibidoIso) return 0;
  const p = new Date(`${fechaPrometida.slice(0, 10)}T00:00:00`).getTime();
  const r = new Date(`${fechaRecibidoIso.slice(0, 10)}T00:00:00`).getTime();
  if (isNaN(p) || isNaN(r)) return 0;
  return Math.round((p - r) / 86_400_000);
}
