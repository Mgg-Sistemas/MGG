/* ============================================================
   MGG · Retenciones · El cálculo (Venezuela)

   Acá vive la cuenta de cada impuesto, sin base de datos y sin pantalla, para
   poder probarla renglón por renglón contra el reglamento.

   LO QUE MANDA EN CADA UNO
   · IVA       — Providencia SNAT/2015/0049. Solo retiene el contribuyente
                 ESPECIAL designado. Retiene el 75% del IVA de la factura, y el
                 100% en los supuestos del art. 5 (factura que no cumple los
                 requisitos, IVA no discriminado, proveedor no inscrito o no
                 ubicable en el RIF, proveedor no domiciliado, y la compra de
                 metales o piedras preciosas). El comprobante lleva correlativo
                 AAAAMM + 8 dígitos y se entera por quincenas.
   · ISLR      — Decreto 1.808. El porcentaje sale del CONCEPTO y del SUJETO.
                 A la persona natural residente se le resta el SUSTRAENDO y no
                 se le retiene por debajo del mínimo; a la persona jurídica
                 domiciliada se le aplica el porcentaje directo.
   · Municipal — Impuesto sobre Actividades Económicas. La alícuota la fija la
                 ORDENANZA de cada municipio: acá no hay número por defecto.
   · Regional  — Timbre fiscal estadal. Igual: lo fija la ley de cada estado.
   · IGTF      — Ley de IGTF: 3% sobre los pagos en divisas o cripto. Es un
                 impuesto que paga quien paga, no una retención al proveedor;
                 se calcula acá para que aparezca en el mismo resumen fiscal.

   NADA SE CABLEA SALVO LAS FÓRMULAS. Los porcentajes vienen del catálogo y de
   la configuración, porque cambian por ley, por ordenanza y por año.
   ============================================================ */

export type TipoImpuesto = 'iva' | 'islr' | 'municipal' | 'regional' | 'igtf';

/** A quién se le retiene. El ISLR cambia el porcentaje según esto. */
export type SujetoRetenido = 'pn_residente' | 'pj_domiciliada' | 'pn_no_residente' | 'pj_no_domiciliada' | 'todos';

export const SUJETOS: { key: SujetoRetenido; label: string }[] = [
  { key: 'pn_residente', label: 'Persona natural residente' },
  { key: 'pj_domiciliada', label: 'Persona jurídica domiciliada' },
  { key: 'pn_no_residente', label: 'Persona natural no residente' },
  { key: 'pj_no_domiciliada', label: 'Persona jurídica no domiciliada' },
  { key: 'todos', label: 'Cualquier sujeto' },
];

export function labelSujeto(s: SujetoRetenido | string | null | undefined): string {
  return SUJETOS.find((x) => x.key === s)?.label ?? '—';
}

export const TIPOS_IMPUESTO: { key: TipoImpuesto; label: string; corto: string }[] = [
  { key: 'iva', label: 'Retención de IVA', corto: 'IVA' },
  { key: 'islr', label: 'Retención de ISLR', corto: 'ISLR' },
  { key: 'municipal', label: 'Retención municipal (ISAE)', corto: 'Municipal' },
  { key: 'regional', label: 'Timbre fiscal estadal', corto: 'Regional' },
  { key: 'igtf', label: 'IGTF', corto: 'IGTF' },
];

export function labelImpuesto(t: TipoImpuesto | string | null | undefined): string {
  return TIPOS_IMPUESTO.find((x) => x.key === t)?.label ?? String(t ?? '—');
}

/** Parámetros de la empresa como agente de retención. */
export interface ConfigRetencion {
  rif: string | null;
  razonSocial: string | null;
  direccionFiscal: string | null;
  municipio: string | null;
  estado: string | null;
  esContribuyenteEspecial: boolean;
  pctIvaGeneral: number;    // 75
  pctIvaEspecial: number;   // 100
  valorUt: number;          // define el sustraendo del ISLR
  pctIgtf: number;          // 3
}

export const CONFIG_RETENCION_DEFECTO: ConfigRetencion = {
  rif: null, razonSocial: null, direccionFiscal: null, municipio: null, estado: null,
  esContribuyenteEspecial: false,
  pctIvaGeneral: 75, pctIvaEspecial: 100,
  valorUt: 0, pctIgtf: 3,
};

/** Un renglón del catálogo. */
export interface ConceptoRetencion {
  id: string;
  tipo: 'islr' | 'municipal' | 'regional';
  codigo: string | null;
  nombre: string;
  sujeto: SujetoRetenido;
  porcentaje: number;
  basePct: number;
  aplicaSustraendo: boolean;
  baseMinimaUt: number;
  fundamento: string | null;
  activo: boolean;
  orden: number;
}

/** El resultado de una cuenta, con todo lo que hizo falta para llegar a ella. */
export interface CalculoRetencion {
  tipo: TipoImpuesto;
  baseImponible: number;
  /** Alícuota del impuesto de origen (16% del IVA, p. ej.). 0 cuando no aplica. */
  alicuota: number;
  /** El impuesto sobre el que se retiene (el IVA de la factura). */
  impuesto: number;
  /** Porcentaje de retención aplicado. */
  porcentaje: number;
  sustraendo: number;
  montoRetenido: number;
  /** Por qué dio lo que dio, en una línea, para mostrarlo en pantalla. */
  explicacion: string;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const n0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const CERO = (tipo: TipoImpuesto, explicacion: string): CalculoRetencion => ({
  tipo, baseImponible: 0, alicuota: 0, impuesto: 0, porcentaje: 0, sustraendo: 0, montoRetenido: 0, explicacion,
});

/* ───────────────────────── IVA ───────────────────────── */

/** Los supuestos del art. 5 de la Providencia que llevan la retención al 100%. */
export interface MotivosIvaCien {
  /** El monto del IVA no está discriminado en la factura. */
  ivaNoDiscriminado?: boolean;
  /** La factura no cumple los requisitos de la normativa de facturación. */
  facturaNoCumple?: boolean;
  /** El proveedor no está inscrito en el RIF, o sus datos no coinciden. */
  proveedorNoInscrito?: boolean;
  /** El proveedor no está domiciliado en el país. */
  proveedorNoDomiciliado?: boolean;
  /** Compra de metales o piedras preciosas. */
  metalesPreciosos?: boolean;
}

export function retieneCienPorCiento(m: MotivosIvaCien | null | undefined): boolean {
  if (!m) return false;
  return !!(m.ivaNoDiscriminado || m.facturaNoCumple || m.proveedorNoInscrito
    || m.proveedorNoDomiciliado || m.metalesPreciosos);
}

/** El texto del motivo, para que el comprobante diga por qué se retuvo el 100%. */
export function motivoCienTexto(m: MotivosIvaCien | null | undefined): string | null {
  if (!m) return null;
  if (m.ivaNoDiscriminado) return 'El IVA no está discriminado en la factura';
  if (m.facturaNoCumple) return 'La factura no cumple los requisitos de la normativa de facturación';
  if (m.proveedorNoInscrito) return 'El proveedor no está inscrito en el RIF o sus datos no coinciden';
  if (m.proveedorNoDomiciliado) return 'El proveedor no está domiciliado en el país';
  if (m.metalesPreciosos) return 'Compra de metales o piedras preciosas';
  return null;
}

/**
 * Retención de IVA. Se retiene sobre el IVA de la factura, no sobre el total.
 * Si la empresa no es contribuyente especial designado, no retiene: da cero.
 */
export function calcularRetencionIva(
  input: { baseImponible: number; ivaFactura: number; motivos?: MotivosIvaCien | null },
  config: ConfigRetencion,
): CalculoRetencion {
  if (!config.esContribuyenteEspecial) {
    return CERO('iva', 'La empresa no está marcada como contribuyente especial: no practica retención de IVA.');
  }
  const base = r2(n0(input.baseImponible));
  const iva = r2(n0(input.ivaFactura));
  if (iva <= 0) return CERO('iva', 'La factura no tiene IVA sobre el cual retener.');
  const cien = retieneCienPorCiento(input.motivos);
  const pct = cien ? n0(config.pctIvaEspecial) : n0(config.pctIvaGeneral);
  const monto = r2((iva * pct) / 100);
  const alicuota = base > 0 ? r2((iva / base) * 100) : 0;
  const porQue = cien ? ` (100% porque: ${motivoCienTexto(input.motivos)?.toLowerCase()})` : '';
  return {
    tipo: 'iva', baseImponible: base, alicuota, impuesto: iva,
    porcentaje: pct, sustraendo: 0, montoRetenido: monto,
    explicacion: `${pct}% del IVA de la factura (${iva.toLocaleString('es-VE')})${porQue}.`,
  };
}

/* ───────────────────────── ISLR ───────────────────────── */

/**
 * Sustraendo del Decreto 1.808 para personas naturales residentes:
 * sustraendo = % de retención × valor de la UT × 83,3334.
 * Sin UT cargada no se puede calcular, y se devuelve 0.
 */
export function sustraendoIslr(porcentaje: number, valorUt: number): number {
  const p = n0(porcentaje), ut = n0(valorUt);
  if (p <= 0 || ut <= 0) return 0;
  return r2((p / 100) * ut * 83.3334);
}

/** El mínimo por debajo del cual no se retiene, en dinero. */
export function minimoIslr(concepto: Pick<ConceptoRetencion, 'baseMinimaUt'>, valorUt: number): number {
  return r2(n0(concepto.baseMinimaUt) * n0(valorUt));
}

/**
 * Retención de ISLR sobre un pago, según el concepto y el sujeto.
 * Persona natural residente: (pago × %) − sustraendo, y solo si supera el mínimo.
 * Persona jurídica domiciliada: pago × %, sin sustraendo ni mínimo.
 */
export function calcularRetencionIslr(
  input: { montoPago: number; concepto: ConceptoRetencion | null },
  config: ConfigRetencion,
): CalculoRetencion {
  const c = input.concepto;
  if (!c) return CERO('islr', 'Elegí el concepto del Decreto 1.808 que corresponde al pago.');
  if (!c.activo) return CERO('islr', `El concepto «${c.nombre}» está desactivado en el catálogo.`);
  const pago = r2(n0(input.montoPago));
  if (pago <= 0) return CERO('islr', 'El pago no tiene monto.');

  // La base puede ser una porción del pago (transporte internacional, p. ej.).
  const base = r2((pago * n0(c.basePct)) / 100);
  const pct = n0(c.porcentaje);
  if (pct <= 0) return CERO('islr', `El concepto «${c.nombre}» está en 0%: cargá su porcentaje en el catálogo.`);

  const minimo = minimoIslr(c, config.valorUt);
  if (minimo > 0 && base < minimo) {
    return {
      tipo: 'islr', baseImponible: base, alicuota: 0, impuesto: 0, porcentaje: pct, sustraendo: 0, montoRetenido: 0,
      explicacion: `No se retiene: la base (${base.toLocaleString('es-VE')}) no llega al mínimo de ${minimo.toLocaleString('es-VE')} (${c.baseMinimaUt} UT).`,
    };
  }

  const sustraendo = c.aplicaSustraendo ? sustraendoIslr(pct, config.valorUt) : 0;
  const bruto = r2((base * pct) / 100);
  const monto = Math.max(0, r2(bruto - sustraendo));
  const detalleBase = c.basePct !== 100 ? ` sobre el ${c.basePct}% del pago` : '';
  const detalleSus = sustraendo > 0 ? ` − sustraendo ${sustraendo.toLocaleString('es-VE')}` : '';
  const avisoUt = c.aplicaSustraendo && n0(config.valorUt) <= 0
    ? ' · falta cargar el valor de la UT para el sustraendo'
    : '';
  return {
    tipo: 'islr', baseImponible: base, alicuota: 0, impuesto: 0,
    porcentaje: pct, sustraendo, montoRetenido: monto,
    explicacion: `${pct}%${detalleBase}${detalleSus} · ${c.nombre}${avisoUt}.`,
  };
}

/* ─────────────── Municipal (ISAE) y estadal (timbre) ─────────────── */

/**
 * Retención municipal o estadal: porcentaje del catálogo sobre el pago.
 * El número lo pone la ordenanza / la ley del estado, nunca el sistema.
 */
export function calcularRetencionLocal(
  input: { montoPago: number; concepto: ConceptoRetencion | null },
  tipo: 'municipal' | 'regional',
): CalculoRetencion {
  const c = input.concepto;
  const queEs = tipo === 'municipal' ? 'la ordenanza del municipio' : 'la ley de timbre fiscal del estado';
  if (!c) return CERO(tipo, `Elegí el concepto. La alícuota sale de ${queEs}.`);
  const pago = r2(n0(input.montoPago));
  if (pago <= 0) return CERO(tipo, 'El pago no tiene monto.');
  const pct = n0(c.porcentaje);
  if (pct <= 0) {
    return CERO(tipo, `«${c.nombre}» está en 0%: cargá la alícuota de ${queEs} en ⚙ Configuración fiscal.`);
  }
  const base = r2((pago * n0(c.basePct)) / 100);
  return {
    tipo, baseImponible: base, alicuota: 0, impuesto: 0,
    porcentaje: pct, sustraendo: 0, montoRetenido: r2((base * pct) / 100),
    explicacion: `${pct}% sobre ${base.toLocaleString('es-VE')} · ${c.nombre}.`,
  };
}

/* ───────────────────────── IGTF ───────────────────────── */

/**
 * IGTF: porcentaje sobre el monto pagado en divisas o cripto. No es una
 * retención al proveedor — lo paga quien paga — pero entra al resumen fiscal.
 */
export function calcularIgtf(
  input: { montoPago: number; enDivisas: boolean },
  config: ConfigRetencion,
): CalculoRetencion {
  if (!input.enDivisas) return CERO('igtf', 'El pago no es en divisas ni en cripto: no causa IGTF.');
  const pago = r2(n0(input.montoPago));
  if (pago <= 0) return CERO('igtf', 'El pago no tiene monto.');
  const pct = n0(config.pctIgtf);
  if (pct <= 0) return CERO('igtf', 'El porcentaje de IGTF está en 0 en la configuración fiscal.');
  return {
    tipo: 'igtf', baseImponible: pago, alicuota: 0, impuesto: 0,
    porcentaje: pct, sustraendo: 0, montoRetenido: r2((pago * pct) / 100),
    explicacion: `${pct}% sobre el pago en divisas (${pago.toLocaleString('es-VE')}).`,
  };
}

/* ───────────────────── Período y comprobante ───────────────────── */

/** Período fiscal AAAAMM de una fecha ISO. */
export function periodoDe(fechaIso: string): string {
  const s = String(fechaIso ?? '').slice(0, 10);
  const [y, m] = s.split('-');
  return y && m ? `${y}${m}` : '';
}

/**
 * Quincena del IVA: la 1 va del 1 al 15 y la 2 del 16 al fin de mes. Los
 * comprobantes de cada quincena se enteran juntos.
 */
export function quincenaDe(fechaIso: string): 1 | 2 {
  const d = Number(String(fechaIso ?? '').slice(8, 10)) || 1;
  return d <= 15 ? 1 : 2;
}

/** AAAAMM → «septiembre de 2026». */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function labelPeriodo(periodo: string): string {
  const p = String(periodo ?? '');
  if (!/^\d{6}$/.test(p)) return p || '—';
  const mes = MESES[Number(p.slice(4, 6)) - 1] ?? '';
  return `${mes} de ${p.slice(0, 4)}`;
}

/** El correlativo legal: AAAAMM + 8 dígitos. */
export function formatoComprobante(periodo: string, consecutivo: number): string {
  return `${periodo}${String(Math.max(1, Math.trunc(n0(consecutivo)))).padStart(8, '0')}`;
}

/** ¿Tiene forma de correlativo válido? */
export function comprobanteValido(v: string | null | undefined): boolean {
  return /^\d{14}$/.test(String(v ?? ''));
}

/* ───────────────────────── Resumen ───────────────────────── */

export interface FilaResumen { tipo: TipoImpuesto; monto: number; anulada?: boolean }

/** Totales por impuesto, sin contar las anuladas. */
export function totalesPorImpuesto(filas: FilaResumen[]): Record<TipoImpuesto, number> {
  const out = { iva: 0, islr: 0, municipal: 0, regional: 0, igtf: 0 } as Record<TipoImpuesto, number>;
  for (const f of filas) {
    if (f.anulada) continue;
    out[f.tipo] = r2(out[f.tipo] + n0(f.monto));
  }
  return out;
}

export function totalRetenido(filas: FilaResumen[]): number {
  return r2(filas.filter((f) => !f.anulada).reduce((a, f) => a + n0(f.monto), 0));
}

/* ═══════════════ La dirección: quién retuvo a quién ═══════════════

   Es la distinción que cambia el significado del número:

   · recibida   — nos la practicaron. Es un ANTICIPO de impuesto a favor de la
                  empresa: se descuenta de lo que toca pagar en la declaración.
   · practicada — la practicó la empresa. Es plata de un tercero que hay que
                  ENTERAR al fisco. Es deuda, no activo.

   El IGTF no cae en ninguna de las dos: se paga, no se recupera y no se
   descuenta de nada. Es costo, y por eso se suma aparte.                     */

export type DireccionRetencion = 'recibida' | 'practicada';

export const DIRECCIONES: { key: DireccionRetencion; label: string; corto: string }[] = [
  { key: 'recibida', label: 'Nos la practicaron', corto: 'Nos retuvieron' },
  { key: 'practicada', label: 'La practicamos', corto: 'Retuvimos' },
];

export function labelDireccion(d: DireccionRetencion | string | null | undefined): string {
  return DIRECCIONES.find((x) => x.key === d)?.label ?? '—';
}

export type EstadoRetencion = 'registrada' | 'declarada';

export const ESTADOS_RETENCION: { key: EstadoRetencion; label: string }[] = [
  { key: 'registrada', label: 'Registrada' },
  { key: 'declarada', label: 'Declarada' },
];

export function labelEstadoRetencion(e: EstadoRetencion | string | null | undefined): string {
  return ESTADOS_RETENCION.find((x) => x.key === e)?.label ?? '—';
}

/** Lo que el IGTF NO es: recuperable. Sirve para no sumarlo al crédito fiscal. */
export function esRecuperable(tipo: TipoImpuesto): boolean {
  return tipo !== 'igtf';
}

/* ═══════════════════ El resumen del libro ═══════════════════ */

export interface FilaLibro {
  tipo: TipoImpuesto;
  direccion: DireccionRetencion;
  estado?: EstadoRetencion;
  monto: number;
  anulada?: boolean;
}

export interface ResumenLibro {
  /** Lo que nos retuvieron y se descuenta del impuesto a pagar (sin IGTF). */
  aFavor: number;
  /** IGTF pagado: no se recupera, es costo. */
  igtfPagado: number;
  /** Lo que la empresa retuvo y todavía no declaró. */
  porEnterar: number;
  /** Lo que la empresa retuvo y ya declaró. */
  enterado: number;
  /** Cuántos renglones vivos (sin las anuladas). */
  registros: number;
  /** Cuántos están anulados. */
  anulados: number;
}

/**
 * Los cuatro números de la cabecera del libro. Las anuladas no suman en
 * ninguno: un comprobante anulado no es crédito ni es deuda.
 */
export function resumenLibro(filas: FilaLibro[]): ResumenLibro {
  const out: ResumenLibro = { aFavor: 0, igtfPagado: 0, porEnterar: 0, enterado: 0, registros: 0, anulados: 0 };
  for (const f of filas) {
    if (f.anulada) { out.anulados += 1; continue; }
    out.registros += 1;
    const m = n0(f.monto);
    if (f.tipo === 'igtf') { out.igtfPagado = r2(out.igtfPagado + m); continue; }
    if (f.direccion === 'recibida') { out.aFavor = r2(out.aFavor + m); continue; }
    if (f.estado === 'declarada') out.enterado = r2(out.enterado + m);
    else out.porEnterar = r2(out.porEnterar + m);
  }
  return out;
}

/**
 * Qué significa un renglón, en una línea. Es el texto que explica por qué el
 * mismo monto es a favor en un caso y deuda en el otro.
 */
export function significadoRetencion(tipo: TipoImpuesto, direccion: DireccionRetencion): string {
  if (tipo === 'igtf') return 'IGTF pagado: no se recupera, va a costo.';
  return direccion === 'recibida'
    ? 'Nos lo retuvieron: es un anticipo que se descuenta en la declaración.'
    : 'Lo retuvo la empresa: hay que enterarlo al fisco.';
}
