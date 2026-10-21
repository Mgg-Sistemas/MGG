/* ============================================================
   MGG · Compras · Cierre diario (capa de datos) · 21-10-2026
   Trae las cantidades del período y la actividad por analista
   (cotizaciones cargadas y órdenes finalizadas).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { PAGINA_SUPABASE, todasLasFilas } from '@/shared/lib/todasLasFilas';
import {
  armarCierre,
  fechaEntradaAprobacion,
  fechaEntradaPago,
  limitesISO,
  type AnalistaBase,
  type CotizacionAnalista,
  type OrdenFechas,
  type OrdenFinalizadaAnalista,
  type RangoCierre,
  type ResumenCierre,
} from './cierreDiario';

const TABLE = 'ordenes';

export async function cargarCierreDiario(rango: RangoCierre): Promise<ResumenCierre> {
  const { inicio, fin } = limitesISO(rango);
  const [pedidos, pagadas, aprobar, pagar, cotizaciones, finalizadas, usuarios] = await Promise.all([
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
    todasLasFilas<OrdenFechas>(
      (desde, hasta) =>
        supabase
          .from(TABLE)
          .select('id, estado, created_at, oc_creada_en')
          .eq('estado', 'oc_creada')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(desde, hasta),
      PAGINA_SUPABASE,
    ),
    todasLasFilas<OrdenFechas>(
      (desde, hasta) =>
        supabase
          .from(TABLE)
          .select('id, estado, created_at, oc_aprobada_en, metodo_pago_en, historial')
          .in('estado', ['confirmada_metodo', 'oc_aprobada'])
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(desde, hasta),
      PAGINA_SUPABASE,
    ),
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
      pendientesAprobar: aprobar.map(fechaEntradaAprobacion),
      porPagar: pagar.map(fechaEntradaPago),
      cotizaciones,
      finalizadas,
      analistasBase,
      nombresPorEmail,
    },
    rango,
  );
}
