import { supabase } from '@/shared/lib/supabase';
import type { EstadoGenerico, Orden, Proveedor } from '@/shared/lib/types';

export type ProveedorInput = Omit<Proveedor, 'id' | 'created_at' | 'updated_at'>;
export type ProveedorPatch = Partial<ProveedorInput>;

/** Categorías sugeridas por defecto. Las nuevas que el usuario añada quedan en
 *  localStorage y se mezclan con éstas + con las que ya existen en proveedores. */
export const CATEGORIAS_DEFAULT = [
  'Explosivos',
  'EPP',
  'Herramientas',
  'Maquinaria',
  'Lubricantes',
  'Reactivos',
  'Repuestos',
  'Logística',
  'Químicos',
] as const;

// Mantengo el nombre viejo como alias mutable de la lista en uso por defecto,
// pero el código debe llamar a `getCategorias()` para incluir las añadidas.
export const CATEGORIAS_PROV = CATEGORIAS_DEFAULT;

/* Catálogo compartido: persistido en Supabase (tabla `taxonomias`) +
   categorías ya presentes en proveedores. */
import { addTaxonomia, deleteTaxonomia, listTaxonomia, renameTaxonomia } from '@/shared/lib/taxonomias';

export async function getCategorias(fromProveedores: Proveedor[] = []): Promise<string[]> {
  const set = new Set<string>();
  try {
    const extras = await listTaxonomia('proveedor.categoria');
    extras.forEach((c) => set.add(c));
  } catch { /* falla silenciosa */ }
  fromProveedores.forEach((p) => (p.categorias ?? []).forEach((c) => c && set.add(c)));
  if (set.size === 0) CATEGORIAS_DEFAULT.forEach((c) => set.add(c));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

export async function addCategoria(nombre: string, actorEmail?: string): Promise<string | null> {
  return addTaxonomia('proveedor.categoria', nombre, actorEmail);
}

/**
 * Renombra una categoría de proveedor:
 *  · Actualiza la fila de `taxonomias`.
 *  · Re-etiqueta los elementos del arreglo `proveedores.categorias` vía RPC.
 *  Devuelve la cantidad de proveedores afectados.
 */
export async function renombrarCategoria(oldNombre: string, newNombre: string, actorEmail?: string): Promise<number> {
  const oldClean = oldNombre.trim();
  const newClean = newNombre.trim();
  if (!oldClean || !newClean) throw new Error('Nombres vacíos');
  if (oldClean === newClean) return 0;

  await renameTaxonomia('proveedor.categoria', oldClean, newClean, actorEmail);

  const { data, error } = await supabase.rpc('renombrar_categoria_proveedor', {
    p_old: oldClean,
    p_new: newClean,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function contarProveedoresPorCategoria(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('proveedores').select('categorias');
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { categorias: string[] | null }[]) {
    (row.categorias ?? []).forEach((c) => { if (c) out[c] = (out[c] ?? 0) + 1; });
  }
  return out;
}

export async function eliminarCategoria(nombre: string): Promise<void> {
  const counts = await contarProveedoresPorCategoria();
  if ((counts[nombre] ?? 0) > 0) {
    throw new Error(`No se puede eliminar: ${counts[nombre]} proveedor(es) usan esta categoría`);
  }
  await deleteTaxonomia('proveedor.categoria', nombre);
}

export async function list(): Promise<Proveedor[]> {
  const { data, error } = await supabase
    .from('proveedores')
    .select('*')
    .order('razon_social', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Proveedor[];
}

export async function getById(id: string): Promise<Proveedor | null> {
  const { data, error } = await supabase
    .from('proveedores')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return (data as Proveedor | null) ?? null;
}

/** Traduce el error de RIF duplicado (constraint único) a un mensaje claro. */
function traducirError(error: { code?: string; message?: string } | null): Error {
  if (error?.code === '23505') return new Error('Ya existe un proveedor con ese RIF.');
  return new Error(error?.message || 'No se pudo guardar el proveedor.');
}

export async function insert(payload: ProveedorInput): Promise<Proveedor> {
  const { data, error } = await supabase
    .from('proveedores')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw traducirError(error);
  return data as Proveedor;
}

/**
 * Alta rápida de proveedor (desde Compra Directa): razón social + RIF. Si ya existe
 * uno con ese RIF, lo devuelve (no duplica). Se crea con categorías vacías y origen
 * nacional por defecto; los demás datos se completan luego desde Proveedores.
 */
export async function crearProveedorRapido(razonSocial: string, rif: string): Promise<Proveedor> {
  const nombre = razonSocial.trim();
  const r = rif.trim().toUpperCase();
  if (!nombre) throw new Error('Indicá la razón social del proveedor.');
  if (!r) throw new Error('Indicá el RIF del proveedor.');
  const { data: existente } = await supabase.from('proveedores').select('*').eq('rif', r).maybeSingle();
  if (existente) return existente as Proveedor;
  return insert({
    rif: r, razon_social: nombre, categorias: [], origen: 'nacional', estado: 'activo',
    contacto: null, telefono: null, email: null, direccion: null,
  } as ProveedorInput);
}

export async function update(id: string, patch: ProveedorPatch): Promise<Proveedor> {
  const { data, error } = await supabase
    .from('proveedores')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw traducirError(error);
  return data as Proveedor;
}

export async function toggleEstado(id: string, estado: EstadoGenerico): Promise<Proveedor> {
  return update(id, { estado });
}

/**
 * Histórico de órdenes de un proveedor. Se ordena por fecha desc para que el
 * detalle muestre primero lo más reciente. El conteo de "recibidas" se calcula
 * en el caller para evitar un segundo round-trip.
 */
export async function getOrdenesByProveedor(proveedorId: string): Promise<Orden[]> {
  const { data, error } = await supabase
    .from('ordenes')
    .select('*')
    .eq('proveedor_id', proveedorId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Orden[];
}
