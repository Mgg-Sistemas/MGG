/* ============================================================
   Retenciones · Búsqueda, filtros con su conteo y orden (R3-11), lógica pura

   Traslado de la maqueta v8 (`v8-3-listas.js`: `buscaEn`, `v8Conteo`,
   `v8Barra` y los manejadores de la barra). Cada lista paginada lleva:
   - un campo de búsqueda con «N resultado(s)»;
   - filtros con el conteo de cada opción, contado con los DEMÁS filtros puestos;
   - el orden, cambiable;
   - los filtros activos a la vista, con «Quitar filtros»;
   - y cualquier cambio de búsqueda, filtro u orden vuelve a la página 1.
   ============================================================ */
import { normalizarBusqueda } from '@/shared/lib/buscar';
import { nf } from './paginador';

/** Para comparar: sin acentos, en minúscula y sin signos ni espacios («J-00000001-0» ≈ «j000000010»). */
export function normalizarLista(v: unknown): string {
  return normalizarBusqueda(v).replace(/[^a-z0-9]/g, '');
}

/** ¿Alguno de los campos contiene lo buscado? Sin búsqueda, sí. */
export function buscaEn(q: string | null | undefined, ...campos: unknown[]): boolean {
  const n = normalizarLista(q ?? '');
  return !n || campos.some((c) => normalizarLista(c ?? '').includes(n));
}

/** Una opción de un filtro, con cuántas filas quedarían al elegirla. */
export interface OpcionFiltro {
  valor: string;
  texto: string;
  cuenta?: number;
}

/** Un filtro de la barra. `valor` vacío = «Todos». */
export interface FiltroLista {
  campo: string;
  etiqueta: string;
  valor: string;
  opciones: OpcionFiltro[];
  /** Si se indica, «Todos (N)». */
  total?: number;
}

/** Lo mínimo de un filtro para contar y filtrar. */
export type FiltroPuesto = Pick<FiltroLista, 'campo' | 'valor'>;

/** ¿La fila pasa el filtro `campo` con el valor `valor`? Lo define cada lista. */
export type PasaFiltro<T> = (fila: T, campo: string, valor: string) => boolean;

/** Las filas que pasan todos los filtros puestos. */
export function aplicarFiltros<T>(base: readonly T[], filtros: readonly FiltroPuesto[], pasa: PasaFiltro<T>): T[] {
  return base.filter((x) => filtros.every((f) => !f.valor || pasa(x, f.campo, f.valor)));
}

/**
 * Cuántas filas quedan con la opción `valor` del filtro `campo`, con los DEMÁS
 * filtros puestos (el propio se reemplaza por la opción). Es `v8Conteo`.
 */
export function contarOpcion<T>(base: readonly T[], filtros: readonly FiltroPuesto[], campo: string, valor: string, pasa: PasaFiltro<T>): number {
  return base.filter((x) => filtros.every((f) => f.campo === campo || !f.valor || pasa(x, f.campo, f.valor)) && pasa(x, campo, valor)).length;
}

/**
 * Las opciones de un filtro con su conteo. Con `soloConFilas`, se quitan las
 * que no tienen filas, salvo la elegida (así lo hace la maqueta con «Impuesto»).
 */
export function opcionesConConteo<T>(
  base: readonly T[],
  filtros: readonly FiltroPuesto[],
  campo: string,
  opciones: ReadonlyArray<readonly [string, string]>,
  pasa: PasaFiltro<T>,
  soloConFilas = false,
): OpcionFiltro[] {
  const elegido = filtros.find((f) => f.campo === campo)?.valor ?? '';
  return opciones
    .map(([valor, texto]) => ({ valor, texto, cuenta: contarOpcion(base, filtros, campo, valor, pasa) }))
    .filter((o) => !soloConFilas || o.cuenta > 0 || o.valor === elegido);
}

/** Los filtros con un valor elegido. */
export function filtrosActivos<F extends FiltroPuesto>(filtros: readonly F[]): F[] {
  return filtros.filter((f) => !!f.valor);
}

/** El texto de la opción elegida (sin el conteo); si no está entre las opciones, el valor tal cual. */
export function textoDeOpcion(f: FiltroLista): string {
  return f.opciones.find((o) => o.valor === f.valor)?.texto || f.valor;
}

/** Los chips de lo activo: «Búsqueda: «…»» y «Etiqueta: opción». */
export function chipsActivos(q: string, filtros: readonly FiltroLista[]): string[] {
  const xs = q ? [`Búsqueda: «${q}»`] : [];
  return xs.concat(filtrosActivos(filtros).map((f) => `${f.etiqueta}: ${textoDeOpcion(f)}`));
}

/** «Filtros» o «Filtros (N)» (el resumen plegado del teléfono). */
export const textoResumenFiltros = (activos: number): string => `Filtros${activos ? ` (${activos})` : ''}`;

/** «N resultado(s)». */
export const textoResultados = (n: number): string => `${nf(n)} resultado(s)`;

/** «Todos» o «Todos (N)». */
export const textoTodos = (total?: number): string => `Todos${total != null ? ` (${nf(total)})` : ''}`;

/** «Texto» o «Texto (N)». */
export const textoOpcion = (o: OpcionFiltro): string => `${o.texto}${o.cuenta != null ? ` (${nf(o.cuenta)})` : ''}`;

/* ───────── El estado de una lista: búsqueda, filtros, orden y página ───────── */

export interface EstadoLista {
  q: string;
  filtros: Record<string, string>;
  orden: string;
  pagina: number;
}

export type AccionLista =
  | { tipo: 'buscar'; q: string }
  | { tipo: 'filtrar'; campo: string; valor: string }
  | { tipo: 'ordenar'; orden: string }
  | { tipo: 'pagina'; pagina: number }
  | { tipo: 'quitar' };

/**
 * Cómo cambia el estado de una lista. Buscar, filtrar u ordenar vuelven a la
 * página 1; «Quitar filtros» borra la búsqueda y los filtros (no el orden).
 */
export function reducirLista(estado: EstadoLista, accion: AccionLista): EstadoLista {
  switch (accion.tipo) {
    case 'buscar':
      return accion.q === estado.q ? estado : { ...estado, q: accion.q, pagina: 1 };
    case 'filtrar':
      return { ...estado, filtros: { ...estado.filtros, [accion.campo]: accion.valor }, pagina: 1 };
    case 'ordenar':
      return { ...estado, orden: accion.orden, pagina: 1 };
    case 'pagina':
      return { ...estado, pagina: Math.max(1, Math.round(accion.pagina) || 1) };
    case 'quitar':
      return { ...estado, q: '', filtros: Object.fromEntries(Object.keys(estado.filtros).map((k) => [k, ''])), pagina: 1 };
  }
}

/** El estado inicial: sin búsqueda, los filtros dados (por omisión, «Todos») y la página 1. */
export function estadoInicialLista(filtros: Record<string, string>, orden: string): EstadoLista {
  return { q: '', filtros: { ...filtros }, orden, pagina: 1 };
}
