/* ============================================================
   MGG · RRHH · Cómo se arma la quincena y el recibo

   Así se lleva la nómina (tal como venía haciéndose en la planilla):

   El sueldo mensual de cada persona se reparte en DOS partes:
     · SUELDO  — el 20%. Es la parte que se convierte a bolívares.
     · BONO    — el 80%.
   La quincena es la mitad de cada una.

   El SUELDO DIARIO sale de la quincena, no del mes: sueldo quincenal ÷ 15.
   Da lo mismo que mensual ÷ 30, pero se escribe como lo escribe la planilla
   para que los números se puedan cruzar renglón por renglón.

   Los días se cuentan en DOS renglones separados —trabajados y de descanso—
   porque así lo exige el recibo: los dos se pagan al mismo diario, pero
   tienen que verse aparte.

   LA TASA: se guarda la del día en que se cierra la quincena. No se recalcula
   después. Un recibo firmado en septiembre no puede cambiar de monto porque
   el dólar se movió en octubre.
   ============================================================ */

/** Qué porción del sueldo es "sueldo" (el resto es bono). */
export const PORCION_SUELDO = 0.20;

/** Días de una quincena: es el divisor del sueldo diario. */
export const DIAS_QUINCENA = 15;

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export interface RepartoSueldo {
  /** Lo que la persona cobra al mes, completo. */
  mensual: number;
  sueldoMes: number;
  bonoMes: number;
  sueldoQuincena: number;
  bonoQuincena: number;
  /** Lo que cobra en la quincena: sueldo + bono. */
  totalQuincena: number;
}

/**
 * Reparte el sueldo mensual en sueldo (20%) y bono (80%).
 *
 * El bono se calcula RESTANDO, no multiplicando por 0,80: así las dos partes
 * siempre suman el total exacto. Multiplicar las dos y redondear cada una por
 * separado deja centavos sueltos que después no cuadran en el recibo.
 */
export function repartirSueldo(mensual: number, porcionSueldo = PORCION_SUELDO): RepartoSueldo {
  const m = round2(Math.max(0, Number(mensual) || 0));
  const sueldoMes = round2(m * porcionSueldo);
  const bonoMes = round2(m - sueldoMes);
  const sueldoQuincena = round2(sueldoMes / 2);
  const bonoQuincena = round2(bonoMes / 2);
  return {
    mensual: m,
    sueldoMes,
    bonoMes,
    sueldoQuincena,
    bonoQuincena,
    totalQuincena: round2(sueldoQuincena + bonoQuincena),
  };
}

/** El diario sale de la quincena: es como se calcula en el recibo. */
export function sueldoDiario(sueldoQuincena: number, dias = DIAS_QUINCENA): number {
  const d = Number(dias) || 0;
  return d > 0 ? round2((Number(sueldoQuincena) || 0) / d) : 0;
}

/* ───────── Bolívares ───────── */

export function aBs(usd: number, tasa: number): number {
  return round2((Number(usd) || 0) * (Number(tasa) || 0));
}

/** El equivalente en dólares de un monto en bolívares, a la tasa del recibo. */
export function aUsd(bs: number, tasa: number): number {
  const t = Number(tasa) || 0;
  return t > 0 ? round2((Number(bs) || 0) / t) : 0;
}

/* ───────── Los renglones del recibo ───────── */

/** Los conceptos que se descuentan, en el orden en que van en el recibo. */
export const CONCEPTOS_DEDUCCION = [
  { key: 'ivss', label: 'Seguro Social Obligatorio' },
  { key: 'rpe', label: 'Reg. Prestacional de Empleo' },
  { key: 'faov', label: 'Reg. Prest. de Vivienda y Hábitat' },
  { key: 'sindicato', label: 'Sindicato' },
  { key: 'prestamos', label: 'Préstamos' },
  { key: 'anticipos', label: 'Anticipos' },
  { key: 'otros', label: 'Otros' },
] as const;

export type ClaveDeduccion = typeof CONCEPTOS_DEDUCCION[number]['key'];

export interface LineaRecibo {
  concepto: string;
  /** Cantidad de días, cuando el renglón se paga por día. */
  dias?: number | null;
  /** Lo que suma (devengado) o lo que resta (deducción), en dólares. */
  usd: number;
  tipo: 'devengado' | 'deduccion';
}

export interface DatosRecibo {
  /**
   * Lo que de verdad se devenga en la quincena, ya calculado por la nómina.
   *
   * El recibo se arma a partir de ESTO y no del sueldo mensual a propósito:
   * así los renglones siempre suman exactamente lo que se paga. Si se
   * recalculara desde el mensual, una quincena de días parciales daría un
   * recibo que no cuadra con el monto que Tesorería entregó.
   */
  brutoQuincena: number;
  diasTrabajados: number;
  diasDescanso: number;
  /** Bonos y viáticos extra de esta quincena (aparte del bono del 80%). */
  bonosExtra?: number;
  viaticos?: number;
  deducciones?: Partial<Record<ClaveDeduccion, number>>;
  tasa: number;
  porcionSueldo?: number;
}

export interface RepartoQuincena {
  bruto: number;
  /** La parte "sueldo" (20%): es la que se reparte entre los días. */
  sueldo: number;
  /** La parte "bono" (80%): va en su propio renglón, sin días. */
  bono: number;
}

/** Parte el devengado de la quincena en sueldo (20%) y bono (80%). */
export function repartirQuincena(bruto: number, porcionSueldo = PORCION_SUELDO): RepartoQuincena {
  const b = round2(Math.max(0, Number(bruto) || 0));
  const sueldo = round2(b * porcionSueldo);
  return { bruto: b, sueldo, bono: round2(b - sueldo) };
}

export interface ReciboCalculado {
  reparto: RepartoQuincena;
  diario: number;
  lineas: LineaRecibo[];
  totalDevengadoUsd: number;
  totalDeduccionUsd: number;
  netoUsd: number;
  totalDevengadoBs: number;
  totalDeduccionBs: number;
  netoBs: number;
  /** El bono del 80 %: se entrega en divisas, fuera de la tabla en bolívares. */
  bonoUsd: number;
  /** Lo que la persona se lleva: el neto de la tabla más el bono en divisas. */
  totalRecibidoUsd: number;
  tasa: number;
}

/**
 * Arma el recibo completo: los renglones, los totales y el neto, en dólares y
 * en bolívares a la tasa de la quincena.
 *
 * Los días trabajados y los de descanso se pagan los dos al sueldo diario, y
 * entre los dos suman la parte «sueldo» (el 20 %), que es lo que se paga en
 * bolívares. El bono (el 80 %) NO entra en la tabla: se entrega en divisas y
 * sale en su propio bloque. El recibo muestra igual TODO lo que la persona
 * cobra, pero cada parte en la moneda en que de verdad se paga.
 */
export function calcularRecibo(d: DatosRecibo): ReciboCalculado {
  const reparto = repartirQuincena(d.brutoQuincena, d.porcionSueldo ?? PORCION_SUELDO);
  const trabajados = Math.max(0, Number(d.diasTrabajados) || 0);
  const descanso = Math.max(0, Number(d.diasDescanso) || 0);
  const diasPagados = trabajados + descanso;

  /* El diario sale de repartir la parte "sueldo" entre los días que se pagan,
     no de una fórmula fija: así los dos renglones de días suman exactamente
     esa parte, sin centavos sueltos, sea cual sea la cantidad de días. */
  const diario = sueldoDiario(reparto.sueldo, diasPagados || DIAS_QUINCENA);
  /* OJO con el redondeo: el renglón se calcula con la división SIN redondear,
     no multiplicando el diario ya redondeado a centavos. Con $40 en 15 días el
     diario es 2,6666… y redondearlo a 2,67 antes de multiplicarlo por 11 mete
     el error once veces: daría 29,37 donde la planilla dice 29,33. El `diario`
     redondeado queda solo para MOSTRARLO. */
  const porTrabajados = diasPagados > 0 ? round2((reparto.sueldo * trabajados) / diasPagados) : 0;
  // El último renglón absorbe el redondeo para que la suma cierre exacta.
  const porDescanso = diasPagados > 0 ? round2(reparto.sueldo - porTrabajados) : 0;

  /* La tabla del recibo lleva SOLO lo que se paga en bolívares: la parte
     «sueldo» (20 %) repartida en días, más los extras. El bono del 80 % NO va
     acá — se entrega en divisas y tiene su propio bloque al pie. Meterlo en
     esta tabla haría que el «pagado en bolívares» dijera un número que nunca
     se pagó en bolívares. */
  const lineas: LineaRecibo[] = [
    { concepto: 'Días trabajados', dias: trabajados, usd: porTrabajados, tipo: 'devengado' },
    { concepto: 'Días de descanso', dias: descanso, usd: porDescanso, tipo: 'devengado' },
    { concepto: 'Bonos', dias: null, usd: round2(d.bonosExtra ?? 0), tipo: 'devengado' },
    { concepto: 'Viáticos', dias: null, usd: round2(d.viaticos ?? 0), tipo: 'devengado' },
  ];

  for (const c of CONCEPTOS_DEDUCCION) {
    lineas.push({ concepto: c.label, dias: null, usd: round2(d.deducciones?.[c.key] ?? 0), tipo: 'deduccion' });
  }

  const totalDevengadoUsd = round2(lineas.filter((l) => l.tipo === 'devengado').reduce((a, l) => a + l.usd, 0));
  const totalDeduccionUsd = round2(lineas.filter((l) => l.tipo === 'deduccion').reduce((a, l) => a + l.usd, 0));
  const netoUsd = round2(totalDevengadoUsd - totalDeduccionUsd);
  const tasa = Number(d.tasa) || 0;

  return {
    reparto, diario, lineas,
    totalDevengadoUsd, totalDeduccionUsd, netoUsd,
    totalDevengadoBs: aBs(totalDevengadoUsd, tasa),
    totalDeduccionBs: aBs(totalDeduccionUsd, tasa),
    netoBs: aBs(netoUsd, tasa),
    // El bono va en divisas, aparte de la tabla en bolívares.
    bonoUsd: reparto.bono,
    // Lo que la persona se lleva de verdad: lo de la tabla más el bono.
    totalRecibidoUsd: round2(netoUsd + reparto.bono),
    tasa,
  };
}

/** Los renglones que de verdad se imprimen: los que tienen monto o días. */
export function lineasConMonto(lineas: LineaRecibo[]): LineaRecibo[] {
  return lineas.filter((l) => l.usd !== 0 || (l.dias ?? 0) > 0);
}
