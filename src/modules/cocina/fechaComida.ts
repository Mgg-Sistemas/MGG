/* ============================================================
   MGG · Cocina · ¿La fecha de la comida cae dentro del mercado abierto?

   POR QUÉ EXISTE ESTO. El libro del mercado ordena los consumos por la FECHA
   DE LA COMIDA; el inventario los descuenta el día que se CARGAN. Mientras las
   dos coinciden no pasa nada. Cuando no, el libro y el depósito se separan.

   El 17 y el 19/09/2026 se cargaron 19 comidas con fecha del 11 al 14/09, o
   sea del mercado anterior. El conteo real del 14/09 ya había descontado esa
   mercancía, así que se descontó dos veces: 154,10 unidades de más en Los
   Pinos y 57,11 en La Esperanza, que hubo que devolver a mano.

   Acá solo se detecta el caso para poder AVISAR antes de guardar. No bloquea:
   cargar una comida atrasada es legítimo, lo que hace falta es saber lo que
   implica.
   ============================================================ */

/** Qué tiene de raro la fecha elegida, si es que tiene algo. */
export type FueraDelCiclo = 'antes' | 'despues' | null;

/** El mercado abierto, con su ventana. Solo se miran las dos fechas. */
export interface VentanaMercado {
  numero: number;
  fecha_inicio: string;  // YYYY-MM-DD
  fecha_fin: string;     // YYYY-MM-DD
}

/**
 * ¿La fecha de la comida cae fuera del ciclo del mercado abierto?
 *
 * 'antes'   → es de un mercado anterior: el riesgo del doble descuento.
 * 'despues' → es posterior al cierre previsto del ciclo.
 * null      → está dentro, o no hay con qué comparar.
 */
export function fueraDelCiclo(fecha: string, mercado: VentanaMercado | null | undefined): FueraDelCiclo {
  const f = String(fecha ?? '').slice(0, 10);
  if (!f || !mercado) return null;
  const desde = String(mercado.fecha_inicio ?? '').slice(0, 10);
  const hasta = String(mercado.fecha_fin ?? '').slice(0, 10);
  if (desde && f < desde) return 'antes';
  if (hasta && f > hasta) return 'despues';
  return null;
}

/** El texto del aviso, en criollo y diciendo qué va a pasar. */
export function avisoFueraDelCiclo(caso: FueraDelCiclo, mercado: VentanaMercado | null | undefined): string {
  if (!caso || !mercado) return '';
  const n = mercado.numero;
  if (caso === 'antes') {
    return `Esa fecha es anterior al mercado #${n}, que arrancó el ${dia(mercado.fecha_inicio)}. `
      + 'La comida va a descontar el inventario HOY, pero el libro de este mercado no la va a contar, '
      + 'porque por fecha pertenece al mercado anterior. Si esos víveres ya se contaron en un conteo real, '
      + 'se van a descontar dos veces.';
  }
  return `Esa fecha es posterior al cierre previsto del mercado #${n} (${dia(mercado.fecha_fin)}). `
    + 'El libro de este mercado no la va a contar.';
}

function dia(iso: string): string {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? '');
}
