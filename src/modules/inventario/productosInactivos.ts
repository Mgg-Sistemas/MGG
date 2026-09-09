import type { Producto } from '@/shared/lib/types';

/**
 * Productos dados de baja.
 *
 * Un producto inactivo NO EXISTE para el sistema: no está en el inventario, ni en
 * los almacenes, ni en el buscador, ni se puede pedir, mover ni consumir. Vive
 * solo acá, en su propia lista, hasta que alguien lo reactive. Este módulo es la
 * parte pensable de esa pantalla: qué se ve y cómo se filtra, sin tocar la red.
 */

export interface FiltroInactivos {
  /** Búsqueda libre por palabras sobre TODAS las características del producto. */
  texto: string;
  categoria: string;
  unidad: string;
  /** Último almacén donde estuvo (el de la ficha). */
  almacen: string;
  /** Correo de quien lo dio de baja. */
  porQuien: string;
  /** Rango de fecha de baja, en formato AAAA-MM-DD (los dos extremos incluidos). */
  desde: string;
  hasta: string;
}

export const FILTRO_VACIO: FiltroInactivos = {
  texto: '', categoria: '', unidad: '', almacen: '', porQuien: '', desde: '', hasta: '',
};

/** Todo lo que se puede escribir en el buscador y encontrar el producto. */
export function caracteristicas(p: Producto): string {
  return [
    p.sku, p.nombre, p.nombre_busqueda, p.marca, p.modelo, p.fabricante, p.color,
    p.codigo, p.serial, p.numero, p.presentacion, p.descripcion, p.ubicacion_fisica,
    p.categoria, p.unidad, p.almacen, p.desactivado_por, p.desactivado_motivo,
  ].filter(Boolean).map((s) => String(s).toLowerCase()).join(' ');
}

/** La fecha de baja recortada a AAAA-MM-DD, o vacío si esa baja no quedó registrada. */
export function diaDeBaja(p: Producto): string {
  return (p.desactivado_en ?? '').slice(0, 10);
}

/**
 * ¿Este producto pasa los filtros de la pantalla?
 *
 * El texto se parte en palabras y todas tienen que aparecer en alguna
 * característica, en cualquier orden: así "vinagre galon" encuentra el producto
 * aunque el nombre y la unidad estén en campos distintos.
 */
export function coincideInactivo(p: Producto, f: FiltroInactivos): boolean {
  if (f.categoria && p.categoria !== f.categoria) return false;
  if (f.unidad && p.unidad !== f.unidad) return false;
  if (f.almacen && (p.almacen || '') !== f.almacen) return false;
  if (f.porQuien && (p.desactivado_por ?? '') !== f.porQuien) return false;
  const dia = diaDeBaja(p);
  // Sin fecha registrada no se puede afirmar que caiga dentro del rango pedido.
  if ((f.desde || f.hasta) && !dia) return false;
  if (f.desde && dia < f.desde) return false;
  if (f.hasta && dia > f.hasta) return false;
  const q = f.texto.trim().toLowerCase();
  if (q) {
    const heno = caracteristicas(p);
    if (!q.split(/\s+/).filter(Boolean).every((t) => heno.includes(t))) return false;
  }
  return true;
}

/** Los inactivos, filtrados y ordenados: primero las bajas más recientes. */
export function inactivosFiltrados(productos: Producto[], f: FiltroInactivos): Producto[] {
  return productos
    .filter((p) => p.estado === 'inactivo' && coincideInactivo(p, f))
    .sort((a, b) => {
      const da = diaDeBaja(a), db = diaDeBaja(b);
      if (da !== db) return db.localeCompare(da); // sin fecha va al final
      return a.nombre.localeCompare(b.nombre, 'es');
    });
}

/** Valores presentes en los inactivos, para llenar cada desplegable sin opciones muertas. */
export function opcionesDe(productos: Producto[], campo: 'categoria' | 'unidad' | 'almacen' | 'desactivado_por'): string[] {
  const vistos = new Set<string>();
  for (const p of productos) {
    if (p.estado !== 'inactivo') continue;
    const v = String(p[campo] ?? '').trim();
    if (v) vistos.add(v);
  }
  return [...vistos].sort((a, b) => a.localeCompare(b, 'es'));
}
