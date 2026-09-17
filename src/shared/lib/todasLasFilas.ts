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
 *
 * `paralelas`: cuántas páginas se piden A LA VEZ. Cada viaje a Supabase cuesta
 * ~0,3–0,5 s para el usuario, así que en tablas que SIEMPRE pasan de 1.000 filas
 * (productos, existencias) conviene pedir 2 juntas: llegan en un solo viaje en vez
 * de dos seguidos. En consultas que suelen caber en una página dejarlo en 1, para
 * no hacer un pedido vacío de más.
 */
export async function todasLasFilas<T>(
  pagina: (desde: number, hasta: number) => Pagina<T>,
  tamano = PAGINA_SUPABASE,
  paralelas = 1,
): Promise<T[]> {
  const todas: T[] = [];
  const lote = Math.max(1, Math.floor(paralelas));
  for (let desde = 0; ; desde += tamano * lote) {
    const respuestas = await Promise.all(
      Array.from({ length: lote }, (_, k) => pagina(desde + k * tamano, desde + (k + 1) * tamano - 1)),
    );
    for (const { data, error } of respuestas) {
      if (error) throw error;
      const filas = data ?? [];
      todas.push(...filas);
      // Una página incompleta es la última: las siguientes del lote vienen vacías.
      if (filas.length < tamano) return todas;
    }
  }
}
