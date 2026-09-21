/* ============================================================
   MGG · Tesorería · Qué hace la «Tasa de pago» al pagar un directo

   Hasta ahora el campo de tasa solo aparecía cuando el pago cruzaba Bs↔$.
   Si la compra era en Bs y se pagaba desde una cuenta en Bs, el campo no
   estaba: la tasa quedaba clavada en la que Compras guardó al montar, y el
   material entraba al inventario valorado a ESA tasa, no a la que de verdad
   se pagó. (El inventario está en dólares: cada material entra a
   (gasto/cantidad) ÷ tasa, así que una tasa equivocada infla el costo.)

   Ahora el campo está siempre. Acá se resuelve qué hace la tasa en cada caso,
   porque no siempre hace lo mismo:

   - 'convierte' → el pago cruza Bs↔$: la tasa decide cuánto sale de la caja.
   - 'valora'    → no cruza, pero es una COMPRA en Bs: no cambia lo que sale de
                   la caja, y sí la tasa con la que el material entra al
                   inventario.
   - 'ambas'     → cruza Y es una compra en Bs: las dos cosas a la vez.
   - 'ninguna'   → no cruza y no hay inventario de por medio (servicio, o
                   compra en $): la tasa no cambia nada en este pago.
   ============================================================ */

/** Qué efecto tiene la tasa en el pago que se está haciendo. */
export type EfectoTasaPago = 'convierte' | 'valora' | 'ambas' | 'ninguna';

export interface SituacionPago {
  /** 'compra' o 'servicio' directo. */
  kind: 'compra' | 'servicio';
  /** Moneda del documento: 'Bs' o 'USD'. */
  monedaBase: string;
  /** ¿El pago cruza Bs↔$ (hace falta convertir)? */
  cruzaBsUsd: boolean;
}

const esBs = (m: string | null | undefined) => String(m ?? '').trim().toUpperCase() === 'BS';

/** ¿La tasa de este pago también valora el material al entrar al inventario? */
export function tasaValoraInventario(s: SituacionPago): boolean {
  return s.kind === 'compra' && esBs(s.monedaBase);
}

export function efectoTasaPago(s: SituacionPago): EfectoTasaPago {
  const valora = tasaValoraInventario(s);
  if (s.cruzaBsUsd && valora) return 'ambas';
  if (s.cruzaBsUsd) return 'convierte';
  if (valora) return 'valora';
  return 'ninguna';
}

/** La explicación que va debajo del campo, para que nadie adivine qué hace la tasa. */
export function explicacionTasaPago(efecto: EfectoTasaPago): string {
  switch (efecto) {
    case 'ambas':
      return 'Con esta tasa se convierte lo que sale de la caja Y se valora el material al entrar al inventario. '
        + 'Si la dejás vacía se usa la tasa BCV.';
    case 'convierte':
      return 'Con esta tasa se convierte lo que sale de la caja. Si la dejás vacía se usa la tasa BCV.';
    case 'valora':
      return 'Las dos monedas son la misma, así que la tasa no cambia lo que sale de la caja. Sí es la tasa con la '
        + 'que el material entra al inventario: el inventario está en dólares y el costo se saca dividiendo entre '
        + 'ella. Si la dejás vacía se usa la que traía la compra.';
    case 'ninguna':
    default:
      return 'Las dos monedas son la misma: en este pago la tasa no cambia nada. Queda anotada como referencia.';
  }
}
