/* ============================================================
   MGG · Selector de CATEGORÍA de producto

   Lista buscable del catálogo de categorías de inventario (el mismo de
   Inventario → Categorías), que además deja escribir una categoría nueva si
   no existe. Lo usa la orden de servicio de Control de Maquinaria para dar de
   alta piezas nuevas (13-10), así no se teclea a mano una variante de algo que
   ya existe («REPUESTO» vs «REPUESTOS»).

   Formato: siempre en MAYÚSCULAS. La categoría nueva entra al catálogo recién
   al CREAR el producto, con `asegurarCategoria`.
   ============================================================ */
import { useEffect, useState } from 'react';
import { SearchCreateSelect } from '@/shared/ui/SearchSelect';
import { addCategoria, getCategorias } from './inventario.repository';

/** Mayúsculas, sin espacios de más. */
export function formatoCategoria(v: string): string {
  return v.replace(/\s+/g, ' ').trimStart().toUpperCase();
}

/** `true` si la categoría sirve: no vacía y no GENERAL (sin importar mayúsculas ni espacios). */
export function esCategoriaReal(categoria: string | null | undefined): boolean {
  const c = (categoria ?? '').trim().toLowerCase();
  return c !== '' && c !== 'general';
}

/**
 * Deja la categoría en el catálogo (si no estaba) y devuelve cómo quedó escrita.
 * Si el catálogo no se puede tocar (permisos, red), sigue con la tecleada.
 */
export async function asegurarCategoria(categoria: string, actorEmail?: string | null): Promise<string> {
  const limpia = formatoCategoria(categoria).trim();
  try {
    const canonica = await addCategoria(limpia, actorEmail ?? undefined);
    return canonica ?? limpia;
  } catch {
    return limpia;
  }
}

export function CategoriaProductoSelect({
  value, onChange, id, placeholder = '🔍 Categoría * (busca o escribe una nueva)', disabled,
}: {
  value: string;
  onChange: (categoria: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [opciones, setOpciones] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    getCategorias()
      .then((cs) => { if (vivo) setOpciones(cs.filter(esCategoriaReal)); })
      .catch(() => { if (vivo) setOpciones([]); });
    return () => { vivo = false; };
  }, []);

  return (
    <SearchCreateSelect
      id={id}
      options={opciones}
      value={value}
      onChange={(v) => onChange(formatoCategoria(v))}
      placeholder={placeholder}
      emptyText="Sin coincidencias: escribe el nombre para crearla"
      disabled={disabled}
    />
  );
}
