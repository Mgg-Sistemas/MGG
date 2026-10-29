/* ============================================================
   Golden Touch · Retenciones · Régimen de la empresa por impuesto (R1)

   Si la empresa es agente de retención o de percepción de un impuesto, y si
   es contribuyente especial (de la empresa, sin impuesto), con vigencia desde
   una fecha. El Régimen escribe SOLO aquí: mientras conviva con el JSON de
   Parámetros, la base copia el valor vigente hoy a ese JSON. El trigger del
   régimen lee la condición a la fecha de cada retención.
   Depende del paquete R1; no se monta en pantalla hasta que BD lo confirme.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ClaveImpuesto } from './entes.repository';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';

const T_CONDICIONES = 'retencion_agente_condiciones';

export type CondicionAgente = 'agente_retencion' | 'agente_percepcion' | 'contribuyente_especial';

export const CONDICIONES: { key: CondicionAgente; label: string; porImpuesto: boolean }[] = [
  { key: 'agente_retencion', label: 'Agente de retención', porImpuesto: true },
  { key: 'agente_percepcion', label: 'Agente de percepción', porImpuesto: true },
  { key: 'contribuyente_especial', label: 'Contribuyente especial', porImpuesto: false },
];

export interface CondicionRegistrada {
  id: string;
  impuestoClave: ClaveImpuesto | null;
  condicion: CondicionAgente;
  valor: boolean;
  desde: string;
  hasta: string | null;
  motivo: string;
  fuente: string | null;
  actualizadoEn: string | null;
  actualizadoPor: string | null;
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function aCondicion(r: Record<string, unknown>): CondicionRegistrada {
  return {
    id: String(r.id), impuestoClave: texto(r.impuesto_clave) as ClaveImpuesto | null,
    condicion: r.condicion as CondicionAgente, valor: r.valor === true,
    desde: String(r.desde ?? ''), hasta: texto(r.hasta), motivo: String(r.motivo ?? ''), fuente: texto(r.fuente),
    actualizadoEn: texto(r.actualizado_en), actualizadoPor: texto(r.actualizado_por),
  };
}

/** El valor vigente en una fecha, de una lista (igual que retencion_agente_condicion, sin la vuelta al JSON). */
export function condicionVigente(xs: CondicionRegistrada[], impuesto: ClaveImpuesto | null, condicion: CondicionAgente, fecha: string): CondicionRegistrada | null {
  return xs.filter((c) => c.impuestoClave === impuesto && c.condicion === condicion
    && c.desde <= fecha && (!c.hasta || c.hasta >= fecha))
    .sort((a, b) => b.desde.localeCompare(a.desde))[0] ?? null;
}

/** El historial completo, el más nuevo primero. */
export async function listCondiciones(): Promise<CondicionRegistrada[]> {
  if (!(await tablaDisponible(T_CONDICIONES))) return [];
  const { data, error } = await supabase.from(T_CONDICIONES).select('*').order('desde', { ascending: false });
  if (error) throw errorRetencion(error, 'No se pudo leer el régimen de la empresa.');
  return (data ?? []).map((r) => aCondicion(r as Record<string, unknown>));
}

/** Lo que dice la base para un impuesto, una condición y una fecha (con la vuelta al JSON mientras convivan). */
export async function consultarCondicion(impuesto: ClaveImpuesto | null, condicion: CondicionAgente, fecha: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('retencion_agente_condicion', { p_impuesto: impuesto, p_condicion: condicion, p_fecha: fecha });
  if (error) throw errorRetencion(error, 'No se pudo consultar el régimen de la empresa.');
  return data === true;
}

export interface CondicionNueva {
  /** null solo para «contribuyente especial», que es de la empresa. */
  impuestoClave: ClaveImpuesto | null;
  condicion: CondicionAgente;
  valor: boolean;
  desde: string;
  hasta?: string | null;
  motivo: string;
  /** Providencia o acto que designa. */
  fuente?: string | null;
}

export function faltaEnCondicion(c: CondicionNueva): string | null {
  if (!CONDICIONES.some((x) => x.key === c.condicion)) return 'La condición es agente de retención, agente de percepción o contribuyente especial.';
  const porImpuesto = c.condicion !== 'contribuyente_especial';
  if (porImpuesto && !c.impuestoClave) return 'Indica el impuesto de esa condición.';
  if (!porImpuesto && c.impuestoClave) return 'Contribuyente especial es de la empresa, no de un impuesto.';
  if (!FECHA.test(c.desde)) return 'Indica desde qué fecha vale.';
  if (c.hasta && (!FECHA.test(c.hasta) || c.hasta < c.desde)) return 'La fecha «hasta» no puede ser anterior a «desde».';
  if (!c.motivo.trim()) return 'Indica el motivo: queda en el historial del régimen.';
  return null;
}

/** Registra un cambio del régimen desde una fecha. No se edita lo anterior: queda en el historial. */
export async function registrarCondicion(c: CondicionNueva): Promise<string> {
  const falta = faltaEnCondicion(c);
  if (falta) throw new Error(falta);
  const { data, error } = await supabase.from(T_CONDICIONES).insert({
    impuesto_clave: c.condicion === 'contribuyente_especial' ? null : c.impuestoClave,
    condicion: c.condicion, valor: c.valor, desde: c.desde, hasta: c.hasta || null,
    motivo: c.motivo.trim(), fuente: c.fuente?.trim() || null,
  }).select('id');
  if (error) {
    throw errorRetencion(error, 'No se pudo guardar el régimen.', {
      unico: 'Ya hay un cambio de esa condición que empieza en esa fecha: elige otra fecha.',
      regla: 'Revisa el régimen: «especial» va sin impuesto; agente de retención o de percepción, con su impuesto.',
    });
  }
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error('No se guardó el régimen: sin permiso de escritura en Retenciones.');
  return id;
}

/**
 * Fecha más antigua desde la cual la empresa fue designada como agente de retención (IVA o especial).
 * Si no hay registros en retencion_agente_condiciones, devuelve el fallback '2026-10-01'.
 */
export async function fechaDesdeAgenteRetencion(): Promise<string> {
  try {
    const list = await listCondiciones();
    const agentes = list.filter((c) => c.valor && (
      c.condicion === 'contribuyente_especial' || (c.condicion === 'agente_retencion' && (c.impuestoClave === 'IVA' || !c.impuestoClave))
    ));
    if (agentes.length > 0) {
      agentes.sort((a, b) => a.desde.localeCompare(b.desde));
      return agentes[0].desde;
    }
  } catch {
    // Si no está disponible o falla la red
  }
  return '2026-10-01';
}

/** Comprueba si en una fecha dada la empresa retenía IVA (por ser agente de retención o contribuyente especial). */
export function empresaEsAgenteEnFecha(xs: CondicionRegistrada[], fecha: string, impuesto: ClaveImpuesto = 'IVA'): boolean {
  if (!xs || xs.length === 0) return false;
  const vImp = condicionVigente(xs, impuesto, 'agente_retencion', fecha);
  const vEsp = condicionVigente(xs, null, 'contribuyente_especial', fecha);
  return (vImp?.valor === true) || (vEsp?.valor === true);
}

/** Modifica un registro existente del historial del régimen (por ejemplo, corregir la fecha desde). */
export async function actualizarCondicion(id: string, c: Partial<CondicionNueva>): Promise<void> {
  const updateData: Record<string, unknown> = {};
  if (c.desde !== undefined) {
    if (!FECHA.test(c.desde)) throw new Error('Indica una fecha válida (AAAA-MM-DD).');
    updateData.desde = c.desde;
  }
  if (c.hasta !== undefined) updateData.hasta = c.hasta || null;
  if (c.valor !== undefined) updateData.valor = c.valor;
  if (c.motivo !== undefined) updateData.motivo = c.motivo.trim();
  if (c.fuente !== undefined) updateData.fuente = c.fuente?.trim() || null;
  if (c.impuestoClave !== undefined) updateData.impuesto_clave = c.impuestoClave;
  if (c.condicion !== undefined) updateData.condicion = c.condicion;

  const { data, error } = await supabase.from(T_CONDICIONES).update(updateData).eq('id', id).select('id');
  if (error) {
    throw errorRetencion(error, 'No se pudo actualizar el registro del régimen.', {
      unico: 'Ya hay un registro con esa misma fecha de inicio.',
    });
  }
  if (!data?.length) throw new Error('No se guardó el cambio del régimen: sin permiso de escritura en Retenciones, o ya no existe.');
}

/** Elimina un registro del régimen. */
export async function eliminarCondicion(id: string): Promise<void> {
  const { data, error } = await supabase.from(T_CONDICIONES).delete().eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo eliminar el registro del régimen.');
  if (!data?.length) throw new Error('No se eliminó el registro del régimen: sin permiso de escritura en Retenciones, o ya no existe.');
}
