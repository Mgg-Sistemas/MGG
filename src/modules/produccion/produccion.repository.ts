/* ============================================================
   MGG · Fundición · Repository (Supabase)
   Órdenes de fundición. Al CREAR se consumen los insumos
   (salida por almacén); al FINALIZAR el producto terminado
   entra al inventario con su costo de fundición (PMP).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Producto, Produccion, ProduccionMaterial } from '@/shared/lib/types';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { getExistencia } from '@/modules/inventario/almacenes.repository';
import { createProducto, findBySku } from '@/modules/inventario/inventario.repository';

/** Tipo de orden en la tabla `produccion`: fundición o refinación de material. */
export type ProduccionTipo = 'fundicion' | 'refinacion';

function slugSku(prefix: string, nombre: string): string {
  const base = nombre.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16);
  const suf = Math.floor(performance.now() % 100000).toString(36).toUpperCase();
  return `${prefix}-${base || 'ITEM'}-${suf}`;
}

/** Crea un producto terminado "producible" (catálogo de qué producir/refinar). */
export async function crearProductoProducible(input: { nombre: string; unidad: string; precioVenta?: number | null; categoria?: string }): Promise<Producto> {
  const nombre = input.nombre.trim().toUpperCase();
  if (!nombre) throw new Error('El nombre del producto a producir es obligatorio.');
  return createProducto({
    sku: slugSku('PT', nombre),
    nombre,
    categoria: input.categoria || 'FUNDICIÓN',
    unidad: input.unidad || 'und',
    stock: 0,
    stock_min: 0,
    precio: 0,
    almacen: 'General',
    estado: 'activo',
    precio_venta: input.precioVenta ?? null,
    es_producible: true,
  });
}

/** Crea un insumo de inventario marcado como receta (es_receta = true), con stock inicial opcional. */
export async function crearInsumoReceta(input: {
  sku?: string;
  nombre: string;
  unidad: string;
  almacen: string;
  stock: number;
  costo: number;
  actor: string;
  actor_name?: string | null;
}): Promise<Producto> {
  const nombre = input.nombre.trim().toUpperCase();
  if (!nombre) throw new Error('El nombre del insumo es obligatorio.');
  const sku = (input.sku?.trim().toUpperCase()) || slugSku('INS', nombre);
  if (await findBySku(sku)) throw new Error(`Ya existe un producto con el SKU ${sku}.`);
  const prod = await createProducto({
    sku,
    nombre,
    categoria: 'INSUMOS',
    unidad: input.unidad || 'und',
    stock: 0,
    stock_min: 0,
    precio: input.costo || 0,
    almacen: input.almacen || 'General',
    estado: 'activo',
    es_receta: true,
  });
  const stockInicial = Number(input.stock) || 0;
  if (stockInicial > 0) {
    await registrarMovimiento({
      producto_id: prod.id,
      tipo: 'creacion',
      delta: stockInicial,
      almacen: input.almacen || 'General',
      actor: input.actor,
      actor_name: input.actor_name ?? null,
      detalle: `Alta de insumo para fundición · almacén ${input.almacen}`,
      precio_unitario: input.costo || 0,
    });
  }
  return prod;
}

export interface MaterialInput {
  producto_id: string;
  material_nombre: string;
  almacen: string;
  cantidad: number;
}

export interface CrearProduccionInput {
  producto_id: string | null;
  producto_nombre: string;
  cantidad: number;
  almacen_destino: string;
  horno?: string | null;
  mano_obra: number;
  costos_indirectos: number;
  precio_venta?: number | null;
  materiales: MaterialInput[];
  actor: string;
  actor_name?: string | null;
  /** Fundición (default) o refinación de material. */
  tipo?: ProduccionTipo;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function listProducciones(tipo: ProduccionTipo = 'fundicion'): Promise<Produccion[]> {
  const { data, error } = await supabase
    .from('produccion')
    .select('*')
    .eq('tipo', tipo)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Produccion[];
}

/** Conteo liviano de órdenes en proceso (sin traer filas). */
export async function contarProduccionEnProceso(tipo: ProduccionTipo = 'fundicion'): Promise<number> {
  const { count, error } = await supabase
    .from('produccion')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', tipo)
    .eq('estado', 'produccion');
  if (error) throw error;
  return count ?? 0;
}

export interface RecetaItem {
  producto_id: string;
  material_nombre: string;
  almacen: string;
  cantidad: number;
}
export interface RecetaGuardada {
  /** Unidades que produjo la receta base (rendimiento). */
  rendimiento: number;
  /** Nº de receta de la última fundición de ese producto (1, 2, 3…). */
  numero: number;
  items: RecetaItem[];
}

/** Próximo nº de receta para un producto = cuántas producciones tiene + 1 (por tipo). */
export async function proximaRecetaNum(productoId: string | null, tipo: ProduccionTipo = 'fundicion'): Promise<number> {
  if (!productoId) return 1;
  const { count, error } = await supabase
    .from('produccion')
    .select('id', { count: 'exact', head: true })
    .eq('producto_id', productoId)
    .eq('tipo', tipo);
  if (error) throw error;
  return (count ?? 0) + 1;
}

/**
 * Devuelve la "receta" del producto producible: los insumos usados en su
 * ÚLTIMA fundición, junto al rendimiento (cantidad producida esa vez). Sirve
 * para precargar los materiales al volver a producir el mismo producto.
 */
export async function getUltimaReceta(productoId: string, tipo: ProduccionTipo = 'fundicion'): Promise<RecetaGuardada | null> {
  if (!productoId) return null;
  const { data: prod, error } = await supabase
    .from('produccion')
    .select('id, cantidad, receta_num')
    .eq('producto_id', productoId)
    .eq('tipo', tipo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!prod) return null;
  const { data: mats, error: mErr } = await supabase
    .from('produccion_materiales')
    .select('producto_id, material_nombre, almacen, cantidad')
    .eq('produccion_id', prod.id);
  if (mErr) throw mErr;
  const items: RecetaItem[] = (mats ?? []).map((m) => ({
    producto_id: m.producto_id as string,
    material_nombre: m.material_nombre as string,
    almacen: m.almacen as string,
    cantidad: Number(m.cantidad) || 0,
  }));
  if (!items.length) return null;
  return { rendimiento: Number(prod.cantidad) || 1, numero: Number(prod.receta_num) || 1, items };
}

export interface RecetaResumen {
  producto_id: string;
  producto_nombre: string;
  produccion_id: string;     // última fundición (fuente de la receta)
  rendimiento: number;       // cantidad producida en esa receta
  almacen_destino: string;
  costo_material: number;
  mano_obra: number;
  costos_indirectos: number;
  costo_unitario: number;
  precio_venta: number | null;
  receta_num: number | null;
  fecha: string;
  n_materiales: number;
}

/**
 * Lista las "recetas": una por cada producto producible, tomando su fundición
 * MÁS RECIENTE como receta vigente (qué materiales y en qué cantidad se usaron
 * para producir X unidades).
 */
export async function listRecetas(tipo: ProduccionTipo = 'fundicion'): Promise<RecetaResumen[]> {
  const { data, error } = await supabase
    .from('produccion')
    .select('id, producto_id, producto_nombre, cantidad, almacen_destino, costo_material, mano_obra, costos_indirectos, costo_unitario, precio_venta, receta_num, created_at')
    .eq('tipo', tipo)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const seen = new Set<string>();
  const base: RecetaResumen[] = [];
  for (const r of data ?? []) {
    const pid = r.producto_id as string | null;
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    base.push({
      producto_id: pid,
      producto_nombre: r.producto_nombre as string,
      produccion_id: r.id as string,
      rendimiento: Number(r.cantidad) || 0,
      almacen_destino: r.almacen_destino as string,
      costo_material: Number(r.costo_material) || 0,
      mano_obra: Number(r.mano_obra) || 0,
      costos_indirectos: Number(r.costos_indirectos) || 0,
      costo_unitario: Number(r.costo_unitario) || 0,
      precio_venta: r.precio_venta != null ? Number(r.precio_venta) : null,
      receta_num: r.receta_num != null ? Number(r.receta_num) : null,
      fecha: r.created_at as string,
      n_materiales: 0,
    });
  }
  if (!base.length) return base;

  // Contar materiales por fundición (una sola consulta).
  const ids = base.map((b) => b.produccion_id);
  const { data: mats } = await supabase
    .from('produccion_materiales')
    .select('produccion_id')
    .in('produccion_id', ids);
  const conteo = new Map<string, number>();
  (mats ?? []).forEach((m) => {
    const k = m.produccion_id as string;
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  });
  base.forEach((b) => { b.n_materiales = conteo.get(b.produccion_id) ?? 0; });
  return base;
}

export async function getProduccionConMateriales(id: string): Promise<Produccion | null> {
  const { data, error } = await supabase.from('produccion').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: mats, error: mErr } = await supabase
    .from('produccion_materiales')
    .select('*')
    .eq('produccion_id', id);
  if (mErr) throw mErr;
  return { ...(data as Produccion), materiales: (mats ?? []) as ProduccionMaterial[] };
}

/**
 * Crea una orden de fundición: valida disponibilidad de cada insumo en su
 * almacén, calcula el Costo de Fundición (CP = CTM + mano obra + indirectos),
 * registra los materiales y CONSUME el stock de cada insumo.
 */
export async function crearProduccion(input: CrearProduccionInput): Promise<Produccion> {
  const cantidad = Number(input.cantidad) || 0;
  if (cantidad <= 0) throw new Error('La cantidad a producir debe ser mayor que 0.');
  if (!input.materiales.length) throw new Error('Seleccioná al menos un material.');

  // 1) Validar y calcular costo de cada material desde su existencia real.
  //    Las lecturas de existencia se hacen en paralelo (cada material es un
  //    producto distinto) para no encadenar round-trips.
  const validos = input.materiales.filter((m) => (Number(m.cantidad) || 0) > 0);
  const existencias = await Promise.all(validos.map((m) => getExistencia(m.producto_id, m.almacen)));
  const detalles: Array<MaterialInput & { costo_unitario: number; subtotal: number }> = [];
  let costoMaterial = 0;
  validos.forEach((m, i) => {
    const cant = Number(m.cantidad) || 0;
    const ex = existencias[i];
    const stock = Number(ex?.stock) || 0;
    if (stock < cant) {
      throw new Error(`Stock insuficiente de "${m.material_nombre}" en ${m.almacen}. Disponible: ${stock}.`);
    }
    const costo = Number(ex?.costo_promedio) || 0;
    const subtotal = round2(cant * costo);
    costoMaterial += subtotal;
    detalles.push({ ...m, cantidad: cant, costo_unitario: costo, subtotal });
  });
  if (!detalles.length) throw new Error('Ningún material con cantidad válida.');
  costoMaterial = round2(costoMaterial);

  const manoObra = Number(input.mano_obra) || 0;
  const indirectos = Number(input.costos_indirectos) || 0;
  const cp = costoMaterial + manoObra + indirectos; // Costo de Fundición
  const costoUnitario = round2(cp / cantidad);
  const precioVenta = input.precio_venta != null ? Number(input.precio_venta) : null;
  const ganancia = precioVenta != null ? round2((precioVenta - costoUnitario) * cantidad) : null;

  // Nº de receta secuencial por producto (1, 2, 3…), separado por tipo.
  const tipo: ProduccionTipo = input.tipo ?? 'fundicion';
  const recetaNum = await proximaRecetaNum(input.producto_id, tipo);

  // 2) Insertar la orden de fundición / refinación.
  const { data: prod, error: pErr } = await supabase
    .from('produccion')
    .insert({
      producto_id: input.producto_id,
      producto_nombre: input.producto_nombre,
      cantidad,
      almacen_destino: input.almacen_destino,
      horno: input.horno?.trim() || null,
      estado: 'produccion',
      tipo,
      costo_material: costoMaterial,
      mano_obra: manoObra,
      costos_indirectos: indirectos,
      costo_unitario: costoUnitario,
      precio_venta: precioVenta,
      ganancia,
      receta_num: recetaNum,
      created_by: input.actor,
    })
    .select('*')
    .single();
  if (pErr) throw pErr;
  const produccion = prod as Produccion;

  // 3) Registrar materiales.
  const matRows = detalles.map((d) => ({
    produccion_id: produccion.id,
    producto_id: d.producto_id,
    material_nombre: d.material_nombre,
    almacen: d.almacen,
    cantidad: d.cantidad,
    costo_unitario: d.costo_unitario,
    subtotal: d.subtotal,
  }));
  const { error: mErr } = await supabase.from('produccion_materiales').insert(matRows);
  if (mErr) throw mErr;

  // 4) Consumir el stock de cada insumo (salida por almacén). En paralelo:
  //    cada material es un producto distinto, no compiten por la misma fila.
  await Promise.all(detalles.map((d) => registrarMovimiento({
    producto_id: d.producto_id,
    tipo: 'consumo',
    delta: -d.cantidad,
    almacen: d.almacen,
    actor: input.actor,
    actor_name: input.actor_name ?? null,
    ref_tipo: 'produccion',
    ref_id: produccion.id,
    detalle: `Consumo para fundición de ${input.producto_nombre}`,
  })));

  return produccion;
}

/**
 * Finaliza una fundición: el producto terminado entra al inventario en el
 * almacén destino con su costo de fundición unitario (recalcula su PMP).
 */
export async function finalizarProduccion(id: string, actor: string, actorName?: string | null): Promise<Produccion> {
  const { data, error } = await supabase.from('produccion').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Fundición no encontrada');
  const prod = data as Produccion;
  if (prod.estado === 'finalizado') throw new Error('La fundición ya está finalizada.');
  if (!prod.producto_id) throw new Error('La fundición no tiene un producto terminado asociado.');

  // Entrada del producto terminado al almacén destino, a su costo de fundición.
  await registrarMovimiento({
    producto_id: prod.producto_id,
    tipo: 'entrada',
    delta: Number(prod.cantidad) || 0,
    almacen: prod.almacen_destino,
    actor,
    actor_name: actorName ?? null,
    ref_tipo: 'produccion',
    ref_id: prod.id,
    detalle: `Fundición finalizada: ${prod.producto_nombre} (${prod.cantidad} und)`,
    precio_unitario: Number(prod.costo_unitario) || 0,
  });

  const { data: upd, error: uErr } = await supabase
    .from('produccion')
    .update({ estado: 'finalizado', fin_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (uErr) throw uErr;
  return upd as Produccion;
}
