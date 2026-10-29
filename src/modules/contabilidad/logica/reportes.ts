/* ============================================================
   MGG · Contabilidad · Libros y balances (lógica pura)

   Los tres informes del tramo 3, con la forma de Galac
   (GALAC-CONTABILIDAD-REFERENCIA.md §7):
   · Diario de Comprobantes (Libro Diario): por comprobante, su cabecera
     y sus asientos, con total por comprobante y total general.
   · Mayor Analítico: por cuenta, Saldo Inicial, los movimientos con su
     saldo corrido y TOTALES; Detallado (un renglón por asiento) o
     Resumido (un renglón por mes, «MOVIMIENTOS DEL MES»).
   · Movimientos de Auxiliares (E-14): el mismo mayor, por tercero.
   · Balance de Comprobación: Saldo Inicial · Debe · Haber · Saldo
     Actual, con los títulos totalizando a sus subcuentas hasta el nivel
     pedido y la fila TOTALES (Debe = Haber, saldos en cero).
   Solo entran los comprobantes CONTABILIZADOS (un descuadrado no aparece
   en ningún informe). Saldo = debe − haber; en pantalla, los saldos
   acreedores van entre paréntesis, como Galac.
   Cada informe sale en Bs o en $ (usuario, 20/10 12:15: balances en las
   dos monedas). Sumas en centavos enteros. En pantalla cada importe
   lleva debajo su equivalente en la otra moneda (usuario, 20/10 14:00):
   los `…ConEquivalente` emparejan el informe con el de la otra moneda
   y lo dejan en `eq`.
   ============================================================ */

import { codigoPadre, compararCodigos, nivelDe } from './planCuentas';
import type { ContAuxiliar, ContCentroCosto, ContComprobante, ContComprobanteLinea, ContCuenta } from '../tipos';

export type MonedaInforme = 'VES' | 'USD';

const c = (x: number) => Math.round(x * 100);
const n = (x: number) => x / 100;

/** Debe y haber del renglón en la moneda del informe. */
const montos = (l: ContComprobanteLinea, m: MonedaInforme): [number, number] =>
  m === 'VES' ? [c(l.debe_ves), c(l.haber_ves)] : [c(l.debe_usd), c(l.haber_usd)];

export interface FuenteInforme {
  comprobantes: ContComprobante[];
  lineas: ContComprobanteLinea[];
  cuentas: ContCuenta[];
  centros?: ContCentroCosto[];
  auxiliares?: ContAuxiliar[];
}

function indice(f: FuenteInforme) {
  const comp = new Map(f.comprobantes.filter((x) => x.estado === 'contabilizado').map((x) => [x.id, x]));
  const cuenta = new Map(f.cuentas.map((x) => [x.id, x]));
  return { comp, cuenta };
}

/* ───────────── Diario de Comprobantes ───────────── */

export interface AsientoDiario {
  codigo: string;
  nombre: string;
  referencia: string | null;
  descripcion: string;
  debe: number;
  haber: number;
  /** Lo mismo en la otra moneda. */
  eq?: { debe: number; haber: number };
}
export interface ComprobanteDiario {
  comprobante: ContComprobante;
  asientos: AsientoDiario[];
  debe: number;
  haber: number;
  eq?: { debe: number; haber: number };
}
export interface LibroDiario {
  comprobantes: ComprobanteDiario[];
  debe: number;
  haber: number;
  eq?: { debe: number; haber: number };
}

export function libroDiario(f: FuenteInforme, desde: string, hasta: string, moneda: MonedaInforme): LibroDiario {
  const { comp, cuenta } = indice(f);
  const porComp = new Map<string, ContComprobanteLinea[]>();
  for (const l of f.lineas) {
    const x = comp.get(l.comprobante_id);
    if (!x || x.fecha < desde || x.fecha > hasta) continue;
    porComp.set(l.comprobante_id, [...(porComp.get(l.comprobante_id) ?? []), l]);
  }
  let tD = 0;
  let tH = 0;
  const lista = [...porComp.keys()].map((id) => comp.get(id)!)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.codigo.localeCompare(b.codigo))
    .map((x) => {
      let d = 0;
      let h = 0;
      const asientos = porComp.get(x.id)!.sort((a, b) => a.renglon - b.renglon).map((l) => {
        const [ld, lh] = montos(l, moneda);
        d += ld; h += lh;
        const cu = cuenta.get(l.cuenta_id);
        return { codigo: cu?.codigo ?? '?', nombre: cu?.nombre ?? '?', referencia: l.referencia, descripcion: l.descripcion ?? x.concepto, debe: n(ld), haber: n(lh) };
      });
      tD += d; tH += h;
      return { comprobante: x, asientos, debe: n(d), haber: n(h) };
    });
  return { comprobantes: lista, debe: n(tD), haber: n(tH) };
}

/* ───────────── Mayor Analítico ───────────── */

export interface MovimientoMayor {
  fecha: string;
  /** Detallado: el número del comprobante. Resumido: «MOVIMIENTOS DEL MES». */
  comprobante: string;
  referencia: string | null;
  descripcion: string;
  auxiliar: string | null;
  centro: string | null;
  debe: number;
  haber: number;
  saldo: number;
  eq?: { debe: number; haber: number; saldo: number };
}
export interface CuentaMayor {
  cuenta: ContCuenta;
  saldoInicial: number;
  movimientos: MovimientoMayor[];
  debe: number;
  haber: number;
  saldoFinal: number;
  eq?: { saldoInicial: number; debe: number; haber: number; saldoFinal: number };
}

export interface FiltroMayor {
  desde: string;
  hasta: string;
  moneda: MonedaInforme;
  modo: 'detallado' | 'resumido';
  /** Códigos (inclusive); vacío = todas. */
  cuentaDesde?: string;
  cuentaHasta?: string;
  /** «Cuentas sin movimiento» de Galac: incluir las que solo tienen saldo inicial. */
  incluirSinMovimiento?: boolean;
}

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

export function mayorAnalitico(f: FuenteInforme, filtro: FiltroMayor): CuentaMayor[] {
  const { comp, cuenta } = indice(f);
  const centro = new Map((f.centros ?? []).map((x) => [x.id, x.codigo]));
  const aux = new Map((f.auxiliares ?? []).map((x) => [x.id, x.codigo]));
  const enRango = (codigo: string) =>
    (!filtro.cuentaDesde || compararCodigos(codigo, filtro.cuentaDesde) >= 0) &&
    (!filtro.cuentaHasta || compararCodigos(codigo, filtro.cuentaHasta) <= 0);

  const inicial = new Map<string, number>();
  const movs = new Map<string, Array<{ l: ContComprobanteLinea; x: ContComprobante }>>();
  for (const l of f.lineas) {
    const x = comp.get(l.comprobante_id);
    const cu = cuenta.get(l.cuenta_id);
    if (!x || !cu || !enRango(cu.codigo) || x.fecha > filtro.hasta) continue;
    if (x.fecha < filtro.desde) {
      const [d, h] = montos(l, filtro.moneda);
      inicial.set(cu.id, (inicial.get(cu.id) ?? 0) + d - h);
    } else {
      movs.set(cu.id, [...(movs.get(cu.id) ?? []), { l, x }]);
    }
  }

  const ids = new Set([...movs.keys(), ...(filtro.incluirSinMovimiento ? [...inicial.keys()].filter((k) => inicial.get(k) !== 0) : [])]);
  return [...ids].map((id) => cuenta.get(id)!).sort((a, b) => compararCodigos(a.codigo, b.codigo)).map((cu) => {
    let saldo = inicial.get(cu.id) ?? 0;
    let tD = 0;
    let tH = 0;
    const lista = (movs.get(cu.id) ?? []).sort((a, b) => a.x.fecha.localeCompare(b.x.fecha) || a.x.codigo.localeCompare(b.x.codigo) || a.l.renglon - b.l.renglon);
    const movimientos: MovimientoMayor[] = [];
    if (filtro.modo === 'detallado') {
      for (const { l, x } of lista) {
        const [d, h] = montos(l, filtro.moneda);
        saldo += d - h; tD += d; tH += h;
        movimientos.push({
          fecha: x.fecha, comprobante: x.codigo, referencia: l.referencia, descripcion: l.descripcion ?? x.concepto,
          auxiliar: l.auxiliar_id ? aux.get(l.auxiliar_id) ?? null : null, centro: l.centro_costo_id ? centro.get(l.centro_costo_id) ?? null : null,
          debe: n(d), haber: n(h), saldo: n(saldo),
        });
      }
    } else {
      const porMes = new Map<string, [number, number, string]>();
      for (const { l, x } of lista) {
        const [d, h] = montos(l, filtro.moneda);
        const mes = x.fecha.slice(0, 7);
        const a = porMes.get(mes) ?? [0, 0, x.fecha];
        porMes.set(mes, [a[0] + d, a[1] + h, x.fecha > a[2] ? x.fecha : a[2]]);
      }
      for (const [mes, [d, h, ultima]] of [...porMes].sort((a, b) => a[0].localeCompare(b[0]))) {
        saldo += d - h; tD += d; tH += h;
        movimientos.push({
          fecha: ultima, comprobante: 'MOVIMIENTOS DEL MES', referencia: null,
          descripcion: `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`, auxiliar: null, centro: null,
          debe: n(d), haber: n(h), saldo: n(saldo),
        });
      }
    }
    return { cuenta: cu, saldoInicial: n(inicial.get(cu.id) ?? 0), movimientos, debe: n(tD), haber: n(tH), saldoFinal: n(saldo) };
  });
}

/* ───────────── Movimientos de Auxiliares ─────────────
   Galac, Informes > Informes de Movimientos de Cuentas (photo_55): en la
   misma lista que «Movimiento de una Cuenta». Es el mayor por TERCERO: por
   cada auxiliar, su Saldo Inicial, los renglones que lo llevan (con la
   cuenta en la que cayeron) y su saldo corrido, y TOTALES. Solo los
   renglones con auxiliar; sin auxiliar no entran. */

export interface MovimientoAuxiliar {
  fecha: string;
  comprobante: string;
  cuenta: string;
  nombreCuenta: string;
  referencia: string | null;
  descripcion: string;
  debe: number;
  haber: number;
  saldo: number;
  eq?: { debe: number; haber: number; saldo: number };
}
export interface AuxiliarMayor {
  auxiliar: ContAuxiliar;
  saldoInicial: number;
  movimientos: MovimientoAuxiliar[];
  debe: number;
  haber: number;
  saldoFinal: number;
  eq?: { saldoInicial: number; debe: number; haber: number; saldoFinal: number };
}

export interface FiltroAuxiliares {
  desde: string;
  hasta: string;
  moneda: MonedaInforme;
  /** Vacío = todos los tipos. */
  tipo?: ContAuxiliar['tipo'] | '';
  /** Códigos (inclusive) dentro del tipo; vacío = todos. */
  auxiliarDesde?: string;
  auxiliarHasta?: string;
  /** «Incluye Auxiliares sin Mov. con Saldo Inicial». */
  incluirSinMovimiento?: boolean;
}

export function movimientosAuxiliares(f: FuenteInforme, filtro: FiltroAuxiliares): AuxiliarMayor[] {
  const { comp, cuenta } = indice(f);
  const aux = new Map((f.auxiliares ?? []).map((x) => [x.id, x]));
  const entra = (a: ContAuxiliar) =>
    (!filtro.tipo || a.tipo === filtro.tipo) &&
    (!filtro.auxiliarDesde || a.codigo.localeCompare(filtro.auxiliarDesde) >= 0) &&
    (!filtro.auxiliarHasta || a.codigo.localeCompare(filtro.auxiliarHasta) <= 0);

  const inicial = new Map<string, number>();
  const movs = new Map<string, Array<{ l: ContComprobanteLinea; x: ContComprobante }>>();
  for (const l of f.lineas) {
    const x = comp.get(l.comprobante_id);
    const a = l.auxiliar_id ? aux.get(l.auxiliar_id) : undefined;
    if (!x || !a || !entra(a) || x.fecha > filtro.hasta) continue;
    if (x.fecha < filtro.desde) {
      const [d, h] = montos(l, filtro.moneda);
      inicial.set(a.id, (inicial.get(a.id) ?? 0) + d - h);
    } else {
      movs.set(a.id, [...(movs.get(a.id) ?? []), { l, x }]);
    }
  }

  const ids = new Set([...movs.keys(), ...(filtro.incluirSinMovimiento ? [...inicial.keys()].filter((k) => inicial.get(k) !== 0) : [])]);
  return [...ids].map((id) => aux.get(id)!)
    .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.codigo.localeCompare(b.codigo))
    .map((a) => {
      let saldo = inicial.get(a.id) ?? 0;
      let tD = 0;
      let tH = 0;
      const movimientos = (movs.get(a.id) ?? [])
        .sort((p, q) => p.x.fecha.localeCompare(q.x.fecha) || p.x.codigo.localeCompare(q.x.codigo) || p.l.renglon - q.l.renglon)
        .map(({ l, x }) => {
          const [d, h] = montos(l, filtro.moneda);
          saldo += d - h; tD += d; tH += h;
          const cu = cuenta.get(l.cuenta_id);
          return {
            fecha: x.fecha, comprobante: x.codigo, cuenta: cu?.codigo ?? '?', nombreCuenta: cu?.nombre ?? '?',
            referencia: l.referencia, descripcion: l.descripcion ?? x.concepto, debe: n(d), haber: n(h), saldo: n(saldo),
          };
        });
      return { auxiliar: a, saldoInicial: n(inicial.get(a.id) ?? 0), movimientos, debe: n(tD), haber: n(tH), saldoFinal: n(saldo) };
    });
}

/* ───────────── Balance de Comprobación ───────────── */

export interface FilaBalance {
  cuenta: ContCuenta;
  nivel: number;
  saldoInicial: number;
  debe: number;
  haber: number;
  saldoActual: number;
  eq?: { saldoInicial: number; debe: number; haber: number; saldoActual: number };
}
type TotalesBalance = { saldoInicial: number; debe: number; haber: number; saldoActual: number };
export interface BalanceComprobacion {
  filas: FilaBalance[];
  totales: TotalesBalance & { eq?: TotalesBalance };
}

export interface FiltroBalance {
  desde: string;
  hasta: string;
  moneda: MonedaInforme;
  /** «Nivel de Detalle» de Galac: hasta qué nivel se muestran las cuentas. */
  nivel: number;
  /** «Cuentas sin movimiento»: incluir las que no tienen saldo ni movimiento. */
  incluirSinMovimiento?: boolean;
}

export function balanceComprobacion(f: FuenteInforme, filtro: FiltroBalance): BalanceComprobacion {
  const { comp, cuenta } = indice(f);
  // Acumulado por cuenta de movimiento: [saldo inicial, debe, haber].
  const acc = new Map<string, [number, number, number]>();
  for (const l of f.lineas) {
    const x = comp.get(l.comprobante_id);
    if (!x || x.fecha > filtro.hasta) continue;
    const [d, h] = montos(l, filtro.moneda);
    const a = acc.get(l.cuenta_id) ?? [0, 0, 0];
    if (x.fecha < filtro.desde) a[0] += d - h; else { a[1] += d; a[2] += h; }
    acc.set(l.cuenta_id, a);
  }
  // Cada título suma lo de sus subcuentas: se sube por el código hasta el nivel 1.
  const porCodigo = new Map(f.cuentas.map((x) => [x.codigo, x]));
  const total = new Map<string, [number, number, number]>();
  for (const [id, a] of acc) {
    const cu = cuenta.get(id);
    if (!cu) continue;
    for (let cod: string | null = cu.codigo; cod; cod = codigoPadre(cod)) {
      const t = total.get(cod) ?? [0, 0, 0];
      t[0] += a[0]; t[1] += a[1]; t[2] += a[2];
      total.set(cod, t);
    }
  }
  const filas: FilaBalance[] = [...f.cuentas]
    .filter((cu) => nivelDe(cu.codigo) <= filtro.nivel)
    .sort((a, b) => compararCodigos(a.codigo, b.codigo))
    .map((cu) => {
      const [si, d, h] = total.get(cu.codigo) ?? [0, 0, 0];
      return { cuenta: cu, nivel: nivelDe(cu.codigo), saldoInicial: n(si), debe: n(d), haber: n(h), saldoActual: n(si + d - h) };
    })
    .filter((x) => filtro.incluirSinMovimiento || x.saldoInicial !== 0 || x.debe !== 0 || x.haber !== 0 || x.saldoActual !== 0);
  // TOTALES: los de nivel 1 (cada peso está contado una sola vez ahí).
  let si = 0;
  let d = 0;
  let h = 0;
  for (const [cod, t] of total) {
    if (!porCodigo.has(cod) || nivelDe(cod) !== 1) continue;
    si += t[0]; d += t[1]; h += t[2];
  }
  return { filas, totales: { saldoInicial: n(si), debe: n(d), haber: n(h), saldoActual: n(si + d - h) } };
}

/** Galac: los saldos acreedores (negativos) entre paréntesis. */
export function formatoSaldo(x: number, formatear: (v: number) => string): string {
  return x < 0 ? `(${formatear(-x)})` : formatear(x);
}

/* ───────────── La moneda equivalente ─────────────
   El mismo informe en la otra moneda, emparejado con el principal. Los
   comprobantes y renglones que entran no dependen de la moneda: el diario
   y los movimientos del mayor se emparejan por posición. Las cuentas, por
   id: una cuenta con saldo en Bs y en cero en $ (el diferencial cambiario
   solo mueve Bs) falta en el otro informe, y su equivalente es cero. */

const dh = (x: { debe: number; haber: number }) => ({ debe: x.debe, haber: x.haber });

export function diarioConEquivalente(p: LibroDiario, o: LibroDiario): LibroDiario {
  const otro = new Map(o.comprobantes.map((x) => [x.comprobante.id, x]));
  return {
    ...p,
    eq: dh(o),
    comprobantes: p.comprobantes.map((x) => {
      const y = otro.get(x.comprobante.id);
      return { ...x, eq: y ? dh(y) : { debe: 0, haber: 0 }, asientos: x.asientos.map((a, i) => ({ ...a, eq: y?.asientos[i] ? dh(y.asientos[i]) : { debe: 0, haber: 0 } })) };
    }),
  };
}

export function mayorConEquivalente(p: CuentaMayor[], o: CuentaMayor[]): CuentaMayor[] {
  const otro = new Map(o.map((x) => [x.cuenta.id, x]));
  return p.map((x) => {
    const y = otro.get(x.cuenta.id);
    return {
      ...x,
      eq: { saldoInicial: y?.saldoInicial ?? 0, debe: y?.debe ?? 0, haber: y?.haber ?? 0, saldoFinal: y?.saldoFinal ?? 0 },
      movimientos: x.movimientos.map((m, i) => {
        const z = y?.movimientos[i];
        return { ...m, eq: { debe: z?.debe ?? 0, haber: z?.haber ?? 0, saldo: z?.saldo ?? 0 } };
      }),
    };
  });
}

export function auxiliaresConEquivalente(p: AuxiliarMayor[], o: AuxiliarMayor[]): AuxiliarMayor[] {
  const otro = new Map(o.map((x) => [x.auxiliar.id, x]));
  return p.map((x) => {
    const y = otro.get(x.auxiliar.id);
    return {
      ...x,
      eq: { saldoInicial: y?.saldoInicial ?? 0, debe: y?.debe ?? 0, haber: y?.haber ?? 0, saldoFinal: y?.saldoFinal ?? 0 },
      movimientos: x.movimientos.map((m, i) => {
        const z = y?.movimientos[i];
        return { ...m, eq: { debe: z?.debe ?? 0, haber: z?.haber ?? 0, saldo: z?.saldo ?? 0 } };
      }),
    };
  });
}

export function balanceConEquivalente(p: BalanceComprobacion, o: BalanceComprobacion): BalanceComprobacion {
  const otro = new Map(o.filas.map((x) => [x.cuenta.id, x]));
  const cero = { saldoInicial: 0, debe: 0, haber: 0, saldoActual: 0 };
  const sin = ({ saldoInicial, debe, haber, saldoActual }: TotalesBalance) => ({ saldoInicial, debe, haber, saldoActual });
  return {
    filas: p.filas.map((x) => {
      const y = otro.get(x.cuenta.id);
      return { ...x, eq: y ? sin(y) : cero };
    }),
    totales: { ...p.totales, eq: sin(o.totales) },
  };
}
