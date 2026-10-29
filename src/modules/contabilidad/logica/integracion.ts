/* ============================================================
   MGG · Contabilidad · Integración con los módulos (lógica pura)

   Galac §8.1: cada sistema que alimenta a Contabilidad tiene sus «Reglas
   de Contabilización» (por pestaña: Pagos, Caja Chica, Producción…), con
   «Cómo Contabilizar» (Inmediata / Pospuesta) y «Tipo de Contabilización»
   (Cada Documento / Por Lote), y un menú Contabilizar que procesa los
   documentos pendientes.
   · El ORDEN de contabilización es el de fecha y documento: así la
     numeración Mes-Consecutivo sale igual a la del Carril BD (datos v1.5
     §7: 10-000001…10-000033 con octubre abierto y sin otros comprobantes).
   · POR LOTE: los documentos de la misma regla y el mismo día van a UN
     comprobante, con el «Número de Lote» (LOTE-<regla>-<fecha>).
   ============================================================ */

import type { ComprobanteGenerado, LineaGenerada } from './motorReglas';
import type { ContIntegracion } from '../tipos';

/** Fecha y, en el mismo día, el documento: el orden en que se numeran los comprobantes. */
export const ordenIntegracion = (a: Pick<ContIntegracion, 'fecha' | 'origen_id'>, b: Pick<ContIntegracion, 'fecha' | 'origen_id'>) =>
  a.fecha.localeCompare(b.fecha) || a.origen_id.localeCompare(b.origen_id);

/** Agrupa por lote conservando el orden: cada documento sin lote es su propio grupo. */
export function agruparPorLote<T extends { generado: ComprobanteGenerado }>(items: T[]): T[][] {
  const grupos: T[][] = [];
  const porLote = new Map<string, T[]>();
  for (const it of items) {
    const lote = it.generado.numero_lote;
    if (!lote) { grupos.push([it]); continue; }
    const g = porLote.get(lote);
    if (g) g.push(it);
    else { const nuevo = [it]; porLote.set(lote, nuevo); grupos.push(nuevo); }
  }
  return grupos;
}

const c = (x: number) => Math.round(x * 100);

/** El comprobante de un grupo: con un documento, el suyo; con varios (un lote), sus asientos juntos. */
export function unirGenerados(gs: ComprobanteGenerado[]): { cabecera: ComprobanteGenerado; lineas: LineaGenerada[]; totales: { debe_ves: number; haber_ves: number; debe_usd: number; haber_usd: number } } {
  const lineas = gs.flatMap((g) => g.lineas);
  const s = (k: 'debe_ves' | 'haber_ves' | 'debe_usd' | 'haber_usd') => lineas.reduce((a, l) => a + c(l[k]), 0) / 100;
  return { cabecera: gs[0], lineas, totales: { debe_ves: s('debe_ves'), haber_ves: s('haber_ves'), debe_usd: s('debe_usd'), haber_usd: s('haber_usd') } };
}

/** Nombre del módulo de origen, como lo muestra Galac en «Generado Por». */
export const NOMBRE_MODULO: Record<string, string> = {
  compras: 'Compras', tesoreria: 'Tesorería', nomina: 'Nómina', inventario: 'Inventario', produccion: 'Producción',
  ventas: 'Ventas', acopio: 'Acopio', recepciones: 'Recepciones', combustible: 'Combustible', retenciones: 'Retenciones',
  contabilidad: 'Contabilidad',
};
export const nombreModulo = (m: string) => NOMBRE_MODULO[m] ?? m.charAt(0).toUpperCase() + m.slice(1);
