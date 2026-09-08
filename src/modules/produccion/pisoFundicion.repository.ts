/* ============================================================
   MGG · Fundición · El piso, contra la base
   Junta las tres fuentes del disponible —lo entregado por Salidas, lo
   quemado en coladas y lo devuelto al inventario— y las pasa por el
   cálculo puro de `pisoFundicion.ts`. Acá no se decide nada: solo se
   trae el dato.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import {
  calcularPisoFundicion,
  type DisponibleFundicion, type EntregaFundicion,
  type ConsumoFundicion, type DevolucionFundicion,
} from './pisoFundicion';

/** ref_tipo del movimiento con el que el material vuelve al inventario. */
export const REF_DEVOLUCION = 'devolucion_fundicion';

interface ItemSalida {
  producto_id?: string | null;
  producto_nombre?: string | null;
  cantidad?: number | null;
  precio_unit?: number | null;
  unidad?: string | null;
  almacen?: string | null;
  para_fundicion?: boolean | null;
}

/**
 * Lo entregado: renglones marcados «va para fundición» de salidas EJECUTADAS.
 * Las aprobadas todavía no movieron stock y las canceladas nunca lo movieron,
 * así que no entregaron nada.
 */
export async function listEntregasFundicion(): Promise<EntregaFundicion[]> {
  const { data, error } = await supabase
    .from('solicitudes_salida')
    .select('codigo, ejecutada_en, created_at, items')
    .eq('estado', 'ejecutada')
    .eq('tipo', 'material');
  if (error) throw error;

  const out: EntregaFundicion[] = [];
  for (const row of (data ?? []) as Array<{ codigo: string; ejecutada_en: string | null; created_at: string; items: ItemSalida[] | null }>) {
    if (!Array.isArray(row.items)) continue;
    for (const it of row.items) {
      if (!it?.para_fundicion || !it.producto_id) continue;
      out.push({
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre ?? null,
        unidad: it.unidad ?? null,
        cantidad: Number(it.cantidad) || 0,
        precio_unit: it.precio_unit ?? null,
        codigo: row.codigo,
        fecha: row.ejecutada_en ?? row.created_at,
      });
    }
  }
  return out;
}

/** Lo quemado: materiales de colada que salieron del piso. */
export async function listConsumosFundicion(): Promise<ConsumoFundicion[]> {
  const { data, error } = await supabase
    .from('produccion_materiales')
    .select('producto_id, cantidad')
    .eq('desde_fundicion', true);
  if (error) throw error;
  return ((data ?? []) as Array<{ producto_id: string; cantidad: number }>)
    .map((r) => ({ producto_id: r.producto_id, cantidad: Number(r.cantidad) || 0 }));
}

/** Lo devuelto al inventario. */
export async function listDevolucionesFundicion(): Promise<DevolucionFundicion[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('producto_id, delta')
    .eq('ref_tipo', REF_DEVOLUCION);
  if (error) throw error;
  return ((data ?? []) as Array<{ producto_id: string; delta: number }>)
    .map((r) => ({ producto_id: r.producto_id, cantidad: Math.abs(Number(r.delta) || 0) }));
}

/** El piso completo, listo para pintar. */
export async function cargarPisoFundicion(): Promise<DisponibleFundicion[]> {
  const [entregas, consumos, devoluciones] = await Promise.all([
    listEntregasFundicion(), listConsumosFundicion(), listDevolucionesFundicion(),
  ]);
  return calcularPisoFundicion(entregas, consumos, devoluciones);
}

/**
 * Devuelve al inventario material que se entregó a fundición y no se quemó.
 * Es una ENTRADA real: el material había salido del inventario en su salida,
 * así que volver a contarlo es un movimiento de verdad, con su kardex.
 *
 * Se revalida el disponible contra la base antes de mover: la pantalla pudo
 * quedar vieja si mientras tanto alguien cargó una colada.
 */
export async function devolverDeFundicion(input: {
  productoId: string;
  cantidad: number;
  almacen: string;
  costoUnitario?: number | null;
  nota?: string | null;
  actor: string;
  actorName?: string | null;
}): Promise<void> {
  const cantidad = Number(input.cantidad) || 0;
  if (cantidad <= 0) throw new Error('La cantidad a devolver debe ser mayor que 0.');
  if (!input.almacen?.trim()) throw new Error('Elegí a qué almacén vuelve el material.');

  const piso = await cargarPisoFundicion();
  const fila = piso.find((f) => f.producto_id === input.productoId);
  const hay = fila?.disponible ?? 0;
  if (cantidad > hay) {
    throw new Error(`Solo quedan ${hay}${fila?.unidad ? ` ${fila.unidad}` : ''} en el piso de fundición.`);
  }

  await registrarMovimiento({
    producto_id: input.productoId,
    tipo: 'entrada',
    delta: cantidad,
    almacen: input.almacen.trim(),
    actor: input.actor,
    actor_name: input.actorName ?? null,
    ref_tipo: REF_DEVOLUCION,
    detalle: `Devolución de material de fundición${input.nota?.trim() ? ` · ${input.nota.trim()}` : ''}`,
    // Vuelve al costo con el que salió, para no distorsionar el PMP del almacén.
    precio_unitario: input.costoUnitario != null ? Number(input.costoUnitario) : (fila?.costo_unitario ?? 0),
  });
}
