/* ============================================================
   MGG · Ventas · Facturas (Supabase)
   Factura con items (producto, cantidad, tenor/ley, precio, costo,
   ganancia por línea). Al EMITIR descuenta stock del inventario; al
   ANULAR lo revierte. Totales (subtotal, descuento, IVA, total, costo,
   ganancia y % de ganancia) se guardan en la cabecera.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { getExistencia } from '@/modules/inventario/almacenes.repository';

export type EstadoVenta = 'borrador' | 'emitida' | 'pagada' | 'anulada';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface VentaItem {
  producto_id: string | null;
  producto_nombre: string;
  almacen: string;
  cantidad: number;
  unidad?: string | null;
  tenor_pct: number;     // ley / tenor del mineral (%) — informativo
  precio_unit: number;   // precio de venta unitario
  costo_unit: number;    // costo unitario (PMP) — para la ganancia
  subtotal: number;      // cantidad × precio_unit
  costo: number;         // cantidad × costo_unit
  ganancia: number;      // subtotal − costo
}

export interface VentaTotales {
  subtotal: number;
  costo_total: number;
  iva_monto: number;
  total: number;
  ganancia: number;
  ganancia_pct: number;  // margen sobre la venta (después de descuento)
}

export interface Venta extends VentaTotales {
  id: string;
  numero: string;
  fecha: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  estado: EstadoVenta;
  moneda: string;
  items: VentaItem[];
  descuento: number;
  iva_pct: number;
  metodo_pago?: string | null;
  pagado_monto: number;
  vendedor?: string | null;
  nota?: string | null;
  emitida_en?: string | null;
  emitida_por?: string | null;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at: string;
}

/** Recalcula los importes de una línea (subtotal/costo/ganancia). */
export function calcItem(it: Partial<VentaItem>): VentaItem {
  const cantidad = Number(it.cantidad) || 0;
  const precio = Number(it.precio_unit) || 0;
  const costoU = Number(it.costo_unit) || 0;
  const subtotal = r2(cantidad * precio);
  const costo = r2(cantidad * costoU);
  return {
    producto_id: it.producto_id ?? null,
    producto_nombre: it.producto_nombre ?? '',
    almacen: it.almacen ?? '',
    cantidad, unidad: it.unidad ?? null,
    tenor_pct: Number(it.tenor_pct) || 0,
    precio_unit: precio, costo_unit: costoU,
    subtotal, costo, ganancia: r2(subtotal - costo),
  };
}

/** Totales de la factura a partir de los items + descuento + IVA. */
export function calcVenta(items: VentaItem[], descuento = 0, ivaPct = 0): VentaTotales {
  const subtotal = r2(items.reduce((a, i) => a + (Number(i.subtotal) || 0), 0));
  const costo_total = r2(items.reduce((a, i) => a + (Number(i.costo) || 0), 0));
  const base = r2(subtotal - (Number(descuento) || 0));
  const iva_monto = r2(base * (Number(ivaPct) || 0) / 100);
  const total = r2(base + iva_monto);
  const ganancia = r2(base - costo_total);
  const ganancia_pct = base > 0 ? r2((ganancia / base) * 100) : 0;
  return { subtotal, costo_total, iva_monto, total, ganancia, ganancia_pct };
}

/** Próximo correlativo FAC-AAAA-NNNN (por año). */
async function nextNumero(fecha: string): Promise<string> {
  const year = (fecha || '').slice(0, 4) || String(new Date().getFullYear());
  const { data, error } = await supabase.from('ventas').select('numero').like('numero', `FAC-${year}-%`);
  if (error) throw error;
  let max = 0;
  (data ?? []).forEach((r) => {
    const m = String((r as { numero: string }).numero).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `FAC-${year}-${String(max + 1).padStart(4, '0')}`;
}

export async function listVentas(): Promise<Venta[]> {
  const { data, error } = await supabase
    .from('ventas').select('*')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Venta[];
}

export interface VentaInput {
  fecha: string;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  moneda?: string;
  items: VentaItem[];
  descuento?: number;
  iva_pct?: number;
  metodo_pago?: string | null;
  vendedor?: string | null;
  nota?: string | null;
}

function buildPayload(input: VentaInput) {
  const items = (input.items ?? []).map(calcItem).filter((i) => i.producto_nombre || i.cantidad > 0);
  const t = calcVenta(items, input.descuento ?? 0, input.iva_pct ?? 0);
  return {
    fecha: input.fecha,
    cliente_id: input.cliente_id ?? null,
    cliente_nombre: input.cliente_nombre?.trim() || null,
    moneda: input.moneda || 'USD',
    items,
    descuento: r2(input.descuento ?? 0),
    iva_pct: Number(input.iva_pct) || 0,
    iva_monto: t.iva_monto,
    subtotal: t.subtotal, total: t.total, costo_total: t.costo_total,
    ganancia: t.ganancia, ganancia_pct: t.ganancia_pct,
    metodo_pago: input.metodo_pago?.trim() || null,
    vendedor: input.vendedor?.trim() || null,
    nota: input.nota?.trim() || null,
  };
}

/** Crea una factura en estado borrador (no toca inventario). */
export async function crearVenta(input: VentaInput, actor: string, actorName?: string | null): Promise<Venta> {
  if (!input.fecha) throw new Error('Indicá la fecha.');
  const numero = await nextNumero(input.fecha);
  const { data, error } = await supabase.from('ventas').insert({
    numero, estado: 'borrador', ...buildPayload(input),
    created_by: actor, actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as Venta;
}

/** Edita una factura en borrador. */
export async function actualizarVenta(id: string, input: VentaInput): Promise<Venta> {
  const { data, error } = await supabase.from('ventas')
    .update({ ...buildPayload(input), updated_at: new Date().toISOString() })
    .eq('id', id).eq('estado', 'borrador').select('*').single();
  if (error) throw error;
  if (!data) throw new Error('Solo se editan facturas en borrador.');
  return data as Venta;
}

/**
 * Emite la factura: valida stock y descuenta cada item del inventario
 * (salida), luego pasa a estado 'emitida'. Si un item falla, lanza error
 * sin cambiar el estado (las salidas previas quedan registradas: revisá el
 * kardex si necesitás revertir manualmente — o anulá la factura).
 */
export async function emitirVenta(v: Venta, actor: string, actorName?: string | null): Promise<void> {
  if (v.estado !== 'borrador') throw new Error('Solo se emiten facturas en borrador.');
  const items = (v.items ?? []).filter((i) => i.producto_id && Number(i.cantidad) > 0);
  // Validación previa de stock (evita descuentos parciales en lo posible).
  for (const it of items) {
    const ex = await getExistencia(it.producto_id!, it.almacen);
    const stock = Number(ex?.stock) || 0;
    if (Number(it.cantidad) > stock) throw new Error(`Stock insuficiente de ${it.producto_nombre} en ${it.almacen}. Disponible: ${stock}.`);
  }
  for (const it of items) {
    await registrarMovimiento({
      producto_id: it.producto_id!, tipo: 'salida', delta: -Number(it.cantidad), almacen: it.almacen,
      actor, actor_name: actorName ?? null, ref_tipo: 'venta', ref_codigo: v.numero,
      destino: v.cliente_nombre || 'Venta', detalle: `Venta ${v.numero}`, precio_unitario: it.precio_unit,
    });
  }
  const { error } = await supabase.from('ventas').update({
    estado: 'emitida', emitida_en: new Date().toISOString(), emitida_por: actor, updated_at: new Date().toISOString(),
  }).eq('id', v.id);
  if (error) throw error;
}

/** Marca la factura como pagada (registra método y monto). */
export async function marcarPagada(v: Venta, metodo: string, monto: number): Promise<void> {
  if (v.estado !== 'emitida') throw new Error('Solo se cobran facturas emitidas.');
  const { error } = await supabase.from('ventas').update({
    estado: 'pagada', metodo_pago: metodo?.trim() || null, pagado_monto: r2(monto || v.total),
    updated_at: new Date().toISOString(),
  }).eq('id', v.id);
  if (error) throw error;
}

/** Anula la factura. Si estaba emitida/pagada, REVIERTE el stock (entrada). */
export async function anularVenta(v: Venta, actor: string, actorName?: string | null): Promise<void> {
  if (v.estado === 'anulada') throw new Error('La factura ya está anulada.');
  if (v.estado === 'emitida' || v.estado === 'pagada') {
    for (const it of (v.items ?? []).filter((i) => i.producto_id && Number(i.cantidad) > 0)) {
      await registrarMovimiento({
        producto_id: it.producto_id!, tipo: 'entrada', delta: Number(it.cantidad), almacen: it.almacen,
        actor, actor_name: actorName ?? null, ref_tipo: 'venta_anulada', ref_codigo: v.numero,
        detalle: `Reversa venta ${v.numero}`, precio_unitario: it.costo_unit,
      });
    }
  }
  const { error } = await supabase.from('ventas').update({
    estado: 'anulada', updated_at: new Date().toISOString(),
  }).eq('id', v.id);
  if (error) throw error;
}

/** Elimina una factura en borrador. */
export async function eliminarVenta(id: string): Promise<void> {
  const { error } = await supabase.from('ventas').delete().eq('id', id).eq('estado', 'borrador');
  if (error) throw error;
}

export interface ResumenVentas {
  totalVendido: number;    // total facturado (emitida + pagada)
  ganancia: number;
  gananciaPct: number;
  costo: number;
  facturas: number;        // emitidas + pagadas
  porCobrar: number;       // total de emitidas no pagadas
  cobrado: number;         // total de pagadas
}

/** KPIs del módulo (sobre facturas no anuladas). */
export function resumenVentas(ventas: Venta[]): ResumenVentas {
  const vivas = ventas.filter((v) => v.estado === 'emitida' || v.estado === 'pagada');
  const totalVendido = r2(vivas.reduce((a, v) => a + (Number(v.total) || 0), 0));
  const costo = r2(vivas.reduce((a, v) => a + (Number(v.costo_total) || 0), 0));
  const ganancia = r2(vivas.reduce((a, v) => a + (Number(v.ganancia) || 0), 0));
  const porCobrar = r2(vivas.filter((v) => v.estado === 'emitida').reduce((a, v) => a + (Number(v.total) || 0), 0));
  const cobrado = r2(vivas.filter((v) => v.estado === 'pagada').reduce((a, v) => a + (Number(v.total) || 0), 0));
  const base = r2(totalVendido);
  return {
    totalVendido, ganancia, costo, facturas: vivas.length, porCobrar, cobrado,
    gananciaPct: base > 0 ? r2((ganancia / base) * 100) : 0,
  };
}
