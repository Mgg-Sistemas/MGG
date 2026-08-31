/* ============================================================
   MGG · Inventario · detectar productos duplicados al darlos de alta
   Cuando una sede necesita un material que YA existe en otra, lo que
   corresponde es cargarle stock al producto existente, no crear un SKU
   nuevo: una harina que está en Matanzas no tiene por qué volver a nacer
   para La Esperanza. Duplicar el SKU parte el kardex, parte el costo
   promedio y hace que los reportes de consumo no cuadren.

   `createProducto` no valida nada (un insert pelado), y en producción hay
   13 grupos duplicados: PINTURA EPOXICA GRIS ×3, DIESEL ×3, CASITERITA ×2
   con stock en las dos… Acá viven las piezas puras de la comparación: se
   testean sin base ni React.

   La decisión es ADVERTIR, no impedir: se muestran los parecidos con su
   stock por almacén y un botón para usar el existente, pero si el usuario
   insiste puede crearlo igual (hay materiales legítimamente parecidos).
   ============================================================ */

/** Palabras que no distinguen un material y solo ensucian la comparación. */
const RUIDO = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'CON', 'SIN', 'PARA', 'POR', 'A',
  'UND', 'UNIDAD', 'UNIDADES', 'KG', 'KGS', 'GR', 'GRS', 'LT', 'LTS', 'LITRO', 'LITROS',
  'ML', 'MTS', 'MT', 'METRO', 'METROS', 'PZA', 'PZAS', 'SACO', 'SACOS', 'BULTO', 'BULTOS',
]);

/**
 * Forma canónica de un nombre para compararlo: sin acentos, en mayúsculas,
 * sin signos y con los espacios colapsados. «Harina P.A.N.» y «HARINA PAN»
 * son el mismo material.
 */
export function normalizarNombre(nombre: string | null | undefined): string {
  return String(nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

/** Tokens significativos de un nombre (sin las palabras de ruido). */
export function tokensNombre(nombre: string | null | undefined): string[] {
  return normalizarNombre(nombre).split(' ').filter((t) => t.length > 1 && !RUIDO.has(t));
}

/** Lo mínimo que hace falta de un producto para compararlo. */
export interface ProductoComparable {
  id: string;
  sku: string;
  nombre: string;
  unidad?: string | null;
  categoria?: string | null;
  almacen?: string | null;
  estado?: string | null;
  nombre_busqueda?: string | null;
  marca?: string | null;
}

export type NivelParecido = 'exacto' | 'muy_parecido' | 'parecido';

export interface Duplicado<T extends ProductoComparable = ProductoComparable> {
  producto: T;
  nivel: NivelParecido;
  /** 0 a 1. 1 = el nombre normalizado es idéntico. */
  score: number;
}

/**
 * Parecido entre dos nombres: proporción de tokens significativos compartidos
 * sobre el nombre más corto. «HARINA DE TRIGO PAN» y «HARINA PAN» comparten
 * HARINA y PAN sobre 2 tokens del más corto → 1.
 */
export function parecidoNombre(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizarNombre(a);
  const nb = normalizarNombre(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokensNombre(a);
  const tb = tokensNombre(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const comunes = ta.filter((t) => setB.has(t)).length;
  return comunes / Math.min(ta.length, tb.length);
}

/** Umbral a partir del cual vale la pena avisar. */
const UMBRAL_AVISO = 0.6;

/**
 * Productos del catálogo que se parecen al nombre que se está escribiendo,
 * del más parecido al menos. Se comparan también `nombre_busqueda` y la marca,
 * porque el mismo material suele estar cargado con el nombre comercial en uno
 * y con el genérico en el otro.
 *
 * `excluirId` deja fuera al propio producto cuando se está editando.
 */
export function productosSimilares<T extends ProductoComparable>(
  nombre: string,
  productos: T[],
  opts: { excluirId?: string | null; limite?: number } = {},
): Duplicado<T>[] {
  const objetivo = normalizarNombre(nombre);
  if (objetivo.length < 3) return [];
  const limite = opts.limite ?? 5;

  const out: Duplicado<T>[] = [];
  for (const p of productos) {
    if (opts.excluirId && p.id === opts.excluirId) continue;
    // Un producto dado de baja igual cuenta: reactivarlo es mejor que duplicarlo.
    const score = Math.max(
      parecidoNombre(nombre, p.nombre),
      parecidoNombre(nombre, p.nombre_busqueda),
      p.marca ? parecidoNombre(nombre, `${p.marca} ${p.nombre}`) : 0,
    );
    if (score < UMBRAL_AVISO) continue;
    const nivel: NivelParecido = score >= 1 ? 'exacto' : score >= 0.8 ? 'muy_parecido' : 'parecido';
    out.push({ producto: p, nivel, score });
  }
  return out
    .sort((a, b) => b.score - a.score || a.producto.nombre.localeCompare(b.producto.nombre, 'es'))
    .slice(0, limite);
}

/** ¿Hay al menos un candidato con el nombre exactamente igual? */
export function hayExacto(dups: Duplicado[]): boolean {
  return dups.some((d) => d.nivel === 'exacto');
}
