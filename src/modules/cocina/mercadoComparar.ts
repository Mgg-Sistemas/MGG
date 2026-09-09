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

import type { DisponibleItem, EventoMercado, ItemAgg } from './mercados.repository';

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

/* ───────── Quién intervino el mercado ───────── */

/**
 * Una intervención, en una línea.
 *
 * `generado_al_cerrar` NO dice «abrió Fulano»: al mercado siguiente no lo abre
 * nadie, lo genera el cierre del anterior. Quien después trabaje ese corte puede
 * ser otra persona, así que atribuirle la apertura al que cerró sería inventar un
 * acto que no ocurrió. Se nombra el cierre que lo originó y ahí termina.
 */
export function describirEvento(e: EventoMercado): string {
  const quien = (e.actor_name || e.actor || '').trim() || 'desconocido';
  switch (e.evento) {
    case 'abierta':
      return `Abrió ${quien}`;
    case 'generado_al_cerrar':
      return `Generado al cerrar el #${e.al_cerrar ?? '?'} (${quien})`;
    case 'cerrado': {
      if (!e.ajustado) return `Cerró ${quien}`;
      const n = e.ajustados?.length ?? 0;
      return `Cerró ${quien} y ajustó ${n} víver${n === 1 ? '' : 'es'}`;
    }
    case 'reabierto':
      return `Reabrió ${quien}`;
    case 'descartado':
      // «Descartado» no es «cerrado»: el ciclo no aporta saldo al siguiente, y
      // confundirlos haría pensar que su remanente sigue en la cadena.
      return `Descartó ${quien}`;
    default:
      return quien;
  }
}

/**
 * Los víveres cuyo saldo tocó una intervención, para poder marcarlos en la tabla.
 *
 * «Quién ajustó» sin «qué ajustó» obliga a comparar dos pantallas para saber si la
 * fila que estás mirando es una de las que alguien cambió a mano.
 */
export function productosAjustados(historial: EventoMercado[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const e of historial ?? []) for (const id of e.ajustados ?? []) out.add(id);
  return out;
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

/* ───────── Por dónde se fue la diferencia ───────── */

/**
 * Una salida de víveres que el mercado NO cuenta como consumo.
 *
 * El libro del mercado solo resta lo que sale por `cocina_comidas`. Todo lo
 * demás —una salida manual, un ajuste, un traslado— mueve el inventario sin
 * tocar la columna «Consumido», y es de ahí que sale el descuadre. En Los Pinos
 * eso es el 90 % de lo que sale del almacén.
 */
export interface SalidaFueraDelCiclo {
  producto_id: string;
  at: string;
  /** Positivo: cuánto salió. */
  cantidad: number;
  tipo: string;
  actor_name: string | null;
  detalle: string | null;
}

export interface ExplicacionDiferencia {
  /** Cuánto salió por fuera del ciclo, en total. */
  total: number;
  /** Desglose, del movimiento más grande al más chico. */
  porTipo: { tipo: string; cantidad: number; movimientos: number }[];
  /** El más reciente, que suele ser el que se está preguntando. */
  ultimo: { at: string; actor: string | null; tipo: string; cantidad: number } | null;
  /**
   * ¿Estas salidas alcanzan a explicar el faltante?
   *
   * `false` cuando la diferencia es mayor que lo que salió por fuera: ahí queda
   * un resto sin explicación y decir «esto lo explica» sería mentir.
   */
  explicaTodo: boolean;
  /** Lo que queda sin explicar. 0 cuando las salidas cubren el faltante. */
  sinExplicar: number;
}

/**
 * Qué parte del faltante se explica por movimientos fuera del ciclo.
 *
 * `diferencia` es la del contraste: negativa cuando en el almacén hay MENOS de
 * lo que dice el libro. Un sobrante (positiva) no se explica con salidas, así
 * que devuelve `null` — inventarle una causa sería peor que no decir nada.
 */
export function explicarDiferencia(
  diferencia: number,
  salidas: SalidaFueraDelCiclo[],
): ExplicacionDiferencia | null {
  if (!(diferencia < 0) || !salidas.length) return null;

  const porTipoMap = new Map<string, { tipo: string; cantidad: number; movimientos: number }>();
  let total = 0;
  let ultimo: ExplicacionDiferencia['ultimo'] = null;
  for (const s of salidas) {
    const cant = Math.abs(Number(s.cantidad) || 0);
    if (cant <= 0) continue;
    total = r2(total + cant);
    const prev = porTipoMap.get(s.tipo);
    if (prev) { prev.cantidad = r2(prev.cantidad + cant); prev.movimientos += 1; }
    else porTipoMap.set(s.tipo, { tipo: s.tipo, cantidad: cant, movimientos: 1 });
    if (!ultimo || String(s.at) > String(ultimo.at)) {
      ultimo = { at: s.at, actor: s.actor_name ?? null, tipo: s.tipo, cantidad: cant };
    }
  }
  if (total <= 0) return null;

  const falta = Math.abs(diferencia);
  const sinExplicar = r2(Math.max(0, falta - total));
  return {
    total,
    porTipo: [...porTipoMap.values()].sort((a, b) => b.cantidad - a.cantidad),
    ultimo,
    explicaTodo: sinExplicar < 0.01,
    sinExplicar,
  };
}

/**
 * Por qué SOBRA: en el almacén hay más de lo que el libro dice que queda.
 *
 * Un sobrante no se explica con salidas —al revés que un faltante— así que
 * `explicarDiferencia` devuelve `null` y hace falta mirar la fila del ciclo.
 *
 * El caso más frecuente y el más grave es el libro en NEGATIVO: se registraron
 * consumos por encima de lo que el mercado vio entrar, así que el saldo cae por
 * debajo de cero mientras el almacén tiene material de verdad. No es que sobre
 * comida: es que al ciclo le falta una entrada.
 */
export function explicarSobrante(d: DisponibleItem): string | null {
  if (d.queda < -0.001) {
    return 'el libro quedó en negativo: se consumió más de lo que el ciclo vio entrar';
  }
  if (d.saldoInicial === 0 && d.entradas === 0 && d.consumos > 0) {
    return 'se consumió sin que el ciclo registrara ninguna entrada';
  }
  if (d.saldoInicial === 0 && d.entradas === 0) {
    return 'el ciclo nunca lo vio entrar: está en el almacén pero no en el mercado';
  }
  return 'entró al almacén sin quedar registrado en el ciclo';
}
