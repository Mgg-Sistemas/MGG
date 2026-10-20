/* ============================================================
   MGG · Montos escritos a la venezolana (coma decimal, punto de miles).
   Un solo lector para los campos de precio de Compras: `1.234,56`, `1234,56`,
   `12,5`, `6.5` y `1,234.56` valen lo que el usuario quiso decir. NO redondea:
   el precio unitario de un proveedor puede traer 3 o 4 decimales (10,2648).
   ============================================================ */

/** Deja dígitos, punto y coma (y el signo menos al inicio si `conSigno`). No decide separadores. */
export function limpiarMontoEs(s: string, conSigno = false): string {
  const raw = String(s ?? '');
  const neg = conSigno && raw.trim().startsWith('-');
  const out = raw.replace(/[^\d.,]/g, '');
  return neg ? `-${out}` : out;
}

/**
 * Texto → número.
 *  · Con punto Y coma: el ÚLTIMO es el decimal y el otro es de miles (1.234,56 · 1,234.56).
 *  · Solo comas: una sola = decimal (12,5); varias = miles (1,234,567).
 *  · Solo puntos: varios = miles (1.234.567); uno solo = decimal (6.5, 0.48, 1234.56),
 *    salvo que sea `N.NNN` con N de 1 a 3 cifras distintas de 0 (2.500 = dos mil quinientos).
 * Vacío o basura = 0.
 */
export function parseMontoEs(s: string | null | undefined): number {
  const txt = String(s ?? '').replace(/\s/g, '');
  const neg = txt.startsWith('-');
  const raw = txt.replace(/[^\d.,]/g, '');
  if (!raw) return 0;
  const puntos = (raw.match(/\./g) ?? []).length;
  const comas = (raw.match(/,/g) ?? []).length;
  let entero = raw;
  let dec = '';
  if (puntos > 0 && comas > 0) {
    const sep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
    entero = raw.slice(0, sep).replace(/[.,]/g, '');
    dec = raw.slice(sep + 1).replace(/[.,]/g, '');
  } else if (comas === 1) {
    const sep = raw.indexOf(',');
    entero = raw.slice(0, sep);
    dec = raw.slice(sep + 1);
  } else if (comas > 1) {
    entero = raw.replace(/,/g, '');
  } else if (puntos === 1) {
    const sep = raw.indexOf('.');
    const izq = raw.slice(0, sep);
    const der = raw.slice(sep + 1);
    const esMiles = der.length === 3 && /^[1-9]\d{0,2}$/.test(izq);
    if (esMiles) entero = izq + der;
    else { entero = izq; dec = der; }
  } else if (puntos > 1) {
    entero = raw.replace(/\./g, '');
  }
  const n = Number(`${entero || '0'}${dec ? `.${dec}` : ''}`);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** Número → texto con coma decimal, listo para mostrar en el campo. Vacío si es 0. */
export function montoAStrEs(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '';
  return String(v).replace('.', ',');
}
