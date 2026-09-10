/* ============================================================
   MGG · Cocina · Lo que costó dar de comer

   La ecuación del ciclo se lee en UNIDADES: cuántos kilos entraron,
   cuántos se consumieron, cuántos quedan. Sirve para cuadrar el
   almacén, pero no responde la pregunta de la líder: cuánto cuesta
   un plato.

   Estos números ya se calculaban en `resumenMercado().kpis` y no los
   mostraba nadie. Acá se les da la vuelta que faltaba: el consumo en
   dinero y el costo por plato, que es el indicador con el que se
   compara un ciclo contra otro y se discute el presupuesto.
   ============================================================ */

/** Redondeo a 2 decimales: es dinero. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CostoDeAlimentar {
  /** Platos servidos en el ciclo. */
  platos: number;
  /** Lo que costaron los víveres consumidos. */
  consumo: number;
  /** Lo que entró al ciclo, valorado. */
  entradas: number;
  /** consumo / platos. `null` cuando todavía no se sirvió ninguno. */
  porPlato: number | null;
}

/**
 * Costo por plato del ciclo. Devuelve `null` en `porPlato` cuando no hay platos:
 * un «$0,00 por plato» al abrir el mercado es un dato falso, no un cero.
 *
 * Tolera negativos y basura porque `kpis` sale de sumar movimientos que la
 * analista puede haber cargado a mano.
 */
export function costoDeAlimentar(kpis: {
  platos?: number | null;
  consumoValor?: number | null;
  entradasValor?: number | null;
}): CostoDeAlimentar {
  const platos = Math.max(0, Math.trunc(Number(kpis.platos) || 0));
  const consumo = r2(Math.max(0, Number(kpis.consumoValor) || 0));
  const entradas = r2(Math.max(0, Number(kpis.entradasValor) || 0));
  return { platos, consumo, entradas, porPlato: platos > 0 ? r2(consumo / platos) : null };
}

/**
 * Cuánto se movió el costo por plato entre dos ciclos, en porcentaje.
 * `null` si falta alguno de los dos o el anterior era cero: no hay contra qué comparar.
 */
export function variacionPorPlato(actual: number | null, anterior: number | null): number | null {
  if (actual == null || anterior == null || anterior <= 0) return null;
  return r2(((actual - anterior) / anterior) * 100);
}
