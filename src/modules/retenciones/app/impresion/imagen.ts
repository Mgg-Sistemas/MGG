/* ============================================================
   MGG · Retenciones · Impresión · La hoja como imagen (PNG)

   Pedido del usuario (20/10 13:40): «Por favor incluir su version png o
   descargar imagen». Se captura con html2canvas (ya está en el proyecto, como
   en el manual de AppShell) a escala 2, sobre fondo blanco: la hoja tal como
   sale impresa, sin la marca de la vista previa y con «EJEMPLO» si es de
   ejemplo. El comprobante es una imagen; la relación, una por hoja de
   columnas (la 1.ª y la 2.ª del ejemplar), cada una con todas sus filas.
   La descarga es a pedido, por botón.
   ============================================================ */

import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import type { Impuesto } from './tipos';

const sigla = (imp: Impuesto | string) => (imp === 'isae' ? 'ISAE' : nombreImpuesto(imp));

export const nombreImagenComprobante = (imp: Impuesto, numero: string): string => `comprobante-${sigla(imp)}-${numero || 'sin-numero'}`;
export const nombreImagenRelacion = (imp: Impuesto, desde: string): string => `relacion-${sigla(imp)}-${desde.slice(0, 7).replace('-', '')}`;

/** Los nombres de los archivos: uno solo, o uno por hoja de columnas. */
export function nombresImagenes(base: string, n: number): string[] {
  return n <= 1 ? [`${base}.png`] : Array.from({ length: n }, (_, i) => `${base}-hoja-${i + 1}.png`);
}

/** Captura cada elemento y descarga su PNG (escala 2, fondo blanco). */
export async function descargarImagenes(elementos: HTMLElement[], base: string): Promise<void> {
  const { default: html2canvas } = await import('html2canvas');
  const nombres = nombresImagenes(base, elementos.length);
  for (let i = 0; i < elementos.length; i++) {
    const el = elementos[i];
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: el.offsetWidth, height: el.offsetHeight });
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('No se pudo generar la imagen.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombres[i];
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
