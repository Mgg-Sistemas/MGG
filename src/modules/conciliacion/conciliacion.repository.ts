/* ============================================================
   MGG · Conciliación · lectura de datos (12-11-2026)
   Solo LEE: OC (Compras), proveedores, tasas BCV del día de pago
   (Tesorería) y comprobantes de retención (libro fiscal).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Orden } from '@/shared/lib/types';
import { diaVE, getTasaHoy, getTasasUsdDeFechas } from '@/modules/tesoreria/tasas.repository';
import { listRetenciones } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { cantidadFacturas } from '@/modules/pedidos/facturasOrden.repository';
import { armarFila, ordenesConciliables, type FilaConciliacion, type RetencionFiscalOc } from './conciliacion';

export interface DatosConciliacion {
  filas: FilaConciliacion[];
  ordenes: Map<string, Orden>;
  tasaHoy: number | null;
  /** false si el libro fiscal no se pudo leer (permisos): los N° de retención no salen. */
  conLibroFiscal: boolean;
}

async function nombresProveedores(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  for (let i = 0; i < unicos.length; i += 300) {
    const { data, error } = await supabase.from('proveedores').select('id, razon_social').in('id', unicos.slice(i, i + 300));
    if (error) throw error;
    for (const p of (data ?? []) as Array<{ id: string; razon_social: string | null }>) out.set(p.id, p.razon_social ?? '');
  }
  return out;
}

async function retencionesFiscalesPorOrden(): Promise<Map<string, RetencionFiscalOc[]> | null> {
  try {
    const rs = await listRetenciones({ direccion: 'practicada' });
    const out = new Map<string, RetencionFiscalOc[]>();
    for (const r of rs) {
      if (!r.docId || r.anulada) continue;
      const l = out.get(r.docId) ?? [];
      l.push({ tipo: r.tipo, numero: r.numeroComprobante ?? null });
      out.set(r.docId, l);
    }
    return out;
  } catch {
    return null; // sin permiso al libro fiscal: la retención sale igual, sin el N°
  }
}

export async function cargarConciliacion(): Promise<DatosConciliacion> {
  const [ordenesRaw, hoy, fiscales] = await Promise.all([
    todasLasFilas<Orden>((d, h) => supabase.from('ordenes').select('*').not('oc_codigo', 'is', null)
      .order('oc_creada_en', { ascending: false, nullsFirst: false }).order('id').range(d, h)),
    getTasaHoy().catch(() => null),
    retencionesFiscalesPorOrden(),
  ]);
  const ordenes = ordenesConciliables(ordenesRaw);
  const [proveedores, tasas] = await Promise.all([
    nombresProveedores(ordenes.map((o) => o.proveedor_id ?? '')),
    getTasasUsdDeFechas(ordenes.filter((o) => o.pagada_en).map((o) => diaVE(o.pagada_en as string))).catch(() => new Map<string, number>()),
  ]);
  const tasaHoy = hoy?.usd ?? null;
  const filas = ordenes.map((o, i) => armarFila({
    orden: o,
    proveedor: proveedores.get(o.proveedor_id ?? '') ?? '',
    tasaPago: o.pagada_en ? (tasas.get(diaVE(o.pagada_en)) ?? null) : null,
    tasaHoy,
    fiscales: fiscales?.get(o.id) ?? [],
    // Solo las facturas que cargan el delivery y el almacenista (factura_path es el comprobante de pago).
    facturas: cantidadFacturas(o),
  }, i + 1));
  return { filas, ordenes: new Map(ordenes.map((o) => [o.id, o])), tasaHoy, conLibroFiscal: fiscales != null };
}
