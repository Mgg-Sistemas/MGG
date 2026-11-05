/* ============================================================
   MGG · Cocina · Histórico de distribución — lectura (05-11-2026)
   Los repartos son traslados de Salidas con motivo «Reparto del mercado #…».
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { leerMotivoReparto, type RepartoHist } from './repartoHistorico';

interface Fila {
  id: string; codigo: string | null; estado: string; motivo: string | null; created_at: string; ejecutada_en: string | null;
  actor: string | null; actor_name: string | null; almacen_destino: string | null;
  items: { producto_nombre?: string | null; cantidad?: number | null; unidad?: string | null; precio_unit?: number | null }[] | null;
  producto_nombre: string | null; cantidad: number | null; precio_unit: number | null;
}

/** Los repartos entre cocinas y resguardo del rango (fechas AAAA-MM-DD, hora de Venezuela), del más nuevo al más viejo. */
export async function listHistoricoRepartos(desde: string, hasta: string): Promise<RepartoHist[]> {
  const filas = await todasLasFilas<Fila>((d, h) => supabase.from('solicitudes_salida')
    .select('id, codigo, estado, motivo, created_at, ejecutada_en, actor, actor_name, almacen_destino, items, producto_nombre, cantidad, precio_unit')
    .eq('scope', 'traslado')
    .ilike('motivo', 'Reparto del mercado #%')
    .gte('created_at', `${desde}T00:00:00-04:00`).lte('created_at', `${hasta}T23:59:59-04:00`)
    .order('created_at', { ascending: false })
    .range(d, h));
  const out: RepartoHist[] = [];
  for (const f of filas) {
    const m = leerMotivoReparto(f.motivo);
    if (!m) continue;
    const items = Array.isArray(f.items) && f.items.length
      ? f.items
      : [{ producto_nombre: f.producto_nombre, cantidad: f.cantidad, unidad: null, precio_unit: f.precio_unit }];
    out.push({
      id: f.id, codigo: f.codigo ?? '—', estado: f.estado, fecha: f.created_at, ejecutadaEn: f.ejecutada_en,
      mercado: m.mercado, origen: m.origen, destino: m.destino, nota: m.nota,
      quien: f.actor_name || f.actor,
      lineas: items.map((i) => ({
        nombre: i.producto_nombre ?? '—', cantidad: Number(i.cantidad) || 0, unidad: i.unidad ?? null,
        precio: i.precio_unit != null ? Number(i.precio_unit) : null,
      })),
    });
  }
  return out;
}
