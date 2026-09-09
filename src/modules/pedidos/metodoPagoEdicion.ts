import type { Orden, PagoMetodo } from '@/shared/lib/types';

/**
 * Corrección del método de pago de una OC que YA está en «Confirmada pagar».
 *
 * El método y los datos del beneficiario se cargan al mandar la OC a pagar. Si ahí se
 * escribió mal el banco, el teléfono o la cuenta —o el proveedor pidió cobrar por otra
 * vía— antes había que anular la OC. Acá se corrige en el sitio: la OC no se mueve de
 * estado ni sale de la cola de Tesorería, solo cambia CÓMO se le paga.
 */

/** Patas del pago tal como quedaron en la OC, listas para editar en el formulario. */
export function legsDesdeMetodoPago(
  metodos: PagoMetodo[] | null | undefined,
  monedaDe: (metodo: string) => string,
): PagoMetodo[] {
  return (metodos ?? [])
    .filter((m) => !!m && !!m.metodo)
    .map((m) => ({
      metodo: m.metodo,
      // Una OC vieja puede no traer moneda: se rearma desde el método.
      moneda: m.moneda || monedaDe(m.metodo),
      monto: Number(m.monto) || 0,
      ...(m.datos ? { datos: { ...m.datos } } : {}),
    }));
}

/**
 * Motivo por el que NO se puede corregir el método de pago. `null` = sí se puede.
 * Una vez que hay plata movida (pago o abonos) el método es historia contable y no se toca.
 */
export function motivoNoCorregible(o: Pick<Orden, 'estado' | 'pagada_en' | 'abonado_total'>): string | null {
  if (o.estado !== 'oc_aprobada') return 'Solo se corrige el método de pago de una OC en «Confirmada pagar».';
  if (o.pagada_en) return 'La OC ya se pagó: el método no se puede cambiar.';
  if ((Number(o.abonado_total) || 0) > 0) return 'La OC ya tiene abonos registrados: el método no se puede cambiar.';
  return null;
}
