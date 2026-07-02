/* ============================================================
   MGG · Ayudas (textos explicativos) — mostrar / ocultar global
   Los "hints" de cada módulo llevan la clase `hint`. Cuando el usuario
   oculta las ayudas (botón "?" del topbar), se agrega la clase
   `ayudas-ocultas` al <body> y el CSS las esconde. La preferencia se
   guarda en localStorage para que persista entre sesiones.
   ============================================================ */
const KEY = 'mgg:ayudas-ocultas';

/** ¿El usuario tiene las ayudas ocultas? (por defecto se muestran). */
export function ayudasOcultas(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Aplica el estado (persiste + clase en el <body>) para que el CSS oculte/muestre. */
export function aplicarAyudas(ocultas: boolean): void {
  try { localStorage.setItem(KEY, ocultas ? '1' : '0'); } catch { /* quota / modo privado */ }
  if (typeof document !== 'undefined') document.body.classList.toggle('ayudas-ocultas', ocultas);
}
