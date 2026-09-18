/* ============================================================
   MGG · Refinación · tiempos del proceso

   Al CREAR la refinación ya se carga la jornada (fecha + hora de inicio y de
   fin). Al finalizar no hay que volver a pedirlos: se toman de ahí, igual que
   en la colada de fundición, que no pregunta horas al cerrar.
   ============================================================ */
import type { RefinacionDatos } from '@/shared/lib/types';

export interface TiemposRefinacion {
  /** "4:29 pm 28/03/26" o '' si no se cargó. */
  inicio: string;
  fin: string;
  totalHoras: number | null;
  /** true = el inicio ya viene de la jornada cargada al crear: no se vuelve a pedir. */
  delReporte: boolean;
}

/** "2026-03-28" + "16:29" → "4:29 pm 28/03/26". '' si falta alguno. */
export function fechaHoraLegible(fecha?: string | null, hora?: string | null): string {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec((fecha ?? '').trim());
  const h = /^(\d{1,2}):(\d{2})/.exec((hora ?? '').trim());
  if (!f || !h) return '';
  const hh = Number(h[1]);
  if (hh > 23) return '';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${h[2]} ${hh < 12 ? 'am' : 'pm'} ${f[3]}/${f[2]}/${f[1].slice(2)}`;
}

/**
 * Tiempos que se muestran al finalizar. Si la refinación ya tenía
 * `hora_inicio_refinacion` guardada (registros viejos) se respeta; si no,
 * se arma con la jornada del reporte.
 */
export function tiemposRefinacion(d: Partial<RefinacionDatos> | null | undefined): TiemposRefinacion {
  const iniJornada = fechaHoraLegible(d?.fecha_inicio_jornada, d?.hora_inicio_jornada);
  const finJornada = fechaHoraLegible(d?.fecha_fin_jornada, d?.hora_fin_jornada);
  const inicio = (d?.hora_inicio_refinacion ?? '').trim() || iniJornada;
  const fin = (d?.hora_fin_refinacion ?? '').trim() || finJornada;
  const total = d?.tiempo_total_horas ?? d?.jornada_horas ?? null;
  return {
    inicio,
    fin,
    totalHoras: total != null && Number.isFinite(Number(total)) ? Number(total) : null,
    delReporte: iniJornada !== '',
  };
}
