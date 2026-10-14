/* ============================================================
   MGG · Proveedores · Número de administración del proveedor (14-10-2026)
   El número con el que la administración del proveedor identifica sus cobros a
   MGG. Se pide la primera vez al indicar el método de pago de una OC y queda en
   la ficha; se guarda por RPC para que alcance con el permiso de Pedidos.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export async function fijarNumeroAdministracionProveedor(proveedorId: string, numero: string | null): Promise<void> {
  const { error } = await supabase.rpc('proveedor_fijar_numero_administracion', { p_proveedor: proveedorId, p_numero: numero?.trim() || null });
  if (error) throw new Error(error.message);
}
