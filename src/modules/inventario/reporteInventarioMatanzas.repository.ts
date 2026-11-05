/* ============================================================
   MGG · Inventario · Repositorio para Reporte Dinámico · Matanzas (04-11-2026)

   Capa de acceso a datos para la suite de reportes de Matanzas
   (CENTRO DE FUNDICION - MATANZAS).
   Lee de Supabase con paginación defensiva (todasLasFilas) para no
   truncar inventarios en 1.000 filas.

   Permite consultar:
     - Subalmacenes de la sede Matanzas (almacenes donde sede = 'CENTRO DE FUNDICION - MATANZAS')
     - Existencias y catálogo maestro de productos de Matanzas
     - Kárdex histórico de movimientos de Matanzas
     - Lotes recepcionados de mineral (casiterita_detalles)
     - Tasa de cambio oficial BCV del día
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Producto, Existencia, Movimiento, Almacen } from '@/shared/lib/types';
import { listProductos, getCategorias } from './inventario.repository';
import { listAlmacenes } from './almacenes.repository';
import { listCasiteritaDetalle, type CasiteritaDetalle } from './casiteritaDetalle.repository';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import {
  normalizarStockMatanzas,
  normalizarMovimientoMatanzas,
  normalizarCasiteritaMatanzas,
  type AmbitoInventarioMatanzas,
  type FilaReporteMatanzas,
  round2,
} from './reporteInventarioMatanzasDinamico';

export const SEDE_MATANZAS = 'CENTRO DE FUNDICION - MATANZAS';

/** Subalmacenes reconocidos históricamente para Matanzas si la base no tiene la sede guardada. */
export const SUBALMACENES_MATANZAS_DEFAULT = [
  'General',
  'TALLER',
  'INSUMOS Y CONSUMIBLES',
  'ALMACEN CASITERITA',
  'ALMACEN ESTAÑO EN BRUTO',
  'ALMACEN ESTAÑO REFINADO',
  'COMBUSTIBLE',
];

/**
 * Consulta la lista de subalmacenes registrados para el Centro de Fundición Matanzas.
 */
export async function listSubalmacenesMatanzas(): Promise<string[]> {
  const alms = await listAlmacenes('principal').catch(() => [] as Almacen[]);
  const matanzasAlms = alms
    .filter((a) => (a.sede?.trim() || '') === SEDE_MATANZAS)
    .map((a) => a.nombre.trim());

  if (matanzasAlms.length > 0) {
    return Array.from(new Set(matanzasAlms)).sort((a, b) => a.localeCompare(b, 'es'));
  }

  // Si aún no están clasificados por sede, tomamos los que coincidan con la convención de Matanzas
  const clasificados = alms
    .filter((a) =>
      /general/i.test(a.nombre) ||
      /taller/i.test(a.nombre) ||
      /insumo/i.test(a.nombre) ||
      /casiterita/i.test(a.nombre) ||
      /bruto/i.test(a.nombre) ||
      /refinad/i.test(a.nombre) ||
      /combustible/i.test(a.nombre),
    )
    .map((a) => a.nombre.trim());

  if (clasificados.length > 0) {
    return Array.from(new Set(clasificados)).sort((a, b) => a.localeCompare(b, 'es'));
  }

  return SUBALMACENES_MATANZAS_DEFAULT;
}

/**
 * Consulta todas las existencias de los subalmacenes de Matanzas usando paginación defensiva.
 */
export async function listExistenciasMatanzas(subalmacenes: string[]): Promise<Existencia[]> {
  if (!subalmacenes.length) return [];

  const filas = await todasLasFilas<Record<string, unknown>>((d, h) =>
    supabase
      .from('existencias')
      .select('*')
      .in('almacen', subalmacenes)
      .range(d, h),
  );

  return filas.map((r) => ({
    producto_id: String(r.producto_id || ''),
    almacen: String(r.almacen || ''),
    stock: Number(r.stock) || 0,
    costo_promedio: Number(r.costo_promedio) || 0,
    updated_at: (r.updated_at as string) ?? null,
  }));
}

/**
 * Consulta el kárdex de movimientos para los subalmacenes de Matanzas con paginación defensiva.
 */
export async function listMovimientosMatanzasRepo(
  subalmacenes: string[],
  fechaDesde?: string | null,
  fechaHasta?: string | null,
): Promise<Movimiento[]> {
  if (!subalmacenes.length) return [];

  const filas = await todasLasFilas<Record<string, unknown>>((d, h) => {
    let q = supabase
      .from('movimientos')
      .select('*')
      .in('almacen', subalmacenes)
      .order('at', { ascending: false })
      .range(d, h);

    if (fechaDesde) {
      q = q.gte('at', `${fechaDesde}T00:00:00`);
    }
    if (fechaHasta) {
      q = q.lte('at', `${fechaHasta}T23:59:59`);
    }

    return q;
  });

  return filas.map((r) => ({
    id: String(r.id || ''),
    producto_id: String(r.producto_id || ''),
    tipo: (r.tipo as Movimiento['tipo']) || 'ajuste',
    delta: Number(r.delta) || 0,
    stock_antes: Number(r.stock_antes) || 0,
    stock_despues: Number(r.stock_despues) || 0,
    actor: String(r.actor || ''),
    actor_name: (r.actor_name as string) ?? null,
    ref_tipo: (r.ref_tipo as string) ?? null,
    ref_id: (r.ref_id as string) ?? null,
    ref_codigo: (r.ref_codigo as string) ?? null,
    proveedor_id: (r.proveedor_id as string) ?? null,
    detalle: (r.detalle as string) ?? null,
    destino: (r.destino as string) ?? null,
    nota_entrega: (r.nota_entrega as string) ?? null,
    fecha_entrega: (r.fecha_entrega as string) ?? null,
    almacen: (r.almacen as string) ?? null,
    equipo_id: (r.equipo_id as string) ?? null,
    equipo_nombre: (r.equipo_nombre as string) ?? null,
    precio_unitario: r.precio_unitario != null ? Number(r.precio_unitario) : null,
    costo_promedio: r.costo_promedio != null ? Number(r.costo_promedio) : null,
    consumo_interno: (r.consumo_interno as boolean) ?? null,
    solicitante: (r.solicitante as string) ?? null,
    marca: (r.marca as string) ?? null,
    at: String(r.at || ''),
    created_at: String(r.created_at || r.at || ''),
  }));
}

export interface DatosCargadosMatanzas {
  filas: FilaReporteMatanzas[];
  tasaBcv: number;
  subalmacenes: string[];
  categorias: string[];
  totalProductosMaestro: number;
}

/**
 * Orquestador principal de carga de datos para el Reporte Dinámico de Matanzas.
 */
export async function cargarDatosReporteMatanzas(
  ambito: AmbitoInventarioMatanzas,
  subalmacenesSel?: string[],
  fechaDesde?: string | null,
  fechaHasta?: string | null,
): Promise<DatosCargadosMatanzas> {
  const [subalmacenesTodos, tasaRes, catsTodos] = await Promise.all([
    listSubalmacenesMatanzas(),
    getTasaHoy().catch(() => null),
    getCategorias().catch(() => [] as string[]),
  ]);

  const tasaBcv = Number(tasaRes?.usd) > 0 ? Number(tasaRes?.usd) : 1;
  const subsConsultar = subalmacenesSel && subalmacenesSel.length > 0 ? subalmacenesSel : subalmacenesTodos;

  if (ambito === 'casiterita') {
    const lotes = await listCasiteritaDetalle().catch(() => [] as CasiteritaDetalle[]);
    // Filtrar los lotes cuyo almacén esté dentro de los seleccionados
    const lotesMatanzas = lotes.filter((l) => subsConsultar.includes(l.almacen || 'ALMACEN CASITERITA'));
    const filas = lotesMatanzas.map((l) => normalizarCasiteritaMatanzas(l, tasaBcv));

    return {
      filas,
      tasaBcv,
      subalmacenes: subalmacenesTodos,
      categorias: ['MINERAL'],
      totalProductosMaestro: filas.length,
    };
  }

  if (ambito === 'movimientos') {
    const [prods, movs] = await Promise.all([
      listProductos('principal'),
      listMovimientosMatanzasRepo(subsConsultar, fechaDesde, fechaHasta),
    ]);
    const prodMap = new Map<string, Producto>(prods.map((p) => [p.id, p]));
    const filas = movs.map((m) => normalizarMovimientoMatanzas(m, prodMap, tasaBcv));

    return {
      filas,
      tasaBcv,
      subalmacenes: subalmacenesTodos,
      categorias: catsTodos,
      totalProductosMaestro: prods.length,
    };
  }

  // Ámbitos: 'stock' y 'criticos'
  const [prods, existencias] = await Promise.all([
    listProductos('principal'),
    listExistenciasMatanzas(subsConsultar),
  ]);

  const prodMap = new Map<string, Producto>(prods.map((p) => [p.id, p]));
  const exMap = new Map<string, Existencia>();
  for (const ex of existencias) {
    exMap.set(`${ex.producto_id}__${ex.almacen}`, ex);
  }

  const filas: FilaReporteMatanzas[] = [];

  // Mapear cada existencia real
  for (const ex of existencias) {
    const p = prodMap.get(ex.producto_id);
    if (!p) continue;
    filas.push(normalizarStockMatanzas(p, ex, ex.almacen, tasaBcv));
  }

  // Para los productos cuyo almacén de casa pertenezca a Matanzas pero aún no tengan fila en `existencias`,
  // los agregamos con stock 0 para reflejar el catálogo completo asignado a esta sede.
  for (const p of prods) {
    if (subsConsultar.includes(p.almacen) && !exMap.has(`${p.id}__${p.almacen}`)) {
      filas.push(normalizarStockMatanzas(p, null, p.almacen, tasaBcv));
    }
  }

  if (ambito === 'criticos') {
    // Filtrar solo artículos bajo stock mínimo o sin costo
    const filasCriticas = filas.filter(
      (f) => f.estado_stock === 'Bajo Mínimo' || f.estado_stock === 'Sin Stock' || f.estado_stock === 'Sin Costo ($0)',
    ).map((f) => ({
      ...f,
      ambito: 'criticos' as AmbitoInventarioMatanzas,
      deficit: f.stock < f.minimo ? round2(f.minimo - f.stock) : 0,
    }));

    return {
      filas: filasCriticas,
      tasaBcv,
      subalmacenes: subalmacenesTodos,
      categorias: catsTodos,
      totalProductosMaestro: prods.length,
    };
  }

  return {
    filas,
    tasaBcv,
    subalmacenes: subalmacenesTodos,
    categorias: catsTodos,
    totalProductosMaestro: prods.length,
  };
}

