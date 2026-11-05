/* ============================================================
   MGG · RRHH · Minutas · filtros del histórico

   Lógica pura: dado el listado y los filtros, devuelve lo que se ve.
   Vive aparte del componente para poder probarse sola.
   ============================================================ */
import { norm } from '@/shared/lib/texto';
import type { Minuta } from '@/shared/lib/types';
import { hoyVE, tieneAcuerdosPendientes } from './minutaModelo';

export interface FiltrosMinutas {
  desde: string;
  hasta: string;
  estado: '' | 'borrador' | 'finalizada';
  persona: string;
  soloPendientes: boolean;
  palabra: string;
}

export const FILTROS_VACIOS: FiltrosMinutas = {
  desde: '', hasta: '', estado: '', persona: '', soloPendientes: false, palabra: '',
};

/** ¿Alguien participó o es responsable de un acuerdo con ese nombre (sin importar acentos)? */
function involucra(m: Minuta, q: string): boolean {
  return (m.participantes ?? []).some((p) => norm(p.nombre).includes(q))
    || (m.acuerdos ?? []).some((a) => norm(a.responsable).includes(q));
}

export function filtrarMinutas<T extends Minuta>(lista: T[], f: FiltrosMinutas, hoy: Date = new Date()): T[] {
  const persona = norm(f.persona).trim();
  const palabra = norm(f.palabra).trim();
  return lista.filter((m) => {
    if (f.desde && m.fecha < f.desde) return false;
    if (f.hasta && m.fecha > f.hasta) return false;
    if (f.estado && m.estado !== f.estado) return false;
    if (persona && !involucra(m, persona)) return false;
    if (f.soloPendientes && !tieneAcuerdosPendientes(m, hoy)) return false;
    if (palabra && !(m.busq ?? '').includes(palabra)) return false;
    return true;
  });
}

export interface ConteosMinutas { delAnio: number; borradores: number; pendientes: number }

export function contarMinutas(lista: Minuta[], hoy: Date = new Date()): ConteosMinutas {
  // Año según Venezuela, no según el equipo: el 31 de dic. a las 8 p. m. ya es año nuevo en UTC.
  const anio = hoyVE(hoy).slice(0, 4);
  return {
    delAnio: lista.filter((m) => m.fecha.startsWith(anio)).length,
    borradores: lista.filter((m) => m.estado === 'borrador').length,
    pendientes: lista.filter((m) => tieneAcuerdosPendientes(m, hoy)).length,
  };
}

/** Recorta el objetivo para la tabla. */
export function recortar(s: string | null | undefined, max = 60): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
