/* ============================================================
   MGG · Compras · «Se guarda en inventario como» (29-10-2026)

   Con el flujo de revisión de almacén prendido, la Solicitud de Pedido
   puede traer renglones con NOMBRE GENERAL (`general: true`, SKU GEN-…,
   sin `productoId`): todavía no tienen ficha de inventario. La regla de
   la administradora: «cuando se carguen las cotizaciones de los
   proveedores, es allí que se colocarán los nombres con los cuales se
   guardará en inventario; desde compras se pueden dejar como vienen de
   la SP o cambiarlos».

   Acá vive la regla pura (sin base) que usa AgregarOfertaModal:
     · «Dejar como viene» (por defecto): el renglón ligado a una ficha
       queda igual; el general se guarda con el nombre de la SP.
     · «Elegir del inventario»: se liga a esa ficha.
     · «Escribir otro nombre»: ficha con ese nombre.
   Un nombre que hace falta y ya existe en el inventario (igual, sin
   importar mayúsculas ni espacios) REUSA esa ficha; si no existe se crea
   una, con categoría obligatoria (nunca GENERAL) y unidad.

   NUNCA se renombra una ficha existente: cambiar el nombre de un renglón
   ligado lo RE-LIGA a otra ficha (existente o nueva). El SKU del renglón
   no cambia: oferta ↔ orden se casan por SKU.
   ============================================================ */
import type { ItemOrden, Producto } from '@/shared/lib/types';

export type ModoNombreInventario = 'como_viene' | 'existente' | 'nuevo';

/** Lo que el analista eligió para un renglón. */
export interface EleccionNombreInventario {
  modo: ModoNombreInventario;
  /** Ficha elegida (modo «existente»). */
  productoId?: string | null;
  /** Nombre escrito (modo «nuevo»). */
  nombre?: string | null;
  /** Para la ficha nueva: categoría (obligatoria, no GENERAL) y unidad. */
  categoria?: string | null;
  unidad?: string | null;
}

/** Lo mínimo de una ficha que hace falta acá. */
export type FichaMin = Pick<Producto, 'id' | 'nombre' | 'sku' | 'unidad'> & { estado?: string | null };

/** Qué pasa con el renglón al guardar la cotización. */
export type DestinoRenglon =
  /** Queda tal cual (ya está ligado a su ficha y no se cambió). */
  | { tipo: 'igual' }
  /** Se liga a esta ficha que ya existe. */
  | { tipo: 'ficha'; ficha: FichaMin }
  /** Hay que crear la ficha. `falta` = qué dato falta para poder crearla. */
  | { tipo: 'crear'; nombre: string; categoria: string; unidad: string; falta: string | null }
  /** No se puede resolver todavía (falta elegir el producto o escribir el nombre). */
  | { tipo: 'incompleto'; falta: string };

/** Nombre con el que se compara y se guarda: sin espacios de más y en MAYÚSCULAS. */
export function nombreFicha(nombre: string | null | undefined): string {
  return String(nombre ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** `true` si la categoría sirve para una ficha: no vacía y no GENERAL. */
export function categoriaValida(categoria: string | null | undefined): boolean {
  const c = nombreFicha(categoria);
  return c !== '' && c !== 'GENERAL';
}

/** Ficha ACTIVA con exactamente ese nombre (sin importar mayúsculas ni espacios). */
export function fichaPorNombre<T extends FichaMin>(nombre: string, fichas: T[]): T | null {
  const k = nombreFicha(nombre);
  if (!k) return null;
  return fichas.find((p) => (p.estado ?? 'activo') === 'activo' && nombreFicha(p.nombre) === k) ?? null;
}

/** El nombre que trae el renglón desde la SP: el de su ficha si está ligado, si no el escrito. */
export function nombreQueViene(it: Pick<ItemOrden, 'nombre' | 'productoId'>, porId: Map<string, FichaMin>): string {
  const p = it.productoId ? porId.get(it.productoId) : undefined;
  return p?.nombre ?? it.nombre ?? '';
}

/** Elección por defecto: dejar como viene, con la unidad del renglón para la ficha nueva. */
export function eleccionInicial(it: Pick<ItemOrden, 'unidad'>): EleccionNombreInventario {
  return { modo: 'como_viene', unidad: it.unidad ?? null };
}

function crearOFicha(
  nombre: string, it: Pick<ItemOrden, 'unidad' | 'productoId'>, e: EleccionNombreInventario | undefined, fichas: FichaMin[],
): DestinoRenglon {
  const n = nombreFicha(nombre);
  const existe = fichaPorNombre(n, fichas);
  if (existe) return existe.id === it.productoId ? { tipo: 'igual' } : { tipo: 'ficha', ficha: existe };
  const categoria = nombreFicha(e?.categoria);
  const unidad = String(e?.unidad ?? it.unidad ?? '').trim();
  const falta = !categoriaValida(categoria)
    ? 'elegí la categoría de la ficha nueva (no puede ser GENERAL)'
    : !unidad ? 'elegí la unidad de la ficha nueva' : null;
  return { tipo: 'crear', nombre: n, categoria, unidad, falta };
}

/**
 * Qué pasa con un renglón según lo elegido. `fichas` = las fichas ACTIVAS del inventario
 * (y las que se crearon en esta pantalla).
 */
export function destinoRenglon(
  it: Pick<ItemOrden, 'nombre' | 'productoId' | 'unidad'>,
  e: EleccionNombreInventario | undefined,
  fichas: FichaMin[],
): DestinoRenglon {
  const modo = e?.modo ?? 'como_viene';
  if (modo === 'existente') {
    const p = e?.productoId ? fichas.find((f) => f.id === e.productoId) : undefined;
    if (!p) return { tipo: 'incompleto', falta: 'elegí el producto del inventario' };
    return p.id === it.productoId ? { tipo: 'igual' } : { tipo: 'ficha', ficha: p };
  }
  if (modo === 'nuevo') {
    if (!nombreFicha(e?.nombre)) return { tipo: 'incompleto', falta: 'escribí el nombre con el que se guarda en inventario' };
    return crearOFicha(e?.nombre ?? '', it, e, fichas);
  }
  // Dejar como viene: el renglón ligado no se toca; el general necesita su ficha.
  if (it.productoId) return { tipo: 'igual' };
  if (!nombreFicha(it.nombre)) return { tipo: 'incompleto', falta: 'el renglón no trae nombre: escribí uno' };
  return crearOFicha(it.nombre, it, e, fichas);
}

/** Una ficha por crear, con los renglones (por índice) que la usan. */
export interface FichaPorCrear {
  nombre: string;
  categoria: string;
  unidad: string;
  indices: number[];
}

export interface PlanFichas {
  destinos: DestinoRenglon[];
  /** Fichas nuevas, UNA por nombre aunque varios renglones (o variantes) la usen. */
  crear: FichaPorCrear[];
  /** Primer problema que impide guardar, ya redactado; null si todo está resuelto. */
  error: string | null;
}

/** Arma el plan de toda la cotización: qué se liga, qué se crea y qué falta. */
export function planFichas(
  renglones: Array<{ item: Pick<ItemOrden, 'nombre' | 'productoId' | 'unidad'>; eleccion?: EleccionNombreInventario }>,
  fichas: FichaMin[],
): PlanFichas {
  const destinos = renglones.map((r) => destinoRenglon(r.item, r.eleccion, fichas));
  const porNombre = new Map<string, FichaPorCrear>();
  let error: string | null = null;
  destinos.forEach((d, i) => {
    const nombre = renglones[i].item.nombre ?? '';
    if (d.tipo === 'incompleto') { if (!error) error = `«${nombre}»: ${d.falta}.`; return; }
    if (d.tipo !== 'crear') return;
    const previa = porNombre.get(d.nombre);
    if (previa) {
      // Mismo nombre en dos renglones: una sola ficha. Vale la primera categoría que se cargó.
      previa.indices.push(i);
      if (!categoriaValida(previa.categoria) && categoriaValida(d.categoria)) previa.categoria = d.categoria;
      if (!previa.unidad && d.unidad) previa.unidad = d.unidad;
      return;
    }
    porNombre.set(d.nombre, { nombre: d.nombre, categoria: d.categoria, unidad: d.unidad, indices: [i] });
  });
  const crear = [...porNombre.values()];
  if (!error) {
    const mal = crear.find((c) => !categoriaValida(c.categoria) || !c.unidad);
    if (mal) error = `«${mal.nombre}»: ${!categoriaValida(mal.categoria) ? 'elegí la categoría de la ficha nueva (no puede ser GENERAL)' : 'elegí la unidad de la ficha nueva'}.`;
  }
  return { destinos, crear, error };
}

/** Liga el renglón a la ficha: productoId, nombre y unidad de la ficha; el SKU NO cambia. */
export function aplicarFicha<T extends ItemOrden>(it: T, ficha: FichaMin): T {
  return { ...it, productoId: ficha.id, nombre: ficha.nombre, unidad: ficha.unidad || it.unidad };
}

/* ───────── Recepción: ningún renglón entra sin ficha ───────── */

/** Renglones que se están recibiendo (cantidad > 0) y no tienen ficha de inventario. */
export function renglonesSinFicha<T extends Pick<ItemOrden, 'sku' | 'nombre' | 'productoId'>>(
  items: T[], recibido: Map<string, number>,
): T[] {
  return (items ?? []).filter((it) => !it.productoId && (Number(recibido.get(it.sku)) || 0) > 0);
}

/** El error que frena la recepción, o null si todos los renglones recibidos tienen ficha. */
export function errorRenglonesSinFicha(
  items: Array<Pick<ItemOrden, 'sku' | 'nombre' | 'productoId'>>, recibido: Map<string, number>,
): string | null {
  const sin = renglonesSinFicha(items, recibido);
  if (!sin.length) return null;
  const nombres = sin.map((it) => `"${(it.nombre ?? '').trim() || it.sku}"`).join(', ');
  return `${nombres} no ${sin.length === 1 ? 'tiene' : 'tienen'} ficha de inventario: fijá con qué nombre se guarda (en la cotización o editando la OC) antes de recibir.`;
}
