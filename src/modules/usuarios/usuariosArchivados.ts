import type { Usuario } from '@/shared/lib/types';

/**
 * Usuarios archivados.
 *
 * Deshabilitar y archivar son dos pasos distintos: un usuario deshabilitado
 * sigue a la vista en la tabla (puede ser algo temporal); archivarlo lo saca
 * de ahí y lo guarda en su propio apartado, donde se puede buscar, desarchivar
 * o habilitar de vuelta. Solo se archivan usuarios deshabilitados, y habilitar
 * desarchiva: nunca queda un usuario activo escondido en el archivo.
 * Este módulo es la parte pensable de esa pantalla: qué se ve y cómo se
 * filtra, sin tocar la red.
 */

export function estaArchivado(u: Usuario): boolean {
  return Boolean(u.archivado_en);
}

/** Solo un deshabilitado que aún está en la tabla puede archivarse. */
export function puedeArchivarse(u: Usuario): boolean {
  return u.estado === 'inactivo' && !estaArchivado(u);
}

export interface FiltroArchivados {
  /** Búsqueda libre por palabras sobre nombre, correo, CI, rol y quién archivó. */
  texto: string;
  /** Correo de quien lo archivó. */
  porQuien: string;
  /** Rango de fecha de archivo, en formato AAAA-MM-DD (los dos extremos incluidos). */
  desde: string;
  hasta: string;
}

export const FILTRO_ARCHIVADOS_VACIO: FiltroArchivados = {
  texto: '', porQuien: '', desde: '', hasta: '',
};

/** Todo lo que se puede escribir en el buscador y encontrar al usuario. */
export function caracteristicasUsuario(u: Usuario): string {
  return [
    u.nombre, u.apellido, u.email, u.ci, u.role, u.departamento, u.archivado_por,
  ].filter(Boolean).map((s) => String(s).toLowerCase()).join(' ');
}

/** La fecha de archivo recortada a AAAA-MM-DD, o vacío si no quedó registrada. */
export function diaDeArchivo(u: Usuario): string {
  return (u.archivado_en ?? '').slice(0, 10);
}

/** ¿Este usuario archivado pasa los filtros de la pantalla? */
export function coincideArchivado(u: Usuario, f: FiltroArchivados): boolean {
  if (f.porQuien && (u.archivado_por ?? '') !== f.porQuien) return false;
  const dia = diaDeArchivo(u);
  if (f.desde && dia < f.desde) return false;
  if (f.hasta && dia > f.hasta) return false;
  const q = f.texto.trim().toLowerCase();
  if (q) {
    const heno = caracteristicasUsuario(u);
    if (!q.split(/\s+/).filter(Boolean).every((t) => heno.includes(t))) return false;
  }
  return true;
}

/** Los archivados, filtrados y ordenados: primero los archivos más recientes. */
export function archivadosFiltrados(usuarios: Usuario[], f: FiltroArchivados): Usuario[] {
  return usuarios
    .filter((u) => estaArchivado(u) && coincideArchivado(u, f))
    .sort((a, b) => {
      const da = diaDeArchivo(a), db = diaDeArchivo(b);
      if (da !== db) return db.localeCompare(da);
      return (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es');
    });
}

/** Correos que archivaron a alguien, para el desplegable sin opciones muertas. */
export function quienesArchivaron(usuarios: Usuario[]): string[] {
  const vistos = new Set<string>();
  for (const u of usuarios) {
    if (!estaArchivado(u)) continue;
    const v = (u.archivado_por ?? '').trim();
    if (v) vistos.add(v);
  }
  return [...vistos].sort((a, b) => a.localeCompare(b, 'es'));
}
