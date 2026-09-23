/* ============================================================
   MGG · Buscar por texto libre

   La misma idea en todas las pantallas: el usuario NO se acuerda de en qué
   columna estaba el dato, se acuerda del dato. Así que se arma un solo texto
   con todo lo que la fila sabe de sí misma y se busca ahí.

   Dos reglas que no son obvias:
   · Varias palabras se exigen TODAS, en cualquier orden. «esperanza big» trae
     los big bags de La Esperanza aunque en la fila estén al revés.
   · Los números se guardan en las varias formas en que alguien los teclea:
     como los muestra la tabla («1.048,50»), sin el punto de los miles
     («1048,50») y con punto decimal («1048.5»). Nadie escribe el separador
     de miles cuando busca.
   ============================================================ */

/** Sin acentos, en minúscula y sin espacios de los lados. */
export function normalizarBusqueda(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

/** Las palabras de una búsqueda, ya normalizadas. */
export function palabrasDe(q: string): string[] {
  return normalizarBusqueda(q).split(/\s+/).filter(Boolean);
}

/** ¿El texto contiene TODAS las palabras de la búsqueda? Sin búsqueda, sí. */
export function coincideTodo(texto: string, q: string): boolean {
  const ps = palabrasDe(q);
  if (!ps.length) return true;
  return ps.every((p) => texto.includes(p));
}

/** Un número escrito de las varias maneras en que alguien lo buscaría. */
export function formasDeNumero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  const conComa = v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sinMiles = conComa.replace(/\./g, '');
  return [String(v), conComa, sinMiles, sinMiles.replace(',', '.')].join(' ');
}

/** Junta las partes de una fila en un solo texto comparable. */
export function textoBuscable(partes: Array<unknown>): string {
  return normalizarBusqueda(partes.filter((x) => x !== '' && x != null).join(' '));
}
