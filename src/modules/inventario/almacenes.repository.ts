/* ============================================================
   MGG · Inventario · Almacenes (Supabase)
   Los almacenes son entidades reales en `almacenes`.
   `productos.almacen` referencia el NOMBRE del almacén (texto),
   por retrocompatibilidad con datos legados ('General', etc.).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { cachedQuery } from '@/shared/lib/queryCache';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Almacen, Existencia, Producto } from '@/shared/lib/types';
import type { Espacio } from './inventario.repository';

const TABLE = 'almacenes';

export interface AlmacenInput {
  nombre: string;
  ubicacion?: string | null;
  /** Sede física que agrupa la vista (Matanzas, Los Pinos…). */
  sede?: string | null;
  /** Almacén padre (subalmacén). null = almacén principal. */
  parent_id?: string | null;
  /** Espacio: 'principal' (Inventario) o 'deposito'. Por defecto 'principal'. */
  espacio?: string | null;
}

/** Sedes existentes de un espacio (para poblar el selector del formulario). */
export async function listSedes(espacio: Espacio = 'principal'): Promise<string[]> {
  const { data } = await supabase.from(TABLE).select('sede, espacio');
  const set = new Set<string>();
  (data ?? []).forEach((r) => {
    const row = r as { sede?: string | null; espacio?: string | null };
    if ((row.espacio ?? 'principal') !== espacio) return;
    const s = row.sede?.trim(); if (s) set.add(s);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

export interface AlmacenValor {
  valor: number;     // Σ stock × precio
  items: number;     // nº de productos
  unidades: number;  // Σ stock
}

export async function listAlmacenes(espacio: Espacio = 'principal'): Promise<Almacen[]> {
  // Cacheada (SWR) por espacio: dato de referencia usado en casi todos los desplegables.
  // Los almacenes legados (sin `espacio`) cuentan como 'principal'.
  return cachedQuery(`inv:almacenes:${espacio}`, async () => {
    const { data, error } = await supabase.from(TABLE).select('*').order('nombre', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Almacen[]).filter((a) => (a.espacio ?? 'principal') === espacio);
  }, { tables: ['almacenes'], ttl: 30_000 });
}

/**
 * Nombres de almacén para poblar desplegables: unión de la tabla `almacenes`
 * con los valores ya presentes en productos (mismo patrón que getCategorias).
 */
export async function getNombresAlmacenes(fromProductos: Producto[] = []): Promise<string[]> {
  const set = new Set<string>();
  try {
    const rows = await listAlmacenes();
    rows.forEach((a) => a.nombre && set.add(a.nombre));
  } catch { /* falla silenciosa: caemos a valores legados */ }
  fromProductos.forEach((p) => p.almacen && set.add(p.almacen));
  if (set.size === 0) set.add('General');
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

/** ¿Existe ya un almacén con ese nombre exacto? (la columna nombre es única). */
async function nombreOcupado(nombre: string, exceptoId?: string): Promise<boolean> {
  let q = supabase.from(TABLE).select('id').eq('nombre', nombre);
  if (exceptoId) q = q.neq('id', exceptoId);
  const { data } = await q.limit(1);
  return (data ?? []).length > 0;
}

/**
 * El stock se indexa por NOMBRE de almacén, así que el nombre guardado debe ser
 * único. Para que los SUBALMACENES puedan "repetir" nombre (ej. cada sede con su
 * "Víveres y Art. Limpieza"), si el nombre ya está ocupado le añadimos la sede
 * (el padre) como sufijo — invisible en la vista (ver nombreCortoAlmacen).
 */
async function nombreUnicoSubalmacen(base: string, parentNombre: string, exceptoId?: string): Promise<string> {
  if (!(await nombreOcupado(base, exceptoId))) return base;
  const conSede = `${base} · ${parentNombre}`;
  if (!(await nombreOcupado(conSede, exceptoId))) return conSede;
  let i = 2;
  while (await nombreOcupado(`${conSede} (${i})`, exceptoId)) i++;
  return `${conSede} (${i})`;
}

/** Nombre visible de un subalmacén: oculta el sufijo " · <padre>" que agregamos
 *  para mantener único el nombre guardado (ver nombreUnicoSubalmacen). */
export function nombreCortoAlmacen(a: Almacen, todos: Almacen[]): string {
  if (!a.parent_id) return a.nombre;
  const padre = todos.find((x) => x.id === a.parent_id);
  const sufijo = padre ? ` · ${padre.nombre}` : '';
  return sufijo && a.nombre.endsWith(sufijo) ? a.nombre.slice(0, -sufijo.length) : a.nombre;
}

export async function crearAlmacen(input: AlmacenInput, actorEmail?: string): Promise<Almacen> {
  let nombre = input.nombre.trim();
  if (!nombre) throw new Error('El nombre del almacén es obligatorio');
  const parentId = input.parent_id ?? null;
  // El subalmacén hereda la sede de su padre; el principal usa la indicada.
  let sede = input.sede?.trim() || null;
  // Espacio: el subalmacén hereda el del padre; si no, el indicado (default 'principal').
  let espacio = input.espacio?.trim() || 'principal';
  if (parentId) {
    const { data: padre } = await supabase.from(TABLE).select('nombre, sede, espacio').eq('id', parentId).single();
    const p = padre as { nombre?: string; sede?: string | null; espacio?: string | null } | null;
    nombre = await nombreUnicoSubalmacen(nombre, p?.nombre ?? 'sede');
    sede = p?.sede ?? sede;
    espacio = p?.espacio ?? espacio;
  }
  const payload = {
    nombre,
    ubicacion: input.ubicacion?.trim() || null,
    sede,
    parent_id: parentId,
    espacio,
    created_by: actorEmail ?? null,
  };
  const { data, error } = await supabase.from(TABLE).insert(payload).select('*').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ya existe un almacén con ese nombre');
    throw error;
  }
  return data as Almacen;
}

export async function actualizarAlmacen(id: string, patch: Partial<AlmacenInput>): Promise<Almacen> {
  // El NOMBRE es la "llave" textual del stock (existencias/movimientos/etc. lo
  // referencian por texto). Si cambia, se renombra vía RPC que propaga el nuevo
  // nombre a todas esas tablas en una transacción (no orfana las existencias).
  if (patch.nombre !== undefined) {
    const nombre = patch.nombre.trim();
    if (!nombre) throw new Error('El nombre del almacén no puede estar vacío');
    const { data: actual } = await supabase.from(TABLE).select('nombre').eq('id', id).single();
    const nombreActual = (actual as { nombre?: string } | null)?.nombre ?? null;
    if (nombre !== nombreActual) {
      const { error: rpcErr } = await supabase.rpc('rename_almacen', { p_id: id, p_nuevo: nombre });
      if (rpcErr) throw new Error(rpcErr.message || 'No se pudo renombrar el almacén');
    }
  }
  // Resto de campos (ubicación/sede/padre): update normal.
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.ubicacion !== undefined) payload.ubicacion = patch.ubicacion?.trim() || null;
  if (patch.sede !== undefined) payload.sede = patch.sede?.trim() || null;
  if (patch.parent_id !== undefined) payload.parent_id = patch.parent_id ?? null;
  const { data, error } = await supabase.from(TABLE).update(payload).eq('id', id).select('*').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ya existe un almacén con ese nombre');
    throw error;
  }
  return data as Almacen;
}

/**
 * Renombra una SEDE: la sede es solo una etiqueta de agrupación sobre `almacenes`
 * (los productos referencian el NOMBRE del almacén, no la sede), así que renombrarla
 * es actualizar el campo `sede` de todos los almacenes de esa sede. `actual = null`
 * cubre el grupo «Sin sede» (les asigna la nueva sede).
 */
export async function renombrarSede(actual: string | null, nuevo: string): Promise<void> {
  const nombre = nuevo.trim();
  if (!nombre) throw new Error('El nombre de la sede no puede estar vacío');
  const base = supabase.from(TABLE).update({ sede: nombre, updated_at: new Date().toISOString() });
  const { error } = await (actual == null ? base.is('sede', null) : base.eq('sede', actual));
  if (error) throw error;
}

export async function eliminarAlmacen(id: string, nombre: string, reasignarProductosA?: string | null): Promise<void> {
  // Bloquea si hay existencias con stock en este almacén.
  const { data, error: cErr } = await supabase
    .from('existencias')
    .select('stock')
    .eq('almacen', nombre)
    .gt('stock', 0);
  if (cErr) throw cErr;
  if ((data ?? []).length > 0) {
    throw new Error(`No se puede eliminar: hay ${(data ?? []).length} producto(s) con stock en este almacén`);
  }
  // Bloquea si tiene subalmacenes: primero hay que moverlos o eliminarlos.
  const { data: hijos, error: hErr } = await supabase.from(TABLE).select('id').eq('parent_id', id);
  if (hErr) throw hErr;
  if ((hijos ?? []).length > 0) {
    throw new Error(`No se puede eliminar: este almacén tiene ${(hijos ?? []).length} subalmacén(es). Eliminá o reasigná los subalmacenes primero.`);
  }
  // Productos cuyo almacén "hogar" (productos.almacen, texto) es este: si quedan apuntando al
  // nombre borrado, el almacén reaparece en los desplegables (getNombresAlmacenes los junta) y
  // el producto queda anclado a un almacén inexistente. Se reasignan al destino elegido.
  const { data: hogar, error: pErr } = await supabase.from('productos').select('id').eq('almacen', nombre);
  if (pErr) throw pErr;
  const nHogar = (hogar ?? []).length;
  if (nHogar > 0) {
    const destino = (reasignarProductosA ?? '').trim();
    if (!destino) {
      throw new Error(`No se puede eliminar: ${nHogar} producto(s) tienen a «${nombre}» como su almacén principal. Elegí a qué almacén se reasignan.`);
    }
    const { error: rErr } = await supabase.from('productos').update({ almacen: destino, updated_at: new Date().toISOString() }).eq('almacen', nombre);
    if (rErr) throw rErr;
  }
  // Filas de existencias en 0 (fantasmas) que apuntan a este nombre: se limpian para que el
  // almacén no reaparezca en las vistas por sede después de borrado.
  const { error: fErr } = await supabase.from('existencias').delete().eq('almacen', nombre).lte('stock', 0);
  if (fErr) throw fErr;
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/** Todas las existencias (stock + costo por almacén). */
export async function listExistencias(): Promise<Existencia[]> {
  // Cacheada (SWR) con TTL corto: el stock cambia seguido, pero realtime
  // (tabla `existencias`) la invalida al instante ante cualquier movimiento.
  return cachedQuery('inv:existencias', async () => {
    // Por páginas: en producción hay más de 1.000 existencias (tope por respuesta de
    // Supabase); una sola llamada las cortaba y esos productos «no aparecían» en su sede.
    return todasLasFilas<Existencia>((desde, hasta) =>
      supabase.from('existencias').select('*').order('producto_id').order('almacen').range(desde, hasta));
  }, { tables: ['existencias'], ttl: 15_000 });
}

/** Crea (si no existe) la existencia en 0 de un producto en su almacén hogar.
 *  Las vistas por sede/almacén listan desde `existencias`, así que un producto
 *  recién creado SIN stock quedaba invisible ahí (solo vivía en el catálogo).
 *  Esta fila "ancla" el producto a su almacén y fija el PMP base (costo). No
 *  pisa una existencia previa: si ya hay fila, la deja tal cual. */
/** Existencias de UN producto (todas las sedes y espacios). Consulta acotada por producto:
 *  no depende de `listExistencias()`, que trae la tabla entera y en producción supera el
 *  tope de 1.000 filas por respuesta. */
export async function listExistenciasDeProducto(productoId: string): Promise<Existencia[]> {
  return cachedQuery(`inv:existencias:prod:${productoId}`, async () => {
    const { data, error } = await supabase.from('existencias').select('*').eq('producto_id', productoId);
    if (error) throw error;
    return (data ?? []) as Existencia[];
  }, { tables: ['existencias'], ttl: 15_000 });
}

export async function crearExistenciaInicial(productoId: string, almacen: string, costo = 0): Promise<void> {
  const alm = (almacen || 'General').trim() || 'General';
  const previa = await getExistencia(productoId, alm);
  if (previa) return;
  const { error } = await supabase.from('existencias').insert({
    producto_id: productoId,
    almacen: alm,
    stock: 0,
    costo_promedio: costo || 0,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Existencia de un producto en un almacén (null si no hay fila). */
export async function getExistencia(productoId: string, almacen: string): Promise<Existencia | null> {
  const { data, error } = await supabase
    .from('existencias')
    .select('*')
    .eq('producto_id', productoId)
    .eq('almacen', almacen)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Existencia | null;
}

/** Valor total ($), nº de productos y unidades por almacén, a partir de existencias.
 *  El costo usado es el PMP propio de cada almacén. */
export function agruparValores(existencias: Existencia[]): Record<string, AlmacenValor> {
  return existencias.reduce<Record<string, AlmacenValor>>((acc, e) => {
    const key = e.almacen || 'General';
    const stock = Number(e.stock) || 0;
    if (stock === 0) return acc; // no contar filas fantasma (stock 0) en el nº de productos
    const acc0 = acc[key] ?? { valor: 0, items: 0, unidades: 0 };
    acc0.valor += stock * (Number(e.costo_promedio) || 0);
    acc0.items += 1;
    acc0.unidades += stock;
    acc[key] = acc0;
    return acc;
  }, {});
}

export async function valoresPorAlmacen(): Promise<Record<string, AlmacenValor>> {
  return agruparValores(await listExistencias());
}

/** Entradas/salidas por producto dentro de un almacén (desde movimientos de ese almacén). */
export async function movStatsDeAlmacen(almacen: string): Promise<Map<string, { entradas: number; salidas: number }>> {
  const map = new Map<string, { entradas: number; salidas: number }>();
  const { data, error } = await supabase.from('movimientos').select('producto_id, delta').eq('almacen', almacen);
  if (error) throw error;
  (data ?? []).forEach((row) => {
    const r = row as { producto_id: string; delta: number | null };
    const d = Number(r.delta) || 0;
    const cur = map.get(r.producto_id) ?? { entradas: 0, salidas: 0 };
    if (d > 0) cur.entradas += d;
    else if (d < 0) cur.salidas += Math.abs(d);
    map.set(r.producto_id, cur);
  });
  return map;
}

export interface ConsumoProducto {
  /** Total de unidades consumidas/salidas del producto en este almacén. */
  usados: number;
  /** Promedio de consumo por día (usados ÷ días desde el primer movimiento). */
  diario: number;
}

/**
 * Consumo por producto dentro de un almacén, calculado SOLO a partir de las
 * salidas realizadas (movimientos tipo 'salida'): total usado y consumo diario
 * promedio (usados ÷ días desde la primera salida).
 */
export async function consumoDeAlmacen(almacen: string): Promise<Map<string, ConsumoProducto>> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('producto_id, delta, at')
    .eq('almacen', almacen)
    .eq('tipo', 'salida');
  if (error) throw error;

  const acc = new Map<string, { usados: number; primera: number }>();
  const ahora = Date.now();
  (data ?? []).forEach((row) => {
    const r = row as { producto_id: string; delta: number | null; at: string };
    const usado = Math.abs(Number(r.delta) || 0);
    const t = new Date(r.at).getTime();
    const cur = acc.get(r.producto_id) ?? { usados: 0, primera: ahora };
    cur.usados += usado;
    if (Number.isFinite(t) && t < cur.primera) cur.primera = t;
    acc.set(r.producto_id, cur);
  });

  const out = new Map<string, ConsumoProducto>();
  acc.forEach((v, pid) => {
    const dias = Math.max(1, Math.ceil((ahora - v.primera) / 86400000));
    out.set(pid, { usados: v.usados, diario: Math.round((v.usados / dias) * 100) / 100 });
  });
  return out;
}

/** Una fila de consumo por producto en un almacén (cantidad + $). */
export interface ConsumoItemAlmacen {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  cantidad: number;   // total consumido en el período
  valor: number;      // equivalente en $ (cantidad × costo)
}

/**
 * Consumo POR PRODUCTO de un almacén en un rango de fechas. Cuenta las salidas
 * y los consumos de fundición (tipos 'salida' y 'consumo'). El valor en $ usa el
 * costo promedio guardado en el movimiento; si falta, el PMP del producto.
 */
export async function consumoPorProductoEnAlmacen(
  almacen: string, desde: Date, hasta: Date,
): Promise<ConsumoItemAlmacen[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('producto_id, delta, costo_promedio, at, producto:productos(sku, nombre, unidad, precio_promedio, precio)')
    .eq('almacen', almacen)
    .in('tipo', ['salida', 'consumo'])
    .gte('at', desde.toISOString())
    .lte('at', hasta.toISOString());
  if (error) throw error;

  const acc = new Map<string, ConsumoItemAlmacen>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const pid = row.producto_id as string;
    const cant = Math.abs(Number(row.delta) || 0);
    if (cant <= 0) continue;
    const prod = (row.producto ?? {}) as { sku?: string; nombre?: string; unidad?: string; precio_promedio?: number; precio?: number };
    const costo = Number(row.costo_promedio) || Number(prod.precio_promedio) || Number(prod.precio) || 0;
    const cur = acc.get(pid) ?? {
      producto_id: pid, sku: prod.sku ?? '—', nombre: prod.nombre ?? '—', unidad: prod.unidad ?? 'und', cantidad: 0, valor: 0,
    };
    cur.cantidad += cant;
    cur.valor += cant * costo;
    acc.set(pid, cur);
  }
  return Array.from(acc.values()).map((x) => ({
    ...x,
    cantidad: Math.round(x.cantidad * 100) / 100,
    valor: Math.round(x.valor * 100) / 100,
  }));
}
