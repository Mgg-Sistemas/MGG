/* ============================================================
   MGG · Contabilidad · Estados financieros (lógica pura)

   La ESTRUCTURA es dato, no código (como los «Balances NIIF» de Galac,
   §7.8): el Carril BD la entrega en `estructura_ef` (datos v1.4, §6).
   Cada renglón agrupa cuentas de movimiento por `rubros` o por `cuentas`
   (código) y lleva su `signo`: +1 si el saldo deudor se muestra positivo,
   −1 si el acreedor. Así:
     renglón   = signo × Σ (debe − haber) de sus cuentas
     sección   = Σ de sus renglones, como se muestran
     subtotal  = Σ de las secciones de `de`, cada una × su signo_total
   · Balance General (Estado de Situación Financiera) a una fecha de
     corte, acumulado desde la apertura del ejercicio. BG-16 «Resultado
     del ejercicio» (especial «mas_resultado_del_periodo») suma lo que
     sigue en las cuentas de resultado antes del cierre, como Galac.
   · Estado de Resultados en la secuencia de Galac (Ingresos, Costos,
     Utilidad Bruta, Egresos, …, Utilidad o Pérdida Neta), con sus
     variantes: Mensual, Acumulado, Comparativo, Comparativo Acumulado y
     Mes a Mes (F5). Cada variante es un juego de COLUMNAS.
   Solo comprobantes contabilizados. Por omisión el Estado de Resultados
   NO incluye los asientos de cierre (Galac: «Incluir Comprobante Cierre
   de Resultados», apagado); el Balance sí. Sumas en centavos enteros.
   ============================================================ */

import { compararCodigos } from './planCuentas';
import type { ContComprobante, ContComprobanteLinea, ContCuenta, ContEjercicio } from '../tipos';
import type { MonedaInforme } from './reportes';

/* ───────────── La estructura (de BD) ───────────── */

export interface RenglonEF {
  codigo: string;
  nombre: string;
  rubros: string[];
  cuentas: string[];
  signo: 1 | -1;
  especial: 'mas_resultado_del_periodo' | null;
}
export interface EstructuraEF {
  balance_general: {
    titulo: string;
    secciones: Array<{ nombre: string; grupos: Array<{ nombre: string; renglones: RenglonEF[] }> }>;
    totales: Record<string, string[]>;
  };
  estado_resultados: {
    titulo: string;
    secciones: Array<{ nombre: string; signo_total: 1 | -1; renglones: RenglonEF[] } | { subtotal: string; de: string[] }>;
  };
}

/* ───────────── El resultado ───────────── */

export interface ColumnaEstado { etiqueta: string; desde: string; hasta: string }

export interface RenglonCalculado {
  codigo: string;
  nombre: string;
  valores: number[];
  /** Lo mismo en la otra moneda (para mostrarlo debajo, tenue). */
  eq?: number[];
  /** «Detallar cuentas»: las cuentas del renglón con valor. */
  detalle: Array<{ cuenta: ContCuenta; valores: number[]; eq?: number[] }>;
}

interface Total { etiqueta: string; valores: number[]; eq?: number[] }

export type BloqueEstado =
  | { tipo: 'seccion'; nombre: string; grupos: Array<{ nombre: string | null; renglones: RenglonCalculado[] }>; total: Total }
  | { tipo: 'subtotal'; etiqueta: string; valores: number[]; eq?: number[] };

export interface EstadoFinanciero {
  titulo: string;
  columnas: ColumnaEstado[];
  bloques: BloqueEstado[];
  /** Los totales finales (Balance: TOTAL ACTIVO, TOTAL PASIVO, …). */
  totales: Total[];
}

export interface FuenteEstados {
  comprobantes: ContComprobante[];
  lineas: ContComprobanteLinea[];
  cuentas: ContCuenta[];
}

const c = (x: number) => Math.round(x * 100);
const n = (x: number) => x / 100;
const suma = (vs: number[][]) => vs.reduce((a, v) => a.map((x, i) => x + v[i]), vs[0]?.map(() => 0) ?? []);
const esResultado = (cu: ContCuenta) => cu.clase === 'ingreso' || cu.clase === 'costo' || cu.clase === 'gasto';

/** Saldo debe − haber (centavos) por cuenta, en el rango. */
function saldosPorCuenta(f: FuenteEstados, col: ColumnaEstado, moneda: MonedaInforme, incluirCierre: boolean): Map<string, number> {
  const comp = new Set(f.comprobantes
    .filter((x) => x.estado === 'contabilizado' && x.fecha >= col.desde && x.fecha <= col.hasta && (incluirCierre || x.origen !== 'cierre'))
    .map((x) => x.id));
  const out = new Map<string, number>();
  for (const l of f.lineas) {
    if (!comp.has(l.comprobante_id)) continue;
    const v = moneda === 'VES' ? c(l.debe_ves) - c(l.haber_ves) : c(l.debe_usd) - c(l.haber_usd);
    out.set(l.cuenta_id, (out.get(l.cuenta_id) ?? 0) + v);
  }
  return out;
}

function calcularRenglon(r: RenglonEF, f: FuenteEstados, saldos: Map<string, number>[], detallar: boolean): RenglonCalculado {
  const propias = f.cuentas
    .filter((cu) => cu.es_movimiento && ((cu.rubro && r.rubros.includes(cu.rubro)) || r.cuentas.includes(cu.codigo)))
    .sort((a, b) => compararCodigos(a.codigo, b.codigo));
  const extra = r.especial === 'mas_resultado_del_periodo' ? f.cuentas.filter((cu) => cu.es_movimiento && esResultado(cu)) : [];
  const valorDe = (cu: ContCuenta) => saldos.map((m) => (m.get(cu.id) ?? 0) * r.signo);
  const valores = suma([...propias, ...extra].map(valorDe)).map(n);
  const detalle = detallar
    ? propias.map((cu) => ({ cuenta: cu, valores: valorDe(cu).map(n) })).filter((x) => x.valores.some((v) => v !== 0))
    : [];
  return { codigo: r.codigo, nombre: r.nombre, valores: valores.length ? valores : saldos.map(() => 0), detalle };
}

/* ───────────── Estado de Resultados ───────────── */

export interface FiltroResultados {
  columnas: ColumnaEstado[];
  moneda: MonedaInforme;
  /** «Detallar cuentas» bajo cada renglón (el «Nivel de Detalle» de Galac en este esquema). */
  detallar?: boolean;
  /** «Incluir Comprobante Cierre de Resultados» de Galac. */
  incluirCierre?: boolean;
}

export function estadoResultados(f: FuenteEstados, est: EstructuraEF, filtro: FiltroResultados): EstadoFinanciero {
  const saldos = filtro.columnas.map((col) => saldosPorCuenta(f, col, filtro.moneda, !!filtro.incluirCierre));
  const totales = new Map<string, { signo: number; valores: number[] }>();
  const bloques: BloqueEstado[] = [];
  for (const s of est.estado_resultados.secciones) {
    if ('subtotal' in s) {
      const valores = suma(s.de.map((nombre) => {
        const t = totales.get(nombre);
        // Una estructura mal armada no da un cero silencioso: lo dice.
        if (!t) throw new Error(`El subtotal «${s.subtotal}» suma la sección «${nombre}», que no existe antes que él en la estructura.`);
        return t.valores.map((v) => c(v) * t.signo);
      })).map(n);
      bloques.push({ tipo: 'subtotal', etiqueta: s.subtotal, valores });
      continue;
    }
    const renglones = s.renglones.map((r) => calcularRenglon(r, f, saldos, !!filtro.detallar));
    const total = suma(renglones.map((r) => r.valores.map(c))).map(n);
    const valores = renglones.length ? total : saldos.map(() => 0);
    totales.set(s.nombre, { signo: s.signo_total, valores });
    bloques.push({ tipo: 'seccion', nombre: s.nombre, grupos: [{ nombre: null, renglones }], total: { etiqueta: `TOTAL ${s.nombre}`, valores } });
  }
  return { titulo: est.estado_resultados.titulo, columnas: filtro.columnas, bloques, totales: [] };
}

/* ───────────── Balance General ───────────── */

export interface FiltroBalanceGeneral {
  /** Fechas de corte, una por columna; cada una se mide desde la apertura de su ejercicio. */
  cortes: Array<{ etiqueta: string; hasta: string }>;
  ejercicios: ContEjercicio[];
  moneda: MonedaInforme;
  detallar?: boolean;
}

export function balanceGeneral(f: FuenteEstados, est: EstructuraEF, filtro: FiltroBalanceGeneral): EstadoFinanciero {
  const columnas: ColumnaEstado[] = filtro.cortes.map((k) => {
    const ej = filtro.ejercicios.find((x) => x.fecha_inicio <= k.hasta && k.hasta <= x.fecha_fin);
    return { etiqueta: k.etiqueta, desde: ej?.fecha_inicio ?? '0000-01-01', hasta: k.hasta };
  });
  // Con los asientos de cierre: después del CI el resultado ya está en el patrimonio y las de resultado en cero.
  const saldos = columnas.map((col) => saldosPorCuenta(f, col, filtro.moneda, true));
  const porSeccion = new Map<string, number[]>();
  const bloques: BloqueEstado[] = est.balance_general.secciones.map((s) => {
    const grupos = s.grupos.map((g) => ({ nombre: g.nombre, renglones: g.renglones.map((r) => calcularRenglon(r, f, saldos, !!filtro.detallar)) }));
    const valores = suma(grupos.flatMap((g) => g.renglones.map((r) => r.valores.map(c)))).map(n);
    porSeccion.set(s.nombre, valores);
    return { tipo: 'seccion' as const, nombre: s.nombre, grupos, total: { etiqueta: `TOTAL ${s.nombre}`, valores } };
  });
  const totales = Object.entries(est.balance_general.totales).map(([etiqueta, secciones]) => ({
    etiqueta, valores: suma(secciones.map((x) => (porSeccion.get(x) ?? saldos.map(() => 0)).map(c))).map(n),
  }));
  return { titulo: est.balance_general.titulo, columnas, bloques, totales };
}

/** TOTAL ACTIVO = TOTAL PASIVO Y PATRIMONIO, columna por columna (Galac imprime el balance cuadrado). */
export function cuadraBalance(b: EstadoFinanciero): boolean[] {
  const t = (e: string) => b.totales.find((x) => x.etiqueta === e)?.valores ?? [];
  return t('TOTAL ACTIVO').map((v, i) => c(v) === c(t('TOTAL PASIVO Y PATRIMONIO')[i]));
}

/** El valor de un renglón, total o subtotal por su código o etiqueta (para las pruebas y el oráculo). */
export function valorDe(e: EstadoFinanciero, clave: string, columna = 0): number | undefined {
  for (const b of e.bloques) {
    if (b.tipo === 'subtotal' && b.etiqueta === clave) return b.valores[columna];
    if (b.tipo === 'seccion') {
      if (b.total.etiqueta === clave) return b.total.valores[columna];
      for (const g of b.grupos) for (const r of g.renglones) if (r.codigo === clave) return r.valores[columna];
    }
  }
  return e.totales.find((x) => x.etiqueta === clave)?.valores[columna];
}

/**
 * El mismo estado en la otra moneda, emparejado: bloques y renglones salen de
 * la estructura (mismo orden en las dos); las cuentas del detalle, por id (la
 * que solo tiene valor en una moneda vale cero en la otra).
 */
export function estadoConEquivalente(p: EstadoFinanciero, o: EstadoFinanciero): EstadoFinanciero {
  const ceros = p.columnas.map(() => 0);
  return {
    ...p,
    totales: p.totales.map((t, i) => ({ ...t, eq: o.totales[i]?.valores ?? ceros })),
    bloques: p.bloques.map((b, i) => {
      const y = o.bloques[i];
      if (b.tipo === 'subtotal') return { ...b, eq: y?.tipo === 'subtotal' ? y.valores : ceros };
      const z = y?.tipo === 'seccion' ? y : null;
      return {
        ...b,
        total: { ...b.total, eq: z?.total.valores ?? ceros },
        grupos: b.grupos.map((g, j) => ({
          ...g,
          renglones: g.renglones.map((r, k) => {
            const w = z?.grupos[j]?.renglones[k];
            const det = new Map((w?.detalle ?? []).map((x) => [x.cuenta.id, x.valores]));
            return { ...r, eq: w?.valores ?? ceros, detalle: r.detalle.map((x) => ({ ...x, eq: det.get(x.cuenta.id) ?? ceros })) };
          }),
        })),
      };
    }),
  };
}

/* ───────────── Columnas de las variantes de Galac ───────────── */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const finDeMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
const nombreMes = (anio: number, mes: number) => `${MESES[mes - 1]} ${anio}`;

export type VarianteResultados = 'mensual' | 'acumulado' | 'comparativo' | 'comparativo_acumulado' | 'mes_a_mes';

export const NOMBRE_VARIANTE: Record<VarianteResultados, string> = {
  mensual: 'Mensual', acumulado: 'Acumulado', comparativo: 'Comparativo (mes contra el anterior)',
  comparativo_acumulado: 'Comparativo acumulado', mes_a_mes: 'Mes a Mes',
};

/** Las columnas del Estado de Resultados para un mes de corte (AAAA-MM) dentro de su ejercicio. */
export function columnasResultados(variante: VarianteResultados, corte: string, ejercicio: ContEjercicio): ColumnaEstado[] {
  const anio = Number(corte.slice(0, 4));
  const mes = Number(corte.slice(5, 7));
  const inicio = ejercicio.fecha_inicio;
  const delMes = (m: number): ColumnaEstado => ({ etiqueta: nombreMes(anio, m), desde: `${anio}-${String(m).padStart(2, '0')}-01`, hasta: finDeMes(anio, m) });
  const acumulado = (m: number): ColumnaEstado => ({ etiqueta: `Acumulado a ${nombreMes(anio, m).toLowerCase()}`, desde: inicio, hasta: finDeMes(anio, m) });
  const anterior = Math.max(1, mes - 1);
  switch (variante) {
    case 'mensual': return [delMes(mes)];
    case 'acumulado': return [acumulado(mes)];
    case 'comparativo': return mes > 1 ? [delMes(anterior), delMes(mes)] : [delMes(mes)];
    case 'comparativo_acumulado': return mes > 1 ? [acumulado(anterior), acumulado(mes)] : [acumulado(mes)];
    case 'mes_a_mes': return [...Array.from({ length: mes }, (_, i) => delMes(i + 1)), { etiqueta: 'Total', desde: inicio, hasta: finDeMes(anio, mes) }];
  }
}
