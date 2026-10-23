/* ============================================================
   MGG · Retenciones v8 · Los interruptores que la pantalla lee

   `retencion_interruptores` (paquete R0, aplicado en producción): clave y
   valor jsonb. La pantalla solo LEE; se encienden y apagan desde la base o
   desde Parámetros cuando exista esa sección.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';

/** Encendido = true, «encendido», «si» o «sí» (sin distinguir mayúsculas). */
export function estaEncendido(valor: unknown): boolean {
  if (valor === true) return true;
  return typeof valor === 'string' && ['encendido', 'si', 'sí', 'true'].includes(valor.trim().toLowerCase());
}

/**
 * Lee un interruptor. Si la tabla no existe, la fila no está o la lectura
 * falla, devuelve false: lo nuevo queda apagado, nunca encendido por error.
 */
export async function interruptorEncendido(clave: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('retencion_interruptores').select('valor').eq('clave', clave).maybeSingle();
    if (error || !data) return false;
    return estaEncendido((data as { valor: unknown }).valor);
  } catch {
    return false;
  }
}
