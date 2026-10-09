/* ============================================================
   MGG · Cocina · El consumo no puede pasar del stock

   Lo que pasó en Los Pinos el 06/10/2026 (COC-2026-0443): se tecleó 700 de
   pimentón donde iba 0,7. El almacén tenía 4,5. `registrarMovimiento` topea
   en cero, así que el inventario bajó 4,5 y la comida quedó anotada con 700:
   el libro del mercado y el almacén se separaron en 695,5 de un solo golpe.
   Al editar la comida, el reverso devolvió los 700 enteros —no los 4,5 que de
   verdad habían bajado— y aparecieron 695,5 pimentones que nunca existieron.
   Después hubo que sacarlos a mano, y esa salida el libro la contó como merma.

   Acá viven las tres reglas que lo cierran, sin pantalla ni base de datos,
   para poder probarlas:
     1. Un víver SIN stock no se puede elegir (salvo que ya esté en la comida
        que se edita: su stock lo tiene la propia comida).
     2. Una comida no puede pedir más de lo que hay. Se avisa con el número.
     3. Al editar o eliminar, se devuelve lo que DE VERDAD bajó el almacén
        (Σ stock_despues − stock_antes de sus movimientos), no la cantidad
        escrita en el renglón.
   La base de datos repite la regla 2 con un trigger, por si llega una
   página vieja.
   ============================================================ */
import type { ItemCocina } from '@/shared/lib/types';

/** Tolerancia de redondeo: 0,004 de diferencia no es un faltante. */
export const TOLERANCIA_STOCK = 0.005;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Lo mínimo de un víver para decidir si alcanza. */
export interface ViverParaConsumo {
  producto_id: string;
  nombre: string;
  unidad: string;
  /** Stock del almacén del que se descuenta (el principal de la sede). */
  stock: number;
  almacen: string | null;
}

export interface LineaConsumo { producto_id: string; cantidad: number }

/** Un renglón que pide más de lo que hay. */
export interface ExcesoConsumo {
  producto_id: string;
  nombre: string;
  unidad: string;
  pedido: number;
  disponible: number;
  almacen: string | null;
}

/* ───────────── Regla 1 · elegible ───────────── */

/**
 * ¿Se puede marcar este víver en el formulario? Con stock, siempre. Sin stock,
 * solo si ya está en la comida que se edita: ese stock lo consumió la propia
 * comida y vuelve al editar.
 */
export function esSeleccionable(stock: number, enLaComida = false): boolean {
  return (Number(stock) || 0) > TOLERANCIA_STOCK || enLaComida;
}

/* ───────────── Regla 2 · alcanza ───────────── */

/**
 * Cuánto hay para una línea: el stock más lo que la misma comida va a devolver
 * al editarse (`devuelto`). Al crear, `devuelto` es 0.
 */
export function disponibleDe(stock: number, devuelto = 0): number {
  return r2((Number(stock) || 0) + (Number(devuelto) || 0));
}

/**
 * Las líneas que piden más de lo que hay. Vacío = todo alcanza.
 * `devueltos` va por producto: lo que el reverso de la comida que se edita
 * devuelve antes de descontar lo nuevo.
 */
export function excesosDeConsumo(
  lineas: LineaConsumo[],
  viveres: Map<string, ViverParaConsumo>,
  devueltos: Map<string, number> = new Map(),
): ExcesoConsumo[] {
  const pedidoPorProducto = new Map<string, number>();
  for (const l of lineas) {
    const c = Number(l.cantidad) || 0;
    if (c <= 0) continue;
    pedidoPorProducto.set(l.producto_id, r2((pedidoPorProducto.get(l.producto_id) ?? 0) + c));
  }
  const out: ExcesoConsumo[] = [];
  for (const [id, pedido] of pedidoPorProducto) {
    const v = viveres.get(id);
    if (!v) continue; // lo resuelve quien arma los ítems (otro error, más claro)
    const disponible = disponibleDe(v.stock, devueltos.get(id) ?? 0);
    if (pedido - disponible > TOLERANCIA_STOCK) {
      out.push({ producto_id: id, nombre: v.nombre, unidad: v.unidad, pedido, disponible, almacen: v.almacen });
    }
  }
  return out;
}

/** El aviso, con los números: quien lo lee tiene que poder corregir sin ir a otra pantalla. */
export function mensajeExcesos(excesos: ExcesoConsumo[], num: (n: number) => string = (n) => String(n)): string {
  if (!excesos.length) return '';
  const partes = excesos.map((e) => {
    const donde = e.almacen ? ` en ${e.almacen}` : '';
    if (e.disponible <= TOLERANCIA_STOCK) return `«${e.nombre}» está sin stock${donde}`;
    return `«${e.nombre}» pide ${num(e.pedido)} y hay ${num(e.disponible)} ${e.unidad}${donde}`;
  });
  return `No alcanza el stock para registrar la comida: ${partes.join('; ')}. Corregí la cantidad o registrá primero la entrada.`;
}

/* ───────────── Regla 3 · devolver lo que bajó ───────────── */

/** Un movimiento del kardex con lo necesario para saber cuánto movió DE VERDAD. */
export interface MovimientoEfectivo {
  producto_id: string;
  almacen: string | null;
  stock_antes: number | null;
  stock_despues: number | null;
  delta: number;
}

export function claveNeto(productoId: string, almacen: string | null | undefined): string {
  return `${productoId}|${(almacen ?? '').trim()}`;
}

/**
 * Lo que una comida le hizo al inventario hasta ahora, por víver y almacén:
 * Σ (stock_despues − stock_antes) de todos sus movimientos (salidas, reversos,
 * reversos anulados). Negativo = sigue descontado. Una salida topeada en cero
 * cuenta por lo que bajó, no por lo que pidió.
 */
export function netoDeComida(movs: MovimientoEfectivo[]): Map<string, number> {
  const neto = new Map<string, number>();
  for (const m of movs) {
    const efectivo = m.stock_antes != null && m.stock_despues != null
      ? Number(m.stock_despues) - Number(m.stock_antes)
      : Number(m.delta) || 0;
    const k = claveNeto(m.producto_id, m.almacen);
    neto.set(k, r2((neto.get(k) ?? 0) + efectivo));
  }
  return neto;
}

export interface Devolucion { item: ItemCocina; cantidad: number }

/**
 * Lo que hay que devolver al eliminar o editar una comida: por renglón, lo que
 * el almacén perdió de verdad. Sin kardex de la comida (`neto` vacío: una comida
 * anterior a tener movimientos propios) se devuelve la cantidad del renglón,
 * como siempre. Un neto en cero o positivo no devuelve nada: ya está devuelto.
 */
export function devolucionesDe(items: ItemCocina[], neto: Map<string, number>): Devolucion[] {
  const out: Devolucion[] = [];
  const consumido = new Map(neto);
  for (const it of items ?? []) {
    const k = claveNeto(it.producto_id, it.almacen);
    let cantidad: number;
    if (consumido.has(k)) {
      cantidad = r2(Math.max(0, -(consumido.get(k) ?? 0)));
      consumido.set(k, 0); // dos renglones del mismo víver no devuelven dos veces
    } else if (neto.size === 0) {
      cantidad = r2(Number(it.cantidad) || 0);
    } else {
      cantidad = 0; // la comida tiene kardex y este renglón nunca bajó nada
    }
    if (cantidad > TOLERANCIA_STOCK) out.push({ item: it, cantidad });
  }
  return out;
}

/** Lo devuelto, sumado por producto: es lo que vuelve a estar disponible para la edición. */
export function devueltoPorProducto(devoluciones: Devolucion[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of devoluciones) m.set(d.item.producto_id, r2((m.get(d.item.producto_id) ?? 0) + d.cantidad));
  return m;
}
