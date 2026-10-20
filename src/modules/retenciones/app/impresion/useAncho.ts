/* ============================================================
   MGG · Retenciones · El ancho disponible de un contenedor

   Para que la hoja de la vista previa y la gráfica se ajusten al ancho de la
   pantalla, como la maqueta (v8AjustarEscalaVista, v8EscalarPaginas y el
   ancho del diálogo en v8AbrirAnalisis): se mide el contenedor y se vuelve
   a medir cuando cambia (girar el teléfono, cambiar el tamaño de la ventana).
   ============================================================ */

import { useLayoutEffect, useState, type RefObject } from 'react';

export function useAncho(ref: RefObject<HTMLElement | null>, inicial: number): number {
  const [ancho, setAncho] = useState(inicial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => { if (el.clientWidth > 0) setAncho(el.clientWidth); };
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return ancho;
}

/** La escala para que una hoja de `anchoHoja` px quepa en `disponible` px (nunca agranda). */
export const escalaPara = (disponible: number, anchoHoja: number, relleno = 16): number =>
  Math.max(0.2, Math.min(1, (disponible - relleno) / anchoHoja));
