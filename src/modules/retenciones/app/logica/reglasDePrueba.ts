/* ============================================================
   MGG · Retenciones · Las cinco reglas de hoy, como DATO (solo pruebas)

   Así quedarían en retencion_regla_versiones. Ninguna línea del motor las
   nombra: si el motor las calcula bien, cualquier impuesto armado con las
   mismas piezas se calcula sin programar.
   Montos, códigos y filas: inventados (la Tarifa N° 2 usa los tramos de la ley).
   ============================================================ */

import type { ContextoCalculo } from './motor';
import type { FilaClasificacion, PasosRegla, TarifaVigente, VersionRegla } from './regla';

const version = (id: string, impuesto: string, pasos: PasosRegla, over: Partial<VersionRegla> = {}): VersionRegla => ({
  id, regla_id: `r-${id}`, impuesto, vigente_desde: '2025-08-01', vigente_hasta: null, estado: 'vigente', motivo: null,
  direccion: 'practicada', documentos: ['factura', 'nd', 'nc'], operacion: 'ambos', sujetos: [], contribuyentes: [],
  condicion_agente: null, clasificacion_id: null, pasos, ...over,
});

const TOPES = { no_negativo: true, max_causado: false, max_base: false } as const;
const REDONDEO = { decimales: 2, modo: 'mitad_arriba' } as const;

export const IVA = version('v-iva', 'iva', {
  base: { suma: ['iva'], resta: [], porcion: null, alicuota: null },
  moneda: { convertir: true },
  retiene: { op: 'pct', fuente: { tipo: 'supuesto', defecto: { tipo: 'fijo', valor: 75 } } },
  topes: { ...TOPES, max_causado: true },
  redondeo: REDONDEO,
}, { condicion_agente: 'agente_iva', contribuyentes: ['ordinario', 'especial'] });

export const ISLR_PNR = version('v-islr-pnr', 'islr', {
  base: { suma: ['subtotal'], resta: [], porcion: { tipo: 'tabla', columna: 'base_pct' }, alicuota: null },
  moneda: { convertir: true },
  minimo: { fuente: { tipo: 'tabla', columna: 'minimo' }, unidad: 'ut' },
  tasa: { op: 'pct', fuente: { tipo: 'tabla', columna: 'pct' } },
  sustraendo: { op: 'ut_factor_pct', factor: { tipo: 'tabla', columna: 'sustraendo_factor' } },
  topes: TOPES,
  redondeo: REDONDEO,
}, { sujetos: ['pn_residente', 'pj_domiciliada'], clasificacion_id: 'cl-islr', documentos: ['factura', 'nd', 'nc', 'pago'] });

/** Igual que ISLR_PNR, con el mínimo y el sustraendo «una vez por factura». */
export const ISLR_PNR_FACTURA: VersionRegla = {
  ...ISLR_PNR, id: 'v-islr-pnr-f',
  pasos: {
    ...ISLR_PNR.pasos,
    minimo: { fuente: { tipo: 'tabla', columna: 'minimo' }, unidad: 'ut', alcance: 'factura' },
    sustraendo: { op: 'ut_factor_pct', factor: { tipo: 'tabla', columna: 'sustraendo_factor' }, alcance: 'factura' },
  },
};

export const ISLR_PJND = version('v-islr-pjnd', 'islr', {
  base: { suma: ['subtotal'], resta: [], porcion: { tipo: 'tabla', columna: 'base_pct' }, alicuota: null },
  moneda: { convertir: true },
  tasa: { op: 'tramos', tarifa_id: 't-2' },
  topes: TOPES,
  redondeo: REDONDEO,
}, { sujetos: ['pj_no_domiciliada'], clasificacion_id: 'cl-islr' });

export const ISAE = version('v-isae', 'municipal', {
  base: { suma: ['subtotal'], resta: ['descuento'], porcion: null, alicuota: null },
  moneda: { convertir: true },
  minimo: { fuente: { tipo: 'tabla', columna: 'minimo' }, unidad: 'mmv' },
  tasa: { op: 'pct', fuente: { tipo: 'tabla', columna: 'pct' } },
  retiene: { op: 'todo' },
  topes: TOPES,
  redondeo: REDONDEO,
}, { clasificacion_id: 'cl-isae' });

export const IGTF = version('v-igtf', 'igtf', {
  base: { suma: ['pagado_divisas'], resta: [], porcion: null, alicuota: null },
  moneda: { convertir: true },
  tasa: { op: 'pct', fuente: { tipo: 'parametro', clave: 'pct_igtf' } },
  topes: TOPES,
  redondeo: REDONDEO,
}, { documentos: ['pago'] });

const fila = (over: Partial<FilaClasificacion> & Pick<FilaClasificacion, 'id' | 'codigo'>): FilaClasificacion => ({
  clasificacion_id: 'cl-islr', descripcion: `Fila ${over.codigo} (ejemplo)`, sujeto: null, pct: null, base_pct: 100,
  minimo: null, minimo_unidad: null, sustraendo_factor: null, tarifa_id: null, ...over,
});

/** Persona natural residente: 3 %, con mínimo y sustraendo de 83,3334 UT. */
export const HONORARIOS_PNR = fila({ id: 'f-001', codigo: '001', sujeto: 'pn_residente', pct: 3, minimo: 83.3334, minimo_unidad: 'ut', sustraendo_factor: 83.3334 });
/** Otra de persona natural residente, al 5 %. */
export const COMISIONES_PNR = fila({ id: 'f-002', codigo: '002', sujeto: 'pn_residente', pct: 5, minimo: 83.3334, minimo_unidad: 'ut', sustraendo_factor: 83.3334 });
/** Persona jurídica domiciliada: 2 %, sin mínimo ni sustraendo. */
export const SERVICIOS_PJD = fila({ id: 'f-003', codigo: '003', sujeto: 'pj_domiciliada', pct: 2 });
/** Con una porción de la base: 90 %. */
export const PORCION_PJD = fila({ id: 'f-004', codigo: '004', sujeto: 'pj_domiciliada', pct: 2, base_pct: 90 });
/** Persona jurídica no domiciliada: va por la Tarifa N° 2. */
export const SERVICIOS_PJND = fila({ id: 'f-005', codigo: '005', sujeto: 'pj_no_domiciliada', tarifa_id: 't-2' });
/** Una actividad del ISAE: 2,5 %, con un mínimo de 10 en la moneda de mayor valor. */
export const ACTIVIDAD = fila({ id: 'f-a1', clasificacion_id: 'cl-isae', codigo: 'A-1', pct: 2.5, minimo: 10, minimo_unidad: 'mmv' });

export const TARIFA_2: TarifaVigente = {
  id: 't-2', nombre: 'Tarifa N° 2', unidad: 'ut',
  tramos: [
    { desde: 0, hasta: 2000, pct: 15, sustraendo: 0 },
    { desde: 2000, hasta: 3000, pct: 22, sustraendo: 140 },
    { desde: 3000, hasta: null, pct: 34, sustraendo: 500 },
  ],
};

export const CONTEXTO: ContextoCalculo = {
  parametros: { valor_ut: 43, pct_igtf: 3, agente_iva: 1 },
  tasa: null,
  tasaMmv: { moneda: 'EUR', tasa: 50, fecha_tasa: '2026-10-14', regla: 'bcv', provisional: false },
  tarifas: { 't-2': TARIFA_2 },
};

export const TASA_USD = { moneda: 'USD', tasa: 40, fecha_tasa: '2026-10-14', regla: 'bcv', provisional: false };
