/* ============================================================
   Golden Touch · Retenciones · Impuestos visibles en las vistas

   Las tarjetas (resumen por impuesto), los filtros y las columnas por factura
   salen de los impuestos ACTIVOS de la tabla (Parámetros › Impuestos), no de una
   lista fija: un impuesto deshabilitado desaparece de todas ellas.

   Lógica pura, sin React ni base: `RetencionesPage` arma `ImpuestosActivos` con
   las claves activas (y su orden) y estas funciones filtran las listas fijas.
   Si no hay datos (no se pudo leer o la tabla está vacía) se pasa `null` y se usa
   la lista fija completa: degradación segura, la pantalla no se rompe.
   ============================================================ */
import type { DireccionRetencion, FormatoSerie, TipoImpuesto } from '@/modules/libroFiscal/retencionesCalculo';

/** Las claves de impuesto activas y su orden en la tabla. */
export interface ImpuestosActivos {
  claves: Set<TipoImpuesto>;
  orden: Map<string, number>;
}

/**
 * Lo que la ficha de un impuesto dice para las vistas de registro: qué
 * direcciones admite y el formato de su serie. Sale de `retencion_impuestos`.
 */
export interface FichaRetencionVista {
  admitePracticada: boolean;
  admiteSufrida: boolean;
  serieFormato: FormatoSerie | null;
  numera: boolean;
}

/**
 * ¿La ficha admite esa dirección? `practicada` mira `admitePracticada`;
 * `recibida` (sufrida), `admiteSufrida`. Sin ficha (`undefined`), admite las dos:
 * degradación segura, igual que hoy, cuando no se pudo leer la tabla.
 */
export function admiteDireccion(ficha: FichaRetencionVista | undefined, direccion: DireccionRetencion): boolean {
  if (!ficha) return true;
  return direccion === 'practicada' ? ficha.admitePracticada : ficha.admiteSufrida;
}

/**
 * Deja de una lista fija solo los impuestos activos, en el orden de la tabla.
 * Sin datos (`null`), devuelve la lista completa tal cual.
 */
export function soloImpuestosActivos<K extends TipoImpuesto, T extends { key: K }>(
  fijos: readonly T[],
  activos: ImpuestosActivos | null,
): T[] {
  if (!activos) return [...fijos];
  return fijos
    .filter((t) => activos.claves.has(t.key))
    .sort((a, b) => (activos.orden.get(a.key) ?? 0) - (activos.orden.get(b.key) ?? 0));
}

/** Quita de una lista de claves las que estén deshabilitadas. Sin datos, la lista tal cual. */
export function filtrarActivos<K extends TipoImpuesto>(keys: readonly K[], activos: ImpuestosActivos | null): K[] {
  return activos ? keys.filter((k) => activos.claves.has(k)) : [...keys];
}
