/* ============================================================
   MGG · Retenciones v8 · Los rótulos del archivo de una retención

   Como la maqueta (v6AccionesCasilla): la retención de un cliente se
   respalda con SU PDF («📎 PDF del cliente», la marca «Sin PDF», «Adjuntar
   PDF» o «Reemplazar PDF»); la practicada, con su archivo adjunto («📎
   Archivo» o «Adjuntar», como hoy). Una anulada no se adjunta.
   ============================================================ */

export interface RotulosArchivo {
  /** El botón para ver el archivo; null si no hay. */
  ver: string | null;
  /** La marca cuando falta el archivo; null si no se marca. */
  sinArchivo: string | null;
  /** El botón para adjuntar o reemplazar; null si no se ofrece. */
  adjuntar: string | null;
}

export function rotulosArchivo(r: { direccion: string; tieneArchivo: boolean; anulada: boolean }): RotulosArchivo {
  if (r.direccion === 'recibida') {
    return {
      ver: r.tieneArchivo ? '📎 PDF del cliente' : null,
      sinArchivo: r.tieneArchivo ? null : 'Sin PDF',
      adjuntar: r.anulada ? null : r.tieneArchivo ? 'Reemplazar PDF' : 'Adjuntar PDF',
    };
  }
  return { ver: r.tieneArchivo ? '📎 Archivo' : null, sinArchivo: null, adjuntar: !r.tieneArchivo && !r.anulada ? 'Adjuntar' : null };
}
