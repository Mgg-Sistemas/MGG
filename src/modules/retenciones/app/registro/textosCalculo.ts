/* ============================================================
   MGG · Retenciones v8 · El cálculo en palabras

   «Cómo se calculó»: cada paso de la foto del motor en una línea que se
   entiende sin conocer el motor. Y el dato que falta, dicho como lo
   arreglaría quien registra.
   ============================================================ */

import { money } from '@/shared/lib/format';
import type { PasoFoto, ResultadoCalculo } from '../logica/motor';

const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('es-VE', { maximumFractionDigits: 4 }) : String(v ?? ''));
const pct = (v: unknown) => `${num(v)} %`;

const COMPONENTE: Record<string, string> = {
  subtotal: 'base', exento: 'exento', descuento: 'descuento', iva: 'IVA de la factura', igtf: 'IGTF',
  otros_cargos: 'otros cargos', total: 'total', pagado_divisas: 'pagado en divisas',
};

export function textoDelPaso(p: PasoFoto, moneda: string): string {
  const m = (v: number) => money(v, moneda);
  const e = p.entradas;
  switch (p.paso) {
    case 'base': {
      const partes = Object.entries(e).filter(([k]) => k !== 'porcion' && k !== 'alicuota')
        .map(([k, v]) => (k.startsWith('− ') ? `− ${COMPONENTE[k.slice(2)] ?? k.slice(2)} ${m(Number(v))}` : `${COMPONENTE[k] ?? k} ${m(Number(v))}`));
      const porcion = e.porcion != null && e.porcion !== 100 ? ` · tomando el ${pct(e.porcion)}` : '';
      return `Base: ${partes.join(' ')}${porcion} = ${m(p.valor)}`;
    }
    case 'moneda': return `Moneda: × tasa ${num(e.tasa)} del ${String(e.fecha ?? '')} = ${m(p.valor)}`;
    case 'minimo': return `Mínimo: ${num(e.minimo)} ${String(e.unidad).toUpperCase()} = ${m(Number(e.minimo_bs))}${p.nota ? ` · ${p.nota}` : ' · la base lo supera'}`;
    case 'tasa':
      if (p.operacion === 'tramos') return `Tarifa por tramos: ${pct(e.pct)} − ${num(e.sustraendo)} = ${m(p.valor)}`;
      if (p.operacion === 'monto_fijo') return `Monto fijo: ${m(Number(e.monto))}`;
      return `Porcentaje: × ${pct(e.pct)} = ${m(p.valor)}`;
    case 'sustraendo':
      if (p.operacion === 'ut_factor_pct') return `Sustraendo: ${pct(e.pct)} × UT ${num(e.ut)} × ${num(e.factor)} = − ${m(Number(e.sustraendo))} → ${m(p.valor)}`;
      return `Sustraendo: ${p.nota || '−'} → ${m(p.valor)}`;
    case 'retiene': return p.operacion === 'todo' ? `Se retiene todo: ${m(p.valor)}` : `Se retiene el ${pct(e.pct)}${p.nota ? ` (${p.nota.replace(/\.$/, '').toLowerCase()})` : ''}: ${m(p.valor)}`;
    case 'topes': return `Tope: nunca negativo${e.causado != null ? '' : ''} → ${m(p.valor)}`;
    case 'redondeo': return `Redondeo a 2 decimales: ${m(p.valor)}`;
    default: return `${p.paso}: ${m(p.valor)}`;
  }
}

/** El dato que falta, para quien registra. */
export function textoFalta(r: ResultadoCalculo): string {
  if (r.estado !== 'sin_dato') return '';
  const f = r.falta;
  if (f.tipo === 'componente' && f.componente === 'iva') return 'Falta el IVA de la factura: cargarlo.';
  if (f.tipo === 'parametro' && f.clave === 'valor_ut') return 'Falta el valor de la UT en ⚙ Parámetros: sin él no se calcula el mínimo ni el sustraendo.';
  if (f.tipo === 'columna') return 'El concepto no tiene su % en el catálogo: cárguelo en ⚙ Parámetros.';
  if (f.tipo === 'fila') return 'Elija el concepto.';
  return r.nota;
}
