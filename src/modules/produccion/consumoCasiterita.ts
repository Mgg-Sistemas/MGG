/* ============================================================
   MGG · Fundición · Que la casiterita de la colada SALGA del inventario

   Los big bags que se eligen del Inventario Detallado (SnO₂) vivían
   SOLO dentro del reporte de la colada (`produccion_colada.datos`).
   Nunca se convertían en material de la orden, así que:

     · no descontaban un kilo del inventario, y
     · no entraban al costo: una colada con 1.683 kg de casiterita a
       $18,74 daba «costo de material $92» —solo coque y caco₃— y un
       costo de $0,11 por kilo de estaño.

   Por eso el mismo big bag se podía quemar una y otra vez: el saldo se
   calculaba leyendo los reportes de colada, pero el stock real nunca
   bajaba, y nada ataba una cosa con la otra.

   Acá los big bags se vuelven UNA línea de material consumido.
   ============================================================ */

const round2 = (n: number) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/** Lo que hace falta saber de un big bag del reporte para consumirlo. */
export interface BigBagConsumido {
  origen_detalle_id?: string | null;
  kg?: number | null;
  precinto?: string | null;
  aliado?: string | null;
  tasa?: number | null;
}

/** Una línea de material lista para `crearProduccion`. */
export interface LineaCasiterita {
  producto_id: string;
  material_nombre: string;
  almacen: string;
  cantidad: number;
  costo: number;
  /**
   * Siempre baja el stock, incluso si la colada se carga como vieja.
   *
   * El coque y el caco₃ ya salieron del almacén por una Salida de material
   * cuando se llevaron al horno, y por eso la colada no los vuelve a descontar.
   * La casiterita no tiene ese documento: sale del Inventario Detallado directo
   * al crisol. Si esta línea respetara la casilla de «carga vieja», el big bag
   * seguiría figurando entero y se podría fundir de nuevo.
   */
  siempre_descuenta: true;
}

/** Solo las bolsas TRAÍDAS DEL INVENTARIO con kilos: las manuales no existen en stock. */
export function bagsDeInventario(bags: readonly BigBagConsumido[] | null | undefined): BigBagConsumido[] {
  return (bags ?? []).filter((b) => !!b?.origen_detalle_id && (Number(b.kg) || 0) > 0);
}

/** Kg pedidos por big bag en ESTE formulario (la misma bolsa puede ir en dos renglones). */
export function kgPorBag(bags: readonly BigBagConsumido[] | null | undefined): Map<string, number> {
  const acc = new Map<string, number>();
  for (const b of bagsDeInventario(bags)) {
    const id = b.origen_detalle_id as string;
    acc.set(id, round2((acc.get(id) ?? 0) + (Number(b.kg) || 0)));
  }
  return acc;
}

/**
 * UNA sola línea de material con TODA la casiterita de la colada.
 *
 * Va consolidada a propósito: todas las bolsas son el mismo producto en el
 * mismo almacén, así que una línea por bolsa serían varias escrituras sobre
 * la MISMA fila de existencia. El desglose por precinto ya vive en el reporte
 * de la colada, que es donde se lee.
 *
 * El costo es el PROMEDIO PONDERADO de las tasas: así el subtotal da exacto lo
 * mismo que sumar bolsa por bolsa, sin inventar un precio que nadie pagó.
 */
export function lineaCasiterita(
  bags: readonly BigBagConsumido[] | null | undefined,
  productoId: string | null | undefined,
  almacen: string,
): LineaCasiterita | null {
  if (!productoId || !almacen) return null;
  const usables = bagsDeInventario(bags);
  if (!usables.length) return null;

  let kg = 0;
  let valor = 0;
  for (const b of usables) {
    const k = Number(b.kg) || 0;
    kg += k;
    valor += k * (Number(b.tasa) || 0);
  }
  kg = round2(kg);
  if (kg <= 0) return null;

  const bolsas = kgPorBag(bags).size;
  return {
    producto_id: productoId,
    material_nombre: `CASITERITA · ${bolsas} big bag${bolsas === 1 ? '' : 's'} del inventario detallado`,
    almacen,
    cantidad: kg,
    costo: round2(valor / kg),
    siempre_descuenta: true,
  };
}

/** Un big bag pedido por encima de su saldo. */
export interface Sobregiro {
  id: string;
  /** Cómo se llama la bolsa en pantalla, para que el aviso se entienda. */
  etiqueta: string;
  pide: number;
  hay: number;
}

/**
 * Big bags que se están pidiendo por encima de lo que les queda.
 *
 * El formulario ya topa cada renglón contra el saldo, pero eso es la pantalla:
 * dos personas en dos navegadores ven el mismo saldo y cada una se lleva la
 * bolsa entera. Esta revisión corre contra lo que dice la base JUSTO ANTES de
 * crear la colada, que es el único momento en que el dato es cierto.
 */
export function bagsSobregirados(
  bags: readonly BigBagConsumido[] | null | undefined,
  peso: ReadonlyMap<string, number>,
  etiqueta: ReadonlyMap<string, string>,
  consumidoPorOtras: ReadonlyMap<string, number>,
): Sobregiro[] {
  const salida: Sobregiro[] = [];
  for (const [id, pide] of kgPorBag(bags)) {
    // Una bolsa que ya no está en el detallado (la borraron mientras tanto) no
    // tiene saldo que repartir: pedirle kilos es pedirle a algo que no existe.
    const total = round2(peso.get(id) ?? 0);
    const hay = round2(Math.max(0, total - (Number(consumidoPorOtras.get(id)) || 0)));
    // Un gramo de diferencia es redondeo, no un sobregiro.
    if (round2(pide) > round2(hay + 0.01)) {
      salida.push({ id, etiqueta: etiqueta.get(id) ?? 'Big bag', pide: round2(pide), hay });
    }
  }
  return salida;
}

/** El aviso que se le muestra al usuario cuando una bolsa no alcanza. */
export function textoSobregiro(lista: readonly Sobregiro[]): string {
  return lista
    .map((s) => `«${s.etiqueta}»: pedís ${s.pide} kg y quedan ${s.hay} kg`)
    .join(' · ');
}
