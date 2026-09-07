/* ============================================================
   MGG · Inventario · «También en…» (presencia de un producto)
   Una ficha aparece en la lista de una sede solo si tiene FILA de
   existencia en alguno de sus almacenes. Cuando un material se va a
   manejar en dos sedes pero todavía no llegó el primer bulto, no hay
   forma de moverlo (no hay stock): hace falta sembrar la fila en cero.
   Acá se resuelve DÓNDE se puede sembrar.
   ============================================================ */
import { destinosDeTraslado } from './stockPorAlmacen';
import type { Almacen, Existencia } from '@/shared/lib/types';

type AlmacenDestino = Pick<Almacen, 'nombre' | 'sede' | 'parent_id' | 'estado'>;
type ExistenciaAlmacen = Pick<Existencia, 'almacen'>;

export interface OpcionPresencia {
  nombre: string;
  /** Ya tiene fila acá: se muestra marcado y no se vuelve a crear. */
  yaEsta: boolean;
}

/**
 * Los almacenes donde tiene sentido que figure una ficha, por sede: el PADRE de
 * cada una y sus almacenes de mineral. Los subalmacenes comunes (víveres,
 * papelería, combustible) dejaron de usarse, así que no se siembra en ellos.
 */
export function opcionesDePresencia(
  almacenes: AlmacenDestino[],
  existenciasDelProducto: ExistenciaAlmacen[],
): Array<[string, OpcionPresencia[]]> {
  const tiene = new Set(
    (existenciasDelProducto ?? []).map((e) => String(e.almacen ?? '').trim()).filter(Boolean),
  );
  return destinosDeTraslado(almacenes ?? []).map(([sede, destinos]) => [
    sede,
    destinos.map((d) => ({ nombre: d.nombre, yaEsta: tiene.has(d.nombre) })),
  ]);
}

/** Lo que el botón puede sembrar de verdad: los almacenes donde todavía no figura. */
export function almacenesFaltantes(
  almacenes: AlmacenDestino[],
  existenciasDelProducto: ExistenciaAlmacen[],
): string[] {
  return opcionesDePresencia(almacenes, existenciasDelProducto)
    .flatMap(([, opciones]) => opciones)
    .filter((o) => !o.yaEsta)
    .map((o) => o.nombre);
}
