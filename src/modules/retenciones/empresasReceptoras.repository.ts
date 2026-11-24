/* ============================================================
   Golden Touch · Retenciones · Empresas receptoras (Multi-Empresa)

   Las empresas que reciben las facturas del buzón y su ficha fiscal
   (RIF, domicilio, municipio, licencia, régimen de agente IVA/ISLR).

   Todo se lee y se guarda en la base (retencion_empresas_receptoras):
   no hay empresas de fábrica ni copia en el navegador. Si la base no
   guarda, se avisa con el motivo.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { rifEmpresaParaGuardar } from '@/modules/libroFiscal/parametrosEmpresa';
import { errorRetencion } from '@/modules/libroFiscal/erroresRetencion';
import { columnaDisponible } from '@/modules/libroFiscal/disponibilidad';
import { errorPorcentajesIva } from '@/modules/libroFiscal/retencionesFiscal.repository';

const TABLA = 'retencion_empresas_receptoras';

/**
 * ¿La ficha de empresa trae ya los campos fiscales por empresa (F-ME1)? Se pregunta
 * por `pct_iva_especial`. Sin ellos, el editor fiscal por empresa se oculta y no se
 * intenta escribir esas columnas (degradación segura).
 */
export function fichaFiscalEmpresaDisponible(): Promise<boolean> {
  return columnaDisponible(TABLA, 'pct_iva_especial');
}

export interface EmpresaReceptora {
  id: string;
  clave: string;
  nombre: string;
  nombreCorto?: string;
  rif: string;
  colorBadge: string;
  activo: boolean;
  orden: number;

  // Ficha fiscal completa (para Retención / Impuestos)
  email?: string;
  telefono?: string;
  direccionFiscal?: string;
  municipio?: string;
  estado?: string;
  licenciaMunicipal?: string;

  // % y alícuotas de la empresa. El RÉGIMEN (qué retiene: IVA/ISLR/ISAE) NO vive acá:
  // su única fuente es L6 (Parámetros → Régimen), vía la RPC retencion_empresa_practica.
  // Los % los lee configDesdeFicha para una empresa NO-GT; su recorte definitivo es de D3.
  pctIvaGeneral?: number;
  /** % de retención de IVA al contribuyente especial (F-ME1, default 100). */
  pctIvaEspecial?: number;
  /** Alícuota del IGTF de la empresa (F-ME1, default 3). */
  pctIgtf?: number;
  /** Alícuota general del IVA para el desglose «IVA incluido» (F-ME1, default 16). */
  ivaAlicuota?: number;
  /** Alícuota del Impuesto Municipal (ISAE) de la empresa según su municipio (F-ME1, default = la global de hoy). */
  alicuotaMunicipal?: number;
  imprimirOriginalYCopia?: boolean;
}

export type EmpresaReceptoraInput = Omit<EmpresaReceptora, 'id' | 'clave' | 'orden'> & { id?: string; clave?: string; orden?: number };

const texto = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v));

function mapearFilaEmpresa(r: Record<string, unknown>, idx: number): EmpresaReceptora {
  return {
    id: String(r.id),
    clave: String(r.clave || r.id),
    nombre: String(r.nombre ?? ''),
    nombreCorto: texto(r.nombre_corto),
    rif: String(r.rif ?? ''),
    colorBadge: String(r.color_badge || '#64748b'),
    activo: r.activo !== false,
    orden: Number(r.orden ?? idx + 1),
    email: texto(r.email),
    telefono: texto(r.telefono),
    direccionFiscal: texto(r.direccion_fiscal),
    municipio: texto(r.municipio),
    estado: texto(r.estado),
    licenciaMunicipal: texto(r.licencia_municipal),
    pctIvaGeneral: r.pct_iva_general != null ? Number(r.pct_iva_general) : 75,
    // Los campos fiscales de F-ME1 quedan en undefined si la base no los trae todavía:
    // así el guardado no los escribe (no rompe pre-F-ME1) y la config cae en su default.
    pctIvaEspecial: r.pct_iva_especial != null ? Number(r.pct_iva_especial) : undefined,
    pctIgtf: r.pct_igtf != null ? Number(r.pct_igtf) : undefined,
    ivaAlicuota: r.iva_alicuota != null ? Number(r.iva_alicuota) : undefined,
    alicuotaMunicipal: r.alicuota_municipal != null ? Number(r.alicuota_municipal) : undefined,
    imprimirOriginalYCopia: r.imprimir_original_y_copia !== false,
  };
}

/** Las empresas guardadas en la base, en su orden. Sin empresas, la lista viene vacía. */
export async function listEmpresasReceptoras(): Promise<EmpresaReceptora[]> {
  const { data, error } = await supabase
    .from(TABLA)
    .select('*')
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) throw errorRetencion(error, 'No se pudieron leer las empresas.');
  return (data ?? []).map((r, idx) => mapearFilaEmpresa(r as Record<string, unknown>, idx));
}

/** La clave interna de la empresa, sacada de su nombre (no se muestra en pantalla). */
export function claveDeEmpresa(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

/** Qué falta o está mal en la ficha; null si se puede guardar. */
export function faltaEnEmpresa(empresa: EmpresaReceptoraInput): string | null {
  if (!empresa.nombre?.trim()) return 'Indica el nombre (razón social) de la empresa.';
  if (!String(empresa.rif ?? '').trim()) return 'Indica el RIF de la empresa.';
  if (empresa.nombre.trim().length > 200) return 'El nombre de la empresa va hasta 200 caracteres.';
  if ((empresa.nombreCorto?.trim().length ?? 0) > 60) return 'El nombre corto de la empresa va hasta 60 caracteres.';
  const rif = rifEmpresaParaGuardar(empresa.rif);
  if (rif.error) return rif.error;
  if (rif.rif.startsWith('C')) return 'El RIF de la empresa no puede empezar por C: letra J, G, V, E o P.';
  // Los % de retención de IVA y las alícuotas van de 0 a 100 (en pantalla el IVA se elige
  // entre 75 y 100; aquí se valida el rango por si llega otro valor).
  for (const [etq, v] of [
    ['de retención de IVA', empresa.pctIvaGeneral ?? 75],
    ['de retención de IVA al contribuyente especial', empresa.pctIvaEspecial],
    ['del IGTF', empresa.pctIgtf],
    ['general del IVA', empresa.ivaAlicuota],
    ['del ISAE (municipal)', empresa.alicuotaMunicipal],
  ] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0 || v > 100)) return `El % ${etq} va de 0 a 100.`;
  }
  if (empresa.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(empresa.email.trim())) return 'El correo de la empresa no es válido.';
  return null;
}

/**
 * Guarda una empresa nueva o los cambios de una existente.
 * Devuelve lo que quedó en la base.
 */
export async function guardarEmpresaReceptora(empresa: EmpresaReceptoraInput): Promise<EmpresaReceptora> {
  const falta = faltaEnEmpresa(empresa);
  if (falta) throw new Error(falta);
  // A2: el % de retención de IVA solo puede ser 75 o 100 (Providencia SNAT/2025/000054),
  // igual que la config de GT. El select de la UI ya lo protege; el repo lo cierra también.
  const faltaIva = errorPorcentajesIva({ pctIvaGeneral: empresa.pctIvaGeneral ?? 75, pctIvaEspecial: empresa.pctIvaEspecial ?? 100 });
  if (faltaIva) throw new Error(faltaIva);
  const nombre = empresa.nombre.trim();

  const filaBase = {
    clave: empresa.clave || claveDeEmpresa(empresa.nombreCorto || nombre) || `empresa_${Date.now()}`,
    nombre,
    nombre_corto: empresa.nombreCorto?.trim() || null,
    rif: rifEmpresaParaGuardar(empresa.rif).rif,
    color_badge: empresa.colorBadge || '#2563eb',
    activo: empresa.activo !== false,
    orden: empresa.orden ?? 10,
    email: empresa.email?.trim() || null,
    telefono: empresa.telefono?.trim() || null,
    direccion_fiscal: empresa.direccionFiscal?.trim() || null,
    municipio: empresa.municipio?.trim() || null,
    estado: empresa.estado?.trim() || null,
    licencia_municipal: empresa.licenciaMunicipal?.trim() || null,
  };

  // Lo por-empresa del comprobante que SÍ gobierna esta ficha: la alícuota municipal (ISAE)
  // y si imprime en Original y Copia. Se escriben solo si vienen definidos (presence-gate), así
  // el alta/edición de identidad en el buzón no los pisa. El RÉGIMEN (qué retiene) y los %
  // nacionales NO se escriben desde aquí: su fuente es L6 (Parámetros → Régimen) y R3
  // (Parámetros → Valores); el editor único nunca manda esos campos.
  const filaFiscal: Record<string, unknown> = {};
  if (empresa.alicuotaMunicipal !== undefined) filaFiscal.alicuota_municipal = empresa.alicuotaMunicipal;
  if (empresa.imprimirOriginalYCopia !== undefined) filaFiscal.imprimir_original_y_copia = empresa.imprimirOriginalYCopia;
  const fila = { ...filaBase, ...filaFiscal };

  const textos = { unico: 'Ya hay una empresa con ese nombre corto: usa otro.' };
  // El autor y las fechas los pone la base.
  const { data, error } = empresa.id
    ? await supabase.from(TABLA).update(fila).eq('id', empresa.id).select('*')
    : await supabase.from(TABLA).insert({ id: crypto.randomUUID(), ...fila }).select('*');
  if (error) throw errorRetencion(error, 'No se pudo guardar la empresa.', textos);
  const guardada = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!guardada) throw new Error('No se guardó la empresa: sin permiso para modificarla, o ya no existe.');
  return mapearFilaEmpresa(guardada, 0);
}

/** Borra una empresa sin facturas (con escritura en Retenciones). Con facturas cargadas, la base no la deja borrar: se desactiva. */
export async function eliminarEmpresaReceptora(id: string): Promise<void> {
  const { data, error } = await supabase.from(TABLA).delete().eq('id', id).select('id');
  if (error?.code === '23503') throw new Error('No se puede borrar: tiene facturas cargadas. Desactívala para que no aparezca al cargar.');
  if (error) throw errorRetencion(error, 'No se pudo borrar la empresa.');
  if (!data?.length) throw new Error('No se borró la empresa: sin permiso para borrarla, o ya no existe.');
}
