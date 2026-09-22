import type { CasiteritaDetalle, CasiteritaCategoria } from './casiteritaDetalle.repository';

/* ============================================================
   MGG · Buscador del Inventario Detallado (SnO₂)
   ------------------------------------------------------------
   Busca por TODAS las características de la fila, no por una sola columna: el
   precinto, el nº de análisis, la procedencia, la categoría, los pesos, el
   tenor, la tasa, el valor, la nota y hasta si el saco está usado y en qué
   colada. Es como se busca de verdad: uno no sabe en qué columna está el dato
   que recuerda.
   ============================================================ */

/** Los nombres con que se ve cada categoría en pantalla (se pueden buscar así). */
const CAT_TEXTO: Record<CasiteritaCategoria, string> = {
  bigbag: 'BIG BAG BIGBAG', saco: 'SACO', tobo: 'TOBO', hielo: 'BOLSA DE HIELO HIELO',
};

/**
 * Texto comparable: sin acentos, en minúscula y con los números en las dos
 * formas que la gente escribe. Acá «7,50», «7.50» y «750» encuentran la misma
 * fila, porque el usuario escribe el número como lo ve en la pantalla o como
 * lo tiene en la cabeza, y las dos veces tiene razón.
 */
export function normalizar(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

/**
 * Un número, escrito de las varias maneras en que alguien lo buscaría:
 * como lo muestra la tabla («1.048,50»), sin el punto de los miles
 * («1048,50») y con punto decimal («1048.5» y «1048.50»). Buscar «1048» o
 * «1.048» cae dentro de alguna de esas, que es lo que se teclea de verdad.
 */
function formasDeNumero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  const conComa = v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sinMiles = conComa.replace(/\./g, '');
  return [String(v), conComa, sinMiles, sinMiles.replace(',', '.')].join(' ');
}

/** Lo que el buscador sabe de una fila además de sus columnas: el consumo. */
export interface UsoDeFila {
  /** Kg ya usados por coladas. */
  kg?: number;
  /** Números de colada que la consumieron. */
  coladas?: Array<{ num: number }>;
}

/** Todo el texto de una fila donde tiene sentido buscar. */
export function textoDeFila(d: CasiteritaDetalle, uso?: UsoDeFila): string {
  const usado = Number(uso?.kg) || 0;
  const total = Number(d.peso_casiterita_kgs) || 0;
  const estado = usado > 0.01
    // «parcial» / «agotado» son las palabras con que se pregunta por un saco;
    // sin esto habría que saber el número exacto de kg para encontrarlo.
    ? `usado ${usado <= total - 0.01 ? 'parcial' : 'agotado completo'}`
    : 'sin usar disponible entero';
  const coladas = (uso?.coladas ?? []).map((c) => `colada #${c.num} colada ${c.num}`).join(' ');
  return normalizar([
    d.precinto, d.n_analisis, d.procedencia, d.almacen, d.nota,
    CAT_TEXTO[d.categoria] ?? d.categoria,
    d.cant,
    formasDeNumero(d.peso_neto_kgs),
    formasDeNumero(d.peso_casiterita_kgs),
    formasDeNumero(d.prom_sn),
    formasDeNumero(d.peso_puro_sn),
    formasDeNumero(d.tasa),
    formasDeNumero(total * Number(d.tasa ?? 0)),
    formasDeNumero(usado),
    estado, coladas,
  ].filter((x) => x !== '' && x != null).join(' '));
}

/**
 * Filtra por texto libre. Varias palabras se exigen TODAS («esperanza saco»
 * trae los sacos de La Esperanza), en cualquier orden y en cualquier columna:
 * quien busca no se acuerda del orden, se acuerda de dos datos sueltos.
 */
export function filtrarCasiterita(
  rows: CasiteritaDetalle[],
  q: string,
  usos?: Map<string, UsoDeFila>,
): CasiteritaDetalle[] {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean);
  if (!palabras.length) return rows;
  return rows.filter((d) => {
    const texto = textoDeFila(d, usos?.get(d.id));
    return palabras.every((p) => texto.includes(p));
  });
}
