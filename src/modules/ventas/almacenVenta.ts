/* ============================================================
   MGG · Ventas · De qué almacén sale la factura
   Una factura se despacha desde UN almacén. Arranca en el padre de
   Matanza; si el material está en otra sede se elige otro, pero SOLO
   los padres y los almacenes de mineral (la casiterita y el estaño
   viven en un subalmacén propio: sin ellos no se podría vender).
   ============================================================ */
import {
  almacenPrincipalDeSede, destinosDeTraslado, type DestinoAlmacen,
} from '@/modules/inventario/stockPorAlmacen';
import type { Almacen, Existencia, Producto } from '@/shared/lib/types';

/** Sede desde la que se despacha mientras nadie elija otra cosa. */
export const SEDE_VENTA_POR_DEFECTO = 'CENTRO DE FUNDICION - MATANZAS';

type AlmacenDestino = Pick<Almacen, 'nombre' | 'sede' | 'parent_id' | 'estado'>;
type ExistenciaStock = Pick<Existencia, 'producto_id' | 'almacen' | 'stock'> & { costo_promedio?: number | null };

/** Los almacenes elegibles, agrupados por sede: el padre primero y sus minerales. */
export function almacenesDeVenta(almacenes: AlmacenDestino[]): Array<[string, DestinoAlmacen[]]> {
  return destinosDeTraslado(almacenes ?? []);
}

/**
 * Almacén con el que abre una factura nueva: el padre de Matanza. Si esa sede
 * no existe o se quedó sin almacén activo, cae al primer destino de la lista
 * en vez de dejar el desplegable en blanco.
 */
export function almacenVentaInicial(almacenes: AlmacenDestino[]): string {
  const activos = (almacenes ?? []).filter((a) => a.estado === 'activo');
  const matanza = almacenPrincipalDeSede(SEDE_VENTA_POR_DEFECTO, activos);
  if (matanza) return matanza;
  return almacenesDeVenta(almacenes)[0]?.[1][0]?.nombre ?? '';
}

/** Stock y costo (PMP) de un producto EN ESE almacén. Sin fila = 0. */
export function existenciaEn(
  existencias: ExistenciaStock[], productoId: string | null | undefined, almacen: string,
): { stock: number; costo: number } {
  const alm = String(almacen ?? '').trim();
  const e = (existencias ?? []).find(
    (x) => x.producto_id === productoId && String(x.almacen ?? '').trim() === alm,
  );
  return { stock: Number(e?.stock) || 0, costo: Number(e?.costo_promedio) || 0 };
}

/**
 * Lo que se puede vender desde un almacén: fichas ACTIVAS con stock ahí.
 * Las inactivas quedaban a la vista (92 fichas, varias de prueba) porque
 * `listProductos` trae la tabla entera y Ventas no filtraba nada.
 */
export function productosVendibles<P extends Pick<Producto, 'id' | 'estado'>>(
  productos: P[], existencias: ExistenciaStock[], almacen: string,
): P[] {
  const alm = String(almacen ?? '').trim();
  if (!alm) return [];
  const conStock = new Set(
    (existencias ?? [])
      .filter((e) => String(e.almacen ?? '').trim() === alm && (Number(e.stock) || 0) > 0)
      .map((e) => e.producto_id),
  );
  return (productos ?? []).filter((p) => p.estado === 'activo' && conStock.has(p.id));
}
