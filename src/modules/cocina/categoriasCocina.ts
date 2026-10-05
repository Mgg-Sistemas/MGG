/* ============================================================
   MGG · Cocina · qué categorías del inventario surten la cocina

   Una sola lista para todo el sistema: la usan el módulo de Alimentación
   (qué se puede repartir, qué entra al mercado), el Resumen detallado y,
   desde el 29-09-2026, el módulo de Salidas para saber qué NO debe
   descontar cuando va a la cocina (ver `entregaACocina.ts`).

   Se separa lo que se COME de lo que se usa para LIMPIAR: los platos
   consumen lo primero; lo segundo se gasta igual, pero nadie lo sirve.

   Desde el 05-10-2026 la lista se GESTIONA desde Alimentación (🏷 Categorías)
   y vive en la tabla `categorias_cocina`. La base la lee también: la guardia
   de Salidas (`mgg_guardia_comida_a_cocina`) usa la misma tabla, así que
   front y base nunca opinan distinto. Las listas de abajo son solo el
   respaldo mientras la tabla carga (o si no se puede leer).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

/** Lo que va en un plato o en un vaso: lo descuenta Distribución de comidas. */
export const CATEGORIAS_COMESTIBLES = [
  'VIVERES',
  'ALIMENTOS',
  'CARNES',
  'PROTEINA',
  'HORTALIZAS Y LEGUMBRES',
  'VERDURAS',
  'FRUTAS',
  'JUGOS',
  'BEBIDAS',
  'LACTEOS',
  'HUEVOS',
  'EMBUTIDOS',
  'CHARCUTERIA',
  'PESCADOS',
  'MARISCOS',
  'PANADERIA',
  'GRANOS',
  'CEREALES',
  'CONDIMENTOS',
  'ESPECIAS',
  'DULCES',
  'POSTRES',
];

/** Lo que se gasta en la cocina pero no se sirve: sale por Salidas, como siempre. */
export const CATEGORIAS_LIMPIEZA_COCINA = [
  'LIMPIEZA',
  'MATERIAL DE LIMPIEZA',
];

/** Todo lo que surte la distribución de comida (comestibles + limpieza). */
export const CATEGORIAS_COCINA = [...CATEGORIAS_COMESTIBLES, ...CATEGORIAS_LIMPIEZA_COCINA];

export type TipoCategoriaCocina = 'comestible' | 'limpieza';

/** Una fila de la tabla `categorias_cocina`. */
export interface CategoriaCocina {
  categoria: string;
  tipo: TipoCategoriaCocina;
  activa: boolean;
  actualizado_por?: string | null;
  updated_at?: string | null;
}

/**
 * Sin tildes, sin espacios de más, en mayúsculas y SIN la S final: el
 * 16/09/2026 el POLLO BENEFICIADO llegó con categoría «PROTEINAS» y Cocina
 * no lo veía en ninguna lista. «FRUTA» y «FRUTAS» son la misma cosa.
 * Es la misma regla que `mgg_norm_categoria` en la base.
 */
export const normCategoriaCocina = (s: string): string => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .trim().toUpperCase().replace(/\s+/g, ' ').replace(/S$/, '');

/* La lista vigente (normalizada). Arranca con el respaldo y se reemplaza al leer la tabla. */
let comestibles = new Set(CATEGORIAS_COMESTIBLES.map(normCategoriaCocina));
let todas = new Set(CATEGORIAS_COCINA.map(normCategoriaCocina));
let cargada: Promise<void> | null = null;

/** Aplica una lista leída de la tabla (solo las activas cuentan). */
export function aplicarCategoriasCocina(filas: CategoriaCocina[]): void {
  const activas = filas.filter((f) => f.activa);
  comestibles = new Set(activas.filter((f) => f.tipo === 'comestible').map((f) => normCategoriaCocina(f.categoria)));
  todas = new Set(activas.map((f) => normCategoriaCocina(f.categoria)));
}

/** Todas las filas de la tabla (activas e inactivas), para gestionarlas. */
export async function listCategoriasCocina(): Promise<CategoriaCocina[]> {
  const { data, error } = await supabase.from('categorias_cocina')
    .select('categoria, tipo, activa, actualizado_por, updated_at').order('categoria');
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoriaCocina[];
}

/** Vuelve a leer la lista de la base (después de gestionarla o por realtime). */
export async function recargarCategoriasCocina(): Promise<void> {
  cargada = listCategoriasCocina()
    .then(aplicarCategoriasCocina)
    .catch((e) => { cargada = null; console.error('No se pudieron leer las categorías de Cocina:', e); });
  return cargada;
}

/** La lee una vez por sesión; las siguientes llamadas no viajan a la base. */
export function asegurarCategoriasCocina(): Promise<void> {
  return cargada ?? recargarCategoriasCocina();
}

/** ¿La categoría de un producto surte la distribución de comida? */
export function esCategoriaCocina(cat?: string | null): boolean {
  const c = normCategoriaCocina(cat ?? '');
  return !!c && todas.has(c);
}

/** ¿Es algo que se come o se bebe? (lo descuenta Distribución de comidas, no Salidas). */
export function esComestible(cat?: string | null): boolean {
  const c = normCategoriaCocina(cat ?? '');
  return !!c && comestibles.has(c);
}

/* ───── Gestión (🏷 Categorías en Alimentación) ───── */

export async function guardarCategoriaCocina(
  fila: { categoria: string; tipo: TipoCategoriaCocina; activa: boolean },
  actor: string,
): Promise<void> {
  const categoria = fila.categoria.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!categoria) throw new Error('Escribí el nombre de la categoría.');
  const { error } = await supabase.from('categorias_cocina').upsert(
    { categoria, tipo: fila.tipo, activa: fila.activa, actualizado_por: actor, updated_at: new Date().toISOString() },
    { onConflict: 'categoria' },
  );
  if (error) throw new Error(error.message);
  await recargarCategoriasCocina();
}

export async function quitarCategoriaCocina(categoria: string): Promise<void> {
  const { error } = await supabase.from('categorias_cocina').delete().eq('categoria', categoria);
  if (error) throw new Error(error.message);
  await recargarCategoriasCocina();
}
