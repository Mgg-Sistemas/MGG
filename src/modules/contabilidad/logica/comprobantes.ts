/* ============================================================
   MGG · Contabilidad · Comprobantes (lógica pura)

   Como Galac (GALAC-CONTABILIDAD-REFERENCIA.md §3):
   · Status automático: «Contabilizado» si Debe = Haber, «Descuadrado» si
     no. Un descuadrado se graba (si Parámetros lo permite) pero sus
     montos NO entran en ningún saldo ni informe. No hay borrador ni
     anulado: se anula con «Reversar» (mismas cuentas, Debe ↔ Haber),
     solo sobre uno contabilizado; el reverso nace contabilizado.
   · Numeración al grabar, con el tipo elegido en Parámetros:
       Mes-Consecutivo  «06-000003»     correlativo por mes
       Consecutivo      «000003»        correlativo por ejercicio
       Tipo-Mes-Número  «EG-06-000003»  correlativo por tipo y mes

   Doble moneda (modelo v0): cada renglón nace en su moneda (monto ×
   tasa VES por unidad) y se guarda en VES, la funcional (VEN-NIF), y en
   USD, la de referencia. El cuadre se mide en las DOS, con la tolerancia
   de cont_parametros.tolerancia_cuadre (0,01).
   · VES → USD con la tasa del dólar del comprobante.
   · USD guarda su monto tal cual en USD.
   · Otra (USDT…) → VES con su tasa, y de VES a USD con la del dólar.
   Se redondea a 2 decimales una sola vez, al final de cada conversión.
   ============================================================ */

import type {
  ContAuxiliar, ContCentroCosto, ContComprobante, ContComprobanteLinea, ContCuenta, ContParametros, ContPeriodo,
  ContTipoComprobante, EstadoComprobante, Moneda, TipoNumeracion,
} from '../tipos';

export const redondear2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;

export type Lado = 'debe' | 'haber';

/** Lo que el usuario escribe en un renglón (la rejilla «ASIENTOS» de Galac); VES y USD se calculan. */
export interface RenglonBorrador {
  cuenta_id: string;
  /** «Fecha Ref.»: solo si difiere de la del comprobante. */
  fecha_referencia: string | null;
  /** «Referencia»: n.° de cheque, factura o soporte. */
  referencia: string;
  auxiliar_id: string | null;
  centro_costo_id: string | null;
  descripcion: string;
  moneda: Moneda;
  /** Monto en la moneda del renglón, siempre positivo. */
  monto_moneda: number;
  lado: Lado;
  /** VES por unidad de `moneda`; en VES vale 1. */
  tasa: number;
}

export interface Montos {
  debe_ves: number;
  haber_ves: number;
  debe_usd: number;
  haber_usd: number;
}

/** Los cuatro montos de un renglón. `tasaUsd` = VES por USD del comprobante. */
export function montosDeRenglon(r: Pick<RenglonBorrador, 'moneda' | 'monto_moneda' | 'lado' | 'tasa'>, tasaUsd: number): Montos {
  const ves = r.moneda === 'VES' ? redondear2(r.monto_moneda) : redondear2(r.monto_moneda * r.tasa);
  const usd = r.moneda === 'USD' ? redondear2(r.monto_moneda)
    : tasaUsd > 0 ? redondear2((r.moneda === 'VES' ? r.monto_moneda : r.monto_moneda * r.tasa) / tasaUsd) : 0;
  return r.lado === 'debe'
    ? { debe_ves: ves, haber_ves: 0, debe_usd: usd, haber_usd: 0 }
    : { debe_ves: 0, haber_ves: ves, debe_usd: 0, haber_usd: usd };
}

export interface Totales extends Montos {
  dif_ves: number;
  dif_usd: number;
}

export function totalesDe(lineas: Montos[]): Totales {
  const t = lineas.reduce(
    (a, l) => ({ debe_ves: a.debe_ves + l.debe_ves, haber_ves: a.haber_ves + l.haber_ves, debe_usd: a.debe_usd + l.debe_usd, haber_usd: a.haber_usd + l.haber_usd }),
    { debe_ves: 0, haber_ves: 0, debe_usd: 0, haber_usd: 0 },
  );
  const r = { debe_ves: redondear2(t.debe_ves), haber_ves: redondear2(t.haber_ves), debe_usd: redondear2(t.debe_usd), haber_usd: redondear2(t.haber_usd) };
  return { ...r, dif_ves: redondear2(r.debe_ves - r.haber_ves), dif_usd: redondear2(r.debe_usd - r.haber_usd) };
}

export interface Cuadre {
  cuadra_ves: boolean;
  cuadra_usd: boolean;
  cuadra: boolean;
}

/** Cuadra si la diferencia es, en valor absoluto, menor o igual que la tolerancia (con un margen de coma flotante). */
export function cuadreDe(t: Totales, tolerancia: number): Cuadre {
  const ok = (d: number) => Math.abs(d) <= tolerancia + 1e-9;
  const cuadra_ves = ok(t.dif_ves);
  const cuadra_usd = ok(t.dif_usd);
  return { cuadra_ves, cuadra_usd, cuadra: cuadra_ves && cuadra_usd };
}

/** El status de Galac: lo decide el cuadre, no el usuario. Sin renglones o sin montos es descuadrado. */
export function statusDe(t: Totales, tolerancia: number): EstadoComprobante {
  if (t.debe_ves === 0 && t.haber_ves === 0) return 'descuadrado';
  return cuadreDe(t, tolerancia).cuadra ? 'contabilizado' : 'descuadrado';
}

/** El mensaje único del mes cerrado (Master, 20/10 13:11). `codigo` = AAAAMM. */
export const mensajeMesCerrado = (codigo: string): string =>
  `El mes ${codigo.slice(4)}/${codigo.slice(0, 4)} está cerrado: no se puede ingresar ni modificar.`;

/** El período 1-12 que contiene la fecha (el 13 es solo para el cierre). */
export function periodoDeFecha(fecha: string, periodos: ContPeriodo[]): ContPeriodo | null {
  return periodos.find((p) => p.numero !== 13 && p.fecha_inicio <= fecha && fecha <= p.fecha_fin) ?? null;
}

/** La tasa vigente a una fecha: la del mismo día o, si no hay, la última anterior. */
export function tasaVigente(tasas: Array<{ fecha: string; moneda: Moneda; tasa_ves: number }>, moneda: Moneda, fecha: string): number | null {
  if (moneda === 'VES') return 1;
  let mejor: { fecha: string; tasa_ves: number } | null = null;
  for (const t of tasas) {
    if (t.moneda !== moneda || t.fecha > fecha) continue;
    if (!mejor || t.fecha > mejor.fecha) mejor = t;
  }
  return mejor?.tasa_ves ?? null;
}

export interface ContextoValidacion {
  cuentas: ContCuenta[];
  centros: ContCentroCosto[];
  auxiliares: ContAuxiliar[];
  periodos: ContPeriodo[];
  parametros: ContParametros;
  /** AAAA-MM-DD de hoy, para la regla de fecha futura. */
  hoy: string;
}

export interface CabeceraBorrador {
  tipo_id: string;
  fecha: string;
  /** «Descripción» del comprobante en Galac. */
  concepto: string;
  moneda_documento: Moneda;
  /** VES por USD. */
  tasa: number;
  /** «N° Doc. Origen». */
  origen_ref: string;
}

/**
 * Lo que impide GRABAR, sin contar el cuadre (un descuadrado se graba como
 * «Descuadrado»). Cuenta título, auxiliar o centro faltante, montos y
 * fechas inválidas se rechazan siempre, como en Galac.
 */
export function erroresDeComprobante(cab: CabeceraBorrador, renglones: RenglonBorrador[], ctx: ContextoValidacion): string[] {
  const errores: string[] = [];
  if (!cab.tipo_id) errores.push('Tipo de comprobante requerido.');
  if (!cab.concepto.trim()) errores.push('Descripción del comprobante requerida.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cab.fecha)) errores.push('Fecha requerida.');
  else {
    if (!ctx.parametros.permite_fecha_futura && cab.fecha > ctx.hoy) errores.push('La fecha no puede ser futura.');
    const p = periodoDeFecha(cab.fecha, ctx.periodos);
    if (!p) errores.push('La fecha no cae en ningún mes del período.');
    else if (p.estado !== 'abierto') errores.push(mensajeMesCerrado(p.codigo));
  }
  if (!(cab.tasa > 0)) errores.push('Tasa del dólar requerida (VES por USD).');
  if (renglones.length === 0) errores.push('El comprobante no tiene asientos.');

  renglones.forEach((r, i) => {
    const n = `Asiento ${i + 1}`;
    const cuenta = ctx.cuentas.find((c) => c.id === r.cuenta_id);
    if (!cuenta) { errores.push(`${n}: cuenta requerida.`); return; }
    if (!cuenta.es_movimiento) errores.push(`${n}: la cuenta ${cuenta.codigo} es Cuenta Título y no recibe asientos.`);
    if (!cuenta.activa) errores.push(`${n}: la cuenta ${cuenta.codigo} está inactiva.`);
    if (cuenta.moneda && cuenta.moneda !== r.moneda) errores.push(`${n}: la cuenta ${cuenta.codigo} solo se mueve en ${cuenta.moneda}.`);
    if (!(r.monto_moneda > 0)) errores.push(`${n}: el monto debe ser mayor que cero.`);
    if (!(r.tasa > 0)) errores.push(`${n}: falta la tasa de ${r.moneda}.`);
    if (r.fecha_referencia && !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha_referencia)) errores.push(`${n}: la fecha de referencia no es válida.`);
    if (cuenta.exige_centro_costo && !r.centro_costo_id) errores.push(`${n}: la cuenta ${cuenta.codigo} exige centro de costo.`);
    if (r.centro_costo_id && !ctx.centros.some((c) => c.id === r.centro_costo_id && c.activo)) errores.push(`${n}: el centro de costo no existe o está inactivo.`);
    if (cuenta.exige_auxiliar) {
      const aux = ctx.auxiliares.find((a) => a.id === r.auxiliar_id);
      if (!aux) errores.push(`${n}: la cuenta ${cuenta.codigo} exige un auxiliar (${cuenta.tipo_auxiliar}).`);
      else if (aux.tipo !== cuenta.tipo_auxiliar) errores.push(`${n}: el auxiliar ${aux.codigo} no es del tipo ${cuenta.tipo_auxiliar}.`);
    }
  });
  return errores;
}

/* ───────────── Numeración (Galac §3.4) ───────────── */

export const NOMBRE_NUMERACION: Record<TipoNumeracion, string> = {
  tipo_mes_numero: 'Tipo-Mes-Número', consecutivo: 'Consecutivo', mes_consecutivo: 'Mes-Consecutivo',
};

type ClaveNumeracion = Pick<ContComprobante, 'tipo_id' | 'periodo_id'>;

/** Si dos comprobantes comparten correlativo según el tipo de numeración. */
export function mismoCorrelativo(a: ClaveNumeracion, b: ClaveNumeracion, tipoNumeracion: TipoNumeracion, periodos: ContPeriodo[]): boolean {
  if (tipoNumeracion === 'consecutivo') {
    const ej = (id: string) => periodos.find((p) => p.id === id)?.ejercicio_id;
    return ej(a.periodo_id) === ej(b.periodo_id);
  }
  if (tipoNumeracion === 'mes_consecutivo') return a.periodo_id === b.periodo_id;
  return a.periodo_id === b.periodo_id && a.tipo_id === b.tipo_id;
}

/** El número que sigue para un comprobante nuevo con esa clave. */
export function siguienteNumero(comprobantes: ContComprobante[], clave: ClaveNumeracion, tipoNumeracion: TipoNumeracion, periodos: ContPeriodo[]): number {
  const usados = comprobantes.filter((c) => mismoCorrelativo(c, clave, tipoNumeracion, periodos)).map((c) => c.numero ?? 0);
  return (usados.length ? Math.max(...usados) : 0) + 1;
}

/** «06-000003», «000003» o «EG-06-000003». El mes es el número del período (13 = cierre). */
export function codigoComprobante(tipoNumeracion: TipoNumeracion, tipo: ContTipoComprobante, periodo: ContPeriodo, numero: number): string {
  const mes = String(periodo.numero).padStart(2, '0');
  const n = String(numero).padStart(6, '0');
  if (tipoNumeracion === 'consecutivo') return n;
  if (tipoNumeracion === 'mes_consecutivo') return `${mes}-${n}`;
  return `${tipo.codigo}-${mes}-${n}`;
}

/* ───────────── Reverso (Galac §3.6) ───────────── */

/** Los renglones del reverso: mismas cuentas y montos, Debe ↔ Haber en las dos monedas. */
export function renglonesDeReverso(lineas: ContComprobanteLinea[], comprobante_id: string): ContComprobanteLinea[] {
  return lineas.map((l) => ({
    ...l,
    id: `${comprobante_id}-l${l.renglon}`,
    comprobante_id,
    debe_ves: l.haber_ves, haber_ves: l.debe_ves,
    debe_usd: l.haber_usd, haber_usd: l.debe_usd,
  }));
}

/**
 * La descripción del reverso lleva el número del original y el MOTIVO
 * (norma de MGG para toda acción que deshace algo; usuario, 20/10 12:15).
 * Galac usa «Reverso comprobante Nº 06000002».
 */
export function descripcionReverso(codigoOriginal: string, motivo: string): string {
  return `REVERSO DE Nº ${codigoOriginal} · ${motivo.trim().toUpperCase()}`;
}

/** El lado de un renglón ya guardado. */
export const ladoDe = (l: Pick<ContComprobanteLinea, 'debe_ves' | 'debe_usd'>): Lado => (l.debe_ves > 0 || l.debe_usd > 0 ? 'debe' : 'haber');

/** «Generado Por» de Galac a partir del origen del modelo. */
export const GENERADO_POR: Record<ContComprobante['origen'], string> = {
  manual: 'Usuario', automatico: 'Administrativo', apertura: 'Apertura', cierre: 'Cierre Cuentas de Resultado', reverso: 'Reverso',
};
