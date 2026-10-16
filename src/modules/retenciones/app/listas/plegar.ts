/* ============================================================
   Retenciones · Lo que se despliega se puede plegar (R3-15), lógica pura

   Traslado de la maqueta v8 (`v8-6-plegar.js`):
   - «Ver todo (N)» ↔ «Mostrar menos», en el mismo lugar, con `aria-expanded`;
   - «Requiere atención» con su conteo a la vista también plegado;
   - el estado se recuerda mientras dure la página; por defecto,
     desplegado si hay vencidos y plegado si no.
   ============================================================ */

/** El texto del botón: «Mostrar menos» abierto; cerrado, «Ver todo (N)» o el que se indique. */
export function textoPlegar(abierto: boolean, n: number, cerrado: (n: number) => string = (x) => `Ver todo (${x})`): string {
  return abierto ? 'Mostrar menos' : cerrado(n);
}

/** Lo recordado manda; si no hay nada recordado, el valor por defecto. */
export function abiertoInicial(recordado: boolean | null | undefined, porDefecto: boolean): boolean {
  return recordado ?? porDefecto;
}

/** Por defecto: desplegado si hay vencidos, plegado si no. */
export const abiertoPorVencidos = (vencidos: number): boolean => vencidos > 0;

/**
 * El conteo de «Requiere atención», que se ve también plegado:
 * «· 2 vencido(s) · 1 por vencer · 1 sin paso inicial» o «· nada vencido».
 */
export function resumenAtencion({ vencidos, porVencer = 0, sinPaso = 0 }: { vencidos: number; porVencer?: number; sinPaso?: number }): string {
  return `· ${vencidos ? `${vencidos} vencido(s)` : 'nada vencido'}${porVencer ? ` · ${porVencer} por vencer` : ''}${sinPaso ? ` · ${sinPaso} sin paso inicial` : ''}`;
}

/* ───────── Lo plegado se recuerda mientras dure la página (no se guarda en el navegador) ───────── */

const recordados = new Map<string, boolean>();
const oyentes = new Set<() => void>();

/** Lo recordado para una clave (undefined si nunca se tocó). */
export function plegadoRecordado(clave: string): boolean | undefined {
  return recordados.get(clave);
}

/** Recuerda si `clave` quedó abierta. */
export function recordarPlegado(clave: string, abierto: boolean): void {
  recordados.set(clave, abierto);
  oyentes.forEach((f) => f());
}

/** Suscripción a los cambios (para `useSyncExternalStore`). */
export function suscribirPlegado(f: () => void): () => void {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

/** Solo para las pruebas: olvida todo lo recordado. */
export function olvidarPlegados(): void {
  recordados.clear();
  oyentes.forEach((f) => f());
}
