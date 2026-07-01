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

/** Un víver disponible para la cocina: producto de categoría VÍVERES + su stock total. */
export interface ViverDisponible {
  producto: Producto;
  stock: number;          // suma de existencias en todos los almacenes
  precio: number;         // precio del inventario
  almacenMasStock: string | null; // almacén con más stock (de donde se descuenta)
}

/**
 * Trae los artículos de la categoría VÍVERES con su stock. Si se indica un `almacen`
 * (el vinculado a la cocina), el stock y el descuento salen SOLO de ese almacén y se
 * listan únicamente los víveres que existen ahí (cada cocina ve su propio inventario).
 * Sin `almacen` (legado) agrega el stock de todos los almacenes.
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
    if ((p.categoria ?? '').trim().toUpperCase() !== CATEGORIA_VIVERES || p.estado !== 'activo') continue;
    const exs = porProducto.get(p.id) ?? [];
    if (almacen) {
      const row = exs.find((e) => e.almacen === almacen);
      if (!row) continue;   // este víver no pertenece al almacén de esta cocina
      out.push({ producto: p, stock: Math.round((Number(row.stock) || 0) * 100) / 100, precio: Number(p.precio) || 0, almacenMasStock: almacen });
    } else {
      const stock = exs.reduce((a, e) => a + (Number(e.stock) || 0), 0);
      const mejor = exs.filter((e) => Number(e.stock) > 0).sort((a, b) => Number(b.stock) - Number(a.stock))[0];
      out.push({ producto: p, stock: Math.round(stock * 100) / 100, precio: Number(p.precio) || 0, almacenMasStock: mejor?.almacen ?? p.almacen ?? null });
    }
  }
  return out.sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
}

/** Víveres CON stock desglosados por almacén (para el resumen de cada tarjeta de cocina). */
interface ViverEnAlmacen { producto_id: string; almacen: string; stock: number; precio: number }
async function listViveresConStock(): Promise<ViverEnAlmacen[]> {
  const [productos, existencias] = await Promise.all([listProductos(), listExistencias()]);
  const precioViver = new Map<string, number>();
  for (const p of productos) {
    if ((p.categoria ?? '').trim().toUpperCase() === CATEGORIA_VIVERES && p.estado === 'activo') precioViver.set(p.id, Number(p.precio) || 0);
  }
  return existencias
    .filter((e) => precioViver.has(e.producto_id) && Number(e.stock) > 0)
    .map((e) => ({ producto_id: e.producto_id, almacen: e.almacen, stock: Number(e.stock) || 0, precio: precioViver.get(e.producto_id) ?? 0 }));
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
  return (data ?? []) as CocinaComida[];
}

/** Próximo correlativo COC-AAAA-NNNN por el MÁXIMO sufijo (no por conteo). */
async function nextCodigoCocina(): Promise<string> {
  const year = new Date().getFullYear();
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

  const viveres = await listViveres(input.almacen ?? null);
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
  const codigo = await nextCodigoCocina();

  const { data, error } = await supabase.from(TABLE).insert({
    codigo,
    tipo_comida: input.tipoComida,
    platos: Number(input.platos) || 0,
    items,
    valor_total: valorTotal,
    nota: input.nota?.trim() || null,
    cocina_id: input.cocinaId ?? null,
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
