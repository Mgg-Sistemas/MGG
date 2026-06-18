/* ============================================================
   MGG · Inventario · Movimientos (kardex)
   Bitácora vertical de cada producto. Único punto autorizado
   para modificar `productos.stock`.

   ⚠ TRANSACCIONALIDAD (deuda conocida):
   Por simplicidad de FASE 1 ejecutamos dos queries seguidas
   (INSERT en movimientos + UPDATE en productos) en lugar de
   un RPC atómico. Si falla la segunda el kardex queda con un
   movimiento huérfano. En FASE 2 envolver en una función
   plpgsql `registrar_movimiento(...)` con SECURITY DEFINER.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Movimiento, TipoMovimiento } from '@/shared/lib/types';
import { findProducto } from './inventario.repository';

export const TIPOS_MOVIMIENTO: Record<TipoMovimiento, { label: string; icon: string; color: 'success' | 'warning' | 'danger' | 'info' }> = {
  creacion:      { label: 'Alta de producto',     icon: '✨', color: 'info' },
  ajuste:        { label: 'Ajuste manual',        icon: '⚙',  color: 'info' },
  entrada:       { label: 'Entrada',              icon: '⬇',  color: 'success' },
  salida:        { label: 'Salida',               icon: '⬆',  color: 'warning' },
  consumo:       { label: 'Consumo en proceso',   icon: '🔥', color: 'warning' },
  transferencia: { label: 'Transferencia',        icon: '↔',  color: 'info' },
  fundicion:     { label: 'Inicio de fundición',  icon: '🔥', color: 'warning' },
  fin_fundicion: { label: 'Fin de fundición',     icon: '✓',  color: 'success' },
};

export interface MovimientoInput {
  producto_id: string;
  tipo: TipoMovimiento;
  delta: number;
  /** Almacén donde ocurre el movimiento. Por defecto el almacén del producto. */
  almacen?: string | null;
  actor: string;
  actor_name?: string | null;
  ref_tipo?: string | null;
  ref_id?: string | null;
  ref_codigo?: string | null;
  proveedor_id?: string | null;
  detalle?: string | null;
  /** A quién va dirigida la salida/traslado de material. */
  destino?: string | null;
  /** Texto de la nota de entrega (se imprime en el PDF cuando está marcada). */
  nota_entrega?: string | null;
  /** Fecha de entrega de la salida/traslado al destino (YYYY-MM-DD). */
  fecha_entrega?: string | null;
  /** Costo unitario del proveedor en una entrada/compra. Dispara el recálculo del PMP. */
  precio_unitario?: number | null;
  /** Marca que la salida/traslado es para consumo interno de la empresa. */
  consumo_interno?: boolean | null;
  /** Quién solicitó la salida/traslado (se muestra en el historial). */
  solicitante?: string | null;
}

/**
 * Promedio Móvil Ponderado (PMP). Dado el stock y costo previos y una entrada
 * de `cantidad` unidades a `precioCompra`, devuelve el nuevo costo base.
 *   nuevoCosto = (stockPrev × costoPrev + cantidad × precioCompra) / (stockPrev + cantidad)
 * Ej: 10 u a $10 + 5 u a $13 → (100 + 65) / 15 = $11.
 */
export function calcularPMP(stockPrev: number, costoPrev: number, cantidad: number, precioCompra: number): number {
  const totalQty = stockPrev + cantidad;
  if (totalQty <= 0) return precioCompra;
  const base = stockPrev * costoPrev + cantidad * precioCompra;
  return Math.round((base / totalQty) * 10000) / 10000; // 4 decimales para minimizar drift
}

export async function listMovimientosPorProducto(productoId: string): Promise<Movimiento[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('*')
    .eq('producto_id', productoId)
    .order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Movimiento[];
}

export async function lastMovimientoPorProducto(productoId: string): Promise<Movimiento | null> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('*')
    .eq('producto_id', productoId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Movimiento | null;
}

/**
 * Recalcula los agregados del producto (stock total y costo promedio global)
 * a partir de TODAS sus existencias por almacén, y los persiste en `productos`.
 * Mantiene compatible la "vista general" (que usa productos.stock / productos.precio).
 */
export async function recomputeProductoAgg(productoId: string): Promise<void> {
  const { data, error } = await supabase
    .from('existencias')
    .select('stock, costo_promedio')
    .eq('producto_id', productoId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ stock: number | null; costo_promedio: number | null }>;
  const totalStock = rows.reduce((a, r) => a + (Number(r.stock) || 0), 0);
  const valor = rows.reduce((a, r) => a + (Number(r.stock) || 0) * (Number(r.costo_promedio) || 0), 0);
  const patch: Record<string, number> = { stock: totalStock };
  // Solo recalculamos el costo global si hay stock; si todo es 0 conservamos el último precio.
  if (totalStock > 0) patch.precio = Math.round((valor / totalStock) * 10000) / 10000;
  const { error: pErr } = await supabase.from('productos').update(patch).eq('id', productoId);
  if (pErr) throw pErr;
}

/**
 * Registra un movimiento en un almacén concreto: actualiza la existencia
 * (stock + PMP de ese almacén) y recalcula los agregados del producto.
 * No es atómico (ver nota de transaccionalidad arriba).
 */
export async function registrarMovimiento(input: MovimientoInput): Promise<Movimiento> {
  // El almacén suele venir explícito (fundición, recepción, transferencia); en
  // ese caso evitamos el round-trip a `productos` y resolvemos sólo el fallback.
  let almacen = (input.almacen || '').trim();
  if (!almacen) {
    const producto = await findProducto(input.producto_id);
    if (!producto) throw new Error('Producto no encontrado');
    almacen = (producto.almacen || 'General').trim() || 'General';
  }
  const delta = Number(input.delta) || 0;

  // Existencia actual de ESTE almacén (stock + costo propios).
  const { data: exData, error: exErr } = await supabase
    .from('existencias')
    .select('stock, costo_promedio')
    .eq('producto_id', input.producto_id)
    .eq('almacen', almacen)
    .maybeSingle();
  if (exErr) throw exErr;
  const stockAntes = Number(exData?.stock) || 0;
  const costoAntes = Number(exData?.costo_promedio) || 0;
  const stockDespues = Math.max(0, stockAntes + delta);

  // ── PMP por almacén ──
  // Solo las entradas con costo informado (delta > 0 y precio_unitario válido)
  // recalculan el costo de este almacén. El resto conserva el costo vigente.
  const precioUnit =
    input.precio_unitario != null && Number.isFinite(Number(input.precio_unitario))
      ? Number(input.precio_unitario)
      : null;
  const aplicaPMP = delta > 0 && precioUnit != null && precioUnit >= 0;
  const costoPromedio = aplicaPMP ? calcularPMP(stockAntes, costoAntes, delta, precioUnit) : costoAntes;

  const payload = {
    producto_id: input.producto_id,
    tipo: input.tipo,
    delta,
    almacen,
    stock_antes: stockAntes,
    stock_despues: stockDespues,
    actor: input.actor,
    actor_name: input.actor_name ?? null,
    ref_tipo: input.ref_tipo ?? 'manual',
    ref_id: input.ref_id ?? null,
    ref_codigo: input.ref_codigo ?? null,
    proveedor_id: input.proveedor_id ?? null,
    detalle: input.detalle ?? null,
    destino: input.destino ?? null,
    nota_entrega: input.nota_entrega ?? null,
    fecha_entrega: input.fecha_entrega ?? null,
    precio_unitario: precioUnit,
    costo_promedio: costoPromedio,
    consumo_interno: input.consumo_interno ?? false,
    solicitante: input.solicitante ?? null,
    at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('movimientos')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;

  // 2do paso: upsert de la existencia del almacén. Si falla queda el movimiento huérfano.
  const { error: uErr } = await supabase
    .from('existencias')
    .upsert(
      { producto_id: input.producto_id, almacen, stock: stockDespues, costo_promedio: costoPromedio, updated_at: new Date().toISOString() },
      { onConflict: 'producto_id,almacen' },
    );
  if (uErr) throw uErr;

  // 3er paso: recomputar agregados del producto (stock total + costo global).
  await recomputeProductoAgg(input.producto_id);

  // 4to paso: si el movimiento es de fundición, marcamos el flag en el producto.
  if (input.tipo === 'fundicion' || input.tipo === 'fin_fundicion') {
    const enFundicion = input.tipo === 'fundicion';
    const { error: fErr } = await supabase
      .from('productos')
      .update({ en_fundicion: enFundicion })
      .eq('id', input.producto_id);
    if (fErr) throw fErr;
  }

  return data as Movimiento;
}

export interface TransferirInput {
  producto_id: string;
  almacenOrigen: string;
  almacenDestino: string;
  cantidad: number;
  actor: string;
  actor_name?: string | null;
  detalle?: string | null;
}

/**
 * Transferencia real entre almacenes: salida en origen + entrada en destino,
 * llevando el costo (PMP) del almacén de origen para fundirlo en el destino.
 */
export async function transferir(input: TransferirInput): Promise<void> {
  const cantidad = Math.abs(Number(input.cantidad) || 0);
  if (cantidad <= 0) throw new Error('La cantidad a transferir debe ser mayor que 0.');
  if (input.almacenOrigen === input.almacenDestino) throw new Error('El almacén de origen y destino deben ser distintos.');

  // Costo del origen ANTES de mover (la salida no altera el PMP, pero lo capturamos por claridad).
  const { data: exOrigen } = await supabase
    .from('existencias')
    .select('stock, costo_promedio')
    .eq('producto_id', input.producto_id)
    .eq('almacen', input.almacenOrigen)
    .maybeSingle();
  const stockOrigen = Number(exOrigen?.stock) || 0;
  if (cantidad > stockOrigen) throw new Error(`Stock insuficiente en ${input.almacenOrigen}. Disponible: ${stockOrigen}.`);
  const costoOrigen = Number(exOrigen?.costo_promedio) || 0;

  const extra = input.detalle ? ` · ${input.detalle}` : '';
  // Salida en origen
  await registrarMovimiento({
    producto_id: input.producto_id,
    tipo: 'transferencia',
    delta: -cantidad,
    almacen: input.almacenOrigen,
    actor: input.actor,
    actor_name: input.actor_name ?? null,
    detalle: `Transferencia a ${input.almacenDestino}${extra}`,
  });
  // Entrada en destino al costo del origen (recalcula el PMP del destino).
  await registrarMovimiento({
    producto_id: input.producto_id,
    tipo: 'transferencia',
    delta: cantidad,
    almacen: input.almacenDestino,
    precio_unitario: costoOrigen,
    actor: input.actor,
    actor_name: input.actor_name ?? null,
    detalle: `Transferencia desde ${input.almacenOrigen}${extra}`,
  });
}
