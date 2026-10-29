/* ============================================================
   Golden Touch · Retenciones · Formatos de impresión (R8)

   retencion_formatos: versiones con fecha por impuesto y documento. Versión
   nueva = INSERT con un «desde» posterior al de la abierta (la base cierra la
   anterior); corregir la vigente = UPDATE con motivo; «volver a fábrica» =
   INSERT con de_fabrica (la base vacía el contenido). Sin DELETE. La vigente
   en una fecha la da retencion_formato_vigente; nada = de fábrica.
   Todo detrás de r8Disponible(): sin la tabla, la sección no se muestra.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';
import { faltaEnFormato, type ColumnaFormato, type FormatoParaAplicar, type Orientacion } from './formatoComprobante';

const T_FORMATOS = 'retencion_formatos';

export const r8Disponible = () => tablaDisponible(T_FORMATOS);

/** El único documento que hoy imprime con formato: el comprobante de retención. */
export const DOCUMENTO_COMPROBANTE = 'comprobante';

export interface FormatoGuardado extends FormatoParaAplicar {
  id: string;
  impuestoClave: string | null;
  documento: string;
  desde: string;
  hasta: string | null;
  orientacion: Orientacion;
  textos: Record<string, string> | null;
  rotulos: Record<string, string> | null;
  columnas: ColumnaFormato[] | null;
  deFabrica: boolean;
  motivo: string;
  fuente: string | null;
  actualizadoEn: string | null;
  actualizadoPor: string | null;
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function esColumnaInexistente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === '42703' || e.code === 'PGRST204') return true;
  return /column .* does not exist|could not find the .* column/i.test(e.message ?? '');
}

export function aFormato(r: Record<string, unknown>): FormatoGuardado {
  const def = (r.definicion && typeof r.definicion === 'object' ? r.definicion : {}) as Record<string, unknown>;
  const ori = r.orientacion ?? def.orientacion;
  const cols = r.columnas ?? def.columnas;
  return {
    id: String(r.id),
    impuestoClave: texto(r.impuesto_clave) ?? (r.impuesto != null ? String(r.impuesto).toUpperCase() : null),
    documento: String(r.documento ?? DOCUMENTO_COMPROBANTE),
    desde: String(r.desde ?? r.vigente_desde ?? ''),
    hasta: texto(r.hasta ?? r.vigente_hasta),
    orientacion: ori === 'horizontal' ? 'horizontal' : 'vertical',
    textos: ((r.textos ?? def.textos) as Record<string, string> | null) ?? null,
    rotulos: ((r.rotulos ?? def.rotulos) as Record<string, string> | null) ?? null,
    columnas: Array.isArray(cols) ? (cols as ColumnaFormato[]) : null,
    deFabrica: r.de_fabrica === true,
    motivo: String(r.motivo ?? ''),
    fuente: texto(r.fuente),
    actualizadoEn: texto(r.actualizado_en),
    actualizadoPor: texto(r.actualizado_por),
  };
}

/** Todas las versiones de los formatos (para la vigente y el historial), las más nuevas primero. */
export async function listFormatos(documento = DOCUMENTO_COMPROBANTE): Promise<FormatoGuardado[]> {
  const { data, error } = await supabase.from(T_FORMATOS).select('*').eq('documento', documento).order('desde', { ascending: false });
  if (error) {
    if (esColumnaInexistente(error)) {
      const alt = await supabase.from(T_FORMATOS).select('*').eq('documento', documento).order('vigente_desde', { ascending: false });
      if (alt.error) throw errorRetencion(alt.error, 'No se pudieron leer los formatos de impresión.');
      return (alt.data ?? []).map((r) => aFormato(r as Record<string, unknown>));
    }
    throw errorRetencion(error, 'No se pudieron leer los formatos de impresión.');
  }
  return (data ?? []).map((r) => aFormato(r as Record<string, unknown>));
}

/** La versión vigente en una fecha, o null (= de fábrica). */
export async function formatoVigente(impuestoClave: string | null, documento: string, fecha: string): Promise<FormatoGuardado | null> {
  const { data, error } = await supabase.rpc('retencion_formato_vigente', { p_impuesto: impuestoClave ?? '', p_documento: documento, p_fecha: fecha });
  if (error) throw errorRetencion(error, 'No se pudo leer el formato vigente.');
  const fila = Array.isArray(data) ? data[0] : data;
  return fila ? aFormato(fila as Record<string, unknown>) : null;
}

/**
 * El formato con que se imprime un comprobante: el vigente a la fecha del
 * comprobante; si para esa fecha no hay, el de hoy; sin R8 o sin versión, null (de fábrica).
 * Si la lectura falla, se imprime de fábrica: el comprobante no se frena por el formato.
 */
export async function formatoParaImprimir(impuestoClave: string, fechaComprobante: string | null, hoy: string): Promise<FormatoGuardado | null> {
  try {
    if (!(await r8Disponible())) return null;
    const fecha = fechaComprobante && FECHA.test(fechaComprobante.slice(0, 10)) ? fechaComprobante.slice(0, 10) : hoy;
    return (await formatoVigente(impuestoClave, DOCUMENTO_COMPROBANTE, fecha)) ?? (fecha !== hoy ? await formatoVigente(impuestoClave, DOCUMENTO_COMPROBANTE, hoy) : null);
  } catch {
    return null;
  }
}

export interface ContenidoFormato {
  orientacion: Orientacion;
  textos: Record<string, string>;
  rotulos: Record<string, string>;
  columnas: ColumnaFormato[];
  fuente?: string | null;
}

/** El contenido como lo guarda la base: textos y rótulos sin vacíos (vacío = de fábrica), columnas como lista. */
export function filaContenido(c: ContenidoFormato): Record<string, unknown> {
  const sinVacios = (o: Record<string, string>) => {
    const x = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    return Object.keys(x).length ? x : null;
  };
  return {
    orientacion: c.orientacion,
    textos: sinVacios(c.textos),
    rotulos: sinVacios(c.rotulos),
    columnas: c.columnas.length ? c.columnas.map((x) => ({ campo: x.campo, rotulo: x.rotulo.trim(), visible: x.visible, orden: x.orden, ancho: x.ancho ?? null })) : null,
    fuente: c.fuente?.trim() || null,
  };
}

const exigir = (data: unknown, que: string) => {
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(`No se guardó ${que}: sin permiso de escritura en Retenciones.`);
  return id;
};

/** Versión nueva desde una fecha (la base cierra la anterior el día antes). */
export async function nuevaVersionFormato(impuestoClave: string | null, documento: string, desde: string, motivo: string, c: ContenidoFormato): Promise<string> {
  const falta = faltaEnFormato({ desde, motivo, columnas: c.columnas });
  if (falta) throw new Error(falta);
  const cont = filaContenido(c);
  const { data, error } = await supabase.from(T_FORMATOS).insert({
    impuesto_clave: impuestoClave, documento, desde, motivo: motivo.trim(), ...cont,
  }).select('id');
  if (error) {
    if (esColumnaInexistente(error)) {
      const { fuente, ...def } = cont;
      const alt = await supabase.from(T_FORMATOS).insert({
        impuesto: (impuestoClave ?? 'iva').toLowerCase(),
        documento,
        vigente_desde: desde,
        motivo: motivo.trim(),
        fuente: fuente ?? null,
        de_fabrica: false,
        definicion: def,
      }).select('id');
      if (alt.error) throw errorRetencion(alt.error, 'No se pudo guardar la versión nueva del formato.');
      return exigir(alt.data, 'el formato');
    }
    throw errorRetencion(error, 'No se pudo guardar la versión nueva del formato.');
  }
  return exigir(data, 'el formato');
}

/** Corrige la versión vigente (no crea otra): cambia su contenido, con motivo. */
export async function corregirFormato(id: string, desde: string, motivo: string, c: ContenidoFormato): Promise<void> {
  const falta = faltaEnFormato({ desde, motivo, columnas: c.columnas });
  if (falta) throw new Error(falta);
  const cont = filaContenido(c);
  const { data, error } = await supabase.from(T_FORMATOS).update({ motivo: motivo.trim(), de_fabrica: false, ...cont }).eq('id', id).select('id');
  if (error) {
    if (esColumnaInexistente(error)) {
      const { fuente, ...def } = cont;
      const alt = await supabase.from(T_FORMATOS).update({
        motivo: motivo.trim(),
        fuente: fuente ?? null,
        de_fabrica: false,
        definicion: def,
      }).eq('id', id).select('id');
      if (alt.error) throw errorRetencion(alt.error, 'No se pudo corregir el formato.');
      exigir(alt.data, 'el formato');
      return;
    }
    throw errorRetencion(error, 'No se pudo corregir el formato.');
  }
  exigir(data, 'el formato');
}

/** Vuelve al diseño de fábrica desde una fecha (la base vacía el contenido). */
export async function volverAFabrica(impuestoClave: string | null, documento: string, desde: string, motivo: string): Promise<string> {
  const falta = faltaEnFormato({ desde, motivo, columnas: [] });
  if (falta) throw new Error(falta);
  const { data, error } = await supabase.from(T_FORMATOS).insert({
    impuesto_clave: impuestoClave, documento, desde, motivo: motivo.trim(), de_fabrica: true,
  }).select('id');
  if (error) {
    if (esColumnaInexistente(error)) {
      const alt = await supabase.from(T_FORMATOS).insert({
        impuesto: (impuestoClave ?? 'iva').toLowerCase(),
        documento,
        vigente_desde: desde,
        motivo: motivo.trim(),
        de_fabrica: true,
        definicion: {},
      }).select('id');
      if (alt.error) throw errorRetencion(alt.error, 'No se pudo volver al formato de fábrica.');
      return exigir(alt.data, 'el formato');
    }
    throw errorRetencion(error, 'No se pudo volver al formato de fábrica.');
  }
  return exigir(data, 'el formato');
}
