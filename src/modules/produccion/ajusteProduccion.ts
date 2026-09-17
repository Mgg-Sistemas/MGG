/* ============================================================
   MGG · Fundición / Refinación · corregir la cantidad producida

   Una colada (o refinación) ya finalizada se pesa mal, se carga de más o se
   corrige después. Antes había que tocar el inventario por un lado y la colada
   por el otro, y los dos números quedaban peleados: la lista de material a
   refinar seguía ofreciendo los kg viejos.

   Acá se calcula la corrección: la DIFERENCIA que hay que mover en inventario y
   los costos que quedan. La nota es obligatoria: toda corrección dice por qué.
   ============================================================ */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface AjusteProduccion {
  /** Lo que hay que mover en inventario: + entra, − sale. 0 = no se toca. */
  delta: number;
  cantidad: number;
  /** Costo por kg/unidad recalculado: el costo del proceso no cambió, se reparte distinto. */
  costoUnitario: number;
  ganancia: number | null;
}

/**
 * Calcula la corrección de una producción finalizada.
 * `costoProceso` = materiales + mano de obra + indirectos.
 * Lanza si la cantidad no es válida o si no hay nota.
 */
export function calcularAjusteProduccion(input: {
  cantidadActual: number;
  cantidadNueva: number;
  costoProceso: number;
  precioVenta?: number | null;
  nota: string;
}): AjusteProduccion {
  const nota = (input.nota ?? '').trim();
  if (!nota) throw new Error('Escribí el motivo de la corrección: queda en la trazabilidad y en el inventario.');
  if (nota.length < 4) throw new Error('El motivo es muy corto: explicá brevemente qué se corrige.');

  const nueva = round2(Number(input.cantidadNueva));
  if (!Number.isFinite(nueva) || nueva <= 0) throw new Error('La cantidad corregida debe ser mayor que 0.');

  const actual = round2(Number(input.cantidadActual) || 0);
  const delta = round2(nueva - actual);
  if (delta === 0) throw new Error('La cantidad es la misma: no hay nada que corregir.');

  const costo = Number(input.costoProceso) || 0;
  const costoUnitario = round2(costo / nueva);
  const precio = input.precioVenta;
  const ganancia = precio != null ? round2((Number(precio) - costoUnitario) * nueva) : null;

  return { delta, cantidad: nueva, costoUnitario, ganancia };
}

/** Texto que queda en el movimiento de inventario y en la trazabilidad. */
export function detalleAjuste(
  tipo: 'fundicion' | 'refinacion' | null | undefined,
  numero: number | null | undefined,
  de: number,
  a: number,
  nota: string,
): string {
  const proceso = tipo === 'refinacion' ? 'Refinación' : 'Colada';
  const ref = numero ? ` #${numero}` : '';
  return `Corrección de ${proceso.toLowerCase()}${ref}: ${round2(de)} → ${round2(a)} · ${nota.trim()}`;
}
