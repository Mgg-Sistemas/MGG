/* ============================================================
   Golden Touch · Control de Maquinaria · Ficha de repuestos del equipo
   (14/10/2026)

   Cada equipo tiene su lista de lo que lleva: filtros, aceites, cauchos,
   baterías, correas… con el número de parte original, sus equivalencias por
   marca (Donaldson, Fleetguard, Baldwin…), la especificación (15W-40,
   23.5R25), la cantidad por servicio y, si existe, el producto del
   inventario. Con eso se sabe qué comprar, se busca «¿para qué equipo
   sirve este filtro?» y la orden de servicio se llena desde la ficha.

   Lógica pura (sin red): la usan la pestaña del expediente, el submódulo
   «Repuestos por equipo» y la orden de servicio.
   ============================================================ */
import { norm } from '@/shared/lib/texto';
import { num as fmtNum } from '@/shared/lib/format';
import type { AvisoServicio } from './flota';

export type SistemaRepuesto =
  | 'motor' | 'hidraulico' | 'transmision' | 'refrigeracion' | 'combustible' | 'aire'
  | 'cabina' | 'cauchos' | 'electrico' | 'frenos' | 'rodaje' | 'otros';

export const SISTEMAS_REPUESTO: { id: SistemaRepuesto; label: string; icon: string }[] = [
  { id: 'motor', label: 'Motor', icon: '⚙️' },
  { id: 'combustible', label: 'Combustible', icon: '⛽' },
  { id: 'aire', label: 'Aire', icon: '🌬️' },
  { id: 'hidraulico', label: 'Hidráulico', icon: '💧' },
  { id: 'transmision', label: 'Transmisión', icon: '🔩' },
  { id: 'refrigeracion', label: 'Refrigeración', icon: '❄️' },
  { id: 'frenos', label: 'Frenos', icon: '🛑' },
  { id: 'cauchos', label: 'Cauchos', icon: '🛞' },
  { id: 'rodaje', label: 'Tren de rodaje', icon: '⛓️' },
  { id: 'electrico', label: 'Eléctrico', icon: '🔋' },
  { id: 'cabina', label: 'Cabina', icon: '🪟' },
  { id: 'otros', label: 'Otros', icon: '📦' },
];

/** Sugerencias para el campo «Tipo» según el sistema (se puede escribir otro). */
export const TIPOS_SUGERIDOS: Record<SistemaRepuesto, string[]> = {
  motor: ['Aceite de motor', 'Filtro de aceite', 'Filtro de aceite (by-pass)', 'Correa', 'Tapa de llenado'],
  combustible: ['Filtro de combustible', 'Filtro separador de agua', 'Filtro racor', 'Prefiltro'],
  aire: ['Filtro de aire primario', 'Filtro de aire secundario', 'Prefiltro de aire'],
  hidraulico: ['Aceite hidráulico', 'Filtro hidráulico de retorno', 'Filtro hidráulico de succión', 'Filtro hidráulico de línea', 'Filtro piloto', 'Respiradero'],
  transmision: ['Aceite de transmisión', 'Filtro de transmisión', 'Aceite de diferencial', 'Aceite de mandos finales'],
  refrigeracion: ['Refrigerante', 'Filtro de refrigerante', 'Termostato', 'Correa del ventilador'],
  frenos: ['Líquido de frenos', 'Pastillas', 'Bandas', 'Filtro de aire de frenos'],
  cauchos: ['Caucho delantero', 'Caucho trasero', 'Caucho de repuesto', 'Tripa', 'Protector'],
  rodaje: ['Zapata', 'Cadena', 'Rodillo', 'Rueda guía', 'Sprocket', 'Cuchilla', 'Uña / diente'],
  electrico: ['Batería', 'Alternador', 'Motor de arranque', 'Bombillo', 'Fusible'],
  cabina: ['Filtro de cabina', 'Filtro de aire acondicionado', 'Plumilla'],
  otros: ['Grasa', 'Otro'],
};

export const UNIDADES_REPUESTO = ['und', 'L', 'gal', 'kg', 'juego', 'par', 'paila', 'tambor'];

export interface RepuestoEquipo {
  id: string;
  equipo_id: string;
  sistema: SistemaRepuesto;
  tipo: string;
  numero_parte: string | null;
  equivalencias: string[];
  especificacion: string | null;
  cantidad: number;
  unidad: string;
  cada_hrs: number | null;
  cada_km: number | null;
  /** Se cambia en cada servicio preventivo (cuenta para «qué comprar» y se marca solo en la OS). */
  en_servicio: boolean;
  producto_id: string | null;
  nota: string | null;
  orden: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export type DatosRepuesto = Pick<RepuestoEquipo,
  'sistema' | 'tipo' | 'numero_parte' | 'equivalencias' | 'especificacion' | 'cantidad' | 'unidad'
  | 'cada_hrs' | 'cada_km' | 'en_servicio' | 'producto_id' | 'nota'>;

/** Lo mínimo del producto del inventario que hace falta aquí. */
export interface ProductoRepuesto {
  id: string;
  nombre: string;
  unidad: string;
  stock: number;
  sku?: string | null;
  categoria?: string | null;
  almacen?: string | null;
  nombre_busqueda?: string | null;
}

export const sistemaDe = (id: string) => SISTEMAS_REPUESTO.find((s) => s.id === id) ?? SISTEMAS_REPUESTO[SISTEMAS_REPUESTO.length - 1];

/** Mayúsculas y espacios simples: los números de parte se guardan así. */
export const limpiarCodigo = (s: string | null | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * «DONALDSON P553771; FLEETGUARD LF3413» (o una por renglón) → lista sin repetidos.
 * No se parte por «/» ni «-» porque muchos números de parte los llevan.
 */
export function separarEquivalencias(txt: string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const parte of (txt ?? '').split(/[\n;,·]+/)) {
    const c = limpiarCodigo(parte);
    if (c && !vistos.has(c)) { vistos.add(c); out.push(c); }
  }
  return out;
}

/** «250 h · 10.000 km» (cada cuánto se cambia). */
export const textoCada = (r: Pick<RepuestoEquipo, 'cada_hrs' | 'cada_km'>): string =>
  [r.cada_hrs ? `${fmtNum(r.cada_hrs)} h` : null, r.cada_km ? `${fmtNum(r.cada_km)} km` : null].filter(Boolean).join(' · ');

export const textoEquivalencias = (eq: string[] | null | undefined): string => (eq ?? []).join(' · ');

/** Sin espacios, guiones, puntos ni barras: «P-553 771» encuentra «P553771». */
const compacto = (s: string) => norm(s).replace(/[\s\-./_]+/g, '');

/**
 * ¿El renglón coincide con la búsqueda? Cada palabra tiene que aparecer en el
 * tipo, el número de parte, las equivalencias, la especificación, la nota, el
 * producto enlazado o el equipo (nombre, marca, modelo, serial).
 */
export function coincideRepuesto(r: Pick<RepuestoEquipo, 'tipo' | 'numero_parte' | 'equivalencias' | 'especificacion' | 'nota' | 'sistema'>,
  q: string, extra: (string | null | undefined)[] = []): boolean {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const campos = [r.tipo, r.numero_parte, ...(r.equivalencias ?? []), r.especificacion, r.nota, sistemaDe(r.sistema).label, ...extra];
  const texto = norm(campos.filter(Boolean).join(' '));
  const comp = compacto(campos.filter(Boolean).join(' '));
  return terms.every((t) => texto.includes(t) || (compacto(t).length >= 3 && comp.includes(compacto(t))));
}

/** ¿El producto del inventario coincide con la búsqueda? (nombre, alias, SKU). */
export function coincideProducto(p: ProductoRepuesto, q: string): boolean {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return false;
  const campos = [p.nombre, p.nombre_busqueda, p.sku].filter(Boolean).join(' ');
  const texto = norm(campos);
  const comp = compacto(campos);
  return terms.every((t) => texto.includes(t) || (compacto(t).length >= 3 && comp.includes(compacto(t))));
}

/** Los renglones agrupados por sistema, en el orden de SISTEMAS_REPUESTO. */
export function agruparPorSistema<T extends Pick<RepuestoEquipo, 'sistema' | 'orden' | 'tipo'>>(rs: T[]): { sistema: (typeof SISTEMAS_REPUESTO)[number]; items: T[] }[] {
  return SISTEMAS_REPUESTO
    .map((s) => ({
      sistema: s,
      items: rs.filter((r) => sistemaDe(r.sistema).id === s.id)
        .sort((a, b) => (a.orden - b.orden) || a.tipo.localeCompare(b.tipo, 'es', { sensitivity: 'base' })),
    }))
    .filter((g) => g.items.length > 0);
}

export type EstadoStockRepuesto = 'hay' | 'poco' | 'no_hay' | 'sin_producto';

/** ¿Alcanza el inventario para un servicio? */
export function estadoStock(cantidad: number, producto: Pick<ProductoRepuesto, 'stock'> | null | undefined): EstadoStockRepuesto {
  if (!producto) return 'sin_producto';
  const s = Number(producto.stock) || 0;
  if (s <= 0) return 'no_hay';
  return s >= (Number(cantidad) || 0) ? 'hay' : 'poco';
}

export const ESTADO_STOCK: Record<EstadoStockRepuesto, { label: string; icon: string; tono: 'success' | 'warning' | 'danger' | 'info' }> = {
  hay: { label: 'Hay en inventario', icon: '🟢', tono: 'success' },
  poco: { label: 'No alcanza', icon: '🟡', tono: 'warning' },
  no_hay: { label: 'Sin stock', icon: '🔴', tono: 'danger' },
  sin_producto: { label: 'No está en el inventario', icon: '⚪', tono: 'info' },
};

/** Clave para no duplicar al copiar: mismo sistema, tipo y número de parte. */
const claveRenglon = (r: Pick<RepuestoEquipo, 'sistema' | 'tipo' | 'numero_parte'>) =>
  `${r.sistema}|${norm(r.tipo)}|${compacto(r.numero_parte ?? '')}`;

/** Lo que se copia de otro equipo: todo, salvo lo que el destino ya tiene. */
export function filasParaCopiar(origen: RepuestoEquipo[], destino: Pick<RepuestoEquipo, 'sistema' | 'tipo' | 'numero_parte'>[]): DatosRepuesto[] {
  const ya = new Set(destino.map(claveRenglon));
  const out: DatosRepuesto[] = [];
  for (const r of origen) {
    const k = claveRenglon(r);
    if (ya.has(k)) continue;
    ya.add(k);
    out.push({
      sistema: r.sistema, tipo: r.tipo, numero_parte: r.numero_parte, equivalencias: [...(r.equivalencias ?? [])],
      especificacion: r.especificacion, cantidad: r.cantidad, unidad: r.unidad, cada_hrs: r.cada_hrs, cada_km: r.cada_km,
      en_servicio: r.en_servicio, producto_id: r.producto_id, nota: r.nota,
    });
  }
  return out;
}

/** Nombre con el que entra una pieza a la orden cuando no está enlazada al inventario. */
export const nombrePiezaNueva = (r: Pick<RepuestoEquipo, 'tipo' | 'numero_parte' | 'especificacion'>): string =>
  limpiarCodigo([r.tipo, r.numero_parte || r.especificacion].filter(Boolean).join(' '));

/** Tipos de orden de servicio que marcan solos los renglones «en cada servicio». */
const OS_DE_SERVICIO = new Set(['preventivo', 'aceite']);

/** ¿Este renglón viene marcado al cargar la ficha en una OS de este tipo? */
export function marcadoParaOrden(r: Pick<RepuestoEquipo, 'sistema' | 'en_servicio'>, tipoOrden: string | null | undefined): boolean {
  if (tipoOrden === 'cauchos') return r.sistema === 'cauchos';
  if (tipoOrden && OS_DE_SERVICIO.has(tipoOrden)) return r.en_servicio && r.sistema !== 'cauchos';
  return false;
}

export interface LineaDesdeFicha {
  productoId: string | null; nombre: string; unidad: string; cantidad: number; stock: number; almacen: string | null;
}

/** Los renglones elegidos de la ficha → líneas de la orden (enlazados con su stock; los demás como pieza nueva). */
export function lineasDesdeFicha(rs: RepuestoEquipo[], productos: Map<string, ProductoRepuesto>): LineaDesdeFicha[] {
  const out: LineaDesdeFicha[] = [];
  const vistos = new Set<string>();
  for (const r of rs) {
    const p = r.producto_id ? productos.get(r.producto_id) : undefined;
    const clave = p ? `p:${p.id}` : `n:${nombrePiezaNueva(r)}`;
    const cantidad = Number(r.cantidad) > 0 ? Number(r.cantidad) : 1;
    if (vistos.has(clave)) {
      const l = out.find((x) => (p ? x.productoId === p.id : !x.productoId && x.nombre === nombrePiezaNueva(r)));
      if (l) l.cantidad += cantidad;
      continue;
    }
    vistos.add(clave);
    out.push(p
      ? { productoId: p.id, nombre: p.nombre, unidad: p.unidad || r.unidad || 'und', cantidad, stock: Math.max(0, Number(p.stock) || 0), almacen: p.almacen ?? null }
      : { productoId: null, nombre: nombrePiezaNueva(r), unidad: r.unidad || 'und', cantidad, stock: 0, almacen: null });
  }
  return out;
}

/* ───────── Qué comprar para el próximo servicio ───────── */

export interface EquipoPorServicio {
  id: string;
  equipo: string;
  aviso: AvisoServicio | null;
}

export interface NecesidadProducto {
  producto: ProductoRepuesto;
  cantidad: number;
  stock: number;
  faltante: number;
  equipos: string[];
}

export interface NecesidadSinProducto {
  equipo: string;
  renglon: RepuestoEquipo;
}

/** Equipos con el servicio vencido o próximo (según su contador), del más urgente al menos. */
export function equiposPorServicio(es: EquipoPorServicio[]): EquipoPorServicio[] {
  return es.filter((e) => e.aviso && e.aviso.nivel !== 'ok')
    .sort((a, b) => (b.aviso!.ratio - a.aviso!.ratio) || a.equipo.localeCompare(b.equipo, 'es'));
}

/**
 * Suma lo que piden las fichas (renglones «en cada servicio») de los equipos que
 * están por servicio, por producto del inventario, y le resta el stock. Lo que
 * no está enlazado al inventario sale aparte, para que Compras lo identifique.
 */
export function necesidadesProximoServicio(
  equipos: EquipoPorServicio[], renglones: RepuestoEquipo[], productos: Map<string, ProductoRepuesto>,
): { porProducto: NecesidadProducto[]; sinProducto: NecesidadSinProducto[] } {
  const porProducto = new Map<string, NecesidadProducto>();
  const sinProducto: NecesidadSinProducto[] = [];
  const nombres = new Map(equipos.map((e) => [e.id, e.equipo]));
  for (const r of renglones) {
    const eq = nombres.get(r.equipo_id);
    if (!eq || !r.en_servicio) continue;
    const p = r.producto_id ? productos.get(r.producto_id) : undefined;
    if (!p) { sinProducto.push({ equipo: eq, renglon: r }); continue; }
    const n = porProducto.get(p.id) ?? { producto: p, cantidad: 0, stock: Math.max(0, Number(p.stock) || 0), faltante: 0, equipos: [] };
    n.cantidad += Number(r.cantidad) || 0;
    if (!n.equipos.includes(eq)) n.equipos.push(eq);
    porProducto.set(p.id, n);
  }
  const lista = [...porProducto.values()].map((n) => ({ ...n, cantidad: Math.round(n.cantidad * 100) / 100, faltante: Math.max(0, Math.round((n.cantidad - n.stock) * 100) / 100) }));
  lista.sort((a, b) => (Number(b.faltante > 0) - Number(a.faltante > 0)) || a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
  sinProducto.sort((a, b) => a.equipo.localeCompare(b.equipo, 'es') || a.renglon.tipo.localeCompare(b.renglon.tipo, 'es'));
  return { porProducto: lista, sinProducto };
}
