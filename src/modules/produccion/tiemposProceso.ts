/* ============================================================
   MGG · Producción · Los tiempos del proceso salen solos

   La tarjeta de una colada ya mostraba «Inicio 10:18 · Fin 10:24 ·
   Duración 6 min», porque la orden guarda `inicio_at` y `fin_at`. Pero
   el bloque «Sangrado y tiempos de colada» del reporte —el que sale en
   el PDF MGG-FR-001— se quedaba vacío: había que volver a escribir a
   mano lo que el sistema ya sabía, y nadie lo hacía.

   De dónde salen: de la CARGA DEL HORNO que carga el operador
   («Fecha/Hora inicio de carga» y «Fecha/Hora fin de carga»), que son
   horas de planta. NO de cuándo se creó y se finalizó la orden en el
   sistema: una colada que se carga y se cierra en la misma pantalla dio
   «11:13 → 11:15, 0,04 h», que es lo que tardó el formulario, no el
   horno, y eso salía impreso en el MGG-FR-001 como si fuera real.

   Lo que el usuario haya escrito a mano NO se pisa.
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

/* ───────────── Las horas de PLANTA ───────────── */

/**
 * Une la fecha y la hora que cargó el operador en una marca comparable.
 *
 * Devuelve `YYYY-MM-DDTHH:MM` (hora LOCAL, sin zona) o `null` si falta alguna
 * de las dos. Sin zona a propósito: la carga del horno se anota en hora de
 * planta, y pasarla por UTC la correría cuatro horas.
 */
export function isoDePlanta(fecha?: string | null, hora?: string | null): string | null {
  const f = (fecha ?? '').trim();
  const h = (hora ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  if (!/^\d{1,2}:\d{2}/.test(h)) return null;
  const [hh, mm] = h.split(':');
  return `${f}T${hh.padStart(2, '0')}:${mm.slice(0, 2)}`;
}

/**
 * La marca como se escribe en el reporte: `DD/MM/AA HH:MM`.
 *
 * Es el mismo formato que sugiere el propio campo («Ej.: 20/03/26 6am»). Se
 * arma cortando el texto, sin pasar por `Date`: el valor ya es hora de planta
 * y cualquier conversión de zona lo movería de lugar.
 */
export function fmtPlantaVE(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  const [, aaaa, mes, dia, hh, mm] = m;
  return `${dia}/${mes}/${aaaa.slice(2)} ${hh}:${mm}`;
}
