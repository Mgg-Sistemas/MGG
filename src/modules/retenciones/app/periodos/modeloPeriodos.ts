/* ============================================================
   MGG · Retenciones v8 · Períodos (lógica pura)

   Traslado de `estadoPeriodo` (v8, l. 7764), `avisosPeriodos`,
   `v7AtencionDe`, `etiquetaPeriodo` y `nombrePeriodo` de la maqueta, con los
   períodos de la base (retencion_periodos_v) en lugar de los inventados.
   ============================================================ */

import type { EstadoPeriodo, PeriodoRetencion } from '../datos/periodos';

export type EstadoFila = EstadoPeriodo | 'anterior';

export const EST_PER: Record<EstadoFila, string> = {
  abierto: 'Abierto', por_declarar: 'Por declarar', vencido: 'Vencido', declarado: 'Declarado', anterior: 'Otro sistema',
};

/** Días antes del vencimiento en que una declaración pasa a «por vencer»: `retenciones.avisos.umbrales` (declaraciones[0]); 7 por defecto, como la maqueta. */
export const UMBRAL_DECLARACIONES = 7;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const anio = (p: Pick<PeriodoRetencion, 'periodo'>) => Number(p.periodo.slice(0, 4));
const mes = (p: Pick<PeriodoRetencion, 'periodo'>) => Number(p.periodo.slice(4, 6));

/** «Octubre 2026 · 1.ª quincena» (`etiquetaPeriodo`). */
export const etiquetaPeriodo = (p: Pick<PeriodoRetencion, 'periodo' | 'tramo'>) =>
  `${mayus(MESES[mes(p) - 1])} ${anio(p)}${p.tramo ? ` · ${p.tramo}.ª quincena` : ''}`;

/** «1.ª quincena de octubre de 2026» u «Octubre de 2026» (`nombrePeriodo`). */
export const nombrePeriodo = (p: Pick<PeriodoRetencion, 'periodo' | 'tramo'>) =>
  `${p.tramo ? `${p.tramo}.ª quincena de ${MESES[mes(p) - 1]}` : mayus(MESES[mes(p) - 1])} de ${anio(p)}`;

/** dd/mm */
export const corto = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}

/** El estado de la fila: lo anterior al paso inicial se gestiona en el otro sistema. */
export const estadoFila = (p: PeriodoRetencion): EstadoFila => (p.declara === 'otro_sistema' && !p.declaradoEn ? 'anterior' : p.estado);

export interface Atencion { abierto?: PeriodoRetencion; porDeclarar: PeriodoRetencion[]; vencidos: PeriodoRetencion[] }

/** `v7AtencionDe`: el período en curso, lo por declarar y lo vencido de un impuesto (lo más antiguo primero). */
export function atencionDe(ps: readonly PeriodoRetencion[], k: string, hoy: string): Atencion {
  const xs = ps.filter((p) => p.tipo === k && p.desde <= hoy).sort((a, b) => (a.desde < b.desde ? -1 : 1));
  return {
    abierto: xs.find((p) => estadoFila(p) === 'abierto'),
    porDeclarar: xs.filter((p) => estadoFila(p) === 'por_declarar'),
    vencidos: xs.filter((p) => estadoFila(p) === 'vencido'),
  };
}

/** `avisosPeriodos`: lo vencido y lo por vencer (a UMBRAL días) de los impuestos activos. */
export function avisosPeriodos(ps: readonly PeriodoRetencion[], impuestos: readonly string[], hoy: string, umbral = UMBRAL_DECLARACIONES) {
  let vencidos = 0, pronto = 0;
  for (const p of ps) {
    if (!impuestos.includes(p.tipo)) continue;
    const e = estadoFila(p);
    if (e === 'vencido') vencidos++;
    else if (e === 'por_declarar' && p.vence && diasEntre(hoy, p.vence) <= umbral) pronto++;
  }
  return { vencidos, pronto };
}

export interface AnioPeriodos { anio: number; filas: PeriodoRetencion[]; anteriores: PeriodoRetencion[]; cuenta: Record<EstadoFila, number> }

/** La tabla de un impuesto, por año (el más reciente primero), con el filtro de estado; lo anterior al paso inicial, aparte. */
export function periodosPorAnio(ps: readonly PeriodoRetencion[], k: string, hoy: string, est: '' | EstadoFila, soloAnio = 0): AnioPeriodos[] {
  const deK = ps.filter((p) => p.tipo === k && p.desde <= hoy && (!soloAnio || anio(p) === soloAnio));
  const anios = [...new Set(deK.map(anio))].sort((a, b) => b - a);
  return anios.map((y) => {
    let xs = deK.filter((p) => anio(p) === y).sort((a, b) => (a.desde < b.desde ? 1 : -1));
    if (est) xs = xs.filter((p) => estadoFila(p) === est);
    const cuenta = { abierto: 0, por_declarar: 0, vencido: 0, declarado: 0, anterior: 0 };
    for (const p of xs) cuenta[estadoFila(p)]++;
    return { anio: y, filas: xs.filter((p) => estadoFila(p) !== 'anterior'), anteriores: xs.filter((p) => estadoFila(p) === 'anterior'), cuenta };
  }).filter((a) => a.filas.length || a.anteriores.length);
}

export const aniosDe = (ps: readonly PeriodoRetencion[]) => [...new Set(ps.map(anio))].sort((a, b) => b - a);

/** «Por quincena» si el impuesto tiene tramos; si no, «Mensual». */
export const periodicidadDe = (ps: readonly PeriodoRetencion[], k: string) => (ps.some((p) => p.tipo === k && p.tramo > 0) ? 'Por quincena' : 'Mensual');

/** `avisosPeriodos` como lista: cada período vencido o por vencer (a umbral días), con su nombre y los días que faltan. */
export function avisosPeriodosLista(ps: readonly PeriodoRetencion[], impuestos: readonly string[], hoy: string, umbral = UMBRAL_DECLARACIONES) {
  const out: { cls: 'vencido' | 'pronto'; p: PeriodoRetencion; nombre: string; dias: number }[] = [];
  for (const p of ps) {
    if (!impuestos.includes(p.tipo) || !p.vence) continue;
    const e = estadoFila(p), dias = diasEntre(hoy, p.vence);
    if (e === 'vencido') out.push({ cls: 'vencido', p, nombre: nombrePeriodo(p), dias });
    else if (e === 'por_declarar' && dias <= umbral) out.push({ cls: 'pronto', p, nombre: nombrePeriodo(p), dias });
  }
  return out;
}
