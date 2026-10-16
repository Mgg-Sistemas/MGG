/* ============================================================
   MGG · Retenciones · El día cuya tasa vale

   La tasa de la retención es la BCV de la fecha de la factura. De lunes a
   viernes, la de ese día (un feriado entre semana cuenta como hábil). El
   sábado y el domingo pasan al lunes siguiente o, si el interruptor
   retenciones.tasa.fin_de_semana dice «viernes», al viernes anterior.

   La regla vive en la base (retencion_dia_tasa, D42 v2): es la única
   fuente. Esta copia sirve para la vista previa y para las pruebas, y
   tiene que dar lo mismo. El motor recibe la tasa ya elegida.
   ============================================================ */

export type FinDeSemana = 'lunes' | 'viernes';

/** aaaa-mm-dd → el día (aaaa-mm-dd) cuya tasa vale. */
export function diaDeTasa(fecha: string, modo: FinDeSemana = 'lunes'): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d));
  const isodow = ((dia.getUTCDay() + 6) % 7) + 1; // 1 lunes … 6 sábado, 7 domingo
  if (isodow <= 5) return fecha;
  const salto = modo === 'viernes' ? -(isodow - 5) : 8 - isodow;
  dia.setUTCDate(dia.getUTCDate() + salto);
  return dia.toISOString().slice(0, 10);
}
