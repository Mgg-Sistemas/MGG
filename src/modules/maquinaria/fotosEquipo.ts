/* ============================================================
   MGG · Maquinaria · Fotos del equipo (reglas puras) · 16-10-2026

   Orden de la administradora: la portada del expediente mostraba el RCV (una
   imagen cargada como DOCUMENTO) en vez del equipo. Las fotos del equipo van
   aparte de los 4 documentos: su propia tabla, hasta 8 por equipo, con orden
   (la 0 es la portada). Se suben desde la cámara o la galería, se eliminan y
   cualquiera se puede volver portada.
   ============================================================ */

/** Máximo de fotos por equipo. */
export const MAX_FOTOS_EQUIPO = 8;

/** Carpeta del bucket `equipos-docs` donde viven las fotos (aparte de los documentos). */
export function rutaFotoEquipo(equipoId: string, sello: string, archivo: string): string {
  const limpio = archivo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'foto.jpg';
  return `fotos/${equipoId}/${sello}-${limpio}`;
}

/** Portada primero (orden 0), después por orden y fecha de carga. */
export function ordenarFotos<T extends { orden: number; created_at: string }>(fotos: T[]): T[] {
  return [...fotos].sort((a, b) => (a.orden - b.orden) || a.created_at.localeCompare(b.created_at));
}

/** Cuántas de las elegidas caben todavía; el resto se descarta con aviso. */
export function cupoFotos<T>(actuales: number, archivos: T[]): { tomar: T[]; descartadas: number } {
  const libres = Math.max(0, MAX_FOTOS_EQUIPO - actuales);
  return { tomar: archivos.slice(0, libres), descartadas: Math.max(0, archivos.length - libres) };
}

export function avisoCupoFotos(descartadas: number): string | null {
  if (descartadas <= 0) return null;
  return descartadas === 1
    ? `Se descartó 1 foto: el equipo admite hasta ${MAX_FOTOS_EQUIPO}.`
    : `Se descartaron ${descartadas} fotos: el equipo admite hasta ${MAX_FOTOS_EQUIPO}.`;
}

/**
 * Al volver portada una foto: ella queda en 0 y las demás corren a 1, 2, 3… en el
 * orden que tenían. Devuelve el orden nuevo de cada id (solo las que cambian).
 */
export function ordenesAlHacerPortada<T extends { id: string; orden: number; created_at: string }>(fotos: T[], portadaId: string): Array<{ id: string; orden: number }> {
  const resto = ordenarFotos(fotos).filter((f) => f.id !== portadaId);
  const nuevo: Array<{ id: string; orden: number }> = [{ id: portadaId, orden: 0 }];
  resto.forEach((f, i) => nuevo.push({ id: f.id, orden: i + 1 }));
  return nuevo.filter((n) => fotos.find((f) => f.id === n.id)?.orden !== n.orden);
}
