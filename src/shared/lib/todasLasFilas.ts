/* ============================================================
   MGG · Supabase · Traer TODAS las filas de una consulta
   PostgREST devuelve como máximo 1.000 filas por respuesta (valor por
   defecto de Supabase, «Max rows») y NO avisa cuando corta. En
   producción `productos` (1.046) y `existencias` (1.108) ya superan
   ese tope: `listProductos()` y `listExistencias()` traían la tabla
   entera en una sola llamada y dejaban productos y existencias fuera
   del inventario en pantalla, sin ningún error.
   Esta función pide la consulta por páginas con `.range()` hasta que
   una página vuelve incompleta. La consulta DEBE tener un `order`
   estable (con desempate por id) para que las páginas no se solapen.
   ============================================================ */

export const PAGINA_SUPABASE = 1000;

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;

/**
 * Ejecuta `pagina(desde, hasta)` con rangos consecutivos de PAGINA_SUPABASE filas y
 * concatena los resultados. Lanza el primer error de Supabase que aparezca.
 *
 *   const filas = await todasLasFilas<Producto>((d, h) =>
 *     supabase.from('productos').select('*').order('nombre').order('id').range(d, h));
 */
export async function todasLasFilas<T>(pagina: (desde: number, hasta: number) => Pagina<T>, tamano = PAGINA_SUPABASE): Promise<T[]> {
  const todas: T[] = [];
  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await pagina(desde, desde + tamano - 1);
    if (error) throw error;
    const filas = data ?? [];
    todas.push(...filas);
    if (filas.length < tamano) break;
  }
  return todas;
}
