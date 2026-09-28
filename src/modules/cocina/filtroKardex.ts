/* ============================================================
   MGG · Cocina · Buscar y paginar los movimientos del mercado

   El kardex del ciclo venía entero en una sola tirada: con 178
   movimientos, encontrar «la salida de salchichas del 26» era bajar
   con la rueda del mouse hasta darle. Había un buscador, pero solo
   miraba el nombre del víver y el código de la comida.

   Acá está lo que faltaba:
     · filtrar por RANGO DE FECHAS, por clase de movimiento y por tipo
       de comida;
     · un buscador que mira TODO lo que la fila muestra en pantalla
       —víver, código, almacén, contraparte, motivo, quién lo hizo,
       cantidad, valor y la fecha escrita de las tres formas en que
       uno la teclea—;
     · páginas de 10, con índices 1, 2, 3… para saltar.

   Las fechas se leen en hora LOCAL, que es la que muestra la fila.
   Tomar el `YYYY-MM-DD` del ISO (que es UTC) corría un día lo que se
   cargaba de noche: la merma de las 21:00 del 26 aparecía como del 27
   y el filtro «del 26 al 26» la dejaba afuera.
   ============================================================ */
import type { KardexRow } from './mercados.repository';

/** Las cuatro clases de movimiento del ciclo, más «todas». */
export type ClaseKardex = 'todos' | 'entrada' | 'traslado' | 'consumo' | 'merma';

export const CLASES_KARDEX: Array<{ clave: ClaseKardex; label: string }> = [
  { clave: 'todos', label: 'Todos los movimientos' },
  { clave: 'entrada', label: '⬇ Entradas' },
  { clave: 'traslado', label: '🔁 Traslados' },
  { clave: 'consumo', label: '⬆ Consumos (comidas)' },
  { clave: 'merma', label: '⚠ Mermas / salidas' },
];

export interface FiltroKardex {
  /** `YYYY-MM-DD`, vacío = sin tope. */
  desde: string;
  hasta: string;
  clase: ClaseKardex;
  /** Tipo de comida. Vacío = todas. Solo recorta los consumos. */
  tipoComida: string;
  texto: string;
}

export const FILTRO_KARDEX_VACIO: FiltroKardex = {
  desde: '', hasta: '', clase: 'todos', tipoComida: '', texto: '',
};

/** ¿Hay algún filtro puesto? Con todo vacío se muestra el ciclo entero. */
export function hayFiltro(f: FiltroKardex): boolean {
  return !!(f.desde || f.hasta || f.tipoComida || f.texto.trim()) || f.clase !== 'todos';
}

/** El día del movimiento en hora local: el mismo que se lee en la fila. */
export function diaLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function claseDeFila(row: KardexRow): Exclude<ClaseKardex, 'todos'> {
  return row.kind;
}

/** El instante del movimiento. Los consumos lo llevan en la comida. */
export function instanteDeFila(row: KardexRow): string {
  return row.kind === 'consumo' ? row.comida.at : row.at;
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Todo lo que la fila muestra, en una sola tira de texto minúscula y sin
 * tildes. Incluye la fecha escrita de las formas en que uno la teclea
 * —26/09/2026, 26-09-2026, 2026-09-26— y la hora, porque «buscar por fecha»
 * casi siempre se hace tecleando el día en la misma caja del texto.
 */
export function textoBuscable(row: KardexRow, etiquetaComida: (t: string) => string): string {
  const iso = instanteDeFila(row);
  const dia = diaLocal(iso);
  const [y, m, d] = dia.split('-');
  const h = new Date(iso);
  const hora = Number.isNaN(h.getTime())
    ? ''
    : `${String(h.getHours()).padStart(2, '0')}:${String(h.getMinutes()).padStart(2, '0')}`;
  const fechas = dia ? `${dia} ${d}/${m}/${y} ${d}-${m}-${y} ${hora}` : '';

  const partes: Array<string | number | null | undefined> = [fechas];
  if (row.kind === 'entrada') {
    partes.push('entrada', row.nombre, row.unidad, row.almacen, row.detalle, row.cantidad, row.valor);
  } else if (row.kind === 'traslado') {
    partes.push('traslado', row.nombre, row.unidad, row.almacen, row.contraparte, row.codigo, row.detalle,
      row.cantidad, row.valor, row.sinLlegada > 0 ? 'sin llegada' : '');
  } else if (row.kind === 'merma') {
    partes.push('merma', 'salida', row.nombre, row.unidad, row.almacen, row.tipo, row.detalle,
      row.actor_name, row.cantidad, row.valor);
  } else {
    const c = row.comida;
    partes.push('consumo', 'comida', c.codigo, c.tipo_comida, etiquetaComida(c.tipo_comida), c.nota,
      c.platos, c.valor_total, c.actor_name, (c.items ?? []).map((i) => i.nombre).join(' '));
  }
  return sinTildes(partes.filter((p) => p != null && p !== '').join(' ').toLowerCase());
}

/**
 * Las filas que pasan el filtro, en el mismo orden en que venían.
 *
 * El texto se parte en palabras y se exigen TODAS: «pollo 26/09» encuentra la
 * fila del pollo de ese día, no las 40 filas que tienen pollo o son del 26.
 */
export function filtrarKardex(
  filas: KardexRow[],
  f: FiltroKardex,
  etiquetaComida: (t: string) => string = (t) => t,
): KardexRow[] {
  const palabras = sinTildes(f.texto.trim().toLowerCase()).split(/\s+/).filter(Boolean);
  return filas.filter((row) => {
    if (f.clase !== 'todos' && claseDeFila(row) !== f.clase) return false;
    if (f.tipoComida) {
      if (row.kind !== 'consumo') return false;
      if (row.comida.tipo_comida !== f.tipoComida) return false;
    }
    const dia = diaLocal(instanteDeFila(row));
    if (f.desde && (!dia || dia < f.desde)) return false;
    if (f.hasta && (!dia || dia > f.hasta)) return false;
    if (!palabras.length) return true;
    const texto = textoBuscable(row, etiquetaComida);
    return palabras.every((p) => texto.includes(p));
  });
}

/* ───────────────────────── Números del bloque ───────────────────────── */

export interface TotalesKardex {
  movimientos: number;
  /** Platos servidos en las comidas que quedaron a la vista. */
  platos: number;
  comidas: number;
  /** Lo que costaron los víveres servidos. */
  consumoValor: number;
  entradasValor: number;
  mermasValor: number;
  /** consumoValor ÷ platos. `null` sin platos: un «$0,00 por plato» es un dato falso. */
  porPlato: number | null;
  /** Cuántos víveres distintos toca lo que se está viendo. */
  viveres: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Los totales de lo que está a la vista: cambian con el filtro, a propósito. */
export function totalesDeKardex(filas: KardexRow[]): TotalesKardex {
  let platos = 0, comidas = 0, consumoValor = 0, entradasValor = 0, mermasValor = 0;
  const viveres = new Set<string>();
  for (const row of filas) {
    if (row.kind === 'consumo') {
      comidas += 1;
      platos += Math.max(0, Math.trunc(Number(row.comida.platos) || 0));
      consumoValor += Number(row.comida.valor_total) || 0;
      for (const it of row.comida.items ?? []) if (it.producto_id) viveres.add(it.producto_id);
      continue;
    }
    viveres.add(row.producto_id);
    if (row.kind === 'entrada') entradasValor += Number(row.valor) || 0;
    else if (row.kind === 'merma') mermasValor += Number(row.valor) || 0;
  }
  return {
    movimientos: filas.length,
    platos,
    comidas,
    consumoValor: r2(consumoValor),
    entradasValor: r2(entradasValor),
    mermasValor: r2(mermasValor),
    porPlato: platos > 0 ? r2(consumoValor / platos) : null,
    viveres: viveres.size,
  };
}

/* ───────────────────────── Páginas ───────────────────────── */

/** Cuántos movimientos por página. Los 10 últimos entran sin scroll. */
export const POR_PAGINA = 10;

export interface Pagina<T> {
  items: T[];
  /** Página que quedó (se corrige sola si la pedida ya no existe). */
  pagina: number;
  paginas: number;
  /** Posición del primero y del último, en base 1, para el «11–20 de 178». */
  primero: number;
  ultimo: number;
  total: number;
}

export function paginar<T>(filas: T[], pagina: number, porPagina = POR_PAGINA): Pagina<T> {
  const total = filas.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  // Al filtrar, la página 8 puede dejar de existir: se vuelve a la última que hay
  // en vez de mostrar el vacío, que se lee como «no hay nada».
  const p = Math.min(Math.max(1, Math.trunc(pagina) || 1), paginas);
  const desde = (p - 1) * porPagina;
  const items = filas.slice(desde, desde + porPagina);
  return { items, pagina: p, paginas, primero: total ? desde + 1 : 0, ultimo: desde + items.length, total };
}

/**
 * Los índices a dibujar: 1, 2, 3… con «…» cuando hay muchas.
 * La primera y la última siempre están, y alrededor de la actual quedan vecinas.
 */
export function numerosDePagina(pagina: number, paginas: number, vecinas = 1): Array<number | '…'> {
  if (paginas <= 1) return [1];
  const quiero = new Set<number>([1, paginas]);
  for (let i = pagina - vecinas; i <= pagina + vecinas; i++) if (i >= 1 && i <= paginas) quiero.add(i);
  const orden = [...quiero].sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  let previa = 0;
  for (const n of orden) {
    // Un solo hueco no se tapa con «…»: ocupa lo mismo y se puede tocar.
    if (previa && n - previa === 2) out.push(previa + 1);
    else if (previa && n - previa > 2) out.push('…');
    out.push(n);
    previa = n;
  }
  return out;
}
