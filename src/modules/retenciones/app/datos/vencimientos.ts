/* ============================================================
   MGG · Retenciones v8 · Los avisos de vencimiento (datos)

   · retencion_avisos_vencimiento() (en espera, docs/sql/2026-10-20-v8-pantallas,
     v8p-05): las licencias de la empresa y de los proveedores, y las
     actividades de cada proveedor con fecha «hasta»;
   · los umbrales, del interruptor retenciones.avisos.umbrales
     ({"declaraciones": [7], "licencias": [30, 7], "actividades_hasta": [30]}).
   Las declaraciones salen de los períodos (datos/periodos.ts).
   Sin la función, la lista llega vacía (null) y el diálogo solo muestra
   las declaraciones.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';

export interface AvisoVencimiento {
  aviso: 'licencia_empresa' | 'licencia_proveedor' | 'actividad_proveedor';
  proveedorId: string | null;
  nombre: string;
  rif: string | null;
  detalle: string | null;
  vence: string;
}

export interface Umbrales { declaraciones: number; licencias: number; licenciasPronto: number; actividades: number }

export const UMBRALES_DEFECTO: Umbrales = { declaraciones: 7, licencias: 30, licenciasPronto: 7, actividades: 30 };

const entero = (v: unknown, defecto: number) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : defecto);

/** Lee los umbrales; lo que falte o no sea un entero ≥ 0, con el valor de la maqueta. */
export function leerUmbrales(valor: unknown): Umbrales {
  const v = (valor ?? {}) as { declaraciones?: unknown[]; licencias?: unknown[]; actividades_hasta?: unknown[] };
  return {
    declaraciones: entero(v.declaraciones?.[0], UMBRALES_DEFECTO.declaraciones),
    licencias: entero(v.licencias?.[0], UMBRALES_DEFECTO.licencias),
    licenciasPronto: entero(v.licencias?.[1], UMBRALES_DEFECTO.licenciasPronto),
    actividades: entero(v.actividades_hasta?.[0], UMBRALES_DEFECTO.actividades),
  };
}

export async function umbralesAvisos(): Promise<Umbrales> {
  try {
    const { data, error } = await supabase.from('retencion_interruptores').select('valor').eq('clave', 'retenciones.avisos.umbrales').maybeSingle();
    return error ? UMBRALES_DEFECTO : leerUmbrales((data as { valor?: unknown } | null)?.valor);
  } catch {
    return UMBRALES_DEFECTO;
  }
}

/** Las licencias y actividades con fecha; null si la base todavía no tiene la función. */
export async function listAvisosVencimiento(): Promise<AvisoVencimiento[] | null> {
  try {
    const { data, error } = await supabase.rpc('retencion_avisos_vencimiento');
    if (error) return null;
    return ((data ?? []) as Record<string, unknown>[]).filter((r) => r.vence).map((r) => ({
      aviso: r.aviso as AvisoVencimiento['aviso'], proveedorId: r.proveedor_id == null ? null : String(r.proveedor_id),
      nombre: String(r.nombre ?? '—'), rif: r.rif == null ? null : String(r.rif), detalle: r.detalle == null ? null : String(r.detalle),
      vence: String(r.vence).slice(0, 10),
    }));
  } catch {
    return null;
  }
}
