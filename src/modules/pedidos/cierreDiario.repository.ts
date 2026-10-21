/* ============================================================
   MGG · Compras · Cierre diario (capa de datos) · 21-10-2026
   Trae las cuatro cantidades del período. Pedidos y pagadas se CUENTAN en la base
   (no se bajan las filas); las pendientes por aprobar y por pagar son pocas y se
   leen por páginas para ubicar la fecha en que entró cada una (Supabase corta en
   1.000 filas sin avisar). Las reglas de cada cantidad están en `cierreDiario.ts`.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { PAGINA_SUPABASE, todasLasFilas } from '@/shared/lib/todasLasFilas';
import {
  armarCierre, fechaEntradaAprobacion, fechaEntradaPago, limitesISO,
  type OrdenFechas, type RangoCierre, type ResumenCierre,
} from './cierreDiario';

const TABLE = 'ordenes';

export async function cargarCierreDiario(rango: RangoCierre): Promise<ResumenCierre> {
  const { inicio, fin } = limitesISO(rango);
  const [pedidos, pagadas, aprobar, pagar] = await Promise.all([
    // Solicitudes creadas en el período (las sub-OC cuelgan de su pedido: no se cuentan aparte).
    supabase.from(TABLE).select('id', { count: 'exact', head: true })
      .is('parent_orden_id', null).gte('created_at', inicio).lte('created_at', fin),
    // Órdenes pagadas en el período (una anulada ya no cuenta).
    supabase.from(TABLE).select('id', { count: 'exact', head: true })
      .gte('pagada_en', inicio).lte('pagada_en', fin).neq('estado', 'anulada'),
    todasLasFilas<OrdenFechas>((desde, hasta) =>
      supabase.from(TABLE).select('id, estado, created_at, oc_creada_en').eq('estado', 'oc_creada')
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(desde, hasta), PAGINA_SUPABASE),
    todasLasFilas<OrdenFechas>((desde, hasta) =>
      supabase.from(TABLE).select('id, estado, created_at, oc_aprobada_en, metodo_pago_en, historial').in('estado', ['confirmada_metodo', 'oc_aprobada'])
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(desde, hasta), PAGINA_SUPABASE),
  ]);
  if (pedidos.error) throw pedidos.error;
  if (pagadas.error) throw pagadas.error;
  return armarCierre({
    pedidos: pedidos.count ?? 0,
    pagadas: pagadas.count ?? 0,
    pendientesAprobar: aprobar.map(fechaEntradaAprobacion),
    porPagar: pagar.map(fechaEntradaPago),
  }, rango);
}
