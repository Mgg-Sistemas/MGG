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

/**
 * Zona horaria de la planta: Venezuela, UTC−4 todo el año.
 *
 * Va explícito porque `isoDePlanta` devuelve la hora SIN zona, y guardar eso en
 * un `timestamptz` lo haría interpretar como UTC: una colada que terminó a las
 * 21:20 aparecería a la 01:20 del día siguiente. Venezuela no tiene horario de
 * verano, así que el offset es fijo.
 */
export const OFFSET_PLANTA = '-04:00';

/** Un instante de planta listo para guardar en la base, o null si falta el dato. */
export function timestampDePlanta(fecha?: string | null, hora?: string | null): string | null {
  const iso = isoDePlanta(fecha, hora);
  return iso ? `${iso}:00${OFFSET_PLANTA}` : null;
}

/**
 * Los timestamps con los que hay que SELLAR la orden cuando se cierra.
 *
 * `inicio_at` y `fin_at` de la orden nacían con la hora del reloj: cuándo
 * alguien abrió y cerró el formulario. Para una carga retroactiva eso es
 * directamente falso — las siete coladas de agosto figuraban como hechas el 23
 * y 24 de septiembre, y el gráfico del tablero las dibujaba en septiembre.
 *
 * Cuando el reporte trae la fecha y hora de planta completas, esas mandan: son
 * cuándo se trabajó el horno. Se usan **solo si están las dos y en orden**,
 * igual que en `tiemposDeLaOrden`: mezclar un arranque de planta con un cierre
 * del sistema daría una duración inventada.
 *
 * Devuelve null cuando no hay con qué sellar, y ahí la orden se queda con lo
 * que tenía: es preferible una hora aproximada a una fecha en blanco.
 */
export function timestampsDeLaOrden(
  datos: DatosConHoras | null | undefined,
): { inicio_at: string; fin_at: string } | null {
  const inicio = timestampDePlanta(datos?.fecha_inicio_carga, datos?.hora_inicio_carga)
    ?? timestampDePlanta(datos?.fecha_inicio_jornada, datos?.hora_inicio_jornada);
  const fin = timestampDePlanta(datos?.fecha_fin_carga, datos?.hora_fin_carga)
    ?? timestampDePlanta(datos?.fecha_fin_jornada, datos?.hora_fin_jornada);
  if (!inicio || !fin) return null;
  if (Date.parse(fin) < Date.parse(inicio)) return null;
  return { inicio_at: inicio, fin_at: fin };
}
