/* ============================================================
   Retenciones · Diálogos (R3-8), lógica pura

   Traslado de la maqueta v8 (`v8-4-dialogos-registro.js`, § 2):
   - el hijo se cierra y vuelve al padre, con lo escrito intacto;
   - Cancelar, Escape, «Cerrar» y el clic fuera preguntan si hay cambios
     sin guardar: «Hay cambios sin guardar. ¿Descartarlos?»;
   - sin cambios, cierran sin preguntar;
   - buscar, filtrar o paginar dentro de un diálogo no cuenta como cambio.
   ============================================================ */

/** Los valores de botón que cierran sin guardar. */
export const VALORES_DE_CIERRE = ['cancelar', 'cerrar'] as const;

/** Los controles de las listas: cambiarlos no es «cambios sin guardar». */
export const SELECTOR_CONTROLES_DE_LISTA = '[data-v8-q], [data-v8-tq], [data-v8-filtro], [data-v8-tam], [data-v8-ir-n]';

/** Los textos del diálogo de confirmación. */
export const TEXTOS_DESCARTE = {
  titulo: 'Cambios sin guardar',
  pregunta: 'Hay cambios sin guardar. ¿Descartarlos?',
  descartar: 'Descartar',
  seguir: 'Seguir editando',
} as const;

/** ¿Este valor de botón cierra sin guardar? (vacío = Escape o clic fuera). */
export function esCierre(valor: string | null | undefined): boolean {
  const v = String(valor ?? '');
  return !v || (VALORES_DE_CIERRE as readonly string[]).includes(v);
}

/**
 * Qué hacer con un pedido de cierre:
 * - 'enviar': no es un cierre (guardar, aplicar…): decide la pantalla;
 * - 'preguntar': hay cambios protegidos: «¿Descartarlos?»;
 * - 'cerrar': se cierra sin preguntar.
 */
export function decidirCierre(valor: string | null | undefined, sucio: boolean, protegido = true): 'enviar' | 'preguntar' | 'cerrar' {
  if (!esCierre(valor)) return 'enviar';
  return protegido && sucio ? 'preguntar' : 'cerrar';
}

/** ¿El punto cae dentro del rectángulo del diálogo? Fuera = clic en el fondo. */
export function dentroDe(x: number, y: number, r: { left: number; right: number; top: number; bottom: number }): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
