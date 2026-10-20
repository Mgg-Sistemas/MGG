/* ============================================================
   MGG · Compras · Reporte por renglones (capa de datos)
   Trae todo lo que entra al reporte y lo normaliza con las
   funciones puras de `comprasReporte.ts`:
     · OC y servicios en `oc_creada`, `cuenta_abierta`,
       `confirmada_metodo` y `oc_aprobada`  → sus tres renglones + Por pagar.
     · Compras y servicios directos `por_pagar` → renglón Por pagar.
   Lectura por PÁGINAS: Supabase corta en 1.000 filas sin avisar.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { PAGINA_SUPABASE, todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Orden } from '@/shared/lib/types';
import { listComprasPorPagar, type CompraDirecta } from './compras.repository';
import { listServiciosPorPagar, type ServicioDirecto } from './serviciosDirectos.repository';
import { filaDeDirecto, filaDeOrden, type DirectoReporte, type FilaReporteCompras } from './comprasReporte';

const TABLE = 'ordenes';

/** Los estados que entran al reporte (los demás ya no son una compra pendiente). */
const ESTADOS: string[] = ['oc_creada', 'cuenta_abierta', 'confirmada_metodo', 'oc_aprobada'];

const texto = (v: unknown): string => String(v ?? '').trim();

/** Motivo de un directo: la nota del analista; si no hay, la categoría o el título. */
function motivoDirecto(nota: string | null, titulo: string, categoria: string[]): string {
  const partes = [texto(nota), categoria.filter(Boolean).join(' · ')].filter(Boolean);
  return partes.length ? partes.join(' · ') : texto(titulo);
}

/**
 * Todas las filas del reporte (OC, servicios y directos), sin agrupar: el agrupado
 * lo hace `agruparReporte()` en la pantalla/PDF, para que ambos muestren lo mismo.
 */
export async function listReporteCompras(): Promise<FilaReporteCompras[]> {
  const [ordenes, { data: provs }] = await Promise.all([
    todasLasFilas<Orden>((desde, hasta) =>
      supabase.from(TABLE).select('*').in('estado', ESTADOS)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(desde, hasta), PAGINA_SUPABASE),
    supabase.from('proveedores').select('id, razon_social'),
  ]);

  const proveedor = new Map((provs ?? []).map((p) => [String(p.id), String(p.razon_social ?? '')]));
  const deOrdenes = ordenes
    .map((o) => filaDeOrden(o, proveedor.get(String(o.proveedor_id)) ?? '—'))
    .filter((f): f is FilaReporteCompras => f !== null);

  // Directos POR PAGAR: se suman al renglón «Por pagar» con su código propio (CD-… / SD-…).
  const [compras, servicios] = await Promise.all([
    listComprasPorPagar().catch(() => [] as CompraDirecta[]),
    listServiciosPorPagar().catch(() => [] as ServicioDirecto[]),
  ]);
  const deCompras: FilaReporteCompras[] = compras
    .filter((c) => c.estado === 'por_pagar' && c.caja_mov_id == null && c.credito_cxp_id == null)
    .map((c) => filaDeDirecto({
      tipo: 'Compra directa',
      codigo: texto(c.codigo) || '—',
      motivo: motivoDirecto(c.nota, c.producto_nombre, [texto(c.gasto_categoria), texto(c.gasto_subcategoria)]),
      proveedor: texto(c.proveedor_nombre) || '—',
      total: Number(c.gasto) || 0,
      moneda: c.moneda,
      fecha: c.created_at ?? null,
    } satisfies DirectoReporte));
  const deServicios: FilaReporteCompras[] = servicios.map((s) => filaDeDirecto({
    tipo: 'Servicio directo',
    codigo: texto(s.codigo) || '—',
    motivo: motivoDirecto(s.nota, s.descripcion, [texto(s.gasto_categoria), texto(s.gasto_subcategoria)]),
    proveedor: texto(s.proveedor_nombre) || texto(s.equipo_nombre) || '—',
    total: Number(s.gasto) || 0,
    moneda: s.moneda,
    fecha: s.created_at ?? null,
  } satisfies DirectoReporte));

  return [...deOrdenes, ...deCompras, ...deServicios];
}
