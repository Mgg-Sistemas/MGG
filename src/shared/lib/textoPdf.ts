/* ============================================================
   MGG · Texto seguro para los PDF

   jsPDF con las fuentes estándar (Helvetica) solo sabe escribir
   Windows-1252. Cuando aparece un carácter fuera de ese juego —el
   subíndice ₃ de «CACO₃», por ejemplo— no solo lo dibuja mal (sale
   una ƒ): además pierde el ancho de los caracteres y el renglón entero
   se abre, letra por letra:

       C A R B O N A T O   D E   C A L C I O   ( C A C O ƒ )

   Acá se traduce el texto a algo que la fuente sí sabe escribir:
   subíndices y superíndices a dígitos normales, comillas y guiones
   tipográficos a los que existen en Windows-1252, y los acentos que
   no entran se descomponen (á → a) en vez de desaparecer.
   ============================================================ */

/** Los caracteres del rango 0x80–0x9F de Windows-1252, que sí se pueden escribir. */
const CP1252_ALTOS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ\u2018\u2019\u201C\u201D•–—˜™š›œžŸ';

/** Reemplazos directos: lo que la fuente no tiene, escrito de otra manera. */
const REEMPLAZOS: Record<string, string> = {
  // Subíndices — el caso de CACO₃, H₂O, SnO₂.
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  // Superíndices que no están en Windows-1252 (¹ ² ³ sí están y se dejan).
  '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  // Flechas y signos que aparecen en descripciones y notas.
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>',
  '≈': '~', '≤': '<=', '≥': '>=', '≠': '!=',
  '⁄': '/', '∙': '·', '∞': 'inf',
  // Espacios que no son el espacio normal: rompen el corte de línea.
  '\u00A0': ' ', '\u2007': ' ', '\u202F': ' ', '\u2009': ' ', '\u200B': '',
};

const escribible = (ch: string): boolean => ch.charCodeAt(0) < 256 || CP1252_ALTOS.includes(ch);

/**
 * Texto listo para escribir en un PDF con las fuentes estándar de jsPDF.
 *
 * Lo que la fuente sabe escribir pasa igual. Lo que no, se traduce; y si no hay
 * traducción, se descompone para quedarse con la letra base (á → a). Solo se
 * descarta lo que no tiene ningún equivalente razonable.
 */
export function textoPdf(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  let out = '';
  for (const ch of s) {
    // El reemplazo manda: el espacio duro y el · matemático son escribibles,
    // pero igual conviene cambiarlos por el normal (uno rompe el corte de línea).
    const directo = REEMPLAZOS[ch];
    if (directo !== undefined) { out += directo; continue; }
    if (escribible(ch)) { out += ch; continue; }
    // Sin reemplazo: se descompone (á = a + tilde) y se conserva lo escribible.
    const desc = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    for (const c of desc) if (escribible(c)) out += c;
  }
  return out;
}

/** Aplica `textoPdf` a cada celda de una fila de tabla. */
export function filaPdf(fila: unknown[]): string[] {
  return fila.map((c) => textoPdf(c));
}
