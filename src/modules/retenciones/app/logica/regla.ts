/* ============================================================
   MGG · Retenciones · El motor por piezas

   Cada impuesto del catálogo calcula con una regla armada por piezas: sobre
   qué base, con qué %, si resta un sustraendo, si tiene mínimo, qué condición
   de la empresa exige, en qué moneda aplica y cómo redondea. Las reglas de
   fábrica (IVA e ISLR) y las que crea el usuario pasan por la misma función,
   la misma que usa «Probar la regla».

   Es una función pura: la UT, el % de IVA, el régimen de la empresa y el
   concepto o la actividad vigentes en la fecha llegan ya resueltos.
   Sin un dato que hace falta no se calcula: nunca con 0 en silencio.
   ============================================================ */

import { motivoCienTexto, retieneCienPorCiento, type MotivosIvaCien } from '../../retencionesCalculo';
import { fmt2, pctTxt, r2 } from './numeros';

export type PiezaBase = 'iva' | 'sin_iva' | 'total' | 'pagado' | 'porcion';
export type PiezaPct = 'art5' | 'concepto' | 'actividad' | 'fijo';

export interface PiezasRegla {
  base: PiezaBase;
  pct: PiezaPct;
  /** El % cuando `pct` es 'fijo'. */
  fijo?: number;
  sustraendo: 'ninguno' | 'formula';
  /** El factor del sustraendo (% × UT × factor). Por defecto, 83,3334. */
  factor?: number;
  minimo: 'ninguno' | 'ut';
  condicion: 'ninguna' | 'agente_iva' | 'especial';
  moneda: 'cualquiera' | 'divisas';
  redondeo: 'paso' | 'final';
  cuenta: 'retencion' | 'costo';
}

export interface ConceptoVigente {
  codigo: string | null;
  nombre: string;
  porcentaje: number;
  basePct: number;
  minimoUt: number;
  aplicaSustraendo: boolean;
}

export interface ActividadVigente {
  codigo: string;
  descripcion: string;
  porcentaje: number;
  sujeta: boolean;
}

export interface EntradaRegla {
  /** La fecha de la factura, con la que se resolvió el contexto. */
  fecha: string;
  base: number;
  iva: number;
  pagado: number;
  moneda: 'Bs' | 'USD';
  /** Los supuestos del art. 5 que llevan el IVA al 100 %. */
  motivos100: MotivosIvaCien | null;
  concepto: ConceptoVigente | null;
  actividad: ActividadVigente | null;
}

/** Los valores vigentes en la fecha. null = sin cargar o sin configurar. */
export interface ContextoRegla {
  ut: number | null;
  pctGeneral: number | null;
  pctArt5: number | null;
  agenteIva: boolean | null;
  especial: boolean | null;
}

export interface PasoCalculo { titulo: string; valor: string }

export type FaltaDato = 'concepto' | 'actividad' | 'ut' | 'pct_iva';

export type ResultadoRegla =
  | { estado: 'calculado'; monto: number; cero: boolean; pasos: PasoCalculo[]; nota: string }
  | { estado: 'sin_dato'; monto: null; falta: FaltaDato; pasos: PasoCalculo[]; nota: string };

const FACTOR_SUSTRAENDO = 83.3334;
const SIN_UT = 'Sin valor de UT para la fecha. Registrar la UT en ⚙ Parámetros. No se calcula.';

export function ejecutarRegla(piezas: PiezasRegla, e: EntradaRegla, ctx: ContextoRegla): ResultadoRegla {
  const pasos: PasoCalculo[] = [];
  const paso = (titulo: string, valor: string) => { pasos.push({ titulo, valor }); };
  const red = (n: number) => (piezas.redondeo === 'final' ? n : r2(n));
  const calculado = (monto: number, nota = ''): ResultadoRegla => {
    const m = r2(monto);
    return { estado: 'calculado', monto: m, cero: m === 0, pasos, nota: nota || (m === 0 ? 'El cálculo da 0,00 con estos datos.' : '') };
  };
  const sinDato = (falta: FaltaDato, nota: string): ResultadoRegla => ({ estado: 'sin_dato', monto: null, falta, pasos, nota });

  // La condición de la empresa. Con el régimen sin configurar, el IVA se propone igual (el aviso va aparte).
  const exige = piezas.condicion === 'agente_iva' && ctx.agenteIva === false ? { que: 'agente de retención de IVA', sinConfigurar: false }
    : piezas.condicion === 'especial' && ctx.especial !== true ? { que: 'contribuyente especial', sinConfigurar: ctx.especial == null }
      : null;
  if (exige) {
    const porque = exige.sinConfigurar ? 'el régimen de la empresa está sin configurar' : `la empresa no es ${exige.que}`;
    paso('Condición de la empresa', `La regla exige que la empresa sea ${exige.que}, y ${porque}`);
    return calculado(0, `No se retiene porque la regla exige que la empresa sea ${exige.que} y ${porque}.`);
  }
  if (piezas.moneda === 'divisas' && e.moneda !== 'USD') {
    paso('Moneda', 'El pago no es en divisas');
    return calculado(0, 'No aplica: el pago no es en divisas.');
  }

  const concepto = piezas.pct === 'concepto' || piezas.base === 'porcion' ? e.concepto : null;
  if ((piezas.pct === 'concepto' || piezas.base === 'porcion') && !concepto) {
    paso('Concepto', 'Sin versión vigente a esa fecha para ese sujeto');
    return sinDato('concepto', 'Concepto sin vigencia en la fecha indicada. Seleccionar otro concepto o registrar una versión.');
  }

  const bases: Record<PiezaBase, number> = {
    iva: e.iva, sin_iva: e.base, total: e.base + e.iva, pagado: e.pagado, porcion: e.base * ((concepto?.basePct ?? 100) / 100),
  };
  const base = red(bases[piezas.base]);
  paso('Base', fmt2(base));

  let pct: number;
  if (piezas.pct === 'art5') {
    if (ctx.pctGeneral == null || ctx.pctArt5 == null) return sinDato('pct_iva', 'Sin % de IVA vigente a esa fecha. Registrar el valor en ⚙ Parámetros.');
    const cien = retieneCienPorCiento(e.motivos100);
    pct = cien ? ctx.pctArt5 : ctx.pctGeneral;
    paso('%', cien ? `${pctTxt(pct)} % (supuesto del art. 5: ${motivoCienTexto(e.motivos100)?.toLowerCase()})` : `${pctTxt(pct)} % (general)`);
  } else if (piezas.pct === 'concepto' && concepto) {
    pct = concepto.porcentaje;
    paso('% del concepto', `${pctTxt(pct)} % · ${concepto.nombre}`);
  } else if (piezas.pct === 'actividad') {
    const a = e.actividad;
    if (!a || !a.sujeta) return sinDato('actividad', 'Actividad por definir: seleccionar la actividad.');
    pct = a.porcentaje;
    paso('% de la actividad', `${pctTxt(pct)} % · ${a.codigo} ${a.descripcion}`);
  } else {
    pct = piezas.fijo ?? 0;
    paso('% fijo', `${pctTxt(pct)} %`);
  }

  const ut = ctx.ut && ctx.ut > 0 ? ctx.ut : null;
  if (piezas.minimo === 'ut' && concepto && concepto.minimoUt > 0) {
    if (!ut) return sinDato('ut', SIN_UT);
    const minimo = red(ut * concepto.minimoUt);
    paso('Mínimo (UT × mínimo del concepto)', `${fmt2(minimo)} = ${pctTxt(ut)} × ${pctTxt(concepto.minimoUt)}`);
    if (base < minimo) {
      paso('Base frente al mínimo', 'No llega al mínimo');
      return calculado(0, 'No se retiene: la base no llega al mínimo.');
    }
  }

  const bruto = red((base * pct) / 100);
  paso('Bruto (base × %)', fmt2(bruto));
  let sustraendo = 0;
  if (piezas.sustraendo === 'formula' && concepto?.aplicaSustraendo) {
    if (!ut) return sinDato('ut', SIN_UT);
    const factor = piezas.factor ?? FACTOR_SUSTRAENDO;
    sustraendo = red((pct / 100) * ut * factor);
    paso(`Sustraendo (% × UT × ${pctTxt(factor)})`, `− ${fmt2(sustraendo)}`);
  }
  const monto = Math.max(0, r2(bruto - sustraendo));
  paso('Monto (nunca negativo)', fmt2(monto));
  return calculado(monto, piezas.cuenta === 'costo' ? 'Cuenta como costo: no se recupera.' : '');
}
