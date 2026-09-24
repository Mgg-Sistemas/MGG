/* ============================================================
   MGG · Fundición · Repository (Supabase)
   Órdenes de fundición. Al CREAR se consumen los insumos
   (salida por almacén); al FINALIZAR el producto terminado
   entra al inventario con su costo de fundición (PMP).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { materialesAConsumir, porParProductoAlmacen } from './materialFundicion';
import type { Producto, Produccion, ProduccionMaterial } from '@/shared/lib/types';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { calcularAjusteProduccion, detalleAjuste } from './ajusteProduccion';
import { validaStock } from './almacenFundicion';
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
  /** null = material MANUAL (no está en inventario): entra al costo pero no se valida ni se consume. */
  producto_id: string | null;
  material_nombre: string;
  almacen: string;
  cantidad: number;
  /** Tasa/costo unitario a usar (override). Si se omite, se toma el costo_promedio del inventario. */
  costo?: number | null;
  /**
   * El material sale del PISO DE FUNDICIÓN: ya se descontó del inventario cuando
   * se hizo su salida, marcada «va para fundición». Esta colada NO lo descuenta
   * otra vez ni valida existencias — solo lo cuenta en el costo. Es la corrección
   * del doble descuento (salida + consumo de fundición sobre el mismo material).
   */
  desde_fundicion?: boolean | null;
  /**
   * Lo contrario: se descuenta AUNQUE la orden esté marcada como carga vieja.
   *
   * Lo usa la casiterita de los big bags, que no pasa por ninguna Salida: sale
   * derecho del Inventario Detallado (SnO₂). Si la colada no la baja, la bolsa
   * queda disponible para siempre y se puede volver a quemar.
   */
  siempre_descuenta?: boolean | null;
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
  /** Si el producto terminado suma al inventario al finalizar (default true). */
  sumarInventario?: boolean;
  /** false = carga histórica: no se descuenta nada del inventario ni se exige stock. */
  descontarInventario?: boolean;
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
  const [{ data, error }, { data: mats, error: mErr }] = await Promise.all([
    supabase.from('produccion').select('*').eq('id', id).maybeSingle(),
    supabase.from('produccion_materiales').select('*').eq('produccion_id', id),
  ]);
  if (error) throw error;
  if (!data) return null;
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
  // Solo los materiales con producto_id real se leen del inventario; los MANUALES
  // (producto_id null) no se validan ni se consumen, pero sí entran al costo.
  const existencias = await Promise.all(validos.map((m) => (m.producto_id ? getExistencia(m.producto_id, m.almacen) : Promise.resolve(null))));
  const detalles: Array<MaterialInput & { costo_unitario: number; subtotal: number }> = [];
  let costoMaterial = 0;
  // Carga histórica: la colada ya ocurrió (p. ej. una de mayo) y el stock de hoy
  // ya refleja lo que se quemó entonces. No se exige existencia ni se consume.
  const descuenta = input.descontarInventario !== false;
  validos.forEach((m, i) => {
    const cant = Number(m.cantidad) || 0;
    const ex = existencias[i];
    // Un material del piso no tiene existencia que validar: el tope lo puso la
    // salida que lo entregó, y lo revisa el formulario contra el disponible.
    const esManual = !m.producto_id || m.desde_fundicion === true;
    if (!esManual && validaStock(descuenta, m.desde_fundicion, m.siempre_descuenta)) {
      const stock = Number(ex?.stock) || 0;
      if (stock < cant) {
        throw new Error(`Stock insuficiente de "${m.material_nombre}" en ${m.almacen}. Disponible: ${stock}.`);
      }
    }
    // Tasa a usar: override explícito (≥0) si vino desde el formulario (ej. la tasa
    // editable de la casiterita, o el costo de la colada/línea manual en refinación);
    // si no, el costo_promedio del inventario.
    const override = m.costo != null && Number.isFinite(Number(m.costo)) && Number(m.costo) >= 0 ? Number(m.costo) : null;
    const costo = override ?? (Number(ex?.costo_promedio) || 0);
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
      sumar_inventario: input.sumarInventario ?? true,
      descontar_inventario: descuenta,
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

  // 3) Registrar materiales. Los MANUALES (sin producto_id) no van a
  //    produccion_materiales (esa tabla exige producto): su costo ya entró al CP.
  const detallesInv = detalles.filter((d) => d.producto_id);
  const matRows = detallesInv.map((d) => ({
    produccion_id: produccion.id,
    producto_id: d.producto_id,
    material_nombre: d.material_nombre,
    almacen: d.almacen,
    cantidad: d.cantidad,
    costo_unitario: d.costo_unitario,
    subtotal: d.subtotal,
    // Marca de dónde salió: es lo que descuenta el piso de fundición y lo que
    // evita que esta línea toque el inventario.
    desde_fundicion: d.desde_fundicion === true,
    // Y esta marca es la contraria: baja el stock aunque la orden sea vieja.
    siempre_descuenta: d.siempre_descuenta === true,
  }));
  if (matRows.length) {
    const { error: mErr } = await supabase.from('produccion_materiales').insert(matRows);
    if (mErr) throw mErr;
  }

  // 4) Consumir el stock de cada insumo de inventario (salida por almacén). En paralelo:
  //    cada material es un producto distinto, no compiten por la misma fila.
  // Los del PISO no se consumen: su salida ya los descontó del inventario.
  // Descontarlos otra vez acá era el doble descuento que había que sacar.
  // Y en una CARGA HISTÓRICA no se consume nada: la colada ya pasó.
  // Lo que comparte producto+almacén va EN ORDEN (si no, la segunda escritura
  // pisa a la primera y el inventario queda corto); lo demás, en paralelo.
  // En una carga vieja solo pasan los `siempre_descuenta` (la casiterita).
  await Promise.all(porParProductoAlmacen(materialesAConsumir(detallesInv, descuenta)).map(async (grupo) => {
    for (const d of grupo) {
      await registrarMovimiento({
        producto_id: d.producto_id as string,
        tipo: 'consumo',
        delta: -d.cantidad,
        almacen: d.almacen,
        actor: input.actor,
        actor_name: input.actor_name ?? null,
        ref_tipo: 'produccion',
        ref_id: produccion.id,
        detalle: `Consumo para ${tipo === 'refinacion' ? 'refinación' : 'fundición'} de ${input.producto_nombre}`,
      });
    }
  }));

  return produccion;
}

/**
 * Edita los MATERIALES (y, opcional, cantidad producida / mano de obra / indirectos)
 * de una orden EN CURSO (no finalizada). Es seguro para el inventario:
 *  1) revierte el consumo anterior con un 'ajuste' de +cantidad y precio_unitario null
 *     → restaura el stock a su costo vigente SIN tocar el PMP del almacén;
 *  2) reemplaza produccion_materiales;
 *  3) valida y consume los materiales nuevos (contra el stock ya restaurado);
 *  4) recalcula costo_material, costo_unitario y ganancia de la orden.
 * Los materiales MANUALES (sin producto_id) no tocan inventario (igual que al crear).
 */
export async function editarMaterialesProduccion(input: {
  produccionId: string;
  cantidad?: number | null;
  manoObra?: number | null;
  costosIndirectos?: number | null;
  sumarInventario?: boolean;
  /** false = carga histórica: ni se valida stock ni se consume. */
  descontarInventario?: boolean;
  materiales: MaterialInput[];
  actor: string;
  actorName?: string | null;
}): Promise<Produccion> {
  const { data: prodData, error: pErr0 } = await supabase.from('produccion').select('*').eq('id', input.produccionId).maybeSingle();
  if (pErr0) throw pErr0;
  if (!prodData) throw new Error('Orden no encontrada.');
  const prodActual = prodData as Produccion;
  if (prodActual.estado === 'finalizado') throw new Error('No se puede editar una orden ya finalizada.');
  const tipo: ProduccionTipo = (prodActual.tipo as ProduccionTipo) ?? 'fundicion';

  // 1) Revertir el consumo anterior (restaura stock a su costo vigente; precio_unitario null → no toca PMP).
  const { data: matViejos, error: mErr0 } = await supabase
    .from('produccion_materiales').select('producto_id, material_nombre, almacen, cantidad, desde_fundicion, siempre_descuenta').eq('produccion_id', input.produccionId);
  if (mErr0) throw mErr0;
  // Lo que nunca se descontó no se devuelve: una orden que se cargó como
  // histórica no movió stock, así que "revertirla" lo inventaría.
  const descontabaAntes = (prodActual as { descontar_inventario?: boolean }).descontar_inventario !== false;
  for (const m of (matViejos ?? []) as Array<{ producto_id: string | null; material_nombre: string; almacen: string; cantidad: number; desde_fundicion?: boolean | null; siempre_descuenta?: boolean | null }>) {
    // La casiterita sí se descontó incluso en una carga vieja, así que también
    // hay que devolverla; si no, editar la colada la haría desaparecer del stock.
    if (!descontabaAntes && m.siempre_descuenta !== true) continue;
    if (!m.producto_id || !((Number(m.cantidad) || 0) > 0)) continue;
    // Los del piso nunca descontaron inventario, así que no hay nada que
    // devolver: al borrarse la fila vuelven solos al disponible de fundición.
    if (m.desde_fundicion) continue;
    await registrarMovimiento({
      producto_id: m.producto_id, tipo: 'ajuste', delta: Number(m.cantidad) || 0, almacen: m.almacen,
      actor: input.actor, actor_name: input.actorName ?? null,
      ref_tipo: 'produccion_edicion', ref_id: input.produccionId,
      detalle: `Reversa de consumo por edición de ${tipo === 'refinacion' ? 'refinación' : 'colada'} (${m.material_nombre})`,
    });
  }

  // 2) Borrar los materiales viejos.
  const { error: delErr } = await supabase.from('produccion_materiales').delete().eq('produccion_id', input.produccionId);
  if (delErr) throw delErr;

  // 3) Validar + costear los nuevos contra el stock YA restaurado.
  const cantidad = input.cantidad != null && Number(input.cantidad) > 0 ? Number(input.cantidad) : (Number(prodActual.cantidad) || 0);
  if (cantidad <= 0) throw new Error('La cantidad a producir debe ser mayor que 0.');
  const descuentaAhora = input.descontarInventario !== undefined ? input.descontarInventario !== false : descontabaAntes;
  const validos = input.materiales.filter((m) => (Number(m.cantidad) || 0) > 0);
  if (!validos.length) throw new Error('Seleccioná al menos un material con cantidad.');
  const existencias = await Promise.all(validos.map((m) => (
    m.producto_id && !m.desde_fundicion ? getExistencia(m.producto_id, m.almacen) : Promise.resolve(null)
  )));
  const detalles: Array<MaterialInput & { costo_unitario: number; subtotal: number }> = [];
  let costoMaterial = 0;
  validos.forEach((m, i) => {
    const cant = Number(m.cantidad) || 0;
    const ex = existencias[i];
    // El del piso no tiene existencia contra la cual validar: su tope es lo que
    // se le entregó, y eso lo revisa el formulario contra el disponible.
    if (m.producto_id && validaStock(descuentaAhora, m.desde_fundicion, m.siempre_descuenta)) {
      const stock = Number(ex?.stock) || 0;
      if (stock < cant) throw new Error(`Stock insuficiente de "${m.material_nombre}" en ${m.almacen}. Disponible: ${stock}.`);
    }
    const override = m.costo != null && Number.isFinite(Number(m.costo)) && Number(m.costo) >= 0 ? Number(m.costo) : null;
    const costo = override ?? (Number(ex?.costo_promedio) || 0);
    const subtotal = round2(cant * costo);
    costoMaterial += subtotal;
    detalles.push({ ...m, cantidad: cant, costo_unitario: costo, subtotal });
  });
  costoMaterial = round2(costoMaterial);

  const manoObra = input.manoObra != null ? Number(input.manoObra) || 0 : (Number(prodActual.mano_obra) || 0);
  const indirectos = input.costosIndirectos != null ? Number(input.costosIndirectos) || 0 : (Number(prodActual.costos_indirectos) || 0);
  const cp = costoMaterial + manoObra + indirectos;
  const costoUnitario = round2(cp / cantidad);
  const precioVenta = prodActual.precio_venta != null ? Number(prodActual.precio_venta) : null;
  const ganancia = precioVenta != null ? round2((precioVenta - costoUnitario) * cantidad) : null;

  // 4) Insertar los materiales nuevos (solo los de inventario van a la tabla).
  const detallesInv = detalles.filter((d) => d.producto_id);
  const matRows = detallesInv.map((d) => ({
    produccion_id: input.produccionId, producto_id: d.producto_id, material_nombre: d.material_nombre,
    almacen: d.almacen, cantidad: d.cantidad, costo_unitario: d.costo_unitario, subtotal: d.subtotal,
    desde_fundicion: d.desde_fundicion === true,
    siempre_descuenta: d.siempre_descuenta === true,
  }));
  if (matRows.length) {
    const { error: insErr } = await supabase.from('produccion_materiales').insert(matRows);
    if (insErr) throw insErr;
  }

  // 5) Consumir los nuevos.
  // Los del piso, otra vez, no se consumen del inventario. Y una carga histórica
  // no consume nada.
  // En orden lo que comparte producto+almacén, por lo mismo que al crear.
  await Promise.all(porParProductoAlmacen(materialesAConsumir(detallesInv, descuentaAhora)).map(async (grupo) => {
    for (const d of grupo) {
      await registrarMovimiento({
        producto_id: d.producto_id as string, tipo: 'consumo', delta: -d.cantidad, almacen: d.almacen,
        actor: input.actor, actor_name: input.actorName ?? null,
        ref_tipo: 'produccion', ref_id: input.produccionId,
        detalle: `Consumo (edición) para ${tipo === 'refinacion' ? 'refinación' : 'fundición'} de ${prodActual.producto_nombre}`,
      });
    }
  }));

  // 6) Actualizar la orden con los nuevos costos.
  const updPatch: Record<string, unknown> = {
    cantidad, costo_material: costoMaterial, mano_obra: manoObra, costos_indirectos: indirectos,
    costo_unitario: costoUnitario, ganancia,
  };
  if (input.sumarInventario !== undefined) updPatch.sumar_inventario = input.sumarInventario;
  updPatch.descontar_inventario = descuentaAhora;
  const { data: upd, error: uErr } = await supabase.from('produccion').update(updPatch).eq('id', input.produccionId).select('*').single();
  if (uErr) throw uErr;
  return upd as Produccion;
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
  // Solo si la orden está marcada para sumar al inventario (default true). En false,
  // la colada/refinación queda como registro/reporte sin sumar stock.
  if (prod.sumar_inventario !== false) {
    await registrarMovimiento({
      producto_id: prod.producto_id,
      tipo: 'entrada',
      delta: Number(prod.cantidad) || 0,
      almacen: prod.almacen_destino,
      actor,
      actor_name: actorName ?? null,
      ref_tipo: 'produccion',
      ref_id: prod.id,
      detalle: `${(prod.tipo ?? 'fundicion') === 'refinacion' ? 'Refinación' : 'Fundición'} finalizada: ${prod.producto_nombre} (${prod.cantidad} und)`,
      precio_unitario: Number(prod.costo_unitario) || 0,
    });
  }

  const { data: upd, error: uErr } = await supabase
    .from('produccion')
    .update({ estado: 'finalizado', fin_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (uErr) throw uErr;
  return upd as Produccion;
}

/**
 * Corrige la CANTIDAD PRODUCIDA de una colada o refinación ya finalizada y
 * sincroniza el inventario con la diferencia (ajuste + / −). La nota es
 * obligatoria: viaja al kardex y queda en el historial de la orden.
 *
 * El costo del proceso no cambia: se reparte entre la nueva cantidad, así que el
 * costo unitario se recalcula. El movimiento va SIN precio para no tocar el PMP
 * del almacén con un número que ya está contado.
 */
export async function ajustarCantidadProducida(input: {
  produccionId: string;
  cantidadNueva: number;
  nota: string;
  actor: string;
  actorName?: string | null;
}): Promise<Produccion> {
  const { data, error } = await supabase.from('produccion').select('*').eq('id', input.produccionId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No se encontró la orden.');
  const prod = data as Produccion & { ajustes?: Array<Record<string, unknown>> | null };
  if (prod.estado !== 'finalizado') throw new Error('Esto es para corregir una orden FINALIZADA. Mientras está en curso, editá los materiales.');

  const costoProceso = (Number(prod.costo_material) || 0) + (Number(prod.mano_obra) || 0) + (Number(prod.costos_indirectos) || 0);
  const aj = calcularAjusteProduccion({
    cantidadActual: Number(prod.cantidad) || 0,
    cantidadNueva: input.cantidadNueva,
    costoProceso,
    precioVenta: prod.precio_venta,
    nota: input.nota,
  });

  const esRef = (prod.tipo ?? 'fundicion') === 'refinacion';
  const numero = await numeroDeProceso(prod.id, esRef);
  const detalle = detalleAjuste(prod.tipo ?? 'fundicion', numero, Number(prod.cantidad) || 0, aj.cantidad, input.nota);

  // El inventario solo se toca si esta orden sumó stock al finalizar.
  if (prod.sumar_inventario !== false && prod.producto_id) {
    await registrarMovimiento({
      producto_id: prod.producto_id,
      tipo: 'ajuste',
      delta: aj.delta,
      almacen: prod.almacen_destino,
      actor: input.actor,
      actor_name: input.actorName ?? null,
      ref_tipo: 'produccion_ajuste',
      ref_id: prod.id,
      detalle,
      precio_unitario: null,   // conserva el PMP del almacén
    });
  }

  const ajustes = [...(prod.ajustes ?? []), {
    at: new Date().toISOString(),
    actor: input.actorName || input.actor,
    de: Number(prod.cantidad) || 0,
    a: aj.cantidad,
    nota: input.nota.trim(),
    movio_inventario: prod.sumar_inventario !== false && !!prod.producto_id,
  }];

  const { data: upd, error: uErr } = await supabase.from('produccion')
    .update({ cantidad: aj.cantidad, costo_unitario: aj.costoUnitario, ganancia: aj.ganancia, ajustes })
    .eq('id', prod.id).select('*').single();
  if (uErr) throw uErr;

  // El reporte (colada / refinación) muestra su propio kg obtenido: se alinea.
  await alinearReporte(prod.id, esRef, aj.cantidad).catch(() => { /* el reporte no bloquea la corrección */ });
  return upd as Produccion;
}

/** N° de colada o de refinación, para el texto del movimiento. */
async function numeroDeProceso(produccionId: string, esRef: boolean): Promise<number | null> {
  const tabla = esRef ? 'produccion_refinacion' : 'produccion_colada';
  const campo = esRef ? 'refinacion_num' : 'colada_num';
  const { data } = await supabase.from(tabla).select(campo).eq('produccion_id', produccionId).maybeSingle();
  const n = Number((data as Record<string, unknown> | null)?.[campo]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Deja el kg obtenido del reporte igual a la cantidad corregida. */
async function alinearReporte(produccionId: string, esRef: boolean, cantidad: number): Promise<void> {
  const tabla = esRef ? 'produccion_refinacion' : 'produccion_colada';
  const { data } = await supabase.from(tabla).select('datos').eq('produccion_id', produccionId).maybeSingle();
  const datos = ((data as { datos?: Record<string, unknown> } | null)?.datos ?? {}) as Record<string, unknown>;
  const campo = esRef ? 'estano_refinado_kg' : 'estano_kg';
  if (datos[campo] == null) return;
  await supabase.from(tabla).update({ datos: { ...datos, [campo]: cantidad } }).eq('produccion_id', produccionId);
}
