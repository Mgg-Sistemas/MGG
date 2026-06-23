/* ============================================================
   MGG · Control de Alimentación (Cocina)
   Registra el consumo de VÍVERES por comida (desayuno/almuerzo/cena).
   Cada movimiento toma los precios del inventario, descuenta el stock
   de los víveres consumidos (salida en el kardex) y guarda el detalle.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { CocinaComida, ItemCocina, TipoComida, Producto, Existencia } from '@/shared/lib/types';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listExistencias } from '@/modules/inventario/almacenes.repository';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';

const TABLE = 'cocina_comidas';
/** Categoría del inventario que surte la cocina. */
export const CATEGORIA_VIVERES = 'VIVERES';

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

/** Trae SOLO los artículos de la categoría VÍVERES desde el inventario, con su stock. */
export async function listViveres(): Promise<ViverDisponible[]> {
  const [productos, existencias] = await Promise.all([listProductos(), listExistencias()]);
  const porProducto = new Map<string, Existencia[]>();
  for (const e of existencias) {
    const arr = porProducto.get(e.producto_id) ?? [];
    arr.push(e); porProducto.set(e.producto_id, arr);
  }
  return productos
    .filter((p) => (p.categoria ?? '').trim().toUpperCase() === CATEGORIA_VIVERES && p.estado === 'activo')
    .map((p) => {
      const exs = porProducto.get(p.id) ?? [];
      const stock = exs.reduce((a, e) => a + (Number(e.stock) || 0), 0);
      const mejor = exs.filter((e) => Number(e.stock) > 0).sort((a, b) => Number(b.stock) - Number(a.stock))[0];
      return {
        producto: p,
        stock: Math.round(stock * 100) / 100,
        precio: Number(p.precio) || 0,
        almacenMasStock: mejor?.almacen ?? p.almacen ?? null,
      };
    })
    .sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
}

/* ───────── Listado / filtros ───────── */

export interface FiltrosCocina {
  desde?: string | null;   // ISO
  hasta?: string | null;   // ISO
  tipo?: TipoComida | null;
}

export async function listComidas(filtros?: FiltrosCocina): Promise<CocinaComida[]> {
  let q = supabase.from(TABLE).select('*').order('at', { ascending: false });
  if (filtros?.tipo) q = q.eq('tipo_comida', filtros.tipo);
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
  actor: string;
  actorName?: string | null;
}

/**
 * Registra una comida: arma el detalle con los precios del inventario, descuenta
 * el stock de cada víver (salida en el kardex) y guarda la comida con su correlativo.
 */
export async function crearComida(input: CrearComidaInput): Promise<CocinaComida> {
  const lineas = (input.items ?? []).filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0);
  if (!lineas.length) throw new Error('Agregá al menos un víver con cantidad.');
  if ((Number(input.platos) || 0) <= 0) throw new Error('Indicá cuántos platos se realizaron.');

  const viveres = await listViveres();
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
