/* ============================================================
   MGG · Datos de pago del proveedor (por método)
   Guarda dónde pagarle a cada proveedor según el método: pago móvil,
   transferencia, zelle o binance. Se reutiliza en próximas compras.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { normalizarTelefono } from '@/shared/ui/datosPagoValidacion';

/** Métodos que requieren datos del proveedor para pagarle. */
export const METODOS_CON_DATOS = ['pago_movil', 'transferencia', 'zelle', 'binance_usdt'] as const;
export type MetodoConDatos = (typeof METODOS_CON_DATOS)[number];

export function requiereDatos(metodo: string): metodo is MetodoConDatos {
  return (METODOS_CON_DATOS as readonly string[]).includes(metodo);
}

/** Estructura libre por método (ver DatosPagoFields para los campos por método). */
export type DatosPago = Record<string, string>;

export interface ProveedorDatosPago {
  id: string;
  proveedor_id: string;
  metodo: string;
  datos: DatosPago;
  updated_at: string | null;
}

/** Todos los datos de pago guardados de un proveedor (por método). */
export async function listDatosPago(proveedorId: string): Promise<Record<string, DatosPago>> {
  if (!proveedorId) return {};
  const { data, error } = await supabase
    .from('proveedor_datos_pago')
    .select('metodo, datos')
    .eq('proveedor_id', proveedorId);
  if (error) throw error;
  const out: Record<string, DatosPago> = {};
  for (const r of (data ?? []) as Array<{ metodo: string; datos: DatosPago }>) out[r.metodo] = r.datos ?? {};
  return out;
}

/** Crea o actualiza los datos de pago de un proveedor para un método. */
export async function guardarDatosPago(
  proveedorId: string,
  metodo: string,
  datos: DatosPago,
  actor?: string,
): Promise<void> {
  if (!proveedorId || !requiereDatos(metodo)) return;
  const limpio: DatosPago = {};
  for (const [k, v] of Object.entries(datos ?? {})) {
    const s = String(v ?? '').trim();
    // El teléfono se guarda SIEMPRE en la forma local (0424…), venga escrito
    // como venga: en la base no pueden convivir «04249692172» y «584249692172»
    // para el mismo número, o cualquier comparación posterior falla.
    if (s) limpio[k] = k === 'telefono' ? normalizarTelefono(s) : s;
  }
  if (!Object.keys(limpio).length) return;
  const { error } = await supabase.from('proveedor_datos_pago').upsert(
    { proveedor_id: proveedorId, metodo, datos: limpio, updated_at: new Date().toISOString(), actor: actor ?? null },
    { onConflict: 'proveedor_id,metodo' },
  );
  if (error) throw error;
}
