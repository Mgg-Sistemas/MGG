/* ============================================================
   MGG · Combustible · el saldo del tanque nunca baja de cero

   Un surtido saca litros de un tanque físico. Si el tanque está en
   0 L no hay nada que surtir, y si se piden más litros de los que
   tiene, el saldo quedaría en negativo: combustible que se entregó
   pero que nunca existió en el libro. Las dos cosas se rechazan.

   La misma regla vive en tres capas, y las tres usan este archivo o
   su equivalente:
     1. la pantalla (PC y teléfono) muestra el disponible, avisa y
        apaga el botón;
     2. el repositorio vuelve a leer el saldo en la base justo antes
        de descontar (por si otro surtidor se metió en el medio);
     3. un trigger en la base rechaza la fila si el saldo quedaría
        en negativo, para que nada se la salte.

   Acá viven las piezas puras: se testean sin base ni pantalla.
   ============================================================ */
import { num } from '@/shared/lib/format';

/** Por debajo de esto, un saldo se considera cero (ruido de decimales). */
export const TOLERANCIA_LITROS = 0.0001;

/**
 * ¿Por qué NO se puede surtir? Devuelve el mensaje para la pantalla, o null si
 * los litros caben en el tanque.
 *
 * - Tanque en 0 L (o menos): se rechaza siempre, aunque todavía no hayan
 *   tecleado los litros. No hay combustible para surtir.
 * - Litros todavía sin cargar (0 o vacío): null. Que falte el dato lo dice el
 *   formulario con su propio mensaje; acá solo se juzga el saldo.
 * - Litros por encima del disponible: se rechaza con los dos números a la
 *   vista, para que el surtidor sepa cuánto SÍ puede echar.
 */
export function errorSurtido(
  disponible: number | string | null | undefined,
  litros: number | string | null | undefined,
  nombreTanque?: string | null,
): string | null {
  const disp = aNumero(disponible);
  const pedidos = aNumero(litros);
  const tanque = nombreTanque?.trim() ? ` "${nombreTanque.trim()}"` : '';

  if (disp <= TOLERANCIA_LITROS) {
    return `El tanque${tanque} está en 0 L: no hay combustible para surtir. Registrá primero un ingreso.`;
  }
  if (pedidos <= 0) return null;
  if (pedidos > disp + TOLERANCIA_LITROS) {
    return `El tanque${tanque} tiene ${num(disp)} L: no alcanza para ${num(pedidos)} L. El saldo no puede quedar en negativo.`;
  }
  return null;
}

/** ¿Se puede registrar el surtido? Litros cargados (> 0) y que caben en el tanque. */
export function puedeSurtir(
  disponible: number | string | null | undefined,
  litros: number | string | null | undefined,
): boolean {
  return aNumero(litros) > 0 && errorSurtido(disponible, litros) === null;
}

/**
 * Lo que quedaría en el tanque después del surtido, con dos decimales.
 * Null cuando el surtido no es válido (ahí no hay «después» que mostrar).
 */
export function litrosTrasSurtido(
  disponible: number | string | null | undefined,
  litros: number | string | null | undefined,
): number | null {
  if (!puedeSurtir(disponible, litros)) return null;
  const resto = aNumero(disponible) - aNumero(litros);
  return Math.max(0, Math.round(resto * 100) / 100);
}

/** Lee un número de formulario o de base: vacío, nulo o basura es 0; acepta coma decimal. */
function aNumero(v: number | string | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
