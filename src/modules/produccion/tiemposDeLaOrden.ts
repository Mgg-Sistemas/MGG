/* ============================================================
   MGG · Producción · Qué horas se muestran de una colada/refinación

   La tarjeta decía «Inicio: 24 sept. 11:40 · Fin: 11:43 · Duración: 3 min»
   para una colada que duró nueve horas y media. Esos eran `inicio_at` y
   `fin_at` de la orden: cuándo alguien abrió y cerró el formulario en el
   sistema, no cuándo se trabajó el horno.

   La hora real de planta la carga el operador: en fundición como
   «Fecha/Hora inicio y fin de CARGA», y en refinación como la JORNADA. De
   ahí salen la fecha en que se hizo la colada y las horas que duró.

   Si esas horas no están cargadas se cae a las de la orden, porque es
   preferible mostrar algo aproximado a dejar la tarjeta vacía — pero queda
   dicho cuál de las dos se está mostrando.
   ============================================================ */
import { isoDePlanta } from './tiemposProceso';

export interface DatosConHoras {
  /** Fundición: la carga del horno. */
  fecha_inicio_carga?: string | null;
  hora_inicio_carga?: string | null;
  fecha_fin_carga?: string | null;
  hora_fin_carga?: string | null;
  /** Refinación: la jornada. */
  fecha_inicio_jornada?: string | null;
  hora_inicio_jornada?: string | null;
  fecha_fin_jornada?: string | null;
  hora_fin_jornada?: string | null;
}

export interface TiemposOrden {
  /** ISO local (`YYYY-MM-DDTHH:MM`) o el timestamp de la orden. */
  inicio: string | null;
  fin: string | null;
  /** true = son las horas que cargó el operador; false = las de la orden. */
  dePlanta: boolean;
}

/**
 * Las horas que hay que mostrar de una orden.
 *
 * Se usan las de planta **solo cuando están las dos**. Mezclar un inicio de
 * planta con un fin del sistema daría una duración inventada: el arranque del
 * horno de ayer contra el clic de hoy.
 */
export function tiemposDeLaOrden(
  datos: DatosConHoras | null | undefined,
  inicioAt: string | null | undefined,
  finAt: string | null | undefined,
): TiemposOrden {
  const iniPlanta = isoDePlanta(datos?.fecha_inicio_carga, datos?.hora_inicio_carga)
    ?? isoDePlanta(datos?.fecha_inicio_jornada, datos?.hora_inicio_jornada);
  const finPlanta = isoDePlanta(datos?.fecha_fin_carga, datos?.hora_fin_carga)
    ?? isoDePlanta(datos?.fecha_fin_jornada, datos?.hora_fin_jornada);

  if (iniPlanta && finPlanta && Date.parse(finPlanta) >= Date.parse(iniPlanta)) {
    return { inicio: iniPlanta, fin: finPlanta, dePlanta: true };
  }
  return { inicio: inicioAt ?? null, fin: finAt ?? null, dePlanta: false };
}

/** Aclaración para la tarjeta: de dónde salieron esas horas. */
export function rotuloOrigenTiempos(dePlanta: boolean): string {
  return dePlanta
    ? 'Horas de planta, cargadas en el reporte'
    : 'Sin horas de planta cargadas: se muestra cuándo se registró en el sistema';
}
