/* ============================================================
   Golden Touch · Servicio de Mantenimiento · reglas puras
   Grupos de flota (asignado o deducido del tipo), estado del servicio
   de cada equipo (vencido / próximo / al día / sin datos) con la MISMA
   regla del catálogo (avisoServicio: ≤ 10 % del intervalo, con la base
   del último mantenimiento), orden por urgencia y resumen del grupo.
   ============================================================ */
import { norm } from '@/shared/lib/texto';
import { GRUPOS_MANTENIMIENTO } from './maquinariaEquipos.repository';
import { avisoServicio, avisoMasUrgente, MARGEN_ALERTA_PCT, type AvisoServicio } from './flota';

/** Pestaña virtual para los equipos que no caen en ningún grupo. */
export const SIN_GRUPO = '__sin_grupo__';

/**
 * Grupo DEDUCIDO del tipo del equipo cuando no tiene uno asignado en su ficha:
 *  · planta / generador / eléctrico        → PLANTAS ELÉCTRICAS
 *  · vehículo / carro / camión / gandola…  → VEHÍCULOS DE CARGA
 *  · todo lo demás (excavadora, cargador…) → FLOTA PESADA
 */
export function grupoPorTipo(tipo: string | null | undefined): string {
  const t = norm(tipo);
  if (/planta|generador|electric/.test(t)) return 'PLANTAS ELÉCTRICAS';
  if (/vehiculo|carro|camion|gandola|camioneta|pickup|\bauto|van\b|autobus|\bbus|encava|jeep|chuto|remolque|moto/.test(t)) return 'VEHÍCULOS DE CARGA';
  return 'FLOTA PESADA';
}

/** Grupo efectivo: el asignado en la ficha (si es uno de los grupos) o el deducido del tipo. */
export function grupoDeEquipo(e: { grupo_mantenimiento?: string | null; tipo?: string | null }): string {
  const g = (e.grupo_mantenimiento ?? '').trim();
  return (GRUPOS_MANTENIMIENTO as readonly string[]).includes(g) ? g : grupoPorTipo(e.tipo);
}

export type EstadoServicio = 'vencido' | 'proximo' | 'al_dia' | 'sin_datos';

export const ESTADOS_SERVICIO: Record<EstadoServicio, { label: string; icon: string; tono: 'danger' | 'warning' | 'success' | 'retired' }> = {
  vencido: { label: 'Vencido', icon: '⛔', tono: 'danger' },
  proximo: { label: 'Próximo', icon: '⚠️', tono: 'warning' },
  al_dia: { label: 'Al día', icon: '✅', tono: 'success' },
  sin_datos: { label: 'Sin datos', icon: '⚪', tono: 'retired' },
};

/** Texto de la regla del aviso, para no repetir el número en cada pantalla. */
export const REGLA_PROXIMO = `≤ ${Math.round(MARGEN_ALERTA_PCT * 100)} % del intervalo`;

export interface InfoServicio {
  horometro: number | null;
  km: number | null;
  avisoH: AvisoServicio | null;
  avisoK: AvisoServicio | null;
  /** El más urgente de los dos (decide el estado). */
  aviso: AvisoServicio | null;
  estado: EstadoServicio;
}

/** Estado del servicio de un equipo a partir de sus lecturas vigentes. */
export function infoServicio(
  e: { mantenimiento_cada_hrs: number | null; mantenimiento_base_hrs: number | null; mantenimiento_cada_km: number | null; mantenimiento_base_km: number | null },
  horometro: number | null, km: number | null,
): InfoServicio {
  const avisoH = avisoServicio(e.mantenimiento_cada_hrs, horometro, e.mantenimiento_base_hrs, 'h');
  const avisoK = avisoServicio(e.mantenimiento_cada_km, km, e.mantenimiento_base_km, 'km');
  const aviso = avisoMasUrgente(avisoH, avisoK);
  const estado: EstadoServicio = !aviso ? 'sin_datos' : aviso.nivel === 'vencido' ? 'vencido' : aviso.nivel === 'proximo' ? 'proximo' : 'al_dia';
  return { horometro, km, avisoH, avisoK, aviso, estado };
}

/** Orden por urgencia: vencidos (los más pasados primero), próximos, al día (los más cerca primero) y sin datos. Inactivos al final. */
export function compararUrgencia(
  a: { info: InfoServicio; activo: boolean; nombre: string },
  b: { info: InfoServicio; activo: boolean; nombre: string },
): number {
  if (a.activo !== b.activo) return a.activo ? -1 : 1;
  const peso: Record<EstadoServicio, number> = { vencido: 0, proximo: 1, al_dia: 2, sin_datos: 3 };
  const d = peso[a.info.estado] - peso[b.info.estado];
  if (d) return d;
  const ra = a.info.aviso?.ratio ?? 0;
  const rb = b.info.aviso?.ratio ?? 0;
  if (rb !== ra) return rb - ra;
  return a.nombre.localeCompare(b.nombre, 'es');
}

/** Conteo del grupo (solo equipos activos). */
export function resumenServicio(items: { info: InfoServicio; activo: boolean }[]): Record<EstadoServicio, number> & { total: number } {
  const out = { vencido: 0, proximo: 0, al_dia: 0, sin_datos: 0, total: 0 };
  for (const it of items) {
    if (!it.activo) continue;
    out[it.info.estado] += 1;
    out.total += 1;
  }
  return out;
}
