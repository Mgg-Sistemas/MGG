/* ============================================================
   MGG · Retenciones v8 · Reportes · El análisis de un proveedor

   Traslado de v8SerieProv, v8Tendencia, ejeLimpio y abreviar
   (v8-14-analisis.js, R3-19): lo retenido a un proveedor por período,
   apilado por impuesto; el total por impuesto; y la tendencia por
   regresión lineal («sube o baja un X % por período», o «estable»).
   Funciones puras: la gráfica (GraficaProveedor.tsx) solo dibuja.
   ============================================================ */

import type { RetencionPracticada } from '../../datos/puerta';
import { columnasRango, etiquetaColumna, type Grano } from './cruzada';

const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export interface PuntoSerie { clave: string; et: string; largo: string; v: Record<string, number>; tot: number }
export interface SerieProveedor { por: PuntoSerie[]; ks: string[]; totK: Record<string, number>; total: number; nRet: number; grano: Grano }

const r2 = (n: number) => Math.round(n * 100) / 100;
const fechaDe = (r: RetencionPracticada) => r.facturaFecha ?? r.createdAt.slice(0, 10);
const columnaDe = (f: string, grano: Grano) => (grano === 'anio' ? f.slice(0, 4) : grano === 'trimestre' ? `${f.slice(0, 4)}-T${Math.ceil(Number(f.slice(5, 7)) / 3)}` : f.slice(0, 7));
const largo = (clave: string, grano: Grano) => (grano === 'mes' ? `${MESES_LARGOS[Number(clave.slice(5, 7)) - 1]} de ${clave.slice(0, 4)}` : etiquetaColumna(clave, grano));

/** La clave de un proveedor en el libro (la misma que usa la tabla cruzada). */
export const claveProveedor = (r: RetencionPracticada): string => r.contraparteId ?? r.contraparteRif ?? r.contraparteNombre ?? '—';

export function serieProveedor(
  libro: readonly RetencionPracticada[], proveedor: string,
  o: { desde: string; hasta: string; grano: Grano; moneda: string; tipos: readonly string[] },
): SerieProveedor {
  const por: PuntoSerie[] = columnasRango(o.desde, o.hasta, o.grano).map((clave) => ({ clave, et: etiquetaColumna(clave, o.grano), largo: largo(clave, o.grano), v: {}, tot: 0 }));
  const idx = new Map(por.map((p, i) => [p.clave, i]));
  const totK: Record<string, number> = {};
  let total = 0, nRet = 0;
  for (const r of libro) {
    const f = fechaDe(r);
    if (claveProveedor(r) !== proveedor || r.anulada || r.direccion !== 'practicada' || r.moneda !== o.moneda || !o.tipos.includes(r.tipo) || f < o.desde || f > o.hasta) continue;
    const p = por[idx.get(columnaDe(f, o.grano)) ?? -1];
    if (!p) continue;
    const v = Number(r.montoRetenido) || 0;
    p.v[r.tipo] = r2((p.v[r.tipo] ?? 0) + v); p.tot = r2(p.tot + v);
    totK[r.tipo] = r2((totK[r.tipo] ?? 0) + v); total = r2(total + v); nRet++;
  }
  // Los impuestos en el orden pedido (el color sigue al impuesto, nunca a su lugar en la gráfica)
  const ks = o.tipos.filter((k) => totK[k]);
  return { por, ks, totK, total, nRet, grano: o.grano };
}

export type Tendencia = { pendiente: number; ordenada: number; pct: number; texto: string } | { pendiente: null; texto: string };

export function tendencia(ys: readonly number[]): Tendencia {
  const n = ys.length, my = n ? ys.reduce((a, y) => a + y, 0) / n : 0;
  if (n < 4) return { pendiente: null, texto: 'Pocos períodos para una tendencia: hacen falta 4 o más.' };
  if (!my) return { pendiente: null, texto: 'Sin retenciones en el rango.' };
  const mx = (n - 1) / 2;
  let sxy = 0, sxx = 0;
  ys.forEach((y, x) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; });
  const b = sxy / sxx, a = my - b * mx, pct = (b / my) * 100;
  const p1 = Math.abs(pct).toLocaleString('es-VE', { maximumFractionDigits: 1 });
  return { pendiente: b, ordenada: a, pct, texto: Math.abs(pct) < 1 ? 'Estable: varía menos del 1 % por período.' : `${pct > 0 ? 'Sube' : 'Baja'} en promedio un ${p1} % por período (línea punteada).` };
}

/** El tope y el paso del eje, en números redondos (1, 2, 2,5, 5 o 10 por su magnitud). */
export function ejeLimpio(max: number): { tope: number; paso: number } {
  if (!(max > 0)) return { tope: 1, paso: 1 };
  const bruto = max / 2, mag = 10 ** Math.floor(Math.log10(bruto)), n = bruto / mag;
  const paso = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { tope: Math.ceil(max / paso) * paso, paso };
}

export function abreviar(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('es-VE', { maximumFractionDigits: 1 })} M`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('es-VE', { maximumFractionDigits: 1 })} mil`;
  return Math.round(v).toLocaleString('es-VE');
}
