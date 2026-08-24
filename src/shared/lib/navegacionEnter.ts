/* ============================================================
   MGG · Formularios · Enter avanza al campo siguiente
   En los modales, Enter dejaba de ser "siguiente campo" y era
   "enviar": el navegador aplica submit implícito porque el botón
   "Crear solicitud" es type="submit". Como el botón arranca
   deshabilitado, Enter no hacía nada… hasta que el formulario
   quedaba válido, y ahí empezaba a crear solicitudes a medio
   llenar. Los operadores usan Tab y Enter indistintamente.

   Ahora Enter mueve el foco al próximo campo y SOLO envía cuando
   ya no queda ninguno por delante. Tab queda intacto: navega y
   nunca acepta ni guarda.

   La decisión vive en `decidirEnter`, que NO toca el DOM: recibe
   un retrato de los campos y devuelve qué hacer. Así se prueba
   entera en node (el proyecto no tiene jsdom) y lo que sí toca
   el DOM queda en unas pocas líneas sin reglas de negocio.

   Uso:  <form onSubmit={h} onKeyDown={enterAvanzaCampo({ enviando: saving })}>
   ============================================================ */

import type { KeyboardEventHandler } from 'react';

/** <input> que en realidad son botones o no se recorren: Enter no los trata como campo. */
const TIPOS_NO_CAMPO = new Set(['submit', 'reset', 'button', 'image', 'file', 'hidden']);

/** Campos de texto donde, al llegar, se selecciona el contenido (igual que hace Tab). */
const TIPOS_SELECCIONABLES = new Set(['text', 'search', 'tel', 'url', 'password', 'number']);

/* ─────────────────── Parte pura · sin DOM ─────────────────── */

/** Retrato mínimo de un elemento enfocable. Datos planos: se arma igual en un test que en el navegador. */
export interface CampoEnfocable {
  /** tagName tal cual: 'INPUT' | 'SELECT' | 'TEXTAREA'. */
  tag: string;
  /** input.type en minúscula ('text', 'number', 'date', 'checkbox'…). '' en select y textarea. */
  tipo: string;
  deshabilitado: boolean;
  soloLectura: boolean;
  /** tabIndex efectivo. Negativo = fuera del recorrido (ej. "Saldo resultante"). */
  tabIndex: number;
  /** ¿Ocupa lugar en pantalla? Descarta las ramas condicionales ocultas. */
  visible: boolean;
  /** Está dentro de un [data-enter-omitir]: es un alta inline, ahí Enter significa "añadir". */
  omitido: boolean;
}

export type AccionEnter =
  | 'ignorar'   // no tocar el evento: que el navegador haga lo suyo (salto de línea, activar botón)
  | 'avanzar'   // preventDefault + foco al campo `destino`
  | 'enviar'    // preventDefault + enviar el formulario
  | 'bloquear'; // preventDefault y nada más

/** Por qué se decidió así. Existe para que los tests afirmen la intención, no solo el efecto. */
export type MotivoEnter =
  | 'no-es-enter' | 'sin-campos' | 'ime' | 'repetida' | 'ya-consumido'
  | 'con-alt' | 'atajo-ctrl' | 'con-ctrl' | 'con-shift'
  | 'no-es-campo' | 'textarea' | 'avanza' | 'guardando' | 'ultimo-campo';

export interface DecisionEnter {
  accion: AccionEnter;
  /** Solo con 'avanzar': índice en el array ORIGINAL (sin filtrar) del campo a enfocar. -1 si no aplica. */
  destino: number;
  motivo: MotivoEnter;
}

export interface ContextoEnter {
  tecla: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /** ¿Un hijo ya consumió el Enter? (e.defaultPrevented) */
  yaConsumido: boolean;
  /** Auto-repetición por tecla mantenida. */
  repetida: boolean;
  /** Composición IME en curso (tildes y ñ con tecla muerta). */
  componiendo: boolean;
  /** Todos los input/select/textarea del contenedor, en orden de documento, SIN filtrar. */
  campos: readonly CampoEnfocable[];
  /** Índice en `campos` del elemento que recibió la tecla. -1 si no está (un <button>, por ejemplo). */
  indiceOrigen: number;
  /** ¿Hay un guardado en vuelo? Bloquea el envío para no duplicar la solicitud. */
  enviando: boolean;
  /** Ctrl/⌘+Enter envía desde cualquier campo (única salida de teclado en un textarea). */
  atajoCtrlEnter: boolean;
}

/**
 * ¿Este elemento participa del recorrido de Enter, como origen y como destino?
 * Mismo criterio que Tab (deshabilitado, readOnly, tabIndex negativo, oculto),
 * más dos exclusiones propias: los <input> que son botones y las altas inline.
 */
export function esCampoNavegable(c: CampoEnfocable): boolean {
  if (c.deshabilitado || c.soloLectura) return false;
  if (c.tabIndex < 0) return false;
  if (!c.visible) return false;
  if (c.omitido) return false;
  if (c.tag === 'SELECT' || c.tag === 'TEXTAREA') return true;
  if (c.tag !== 'INPUT') return false;
  return !TIPOS_NO_CAMPO.has(c.tipo);
}

/**
 * Decide qué hacer con una pulsación. Función pura: mismos datos → misma decisión.
 * El ORDEN de las reglas es parte del contrato (los tests lo fijan).
 */
export function decidirEnter(ctx: ContextoEnter): DecisionEnter {
  const nada = (motivo: MotivoEnter, accion: AccionEnter = 'ignorar'): DecisionEnter =>
    ({ accion, destino: -1, motivo });

  // 1 · Tab, Escape, flechas y letras: intactas. Es la garantía de que Tab nunca envía.
  if (ctx.tecla !== 'Enter') return nada('no-es-enter');
  // 2 · Enter cierra la composición IME; interceptarlo se come la letra acentuada.
  if (ctx.componiendo) return nada('ime');
  // 3 · Enter mantenido no debe recorrer el formulario a ráfaga ni encadenar envíos.
  if (ctx.repetida) return nada('repetida', 'bloquear');
  // 4 · Regla central: SearchSelect y los 12 "+ Añadir" inline hacen preventDefault sin
  //     stopPropagation, así que llegan hasta acá marcados. Siguen funcionando sin editarlos.
  if (ctx.yaConsumido) return nada('ya-consumido');
  // 5 · Alt+Enter es atajo del sistema.
  if (ctx.alt) return nada('con-alt');
  // 6 · Ctrl/⌘+Enter: única forma de enviar con el teclado desde un <textarea>.
  if ((ctx.ctrl || ctx.meta) && ctx.atajoCtrlEnter) {
    return ctx.enviando ? nada('guardando', 'bloquear') : nada('atajo-ctrl', 'enviar');
  }
  if (ctx.ctrl || ctx.meta) return nada('con-ctrl');
  // 7 · Shift+Enter no es "avanzar".
  if (ctx.shift) return nada('con-shift');

  if (ctx.campos.length === 0) return nada('sin-campos');

  const origen = ctx.indiceOrigen >= 0 ? ctx.campos[ctx.indiceOrigen] : undefined;
  // 8 · Vino de un <button> (✕, + Añadir, ＋ Agregar material) o de un campo excluido:
  //     que el navegador lo active, que es lo accesible y lo que el usuario espera.
  if (!origen || !esCampoNavegable(origen)) return nada('no-es-campo');
  // 9 · En un textarea Enter escribe un salto de línea. Misma excepción que el
  //     precedente del proyecto (MaterialAProducirModal).
  if (origen.tag === 'TEXTAREA') return nada('textarea');

  // 10 · Caso general: al próximo campo. Los <button> no son destino a propósito —
  //      aterrizar en el ✕ haría que el Enter siguiente borrase una fila de material.
  for (let i = ctx.indiceOrigen + 1; i < ctx.campos.length; i++) {
    if (esCampoNavegable(ctx.campos[i])) return { accion: 'avanzar', destino: i, motivo: 'avanza' };
  }

  // 11 · Ya no quedan campos: se envía, salvo que haya un guardado en vuelo.
  if (ctx.enviando) return nada('guardando', 'bloquear');
  return nada('ultimo-campo', 'enviar');
}

/* ───────────── Cáscara · lo único que toca el DOM ───────────── */

const SELECTOR_CAMPOS = 'input, select, textarea';

/** Traduce un elemento real a datos planos. Único punto donde se lee el DOM. */
function retratar(el: HTMLElement): CampoEnfocable {
  const campo = el as HTMLInputElement; // en select/textarea, type/readOnly quedan undefined
  return {
    tag: el.tagName,
    tipo: el.tagName === 'INPUT' ? (campo.type || '').toLowerCase() : '',
    deshabilitado: Boolean(campo.disabled),
    soloLectura: Boolean(campo.readOnly),
    tabIndex: el.tabIndex,
    // getClientRects() cubre display:none, hidden y desmontado. Solo se llama cuando
    // la tecla YA es Enter, nunca al tipear.
    visible: el.getClientRects().length > 0,
    omitido: el.closest('[data-enter-omitir]') !== null,
  };
}

function enfocar(el: HTMLElement | undefined): void {
  if (!el) return;
  el.focus();
  // Igual que al llegar con Tab: el contenido queda seleccionado para escribir encima.
  const inp = el as HTMLInputElement;
  if (el.tagName === 'INPUT' && TIPOS_SELECCIONABLES.has((inp.type || '').toLowerCase())) {
    try { inp.select(); } catch { /* algunos navegadores no permiten select en number */ }
  }
}

function enviarFormulario(raiz: HTMLElement): void {
  const form = raiz instanceof HTMLFormElement ? raiz : raiz.closest('form');
  if (!form) return; // contenedor sin form: Enter no hace nada (seguro por construcción)
  // requestSubmit dispara la validación nativa (required) y luego onSubmit. A diferencia
  // del envío implícito, NO mira si el botón por defecto está deshabilitado: por eso el
  // formulario SIEMPRE llega a validar y a mostrar su error, en vez de quedarse mudo.
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

export interface OpcionesEnter {
  /** El `saving` del formulario. Con true, Enter no envía (evita solicitudes duplicadas). */
  enviando?: boolean;
  /** Habilita Ctrl/⌘+Enter como envío directo. Por defecto true. */
  atajoCtrlEnter?: boolean;
}

/** Manejador para el <form> del modal. Se llama en el render; no necesita estado ni memo. */
export function enterAvanzaCampo<T extends HTMLElement = HTMLFormElement>(
  opciones: OpcionesEnter = {},
): KeyboardEventHandler<T> {
  return (e) => {
    // Con cualquier otra tecla el manejador es inerte y ni siquiera lee el DOM.
    if (e.key !== 'Enter') return;

    const raiz = e.currentTarget;
    const elementos = Array.from(raiz.querySelectorAll<HTMLElement>(SELECTOR_CAMPOS));
    const { accion, destino } = decidirEnter({
      tecla: e.key,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      shift: e.shiftKey,
      alt: e.altKey,
      yaConsumido: e.defaultPrevented,
      repetida: e.repeat,
      // React no expone isComposing en su evento sintético: se lee del nativo.
      componiendo: e.nativeEvent.isComposing || e.keyCode === 229,
      campos: elementos.map(retratar),
      indiceOrigen: elementos.indexOf(e.target as HTMLElement),
      enviando: opciones.enviando ?? false,
      atajoCtrlEnter: opciones.atajoCtrlEnter ?? true,
    });

    if (accion === 'ignorar') return;
    e.preventDefault(); // a partir de acá el envío lo decidimos nosotros
    if (accion === 'avanzar') enfocar(elementos[destino]);
    else if (accion === 'enviar') enviarFormulario(raiz);
    // 'bloquear': ya se hizo preventDefault, nada más.
  };
}
