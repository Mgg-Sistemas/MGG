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

   REGLA BLINDADA (30-09-2026): por Salidas NO se descuenta ni se traslada NADA
   que sea de una categoría de comida, vaya a donde vaya. La SAL-2026-0247
   «mercado completo de La Esperanza» repitió el reparto TRA-2026-0011 que ya
   había llevado ese mismo mercado desde Alimentación, y la comida se movió dos
   veces. La comida se mueve solo desde Alimentación (distribución a otra
   cocina / resguardo) y se consume plato por plato; la salida queda como
   documento. La base lo impide también (trigger mgg_guardia_comida_a_cocina).

   Y (30-09, SAL-2026-0248): en LOS PINOS y LA ESPERANZA todo lo de Alimentación
   —comida Y limpieza— sale por CONSUMO desde el módulo de Alimentación, nunca
   por Salidas. El RESGUARDO de Matanzas no entra en esta regla: ahí la salida
   descuenta normal (es un depósito que despacha, no una cocina que sirve).
   ============================================================ */
import { esCategoriaCocina } from '@/modules/cocina/categoriasCocina';

/** ¿La sede es la del resguardo (Matanzas)? Ahí las salidas sí descuentan. */
export const esSedeResguardoSalida = (sede?: string | null): boolean => /matanza/i.test(sede ?? '');

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/** ¿El destino («unidad solicitante») es la cocina / el comedor? */
export function esDestinoCocina(destino?: string | null): boolean {
  const d = norm(destino ?? '');
  return d.includes('COCINA') || d.includes('COMEDOR');
}

/** ¿Este renglón lo descuenta la cocina al servirlo y NO la salida? */
export function laDescuentaLaCocina(_destino: string | null | undefined, categoria: string | null | undefined, sedeOrigen?: string | null): boolean {
  return !esSedeResguardoSalida(sedeOrigen) && esCategoriaCocina(categoria);
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
  sedeOrigen?: string | null,
): { descuentan: T[]; valeCocina: T[] } {
  void destino; // desde el 30-09 no importa el destino: importa de dónde sale
  const descuentan: T[] = [];
  const valeCocina: T[] = [];
  if (esSedeResguardoSalida(sedeOrigen)) return { descuentan: [...lineas], valeCocina };
  for (const l of lineas) {
    if (esCategoriaCocina(categoriaDe(l.producto_id))) valeCocina.push(l);
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
  s: { destino?: string | null; sedeDestino?: string | null; almacenOrigen?: string | null; sedeOrigen?: string | null },
  cocinas: readonly CocinaDestino[],
  categoriaDe: (productoId: string) => string | null | undefined,
): { descuentan: T[]; valeCocina: T[]; trasladan: T[]; cocina: CocinaDestino | null } {
  // Desde el 30-09 la comida ya no viaja por Salidas (ni como traslado): es vale.
  // La cocina del destino se sigue reconociendo solo para el texto del documento.
  const cocina = cocinaDelDestino(s.destino, s.sedeDestino, cocinas);
  return { ...separarValeCocina(lineas, s.destino, categoriaDe, s.sedeOrigen), trasladan: [], cocina };
}
