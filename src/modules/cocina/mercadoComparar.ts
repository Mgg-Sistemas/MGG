/* ============================================================
   MGG · Cocina · el mercado como LIBRO, y su contraste con el inventario

   El mercado es un ciclo de 21 días con cinco números encadenados:
     saldo inicial  +  entradas  =  disponible  −  consumos  =  queda

   Hasta ahora el saldo inicial no se guardaba: se deducía del stock actual
   (`saldo = stock − entradas + consumos`). Con esa fórmula, reemplazando,
   `queda = stock` SIEMPRE — el mercado era un espejo del inventario y un
   espejo no puede contradecir lo que refleja. Por eso el descuadre que
   reportan Cocina y la analista era estructuralmente invisible.

   Congelando el saldo (el remanente del cierre anterior) aparecen DOS
   números que sí pueden diferir: lo que dice el libro del mercado y lo que
   dice el inventario. Esa diferencia es la señal, y no le pide trabajo
   nuevo a nadie: sale de datos que ya están.

   Acá viven las piezas puras: se testean sin base ni React.
   ============================================================ */

import type { DisponibleItem, ItemAgg } from './mercados.repository';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/* ───────── Contraste mercado ↔ inventario ───────── */

export interface DiferenciaViver {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  /** Lo que el libro del mercado dice que queda. */
  mercado: number;
  /** Lo que el inventario tiene de verdad. */
  inventario: number;
  /** inventario − mercado. Negativo = falta; positivo = sobra. */
  diferencia: number;
}

/**
 * Víveres donde el libro del mercado y el inventario NO coinciden.
 *
 * Solo se comparan los víveres que el mercado conoce: un producto que el
 * almacén tiene pero que nunca entró al ciclo no es un descuadre del mercado.
 * Se ignoran las diferencias por debajo de un centésimo, que son residuos de
 * redondeo y no un faltante real.
 */
export function diferenciasPorViver(
  disponible: DisponibleItem[],
  stockPorProducto: Map<string, number>,
): DiferenciaViver[] {
  const out: DiferenciaViver[] = [];
  for (const d of disponible) {
    const inventario = r2(stockPorProducto.get(d.producto_id) ?? 0);
    const diferencia = r2(inventario - d.queda);
    if (Math.abs(diferencia) < 0.01) continue;
    out.push({
      producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad,
      mercado: r2(d.queda), inventario, diferencia,
    });
  }
  // Lo más descuadrado primero: es lo que se busca al abrir la pantalla.
  return out.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
}

/* ───────── Los cinco números del ciclo ───────── */

export interface TotalesMercado {
  saldoInicial: number;
  entradas: number;
  disponible: number;
  consumos: number;
  queda: number;
  /** Suma del stock real de esos víveres. `null` si no se pudo consultar. */
  inventario: number | null;
  /** inventario − queda. `null` cuando no hay con qué comparar. */
  diferencia: number | null;
  /** Cuántos víveres tienen diferencia (0 = todo cuadra). */
  vieresConDiferencia: number;
}

/**
 * La ecuación del mercado, sumada sobre todos los víveres, más el contraste
 * contra el inventario. Es lo que se muestra en la capa macro del panel.
 */
export function totalesDeMercado(
  disponible: DisponibleItem[],
  stockPorProducto?: Map<string, number> | null,
): TotalesMercado {
  let saldoInicial = 0, entradas = 0, consumos = 0, queda = 0;
  for (const d of disponible) {
    saldoInicial = r2(saldoInicial + d.saldoInicial);
    entradas = r2(entradas + d.entradas);
    consumos = r2(consumos + d.consumos);
    queda = r2(queda + d.queda);
  }
  const base: TotalesMercado = {
    saldoInicial, entradas, disponible: r2(saldoInicial + entradas), consumos, queda,
    inventario: null, diferencia: null, vieresConDiferencia: 0,
  };
  if (!stockPorProducto) return base;

  const difs = diferenciasPorViver(disponible, stockPorProducto);
  let inventario = 0;
  for (const d of disponible) inventario = r2(inventario + (stockPorProducto.get(d.producto_id) ?? 0));
  return {
    ...base,
    inventario,
    diferencia: r2(inventario - queda),
    vieresConDiferencia: difs.length,
  };
}

/* ───────── Qué se muestra por defecto ───────── */

/**
 * Separa los víveres que SE MOVIERON en el ciclo (entró o se consumió algo) de
 * los que solo arrastran saldo.
 *
 * Con 50 víveres en Los Pinos, la tabla completa no tiene dónde apoyar la
 * vista. Los que no se movieron no desaparecen: quedan detrás de un «ver los N
 * restantes», porque su stock sigue siendo real.
 */
export function separarMovidos(items: DisponibleItem[]): { movidos: DisponibleItem[]; quietos: DisponibleItem[] } {
  const movidos: DisponibleItem[] = [];
  const quietos: DisponibleItem[] = [];
  for (const d of items) {
    if (d.entradas !== 0 || d.consumos !== 0) movidos.push(d);
    else quietos.push(d);
  }
  return { movidos, quietos };
}

/* ───────── Comparar dos cortes ───────── */

export interface FilaComparacion {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  /** Consumo del corte más viejo. */
  a: number;
  /** Consumo del corte más nuevo. */
  b: number;
  /** b − a. */
  delta: number;
  /** Variación porcentual. `null` cuando el corte viejo era 0 (no hay base). */
  pct: number | null;
}

/**
 * Consumo de dos cortes, víver por víver, ordenado por la variación más grande.
 *
 * La pregunta del analista no es «cuánto consumimos» sino «qué se disparó
 * respecto del corte anterior», así que lo que manda el orden es el salto y no
 * el volumen. Un víver que aparece en un solo corte también se lista: que algo
 * deje de consumirse es tan informativo como que se dispare.
 */
export function compararConsumos(a: ItemAgg[], b: ItemAgg[]): FilaComparacion[] {
  const mapA = new Map(a.map((x) => [x.producto_id, x] as const));
  const mapB = new Map(b.map((x) => [x.producto_id, x] as const));
  const ids = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  const out: FilaComparacion[] = [];
  for (const id of ids) {
    const xa = mapA.get(id);
    const xb = mapB.get(id);
    const ca = r2(xa?.cantidad ?? 0);
    const cb = r2(xb?.cantidad ?? 0);
    if (ca === 0 && cb === 0) continue;
    out.push({
      producto_id: id,
      sku: xa?.sku ?? xb?.sku ?? '',
      nombre: xa?.nombre ?? xb?.nombre ?? id,
      unidad: xa?.unidad ?? xb?.unidad ?? '',
      a: ca, b: cb, delta: r2(cb - ca),
      pct: ca > 0 ? Math.round(((cb - ca) / ca) * 100) : null,
    });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.nombre.localeCompare(y.nombre, 'es'));
}
