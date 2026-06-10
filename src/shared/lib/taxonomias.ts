import { supabase } from '@/shared/lib/supabase';

/** Scopes soportados. Si en el futuro se agregan, basta con incluir la cadena. */
export type Scope =
  | 'inventario.categoria'
  | 'inventario.unidad'
  | 'proveedor.categoria'
  | 'usuario.departamento'
  | 'usuario.cargo'
  | 'tesoreria.moneda';

const cache = new Map<Scope, Promise<string[]>>();

/**
 * Clave normalizada para comparar valores ignorando mayúsculas/minúsculas,
 * espacios sobrantes y puntos finales. Así "kg", "Kg." y "KG" son el mismo valor.
 */
export function claveTaxonomia(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
}

/** ¿Dos valores son el mismo ignorando mayúsculas/puntos? */
export function mismaTaxonomia(a: string, b: string): boolean {
  return claveTaxonomia(a) === claveTaxonomia(b);
}

async function fetchScope(scope: Scope): Promise<string[]> {
  const { data, error } = await supabase
    .from('taxonomias')
    .select('valor')
    .eq('scope', scope)
    .order('valor', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: { valor: string }) => r.valor).filter((v) => !!v);
}

/** Lee los valores extra para un scope, cacheados durante la sesión. */
export async function listTaxonomia(scope: Scope): Promise<string[]> {
  if (!cache.has(scope)) cache.set(scope, fetchScope(scope));
  try {
    return await cache.get(scope)!;
  } catch (e) {
    cache.delete(scope);
    throw e;
  }
}

/** Inserta un valor nuevo (idempotente vía UNIQUE en BD). Refresca cache. */
export async function addTaxonomia(scope: Scope, valor: string, actorEmail?: string): Promise<string | null> {
  const clean = valor.trim();
  if (!clean) return null;
  // Validación case-insensitive: si ya existe una variante (kg vs Kg.), devolvemos esa
  // en vez de crear un duplicado.
  try {
    const existentes = await listTaxonomia(scope);
    const ya = existentes.find((v) => mismaTaxonomia(v, clean));
    if (ya) return ya;
  } catch { /* sin cache disponible: seguimos al insert (la UNIQUE evita exactos) */ }
  const { error } = await supabase.from('taxonomias').insert({
    scope,
    valor: clean,
    created_by: actorEmail ?? null,
  });
  // Ignoramos error de unique violation (23505): valor ya existe → ok.
  if (error && !String(error.message ?? '').includes('duplicate key') && !String(error.code ?? '').includes('23505')) {
    throw error;
  }
  cache.delete(scope); // forzar refresh en próxima lectura
  return clean;
}

/** Limpia el cache de un scope (útil si se sabe que la BD cambió externamente). */
export function invalidateTaxonomia(scope: Scope): void {
  cache.delete(scope);
}

/**
 * Renombra un valor del catálogo. Inserta el nuevo (idempotente) y elimina el viejo.
 * No realiza cascada sobre las tablas dependientes — los repos de cada módulo
 * son responsables de actualizar `productos.categoria`, `proveedores.categorias`, etc.
 */
export async function renameTaxonomia(
  scope: Scope,
  oldValor: string,
  newValor: string,
  actorEmail?: string,
): Promise<void> {
  const oldClean = oldValor.trim();
  const newClean = newValor.trim();
  if (!oldClean || !newClean) throw new Error('Valores vacíos');
  if (oldClean === newClean) return;

  // Insert nuevo (si ya existe lo ignoramos)
  const { error: insErr } = await supabase.from('taxonomias').insert({
    scope,
    valor: newClean,
    created_by: actorEmail ?? null,
  });
  if (insErr && !String(insErr.message ?? '').includes('duplicate key') && !String(insErr.code ?? '').includes('23505')) {
    throw insErr;
  }

  // Eliminar el viejo (si no existía como fila no pasa nada).
  const { error: delErr } = await supabase
    .from('taxonomias')
    .delete()
    .eq('scope', scope)
    .eq('valor', oldClean);
  if (delErr) throw delErr;

  cache.delete(scope);
}

export async function deleteTaxonomia(scope: Scope, valor: string): Promise<void> {
  const { data, error } = await supabase
    .from('taxonomias')
    .delete()
    .eq('scope', scope)
    .eq('valor', valor.trim())
    .select('id');
  if (error) throw error;
  cache.delete(scope);
  // Si no se borró ninguna fila (RLS sin permiso, valor con espacios, ya no existía),
  // no fingimos éxito: avisamos para que el usuario no crea que se eliminó.
  if (!data || data.length === 0) {
    throw new Error('No se pudo eliminar: sin permiso o el valor ya no existía.');
  }
}
