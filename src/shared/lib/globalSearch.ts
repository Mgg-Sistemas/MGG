/* ============================================================
   MGG · Búsqueda global del sistema
   Busca en productos, proveedores y órdenes; devuelve una lista
   unificada con la ruta (vista + detalle) de cada resultado.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export type TipoResultado = 'producto' | 'proveedor' | 'orden' | 'usuario';

export interface ResultadoBusqueda {
  tipo: TipoResultado;
  id: string;
  titulo: string;
  subtitulo: string;
  /** Ruta a la vista correspondiente, abriendo el detalle del elemento. */
  ruta: string;
}

const ICONOS: Record<TipoResultado, string> = {
  producto: '⬢',
  proveedor: '⚒',
  orden: '✉',
  usuario: '👤',
};
export function iconoResultado(t: TipoResultado): string { return ICONOS[t]; }

const ETIQUETAS: Record<TipoResultado, string> = {
  producto: 'Producto',
  proveedor: 'Proveedor',
  orden: 'Orden',
  usuario: 'Usuario',
};
export function etiquetaResultado(t: TipoResultado): string { return ETIQUETAS[t]; }

/** Cuántos productos se ofrecen. Con familias grandes (seis vinagres) seis era poco. */
export const LIMITE_PRODUCTOS = 10;

/** Quita acentos y pasa a minúsculas, para comparar sin sorpresas. */
const clave = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Qué tan bien pega un resultado con lo que se escribió: primero el código exacto,
 * después el nombre exacto, después lo que EMPIEZA con el texto y al final lo que
 * solo lo contiene. Sin esto la lista salía en el orden de la base y «VINAGRE»
 * aparecía último entre seis vinagres.
 */
export function relevancia(titulo: string, codigo: string, busqueda: string): number {
  const q = clave(busqueda.trim());
  if (!q) return 4;
  const t = clave(titulo), c = clave(codigo);
  if (c === q) return 0;
  if (t === q) return 1;
  if (t.startsWith(q)) return 2;
  if (c.startsWith(q)) return 3;
  return 4;
}

export async function buscarGlobal(qRaw: string): Promise<ResultadoBusqueda[]> {
  // Sanitiza: las comas y % rompen la sintaxis de `.or`/ilike de PostgREST.
  const q = qRaw.trim().replace(/[%,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;

  const [prods, provs, ords, usrs] = await Promise.all([
    supabase.from('productos').select('id, sku, nombre, categoria')
      // Solo ACTIVOS: lo dado de baja no aparece en Inventario ni en los almacenes,
      // así que ofrecerlo acá manda a la gente a una ficha que no puede usar.
      .eq('estado', 'activo')
      .or(`nombre.ilike.${like},sku.ilike.${like}`)
      .order('nombre', { ascending: true })
      .limit(LIMITE_PRODUCTOS),
    supabase.from('proveedores').select('id, razon_social, rif')
      .or(`razon_social.ilike.${like},rif.ilike.${like}`).limit(6),
    supabase.from('ordenes').select('id, codigo, estado')
      .ilike('codigo', like).limit(6),
    // Usuarios: por RLS, un admin ve a todos; el resto solo su propia ficha.
    supabase.from('usuarios').select('id, nombre, email, role')
      .or(`nombre.ilike.${like},email.ilike.${like}`).limit(6),
  ]);

  const res: ResultadoBusqueda[] = [];
  ((prods.data ?? []) as { id: string; sku: string; nombre: string; categoria: string }[])
    .slice()
    .sort((a, b) => relevancia(a.nombre, a.sku, q) - relevancia(b.nombre, b.sku, q)
      || a.nombre.localeCompare(b.nombre, 'es'))
    .forEach((r) => {
      res.push({ tipo: 'producto', id: r.id, titulo: r.nombre, subtitulo: `${r.sku} · ${r.categoria}`, ruta: `/app/inventario?detalle=${encodeURIComponent(r.id)}` });
    });
  (provs.data ?? []).forEach((p) => {
    const r = p as { id: string; razon_social: string; rif: string };
    res.push({ tipo: 'proveedor', id: r.id, titulo: r.razon_social, subtitulo: r.rif, ruta: `/app/proveedores?detalle=${encodeURIComponent(r.id)}` });
  });
  (ords.data ?? []).forEach((o) => {
    const r = o as { id: string; codigo: string; estado: string };
    res.push({ tipo: 'orden', id: r.id, titulo: r.codigo, subtitulo: `Orden · ${r.estado}`, ruta: `/app/pedidos?detalle=${encodeURIComponent(r.id)}` });
  });
  (usrs.data ?? []).forEach((u) => {
    const r = u as { id: string; nombre: string | null; email: string; role: string | null };
    res.push({ tipo: 'usuario', id: r.id, titulo: r.nombre || r.email, subtitulo: [r.email, r.role].filter(Boolean).join(' · '), ruta: `/app/usuarios?buscar=${encodeURIComponent(r.nombre || r.email)}` });
  });
  return res;
}
