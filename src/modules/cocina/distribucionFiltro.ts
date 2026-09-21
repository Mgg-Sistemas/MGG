/* ============================================================
   MGG · Cocina · Filtro del Control de distribución

   Las tarjetas de arriba (Víveres · Por reponer · En alerta · Consumido ·
   Mermas) no son solo un número: al tocarlas la tabla se queda con esos
   víveres. Acá vive la regla de qué entra en cada una, separada de la
   pantalla para poder probarla.
   ============================================================ */
import type { EstadoStock, ResumenDistribucion } from './distribucionEoq';

/** Cuál de las tarjetas está tocada. 'todos' = sin filtro. */
export type SeleccionKpi = 'todos' | 'reponer' | 'alerta' | 'consumido' | 'mermas';

/** ¿Este víver entra en la tarjeta elegida? */
export function coincideSeleccion(i: ResumenDistribucion, sel: SeleccionKpi): boolean {
  switch (sel) {
    case 'reponer': return i.estado === 'REORDENAR';
    case 'alerta': return i.estado === 'ALERTA';
    case 'consumido': return i.consumoTotal > 0;
    case 'mermas': return i.mermas > 0;
    case 'todos':
    default: return true;
  }
}

/** El orden de la tabla: primero lo urgente, después lo que más se consume. */
const peso = (e: EstadoStock) => (e === 'REORDENAR' ? 0 : e === 'ALERTA' ? 1 : 2);

export function ordenarDistribucion(items: ResumenDistribucion[]): ResumenDistribucion[] {
  return [...items].sort((a, b) =>
    peso(a.estado) - peso(b.estado)
    || b.consumoTotal - a.consumoTotal
    || a.nombre.localeCompare(b.nombre, 'es'));
}

export interface FiltroDistribucion {
  /** Texto libre: nombre o SKU. */
  q?: string;
  /** La tarjeta tocada. */
  seleccion?: SeleccionKpi;
  /** La casilla «Solo los que hay que reponer»: deja REORDENAR y ALERTA. */
  soloReponer?: boolean;
}

/** Los tres filtros se suman (y), y el resultado sale ordenado. */
export function filtrarDistribucion(items: ResumenDistribucion[], f: FiltroDistribucion = {}): ResumenDistribucion[] {
  const q = String(f.q ?? '').trim().toLowerCase();
  const sel = f.seleccion ?? 'todos';
  return ordenarDistribucion(items.filter((i) =>
    (!q || `${i.nombre} ${i.sku}`.toLowerCase().includes(q))
    && (!f.soloReponer || i.estado !== 'NORMAL')
    && coincideSeleccion(i, sel)));
}

/** Cómo se llama lo que se está viendo, para decirlo arriba de la tabla. */
export function etiquetaSeleccion(sel: SeleccionKpi): string {
  switch (sel) {
    case 'reponer': return 'Por reponer';
    case 'alerta': return 'En alerta';
    case 'consumido': return 'Con consumo en el ciclo';
    case 'mermas': return 'Con mermas';
    case 'todos':
    default: return 'Todos los víveres';
  }
}
