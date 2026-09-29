/* ============================================================
   MGG · Cocina · a qué precio se valoriza el stock de un centro

   El problema: la tarjeta de cada cocina decía «Valor del stock» y lo calculaba
   con `productos.precio`, que es el promedio ponderado GLOBAL del producto —el
   de todos los almacenes juntos—. Para una cocina eso es un precio prestado: la
   salsa de tomate de Los Pinos está costeada a 13,29 y la tarjeta la valorizaba
   a 16,83, que es el promedio con los galones de Matanza y La Esperanza.

   Los dólares reales de un centro son los que ESE centro pagó, y eso vive en
   `existencias.costo_promedio`, por almacén. Acá se pondera ese costo con el
   stock de cada almacén del centro.

   El precio global queda de RESPALDO, no de fuente: sirve cuando la existencia
   todavía no tiene costo (una entrada sin precio, un producto recién creado).
   Valorizar en cero algo que está en el estante sería peor que usar un promedio.
   ============================================================ */

/** Lo que hace falta de cada existencia para ponderar. */
export interface ExistenciaCosteada {
  stock?: number | null;
  costo_promedio?: number | null;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * El costo unitario con el que se valoriza un víver dentro de un centro.
 *
 * Es el promedio ponderado por stock de los almacenes del centro, contando SOLO
 * los que tienen costo: una existencia costeada en 0 —un ajuste de cantidad sin
 * precio— arrastraría el promedio a la baja y haría desaparecer plata que sí se
 * pagó. Es el mismo criterio que usa `recomputeProductoAgg` para el precio
 * global, pero acotado al centro.
 *
 * Sin ninguna existencia costeada cae al `precioProducto` de respaldo.
 */
export function precioDelCentro(
  existencias: ExistenciaCosteada[],
  precioProducto?: number | null,
): number {
  let kilos = 0;
  let valor = 0;
  for (const e of existencias ?? []) {
    const costo = n(e.costo_promedio);
    if (costo <= 0) continue;
    const stock = n(e.stock);
    if (stock <= 0) continue;
    kilos += stock;
    valor += stock * costo;
  }
  if (kilos > 0) return Math.round((valor / kilos) * 100) / 100;

  // Sin stock costeado, pero puede haber una existencia con costo y sin stock
  // (el víver se acabó y su ficha conserva a cuánto salió): ese costo sigue
  // siendo el del centro y vale más que el promedio global.
  const conCosto = (existencias ?? []).map((e) => n(e.costo_promedio)).filter((c) => c > 0);
  if (conCosto.length) {
    return Math.round((conCosto.reduce((a, c) => a + c, 0) / conCosto.length) * 100) / 100;
  }
  return n(precioProducto);
}

/** El valor del stock de un centro: Σ stock × el costo de ese centro. */
export function valorDelCentro(
  existencias: ExistenciaCosteada[],
  precioProducto?: number | null,
): number {
  const precio = precioDelCentro(existencias, precioProducto);
  const stock = (existencias ?? []).reduce((a, e) => a + n(e.stock), 0);
  return Math.round(stock * precio * 100) / 100;
}
