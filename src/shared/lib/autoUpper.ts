/**
 * MAYÚSCULA automática global: cualquier campo de texto del sistema pasa a
 * mayúsculas a medida que se escribe, sin tener que tocar cada input.
 *
 * Cómo funciona: un único listener en fase de CAPTURA sobre `document` corre
 * ANTES del manejador de React. Reescribe `el.value` a mayúsculas, así cuando
 * React lee `e.target.value` en su `onChange` ya recibe el texto en mayúscula y
 * lo guarda en el estado (queda en mayúscula también en tablas, PDFs y BD).
 *
 * Se excluyen los campos donde la mayúscula no corresponde: correos, claves,
 * búsquedas, números/fechas, y cualquier campo con la clase `no-upper` o el
 * atributo `data-no-upper`.
 */

// Tipos de <input> que nunca se transforman.
const TIPOS_EXCLUIDOS = new Set([
  'email', 'password', 'number', 'date', 'datetime-local', 'month', 'week',
  'time', 'tel', 'url', 'search', 'range', 'color', 'file', 'checkbox', 'radio',
]);

// Pistas (placeholder/name/autocomplete) que indican un campo a excluir.
const PISTA_EXCLUIR = /buscar|search|correo|e-?mail|contrase|password/i;

function debeExcluir(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el instanceof HTMLInputElement && TIPOS_EXCLUIDOS.has(el.type)) return true;
  if (el.dataset.noUpper !== undefined || el.classList.contains('no-upper')) return true;
  if (el.closest('[data-no-upper]')) return true;
  const pista = `${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('name') ?? ''} ${el.getAttribute('autocomplete') ?? ''}`;
  return PISTA_EXCLUIR.test(pista);
}

function onInput(e: Event) {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (debeExcluir(el)) return;
  const v = el.value;
  const up = v.toUpperCase();
  if (up === v) return; // números, símbolos, ya en mayúscula → no tocar (no mueve el cursor)
  const ini = el.selectionStart;
  const fin = el.selectionEnd;
  el.value = up;
  // La longitud no cambia al pasar a mayúscula: restauramos el cursor donde estaba.
  try { if (ini !== null && fin !== null) el.setSelectionRange(ini, fin); } catch { /* tipo sin selección */ }
}

/** Instala la mayúscula automática (llamar una vez al arrancar la app). */
export function instalarMayusculaAutomatica(): void {
  document.addEventListener('input', onInput, true);
}
