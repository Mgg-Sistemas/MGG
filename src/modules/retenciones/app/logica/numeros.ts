/* MGG · Retenciones · Redondeo y formato de montos.
   `r2` es la misma de retencionesCalculo.ts, que no la exporta (ese archivo no se toca). */

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** 1234.5 → «1.234,50». */
export const fmt2 = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Un porcentaje sin ceros de más: 75 → «75», 2.5 → «2,5». */
export const pctTxt = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 4 });
