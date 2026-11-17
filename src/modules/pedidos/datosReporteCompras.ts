/* ============================================================
   Golden Touch · Compras · Capa de datos del Reporte Moldeable
   (10/11/2026)

   Precarga y UNE las tres fuentes de compra (ordenes, compras_directas,
   servicios_directos) para el rango elegido, arma el contexto (tasa BCV, mapa
   sku→categoría, mapa proveedor→razón social) y normaliza todo a las filas del
   motor puro (`comprasMoldeable.ts`). También atribuye cada cotización a su
   departamento (vía la orden) para el ranking.

   Es la ÚNICA pieza async; todo el cálculo vive en el motor puro y se prueba con
   fixtures. El ancla del rango es `created_at` (fecha de la compra).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { listOrdenes } from './pedidos.repository';
import type { CompraDirecta } from './compras.repository';
import { listServiciosDirectos } from './serviciosDirectos.repository';
import { list as listProveedores } from '@/modules/proveedores/proveedores.repository';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import {
  normalizarOrdenes,
  normalizarDirectas,
  normalizarServicios,
  normalizarItemsOrdenes,
  normalizarDepartamento,
  clasificarEstadoOrden,
  SIN_DEPARTAMENTO,
  type ContextoCompras,
  type CotizacionCompras,
  type FilaReporteCompras,
} from './comprasMoldeable';

export interface DatosReporteCompras {
  filasOrdenes: FilaReporteCompras[];
  filasItems: FilaReporteCompras[];
  cotizaciones: CotizacionCompras[];
  tasaBcv: number;
  /** Opciones para los filtros del modal. */
  departamentos: string[];
  categorias: string[];
  proveedores: string[];
}

/** Día (YYYY-MM-DD) de un instante ISO. */
function dia(iso: string | null | undefined): string {
  return (iso || '').slice(0, 10);
}

/**
 * Filtra filas cuyo campo de fecha cae dentro de [desde, hasta] (ambos inclusive,
 * comparando por día). Las filas sin fecha quedan fuera. Función pura.
 */
export function filtrarPorRango<T>(rows: T[], campoFecha: (r: T) => string | null | undefined, desde: string, hasta: string): T[] {
  const d = desde.slice(0, 10);
  const h = hasta.slice(0, 10);
  return rows.filter((r) => {
    const f = dia(campoFecha(r));
    return !!f && f >= d && f <= h;
  });
}

/** Lista única y ordenada (es) de valores no vacíos. */
function unicos(valores: string[]): string[] {
  return Array.from(new Set(valores.filter((v) => v && v.trim()))).sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Carga todo lo necesario para el reporte moldeable de compras en el rango dado:
 * las tres fuentes normalizadas a filas (ámbito órdenes e ítems), las cotizaciones
 * atribuidas a su departamento, la tasa BCV del día y las listas de opciones de
 * los filtros. Solo lectura.
 */
export async function cargarDatosReporteCompras(desde: string, hasta: string): Promise<DatosReporteCompras> {
  // Compras directas: SELECT crudo (solo lectura). No se usa `listComprasDirectas()` porque
  // ese dispara `reconciliarComprasDirectasHuerfanas()`, que ESCRIBE en `compras_directas`
  // (auto-reparo de pagos huérfanos). El reporte debe ser solo lectura (spec §3).
  const [ordenesAll, directasRes, serviciosAll, proveedoresAll, tasaHoy, catRes] = await Promise.all([
    listOrdenes(),
    supabase.from('compras_directas').select('id, codigo, estado, gasto, moneda, gasto_categoria, pagada_at, created_at, proveedor_id, proveedor_nombre, actor, actor_name, creado_por, nota, items, producto_nombre, cantidad'),
    listServiciosDirectos(),
    listProveedores().catch(() => []),
    getTasaHoy().catch(() => ({ usd: 0 } as { usd: number })),
    supabase.from('productos').select('sku, categoria'),
  ]);
  const directasAll = (directasRes.data ?? []) as unknown as CompraDirecta[];

  const tasaBcv = Number((tasaHoy as { usd?: number })?.usd) || 0;

  const ordenes = filtrarPorRango(ordenesAll, (o) => o.created_at, desde, hasta);
  const directas = filtrarPorRango(directasAll, (c) => c.created_at, desde, hasta);
  const servicios = filtrarPorRango(serviciosAll, (s) => s.created_at, desde, hasta);

  const categoriasPorSku = new Map<string, string>(
    ((catRes.data ?? []) as Array<{ sku: string | null; categoria: string | null }>)
      .filter((p) => p.sku)
      .map((p) => [p.sku as string, (p.categoria || '').trim()]),
  );
  const nombreProveedor = new Map<string, string>(
    proveedoresAll.map((p) => [p.id, (p.razon_social || '').trim()]),
  );

  const ctx: ContextoCompras = { tasaBcv, categoriasPorSku, nombreProveedor };

  const filasOrdenes = [
    ...normalizarOrdenes(ordenes, ctx),
    ...normalizarDirectas(directas, ctx),
    ...normalizarServicios(servicios, ctx),
  ];
  const filasItems = normalizarItemsOrdenes(ordenes, ctx);

  // Cotizaciones por departamento: ofertas de las órdenes del rango que cuentan
  // (no excluidas). Cada oferta se atribuye al departamento de su orden.
  const deptoPorOrden = new Map<string, string>(
    ordenes.map((o) => [o.id, normalizarDepartamento(o.unidad_solicitante)]),
  );
  const ordIdsValidas = ordenes.filter((o) => clasificarEstadoOrden(o.estado) !== 'excluida').map((o) => o.id);
  let cotizaciones: CotizacionCompras[] = [];
  if (ordIdsValidas.length) {
    const { data } = await supabase.from('ofertas_proveedor').select('orden_id').in('orden_id', ordIdsValidas);
    cotizaciones = ((data ?? []) as Array<{ orden_id: string }>).map((r) => ({
      departamento: deptoPorOrden.get(r.orden_id) ?? SIN_DEPARTAMENTO,
    }));
  }

  return {
    filasOrdenes,
    filasItems,
    cotizaciones,
    tasaBcv,
    departamentos: unicos(filasOrdenes.map((f) => f.departamento)),
    categorias: unicos(filasItems.map((f) => f.categoria)),
    proveedores: unicos(filasOrdenes.map((f) => f.proveedor).filter((p) => p !== '—')),
  };
}
