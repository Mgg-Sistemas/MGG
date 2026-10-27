/* ============================================================
   Golden Touch · Libro fiscal · El cálculo (Venezuela)

   Aquí vive la cuenta de cada impuesto, sin base de datos y sin pantalla, para
   poder probarla renglón por renglón contra el reglamento.

   QUIÉN RETIENE (D2, 14/10/2026). Son dos marcas separadas de Parámetros:
   «agente de retención de IVA» y «contribuyente especial». El IVA lo retiene
   la empresa que tenga cualquiera de las dos (el especial está designado
   agente por la norma); el IGTF solo lo percibe el especial. Es la misma regla
   que aplica la base (trigger `retencion_agente_valido`).

   LO QUE MANDA EN CADA UNO
   · IVA       — Providencia SNAT/2025/000054 (G.O. N° 43.171 del 16/07/2025,
                 deroga a la SNAT/2015/0049). Retiene el agente de retención
                 designado (sujetos pasivos especiales personas jurídicas o
                 personas naturales con firma personal). Retiene el 75% del IVA
                 de la factura, y el 100% en los supuestos del art. 5 (factura
                 que no cumple los requisitos, IVA no discriminado, proveedor no
                 inscrito o no ubicable en el RIF, proveedor no domiciliado, y
                 compra de metales o piedras preciosas). El comprobante lleva
                 correlativo AAAAMM + 8 dígitos y se entera por quincenas.
   · ISLR      — Decreto 1.808. El porcentaje sale del CONCEPTO y del SUJETO.
                 A la persona natural residente se le resta el SUSTRAENDO y no
                 se le retiene por debajo del mínimo; a la persona jurídica
                 domiciliada se le aplica el porcentaje directo.
   · Municipal — Impuesto sobre Actividades Económicas. La alícuota la fija la
                 ORDENANZA de cada municipio: aquí no hay número por defecto.
   · Regional  — Timbre fiscal estadal. Igual: lo fija la ley de cada estado.
   · IGTF      — Ley de IGTF: 3% sobre los pagos en divisas o cripto. Es un
                 impuesto que paga quien paga, no una retención al proveedor;
                 se calcula aquí para que aparezca en el mismo resumen fiscal.

   NADA SE CABLEA SALVO LAS FÓRMULAS. Los porcentajes vienen del catálogo y de
   la configuración, porque cambian por ley, por ordenanza y por año.
   ============================================================ */
import { rotuloImpuesto } from './rotulos';
import { EMPRESA_EMAIL } from '@/shared/lib/empresa';
export { EMPRESA_EMAIL };

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
  { key: 'municipal', label: 'ISAE (actividades económicas)', corto: 'ISAE' },
  { key: 'regional', label: 'Estadal (timbre fiscal)', corto: 'Estadal' },
  { key: 'igtf', label: 'IGTF', corto: 'IGTF' },
];

export function labelImpuesto(t: TipoImpuesto | string | null | undefined): string {
  return TIPOS_IMPUESTO.find((x) => x.key === t)?.label ?? (t == null || t === '' ? '—' : rotuloImpuesto(t));
}

/** Parámetros de la empresa como agente de retención. */
export interface ConfigRetencion {
  rif: string | null;
  razonSocial: string | null;
  direccionFiscal: string | null;
  municipio: string | null;
  estado: string | null;
  /** Correo de contacto del agente de retención (impreso en comprobantes). */
  email?: string | null;
  /** Designada agente de retención de IVA. Con ella se retiene IVA aunque no sea especial. */
  esAgenteRetencionIva: boolean;
  /** Contribuyente especial: retiene IVA y además percibe el IGTF. */
  esContribuyenteEspecial: boolean;
  pctIvaGeneral: number;    // 75
  pctIvaEspecial: number;   // 100
  valorUt: number;          // define el sustraendo del ISLR
  pctIgtf: number;          // 3
  /** Número de Licencia de Actividad Económica / RIM del agente (retención municipal). */
  licenciaMunicipal?: string | null;
  /** Emisión de comprobantes: imprimir Original (Sujeto Retenido) y Copia (Agente de Retención) */
  imprimirOriginalYCopia?: boolean;
  /** Estatus del kanban de Compras/Servicios que se consideran en Retenciones. */
  estatusKanbanRetencion?: string[];
}

/**
 * Los valores con los que arranca la pantalla mientras se lee la configuración.
 * Lo que vale es lo guardado en Parámetros.
 */
export const CONFIG_RETENCION_DEFECTO: ConfigRetencion = {
  rif: null, razonSocial: null, direccionFiscal: null, municipio: null, estado: null,
  email: 'info@goldentouch1127.com',
  esAgenteRetencionIva: true,
  esContribuyenteEspecial: false,
  pctIvaGeneral: 75, pctIvaEspecial: 100,
  valorUt: 0, pctIgtf: 3,
  licenciaMunicipal: null,
  imprimirOriginalYCopia: true,
  estatusKanbanRetencion: [
    'confirmada_metodo',
    'oc_aprobada',
    'cuenta_abierta',
    'por_recibir',
    'pagada',
    'recibida',
    'finalizada',
  ],
};

/* ───────────────── Qué puede practicar la empresa ───────────────── */

/** ¿Puede la empresa practicar esta retención? Las recibidas se registran siempre. */
export function puedePracticar(
  tipo: TipoImpuesto,
  config: Pick<ConfigRetencion, 'esAgenteRetencionIva' | 'esContribuyenteEspecial'>,
): boolean {
  if (tipo === 'iva') return config.esAgenteRetencionIva || config.esContribuyenteEspecial;
  if (tipo === 'igtf') return config.esContribuyenteEspecial;
  return true;
}

/** Por qué no puede, en una línea, o null si puede. */
export function motivoNoPuedePracticar(
  tipo: TipoImpuesto,
  config: Pick<ConfigRetencion, 'esAgenteRetencionIva' | 'esContribuyenteEspecial'>,
): string | null {
  if (puedePracticar(tipo, config)) return null;
  if (tipo === 'iva') {
    return 'La empresa no está marcada como agente de retención de IVA ni como contribuyente especial '
      + '(la Providencia SNAT/2025/000054 designa a los agentes, personas jurídicas o naturales con firma personal). '
      + 'Si la retención fue practicada por un cliente, registrarla como «Retención recibida». '
      + 'Si la empresa fue designada, activar la casilla en Parámetros.';
  }
  return 'Solo el contribuyente especial percibe el IGTF (Ley del IGTF). '
    + 'Si la retención fue practicada por un cliente, registrarla como «Retención recibida». '
    + 'Si la empresa fue designada contribuyente especial, activar la casilla en Parámetros.';
}

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
  /** El Portal Fiscal lo marca sujeto a retención del 100%, o no está inscrito en el RIF. */
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
  if (m.proveedorNoInscrito) return 'El proveedor está sujeto a retención del 100% según el Portal Fiscal, o no está inscrito en el RIF';
  if (m.proveedorNoDomiciliado) return 'El proveedor no está domiciliado en el país';
  if (m.metalesPreciosos) return 'Compra de metales o piedras preciosas';
  return null;
}

/**
 * Retención de IVA. Se retiene sobre el IVA de la factura, no sobre el total.
 * Si la empresa no es agente de retención de IVA ni contribuyente especial, no
 * retiene: da cero.
 */
export function calcularRetencionIva(
  input: {
    baseImponible: number; ivaFactura: number; motivos?: MotivosIvaCien | null;
    /** R6: el supuesto marcado, con su % y su texto, leído de la base por fecha. Si viene, manda sobre las casillas fijas. */
    supuesto?: { pct: number; texto: string } | null;
  },
  config: ConfigRetencion,
): CalculoRetencion {
  if (!puedePracticar('iva', config)) {
    return CERO('iva', 'La empresa no está marcada como agente de retención de IVA: no practica retención de IVA.');
  }
  const base = r2(n0(input.baseImponible));
  const iva = r2(n0(input.ivaFactura));
  if (iva <= 0) return CERO('iva', 'La factura no tiene IVA sobre el cual retener.');
  const sup = input.supuesto ?? null;
  const cien = !sup && retieneCienPorCiento(input.motivos);
  const pct = sup ? n0(sup.pct) : cien ? n0(config.pctIvaEspecial) : n0(config.pctIvaGeneral);
  const monto = r2((iva * pct) / 100);
  const alicuota = base > 0 ? r2((iva / base) * 100) : 0;
  const porQue = sup ? ` (${pct}% porque: ${sup.texto.toLowerCase()})`
    : cien ? ` (100% porque: ${motivoCienTexto(input.motivos)?.toLowerCase()})` : '';
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
  input: { montoPago: number; concepto: ConceptoRetencion | null; moneda?: string; tasa?: number },
  config: ConfigRetencion,
): CalculoRetencion {
  const c = input.concepto;
  if (!c) return CERO('islr', 'Falta elegir el concepto del Decreto 1.808 que corresponde al pago.');
  if (!c.activo) return CERO('islr', `El concepto «${c.nombre}» está desactivado en el catálogo.`);
  const pago = r2(n0(input.montoPago));
  if (pago <= 0) return CERO('islr', 'El pago no tiene monto.');

  const base = r2((pago * n0(c.basePct)) / 100);
  const pct = n0(c.porcentaje);
  if (pct <= 0) return CERO('islr', `El concepto «${c.nombre}» está en 0%: hay que cargar su porcentaje en el catálogo.`);

  const enDivisas = input.moneda != null && input.moneda !== 'Bs' && n0(input.tasa) > 0;
  const tasaConv = enDivisas ? n0(input.tasa) : 0;
  const baseBs = tasaConv > 0 ? r2(base * tasaConv) : base;

  const minimo = minimoIslr(c, config.valorUt);
  if (minimo > 0 && baseBs < minimo) {
    const detBs = tasaConv > 0 ? ` (${baseBs.toLocaleString('es-VE')} Bs al cambio)` : '';
    return {
      tipo: 'islr', baseImponible: base, alicuota: 0, impuesto: 0, porcentaje: pct, sustraendo: 0, montoRetenido: 0,
      explicacion: `No se retiene: la base${detBs} no llega al mínimo de ${minimo.toLocaleString('es-VE')} Bs (${c.baseMinimaUt} UT).`,
    };
  }

  const sustraendoBs = c.aplicaSustraendo ? sustraendoIslr(pct, config.valorUt) : 0;
  const sustraendo = tasaConv > 0 ? r2(sustraendoBs / tasaConv) : sustraendoBs;
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
  if (!c) return CERO(tipo, `Falta elegir el concepto. La alícuota sale de ${queEs}.`);
  const pago = r2(n0(input.montoPago));
  if (pago <= 0) return CERO(tipo, 'El pago no tiene monto.');
  const pct = n0(c.porcentaje);
  if (pct <= 0) {
    return CERO(tipo, `«${c.nombre}» está en 0%: hay que cargar la alícuota de ${queEs} en ⚙ Parámetros.`);
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

/**
 * Formato del número de cada serie (V1): el IVA lleva AAAAMM + 8 dígitos; ISLR,
 * ISAE y estadal, 10 dígitos continuos que no se reinician por período. El IGTF
 * no lleva comprobante propio.
 */
export type FormatoSerie = 'AAAAMM8' | 'N10';
export function formatoSerie(tipo: TipoImpuesto): FormatoSerie | null {
  if (tipo === 'iva') return 'AAAAMM8';
  if (tipo === 'igtf') return null;
  return 'N10';
}

/** El número con el formato de su serie (la base es la que lo asigna; esto es para mostrar y probar). */
export function formatoComprobante(periodo: string, consecutivo: number, tipo: TipoImpuesto = 'iva'): string {
  const sec = String(Math.max(1, Math.trunc(n0(consecutivo))));
  return formatoSerie(tipo) === 'N10' ? sec.padStart(10, '0') : `${periodo}${sec.padStart(8, '0')}`;
}

/** ¿Tiene la forma del número de su serie? Sin impuesto, vale cualquiera de los dos formatos. */
export function comprobanteValido(v: string | null | undefined, tipo?: TipoImpuesto): boolean {
  const s = String(v ?? '');
  const formato = tipo ? formatoSerie(tipo) : null;
  if (formato === 'AAAAMM8') return /^\d{14}$/.test(s);
  if (formato === 'N10') return /^\d{10}$/.test(s);
  return /^(\d{14}|\d{10})$/.test(s);
}

/** ¿El número tiene la forma de ese formato? (con V2R el formato sale de retencion_impuestos). */
export function numeroConFormato(v: string, formato: FormatoSerie): boolean {
  return formato === 'AAAAMM8' ? /^\d{14}$/.test(v) : /^\d{10}$/.test(v);
}

export const textoDeFormato = (formato: FormatoSerie) => (formato === 'AAAAMM8' ? '14 dígitos (AAAAMM y 8 de la serie)' : '10 dígitos');

/** Cómo se escribe el número de una serie, para los avisos. */
export function textoFormatoSerie(tipo: TipoImpuesto): string {
  return formatoSerie(tipo) === 'AAAAMM8' ? '14 dígitos (AAAAMM y 8 de la serie)' : '10 dígitos';
}

/**
 * Hasta cuándo hay tiempo de ENTREGAR el comprobante al proveedor: el de la
 * primera quincena, dentro de los 5 días continuos siguientes al 15; el de la
 * segunda, dentro de los 5 días continuos del mes siguiente.
 */
export function limiteEntregaComprobante(fechaIso: string): string {
  const d = String(fechaIso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const base = quincenaDe(d) === 1 ? new Date(Date.UTC(y, m - 1, 15)) : new Date(Date.UTC(y, m, 0));
  base.setUTCDate(base.getUTCDate() + 5);
  return base.toISOString().slice(0, 10);
}

/**
 * Fecha de la tasa BCV que vale para una factura: la de su fecha, y si cae en
 * sábado o domingo, la del lunes. Sin calendario de feriados.
 */
export function fechaTasaBcv(fechaIso: string): string {
  const d = String(fechaIso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const f = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(f.getTime())) return '';
  const dia = f.getUTCDay();
  if (dia === 6) f.setUTCDate(f.getUTCDate() + 2);
  else if (dia === 0) f.setUTCDate(f.getUTCDate() + 1);
  return f.toISOString().slice(0, 10);
}

/* ───────────────────────── Bolívares ───────────────────────── */

/**
 * Lo retenido en bolívares, que es como se declara. Si la retención ya está en
 * Bs la tasa no hace falta; si está en divisas, sin tasa no hay equivalente y
 * se devuelve 0 en vez de inventar un número.
 */
export function enBolivares(monto: number, moneda: string | null | undefined, tasa: number | null | undefined): number {
  const m = n0(monto);
  if (m === 0) return 0;
  if (String(moneda ?? '').toUpperCase() === 'BS') return r2(m);
  const t = n0(tasa);
  return t > 0 ? r2(m * t) : 0;
}

/* ───────────────────────── Resumen ───────────────────────── */

export interface FilaResumen {
  tipo: TipoImpuesto;
  monto: number;
  anulada?: boolean;
  tipoDocumento?: string | null;
}

/** Totales por impuesto, sin contar las anuladas. Las notas de crédito restan contablemente. */
export function totalesPorImpuesto(filas: FilaResumen[]): Record<TipoImpuesto, number> {
  const out = { iva: 0, islr: 0, municipal: 0, regional: 0, igtf: 0 } as Record<TipoImpuesto, number>;
  for (const f of filas) {
    if (f.anulada) continue;
    const factor = f.tipoDocumento === 'nota_credito' ? -1 : 1;
    out[f.tipo] = r2(out[f.tipo] + n0(f.monto) * factor);
  }
  return out;
}

export function totalRetenido(filas: FilaResumen[]): number {
  return r2(filas.filter((f) => !f.anulada).reduce((a, f) => {
    const factor = f.tipoDocumento === 'nota_credito' ? -1 : 1;
    return a + n0(f.monto) * factor;
  }, 0));
}

/* ═══════════════ La dirección: quién retuvo a quién ═══════════════

   Es la distinción que cambia el significado del número:

   · recibida   — nos la practicaron. Es un ANTICIPO de impuesto a favor de la
                  empresa: se descuenta de lo que toca pagar en la declaración.
   · practicada — la practicó la empresa. Es dinero de un tercero que hay que
                  ENTERAR al fisco. Es deuda, no activo.

   El IGTF no cae en ninguna de las dos: se paga, no se recupera y no se
   descuenta de nada. Es costo, y por eso se suma aparte.                     */

export type DireccionRetencion = 'recibida' | 'practicada';

export const DIRECCIONES: { key: DireccionRetencion; label: string; corto: string }[] = [
  { key: 'recibida', label: 'Retención recibida', corto: 'Recibida' },
  { key: 'practicada', label: 'Retención practicada', corto: 'Practicada' },
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
  tipoDocumento?: string | null;
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
 * Las notas de crédito restan contablemente de la deuda o anticipo.
 */
export function resumenLibro(filas: FilaLibro[]): ResumenLibro {
  const out: ResumenLibro = { aFavor: 0, igtfPagado: 0, porEnterar: 0, enterado: 0, registros: 0, anulados: 0 };
  for (const f of filas) {
    if (f.anulada) { out.anulados += 1; continue; }
    out.registros += 1;
    const factor = f.tipoDocumento === 'nota_credito' ? -1 : 1;
    const m = n0(f.monto) * factor;
    if (f.tipo === 'igtf') { out.igtfPagado = r2(out.igtfPagado + m); continue; }
    if (f.direccion === 'recibida') { out.aFavor = r2(out.aFavor + m); continue; }
    if (f.estado === 'declarada') out.enterado = r2(out.enterado + m);
    else out.porEnterar = r2(out.porEnterar + m);
  }
  return out;
}

/**
 * Los totales del libro, uno por moneda. Bs y $ no se suman entre sí: cada fila
 * cuenta en la moneda que trae, sea cual sea (la base no la limita).
 */
export function totalesPorMoneda(filas: (FilaLibro & { moneda: string })[]): { moneda: string; resumen: ResumenLibro }[] {
  const grupos = new Map<string, FilaLibro[]>();
  for (const f of filas) {
    const g = grupos.get(f.moneda);
    if (g) g.push(f); else grupos.set(f.moneda, [f]);
  }
  return [...grupos.keys()].sort((a, b) => a.localeCompare(b))
    .map((moneda) => ({ moneda, resumen: resumenLibro(grupos.get(moneda) ?? []) }));
}

/**
 * Qué significa un renglón, en una línea. Es el texto que explica por qué el
 * mismo monto es a favor en un caso y deuda en el otro.
 */
export function significadoRetencion(tipo: TipoImpuesto, direccion: DireccionRetencion): string {
  if (tipo === 'igtf') return 'IGTF percibido: no es recuperable, se registra como costo.';
  return direccion === 'recibida'
    ? 'Retención recibida: anticipo descontable en la declaración del impuesto.'
    : 'Retención practicada: monto pendiente de enteramiento al fisco.';
}
