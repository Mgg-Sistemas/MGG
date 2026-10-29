/* ============================================================
   MGG · Contabilidad · Cierres (lógica pura)

   Modelo v0.5 §4 (Carril BD) y Galac §4:
   · Cierre de MES: los meses anteriores cerrados, ningún descuadrado en
     el mes, el DIFERENCIAL CAMBIARIO (revaluación) y la foto de saldos.
     Revaluación por cuenta en moneda extranjera × centro × auxiliar:
       ajuste = saldo_en_moneda × tasa_cierre − saldo_ves
     un comprobante AJ el último día, contra ganancia o pérdida cambiaria
     en el centro por defecto. Es el §7.c del generador de BD, portado
     tal cual (la prueba lo compara con control.revaluaciones).
   · Reabrir un mes: del último al primero, con motivo; su diferencial se
     reversa y se recalcula al volver a cerrar.
   · Cierre del EJERCICIO (pre-cierre o definitivo): los 12 meses
     cerrados; en el mes 13, un CI que cancela ingresos, costos y gastos
     contra Resultado del Ejercicio (cuenta × centro × auxiliar) y un
     segundo CI que lleva el Resultado a Superávit (inferido: Galac no
     documenta ese asiento).
   · APERTURA del siguiente: un AP el día 1 con los saldos de balance.
   Aritmética exacta en centavos (BigInt), como el resto del motor.
   ============================================================ */

import { aCentavos, aMillonesimas, deCentavos, deMillonesimas, multiplicarTasa } from './decimal';
import type {
  ContAuxiliar, ContCentroCosto, ContComprobante, ContComprobanteLinea, ContCuenta, ContEjercicio, ContIntegracion, ContParametros,
  ContPeriodo, ContTasa, Moneda,
} from '../tipos';

const nombreMes = (p: Pick<ContPeriodo, 'codigo'>) => `${p.codigo.slice(4)}/${p.codigo.slice(0, 4)}`;

/* ───────────── Validaciones de mes ───────────── */

/** Lo que impide cerrar el mes. Vacío = se puede cerrar. */
export function erroresCierreMes(
  periodo: ContPeriodo, periodos: ContPeriodo[], comprobantes: ContComprobante[], ejercicio: ContEjercicio | undefined,
  integraciones: ContIntegracion[] = [],
): string[] {
  const errores: string[] = [];
  if (periodo.numero === 13) errores.push('El mes 13 se cierra con el cierre del ejercicio.');
  if (periodo.estado === 'cerrado') errores.push(`El mes ${nombreMes(periodo)} ya está cerrado.`);
  if (ejercicio && ejercicio.estado !== 'abierto') errores.push(`El ejercicio ${ejercicio.nombre} no está abierto.`);
  const pendiente = periodos
    .filter((p) => p.ejercicio_id === periodo.ejercicio_id && p.numero < periodo.numero && p.numero <= 12 && p.estado !== 'cerrado')
    .sort((a, b) => a.numero - b.numero)[0];
  if (pendiente) errores.push(`Los meses se cierran en orden: primero el ${nombreMes(pendiente)}.`);
  const descuadrados = comprobantes.filter((c) => c.periodo_id === periodo.id && c.estado === 'descuadrado');
  if (descuadrados.length) {
    errores.push(`El mes tiene ${descuadrados.length} comprobante(s) descuadrado(s) (${descuadrados.map((c) => c.codigo).join(', ')}): se corrigen antes de cerrar.`);
  }
  // Modelo v0.6 §4: ningún documento de otro módulo pendiente o con error en el mes (C42).
  const sinContabilizar = integraciones.filter((i) => (i.estado === 'pendiente' || i.estado === 'error') && periodo.fecha_inicio <= i.fecha && i.fecha <= periodo.fecha_fin);
  if (sinContabilizar.length) {
    errores.push(`El mes tiene ${sinContabilizar.length} documento(s) de otros módulos sin contabilizar: se contabilizan (Integración → Por contabilizar) antes de cerrar.`);
  }
  return errores;
}

/** Lo que impide reabrir el mes. Vacío = se puede reabrir. */
export function erroresReaperturaMes(periodo: ContPeriodo, periodos: ContPeriodo[], ejercicio: ContEjercicio | undefined, motivo: string): string[] {
  const errores: string[] = [];
  if (periodo.estado !== 'cerrado') errores.push(`El mes ${nombreMes(periodo)} no está cerrado.`);
  if (ejercicio && ejercicio.estado !== 'abierto') {
    errores.push(ejercicio.estado === 'cerrado'
      ? `El ejercicio ${ejercicio.nombre} tiene cierre definitivo: sus meses no se reabren.`
      : `El ejercicio ${ejercicio.nombre} está en pre-cierre: primero se reabre el ejercicio.`);
  }
  const posterior = periodos
    .filter((p) => p.ejercicio_id === periodo.ejercicio_id && p.numero > periodo.numero && p.numero <= 12 && p.estado === 'cerrado')
    .sort((a, b) => b.numero - a.numero)[0];
  if (posterior) errores.push(`Los meses se reabren del último al primero: primero el ${nombreMes(posterior)}.`);
  if (!motivo.trim()) errores.push('Motivo de la reapertura requerido.');
  return errores;
}

/* ───────────── Saldos agrupados ───────────── */

export interface FuenteCierre {
  comprobantes: ContComprobante[];
  lineas: ContComprobanteLinea[];
  cuentas: ContCuenta[];
  centros: ContCentroCosto[];
  auxiliares: ContAuxiliar[];
}

interface Grupo { cuenta: ContCuenta; centro: string | null; auxiliar: string | null; ves: bigint; usd: bigint; moneda: bigint }

/** Saldos por cuenta × centro × auxiliar hasta una fecha, solo contabilizados (como cont_saldos_hasta de BD). */
export function saldosAgrupados(f: FuenteCierre, hasta: string, filtro?: (c: ContCuenta) => boolean): Grupo[] {
  const validos = new Set(f.comprobantes.filter((c) => c.estado === 'contabilizado' && c.fecha <= hasta).map((c) => c.id));
  const cuenta = new Map(f.cuentas.map((c) => [c.id, c]));
  const grupos = new Map<string, Grupo>();
  for (const l of f.lineas) {
    if (!validos.has(l.comprobante_id)) continue;
    const cu = cuenta.get(l.cuenta_id);
    if (!cu || (filtro && !filtro(cu))) continue;
    const k = `${l.cuenta_id}|${l.centro_costo_id ?? ''}|${l.auxiliar_id ?? ''}`;
    const g = grupos.get(k) ?? { cuenta: cu, centro: l.centro_costo_id, auxiliar: l.auxiliar_id, ves: 0n, usd: 0n, moneda: 0n };
    g.ves += aCentavos(l.debe_ves) - aCentavos(l.haber_ves);
    g.usd += aCentavos(l.debe_usd) - aCentavos(l.haber_usd);
    if (cu.moneda && cu.moneda === l.moneda) g.moneda += l.debe_ves > 0 ? aCentavos(l.monto_moneda) : -aCentavos(l.monto_moneda);
    grupos.set(k, g);
  }
  // Orden del generador: por código de cuenta, de centro y de auxiliar, como texto.
  const centro = new Map(f.centros.map((c) => [c.id, c.codigo]));
  const aux = new Map(f.auxiliares.map((a) => [a.id, a.codigo]));
  const clave = (g: Grupo) => [g.cuenta.codigo, g.centro ? centro.get(g.centro) ?? '' : '', g.auxiliar ? aux.get(g.auxiliar) ?? '' : ''];
  return [...grupos.values()].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
}

/* ───────────── Renglones de un cierre ───────────── */

export interface RenglonCierre {
  cuenta_id: string;
  centro_costo_id: string | null;
  auxiliar_id: string | null;
  descripcion: string;
  moneda: Moneda;
  monto_moneda: number;
  tasa: number;
  debe_ves: number;
  haber_ves: number;
  debe_usd: number;
  haber_usd: number;
}

/**
 * Los renglones que dejan una cuenta en (ves, usd) — en centavos, signo
 * debe − haber —. Si las dos monedas van del mismo lado, un renglón en Bs;
 * si una es cero o van en lados opuestos, un renglón por moneda (el v0.5
 * admite asientos solo en Bs o solo en USD).
 */
function renglonesPara(base: Omit<RenglonCierre, 'moneda' | 'monto_moneda' | 'tasa' | 'debe_ves' | 'haber_ves' | 'debe_usd' | 'haber_usd'>, ves: bigint, usd: bigint, tasaUsd: bigint): RenglonCierre[] {
  const abs = (x: bigint) => (x < 0n ? -x : x);
  const enBs = (v: bigint, u: bigint): RenglonCierre => ({
    ...base, moneda: 'VES', monto_moneda: deCentavos(abs(v)), tasa: 1,
    debe_ves: v > 0n ? deCentavos(v) : 0, haber_ves: v < 0n ? deCentavos(-v) : 0,
    debe_usd: v > 0n ? deCentavos(abs(u)) : 0, haber_usd: v < 0n ? deCentavos(abs(u)) : 0,
  });
  const soloUsd = (u: bigint): RenglonCierre => ({
    ...base, moneda: 'USD', monto_moneda: deCentavos(abs(u)), tasa: deMillonesimas(tasaUsd),
    debe_ves: 0, haber_ves: 0, debe_usd: u > 0n ? deCentavos(u) : 0, haber_usd: u < 0n ? deCentavos(-u) : 0,
  });
  if (ves === 0n && usd === 0n) return [];
  if (ves === 0n) return [soloUsd(usd)];
  if (usd === 0n || (ves > 0n) === (usd > 0n)) return [enBs(ves, usd)];
  return [enBs(ves, 0n), soloUsd(usd)];
}

/* ───────────── Diferencial cambiario del mes ───────────── */

/**
 * La tasa al cierre, con la MISMA regla de la base (02-reglas.sql): la del
 * día o la última de los 7 días previos (fin de semana o feriado). Más
 * atrás no se busca: si falta, es un hueco de datos y el cierre lo dice.
 * (Master, 20/10 13:41: no se aprueba quitar el tope.)
 */
export function tasaAlCierre(tasas: ContTasa[], moneda: Moneda, fecha: string, maxDias = 7): { tasa: bigint; fecha: string } | null {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (maxDias - 1));
  const desde = d.toISOString().slice(0, 10);
  let mejor: ContTasa | null = null;
  for (const t of tasas) if (t.moneda === moneda && t.fecha <= fecha && t.fecha >= desde && (!mejor || t.fecha > mejor.fecha)) mejor = t;
  return mejor ? { tasa: aMillonesimas(mejor.tasa_ves), fecha: mejor.fecha } : null;
}

export interface DetalleRevaluacion {
  cuenta_id: string;
  centro_costo_id: string | null;
  auxiliar_id: string | null;
  moneda: Moneda;
  saldo_moneda: number;
  tasa_cierre: number;
  /** La fecha de la tasa usada: si no hay tasa del día, la última cargada antes. */
  fecha_tasa: string;
  saldo_ves_antes: number;
  ajuste_ves: number;
}

export interface Revaluacion {
  fecha: string;
  detalle: DetalleRevaluacion[];
  renglones: RenglonCierre[];
}

/** El diferencial cambiario al último día del mes (§7.c del generador de BD). */
export function revaluacionDelMes(f: FuenteCierre, periodo: ContPeriodo, tasas: ContTasa[], p: ContParametros): Revaluacion {
  const fin = periodo.fecha_fin;
  const detalle: DetalleRevaluacion[] = [];
  const renglones: RenglonCierre[] = [];
  const ganancia = p.cuenta_dif_cambio_ganancia_id;
  const perdida = p.cuenta_dif_cambio_perdida_id;
  for (const g of saldosAgrupados(f, fin)) {
    const mon = g.cuenta.moneda;
    if (!mon || mon === 'VES') continue;
    const t = tasaAlCierre(tasas, mon, fin);
    if (!t) {
      const [y, m, dd] = fin.split('-');
      throw new Error(`No hay tasa de ${mon} del ${dd}/${m}/${y} ni de los 6 días anteriores: se carga en la tabla de tasas (Tesorería) antes de cerrar el mes.`);
    }
    const aj = multiplicarTasa(g.moneda, t.tasa) - g.ves;
    if (aj === 0n) continue;
    if (!ganancia || !perdida) throw new Error('Faltan en Parámetros las cuentas de ganancia y pérdida cambiaria.');
    const tasaTexto = (Number(t.tasa) / 1_000_000).toFixed(6);
    detalle.push({
      cuenta_id: g.cuenta.id, centro_costo_id: g.centro, auxiliar_id: g.auxiliar, moneda: mon,
      saldo_moneda: deCentavos(g.moneda), tasa_cierre: deMillonesimas(t.tasa), fecha_tasa: t.fecha,
      saldo_ves_antes: deCentavos(g.ves), ajuste_ves: deCentavos(aj),
    });
    const centro = g.centro ?? (g.cuenta.exige_centro_costo ? p.centro_costo_defecto_id : null);
    const abs = aj < 0n ? -aj : aj;
    const sube = aj > 0n;
    renglones.push({
      cuenta_id: g.cuenta.id, centro_costo_id: centro, auxiliar_id: g.cuenta.exige_auxiliar ? g.auxiliar : null,
      descripcion: `Revaluación a ${tasaTexto}`, moneda: 'VES', monto_moneda: deCentavos(abs), tasa: 1,
      debe_ves: sube ? deCentavos(abs) : 0, haber_ves: sube ? 0 : deCentavos(abs), debe_usd: 0, haber_usd: 0,
    });
    renglones.push({
      cuenta_id: sube ? ganancia : perdida, centro_costo_id: p.centro_costo_defecto_id, auxiliar_id: null,
      descripcion: `Diferencial cambiario ${g.cuenta.codigo}`, moneda: 'VES', monto_moneda: deCentavos(abs), tasa: 1,
      debe_ves: sube ? 0 : deCentavos(abs), haber_ves: sube ? deCentavos(abs) : 0, debe_usd: 0, haber_usd: 0,
    });
  }
  return { fecha: fin, detalle, renglones };
}

/* ───────────── Foto de saldos ───────────── */

/** Código de cuenta → saldo en Bs y en $ (solo cuentas con saldo), para cont_cierres.saldos. */
export function fotoSaldos(f: FuenteCierre, hasta: string): Record<string, { saldo_ves: number; saldo_usd: number }> {
  const acc = new Map<string, { ves: bigint; usd: bigint }>();
  for (const g of saldosAgrupados(f, hasta)) {
    const a = acc.get(g.cuenta.codigo) ?? { ves: 0n, usd: 0n };
    a.ves += g.ves; a.usd += g.usd;
    acc.set(g.cuenta.codigo, a);
  }
  const out: Record<string, { saldo_ves: number; saldo_usd: number }> = {};
  for (const [k, v] of acc) if (v.ves !== 0n || v.usd !== 0n) out[k] = { saldo_ves: deCentavos(v.ves), saldo_usd: deCentavos(v.usd) };
  return out;
}

/* ───────────── Cierre del ejercicio y apertura ───────────── */

const esResultado = (c: ContCuenta) => c.clase === 'ingreso' || c.clase === 'costo' || c.clase === 'gasto';
const esBalance = (c: ContCuenta) => c.clase === 'activo' || c.clase === 'pasivo' || c.clase === 'patrimonio';

/** Primer CI: cancela ingresos, costos y gastos contra Resultado del Ejercicio (cuenta × centro × auxiliar). */
export function cierreDeResultados(f: FuenteCierre, ejercicio: ContEjercicio, p: ContParametros, tasaUsd: bigint): RenglonCierre[] {
  if (!p.cuenta_resultado_ejercicio_id) throw new Error('Falta en Parámetros la cuenta de Resultado del Ejercicio.');
  const renglones: RenglonCierre[] = [];
  let totVes = 0n;
  let totUsd = 0n;
  for (const g of saldosAgrupados(f, ejercicio.fecha_fin, esResultado)) {
    renglones.push(...renglonesPara({ cuenta_id: g.cuenta.id, centro_costo_id: g.centro, auxiliar_id: g.auxiliar, descripcion: 'Cierre de cuentas de resultado' }, -g.ves, -g.usd, tasaUsd));
    totVes += g.ves; totUsd += g.usd;
  }
  renglones.push(...renglonesPara({ cuenta_id: p.cuenta_resultado_ejercicio_id, centro_costo_id: null, auxiliar_id: null, descripcion: 'Resultado del ejercicio' }, totVes, totUsd, tasaUsd));
  return renglones;
}

/** Segundo CI: el Resultado del Ejercicio pasa a Superávit / Pérdida Acumulada. */
export function trasladoAlSuperavit(f: FuenteCierre, ejercicio: ContEjercicio, p: ContParametros, tasaUsd: bigint): RenglonCierre[] {
  if (!p.cuenta_resultado_ejercicio_id || !p.cuenta_utilidades_retenidas_id) throw new Error('Faltan en Parámetros las cuentas de Resultado del Ejercicio y de Superávit.');
  const res = p.cuenta_resultado_ejercicio_id;
  let ves = 0n;
  let usd = 0n;
  for (const g of saldosAgrupados(f, ejercicio.fecha_fin, (c) => c.id === res)) { ves += g.ves; usd += g.usd; }
  return [
    ...renglonesPara({ cuenta_id: res, centro_costo_id: null, auxiliar_id: null, descripcion: 'Traslado del resultado del ejercicio' }, -ves, -usd, tasaUsd),
    ...renglonesPara({ cuenta_id: p.cuenta_utilidades_retenidas_id, centro_costo_id: null, auxiliar_id: null, descripcion: 'Superávit / Pérdida acumulada' }, ves, usd, tasaUsd),
  ];
}

/** Apertura del siguiente: los saldos de balance (cuenta × centro × auxiliar) al cierre del ejercicio. */
export function aperturaDesde(f: FuenteCierre, ejercicio: ContEjercicio, tasaUsd: bigint): RenglonCierre[] {
  const renglones: RenglonCierre[] = [];
  for (const g of saldosAgrupados(f, ejercicio.fecha_fin, esBalance)) {
    renglones.push(...renglonesPara({ cuenta_id: g.cuenta.id, centro_costo_id: g.centro, auxiliar_id: g.auxiliar, descripcion: `Saldo inicial del ejercicio ${Number(ejercicio.nombre) + 1}` }, g.ves, g.usd, tasaUsd));
  }
  return renglones;
}

/** Totales de los renglones de un cierre (para comprobar que cuadran). */
export function totalesCierre(r: RenglonCierre[]) {
  const s = (k: 'debe_ves' | 'haber_ves' | 'debe_usd' | 'haber_usd') => deCentavos(r.reduce((a, x) => a + aCentavos(x[k]), 0n));
  return { debe_ves: s('debe_ves'), haber_ves: s('haber_ves'), debe_usd: s('debe_usd'), haber_usd: s('haber_usd') };
}
