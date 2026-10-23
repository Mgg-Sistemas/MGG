/* ============================================================
   MGG · Retenciones v8 · Las reglas de hoy, armadas con las piezas

   Mientras la base no tenga el paquete de reglas (capacidades.reglas en
   false), la puerta traduce la configuración y el catálogo de HOY
   (retencion_config y retencion_conceptos) a la forma del motor nuevo:
   una versión de regla por impuesto y una fila de clasificación por
   concepto. Tiene que dar los mismos montos que la pantalla de
   producción (retencionesCalculo.ts): lo comprueban sus pruebas.

   Esta traducción es la única que conoce los nombres de los impuestos de
   hoy; el motor no los mira. Cuando la base tenga las reglas, este
   archivo deja de usarse.
   ============================================================ */

import type { ConceptoRetencion, ConfigRetencion, MotivosIvaCien } from '../../retencionesCalculo';
import { CLAVE_UT, type ContextoCalculo } from '../logica/motor';
import type { FilaClasificacion, PasosRegla, SupuestoMarcado, Sujeto, VersionRegla } from '../logica/regla';

/** El factor del sustraendo del Decreto 1.808 (persona natural residente). */
const FACTOR_SUSTRAENDO = 83.3334;
const CLAVE_AGENTE_IVA = 'agente_iva';

const TOPES = { no_negativo: true, max_causado: false, max_base: false } as const;
const REDONDEO = { decimales: 2, modo: 'mitad_arriba' } as const;

const version = (id: string, impuesto: string, pasos: PasosRegla, over: Partial<VersionRegla> = {}): VersionRegla => ({
  id, regla_id: id, impuesto, vigente_desde: '2000-01-01', vigente_hasta: null, estado: 'vigente', motivo: 'Configuración de hoy',
  direccion: 'practicada', documentos: ['factura', 'nd', 'nc'], operacion: 'ambos', sujetos: [], contribuyentes: [],
  condicion_agente: null, clasificacion_id: null, pasos, ...over,
});

/** Las versiones de regla de hoy, por clave de impuesto. */
export function reglasDeHoy(config: ConfigRetencion): Record<'iva' | 'islr' | 'municipal', VersionRegla> {
  return {
    iva: version('hoy-iva', 'iva', {
      base: { suma: ['iva'], resta: [], porcion: null, alicuota: null },
      retiene: { op: 'pct', fuente: { tipo: 'supuesto', defecto: { tipo: 'fijo', valor: config.pctIvaGeneral } } },
      topes: { ...TOPES, max_causado: true },
      redondeo: REDONDEO,
    }, { condicion_agente: CLAVE_AGENTE_IVA }),
    islr: version('hoy-islr', 'islr', {
      base: { suma: ['subtotal'], resta: [], porcion: { tipo: 'tabla', columna: 'base_pct' }, alicuota: null },
      minimo: { fuente: { tipo: 'tabla', columna: 'minimo' }, unidad: 'ut' },
      tasa: { op: 'pct', fuente: { tipo: 'tabla', columna: 'pct' } },
      sustraendo: { op: 'ut_factor_pct', factor: { tipo: 'tabla', columna: 'sustraendo_factor' } },
      topes: TOPES,
      redondeo: REDONDEO,
    }, { clasificacion_id: 'islr' }),
    municipal: version('hoy-municipal', 'municipal', {
      base: { suma: ['subtotal'], resta: [], porcion: { tipo: 'tabla', columna: 'base_pct' }, alicuota: null },
      tasa: { op: 'pct', fuente: { tipo: 'tabla', columna: 'pct' } },
      retiene: { op: 'todo' },
      topes: TOPES,
      redondeo: REDONDEO,
    }, { clasificacion_id: 'municipal' }),
  };
}

const SUJETOS: Record<string, Sujeto | null> = {
  pn_residente: 'pn_residente', pn_no_residente: 'pn_no_residente', pj_domiciliada: 'pj_domiciliada', pj_no_domiciliada: 'pj_no_domiciliada',
};

/** Un concepto del catálogo de hoy como fila de clasificación. Un % en 0 es «sin %» (falta el dato). */
export function filaDeConcepto(c: ConceptoRetencion): FilaClasificacion {
  return {
    id: c.id, clasificacion_id: c.tipo, codigo: c.codigo ?? '', descripcion: c.nombre,
    sujeto: SUJETOS[c.sujeto] ?? null,
    pct: c.porcentaje > 0 ? c.porcentaje : null,
    base_pct: c.basePct || 100,
    minimo: c.baseMinimaUt > 0 ? c.baseMinimaUt : null,
    minimo_unidad: c.baseMinimaUt > 0 ? 'ut' : null,
    sustraendo_factor: c.aplicaSustraendo ? FACTOR_SUSTRAENDO : null,
    tarifa_id: null,
  };
}

/** Los valores de hoy que el motor resuelve por clave. */
export function contextoDeHoy(config: ConfigRetencion): ContextoCalculo {
  return {
    parametros: {
      [CLAVE_UT]: config.valorUt > 0 ? config.valorUt : null,
      [CLAVE_AGENTE_IVA]: config.esContribuyenteEspecial ? 1 : 0,
    },
    tasa: null,
    tasaMmv: null,
    tarifas: {},
    // Como el cálculo de hoy: el sustraendo y el mínimo, con 2 decimales.
    redondeoIntermedio: 'publicado',
  };
}

/** Los supuestos del 100 % del art. 5, tal como los marca hoy la pantalla. */
export const SUPUESTOS_IVA: { clave: keyof MotivosIvaCien; texto: string }[] = [
  { clave: 'ivaNoDiscriminado', texto: 'El IVA no está discriminado en la factura' },
  { clave: 'facturaNoCumple', texto: 'La factura no cumple los requisitos de facturación' },
  { clave: 'proveedorNoInscrito', texto: 'El Portal Fiscal lo marca sujeto al 100 %, o no está inscrito en el RIF' },
  { clave: 'proveedorNoDomiciliado', texto: 'El proveedor no está domiciliado en el país' },
  { clave: 'metalesPreciosos', texto: 'Compra de metales o piedras preciosas' },
];

export function supuestosMarcados(m: MotivosIvaCien, config: ConfigRetencion): SupuestoMarcado[] {
  return SUPUESTOS_IVA.filter((s) => m[s.clave]).map((s) => ({ id: s.clave, texto: s.texto, pct: config.pctIvaEspecial }));
}
