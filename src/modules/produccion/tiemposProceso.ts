/* ============================================================
   MGG · Producción · Los tiempos del proceso salen solos

   La tarjeta de una colada ya mostraba «Inicio 10:18 · Fin 10:24 ·
   Duración 6 min», porque la orden guarda `inicio_at` y `fin_at`. Pero
   el bloque «Sangrado y tiempos de colada» del reporte —el que sale en
   el PDF MGG-FR-001— se quedaba vacío: había que volver a escribir a
   mano lo que el sistema ya sabía, y nadie lo hacía.

   Acá se calcula la duración real. Lo que el usuario haya escrito a
   mano NO se pisa: puede que la colada empezara antes de cargarla en
   el sistema.
   ============================================================ */

/** Horas entre dos marcas de tiempo, con dos decimales. `null` si no se puede. */
export function horasEntre(inicio: string | null | undefined, fin: string | null | undefined): number | null {
  if (!inicio || !fin) return null;
  const a = Date.parse(inicio);
  const b = Date.parse(fin);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const horas = (b - a) / 3_600_000;
  // Una duración negativa es un dato mal cargado, no una colada que viajó al pasado.
  if (horas < 0) return null;
  return Math.round(horas * 100) / 100;
}

/** ¿Este campo está vacío? (sin cargar, o con espacios). */
export function vacio(v: unknown): boolean {
  return v == null || String(v).trim() === '';
}

export interface TiemposDatos {
  hora_inicio_proceso?: string;
  hora_fin_proceso?: string;
  duracion_horas?: number | null;
}

/**
 * Qué campos de tiempo hay que completar, y con qué.
 *
 * Devuelve solo los que están VACÍOS: si alguien escribió que la colada arrancó
 * a las 6 de la mañana aunque la haya cargado a las 10, esa es la verdad de
 * planta y el sistema no la pisa.
 */
export function tiemposACompletar(
  datos: TiemposDatos,
  inicioAt: string | null | undefined,
  finAt: string | null | undefined,
  formatear: (iso: string) => string,
): Partial<TiemposDatos> {
  const patch: Partial<TiemposDatos> = {};
  if (inicioAt && vacio(datos.hora_inicio_proceso)) patch.hora_inicio_proceso = formatear(inicioAt);
  if (finAt && vacio(datos.hora_fin_proceso)) patch.hora_fin_proceso = formatear(finAt);
  if (datos.duracion_horas == null) {
    const h = horasEntre(inicioAt, finAt);
    if (h != null) patch.duracion_horas = h;
  }
  return patch;
}

/**
 * La marca de tiempo como se escribe en el reporte: `DD/MM/AA HH:MM`, en hora
 * de Venezuela.
 *
 * Es el mismo formato que sugiere el propio campo («Ej.: 20/03/26 6am») y el
 * mismo que usa el relleno de las coladas viejas, para que una colada de ayer y
 * una de hoy se lean igual. Se fija la zona horaria a propósito: la planta está
 * en Venezuela y el reporte es un documento de planta, no del navegador que lo
 * abrió.
 */
export function fmtProcesoVE(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}`;
}
