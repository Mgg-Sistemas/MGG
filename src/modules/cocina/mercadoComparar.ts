/* ============================================================
   MGG · Cocina · el mercado como LIBRO, y su contraste con el inventario

   El mercado es un ciclo de 21 días con siete números encadenados:
     saldo inicial + entradas ± traslados = disponible − consumos − mermas = queda

   Las mermas / salidas tienen columna propia desde el 15/09/2026: toda salida
   del almacén que no es una comida ni un traslado (una pérdida, una salida
   manual, un ajuste a la baja). Antes no restaban del libro y el panel las
   mostraba como faltante: 450,3 pollos perdidos en Los Pinos daban «faltan
   450,3» con el inventario en 0. Ahora restan y el libro cuadra con el almacén.

   Los traslados tienen columna propia desde el 14/09/2026. Antes el libro
   contaba la pata que ENTRA como una entrada más y no veía la que SALE: la
   cocina que repartía el mercado quedaba con un faltante que no existía, y un
   traslado entre dos almacenes del mismo centro también (la entrada se sumaba
   y la salida no se restaba). Ahora las dos patas cuentan con su signo y un
   traslado interno se anula solo.

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

import type { DisponibleItem, EventoMercado, ItemAgg, MercadoCocina } from './mercados.repository';

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
  /** Neto de traslados: negativo si el centro envió más de lo que recibió. */
  traslados: number;
  disponible: number;
  consumos: number;
  /** Salidas fuera de comidas y traslados: pérdidas, salidas manuales, ajustes a la baja. */
  mermas: number;
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
  let saldoInicial = 0, entradas = 0, traslados = 0, consumos = 0, mermas = 0, queda = 0;
  for (const d of disponible) {
    saldoInicial = r2(saldoInicial + d.saldoInicial);
    entradas = r2(entradas + d.entradas);
    traslados = r2(traslados + d.traslados);
    consumos = r2(consumos + d.consumos);
    mermas = r2(mermas + d.mermas);
    queda = r2(queda + d.queda);
  }
  const base: TotalesMercado = {
    saldoInicial, entradas, traslados, disponible: r2(saldoInicial + entradas + traslados), consumos, mermas, queda,
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
 * Separa los víveres que SE MOVIERON en el ciclo (entró, se trasladó o se consumió algo) de
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
    if (d.entradas !== 0 || d.traslados !== 0 || d.consumos !== 0 || d.mermas !== 0) movidos.push(d);
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

/**
 * El instante exacto desde el que cuenta un mercado, si se abrió con «Iniciar mercado».
 *
 * Hasta el 14/09/2026 un ciclo contaba desde las 00:00 de su fecha de inicio. El #2 de Los
 * Pinos se abrió ese día a las 16:38: su ventana metía la compra, el reparto y el conteo de
 * la mañana, pero el saldo se calculaba hacia atrás sin las salidas del conteo, y 18 víveres
 * arrancaron con falta. Ahora el saldo es el inventario del momento en que se abre y el
 * ciclo cuenta desde ESE instante, que queda escrito en el evento `abierta`.
 *
 * `null` para los mercados generados al cerrar el anterior —siguen desde las 00:00 del día
 * posterior al fin, sin hueco— y para los abiertos antes del cambio.
 */
export function inicioExactoDe(historial: EventoMercado[] | null | undefined): string | null {
  const ev = (historial ?? []).find((e) => e.evento === 'abierta' && typeof e.desde === 'string' && e.desde);
  return ev?.desde ?? null;
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

/* ───────── Mermas / salidas ───────── */

/**
 * Una salida de víveres que no es una comida ni un traslado: una pérdida, una
 * salida manual, un ajuste a la baja.
 *
 * Hasta el 15/09/2026 movían el inventario sin tocar el libro y el panel las
 * mostraba como faltante. Ahora restan en «Mermas / salidas», y el detalle del
 * víver lista cada una con quién la hizo y por qué.
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

/** Cuánto salió en total de cada víver por mermas / salidas. Los víveres sin salida no aparecen. */
export function mermasPorViver(salidas: Map<string, SalidaFueraDelCiclo[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, lista] of salidas) {
    const total = lista.reduce((a, x) => r2(a + Math.abs(Number(x.cantidad) || 0)), 0);
    if (total > 0) out.set(id, total);
  }
  return out;
}

/**
 * Por qué SOBRA: en el almacén hay más de lo que el libro dice que queda.
 *
 * Un sobrante no se explica con salidas, así que hace falta mirar la fila del ciclo.
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
  // Lo que llegó por traslado también entró al ciclo: sin mirarlo, un víver que
  // llegó entero por el reparto se leía como «el ciclo nunca lo vio entrar».
  const sinEntradas = d.saldoInicial === 0 && d.entradas === 0 && !(d.traslados > 0);
  if (sinEntradas && d.consumos > 0) {
    return 'se consumió sin que el ciclo registrara ninguna entrada';
  }
  if (sinEntradas) {
    return 'el ciclo nunca lo vio entrar: está en el almacén pero no en el mercado';
  }
  return 'entró al almacén sin quedar registrado en el ciclo';
}

/* ───────── Que dos ciclos no se pisen ───────── */

/** Lo mínimo de un mercado para saber qué ventana ocupa. */
export interface VentanaCiclo {
  numero: number;
  fecha_inicio: string;
  fecha_fin: string;
  estado?: string;
  descartado?: boolean;
  /** Cuándo se descartó (ISO). Desde ese instante deja de ocupar sus días. */
  descartado_en?: string | null;
}

/** La ventana de un mercado tal como la mira la guarda de solapamiento. */
export function ventanaCicloDe(
  m: Pick<MercadoCocina, 'numero' | 'fecha_inicio' | 'fecha_fin' | 'estado' | 'cierre'>,
): VentanaCiclo {
  const descartado = !!m.cierre?.descartado;
  return {
    numero: m.numero, fecha_inicio: m.fecha_inicio, fecha_fin: m.fecha_fin, estado: m.estado,
    descartado, descartado_en: descartado ? (m.cierre?.generado_en ?? null) : null,
  };
}

/**
 * ¿La ventana propuesta pisa la de algún ciclo que ya existe?
 *
 * POR QUÉ IMPORTA. Cada ciclo toma comidas y movimientos por fecha: si dos ventanas se
 * superponen, los mismos platos aparecen en dos cortes y lo que arrastra uno se cuenta
 * también en el otro.
 *
 * UN DESCARTADO deja de ocupar sus días en el momento del descarte. Antes bloqueaba sus
 * 21 días enteros: el 14/09 el #2 de Los Pinos se abrió con la fecha equivocada, y
 * descartarlo habría impedido abrir el correcto hasta el 05/10. Con `inicioExacto` —el
 * instante en que se abre el ciclo nuevo—, un descartado antes de ese instante ya no
 * estorba. Sin él, se compara por días como siempre.
 *
 * Devuelve el ciclo que estorba, o `null` si la ventana está libre.
 */
export function cicloQueSePisa(
  inicio: string,
  fin: string,
  previos: VentanaCiclo[],
  inicioExacto?: string | null,
): VentanaCiclo | null {
  if (!inicio || !fin) return null;
  for (const p of previos) {
    if (!p.fecha_inicio || !p.fecha_fin) continue;
    if (p.descartado && p.descartado_en && inicioExacto
      && Date.parse(inicioExacto) >= Date.parse(p.descartado_en)) continue;
    // Dos rangos se solapan si cada uno empieza antes de que el otro termine.
    if (inicio <= p.fecha_fin && p.fecha_inicio <= fin) return p;
  }
  return null;
}

/** Primer día libre después de todos los ciclos existentes. `null` si no hay ninguno. */
export function primerDiaLibre(previos: VentanaCiclo[]): string | null {
  let ultimo: string | null = null;
  for (const p of previos) {
    if (p.fecha_fin && (!ultimo || p.fecha_fin > ultimo)) ultimo = p.fecha_fin;
  }
  if (!ultimo) return null;
  const d = new Date(`${ultimo}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ───────── Traslados: que la salida tenga su llegada ───────── */

/** Una pata de un traslado entre almacenes, tal como queda en `movimientos`. */
export interface PataTraslado {
  id: string;
  producto_id: string;
  almacen: string;
  /** Negativo en la pata que sale, positivo en la que entra. */
  delta: number;
  at: string;
  /** La solicitud TRA que une las dos patas. Vacío en los traslados anteriores al 14/09/2026. */
  ref_id?: string | null;
  detalle?: string | null;
}

export interface TrasladoSinLlegada {
  salida: PataTraslado;
  /** Lo que salió y no aparece entrando en ningún almacén. */
  faltaLlegar: number;
}

/**
 * Cuánto después de la salida se busca la entrada. Las dos patas se escriben una
 * detrás de la otra desde el navegador y en la práctica las separan segundos; el
 * margen cubre una solicitud larga ejecutada por tandas.
 */
export const MARGEN_LLEGADA_MS = 15 * 60 * 1000;

const r6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6;

/**
 * Salidas por traslado que no tienen su entrada en ningún almacén.
 *
 * POR QUÉ HACE FALTA. El libro ahora resta la pata que sale. Si la entrada no se
 * llegó a escribir —pasó el 26/08/2026 con cinco traslados—, el centro que envía
 * cuadra y el que recibe también, porque ninguno de los dos tiene la mercancía:
 * el faltante desaparece del contraste. Restar la salida es correcto para el
 * centro que envía; esconder que no llegó a ningún lado, no. Esto la vuelve a
 * poner a la vista sin tocar el libro.
 *
 * Empareja de lo más fuerte a lo más débil: la misma solicitud (`ref_id`) cuando
 * las dos patas la traen, la misma cantidad, lo más cercano en el tiempo. Una
 * entrada puede cubrir varias salidas —la consolidación de Matanza del 04/09 juntó
 * 48 + 24 en una sola entrada de 72—. En el MISMO almacén solo cuenta el reverso,
 * que es la compensación que devuelve lo que salió cuando la entrada falla.
 */
export function trasladosSinLlegada(
  salidas: PataTraslado[],
  entradas: PataTraslado[],
  margenMs: number = MARGEN_LLEGADA_MS,
): TrasladoSinLlegada[] {
  const restante = new Map<string, number>();
  for (const e of entradas) if (Number(e.delta) > 0) restante.set(e.id, r6(Number(e.delta)));

  const out: TrasladoSinLlegada[] = [];
  const ordenadas = salidas
    .filter((s) => Number(s.delta) < 0)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const s of ordenadas) {
    let falta = r6(Math.abs(Number(s.delta)));
    const t0 = Date.parse(s.at);
    const candidatas = entradas
      .filter((e) => {
        if (e.producto_id !== s.producto_id || (restante.get(e.id) ?? 0) <= 0) return false;
        // Dos solicitudes distintas no se cruzan, aunque coincidan producto y minuto.
        if (s.ref_id && e.ref_id && s.ref_id !== e.ref_id) return false;
        const dt = Date.parse(e.at) - t0;
        if (!(dt >= -60_000 && dt <= margenMs)) return false;
        return e.almacen !== s.almacen || /^reverso/i.test((e.detalle ?? '').trim());
      })
      .sort((a, b) => {
        const misma = (x: PataTraslado) => (s.ref_id && x.ref_id === s.ref_id ? 0 : 1);
        const exacta = (x: PataTraslado) => (Math.abs((restante.get(x.id) ?? 0) - falta) < 0.001 ? 0 : 1);
        const lejos = (x: PataTraslado) => Math.abs(Date.parse(x.at) - t0);
        return misma(a) - misma(b) || exacta(a) - exacta(b) || lejos(a) - lejos(b);
      });
    for (const e of candidatas) {
      if (falta <= 0.001) break;
      const disp = restante.get(e.id) ?? 0;
      const toma = Math.min(disp, falta);
      restante.set(e.id, r6(disp - toma));
      falta = r6(falta - toma);
    }
    if (falta > 0.001) out.push({ salida: s, faltaLlegar: r2(falta) });
  }
  return out;
}

/* ───────── El inventario a la fecha del corte ───────── */

/**
 * El stock que había al terminar la ventana del ciclo, contado con el mismo
 * criterio que el libro.
 *
 * POR QUÉ. El contraste compara el libro, que se detiene en la fecha de fin,
 * contra el stock. Mientras el ciclo está en curso eso es el stock de ahora. Pero
 * un mercado que se cierra DESPUÉS de su último día —el #1 terminó el 11/09 y
 * seguía abierto el 14— se comparaba contra el stock de hoy, que ya descontó las
 * comidas y el reparto de los días siguientes. La diferencia salía inflada, y si
 * se elegía «ajustar al inventario» el remanente congelado ya traía esos consumos
 * restados: el ciclo siguiente, que empieza el día después del fin, los volvía a
 * restar. Contados dos veces.
 *
 * Se deshace lo que pasó después del corte:
 *  - los movimientos de inventario posteriores, MENOS los de cocina: el movimiento
 *    de una comida lleva la hora en que se cargó, no el día de la comida, y el
 *    libro ubica las comidas por su día;
 *  - las comidas cuyo día cae después del corte, que se suman de vuelta.
 */
export function stockAlCorte(
  stockAhora: Map<string, number>,
  movimientosPosteriores: { producto_id: string; delta: number; ref_tipo?: string | null }[],
  consumidoDespues: Map<string, number>,
): Map<string, number> {
  const out = new Map(stockAhora);
  for (const m of movimientosPosteriores) {
    if (m.ref_tipo === 'cocina') continue;
    out.set(m.producto_id, r2((out.get(m.producto_id) ?? 0) - (Number(m.delta) || 0)));
  }
  for (const [id, cantidad] of consumidoDespues) {
    out.set(id, r2((out.get(id) ?? 0) + (Number(cantidad) || 0)));
  }
  return out;
}

/**
 * Lo que un movimiento bajó DE VERDAD el stock de su almacén.
 *
 * `registrarMovimiento` topea en cero en vez de fallar: una salida de 101,5 desde
 * un almacén que tenía 24 queda escrita con `delta = −101,5`, pero el almacén bajó
 * 24. Sumando el `delta`, el libro restaba lo que nunca salió y el contraste daba un
 * sobrante inventado del mismo tamaño. Pasó con los traslados del 26/08/2026.
 *
 * Solo se corrige el tope —la salida pidió más de lo que había y el almacén quedó en
 * cero—; en cualquier otro caso manda el `delta`, que es lo que el resto del sistema
 * suma. Sin `stock_antes`/`stock_despues` no hay con qué corregir.
 */
export function deltaEfectivo(m: { delta?: unknown; stock_antes?: unknown; stock_despues?: unknown }): number {
  const delta = Number(m.delta) || 0;
  if (delta >= 0 || m.stock_antes == null || m.stock_despues == null) return delta;
  const antes = Number(m.stock_antes);
  const despues = Number(m.stock_despues);
  if (!Number.isFinite(antes) || !Number.isFinite(despues)) return delta;
  if (despues === 0 && antes + delta < 0) return antes > 0 ? -antes : 0;
  return delta;
}
