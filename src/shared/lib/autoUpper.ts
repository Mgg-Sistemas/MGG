/**
 * MAYÚSCULA automática global: cualquier campo de texto del sistema pasa a
 * mayúsculas a medida que se escribe, sin tener que tocar cada input.
 *
 * Cómo funciona: un único listener en fase de CAPTURA sobre `document` corre
 * ANTES del manejador de React. Reescribe el valor a mayúsculas, así cuando
 * React lee `e.target.value` en su `onChange` ya recibe el texto en mayúscula y
 * lo guarda en el estado (queda en mayúscula también en tablas, PDFs y BD).
 *
 * Dos cuidados clave (si no, "se borra lo que se escribe"):
 *  1) NO mutar el value con `el.value = ...` directo: eso pasa por el value-tracker
 *     de React y le sincroniza el valor, con lo cual React cree que NO hubo cambio,
 *     no dispara `onChange`, el estado no se actualiza y el render vuelve a pisar el
 *     input con el estado viejo (parece que "borra"). Usamos el setter NATIVO del
 *     prototipo, que NO toca el tracker → React sí ve el cambio y dispara `onChange`.
 *  2) NO tocar el value en medio de una composición IME (tildes con tecla muerta:
 *     JOSÉ, GARCÍA, MUÑOZ, PEÑA…): abortaría la composición y se pierde la letra.
 *     Se espera al `compositionend`.
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

/**
 * Setea el value con el setter NATIVO del prototipo (no el de React). Así React
 * detecta el cambio en su `onChange` (su value-tracker queda "desactualizado" a
 * propósito) y guarda el texto en el estado en vez de descartarlo.
 */
function setValueNativo(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value; // fallback improbable
}

function aMayuscula(target: EventTarget | null): void {
  const el = target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (debeExcluir(el)) return;
  const v = el.value;
  const up = v.toUpperCase();
  if (up === v) return; // números, símbolos, ya en mayúscula → no tocar (no mueve el cursor)
  const ini = el.selectionStart;
  const fin = el.selectionEnd;
  setValueNativo(el, up);
  // La longitud no cambia al pasar a mayúscula: restauramos el cursor donde estaba.
  try { if (ini !== null && fin !== null) el.setSelectionRange(ini, fin); } catch { /* tipo sin selección */ }
}

function onInput(e: Event): void {
  // En plena composición IME (tecla muerta de tilde) NO tocamos el value:
  // se procesa al cerrar la composición (compositionend).
  if ((e as InputEvent).isComposing) return;
  aMayuscula(e.target);
}

function onCompositionEnd(e: Event): void {
  // Ya quedó la letra acentuada: ahora sí pasamos a mayúscula (idempotente).
  aMayuscula(e.target);
}

/** Instala la mayúscula automática (llamar una vez al arrancar la app). */
export function instalarMayusculaAutomatica(): void {
  document.addEventListener('input', onInput, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
}
