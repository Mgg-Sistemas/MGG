/* ============================================================
   MGG · Contabilidad · Motor de reglas (lógica pura)

   De un HECHO que registró un módulo de MGG (un gasto de caja, un pago de
   OC, una recepción…) a los renglones de su comprobante, con las reglas
   de contabilización (cont_reglas + cont_regla_lineas) y los mapeos
   (cont_mapeos). Es el §4 de contabilidad-datos-simulados.md y el §7 del
   generador del Carril BD, portado tal cual para que la maqueta produzca
   EXACTAMENTE los comprobantes esperados (prueba oráculo).

   1. Regla: la de su evento cuya condición coincide con el hecho.
   2. Por cada línea de la regla: monto = importes[línea.importe] (0 o
      ausente → la línea no se genera); cuenta fija o por mapeo; centro
      (ninguno / fijo / del evento o el del mapeo; si la cuenta lo exige y
      no hay, el centro por defecto de Parámetros); auxiliar solo si la
      cuenta lo exige; moneda del importe o del hecho; Bs = monto × tasa,
      $ = monto si es USD o Bs ÷ tasa del dólar.
   3. Redondeo: si no cuadra por centavos (≤ 0,05), la diferencia va a la
      línea de mayor monto del lado menor. Nunca se agrega una línea.
   4. Status: Contabilizado si cuadra exacto en Bs y en $.
   El número y los ids los pone quien graba (la simulación o la base).

   Toda la aritmética es decimal exacta (logica/decimal.ts).
   ============================================================ */

import { aCentavos, aMillonesimas, deCentavos, deMillonesimas, dividirTasa, multiplicarTasa } from './decimal';
import type {
  ContCuenta, ContMapeo, ContRegla, ContReglaLinea, ContTasa, EstadoComprobante, Moneda,
} from '../tipos';

/** Lo que registró un módulo de MGG. Los importes van como texto decimal, para no perder centavos. */
export interface HechoContable {
  id: string;
  evento: string;
  fecha: string;
  moneda: Moneda;
  importes: Record<string, string>;
  /** Moneda propia de algún importe (en la conversión, `entregado` va en USD). */
  monedas?: Record<string, Moneda>;
  origen_modulo: string;
  origen_ref?: string | null;
  descripcion: string;
  /** Código del centro de costo del hecho. */
  centro?: string | null;
  /** Código del auxiliar del hecho. */
  auxiliar?: string | null;
  /** Claves de mapeo (caja, caja_destino, categoria_gasto, almacen…) y campos de condición (clase, destino, tipo). */
  [campo: string]: unknown;
}

export interface CatalogoMotor {
  reglas: ContRegla[];
  lineasRegla: ContReglaLinea[];
  mapeos: ContMapeo[];
  cuentas: ContCuenta[];
  tasas: ContTasa[];
  /** Código → id. */
  centroId: (codigo: string) => string | null;
  auxiliarId: (codigo: string) => string | null;
  centroDefectoId: string | null;
}

export interface LineaGenerada {
  cuenta_id: string;
  centro_costo_id: string | null;
  auxiliar_id: string | null;
  descripcion: string | null;
  referencia: string | null;
  moneda: Moneda;
  monto_moneda: number;
  tasa: number;
  debe_ves: number;
  haber_ves: number;
  debe_usd: number;
  haber_usd: number;
}

export interface ComprobanteGenerado {
  regla: ContRegla;
  hecho: HechoContable;
  fecha: string;
  concepto: string;
  /** VES por USD de la fecha. */
  tasa: number;
  estado: EstadoComprobante;
  /** Galac «Número de Lote»: las reglas por lote agrupan bajo «LOTE-<regla>-<fecha>». */
  numero_lote: string | null;
  lineas: LineaGenerada[];
}

/** El catálogo del motor a partir de las tablas de Contabilidad (los hechos traen códigos de centro y auxiliar). */
export function catalogoDe(t: {
  cont_reglas: ContRegla[]; cont_regla_lineas: ContReglaLinea[]; cont_mapeos: ContMapeo[]; cont_cuentas: ContCuenta[]; cont_tasas: ContTasa[];
  cont_centros_costo: Array<{ id: string; codigo: string }>; cont_auxiliares: Array<{ id: string; codigo: string }>;
  cont_parametros: { centro_costo_defecto_id: string | null };
}): CatalogoMotor {
  const centros = new Map(t.cont_centros_costo.map((c) => [c.codigo, c.id]));
  const auxiliares = new Map(t.cont_auxiliares.map((a) => [a.codigo, a.id]));
  return {
    reglas: t.cont_reglas, lineasRegla: t.cont_regla_lineas, mapeos: t.cont_mapeos, cuentas: t.cont_cuentas, tasas: t.cont_tasas,
    centroId: (c) => centros.get(c) ?? null, auxiliarId: (c) => auxiliares.get(c) ?? null,
    centroDefectoId: t.cont_parametros.centro_costo_defecto_id,
  };
}

/** El lote de una regla por lote: uno por regla y día (el comedor, en los datos de BD). */
export const loteDe = (regla: ContRegla, fecha: string): string | null =>
  regla.tipo_contabilizacion === 'por_lote' ? `LOTE-${regla.codigo}-${fecha}` : null;

/** Galac: la tasa del día o, en fin de semana o feriado, la última de los 7 días previos. */
export function tasaDelDia(tasas: ContTasa[], moneda: Moneda, fecha: string, maxDias = 7): bigint {
  if (moneda === 'VES') return 1_000_000n;
  const desde = restarDias(fecha, maxDias - 1);
  let mejor: ContTasa | null = null;
  for (const t of tasas) {
    if (t.moneda !== moneda || t.fecha > fecha || t.fecha < desde) continue;
    if (!mejor || t.fecha > mejor.fecha) mejor = t;
  }
  if (!mejor) throw new Error(`No hay tasa de ${moneda} para el ${fecha} ni para los ${maxDias - 1} días anteriores.`);
  return aMillonesimas(mejor.tasa_ves);
}

function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** La regla de un hecho: la primera de su evento cuya condición coincide con los campos del hecho. */
export function reglaDe(hecho: HechoContable, reglas: ContRegla[]): ContRegla {
  const r = reglas.find((x) => x.evento === hecho.evento && x.activa &&
    Object.entries(x.condicion ?? {}).every(([k, v]) => hecho[k] === v));
  if (!r) throw new Error(`No hay regla de contabilización para el evento «${hecho.evento}» (hecho ${hecho.id}).`);
  return r;
}

interface LineaExacta {
  cuenta_id: string; centro_costo_id: string | null; auxiliar_id: string | null; descripcion: string | null; referencia: string | null;
  moneda: Moneda; monto: bigint; tasa: bigint; debe_ves: bigint; haber_ves: bigint; debe_usd: bigint; haber_usd: bigint;
}

/** Aplica la regla al hecho. Lanza un error en español si falta una tasa, un mapeo o un auxiliar obligatorio. */
export function contabilizarHecho(hecho: HechoContable, cat: CatalogoMotor): ComprobanteGenerado {
  const regla = reglaDe(hecho, cat.reglas);
  const plantilla = cat.lineasRegla.filter((l) => l.regla_id === regla.id).sort((a, b) => a.renglon - b.renglon);
  const tasaUsd = tasaDelDia(cat.tasas, 'USD', hecho.fecha);
  const lineas: LineaExacta[] = [];

  for (const rl of plantilla) {
    const monto = aCentavos(hecho.importes[rl.importe] ?? '0');
    if (monto <= 0n) continue;

    let cuentaId: string;
    let centroMapeo: string | null = null;
    if (rl.cuenta_fuente === 'fija') {
      cuentaId = rl.cuenta_id as string;
    } else {
      const clave = hecho[rl.mapeo_campo ?? (rl.mapeo_tipo as string)];
      const m = cat.mapeos.find((x) => x.tipo === rl.mapeo_tipo && x.clave === clave);
      if (!m) throw new Error(`Falta el mapeo ${rl.mapeo_tipo} «${String(clave)}» (hecho ${hecho.id}).`);
      cuentaId = m.cuenta_id;
      centroMapeo = m.centro_costo_id;
    }
    const cuenta = cat.cuentas.find((c) => c.id === cuentaId);
    if (!cuenta || !cuenta.es_movimiento) throw new Error(`La regla ${regla.codigo} usa una cuenta que no es de movimiento (hecho ${hecho.id}).`);

    let centro: string | null =
      rl.centro_fuente === 'ninguno' ? null
        : rl.centro_fuente === 'fijo' ? rl.centro_costo_id
          : (hecho.centro ? cat.centroId(hecho.centro) : null) ?? centroMapeo;
    if (cuenta.exige_centro_costo && !centro) centro = cat.centroDefectoId;

    let auxiliar: string | null = null;
    if (cuenta.exige_auxiliar) {
      auxiliar = rl.auxiliar_fuente !== 'ninguno' && hecho.auxiliar ? cat.auxiliarId(hecho.auxiliar) : null;
      if (!auxiliar) throw new Error(`La cuenta ${cuenta.codigo} exige auxiliar y el hecho ${hecho.id} no lo trae.`);
    }

    const moneda = hecho.monedas?.[rl.importe] ?? hecho.moneda;
    const tasa = tasaDelDia(cat.tasas, moneda, hecho.fecha);
    const ves = multiplicarTasa(monto, tasa);
    const usd = moneda === 'USD' ? monto : dividirTasa(ves, tasaUsd);
    const debe = rl.lado === 'debe';
    lineas.push({
      cuenta_id: cuentaId, centro_costo_id: centro, auxiliar_id: auxiliar,
      descripcion: hecho.descripcion ?? null, referencia: hecho.origen_ref ?? null,
      moneda, monto, tasa,
      debe_ves: debe ? ves : 0n, haber_ves: debe ? 0n : ves, debe_usd: debe ? usd : 0n, haber_usd: debe ? 0n : usd,
    });
  }

  cuadrarRedondeo(lineas);
  const sum = (k: 'debe_ves' | 'haber_ves' | 'debe_usd' | 'haber_usd') => lineas.reduce((a, l) => a + l[k], 0n);
  const cuadra = sum('debe_ves') === sum('haber_ves') && sum('debe_usd') === sum('haber_usd') && lineas.length > 0;

  return {
    regla, hecho, fecha: hecho.fecha, concepto: hecho.descripcion, tasa: deMillonesimas(tasaUsd),
    estado: cuadra ? 'contabilizado' : 'descuadrado',
    numero_lote: loteDe(regla, hecho.fecha),
    lineas: lineas.map((l) => ({
      cuenta_id: l.cuenta_id, centro_costo_id: l.centro_costo_id, auxiliar_id: l.auxiliar_id,
      descripcion: l.descripcion, referencia: l.referencia, moneda: l.moneda,
      monto_moneda: deCentavos(l.monto), tasa: deMillonesimas(l.tasa),
      debe_ves: deCentavos(l.debe_ves), haber_ves: deCentavos(l.haber_ves), debe_usd: deCentavos(l.debe_usd), haber_usd: deCentavos(l.haber_usd),
    })),
  };
}

/** Máximo que el redondeo puede mover, por moneda: 0,05. Más que eso es un error de la regla. */
const MAX_REDONDEO = 5n;

/**
 * Si el comprobante no cuadra por centavos, la diferencia va a la línea de
 * mayor monto del lado menor (la primera, si hay empate). Nunca se agrega
 * una línea. Una diferencia mayor que 0,05 queda: el comprobante sale
 * Descuadrado y lo dice.
 */
export function cuadrarRedondeo(lineas: Array<{ debe_ves: bigint; haber_ves: bigint; debe_usd: bigint; haber_usd: bigint }>): void {
  for (const m of ['ves', 'usd'] as const) {
    const kd = `debe_${m}` as const;
    const kh = `haber_${m}` as const;
    const dif = lineas.reduce((a, l) => a + l[kd] - l[kh], 0n);
    if (dif === 0n || dif > MAX_REDONDEO || dif < -MAX_REDONDEO) continue;
    const lado = dif > 0n ? kh : kd;
    let mayor: (typeof lineas)[number] | null = null;
    for (const l of lineas) if (l[lado] > 0n && (!mayor || l[lado] > mayor[lado])) mayor = l;
    if (mayor) mayor[lado] += dif > 0n ? dif : -dif;
  }
}
