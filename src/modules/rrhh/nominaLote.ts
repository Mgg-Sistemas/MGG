/* ============================================================
   MGG · RRHH · Imprimir recibos por lote

   Una nómina se paga de a poco: Tesorería va pagando renglón por renglón, y
   los que se pagaron el martes no son los mismos que los del viernes. Cuando
   hay que imprimir los recibos, lo que se necesita casi siempre es "los de
   tal día", no "todos".

   Por eso los recibos se agrupan por FECHA DE PAGO. Los que todavía no se
   pagaron van en su propio grupo al final: el recibo existe (la nómina ya
   está cargada) pero no dice cuándo se pagó, así que no puede caer en
   ninguna fecha.
   ============================================================ */
import type { NominaRenglon } from '@/shared/lib/types';

/** Clave de agrupación: el día del pago en ISO, o '' si todavía no se pagó. */
export const SIN_PAGAR = '';

export function fechaDePago(r: Pick<NominaRenglon, 'pagada_en'>): string {
  const v = r.pagada_en;
  if (!v) return SIN_PAGAR;
  // `pagada_en` es un timestamp; para agrupar solo interesa el día.
  const iso = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : SIN_PAGAR;
}

export interface GrupoRecibos<T> {
  /** 'aaaa-mm-dd' del pago, o '' para los que todavía no se pagaron. */
  fecha: string;
  renglones: T[];
  /** Suma de los netos del grupo. */
  totalUsd: number;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Agrupa los renglones por día de pago.
 *
 * El orden es cronológico —así se lee como el historial de lo que se fue
 * pagando— y los que faltan pagar quedan al final, que es donde uno los
 * busca: son los que todavía hay que hacer, no parte de lo ya hecho.
 */
export function agruparRecibosPorFecha<T extends Pick<NominaRenglon, 'pagada_en' | 'neto_usd'>>(
  renglones: T[],
): Array<GrupoRecibos<T>> {
  const mapa = new Map<string, T[]>();
  for (const r of renglones ?? []) {
    const f = fechaDePago(r);
    mapa.set(f, [...(mapa.get(f) ?? []), r]);
  }
  const grupos = [...mapa.entries()].map(([fecha, rs]) => ({
    fecha,
    renglones: rs,
    totalUsd: round2(rs.reduce((a, r) => a + (Number(r.neto_usd) || 0), 0)),
  }));
  return grupos.sort((a, b) => {
    if (a.fecha === SIN_PAGAR) return 1;      // los que faltan, al final
    if (b.fecha === SIN_PAGAR) return -1;
    return a.fecha.localeCompare(b.fecha);
  });
}

/** El título del grupo, tal como se muestra. */
export function etiquetaGrupo(fecha: string, formatoFecha: (iso: string) => string): string {
  return fecha === SIN_PAGAR ? 'Todavía sin pagar' : `Pagados el ${formatoFecha(fecha)}`;
}

/**
 * Los que se van a imprimir: los que están marcados, EN EL ORDEN DE LA
 * PANTALLA. Que el PDF salga en el mismo orden que se ve importa: si no,
 * revisar que estén todos es imposible.
 */
export function seleccionados<T extends { id: string }>(grupos: Array<GrupoRecibos<T>>, marcados: Set<string>): T[] {
  const out: T[] = [];
  for (const g of grupos) for (const r of g.renglones) if (marcados.has(r.id)) out.push(r);
  return out;
}

/** Estado de la casilla de un grupo: todos, ninguno, o algunos. */
export type EstadoCasilla = 'todos' | 'ninguno' | 'algunos';

export function estadoDelGrupo<T extends { id: string }>(g: GrupoRecibos<T>, marcados: Set<string>): EstadoCasilla {
  const n = g.renglones.filter((r) => marcados.has(r.id)).length;
  if (n === 0) return 'ninguno';
  return n === g.renglones.length ? 'todos' : 'algunos';
}

/**
 * Marca o desmarca un grupo entero.
 *
 * Si está a medias, se marca completo: quien toca la casilla de un grupo
 * medio marcado quiere los del día, no quedarse sin ninguno.
 */
export function alternarGrupo<T extends { id: string }>(
  g: GrupoRecibos<T>, marcados: Set<string>,
): Set<string> {
  const out = new Set(marcados);
  const ids = g.renglones.map((r) => r.id);
  if (estadoDelGrupo(g, marcados) === 'todos') for (const id of ids) out.delete(id);
  else for (const id of ids) out.add(id);
  return out;
}

/** Marca o desmarca uno solo. */
export function alternarUno(id: string, marcados: Set<string>): Set<string> {
  const out = new Set(marcados);
  if (out.has(id)) out.delete(id); else out.add(id);
  return out;
}

/** Cómo mostrar una nómina en la lista: su nombre, o el código si no tiene. */
export function nombreNomina(p: { nombre?: string | null; codigo?: string | null }): string {
  return (p.nombre ?? '').trim() || (p.codigo ?? '').trim() || 'Sin nombre';
}

/**
 * Un nombre sugerido para la nómina que se está por cargar, para que el campo
 * no arranque vacío. Se puede pisar: es una sugerencia, no una regla.
 */
export function nombreSugerido(tipo: string, iso: string): string {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return tipo === 'quincena' ? 'Quincena' : tipo;
  const dia = Number(m[3]);
  const mes = MESES[Number(m[2]) - 1] ?? '';
  const anio = m[1];
  if (tipo === 'quincena') {
    return `${dia <= 15 ? 'Primera' : 'Segunda'} quincena de ${mes} ${anio}`;
  }
  return `${tipo.charAt(0).toUpperCase()}${tipo.slice(1)} · ${dia} de ${mes} ${anio}`;
}
