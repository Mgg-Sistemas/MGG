/* ============================================================
   MGG · Pedidos · El pie del cuadro de ítems de una OC

   El cuadro listaba los ítems y cerraba con «TOTAL», pero ese total
   es el de la orden (con IVA), no la suma de los renglones. En una
   OC con IVA la resta no cerraba: 19 ítems por $100,87 y un TOTAL
   de $117,68, sin nada que explicara los $16,81 de diferencia.

   Acá se arma el pie completo — subtotal, IVA, IGTF, descuento y
   total — pero SOLO cuando hace falta: si el total ya coincide con
   los renglones, una sola línea alcanza.
   ============================================================ */

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface ItemOc {
  cantidad?: number | null;
  precio?: number | null;
  /** `false` = está en la orden pero NO se compra: no suma. */
  comprar?: boolean;
}

export interface OrdenTotalizable {
  items?: ItemOc[] | null;
  total?: number | null;
  iva?: number | null;
  igtf?: number | null;
  descuento_obtenido?: number | null;
}

export interface LineaTotal {
  etiqueta: string;
  monto: number;
}

/** Σ cantidad × precio de los ítems que SÍ se compran. */
export function subtotalItems(items: ItemOc[] | null | undefined): number {
  return round2((items ?? []).reduce(
    (a, it) => (it?.comprar === false ? a : a + (Number(it?.cantidad) || 0) * (Number(it?.precio) || 0)),
    0,
  ));
}

/**
 * Las líneas del pie, de arriba hacia abajo.
 *
 * `etiquetaFinal` cambia entre una OC suelta («TOTAL») y una consolidada
 * («Subtotal OC-2026-0135»), donde el total general va aparte.
 */
export function lineasDeTotal(o: OrdenTotalizable, etiquetaFinal = 'TOTAL'): LineaTotal[] {
  const total = round2(o.total ?? 0);
  const sub = subtotalItems(o.items);
  const iva = round2(o.iva ?? 0);
  const igtf = round2(o.igtf ?? 0);
  const desc = round2(o.descuento_obtenido ?? 0);

  // Si el total ya es la suma de los renglones, desglosar sería ruido.
  if (Math.abs(total - sub) < 0.01) return [{ etiqueta: etiquetaFinal, monto: total }];

  const lineas: LineaTotal[] = [{ etiqueta: 'Subtotal ítems', monto: sub }];
  if (desc > 0) lineas.push({ etiqueta: 'Descuento', monto: -desc });
  if (iva > 0) lineas.push({ etiqueta: 'IVA', monto: iva });
  if (igtf > 0) lineas.push({ etiqueta: 'IGTF', monto: igtf });

  // Lo que ninguna de esas líneas explica. Se muestra en vez de esconderse:
  // un pie que no cierra es peor que uno que admite lo que no sabe.
  const explicado = round2(sub - desc + iva + igtf);
  const resto = round2(total - explicado);
  if (Math.abs(resto) >= 0.01) lineas.push({ etiqueta: 'Otros ajustes', monto: resto });

  lineas.push({ etiqueta: etiquetaFinal, monto: total });
  return lineas;
}
