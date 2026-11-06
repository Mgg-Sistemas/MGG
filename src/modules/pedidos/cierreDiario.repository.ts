/* ============================================================
   MGG · Compras · Cierre diario (capa de datos) · 21-10-2026
   Trae las cantidades del período y la actividad por analista
   (cotizaciones cargadas y órdenes finalizadas).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { PAGINA_SUPABASE, todasLasFilas } from '@/shared/lib/todasLasFilas';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import { listOrdenesPorPagar } from './pedidos.repository';
import {
  armarCierre,
  fechaEntradaPago,
  limitesISO,
  type AnalistaBase,
  type CotizacionAnalista,
  type OrdenFinalizadaAnalista,
  type RangoCierre,
  type ResumenCierre,
} from './cierreDiario';

const TABLE = 'ordenes';

export async function cargarCierreDiario(rango: RangoCierre): Promise<ResumenCierre> {
  const { inicio, fin } = limitesISO(rango);
  const [pedidos, pagadas, pagar, tasaHoy, cotizaciones, finalizadas, usuarios] = await Promise.all([
    // Solicitudes creadas en el período (las sub-OC cuelgan de su pedido: no se cuentan aparte).
    supabase
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .is('parent_orden_id', null)
      .gte('created_at', inicio)
      .lte('created_at', fin),
    // Órdenes pagadas en el período (una anulada ya no cuenta).
    supabase
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .gte('pagada_en', inicio)
      .lte('pagada_en', fin)
      .neq('estado', 'anulada'),
    // OC por pagar (confirmadas o ya en Tesorería, sin pagar): con proveedor y monto a pagar,
    // para contarlas y para el detalle del cierre (una sola lista: nunca se descuadran).
    listOrdenesPorPagar(),
    // Tasa BCV del día: solo para pasar a $ las OC que estén en bolívares.
    getTasaHoy().catch(() => null),
    // Cotizaciones cargadas / realizadas en el período
    todasLasFilas<CotizacionAnalista>(
      (desde, hasta) =>
        supabase
          .from('ofertas_proveedor')
          .select('id, registrada_por_email, registrada_en')
          .gte('registrada_en', inicio)
          .lte('registrada_en', fin)
          .order('registrada_en', { ascending: true })
          .order('id', { ascending: true })
          .range(desde, hasta),
      PAGINA_SUPABASE,
    ).catch(() => [] as CotizacionAnalista[]),
    // Órdenes finalizadas en el período
    todasLasFilas<OrdenFinalizadaAnalista>(
      (desde, hasta) =>
        supabase
          .from(TABLE)
          .select('id, finalizada_por, finalizada_en')
          .eq('estado', 'finalizada')
          .gte('finalizada_en', inicio)
          .lte('finalizada_en', fin)
          .order('finalizada_en', { ascending: true })
          .order('id', { ascending: true })
          .range(desde, hasta),
      PAGINA_SUPABASE,
    ).catch(() => [] as OrdenFinalizadaAnalista[]),
    // Usuarios del sistema para resolver nombres y listar analistas base
    supabase
      .from('usuarios')
      .select('email, nombre, apellido, role, estado'),
  ]);

  if (pedidos.error) throw pedidos.error;
  if (pagadas.error) throw pagadas.error;

  const usuariosData = (usuarios.data ?? []) as {
    email?: string;
    nombre?: string;
    apellido?: string;
    role?: string;
    estado?: string;
  }[];

  const nombresPorEmail = new Map<string, string>();
  const analistasBase: AnalistaBase[] = [];

  usuariosData.forEach((u) => {
    const em = (u.email ?? '').trim().toLowerCase();
    if (!em) return;
    const nom = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || u.nombre || em;
    nombresPorEmail.set(em, nom);
    if (u.role === 'analista' && u.estado !== 'inactivo') {
      analistasBase.push({ email: em, nombre: nom });
    }
  });

  return armarCierre(
    {
      pedidos: pedidos.count ?? 0,
      pagadas: pagadas.count ?? 0,
      porPagar: pagar.map((p) => fechaEntradaPago(p.orden)),
      porPagarOc: pagar.map((p) => ({
        codigo: p.orden.oc_codigo ?? p.orden.codigo,
        proveedor: p.proveedorNombre,
        monto: p.montoAPagar,
        moneda: p.orden.moneda,
        entrada: fechaEntradaPago(p.orden),
      })),
      tasa: Number(tasaHoy?.usd) || 0,
      cotizaciones,
      finalizadas,
      analistasBase,
      nombresPorEmail,
    },
    rango,
  );
}
