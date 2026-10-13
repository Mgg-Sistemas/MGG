/* ============================================================
   MGG · Pedidos · Solicitudes de servicio casadas a un equipo

   Lo que Control de Maquinaria (Flota y Servicio, traído de Golden Touch el
   13-10) necesita de Pedidos: las órdenes de clase 'servicio' que tienen al
   menos un renglón con el `equipo_id` del equipo. Sirve para el seguimiento
   desde el expediente y la bitácora: ver qué mantenimientos se pidieron.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

/** Una solicitud / orden de servicio de Pedidos casada a un equipo de Maquinaria. */
export interface ServicioDeEquipo {
  id: string;
  codigo: string;
  oc_codigo: string | null;
  estado: string;
  total: number | null;
  created_at: string;
  /** Ítems de servicio de ESTE equipo (tipo de servicio + cantidad + el repuesto
   *  del inventario que llevó, si se declaró). */
  servicios: {
    nombre: string;
    cantidad: number;
    insumoProductoId: string | null;
    insumoNombre: string | null;
    /** Se declaró expresamente que el servicio NO lleva repuesto (mano de obra). */
    sinInsumo: boolean;
  }[];
}

/**
 * Órdenes de Pedidos de clase 'servicio' con al menos un renglón casado al equipo.
 * En MGG el renglón de servicio guarda `equipo_id`, `nombre` y `cantidad`; el
 * repuesto usado se lleva en la bitácora del equipo, así que acá queda «sin declarar».
 */
export async function listServiciosDeEquipo(equipoId: string): Promise<ServicioDeEquipo[]> {
  if (!equipoId) return [];
  const { data, error } = await supabase
    .from('ordenes')
    .select('id, codigo, oc_codigo, estado, total, created_at, items')
    .eq('clase', 'servicio')
    .contains('items', JSON.stringify([{ equipo_id: equipoId }]))
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((o) => {
    const items = (Array.isArray(o.items) ? o.items : []) as Array<{
      nombre?: string; cantidad?: number; equipo_id?: string | null;
      insumo_producto_id?: string | null; insumo_nombre?: string | null; sin_insumo?: boolean | null;
    }>;
    return {
      id: o.id as string,
      codigo: o.codigo as string,
      oc_codigo: (o.oc_codigo as string | null) ?? null,
      estado: o.estado as string,
      total: o.total != null ? Number(o.total) : null,
      created_at: o.created_at as string,
      servicios: items.filter((it) => it.equipo_id === equipoId).map((it) => ({
        nombre: it.nombre ?? '—',
        cantidad: Number(it.cantidad) || 0,
        insumoProductoId: it.insumo_producto_id || null,
        insumoNombre: (it.insumo_nombre ?? '').trim() || null,
        sinInsumo: it.sin_insumo === true,
      })),
    };
  });
}
