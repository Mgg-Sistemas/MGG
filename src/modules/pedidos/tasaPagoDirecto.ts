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

/* ───────────── Cuánto corresponde pagar desde la cuenta elegida ─────────────

   El motor de conversión pivota en USD: pasa el total a dólares y de ahí a la
   moneda de la cuenta. Eso está bien cuando el pago CRUZA de moneda, y estaba
   mal cuando no cruza.

   Pagando una factura de Bs 389.941,68 desde una cuenta en Bs con tasa 842,21:
     389.941,68 ÷ 842,21 = 463,0018…  → redondeado a 2 decimales = 463,00
     463,00 × 842,21                  = 389.943,23

   Bs 1,55 que no existen, aparecidos en la ida y vuelta por el redondeo. La
   pantalla decía «Corresponde Bs 389.943,23» para una factura de Bs 389.941,68,
   avisaba que el monto tecleado se pasaba y ofrecía asentar un REEMBOLSO por una
   diferencia inventada. Y como el número se movía al cambiar la tasa, parecía
   que la tasa decidía lo que sale de la caja — cuando en el mismo módulo está
   escrito que, sin cruce, la tasa NO cambia lo que sale de la caja (solo valora
   el material al entrar al inventario).

   Si la cuenta paga en la misma moneda del documento, corresponde el total tal
   cual. Sin vueltas.
   ──────────────────────────────────────────────────────────────────────────── */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** USD y USDT son la misma moneda a estos efectos: el sistema los trata 1:1. */
function monedaCanonica(m: string | null | undefined): string {
  const s = String(m ?? '').trim().toUpperCase();
  return s === 'USDT' ? 'USD' : s;
}

/** ¿La cuenta paga en la misma moneda en la que está el documento? */
export function mismaMonedaQueElDocumento(monedaBase: string, monedaCuenta: string | null | undefined): boolean {
  return !!monedaCuenta && monedaCanonica(monedaBase) === monedaCanonica(monedaCuenta);
}

/**
 * Lo que corresponde pagar desde la cuenta elegida, en la moneda de esa cuenta.
 *
 * `convertir` es el motor que pivota en USD; solo se usa cuando hace falta
 * cruzar de moneda.
 */
export function montoQueCorresponde(args: {
  /** Moneda del documento: 'Bs' o 'USD'. */
  monedaBase: string;
  /** El total a pagar, en la moneda del documento. */
  aPagar: number;
  /** Moneda de la cuenta que paga. `null` = todavía no se eligió. */
  monedaCuenta: string | null | undefined;
  /** El total llevado a USD, para cuando el pago sí cruza. */
  totalUsd: number;
  convertir: (moneda: string, usd: number) => number;
}): number {
  if (!args.monedaCuenta) return round2(args.totalUsd);
  if (mismaMonedaQueElDocumento(args.monedaBase, args.monedaCuenta)) return round2(args.aPagar);
  return args.convertir(args.monedaCuenta, args.totalUsd);
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
