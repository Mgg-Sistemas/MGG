/* ============================================================
   MGG · Control de Alimentación (Cocina)
   Registra el consumo de VÍVERES por comida (desayuno/almuerzo/cena).
   Cada movimiento toma los precios del inventario, descuenta el stock
   de los víveres consumidos (salida en el kardex) y guarda el detalle.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { CocinaComida, ItemCocina, TipoComida, Producto, Existencia, Cocina, Almacen } from '@/shared/lib/types';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listExistencias, listAlmacenes } from '@/modules/inventario/almacenes.repository';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';

const TABLE = 'cocina_comidas';
/** Categoría del inventario que surte la cocina. */
export const CATEGORIA_VIVERES = 'VIVERES';
/** Categorías del inventario que surten la distribución de comida:
 *  Víveres, Carnes/Proteína, Alimentos (arroz, pasta, azúcar…), Hortalizas y
 *  legumbres, y Limpieza (incluye las variantes de limpieza del catálogo). */
export const CATEGORIAS_COCINA = [
  'VIVERES',
  'ALIMENTOS',
  'CARNES',
  'PROTEINA',
  'HORTALIZAS Y LEGUMBRES',
  'LIMPIEZA',
  'MATERIAL DE LIMPIEZA',
];
/** ¿La categoría de un producto surte la distribución de comida? */
export function esCategoriaCocina(cat?: string | null): boolean {
  return CATEGORIAS_COCINA.includes((cat ?? '').trim().toUpperCase());
}

/* ───────── Cocinas (cada una vinculada a un almacén/subalmacén) ───────── */

/** Una cocina con el nombre de su almacén vinculado y un resumen de su stock de víveres. */
export interface CocinaConInfo {
  cocina: Cocina;
  almacenNombre: string | null;   // nombre actual del almacén vinculado
  viveres: number;                // nº de víveres con stock en ese almacén
  valorStock: number;             // Σ stock × precio de esos víveres
}

/** Lista las cocinas activas con su almacén vinculado y un resumen de stock. */
export async function listCocinas(): Promise<CocinaConInfo[]> {
  const [{ data, error }, almacenes, viveres] = await Promise.all([
    supabase.from('cocinas').select('*').eq('activa', true).order('nombre', { ascending: true }),
    listAlmacenes(),
    listViveresConStock(),
  ]);
  if (error) throw error;
  const almById = new Map(almacenes.map((a) => [a.id, a] as const));
  return (data ?? []).map((row) => {
    const c = row as Cocina;
    const alm = c.almacen_id ? almById.get(c.almacen_id) ?? null : null;
    const nombre = alm?.nombre ?? null;
    const delAlmacen = nombre ? viveres.filter((v) => v.almacen === nombre) : [];
    return {
      cocina: c,
      almacenNombre: nombre,
      viveres: delAlmacen.length,
      valorStock: Math.round(delAlmacen.reduce((a, v) => a + v.stock * v.precio, 0) * 100) / 100,
    };
  });
}

export async function crearCocina(input: { nombre: string; almacenId: string | null; actor?: string | null }): Promise<Cocina> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('Indicá el nombre de la cocina.');
  const { data, error } = await supabase.from('cocinas')
    .insert({ nombre, almacen_id: input.almacenId, created_by: input.actor ?? null })
    .select('*').single();
  if (error) throw error;
  return data as Cocina;
}

export async function actualizarCocina(id: string, patch: { nombre?: string; almacenId?: string | null }): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.nombre !== undefined) { const n = patch.nombre.trim(); if (!n) throw new Error('El nombre no puede quedar vacío.'); payload.nombre = n; }
  if (patch.almacenId !== undefined) payload.almacen_id = patch.almacenId;
  const { error } = await supabase.from('cocinas').update(payload).eq('id', id);
  if (error) throw error;
}

/** Inhabilita la cocina (soft delete). Sus comidas quedan en el histórico. */
export async function eliminarCocina(id: string): Promise<void> {
  const { error } = await supabase.from('cocinas').update({ activa: false }).eq('id', id);
  if (error) throw error;
}

/** Almacenes elegibles para vincular a una cocina (todos, principal y subalmacenes). */
export async function listAlmacenesParaCocina(): Promise<Almacen[]> {
  return listAlmacenes();
}

export const TIPOS_COMIDA: { value: TipoComida; label: string; icon: string }[] = [
  { value: 'desayuno', label: 'Desayuno', icon: '🍳' },
  { value: 'almuerzo', label: 'Almuerzo', icon: '🍽' },
  { value: 'cena',     label: 'Cena',     icon: '🌙' },
];

export function labelTipoComida(t: TipoComida): string {
  return TIPOS_COMIDA.find((x) => x.value === t)?.label ?? t;
}

/**
 * Orden del día: desayuno → almuerzo → cena.
 *
 * La fecha de una comida se guarda al MEDIODÍA (`fecha + T12:00:00`), así que las
 * tres comidas de un mismo día tienen el MISMO `at` hasta el minuto. Ordenar solo
 * por `at` las deja empatadas y el desempate lo decide el orden en que se cargaron:
 * un día registrado empezando por la cena se lee «cena, desayuno, almuerzo».
 * Este índice es el desempate.
 */
export function ordenTipoComida(t: TipoComida | null | undefined): number {
  const i = TIPOS_COMIDA.findIndex((x) => x.value === t);
  return i < 0 ? TIPOS_COMIDA.length : i;   // un tipo desconocido va al final
}

/** El día de una comida (YYYY-MM-DD), que es lo que de verdad la ubica en el ciclo. */
export const diaDeComida = (at: string | null | undefined): string => String(at ?? '').slice(0, 10);

/**
 * Comparador del listado de comidas: día más NUEVO primero —lo de hoy queda a la
 * vista sin scrollear los 21 días del ciclo— y, dentro de cada día, las comidas
 * en el orden en que se sirven.
 */
export function compararComidas(
  a: { at?: string | null; tipo_comida?: TipoComida | null },
  b: { at?: string | null; tipo_comida?: TipoComida | null },
): number {
  const dia = diaDeComida(b.at).localeCompare(diaDeComida(a.at));
  if (dia !== 0) return dia;
  const tipo = ordenTipoComida(a.tipo_comida) - ordenTipoComida(b.tipo_comida);
  if (tipo !== 0) return tipo;
  // Mismo día y misma comida (se corrigió y se volvió a cargar): la más reciente arriba.
  return String(b.at ?? '').localeCompare(String(a.at ?? ''));
}

/** Un víver disponible para la cocina: producto de categoría VÍVERES + su stock total. */
export interface ViverDisponible {
  producto: Producto;
  stock: number;          // suma de existencias en todos los almacenes
  precio: number;         // precio del inventario
  almacenMasStock: string | null; // almacén con más stock (de donde se descuenta)
}

/**
 * Trae los artículos disponibles para la cocina con su stock. Con `almacen` (el
 * vinculado a la cocina) la cocina refleja EXACTAMENTE el inventario de ese almacén:
 * todos los productos activos que existan ahí (sin filtrar por categoría), y el
 * descuento sale de ese almacén. Sin `almacen` (legado) usa solo la categoría VÍVERES
 * agregando todos los almacenes.
 */
export async function listViveres(almacen?: string | null): Promise<ViverDisponible[]> {
  const [productos, existencias] = await Promise.all([listProductos(), listExistencias()]);
  const porProducto = new Map<string, Existencia[]>();
  for (const e of existencias) {
    const arr = porProducto.get(e.producto_id) ?? [];
    arr.push(e); porProducto.set(e.producto_id, arr);
  }
  const out: ViverDisponible[] = [];
  for (const p of productos) {
    if (p.estado !== 'activo') continue;
    const exs = porProducto.get(p.id) ?? [];
    if (almacen) {
      // Cocina vinculada a un almacén: se sincroniza con la lista de ESE almacén
      // (cualquier producto que exista ahí, sin importar la categoría).
      const row = exs.find((e) => e.almacen === almacen);
      if (!row) continue;
      out.push({ producto: p, stock: Math.round((Number(row.stock) || 0) * 100) / 100, precio: Number(p.precio) || 0, almacenMasStock: almacen });
    } else {
      // Legado (sin almacén vinculado): solo Víveres y Proteína, agregando todos los almacenes.
      if (!esCategoriaCocina(p.categoria)) continue;
      const stock = exs.reduce((a, e) => a + (Number(e.stock) || 0), 0);
      const mejor = exs.filter((e) => Number(e.stock) > 0).sort((a, b) => Number(b.stock) - Number(a.stock))[0];
      out.push({ producto: p, stock: Math.round(stock * 100) / 100, precio: Number(p.precio) || 0, almacenMasStock: mejor?.almacen ?? p.almacen ?? null });
    }
  }
  return out.sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
}

/**
 * Víveres disponibles para la cocina, ACOTADOS A SU CENTRO (sede). Se toma la sede del
 * almacén vinculado (`preferAlmacen`) y se consideran SOLO los almacenes de esa sede:
 * así la cocina de La Esperanza ve únicamente lo de La Esperanza, y la de Los Pinos lo
 * de Los Pinos. El stock es la suma dentro del centro; el descuento sale del almacén
 * vinculado si ahí hay existencia, o del que más tenga dentro del centro.
 * Sin almacén vinculado (legado) cae al comportamiento global (todos los almacenes).
 */
export async function listViveresGlobal(preferAlmacen?: string | null): Promise<ViverDisponible[]> {
  const [productos, existencias, almacenes] = await Promise.all([listProductos(), listExistencias(), listAlmacenes()]);

  // Alcance por CENTRO: nombres de almacén que pertenecen a la misma sede que el vinculado.
  const sedeDe = new Map(almacenes.map((a) => [a.nombre, a.sede ?? null] as const));
  const sedeObjetivo = preferAlmacen ? sedeDe.get(preferAlmacen) ?? null : null;
  const almacenesScope: Set<string> | null = preferAlmacen
    ? new Set(
        sedeObjetivo
          ? almacenes.filter((a) => (a.sede ?? null) === sedeObjetivo).map((a) => a.nombre)
          : [preferAlmacen], // almacén sin sede: se acota al propio almacén
      )
    : null; // sin almacén vinculado (legado): global

  const porProducto = new Map<string, Existencia[]>();
  for (const e of existencias) {
    if (almacenesScope && !almacenesScope.has(e.almacen)) continue; // fuera del centro
    const arr = porProducto.get(e.producto_id) ?? [];
    arr.push(e); porProducto.set(e.producto_id, arr);
  }
  // Los víveres NO viven en subalmacenes (los únicos subalmacenes son casiterita y
  // estaño). La cocina surte del almacén PRINCIPAL de su sede: el raíz que NO es de
  // casiterita ni estaño (ej. "La Esperanza", "Los Pinos"). Si ahí no hay stock del
  // víver, cae al almacén vinculado y, por último, al de más stock del centro.
  const esSegmentado = (n: string) => /casiterita|esta[nñ]o|sno|refinad|bruto/i.test(n);
  const principalSede = sedeObjetivo
    ? (almacenes.find((a) => (a.sede ?? null) === sedeObjetivo && !a.parent_id && !esSegmentado(a.nombre))?.nombre ?? null)
    : null;

  const out: ViverDisponible[] = [];
  for (const p of productos) {
    if (p.estado !== 'activo') continue;
    if (!esCategoriaCocina(p.categoria)) continue;
    const exs = porProducto.get(p.id) ?? [];
    // Acotado al centro: si el producto no existe en este centro, no se muestra.
    if (almacenesScope && exs.length === 0) continue;
    const stock = exs.reduce((a, e) => a + (Number(e.stock) || 0), 0);
    const conStock = exs.filter((e) => Number(e.stock) > 0).sort((a, b) => Number(b.stock) - Number(a.stock));
    // Descuento: el PRINCIPAL de la sede; si no, el almacén vinculado a la cocina; y
    // como último recurso el que más stock tenga dentro del centro.
    const preferido = (principalSede ? conStock.find((e) => e.almacen === principalSede) : undefined)
      ?? (preferAlmacen ? conStock.find((e) => e.almacen === preferAlmacen) : undefined);
    const mejor = preferido ?? conStock[0];
    out.push({ producto: p, stock: Math.round(stock * 100) / 100, precio: Number(p.precio) || 0, almacenMasStock: mejor?.almacen ?? p.almacen ?? null });
  }
  return out.sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
}

/** Productos CON stock desglosados por almacén (para el resumen de cada tarjeta de
 *  cocina): refleja el inventario real del almacén vinculado, no una sola categoría. */
interface ViverEnAlmacen { producto_id: string; almacen: string; stock: number; precio: number }
async function listViveresConStock(): Promise<ViverEnAlmacen[]> {
  const [productos, existencias] = await Promise.all([listProductos(), listExistencias()]);
  const precioProd = new Map<string, number>();
  for (const p of productos) {
    if (p.estado === 'activo') precioProd.set(p.id, Number(p.precio) || 0);
  }
  return existencias
    .filter((e) => precioProd.has(e.producto_id) && Number(e.stock) > 0)
    .map((e) => ({ producto_id: e.producto_id, almacen: e.almacen, stock: Number(e.stock) || 0, precio: precioProd.get(e.producto_id) ?? 0 }));
}

/* ───────── Listado / filtros ───────── */

export interface FiltrosCocina {
  desde?: string | null;   // ISO
  hasta?: string | null;   // ISO
  tipo?: TipoComida | null;
  cocinaId?: string | null;   // filtra las comidas de una cocina
}

export async function listComidas(filtros?: FiltrosCocina): Promise<CocinaComida[]> {
  let q = supabase.from(TABLE).select('*').order('at', { ascending: false });
  if (filtros?.tipo) q = q.eq('tipo_comida', filtros.tipo);
  if (filtros?.cocinaId) q = q.eq('cocina_id', filtros.cocinaId);
  if (filtros?.desde) q = q.gte('at', filtros.desde);
  if (filtros?.hasta) q = q.lte('at', filtros.hasta);
  const { data, error } = await q;
  if (error) throw error;
  // El `order('at')` de arriba no alcanza: las tres comidas de un día comparten `at`.
  return ((data ?? []) as CocinaComida[]).sort(compararComidas);
}

/** Próximo correlativo COC-AAAA-NNNN por el MÁXIMO sufijo (no por conteo). */
async function nextCodigoCocina(year = new Date().getFullYear()): Promise<string> {
  const { data, error } = await supabase
    .from(TABLE).select('codigo').like('codigo', `COC-${year}-%`);
  if (error) throw error;
  const max = (data ?? []).reduce((m, r) => {
    const n = Number(String((r as { codigo: string }).codigo).match(/-(\d+)$/)?.[1] ?? 0);
    return n > m ? n : m;
  }, 0);
  return `COC-${year}-${String(max + 1).padStart(4, '0')}`;
}

/* ───────── Crear movimiento de comida ───────── */

export interface CrearComidaInput {
  tipoComida: TipoComida;
  platos: number;
  items: { producto_id: string; cantidad: number }[];
  nota?: string | null;
  /** Cocina donde se preparó (marca la comida y su almacén surte/descuenta los víveres). */
  cocinaId?: string | null;
  /** Almacén vinculado a la cocina (de ahí salen los precios y el descuento de stock). */
  almacen?: string | null;
  /** Fecha de la comida (YYYY-MM-DD). Por defecto hoy; permite cargar un día desfasado. */
  fecha?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Registra una comida: arma el detalle con los precios del inventario, descuenta
 * el stock de cada víver (salida en el kardex) y guarda la comida con su correlativo.
 * Si la comida es de una cocina, los víveres y el descuento salen de SU almacén.
 */
export async function crearComida(input: CrearComidaInput): Promise<CocinaComida> {
  const lineas = (input.items ?? []).filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0);
  if (!lineas.length) throw new Error('Agregá al menos un víver con cantidad.');
  if ((Number(input.platos) || 0) <= 0) throw new Error('Indicá cuántos platos se realizaron.');

  // Se resuelven contra TODOS los víveres del inventario (sin importar el almacén);
  // el descuento sale del almacén de la cocina si ahí hay stock, o del que más tenga.
  const viveres = await listViveresGlobal(input.almacen ?? null);
  const mapV = new Map(viveres.map((v) => [v.producto.id, v]));

  const items: ItemCocina[] = [];
  for (const l of lineas) {
    const v = mapV.get(l.producto_id);
    if (!v) throw new Error('Un producto seleccionado ya no está en VÍVERES.');
    const cantidad = Number(l.cantidad) || 0;
    const precio = Number(v.precio) || 0;
    items.push({
      producto_id: v.producto.id, sku: v.producto.sku, nombre: v.producto.nombre,
      unidad: v.producto.unidad, cantidad, precio, subtotal: Math.round(cantidad * precio * 100) / 100,
      almacen: v.almacenMasStock,
    });
  }
  const valorTotal = Math.round(items.reduce((a, it) => a + it.subtotal, 0) * 100) / 100;

  // Fecha de la comida: si se indicó una distinta de HOY (día desfasado), se registra ese
  // día a mediodía local (evita que la zona horaria corra la fecha). Si es hoy (o no se
  // indicó), se deja el timestamp actual (default de la BD) para conservar el orden real.
  const hoyStr = new Date().toISOString().slice(0, 10);
  const fecha = input.fecha && /^\d{4}-\d{2}-\d{2}$/.test(input.fecha) ? input.fecha : null;
  const atOverride = fecha && fecha !== hoyStr ? new Date(`${fecha}T12:00:00`).toISOString() : null;
  const codigo = await nextCodigoCocina(fecha ? Number(fecha.slice(0, 4)) : undefined);

  const { data, error } = await supabase.from(TABLE).insert({
    codigo,
    tipo_comida: input.tipoComida,
    platos: Number(input.platos) || 0,
    items,
    valor_total: valorTotal,
    nota: input.nota?.trim() || null,
    cocina_id: input.cocinaId ?? null,
    ...(atOverride ? { at: atOverride } : {}),
    actor: input.actor,
    actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  const comida = data as CocinaComida;

  // Descuenta el stock consumido (salida en el kardex). El movimiento de inventario
  // tope a 0 si no alcanza; no bloquea el registro de la comida.
  for (const it of items) {
    try {
      await registrarMovimiento({
        producto_id: it.producto_id, tipo: 'salida', delta: -it.cantidad,
        almacen: it.almacen ?? undefined, actor: input.actor, actor_name: input.actorName ?? null,
        ref_tipo: 'cocina', ref_id: comida.id, ref_codigo: codigo,
        detalle: `Cocina · ${labelTipoComida(input.tipoComida)} · ${codigo}`,
        precio_unitario: it.precio,
      });
    } catch { /* no bloquea: la comida queda registrada igual */ }
  }
  return comida;
}

/**
 * Edita una comida ya registrada: reversa el consumo anterior (devuelve el stock de
 * los víveres de la comida previa), recalcula el detalle con los precios actuales y
 * aplica el nuevo consumo. Conserva el correlativo. Permite cambiar tipo, platos,
 * fecha, nota y los víveres (cantidades incluidas) — editar todo.
 */
export async function editarComida(comidaId: string, input: CrearComidaInput): Promise<CocinaComida> {
  const { data: prev, error: e0 } = await supabase.from(TABLE).select('*').eq('id', comidaId).single();
  if (e0) throw e0;
  const comidaPrev = prev as CocinaComida;

  const lineas = (input.items ?? []).filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0);
  if (!lineas.length) throw new Error('Agregá al menos un víver con cantidad.');
  if ((Number(input.platos) || 0) <= 0) throw new Error('Indicá cuántos platos se realizaron.');

  // 1) Reversa el consumo anterior: devuelve al inventario el stock de cada víver previo.
  for (const it of comidaPrev.items ?? []) {
    try {
      await registrarMovimiento({
        producto_id: it.producto_id, tipo: 'entrada', delta: Number(it.cantidad) || 0,
        almacen: it.almacen ?? undefined, actor: input.actor, actor_name: input.actorName ?? null,
        ref_tipo: 'cocina', ref_id: comidaId, ref_codigo: comidaPrev.codigo,
        detalle: `Reverso por edición · ${comidaPrev.codigo}`, precio_unitario: it.precio,
      });
    } catch { /* no bloquea la edición */ }
  }

  // 2) Resolver los nuevos ítems contra los víveres del centro (precios actuales).
  const viveres = await listViveresGlobal(input.almacen ?? null);
  const mapV = new Map(viveres.map((v) => [v.producto.id, v]));
  const items: ItemCocina[] = [];
  for (const l of lineas) {
    const v = mapV.get(l.producto_id);
    if (!v) throw new Error('Un producto seleccionado ya no está disponible en este centro.');
    const cantidad = Number(l.cantidad) || 0;
    const precio = Number(v.precio) || 0;
    items.push({
      producto_id: v.producto.id, sku: v.producto.sku, nombre: v.producto.nombre,
      unidad: v.producto.unidad, cantidad, precio, subtotal: Math.round(cantidad * precio * 100) / 100,
      almacen: v.almacenMasStock,
    });
  }
  const valorTotal = Math.round(items.reduce((a, it) => a + it.subtotal, 0) * 100) / 100;

  // 3) Actualizar la comida. La fecha solo mueve el timestamp si cambió de día.
  const fecha = input.fecha && /^\d{4}-\d{2}-\d{2}$/.test(input.fecha) ? input.fecha : null;
  const fechaPrev = (comidaPrev.at ?? '').slice(0, 10);
  const patch: Record<string, unknown> = {
    tipo_comida: input.tipoComida, platos: Number(input.platos) || 0, items, valor_total: valorTotal,
    nota: input.nota?.trim() || null,
  };
  if (fecha && fecha !== fechaPrev) patch.at = new Date(`${fecha}T12:00:00`).toISOString();
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', comidaId).select('*').single();
  if (error) throw error;
  const comida = data as CocinaComida;

  // 4) Aplicar el nuevo consumo (salidas en el kardex).
  for (const it of items) {
    try {
      await registrarMovimiento({
        producto_id: it.producto_id, tipo: 'salida', delta: -it.cantidad,
        almacen: it.almacen ?? undefined, actor: input.actor, actor_name: input.actorName ?? null,
        ref_tipo: 'cocina', ref_id: comidaId, ref_codigo: comida.codigo,
        detalle: `Cocina (editado) · ${labelTipoComida(input.tipoComida)} · ${comida.codigo}`,
        precio_unitario: it.precio,
      });
    } catch { /* no bloquea */ }
  }
  return comida;
}

/** Elimina una comida y devuelve al inventario el stock que había consumido. */
export async function eliminarComida(comidaId: string, actor: string, actorName?: string | null): Promise<void> {
  const { data: prev, error: e0 } = await supabase.from(TABLE).select('*').eq('id', comidaId).single();
  if (e0) throw e0;
  const comida = prev as CocinaComida;
  for (const it of comida.items ?? []) {
    try {
      await registrarMovimiento({
        producto_id: it.producto_id, tipo: 'entrada', delta: Number(it.cantidad) || 0,
        almacen: it.almacen ?? undefined, actor, actor_name: actorName ?? null,
        ref_tipo: 'cocina', ref_id: comidaId, ref_codigo: comida.codigo,
        detalle: `Reverso por eliminación · ${comida.codigo}`, precio_unitario: it.precio,
      });
    } catch { /* no bloquea */ }
  }
  const { error } = await supabase.from(TABLE).delete().eq('id', comidaId);
  if (error) throw error;
}

/* ───────── Resumen / consumo ───────── */

export interface ResumenDia { dia: string; platos: number; valor: number }
export interface TopViver { nombre: string; sku: string; cantidad: number; unidad: string; valor: number }
export interface ResumenCocina {
  platos: number;
  valor: number;
  promedioPorPlato: number;
  porDia: ResumenDia[];
  porTipo: { tipo: TipoComida; platos: number; valor: number }[];
  topViveres: TopViver[];
}

/** Agrega un set de comidas en métricas para el panel de consumo. */
export function resumirComidas(comidas: CocinaComida[]): ResumenCocina {
  const platos = comidas.reduce((a, c) => a + (Number(c.platos) || 0), 0);
  const valor = Math.round(comidas.reduce((a, c) => a + (Number(c.valor_total) || 0), 0) * 100) / 100;
  const dias = new Map<string, ResumenDia>();
  const tipos = new Map<TipoComida, { tipo: TipoComida; platos: number; valor: number }>();
  const viv = new Map<string, TopViver>();
  for (const c of comidas) {
    const dia = (c.at ?? '').slice(0, 10);
    const d = dias.get(dia) ?? { dia, platos: 0, valor: 0 };
    d.platos += Number(c.platos) || 0; d.valor += Number(c.valor_total) || 0;
    dias.set(dia, d);
    const t = tipos.get(c.tipo_comida) ?? { tipo: c.tipo_comida, platos: 0, valor: 0 };
    t.platos += Number(c.platos) || 0; t.valor += Number(c.valor_total) || 0;
    tipos.set(c.tipo_comida, t);
    for (const it of c.items ?? []) {
      const v = viv.get(it.producto_id) ?? { nombre: it.nombre, sku: it.sku, cantidad: 0, unidad: it.unidad, valor: 0 };
      v.cantidad += Number(it.cantidad) || 0; v.valor += Number(it.subtotal) || 0;
      viv.set(it.producto_id, v);
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    platos,
    valor,
    promedioPorPlato: platos > 0 ? r2(valor / platos) : 0,
    porDia: Array.from(dias.values()).map((d) => ({ ...d, valor: r2(d.valor) })).sort((a, b) => b.dia.localeCompare(a.dia)),
    porTipo: Array.from(tipos.values()).map((t) => ({ ...t, valor: r2(t.valor) })),
    topViveres: Array.from(viv.values()).map((v) => ({ ...v, cantidad: r2(v.cantidad), valor: r2(v.valor) })).sort((a, b) => b.valor - a.valor),
  };
}
