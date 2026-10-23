/* ============================================================
   Golden Touch · Retenciones · Motor de reglas: los 8 pasos (R7)

   Una regla dice CUÁNDO se retiene (condiciones con piezas de una lista
   cerrada) y CÓMO (hasta 8 pasos fijos, cada uno con una operación de una
   lista cerrada): 1 base · 2 conversión · 3 mínimo · 4 tasa · 5 sustraendo ·
   6 cuánto se retiene · 7 topes · 8 redondeo. La base de datos guarda y
   valida las reglas; NO calcula: el cálculo es este archivo, puro, y cada
   paso deja su foto (lo que entró, lo que salió y por qué), que la retención
   guarda tal cual.

   Mismas cuentas que retencionesCalculo.ts: el monto va en la moneda del
   documento; la base en Bs sirve para comparar mínimos; el sustraendo (en Bs)
   se lleva a la moneda del documento con la tasa; dos decimales en la base y
   en el impuesto bruto.
   ============================================================ */
import { fraseCondicion, NOMBRE_PIEZA, sinRotulo } from './rotulos';

export type Pieza = 'direccion' | 'tipo_documento' | 'tipo_operacion' | 'sujeto' | 'tipo_contribuyente'
  | 'condicion_agente' | 'clasificacion' | 'monto_minimo';
export type Operador = 'es' | 'no_es' | 'en' | 'no_en';
export type CampoMonto = 'base_imponible' | 'exento' | 'iva' | 'igtf' | 'subtotal' | 'total' | 'pago' | 'pago_divisas' | 'descuento' | 'flete' | 'otros';
export type SujetoGt = 'PJD' | 'PJND' | 'PNR' | 'PNNR';

export interface CondicionRegla { pieza: Pieza; operador: Operador; valor: unknown }
export interface PasoRegla { paso: number; operacion: string; valores: Record<string, unknown> }

export interface Regla {
  id?: string;
  impuestoClave: string;
  nombre: string;
  version: number;
  estado: 'en_prueba' | 'vigente' | 'retirada';
  desde: string;
  hasta: string | null;
  prioridad: number;
  condiciones: CondicionRegla[];
  pasos: PasoRegla[];
}

export interface Tramo { desdeMonto: number; hastaMonto: number | null; pct: number; sustraendo: number }

/** Lo que hace falta saber de la operación para aplicar una regla. */
export interface ContextoCalculo {
  direccion: 'practicada' | 'sufrida';
  tipoDocumento?: 'factura' | 'nota_debito' | 'nota_credito' | 'pago';
  tipoOperacion?: 'bienes' | 'servicios' | 'ambos';
  sujeto?: SujetoGt | null;
  tipoContribuyente?: string | null;
  /** Las condiciones vigentes de la empresa: agente_retencion, agente_percepcion, contribuyente_especial. */
  condicionesAgente: string[];
  /** La clasificación y el código elegidos (p. ej. islr_conceptos · 001). */
  clasificacion?: { clave: string; codigo: string } | null;
  montos: Partial<Record<CampoMonto, number>>;
  moneda: string;
  /** Bs por unidad de la moneda (BCV de la fecha de la factura). */
  tasa: number | null;
  /** UT vigente a la fecha, en Bs. */
  ut: number | null;
  /** Moneda de mayor valor, en Bs (para mínimos en MMV). */
  mmv?: number | null;
  /** Un parámetro del impuesto (R3) a la fecha: alicuota, pct_retencion… */
  parametro: (clave: string) => number | null;
  /** El valor del código de la clasificación para el sujeto, a la fecha (R4). */
  valorClasificacion?: {
    pct: number | null; basePct: number; minimo: number | null; minimoUnidad: 'UT' | 'Bs' | 'MMV' | null;
    sustraendoFactor: number | null; tarifa?: { tramos: Tramo[]; unidad: 'UT' | 'Bs' } | null;
  } | null;
  /** Se marcó un supuesto del % propio (art. 5 del IVA). */
  supuesto?: boolean;
  /** Una tarifa progresiva (R5) por su clave, con la versión publicada de la fecha. */
  tarifa?: (clave: string) => { tramos: Tramo[]; unidad: 'UT' | 'Bs' } | null;
}

export interface PasoFoto { paso: number; operacion: string; detalle: string; valores: Record<string, number | string | null> }

export interface ResultadoMotor {
  aplica: boolean;
  /** Por qué no se retiene (o null si se retiene). */
  motivo: string | null;
  /** Base en la moneda del documento. */
  base: number;
  baseBs: number;
  pct: number | null;
  /** Sustraendo en la moneda del documento. */
  sustraendo: number;
  impuesto: number;
  /** Lo retenido, en la moneda del documento. */
  monto: number;
  montoBs: number;
  foto: { regla: { id: string | null; impuesto: string; nombre: string; version: number }; pasos: PasoFoto[] };
}

const r = (v: number, d = 2) => { const f = 10 ** d; return Math.round((Number(v) || 0) * f) / f; };
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* ───────── Listas cerradas (las mismas que valida la base) ───────── */

export const VALORES_PIEZA: Partial<Record<Pieza, string[]>> = {
  direccion: ['practicada', 'sufrida'],
  tipo_documento: ['factura', 'nota_debito', 'nota_credito', 'pago'],
  tipo_operacion: ['bienes', 'servicios', 'ambos'],
  sujeto: ['PJD', 'PJND', 'PNR', 'PNNR'],
  tipo_contribuyente: ['ordinario', 'especial', 'formal', 'agente_percepcion'],
  condicion_agente: ['agente_retencion', 'agente_percepcion', 'contribuyente_especial'],
};
export const PIEZAS: Pieza[] = ['direccion', 'tipo_documento', 'tipo_operacion', 'sujeto', 'tipo_contribuyente', 'condicion_agente', 'clasificacion', 'monto_minimo'];
export const OPERACIONES_PASO: Record<number, string[]> = {
  1: ['componer_base'], 2: ['convertir_moneda'], 3: ['comparar_minimo'],
  4: ['pct_fijo', 'pct_parametro', 'pct_clasificacion', 'tramos', 'monto_fijo'],
  5: ['restar_sustraendo'], 6: ['retener_pct', 'retener_todo'], 7: ['topes'], 8: ['redondear'],
};
export const NOMBRE_PASO: Record<number, string> = {
  1: 'Base', 2: 'Conversión', 3: 'Mínimo', 4: 'Tasa', 5: 'Sustraendo', 6: 'Cuánto se retiene', 7: 'Topes', 8: 'Redondeo',
};
export const CAMPOS_MONTO: CampoMonto[] = ['base_imponible', 'exento', 'iva', 'igtf', 'subtotal', 'total', 'pago', 'pago_divisas', 'descuento', 'flete', 'otros'];

/** El mismo chequeo que retencion_regla_valida_condicion (para el editor, antes de guardar). null = bien. */
export function validarCondicion(c: CondicionRegla): string | null {
  const lista = VALORES_PIEZA[c.pieza];
  if (lista) {
    if (c.operador === 'es' || c.operador === 'no_es') {
      return typeof c.valor === 'string' && lista.includes(c.valor) ? null : `${c.pieza} admite: ${lista.join(', ')}`;
    }
    if (!Array.isArray(c.valor) || !c.valor.length) return `${c.pieza} con «${c.operador}» lleva una lista`;
    return c.valor.every((x) => typeof x === 'string' && lista.includes(x)) ? null : `${c.pieza} admite: ${lista.join(', ')}`;
  }
  if ((c.operador !== 'es' && c.operador !== 'no_es') || typeof c.valor !== 'object' || c.valor == null || Array.isArray(c.valor)) {
    return `${c.pieza} va con «es» o «no_es» y un objeto`;
  }
  const v = c.valor as Record<string, unknown>;
  if (c.pieza === 'clasificacion') {
    if (typeof v.clasificacion !== 'string' || !v.clasificacion) return 'clasificacion: indica la clasificación';
    if ('codigos' in v && !Array.isArray(v.codigos)) return 'clasificacion: «codigos» es una lista';
  }
  if (c.pieza === 'monto_minimo') {
    if (n(v.monto) == null || (v.monto as number) < 0 || !['UT', 'Bs'].includes(String(v.unidad)) || !['base', 'pago'].includes(String(v.sobre))) {
      return 'monto_minimo: {"monto": n ≥ 0, "unidad": "UT" | "Bs", "sobre": "base" | "pago"}';
    }
  }
  return null;
}

/** El mismo chequeo que retencion_regla_valida_paso (sin mirar si existen el parámetro, la clasificación o la tarifa). null = bien. */
export function validarPaso(p: PasoRegla): string | null {
  const permitidas = OPERACIONES_PASO[p.paso];
  if (!permitidas || !permitidas.includes(p.operacion)) return `el paso ${p.paso} admite: ${permitidas?.join(', ') ?? 'nada (pasos 1 a 8)'}`;
  const v = p.valores ?? {};
  switch (p.operacion) {
    case 'componer_base': {
      const cs = v.componentes;
      if (!Array.isArray(cs) || !cs.length) return 'componer_base lleva «componentes»: [{"campo", "signo"}]';
      if (cs.some((c) => !CAMPOS_MONTO.includes((c as { campo?: string })?.campo as CampoMonto) || !['+', '-'].includes((c as { signo?: string })?.signo ?? ''))) {
        return `componer_base: campo de ${CAMPOS_MONTO.join(', ')}; signo + o -`;
      }
      if ('porcion' in v && !(v.porcion === 'clasificacion' || (n(v.porcion) != null && (v.porcion as number) > 0 && (v.porcion as number) <= 100))) {
        return 'componer_base: «porcion» es un % (0-100] o "clasificacion"';
      }
      return null;
    }
    case 'convertir_moneda': return v.tasa === 'bcv_fecha_factura' ? null : 'convertir_moneda: {"tasa": "bcv_fecha_factura"}';
    case 'comparar_minimo':
      return v.desde === 'clasificacion' || (n(v.monto) != null && (v.monto as number) >= 0 && ['UT', 'Bs', 'MMV'].includes(String(v.unidad)))
        ? null : 'comparar_minimo: {"desde": "clasificacion"} o {"monto": n, "unidad": "UT" | "Bs" | "MMV"}';
    case 'pct_fijo':
      return n(v.pct) != null && (v.pct as number) >= 0 && (v.pct as number) <= 100 ? null : 'pct_fijo lleva {"pct": n} de 0 a 100';
    case 'retener_pct':
      if (n(v.pct) != null) return (v.pct as number) >= 0 && (v.pct as number) <= 100 ? null : 'retener_pct: el % va de 0 a 100';
      return typeof v.parametro === 'string' && v.parametro ? null : 'retener_pct lleva {"pct": n} o {"parametro", "supuestos"}';
    case 'pct_parametro': return typeof v.parametro === 'string' && v.parametro ? null : 'pct_parametro: indica el parámetro';
    case 'pct_clasificacion': return typeof v.clasificacion === 'string' && v.clasificacion ? null : 'pct_clasificacion: indica la clasificación';
    case 'tramos': return typeof v.tarifa === 'string' && v.tarifa ? null : 'tramos: indica la tarifa';
    case 'monto_fijo':
      return n(v.monto) != null && (v.monto as number) >= 0 && ['UT', 'Bs'].includes(String(v.unidad)) ? null : 'monto_fijo: {"monto": n ≥ 0, "unidad": "UT" | "Bs"}';
    case 'restar_sustraendo':
      return v.desde === 'clasificacion' || (n(v.factor) != null && (v.factor as number) >= 0) || (n(v.monto) != null && (v.monto as number) >= 0)
        ? null : 'restar_sustraendo: {"desde": "clasificacion"}, {"factor": n} o {"monto": n}';
    case 'retener_todo': return null;
    case 'topes':
      if ('minimo' in v && n(v.minimo) == null) return 'topes: «minimo» es un número';
      if ('maximo' in v && v.maximo != null && !['impuesto_causado', 'base'].includes(String(v.maximo))) return 'topes: «maximo» es "impuesto_causado", "base" o null';
      return null;
    case 'redondear': return [0, 1, 2, 3, 4].includes(v.decimales as number) ? null : 'redondear: {"decimales": 0 a 4}';
    default: return 'operación desconocida';
  }
}

/* ───────── Condiciones ───────── */

function datoDePieza(p: Pieza, ctx: ContextoCalculo): string | string[] | null | undefined {
  switch (p) {
    case 'direccion': return ctx.direccion;
    case 'tipo_documento': return ctx.tipoDocumento ?? undefined;
    case 'tipo_operacion': return ctx.tipoOperacion ?? undefined;
    case 'sujeto': return ctx.sujeto ?? undefined;
    case 'tipo_contribuyente': return ctx.tipoContribuyente ?? undefined;
    case 'condicion_agente': return ctx.condicionesAgente;
    default: return undefined;
  }
}

const enBs = (monto: number, ctx: ContextoCalculo) => (String(ctx.moneda).toUpperCase() === 'BS' || !(ctx.tasa && ctx.tasa > 0) ? monto : monto * ctx.tasa);

/** Lo que no se cumple de las condiciones (lista vacía = la regla aplica). */
export function condicionesQueFallan(regla: Pick<Regla, 'condiciones'>, ctx: ContextoCalculo): string[] {
  const fallas: string[] = [];
  for (const c of regla.condiciones) {
    if (c.pieza === 'clasificacion') {
      const v = c.valor as { clasificacion?: string; codigos?: string[] };
      const coincide = !!ctx.clasificacion && ctx.clasificacion.clave === v.clasificacion
        && (!Array.isArray(v.codigos) || v.codigos.includes(ctx.clasificacion.codigo));
      if (coincide !== (c.operador === 'es')) fallas.push(`No se cumple: ${fraseCondicion(c)}`);
      continue;
    }
    if (c.pieza === 'monto_minimo') {
      const v = c.valor as { monto: number; unidad: 'UT' | 'Bs'; sobre: 'base' | 'pago' };
      const monto = enBs(Number(ctx.montos[v.sobre === 'base' ? 'base_imponible' : 'pago'] ?? 0), ctx);
      const umbral = v.unidad === 'UT' ? (ctx.ut && ctx.ut > 0 ? v.monto * ctx.ut : null) : v.monto;
      if (umbral == null) { fallas.push('El mínimo va en UT y no hay UT cargada para esa fecha.'); continue; }
      const supera = monto >= umbral;
      if (supera !== (c.operador === 'es')) fallas.push(`No se cumple: ${fraseCondicion(c)}`);
      continue;
    }
    const dato = datoDePieza(c.pieza, ctx);
    if (dato === undefined || dato === null) { fallas.push(`Falta el dato: ${NOMBRE_PIEZA[c.pieza]}.`); continue; }
    const tiene = (x: string) => (Array.isArray(dato) ? dato.includes(x) : dato === x);
    const esta = c.operador === 'es' || c.operador === 'no_es'
      ? tiene(String(c.valor))
      : (Array.isArray(c.valor) ? c.valor : []).some((x) => tiene(String(x)));
    const cumple = c.operador === 'es' || c.operador === 'en' ? esta : !esta;
    if (!cumple) fallas.push(`No se cumple: ${fraseCondicion(c)}`);
  }
  return fallas;
}

/** La primera regla (por prioridad, luego nombre y versión) cuyas condiciones se cumplen. */
export function elegirRegla<T extends Regla>(reglas: T[], ctx: ContextoCalculo): T | null {
  return [...reglas].sort((a, b) => a.prioridad - b.prioridad || a.nombre.localeCompare(b.nombre) || b.version - a.version)
    .find((x) => condicionesQueFallan(x, ctx).length === 0) ?? null;
}

/* ───────── Los 8 pasos ───────── */

/** Aplica la regla al contexto. No mira las condiciones (para eso, elegirRegla o condicionesQueFallan). */
export function calcularConRegla(regla: Regla, ctx: ContextoCalculo): ResultadoMotor {
  const pasos: PasoFoto[] = [];
  const foto = () => ({ regla: { id: regla.id ?? null, impuesto: regla.impuestoClave, nombre: regla.nombre, version: regla.version }, pasos });
  const de = (k: number) => regla.pasos.find((p) => p.paso === k) ?? null;
  const tasaDoc = String(ctx.moneda).toUpperCase() === 'BS' ? 1 : (ctx.tasa && ctx.tasa > 0 ? ctx.tasa : 0);
  const vc = ctx.valorClasificacion ?? null;
  const resultado = (aplica: boolean, motivo: string | null, base: number, baseBs: number, pct: number | null, sustraendo: number, impuesto: number, monto: number): ResultadoMotor => ({
    aplica, motivo, base, baseBs, pct, sustraendo, impuesto, monto, montoBs: tasaDoc > 0 ? r(monto * tasaDoc) : monto, foto: foto(),
  });

  // 1 · Base
  const p1 = de(1);
  if (!p1) return resultado(false, 'La regla no tiene el paso 1 (base).', 0, 0, null, 0, 0, 0);
  const comps = (p1.valores.componentes as { campo: CampoMonto; signo: '+' | '-' }[]) ?? [];
  const suma = comps.reduce((a, c) => a + (c.signo === '-' ? -1 : 1) * Number(ctx.montos[c.campo] ?? 0), 0);
  let porcion = 100;
  if (p1.valores.porcion === 'clasificacion') porcion = vc?.basePct ?? 100;
  else if (n(p1.valores.porcion) != null) porcion = p1.valores.porcion as number;
  const base = r((suma * porcion) / 100);
  pasos.push({ paso: 1, operacion: 'componer_base', detalle: `${comps.map((c) => `${c.signo}${c.campo}`).join(' ')}${porcion !== 100 ? ` × ${porcion} %` : ''}`, valores: { suma: r(suma), porcion, base } });
  if (base <= 0) return resultado(false, 'La base no tiene monto.', base, 0, null, 0, 0, 0);

  // 2 · Conversión (la base en Bs, para comparar; el monto sigue en la moneda del documento)
  const p2 = de(2);
  const baseBs = tasaDoc > 0 ? r(base * tasaDoc) : base;
  if (p2) pasos.push({ paso: 2, operacion: 'convertir_moneda', detalle: tasaDoc > 0 && tasaDoc !== 1 ? `× tasa ${tasaDoc}` : 'ya en Bs', valores: { tasa: tasaDoc || null, baseBs } });

  // 3 · Mínimo
  const p3 = de(3);
  if (p3) {
    let minimo: number | null = null; let unidad: string | null = null; let cant: number | null = null;
    if (p3.valores.desde === 'clasificacion') { cant = vc?.minimo ?? null; unidad = vc?.minimoUnidad ?? null; } else { cant = n(p3.valores.monto); unidad = String(p3.valores.unidad ?? ''); }
    if (cant != null && cant > 0) {
      minimo = unidad === 'UT' ? (ctx.ut && ctx.ut > 0 ? r(cant * ctx.ut) : null) : unidad === 'MMV' ? (ctx.mmv && ctx.mmv > 0 ? r(cant * ctx.mmv) : null) : cant;
      if (minimo == null) return resultado(false, `Falta el valor de la ${unidad} para comparar el mínimo.`, base, baseBs, null, 0, 0, 0);
    }
    pasos.push({ paso: 3, operacion: 'comparar_minimo', detalle: minimo ? `mínimo ${cant} ${unidad} = ${minimo} Bs` : 'sin mínimo', valores: { minimo, baseBs } });
    if (minimo && baseBs < minimo) return resultado(false, `No se retiene: la base (${baseBs} Bs) no llega al mínimo de ${minimo} Bs.`, base, baseBs, null, 0, 0, 0);
  }

  // 4 · Tasa
  const p4 = de(4);
  let pct: number | null = null; let impuesto = base; let sustraendoTramoBs = 0;
  if (p4) {
    const v = p4.valores;
    if (p4.operacion === 'pct_fijo') pct = n(v.pct);
    else if (p4.operacion === 'pct_parametro') pct = ctx.parametro(String(v.parametro));
    else if (p4.operacion === 'pct_clasificacion') {
      if (vc?.tarifa) {
        const ap = aplicarTramos(vc.tarifa.tramos, vc.tarifa.unidad, baseBs, ctx.ut);
        if (!ap) return resultado(false, 'La tarifa de la clasificación no da tramo para esa base.', base, baseBs, null, 0, 0, 0);
        pct = ap.pct; sustraendoTramoBs = ap.sustraendoBs;
      } else pct = vc?.pct ?? null;
    } else if (p4.operacion === 'tramos') {
      const t = ctx.tarifa?.(String(v.tarifa)) ?? null;
      const ap = t ? aplicarTramos(t.tramos, t.unidad, baseBs, ctx.ut) : null;
      if (!ap) return resultado(false, `La tarifa por tramos «${sinRotulo(v.tarifa)}» no da tramo para esa base (o falta publicarla).`, base, baseBs, null, 0, 0, 0);
      pct = ap.pct; sustraendoTramoBs = ap.sustraendoBs;
    } else if (p4.operacion === 'monto_fijo') {
      const montoBs = String(v.unidad) === 'UT' ? (ctx.ut && ctx.ut > 0 ? Number(v.monto) * ctx.ut : null) : Number(v.monto);
      if (montoBs == null) return resultado(false, 'Falta la UT para el monto fijo.', base, baseBs, null, 0, 0, 0);
      impuesto = tasaDoc > 0 ? r(montoBs / tasaDoc) : montoBs;
    }
    if (p4.operacion !== 'monto_fijo') {
      if (pct == null || pct <= 0) return resultado(false, 'La tasa está en 0 o no está cargada para esa fecha.', base, baseBs, pct, 0, 0, 0);
      impuesto = r((base * pct) / 100);
    }
    pasos.push({ paso: 4, operacion: p4.operacion, detalle: pct != null ? `${pct} % de ${base}` : `monto fijo ${impuesto}`, valores: { pct, impuesto } });
  }

  // 5 · Sustraendo (en Bs; se lleva a la moneda del documento)
  const p5 = de(5);
  let sustraendo = 0;
  if (p5 || sustraendoTramoBs) {
    let sBs = sustraendoTramoBs;
    if (p5) {
      const v = p5.valores;
      const ut = ctx.ut && ctx.ut > 0 ? ctx.ut : 0;
      if (v.desde === 'clasificacion') sBs += vc?.sustraendoFactor && pct ? r((pct / 100) * ut * vc.sustraendoFactor) : 0;
      else if (n(v.factor) != null && pct) sBs += r((pct / 100) * ut * (v.factor as number));
      else if (n(v.monto) != null) sBs += v.monto as number;
    }
    sustraendo = tasaDoc > 0 && tasaDoc !== 1 ? r(sBs / tasaDoc) : sBs;
    impuesto = r(impuesto - sustraendo);
    pasos.push({ paso: 5, operacion: 'restar_sustraendo', detalle: `− ${sustraendo}`, valores: { sustraendoBs: sBs, sustraendo, impuesto } });
  }

  // 6 · Cuánto se retiene
  const p6 = de(6);
  let monto = impuesto;
  if (p6?.operacion === 'retener_pct') {
    const v = p6.valores;
    let pct6 = n(v.pct);
    if (pct6 == null) pct6 = ctx.supuesto && v.supuestos ? ctx.parametro(String(v.supuestos)) : ctx.parametro(String(v.parametro));
    if (pct6 == null) return resultado(false, 'El % de retención no está cargado para esa fecha.', base, baseBs, pct, sustraendo, impuesto, 0);
    monto = r((impuesto * pct6) / 100);
    if (pct == null) pct = pct6;
    pasos.push({ paso: 6, operacion: 'retener_pct', detalle: `${pct6} %${ctx.supuesto && v.supuestos ? ' (supuesto)' : ''} de ${impuesto}`, valores: { pct: pct6, monto } });
  } else if (p6) {
    pasos.push({ paso: 6, operacion: 'retener_todo', detalle: 'todo el impuesto', valores: { monto } });
  }

  // 7 · Topes
  const p7 = de(7);
  if (p7) {
    const v = p7.valores;
    const antes = monto;
    if (n(v.minimo) != null) monto = Math.max(monto, v.minimo as number);
    if (v.maximo === 'impuesto_causado') monto = Math.min(monto, impuesto);
    if (v.maximo === 'base') monto = Math.min(monto, base);
    pasos.push({ paso: 7, operacion: 'topes', detalle: antes !== monto ? `${antes} → ${monto}` : 'sin cambio', valores: { minimo: n(v.minimo), maximo: (v.maximo as string) ?? null, monto } });
  }

  // 8 · Redondeo
  const p8 = de(8);
  if (p8) {
    const d = Number(p8.valores.decimales ?? 2);
    monto = r(monto, d);
    pasos.push({ paso: 8, operacion: 'redondear', detalle: `${d} decimales`, valores: { monto } });
  }
  return resultado(monto > 0, monto > 0 ? null : 'El cálculo da 0.', base, baseBs, pct, sustraendo, impuesto, monto);
}

/** Los tramos aplicados a una base en Bs (como retencion_tarifa_aplicar): % y sustraendo del tramo, el sustraendo en Bs. */
export function aplicarTramos(tramos: Tramo[], unidad: 'UT' | 'Bs', baseBs: number, ut: number | null): { pct: number; sustraendoBs: number } | null {
  const factor = unidad === 'UT' ? (ut && ut > 0 ? ut : null) : 1;
  if (factor == null) return null;
  const b = baseBs / factor;
  const t = [...tramos].sort((x, y) => y.desdeMonto - x.desdeMonto).find((x) => x.desdeMonto < b || x.desdeMonto === 0);
  return t ? { pct: t.pct, sustraendoBs: r(t.sustraendo * factor) } : null;
}

/** El texto de una condición para la pantalla: «dirección es practicada». */
export function textoCondicion(c: CondicionRegla): string {
  if (c.pieza === 'clasificacion') {
    const v = c.valor as { clasificacion?: string; codigos?: string[] };
    return `clasificación ${c.operador === 'es' ? 'es' : 'no es'} ${v.clasificacion}${v.codigos?.length ? ` (${v.codigos.join(', ')})` : ''}`;
  }
  if (c.pieza === 'monto_minimo') {
    const v = c.valor as { monto: number; unidad: string; sobre: string };
    return `el ${v.sobre} ${c.operador === 'es' ? 'llega a' : 'no llega a'} ${v.monto} ${v.unidad}`;
  }
  const op = { es: 'es', no_es: 'no es', en: 'es uno de', no_en: 'no es ninguno de' }[c.operador];
  return `${c.pieza.replace(/_/g, ' ')} ${op} ${Array.isArray(c.valor) ? c.valor.join(', ') : String(c.valor)}`;
}

/** El texto de un paso: «Tasa · % de la clasificación islr_conceptos». */
export function textoPaso(p: PasoRegla): string {
  const v = p.valores ?? {};
  const det: Record<string, string> = {
    componer_base: `${((v.componentes as { campo: string; signo: string }[]) ?? []).map((c) => `${c.signo}${c.campo}`).join(' ')}${v.porcion ? ` × ${v.porcion === 'clasificacion' ? 'porción de la clasificación' : `${String(v.porcion)} %`}` : ''}`,
    convertir_moneda: 'a Bs con la tasa BCV de la fecha de la factura',
    comparar_minimo: v.desde === 'clasificacion' ? 'el de la clasificación' : `${String(v.monto)} ${String(v.unidad)}`,
    pct_fijo: `${String(v.pct)} %`, pct_parametro: `el parámetro «${String(v.parametro)}»`,
    pct_clasificacion: `el % de la clasificación ${String(v.clasificacion)}`, tramos: `la tarifa ${String(v.tarifa)}`,
    monto_fijo: `${String(v.monto)} ${String(v.unidad)}`,
    restar_sustraendo: v.desde === 'clasificacion' ? 'el de la clasificación' : v.factor != null ? `factor ${String(v.factor)}` : `${String(v.monto)} Bs`,
    retener_pct: v.pct != null ? `${String(v.pct)} %` : `el parámetro «${String(v.parametro)}»${v.supuestos ? ` (con supuesto: «${String(v.supuestos)}»)` : ''}`,
    retener_todo: 'todo el impuesto',
    topes: [v.minimo != null ? `mínimo ${String(v.minimo)}` : '', v.maximo ? `máximo ${String(v.maximo)}` : ''].filter(Boolean).join(' · ') || 'sin topes',
    redondear: `${String(v.decimales)} decimales`,
  };
  return `${NOMBRE_PASO[p.paso] ?? `Paso ${p.paso}`} · ${det[p.operacion] ?? p.operacion}`;
}
