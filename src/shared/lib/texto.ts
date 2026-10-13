/* ============================================================
   MGG · Comparar texto sin que el acento importe

   Para BUSCAR y COMPARAR, «camión» y «camion» son la misma palabra. Para
   GUARDAR y MOSTRAR, no: el dato conserva su acento. Estas funciones se usan
   solo del lado de la comparación; nunca para escribir en la base.
   Es la misma regla de `normalizarBusqueda` (buscar.ts), con el nombre corto
   que usa el módulo de Control de Maquinaria traído de Golden Touch (13-10).
   ============================================================ */
import { normalizarBusqueda } from './buscar';

/** Sin espacios de sobra, en minúscula y sin acentos. Acepta null/undefined → ''. */
export function norm(s: string | null | undefined): string {
  return normalizarBusqueda(s ?? '');
}

/** ¿El campo contiene lo buscado, sin importar acentos ni mayúsculas? Con `q` vacío, true. */
export function contiene(campo: string | null | undefined, buscado: string): boolean {
  const q = norm(buscado);
  if (!q) return true;
  return norm(campo).includes(q);
}

/** ¿Son la misma palabra ignorando acentos y mayúsculas? */
export function igual(a: string | null | undefined, b: string | null | undefined): boolean {
  return norm(a) === norm(b);
}
