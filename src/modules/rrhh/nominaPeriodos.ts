/* ============================================================
   MGG · RRHH · Reglas del ciclo de una nómina (09-10-2026)

   Una nómina nace «cargada», pasa a «en_pago» cuando Tesorería paga el
   primer renglón y queda «pagada» —CERRADA— cuando se pagó el último.
   Tres reglas viven acá (y también en la base, con triggers, para que
   ningún cliente las saltee):

   · Una nómina cerrada no se modifica ni se borra.
   · Eliminar una nómina es mandarla a la PAPELERA con un motivo; de ahí
     solo un administrador la recupera o la borra de verdad.
   · Hay UNA sola quincena abierta a la vez: hasta que la anterior no se
     pague completa no se carga otra. Las de vacaciones y liquidación son
     pagos de una persona y no entran en esa cuenta.

   Lo de abajo es lógica pura (sin red ni React) para poder probarla.
   ============================================================ */
import type { Personal } from '@/shared/lib/types';

/** Mínimo de caracteres del motivo al eliminar una nómina. */
export const MOTIVO_MINIMO = 3;

export interface PeriodoEstado {
  tipo: string;
  estado: string;
  eliminado_en?: string | null;
}

/** Cerrada = pagada en su totalidad. Es el único estado que no se toca más. */
export function estaCerrada(p: Pick<PeriodoEstado, 'estado'>): boolean {
  return p.estado === 'pagada';
}

/** Está en la papelera (borrado lógico). */
export function estaEliminada(p: Pick<PeriodoEstado, 'eliminado_en'>): boolean {
  return !!p.eliminado_en;
}

/**
 * La quincena que todavía no se pagó completa, si la hay. Es la que impide
 * cargar otra. Las que están en la papelera no cuentan: no se van a pagar.
 */
export function nominaAbierta<T extends PeriodoEstado>(periodos: T[]): T | null {
  return periodos.find((p) => p.tipo === 'quincena' && !estaCerrada(p) && !estaEliminada(p)) ?? null;
}

/** El motivo sirve si, sin espacios de sobra, llega al mínimo. */
export function motivoEliminacionValido(motivo: string | null | undefined): boolean {
  return (motivo ?? '').trim().length >= MOTIVO_MINIMO;
}

/** Minúsculas y sin acentos: «Pérez» y «perez» tienen que coincidir. */
export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Todo lo que se ve de una persona en la lista, junto, para buscar en una sola pasada. */
export function textoBuscablePersona(p: Partial<Personal>): string {
  return normalizarTexto([
    p.nombre, p.apellido, p.cedula, p.cargo, p.departamento, p.numero_ficha, p.rif, p.telefono,
  ].filter(Boolean).join(' '));
}

/**
 * Filtra las filas de la carga de nómina por lo que escribió el usuario.
 * Varias palabras = todas tienen que estar («maria cocina»). Vacío = todas.
 */
export function filtrarFilasPersonal<T extends { persona: Partial<Personal> }>(filas: T[], texto: string): T[] {
  const palabras = normalizarTexto(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return filas;
  return filas.filter((f) => {
    const t = textoBuscablePersona(f.persona);
    return palabras.every((w) => t.includes(w));
  });
}

/**
 * Marca o desmarca SOLO las filas indicadas (las visibles con el filtro) y
 * deja las demás como estaban: con «cocina» filtrado, «Seleccionar todos»
 * marca la cocina y no toca al resto.
 */
export function marcarFilas<T extends { persona: { id: string }; incluido: boolean }>(
  filas: T[], ids: Iterable<string>, incluido: boolean,
): T[] {
  const set = ids instanceof Set ? ids : new Set(ids);
  return filas.map((f) => (set.has(f.persona.id) && f.incluido !== incluido ? { ...f, incluido } : f));
}

/** Texto del botón: «todos» cuando no hay filtro, «los N visibles» cuando lo hay. */
export function etiquetaSeleccion(accion: string, visibles: number, total: number): string {
  return visibles === total ? `${accion} todos` : `${accion} los ${visibles} visibles`;
}

/** Por qué no se puede cargar otra nómina, para el botón y el aviso. */
export function motivoNoCargar(abierta: { codigo: string; nombre?: string | null; pendientes?: number } | null): string | null {
  if (!abierta) return null;
  const nombre = (abierta.nombre ?? '').trim() || abierta.codigo;
  const faltan = abierta.pendientes != null ? ` Faltan ${abierta.pendientes} por pagar.` : '';
  return `Hay una nómina abierta: «${nombre}» (${abierta.codigo}).${faltan} Hasta que se pague completa no se puede cargar otra.`;
}
