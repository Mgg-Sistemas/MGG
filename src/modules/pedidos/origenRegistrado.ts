/* ============================================================
   Golden Touch · Compras · ¿El origen tiene una factura registrada? (P03)

   Una OC, compra directa o servicio directo con una factura registrada en
   Retenciones no se borra: la base lo frena (RET_ORIGEN_CON_DOCUMENTO).
   Como el borrado de una OC o de una compra revierte antes dinero e
   inventario, se pregunta ANTES de tocar nada; el error de la base queda
   de respaldo (carrera) y se traduce igual. Sin P03, no cambia nada.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { p03Disponible } from '@/modules/libroFiscal/disponibilidad';

export const TEXTO_ORIGEN_CON_DOCUMENTO =
  'No se puede eliminar: tiene una factura registrada en Retenciones. Primero hay que borrar ese documento fiscal (solo si no tiene retenciones).';

export type ColumnaOrigen = 'orden_id' | 'compra_directa_id' | 'servicio_directo_id';

/** El error de borrar un origen, con el texto de pantalla si es RET_ORIGEN_CON_DOCUMENTO. */
export function errorBorrarOrigen(e: unknown): unknown {
  const m = String((e as { message?: string } | null)?.message ?? '');
  return /RET_ORIGEN_CON_DOCUMENTO/.test(m) ? new Error(TEXTO_ORIGEN_CON_DOCUMENTO) : e;
}

/** Con P03: si el origen tiene una factura registrada, se detiene antes de revertir nada. */
export async function exigirSinFacturaRegistrada(columna: ColumnaOrigen, id: string): Promise<void> {
  if (!(await p03Disponible())) return;
  const { data, error } = await supabase.from('retencion_documento_origenes').select('id').eq(columna, id).limit(1);
  if (error) throw new Error(`No se pudo comprobar si tiene facturas registradas en Retenciones: ${error.message}`);
  if (data?.length) throw new Error(TEXTO_ORIGEN_CON_DOCUMENTO);
}
