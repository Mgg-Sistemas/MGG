/* ============================================================
   MGG · Salidas · la entrega de comida a la cocina es un VALE, no un descuento

   Pasaba esto: el almacenista hacía la Salida de 400 salchichas «a COCINA» y
   el módulo de Alimentación las volvía a descontar plato por plato. La misma
   salchicha bajaba dos veces del mismo almacén (la cocina se surte del
   principal de la sede), y el mercado de la cocina no cuadraba nunca.

   Regla desde el 29-09-2026: lo que se COME lo descuenta únicamente
   Distribución de comidas. Una salida a la cocina con comestibles conserva
   el documento —nota de entrega, firma, correlativo—, pero no mueve stock.
   La limpieza sí sigue descontando por Salidas: ningún plato la consume.
   ============================================================ */
import { esComestible } from '@/modules/cocina/categoriasCocina';

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/** ¿El destino («unidad solicitante») es la cocina / el comedor? */
export function esDestinoCocina(destino?: string | null): boolean {
  const d = norm(destino ?? '');
  return d.includes('COCINA') || d.includes('COMEDOR');
}

/** ¿Este renglón lo descuenta la cocina al servirlo y NO la salida? */
export function laDescuentaLaCocina(destino: string | null | undefined, categoria: string | null | undefined): boolean {
  return esDestinoCocina(destino) && esComestible(categoria);
}

export interface RenglonConProducto { producto_id: string }

/**
 * Separa los renglones de una salida: los que bajan del almacén (`descuentan`)
 * y los que quedan como vale de entrega a la cocina (`valeCocina`).
 */
export function separarValeCocina<T extends RenglonConProducto>(
  lineas: readonly T[],
  destino: string | null | undefined,
  categoriaDe: (productoId: string) => string | null | undefined,
): { descuentan: T[]; valeCocina: T[] } {
  if (!esDestinoCocina(destino)) return { descuentan: [...lineas], valeCocina: [] };
  const descuentan: T[] = [];
  const valeCocina: T[] = [];
  for (const l of lineas) {
    if (esComestible(categoriaDe(l.producto_id))) valeCocina.push(l);
    else descuentan.push(l);
  }
  return { descuentan, valeCocina };
}


/* ── La comida que va a OTRA cocina es un traslado ─────────────────────────
   El 30-09-2026 Isner hizo la SAL-2026-0245 «a CENTRO DE ACOPIO LA
   ESPERANZA» con diez hortalizas. Es la cocina La Esperanza, que se surte de
   su propio almacén: como salida, la comida bajó de Los Pinos y no entró a
   ninguna parte, y los dos mercados quedaron descuadrados. Si el destino
   nombra a una cocina con OTRO almacén, lo comestible viaja a ese almacén. */

export interface CocinaDestino {
  nombre: string;
  almacen: string;
  /** La sede del almacén de la cocina (p. ej. «CENTRO DE ACOPIO - LA ESPERANZA»). */
  sede?: string | null;
}

const clave = (s: string | null | undefined): string => norm(s ?? '').replace(/[^A-Z0-9]/g, '');

/**
 * Las formas en que alguien escribe una cocina en el destino: su nombre, el de
 * su almacén, el de su sede, y el nombre sin artículo («ESPERANZA», «PINOS»).
 * Blindaje del 30-09-2026: con un solo texto, «COCINA ESPERANZA» no se
 * reconocía y la comida volvía a salir del inventario sin llegar a ninguno.
 */
export function clavesDeCocina(c: CocinaDestino): string[] {
  const claves = new Set<string>();
  for (const t of [c.nombre, c.almacen, c.sede]) {
    const k = clave(t);
    if (k.length >= 4) claves.add(k);
    const sinArticulo = clave(norm(t ?? '').replace(/^(LA|LAS|LOS|EL)\s+/, ''));
    if (sinArticulo.length >= 5) claves.add(sinArticulo);
  }
  return [...claves];
}

/** La cocina que nombra el destino o la sede destino, si hay una. */
export function cocinaDelDestino(
  destino: string | null | undefined,
  sedeDestino: string | null | undefined,
  cocinas: readonly CocinaDestino[],
): CocinaDestino | null {
  for (const texto of [destino, sedeDestino]) {
    const t = clave(texto);
    if (!t) continue;
    const c = cocinas.find((k) => clavesDeCocina(k).some((x) => t.includes(x)));
    if (c) return c;
  }
  return null;
}

/**
 * Reparte los renglones de una salida en tres: los que bajan del almacén, los que
 * son vale de la cocina de la sede y los que se trasladan al almacén de otra cocina.
 */
export function repartirEntregaCocina<T extends RenglonConProducto>(
  lineas: readonly T[],
  s: { destino?: string | null; sedeDestino?: string | null; almacenOrigen?: string | null },
  cocinas: readonly CocinaDestino[],
  categoriaDe: (productoId: string) => string | null | undefined,
): { descuentan: T[]; valeCocina: T[]; trasladan: T[]; cocina: CocinaDestino | null } {
  const cocina = cocinaDelDestino(s.destino, s.sedeDestino, cocinas);
  if (cocina && cocina.almacen !== (s.almacenOrigen ?? '')) {
    const descuentan: T[] = [];
    const trasladan: T[] = [];
    for (const l of lineas) (esComestible(categoriaDe(l.producto_id)) ? trasladan : descuentan).push(l);
    if (trasladan.length) return { descuentan, valeCocina: [], trasladan, cocina };
  }
  return { ...separarValeCocina(lineas, s.destino, categoriaDe), trasladan: [], cocina: null };
}
