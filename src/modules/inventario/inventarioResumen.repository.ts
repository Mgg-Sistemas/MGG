/* ============================================================
   MGG · Inventario · Resumen de actividad (Supabase)
   Agrega los movimientos del kardex en un período: productos
   nuevos que entraron, salidas y traslados (cantidad + $).
   El desglose por almacén/subalmacén se calcula en el front
   desde existencias (foto actual del stock).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface ResumenMovItem {
  producto_id: string;
  sku: string | null;
  nombre: string | null;
  unidad: string | null;
  cantidad: number;
  valor: number;
  almacen: string | null;
  destino: string | null;
  at: string;
}

export interface ResumenGrupo {
  count: number;
  total: number;
  items: ResumenMovItem[];
}

export interface ResumenInventarioMovs {
  desde: string;
  hasta: string;
  nuevos: ResumenGrupo;    // altas de producto (tipo='creacion')
  salidas: ResumenGrupo;   // ref_tipo='salida_modulo'
  traslados: ResumenGrupo; // ref_tipo='traslado_modulo' (lado salida)
}

interface MovRow {
  producto_id: string;
  tipo: string;
  ref_tipo: string | null;
  delta: number;
  precio_unitario: number | null;
  costo_promedio: number | null;
  almacen: string | null;
  destino: string | null;
  at: string;
  producto?: { sku?: string | null; nombre?: string | null; unidad?: string | null } | null;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function toItem(m: MovRow): ResumenMovItem {
  const cantidad = Math.abs(Number(m.delta) || 0);
  const precio = Number(m.precio_unitario) || Number(m.costo_promedio) || 0;
  return {
    producto_id: m.producto_id,
    sku: m.producto?.sku ?? null,
    nombre: m.producto?.nombre ?? null,
    unidad: m.producto?.unidad ?? null,
    cantidad,
    valor: round2(cantidad * precio),
    almacen: m.almacen ?? null,
    destino: m.destino ?? null,
    at: m.at,
  };
}

/**
 * Resumen de movimientos del kardex entre dos fechas (inclusive).
 * `desde`/`hasta` en formato YYYY-MM-DD (se cubre todo el día de `hasta`).
 */
export async function resumenInventarioMovs(desde: string, hasta: string): Promise<ResumenInventarioMovs> {
  const desdeISO = `${desde}T00:00:00`;
  const hastaISO = `${hasta}T23:59:59.999`;
  const { data, error } = await supabase
    .from('movimientos')
    .select('producto_id, tipo, ref_tipo, delta, precio_unitario, costo_promedio, almacen, destino, at, producto:productos(sku, nombre, unidad)')
    .gte('at', desdeISO)
    .lte('at', hastaISO)
    .order('at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as MovRow[];

  const nuevos: ResumenGrupo = { count: 0, total: 0, items: [] };
  const salidas: ResumenGrupo = { count: 0, total: 0, items: [] };
  const traslados: ResumenGrupo = { count: 0, total: 0, items: [] };

  for (const m of rows) {
    if (m.tipo === 'creacion') {
      const it = toItem(m);
      nuevos.items.push(it); nuevos.count += 1; nuevos.total += it.valor;
    } else if (m.ref_tipo === 'salida_modulo') {
      const it = toItem(m);
      salidas.items.push(it); salidas.count += 1; salidas.total += it.valor;
    } else if (m.ref_tipo === 'traslado_modulo' && (Number(m.delta) || 0) < 0) {
      const it = toItem(m);
      traslados.items.push(it); traslados.count += 1; traslados.total += it.valor;
    }
  }
  nuevos.total = round2(nuevos.total);
  salidas.total = round2(salidas.total);
  traslados.total = round2(traslados.total);
  return { desde, hasta, nuevos, salidas, traslados };
}
