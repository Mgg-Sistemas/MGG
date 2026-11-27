/* ──────────────────────────────────────────────────────────────────────────────
   Solicitud de Pedido con NOMBRES GENÉRICOS (31/10/2026 · flujo nuevo de Compras).

   Con el interruptor `compras_revision_almacen` encendido, la SP que monta alguien que
   NO es analista de compras (un almacenista, un jefe de área…) se escribe con nombres
   generales: no se elige producto del inventario ni se da de alta ninguno. Almacén la
   revisa (TIENE / VA A COMPRAS) y el analista, al cargar la cotización, le pone a cada
   renglón el producto correcto (o lo crea): recién ahí entra al inventario.

   El analista de compras y el administrador siguen eligiendo productos como siempre.
   La solicitud de MERCADO (Cocina) tampoco cambia: trae los víveres del inventario.
   Con el interruptor apagado, todo queda como antes.

   La base lo refuerza: `ordenes_sp_nombres_genericos` (supabase/2026-10-31-sp-nombres-genericos.sql).
   ────────────────────────────────────────────────────────────────────────────── */
import type { ItemOrden } from '@/shared/lib/types';

/** Roles que siguen pidiendo con productos del inventario aunque el flujo nuevo esté encendido. */
export const ROLES_PIDEN_CON_PRODUCTO: readonly string[] = ['analista_de_compras', 'admin'];

/** Prefijo del sku provisional de un renglón genérico (no choca con los de categorías). */
export const PREFIJO_SKU_GENERICO = 'SPG-';

/** ¿Es el sku provisional de un renglón genérico (SPG-… o GEN-…)? No es un código real del inventario. */
export function esSkuProvisional(sku: string | null | undefined): boolean {
  const s = String(sku ?? '').trim().toUpperCase();
  return s.startsWith(PREFIJO_SKU_GENERICO) || s.startsWith('GEN-');
}

/**
 * El sku para MOSTRAR (pantallas y PDF): el provisional SPG-… no se muestra porque no es
 * un código del inventario; sale `vacio` hasta que el analista le pone el producto al cotizar.
 */
export function skuVisible(sku: string | null | undefined, vacio = '—'): string {
  const v = String(sku ?? '').trim();
  return !v || esSkuProvisional(v) ? vacio : v;
}

/** ¿La SP que se está creando va con nombres genéricos? */
export function spConNombresGenericos(p: {
  /** Interruptor `compras_revision_almacen`. */
  revisionAlmacenActiva: boolean;
  /** Rol de quien crea la solicitud (`usuarios.role`). */
  rol: string | null | undefined;
  /** Solicitud de mercado de Cocina (va directo a Compras, con víveres del inventario). */
  mercado?: boolean;
}): boolean {
  if (!p.revisionAlmacenActiva || p.mercado) return false;
  const rol = (p.rol ?? '').trim().toLowerCase();
  return !ROLES_PIDEN_CON_PRODUCTO.includes(rol);
}

/** Nombre genérico tal como se guarda: mayúsculas y espacios simples. */
export function normalizarNombreGenerico(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Clave para no repetir el mismo nombre (sin acentos). */
const claveNombre = (s: string) => normalizarNombreGenerico(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Sku provisional, único dentro de la solicitud (el analista lo cambia por el del producto al cotizar). */
export function skuProvisionalGenerico(usados: Iterable<string> = [], azar: () => number = Math.random): string {
  const ya = new Set(usados);
  for (let i = 0; i < 50; i++) {
    const sku = `${PREFIJO_SKU_GENERICO}${Math.floor(azar() * 36 ** 5).toString(36).toUpperCase().padStart(5, '0')}`;
    if (!ya.has(sku)) return sku;
  }
  return `${PREFIJO_SKU_GENERICO}${Date.now().toString(36).toUpperCase()}`;
}

/** Renglón genérico: sin producto, con el nombre tal cual se pidió. */
export function renglonGenerico(p: { nombre: string; cantidad?: number; unidad?: string | null; sku: string }): ItemOrden {
  return {
    sku: p.sku,
    nombre: normalizarNombreGenerico(p.nombre),
    cantidad: Number(p.cantidad) > 0 ? Number(p.cantidad) : 1,
    precio: 0,
    unidad: (p.unidad ?? '').trim() || 'und',
    comprar: true,
    nombre_generico: true,
  };
}

/**
 * Agrega un nombre genérico a la lista. Si ya estaba (mismo nombre, sin importar acentos
 * ni mayúsculas) le suma la cantidad en vez de repetir el renglón.
 */
export function agregarNombreGenerico(
  items: ItemOrden[],
  p: { nombre: string; cantidad?: number; unidad?: string | null },
  azar?: () => number,
): { items: ItemOrden[]; repetido: boolean } {
  const nombre = normalizarNombreGenerico(p.nombre);
  if (!nombre) return { items, repetido: false };
  const k = claveNombre(nombre);
  const suma = Number(p.cantidad) > 0 ? Number(p.cantidad) : 1;
  const idx = items.findIndex((it) => it.nombre_generico === true && claveNombre(it.nombre) === k);
  if (idx >= 0) {
    return { items: items.map((it, i) => (i === idx ? { ...it, cantidad: (Number(it.cantidad) || 0) + suma } : it)), repetido: true };
  }
  const sku = skuProvisionalGenerico(items.map((it) => it.sku), azar);
  return { items: [...items, renglonGenerico({ nombre, cantidad: suma, unidad: p.unidad, sku })], repetido: false };
}

/**
 * Deja la lista lista para guardar en modo genérico: un renglón que por algún motivo
 * traiga producto (p. ej. se cargó antes de que se supiera el estado del interruptor)
 * pasa a genérico con su nombre; los genéricos quedan igual.
 */
export function itemsParaSpGenerica(items: ItemOrden[], azar?: () => number): ItemOrden[] {
  const usados = new Set(items.map((it) => it.sku));
  return items.map((it) => {
    if (it.nombre_generico === true && !it.productoId) return it;
    const sku = it.nombre_generico === true && it.sku ? it.sku : skuProvisionalGenerico(usados, azar);
    usados.add(sku);
    const { productoId: _p, ...resto } = it;
    void _p;
    return { ...resto, sku, nombre: normalizarNombreGenerico(it.nombre), nombre_generico: true };
  });
}
