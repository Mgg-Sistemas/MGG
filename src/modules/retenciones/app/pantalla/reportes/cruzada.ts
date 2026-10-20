/* ============================================================
   MGG · Retenciones v8 · Reportes · Retenido por proveedor y período

   La tabla cruzada de la maqueta (v8-14-analisis.js, R3-19): filas, los
   proveedores ordenados por total; columnas, todos los períodos del rango
   (también los vacíos); totales por fila, por columna y general.
   Hoy se arma con el libro en el navegador. Con la base nueva, la agrupa el
   servidor (retenciones_cruce) y esta función solo arma la tabla.
   Las monedas no se mezclan: se elige una (hoy casi ninguna retención guarda
   su tasa, así que no se puede pasar a $ como en la maqueta).
   ============================================================ */

import type { RetencionPracticada } from '../../datos/puerta';

export type Grano = 'mes' | 'trimestre' | 'anio';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const columnaDe = (fecha: string, grano: Grano): string => {
  const y = fecha.slice(0, 4), m = Number(fecha.slice(5, 7));
  return grano === 'anio' ? y : grano === 'trimestre' ? `${y}-T${Math.ceil(m / 3)}` : fecha.slice(0, 7);
};

/** Todas las columnas del rango, en orden. */
export function columnasRango(desde: string, hasta: string, grano: Grano): string[] {
  const out: string[] = [];
  if (!desde || !hasta || desde > hasta) return out;
  let y = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7));
  const hy = Number(hasta.slice(0, 4)), hm = Number(hasta.slice(5, 7));
  for (let i = 0; i < 1200 && (y < hy || (y === hy && m <= hm)); i++) {
    const k = columnaDe(`${y}-${String(m).padStart(2, '0')}-01`, grano);
    if (out[out.length - 1] !== k) out.push(k);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function etiquetaColumna(clave: string, grano: Grano): string {
  if (grano === 'anio') return clave;
  if (grano === 'trimestre') return `${clave.slice(5)} ${clave.slice(0, 4)}`;
  return `${MESES[Number(clave.slice(5, 7)) - 1]} ${clave.slice(0, 4)}`;
}

export interface FilaCruzada { clave: string; nombre: string; rif: string; celdas: Record<string, number>; total: number }
export interface Cruzada { grano: Grano; columnas: string[]; filas: FilaCruzada[]; totalesColumna: Record<string, number>; total: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const fechaDe = (r: RetencionPracticada) => r.facturaFecha ?? r.createdAt.slice(0, 10);

/** Lo retenido a proveedores (practicadas vivas) del rango, de los impuestos y en la moneda elegidos. */
export function cruzada(
  libro: readonly RetencionPracticada[],
  o: { desde: string; hasta: string; grano: Grano; moneda: string; tipos: readonly string[] },
): Cruzada {
  const filas = new Map<string, FilaCruzada>();
  const totalesColumna: Record<string, number> = {};
  let total = 0;
  for (const r of libro) {
    const f = fechaDe(r);
    if (r.anulada || r.direccion !== 'practicada' || r.moneda !== o.moneda || !o.tipos.includes(r.tipo) || f < o.desde || f > o.hasta) continue;
    const clave = r.contraparteId ?? r.contraparteRif ?? r.contraparteNombre ?? '—';
    let fila = filas.get(clave);
    if (!fila) filas.set(clave, (fila = { clave, nombre: r.contraparteNombre ?? '—', rif: r.contraparteRif ?? '', celdas: {}, total: 0 }));
    const c = columnaDe(f, o.grano), v = Number(r.montoRetenido) || 0;
    fila.celdas[c] = r2((fila.celdas[c] ?? 0) + v);
    fila.total = r2(fila.total + v);
    totalesColumna[c] = r2((totalesColumna[c] ?? 0) + v);
    total = r2(total + v);
  }
  const lista = [...filas.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
  return { grano: o.grano, columnas: columnasRango(o.desde, o.hasta, o.grano), filas: lista, totalesColumna, total };
}

/** La tabla para CSV, Excel e impresión: Proveedor, RIF, un período por columna y Total, con la fila de totales. */
export function tablaCruzada(c: Cruzada): { cabecera: string[]; cuerpo: (string | number)[][] } {
  return {
    cabecera: ['Proveedor', 'RIF', ...c.columnas.map((k) => etiquetaColumna(k, c.grano)), 'Total'],
    cuerpo: [
      ...c.filas.map((f) => [f.nombre, f.rif, ...c.columnas.map((k) => f.celdas[k] ?? 0), f.total]),
      ['Total', '', ...c.columnas.map((k) => c.totalesColumna[k] ?? 0), c.total],
    ],
  };
}
