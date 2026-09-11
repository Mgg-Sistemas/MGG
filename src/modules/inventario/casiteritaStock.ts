/* ============================================================
   MGG · Casiterita · Que el detallado mueva el stock

   El Inventario Detallado (SnO₂) nació como un ledger PARALELO: describía
   por precinto y análisis una casiterita que ya había entrado al stock por
   una recepción. Por eso no movía inventario.

   Pero también se cargan a mano entradas que NUNCA pasaron por una
   recepción —una compra de material en Los Pinos, por ejemplo—. Esas
   quedaban en el detalle y el stock no se enteraba.

   La regla ahora: cada fila del detallado lleva escrito CUÁNTOS KG SUYOS
   ya están contados en el stock (`stock_kg`). Con eso, cualquier cambio
   se resuelve por diferencia y nada se cuenta dos veces:

   · fila nueva      → entra su Peso Casiterita
   · fila editada    → entra o sale SOLO la diferencia
   · fila borrada    → sale lo que había aportado

   Las filas anteriores a esta regla nacieron con `stock_kg` = su peso: ya
   estaban contadas por la recepción de julio, así que no se vuelven a
   sumar, pero editarlas o borrarlas ajusta bien.
   ============================================================ */

/** Tolerancia: por debajo de un gramo no se registra movimiento. Un kardex
 *  lleno de ajustes de 0,004 kg no informa nada y tapa lo que sí importa. */
const EPSILON = 0.01;

const round2 = (n: number): number => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

export interface AjusteStock {
  /** Kg a mover: positivo entra, negativo sale. */
  delta: number;
  /** 'entrada' | 'salida', ya resuelto para el kardex. */
  tipo: 'entrada' | 'salida';
}

/**
 * Cuánto hay que mover para que el stock refleje esta fila.
 *
 * `yaContado` es lo que la fila aportó hasta ahora; `pesoCasiterita`, lo que
 * debería aportar. Devuelve `null` cuando no hay nada que hacer — que es el
 * caso normal al editar la tasa o el número de análisis, donde el peso no
 * cambió.
 */
export function ajustePorFila(pesoCasiterita: number | null | undefined, yaContado: number | null | undefined): AjusteStock | null {
  const objetivo = round2(Number(pesoCasiterita) || 0);
  const actual = round2(Number(yaContado) || 0);
  const delta = round2(objetivo - actual);
  if (Math.abs(delta) < EPSILON) return null;
  return { delta, tipo: delta > 0 ? 'entrada' : 'salida' };
}

/**
 * Lo que hay que devolver al stock al borrar una fila.
 *
 * Una fila que nunca aportó (`stock_kg` en cero) no descuenta nada: sacarla
 * del detalle no puede castigar un stock que ella no había sumado.
 */
export function ajusteAlBorrar(yaContado: number | null | undefined): AjusteStock | null {
  const actual = round2(Number(yaContado) || 0);
  if (Math.abs(actual) < EPSILON) return null;
  return { delta: round2(-actual), tipo: 'salida' };
}

/** Texto del movimiento, para que el kardex diga de dónde salió el kilo. */
export function detalleMovimiento(procedencia: string | null | undefined, categoria: string | null | undefined, esAjuste: boolean): string {
  const proc = (procedencia ?? '').toString().trim();
  const cat = (categoria ?? '').toString().trim();
  const que = esAjuste ? 'Ajuste del inventario detallado (SnO₂)' : 'Entrada del inventario detallado (SnO₂)';
  return [que, proc, cat].filter(Boolean).join(' · ');
}
