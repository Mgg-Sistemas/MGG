/* ============================================================
   Golden Touch · Retenciones · Formato del comprobante (R8), piezas puras

   El comprobante PDF tiene un diseño «de fábrica» (el del código). Con R8,
   cada impuesto puede tener versiones con fecha de su formato: textos
   (encabezado, nota legal, pie), rótulos de los recuadros y de las firmas,
   columnas de la tabla (rótulo, si se ve, orden, ancho) y orientación.
   Aquí están los valores de fábrica y cómo se aplica una versión sobre
   ellos: lo que la versión no trae queda como de fábrica.
   ============================================================ */
import type { TipoImpuesto } from './retencionesCalculo';

export type Orientacion = 'vertical' | 'horizontal';

/** Las claves de textos que usa el comprobante. */
export const CLAVES_TEXTO = ['encabezado', 'nota_legal', 'pie'] as const;
export type ClaveTexto = typeof CLAVES_TEXTO[number];

/** Los rótulos fijos del comprobante (recuadros, total y firmas). */
export const ROTULOS_FABRICA: Record<string, string> = {
  n_comprobante: 'N° DE COMPROBANTE',
  periodo: 'PERIODO FISCAL',
  fecha_emision: 'FECHA DE EMISION',
  agente: 'AGENTE DE RETENCION',
  sujeto: 'SUJETO RETENIDO',
  total: 'TOTAL RETENIDO',
  firma_agente: 'Firma y sello del agente de retencion',
  firma_sujeto: 'Recibido por el sujeto retenido',
  verificacion_digital: 'VERIFICACION DIGITAL FISCAL',
};

/** Cómo se llama cada rótulo en la pantalla de Parámetros. */
export const NOMBRE_ROTULO: Record<string, string> = {
  n_comprobante: 'Recuadro del N° de comprobante', periodo: 'Recuadro del período', fecha_emision: 'Recuadro de la fecha de emisión',
  agente: 'Columna del agente', sujeto: 'Columna del sujeto retenido', total: 'Total retenido',
  firma_agente: 'Firma del agente', firma_sujeto: 'Firma del sujeto retenido',
  verificacion_digital: 'Caja de verificación digital (QR y Hash)',
};

export interface ColumnaFormato { campo: string; rotulo: string; visible: boolean; orden: number; ancho?: number | null }

/** Las columnas de fábrica de la tabla del comprobante, por impuesto. */
export function columnasFabrica(tipo: TipoImpuesto): ColumnaFormato[] {
  const cols: Array<[string, string]> = tipo === 'iva'
    ? [
        ['operacion', 'OP. N°'],
        ['factura', 'FACTURA'],
        ['fecha', 'FECHA'],
        ['control', 'N° CONTROL'],
        ['total_factura', 'TOTAL FACTURA'],
        ['exento', 'EXENTO'],
        ['base', 'BASE IMPONIBLE'],
        ['alicuota', 'ALICUOTA'],
        ['iva', 'IVA FACTURA'],
        ['pct', '% RET.'],
        ['monto', 'IVA RETENIDO'],
      ]
    : tipo === 'islr'
      ? [['factura', 'DOCUMENTO'], ['fecha', 'FECHA'], ['control', 'N° CONTROL'], ['concepto', 'CONCEPTO'], ['base', 'BASE IMPONIBLE'], ['sustraendo', 'SUSTRAENDO'], ['pct', '% RET.'], ['monto', 'MONTO RETENIDO']]
      : [['factura', 'DOCUMENTO'], ['fecha', 'FECHA'], ['control', 'N° CONTROL'], ['base', 'BASE IMPONIBLE'], ['pct', '% RET.'], ['monto', 'MONTO RETENIDO']];
  return cols.map(([campo, rotulo], i) => ({ campo, rotulo, visible: true, orden: i + 1, ancho: null }));
}

/** Los textos de fábrica de cada impuesto. */
export function textosFabrica(tipo: TipoImpuesto): Record<ClaveTexto, string> {
  const t: Record<string, { encabezado: string; nota_legal: string }> = {
    iva: { encabezado: 'COMPROBANTE DE RETENCION DE IVA', nota_legal: 'Providencia Administrativa SNAT/2025/000054 (G.O. N° 43.171)' },
    islr: { encabezado: 'COMPROBANTE DE RETENCION DE IMPUESTO SOBRE LA RENTA', nota_legal: 'Decreto 1.808 · Reglamento Parcial de la Ley de ISLR en materia de retenciones' },
    municipal: { encabezado: 'COMPROBANTE DE RETENCION DEL IMPUESTO DE ACTIVIDAD ECONOMICA', nota_legal: 'Ordenanza sobre Agente de Retencion de Impuesto de Actividades Economicas' },
    regional: { encabezado: 'COMPROBANTE DE RETENCION DE TIMBRE FISCAL ESTADAL', nota_legal: '' },
    igtf: { encabezado: 'COMPROBANTE DE PERCEPCION DE IGTF', nota_legal: 'Ley de Impuesto a las Grandes Transacciones Financieras' },
  };
  const base = t[tipo] ?? t.iva;
  const pie = tipo === 'iva'
    ? 'Este comprobante se emite segun lo establecido en la Providencia Administrativa SNAT/2025/000054 (G.O. N° 43.171). El numero no se reusa: una retencion anulada conserva el suyo.'
    : 'Comprobante de retencion. El numero no se reusa: una retencion anulada conserva el suyo.';
  return { encabezado: base.encabezado, nota_legal: base.nota_legal, pie };
}

export type SoportePapel = 'hoja_blanca_digital' | 'forma_libre_preimpresa';

/** Lo que una versión guardada trae (todo puede faltar: lo que falta es de fábrica). */
export interface FormatoParaAplicar {
  orientacion?: Orientacion | null;
  soportePapel?: SoportePapel | null;
  textos?: Record<string, unknown> | null;
  rotulos?: Record<string, unknown> | null;
  columnas?: unknown[] | null;
  deFabrica?: boolean;
}

export interface FormatoAplicado {
  orientacion: Orientacion;
  soportePapel: SoportePapel;
  textos: Record<ClaveTexto, string>;
  rotulos: Record<string, string>;
  /** Solo las visibles, en su orden. */
  columnas: ColumnaFormato[];
}

const textoDe = (v: unknown) => (typeof v === 'string' ? v : null);

/** Aplica una versión sobre el diseño de fábrica. Sin versión (o «de fábrica»), el de fábrica (horizontal). */
export function aplicarFormato(tipo: TipoImpuesto, f: FormatoParaAplicar | null | undefined): FormatoAplicado {
  const fabricaCols = columnasFabrica(tipo);
  const fabricaTextos = textosFabrica(tipo);
  if (!f || f.deFabrica) {
    return { orientacion: 'horizontal', soportePapel: 'hoja_blanca_digital', textos: fabricaTextos, rotulos: { ...ROTULOS_FABRICA }, columnas: fabricaCols };
  }
  const textos = { ...fabricaTextos };
  for (const k of CLAVES_TEXTO) { const v = textoDe(f.textos?.[k]); if (v != null) textos[k] = v; }
  const rotulos = { ...ROTULOS_FABRICA };
  for (const k of Object.keys(ROTULOS_FABRICA)) { const v = textoDe(f.rotulos?.[k]); if (v != null && v.trim()) rotulos[k] = v; }
  // Columnas: se toman las del formato que existan en el impuesto; las que el formato no nombra quedan como de fábrica.
  const delFormato = new Map<string, Partial<ColumnaFormato>>();
  for (const c of Array.isArray(f.columnas) ? f.columnas : []) {
    const x = c as Record<string, unknown>;
    if (typeof x?.campo === 'string') delFormato.set(x.campo, {
      rotulo: textoDe(x.rotulo) ?? undefined,
      visible: typeof x.visible === 'boolean' ? x.visible : undefined,
      orden: Number.isFinite(Number(x.orden)) ? Number(x.orden) : undefined,
      ancho: Number(x.ancho) > 0 ? Number(x.ancho) : null,
    });
  }
  const columnas = fabricaCols
    .map((c) => {
      const o = delFormato.get(c.campo);
      return o ? { ...c, rotulo: o.rotulo?.trim() || c.rotulo, visible: o.visible ?? c.visible, orden: o.orden ?? c.orden, ancho: o.ancho ?? null } : c;
    })
    .filter((c) => c.visible)
    .sort((a, b) => a.orden - b.orden);
  return {
    orientacion: f.orientacion === 'vertical' ? 'vertical' : 'horizontal',
    soportePapel: f.soportePapel === 'forma_libre_preimpresa' ? 'forma_libre_preimpresa' : 'hoja_blanca_digital',
    textos,
    rotulos,
    columnas: columnas.length ? columnas : fabricaCols,
  };
}

/** Lo que falta en una versión antes de guardarla; null si está bien. */
export function faltaEnFormato(v: { desde: string; motivo: string; columnas: ColumnaFormato[] }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.desde) || v.desde < '2000-01-01' || v.desde > '2100-12-31') return 'Indica desde qué fecha vale el formato (entre 2000 y 2100).';
  if (!v.motivo.trim()) return 'Indica el motivo: queda en el historial.';
  if (v.columnas.length && !v.columnas.some((c) => c.visible)) return 'Deja al menos una columna visible en la tabla.';
  for (const c of v.columnas) {
    if (c.visible && !c.rotulo.trim()) return `La columna «${c.campo}» necesita un rótulo.`;
    if (c.ancho != null && !(c.ancho > 0)) return `El ancho de la columna «${c.rotulo || c.campo}» tiene que ser mayor que 0 (o vacío).`;
  }
  return null;
}
