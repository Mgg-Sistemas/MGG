/* ============================================================
   MGG · La escoria vuelve al inventario

   Ni la fundición ni la refinación producen solo estaño: las dos dejan
   ESCORIA, que no es basura — se vuelve a fundir. Por eso entra al
   inventario como materia prima y queda disponible como insumo de
   receta, igual que el coque o la caliza.

   Entra SIN COSTO: lo que costó el proceso ya está cargado en el estaño
   obtenido, y repartirlo entre los dos sería inventar un reparto. Queda
   en la cola «⚠ Sin costo» del inventario para que alguien le ponga
   precio con criterio.

   Son DOS fichas distintas, no una. La escoria de horno y el dross de
   olla tienen leyes de Sn muy distintas, y el reporte de recuperación de
   Matanzas lee la escoria por ciclo para calcular cuánto estaño queda
   por rescatar: mezclarlas en una sola ficha le daría una ley promedio
   que no es la de ninguna de las dos.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { createProducto, siguienteSkuLibre } from '@/modules/inventario/inventario.repository';
import type { Producto } from '@/shared/lib/types';

/** Ficha del inventario donde entra la escoria del HORNO (fundición). */
export const NOMBRE_ESCORIA = 'ESCOREA DE FUNDICION';

/** Ficha del inventario donde entra el dross / escoria de la OLLA (refinación). */
export const NOMBRE_ESCORIA_REFINACION = 'ESCOREA DE REFINACION';

/** Categoría con la que viven en el inventario (la misma que la casiterita). */
export const CATEGORIA_ESCORIA = 'MINERALES';

/** Unidad en la que se pesa. */
export const UNIDAD_ESCORIA = 'KILOGRAMO';

/** Almacén de la planta donde queda: Matanza entra al bucket «General». */
export const ALMACEN_ESCORIA = 'General';

/**
 * Kg de escoria que entran al inventario por un proceso.
 *
 * Devuelve 0 cuando no hay nada que ingresar: sin dato, en cero, negativo o
 * ilegible. Cero significa «no muevas el inventario», no «registra una entrada
 * vacía»: un movimiento de 0 kg ensucia el kardex sin decir nada.
 */
export function kgDeEscoria(escoriaKg: number | null | undefined): number {
  const n = Number(escoriaKg);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1000) / 1000;
}

/**
 * ¿Este proceso tiene que ingresar su escoria?
 *
 * No lo hace si la orden está marcada para no sumar al inventario: en ese caso
 * es un registro/reporte (una carga vieja, por ejemplo) y el stock de hoy ya
 * refleja lo que quedó. Sumar la escoria ahí la contaría dos veces.
 */
export function ingresaEscoria(escoriaKg: number | null | undefined, sumarInventario: boolean | null | undefined): boolean {
  if (sumarInventario === false) return false;
  return kgDeEscoria(escoriaKg) > 0;
}

/** Texto del movimiento, para que el kardex se explique solo. */
export function detalleEscoria(coladaNum: number | string | null | undefined): string {
  const n = String(coladaNum ?? '').trim();
  return n
    ? `Escoria obtenida en la colada N° ${n} · vuelve a fundición como materia prima`
    : 'Escoria obtenida en una colada · vuelve a fundición como materia prima';
}

/** Lo mismo, para la refinación. */
export function detalleEscoriaRefinacion(refinacionNum: number | string | null | undefined): string {
  const n = String(refinacionNum ?? '').trim();
  return n
    ? `Dross obtenido en la refinación N° ${n} · vuelve a fundición como materia prima`
    : 'Dross obtenido en una refinación · vuelve a fundición como materia prima';
}

/**
 * Busca la ficha de una escoria y, si no está, la CREA.
 *
 * Antes solo buscaba, y si no encontraba nada se rendía en silencio. Eso fue
 * exactamente lo que pasó: el código pedía «ESCOREA DE FUNDICION» y en el
 * catálogo solo existía «ESCOREA DE CASITERITA», así que cada colada cerraba
 * tirando su escoria sin que nadie se enterara — ni un aviso, ni una fila en el
 * kardex. Una ficha que falta es algo que el sistema sabe crear; perder material
 * no es algo que pueda decidir por su cuenta.
 *
 * La ficha nace marcada como insumo de receta: la escoria existe para volver al
 * horno, así que tiene que poder elegirse en «Materiales a utilizar».
 */
export async function asegurarFichaEscoria(nombre: string): Promise<Producto | null> {
  const { data } = await supabase.from('productos')
    .select('*').ilike('nombre', nombre).limit(1).maybeSingle();
  if (data) return data as Producto;

  const sku = await siguienteSkuLibre(CATEGORIA_ESCORIA);
  return createProducto({
    sku,
    nombre,
    categoria: CATEGORIA_ESCORIA,
    unidad: UNIDAD_ESCORIA,
    stock: 0,
    stock_min: 0,
    // Sin costo a propósito: lo que costó el proceso ya está en el estaño.
    precio: 0,
    almacen: ALMACEN_ESCORIA,
    estado: 'activo',
    es_receta: true,
  });
}
