/* ============================================================
   MGG · RRHH · Minutas · visor de adjuntos

   Lógica pura del visor de imágenes (zoom y rotación) y del reparto de
   archivos de una subida en tanda. Vive aparte del componente para poder
   probarse sola, igual que `minutaBorrador.ts`.
   ============================================================ */

export const ESCALA_MIN = 0.5;
export const ESCALA_MAX = 4;
export const PASO_ESCALA = 0.25;

/** Escala siguiente: un paso arriba o abajo, sin salirse de 0,5–4 ni arrastrar decimales. */
export function escalaSiguiente(actual: number, dir: 1 | -1): number {
  const n = +(actual + dir * PASO_ESCALA).toFixed(2);
  return Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, n));
}

/** Giro siguiente: suma 90° y vuelve a 0 tras la vuelta completa. */
export function giroSiguiente(actual: number): number {
  return (actual + 90) % 360;
}

/**
 * Tamaños del visor, en píxeles. `transform` no cambia el espacio que el
 * navegador reserva, así que una imagen girada 90° sobresale de su caja y esa
 * franja no se puede scrollear. Por eso la caja (lo que el contenedor mide) se
 * calcula ya girada: con 0° y 180° es del tamaño de la imagen y con 90° y 270°
 * intercambia ancho y alto. La imagen se centra dentro de la caja y gira sobre
 * su centro, así que siempre queda adentro.
 *
 * `anchoBase` es el ancho de la imagen a escala 1; `nw`/`nh` su proporción natural.
 */
export function dimensionesVisor(
  giro: number, escala: number, anchoBase: number, nw: number, nh: number,
): { img: { w: number; h: number }; caja: { w: number; h: number } } {
  const w = anchoBase * escala;
  const h = nw > 0 ? (w * nh) / nw : w;
  const deLado = ((giro % 180) + 180) % 180 === 90;
  return { img: { w, h }, caja: deLado ? { w: h, h: w } : { w, h } };
}

/** ¿Se puede mostrar como imagen? Va por el tipo MIME guardado al subir. */
export function esImagenAdjunto(tipo: string | null | undefined): boolean {
  return (tipo ?? '').startsWith('image/');
}

/**
 * Reparte los archivos elegidos entre los que se pueden subir y los rechazados
 * con su motivo. Un rechazado NO frena a los demás.
 */
export function repartirTanda<T extends { name: string }>(
  archivos: T[],
  validar: (f: T) => string | null,
): { validos: T[]; rechazados: { nombre: string; motivo: string }[] } {
  const validos: T[] = [];
  const rechazados: { nombre: string; motivo: string }[] = [];
  for (const f of archivos) {
    const motivo = validar(f);
    if (motivo) rechazados.push({ nombre: f.name, motivo });
    else validos.push(f);
  }
  return { validos, rechazados };
}
