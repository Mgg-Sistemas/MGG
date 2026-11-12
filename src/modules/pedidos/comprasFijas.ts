/* ============================================================
   MGG · Compras FIJAS (12-11-2026, traído de Golden Touch) · lógica pura.

   Plantillas de las compras que se repiten (Mercado, Papelería, Carnes,
   Pollo…). Cada una dice cada cuánto se compra, qué productos entran (por
   palabras de categoría y/o una lista fija), quién solicita y si va por
   Solicitud de Pedido (cotización → OC) o por Compra directa.
   «Generar» arma la solicitud con las cantidades de la ÚLTIMA vez que se
   generó esa misma plantilla (supabase/sql/compras-fijas-2026-11-12.sql).
   MGG: solo MERCADO viene lista. Las demás (Carnes, Pollo, Papelería) llegan como
   SUGERENCIA: se ven en el tablero, pero no avisan ni se generan hasta que Compras
   las configura (frecuencia, productos, fecha) y las guarda.
   ============================================================ */
import type { ItemOrden, Producto } from '@/shared/lib/types';

export type FrecuenciaFija = 'semanal' | 'quincenal' | 'mensual' | 'cada_dias';
export type ModoFija = 'solicitud' | 'compra_directa';

export interface ProductoFijo {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  cantidad: number;
}

export interface CompraFija {
  id: string;
  nombre: string;
  icono: string;
  frecuencia: FrecuenciaFija;
  cada_dias: number | null;
  proxima_fecha: string; // YYYY-MM-DD
  activa: boolean;
  modo: ModoFija;
  permite_cotizar: boolean;
  solicitante: string | null;
  unidad_solicitante: string | null;
  finalidad: string | null;
  urgente: boolean;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  categorias: string[];
  productos: ProductoFijo[];
  nota: string | null;
  orden: number;
  /** Plantilla sugerida que Compras todavía no ha configurado: no avisa ni se genera. */
  sugerida: boolean;
  ultima_ref_tipo: 'orden' | 'compra_directa' | null;
  ultima_ref_id: string | null;
  ultima_codigo: string | null;
  ultima_generada_en: string | null;
}

export const FRECUENCIAS: { valor: FrecuenciaFija; etiqueta: string }[] = [
  { valor: 'semanal', etiqueta: 'Semanal' },
  { valor: 'quincenal', etiqueta: 'Quincenal' },
  { valor: 'mensual', etiqueta: 'Mensual' },
  { valor: 'cada_dias', etiqueta: 'Cada cierto número de días' },
];

export function textoFrecuencia(c: Pick<CompraFija, 'frecuencia' | 'cada_dias'>): string {
  if (c.frecuencia === 'cada_dias') return `Cada ${c.cada_dias ?? 30} días`;
  return FRECUENCIAS.find((f) => f.valor === c.frecuencia)?.etiqueta ?? c.frecuencia;
}

const DIA_MS = 86_400_000;
const aFecha = (s: string) => new Date(`${s}T12:00:00Z`);
const aTexto = (d: Date) => d.toISOString().slice(0, 10);

function sumar(fecha: string, f: Pick<CompraFija, 'frecuencia' | 'cada_dias'>): string {
  const d = aFecha(fecha);
  if (f.frecuencia === 'mensual') {
    const dia = d.getUTCDate();
    const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12));
    const ultimo = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0, 12)).getUTCDate();
    n.setUTCDate(Math.min(dia, ultimo));
    return aTexto(n);
  }
  const dias = f.frecuencia === 'semanal' ? 7 : f.frecuencia === 'quincenal' ? 15 : Math.max(1, Number(f.cada_dias) || 30);
  return aTexto(new Date(d.getTime() + dias * DIA_MS));
}

/** La próxima fecha después de generarla hoy: un período después de la que tocaba;
 *  si estaba vencida, se sigue corriendo hasta pasar de hoy. */
export function siguienteFecha(c: Pick<CompraFija, 'frecuencia' | 'cada_dias' | 'proxima_fecha'>, hoy: string): string {
  let f = sumar(c.proxima_fecha || hoy, c);
  let guard = 0;
  while (f <= hoy && guard++ < 400) f = sumar(f, c);
  return f;
}

export function diasHasta(fecha: string, hoy: string): number {
  return Math.round((aFecha(fecha).getTime() - aFecha(hoy).getTime()) / DIA_MS);
}

export type EstadoFija = 'vencida' | 'hoy' | 'pronto' | 'al_dia' | 'pausada' | 'sugerida';

/** Semáforo de la tarjeta: rojo vencida, ámbar hoy o esta semana, verde al día. */
export function estadoFija(c: Pick<CompraFija, 'activa' | 'proxima_fecha'> & { sugerida?: boolean }, hoy: string): EstadoFija {
  if (c.sugerida) return 'sugerida';
  if (!c.activa) return 'pausada';
  const d = diasHasta(c.proxima_fecha, hoy);
  if (d < 0) return 'vencida';
  if (d === 0) return 'hoy';
  if (d <= 7) return 'pronto';
  return 'al_dia';
}

export function textoEstadoFija(c: Pick<CompraFija, 'activa' | 'proxima_fecha'> & { sugerida?: boolean }, hoy: string): string {
  const d = diasHasta(c.proxima_fecha, hoy);
  switch (estadoFija(c, hoy)) {
    case 'sugerida': return 'Sugerencia · por configurar';
    case 'pausada': return 'Pausada';
    case 'vencida': return `Vencida hace ${-d} día${d === -1 ? '' : 's'}`;
    case 'hoy': return 'Toca hoy';
    default: return `En ${d} día${d === 1 ? '' : 's'}`;
  }
}

export const normCat = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** ¿La categoría del producto entra por alguna de las palabras de la plantilla? */
export function entraPorCategoria(categoria: string | null | undefined, palabras: string[]): boolean {
  const c = normCat(categoria);
  return !!c && palabras.some((p) => { const w = normCat(p); return !!w && c.includes(w); });
}

/** Las cantidades de la última solicitud (por id de producto y por sku). */
export function cantidadesPrevias(items: Array<Pick<ItemOrden, 'productoId' | 'sku' | 'cantidad'>>): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const c = Number(it.cantidad) || 0;
    if (c <= 0) continue;
    if (it.productoId) m.set(it.productoId, c);
    if (it.sku) m.set(it.sku, c);
  }
  return m;
}

/**
 * Los renglones de la plantilla: los productos fijos y los activos de sus categorías,
 * con la cantidad de la última vez (o la de la plantilla, o 1). Lo que se compró la
 * última vez y hoy ya no entra por categoría igual se trae.
 */
export function renglonesDePlantilla(c: Pick<CompraFija, 'categorias' | 'productos' | 'finalidad'>, productos: Producto[], previas: Map<string, number>): ItemOrden[] {
  const activos = productos.filter((p) => p.estado === 'activo');
  const porId = new Map(activos.map((p) => [p.id, p]));
  const elegidos: Producto[] = [];
  const ya = new Set<string>();
  const sumar1 = (p: Producto | undefined) => { if (p && !ya.has(p.id)) { ya.add(p.id); elegidos.push(p); } };
  for (const f of c.productos ?? []) sumar1(porId.get(f.producto_id));
  for (const p of activos) if (entraPorCategoria(p.categoria, c.categorias ?? [])) sumar1(p);
  for (const p of activos) if (previas.has(p.id) || previas.has(p.sku)) sumar1(p);
  const fija = new Map((c.productos ?? []).map((f) => [f.producto_id, Number(f.cantidad) || 0]));
  return elegidos.map((p) => ({
    productoId: p.id, sku: p.sku, nombre: p.nombre, precio: 0, unidad: p.unidad, comprar: true,
    cantidad: previas.get(p.id) ?? previas.get(p.sku) ?? (fija.get(p.id) || 1),
    ...(c.finalidad ? { finalidad: c.finalidad } : {}),
  }));
}

/** Validación de la plantilla antes de guardar. */
export function errorPlantilla(c: Pick<CompraFija, 'nombre' | 'frecuencia' | 'cada_dias' | 'proxima_fecha' | 'categorias' | 'productos'>): string | null {
  if (c.nombre.trim().length < 3) return 'Ponle un nombre (mínimo 3 letras).';
  if (c.frecuencia === 'cada_dias' && !(Number(c.cada_dias) >= 1)) return 'Indica cada cuántos días.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.proxima_fecha)) return 'Indica la próxima fecha.';
  if (!c.categorias.filter((x) => x.trim()).length && !c.productos.length) return 'Agrega al menos una categoría o un producto.';
  return null;
}
