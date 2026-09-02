/* ============================================================
   MGG · Salidas / Traslados · Tesorería (Supabase)
   Cajas con saldo (USD/Bs) y su libro de movimientos. La salida
   de dinero es un anticipo que queda PENDIENTE y luego se concilia
   con la recepción de mineral equivalente (entra al inventario).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { cachedQuery } from '@/shared/lib/queryCache';
import type { Caja, MovimientoCaja, Moneda, MonedaCaja } from '@/shared/lib/types';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { createProducto, findBySku } from '@/modules/inventario/inventario.repository';

const TABLE = 'cajas';
const LIBRO = 'movimientos_caja';

function round2(n: number): number { return Math.round(n * 100) / 100; }

/* ───────────── Cajas (CRUD) ───────────── */

export async function listCajas(): Promise<Caja[]> {
  // Cacheada (SWR) con TTL corto: el saldo cambia con cada movimiento, pero
  // realtime (tabla `cajas`) la invalida al instante.
  return cachedQuery('cajas:all', async () => {
    const { data, error } = await supabase.from(TABLE).select('*').order('nombre', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Caja[];
  }, { tables: ['cajas'], ttl: 15_000 });
}

export async function listCajasActivas(): Promise<Caja[]> {
  // Excluye los centros de acopio (son destino de traslado, no cajas para pagar/ingresar).
  const { data, error } = await supabase.from(TABLE).select('*').eq('estado', 'activo').neq('tipo', 'centro_acopio').order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Caja[];
}

/** Centros de acopio activos (manejan saldo propio; destino del traslado de dinero). */
export async function listCentrosAcopio(): Promise<Caja[]> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('estado', 'activo').eq('tipo', 'centro_acopio').order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Caja[];
}

export async function crearCaja(input: { nombre: string; moneda: Moneda | MonedaCaja; saldoInicial?: number }, actorEmail?: string): Promise<Caja> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('El nombre de la caja es obligatorio');
  const saldo = round2(Number(input.saldoInicial) || 0);
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ nombre, moneda: input.moneda, saldo, created_by: actorEmail ?? null })
    .select('*')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ya existe una caja con ese nombre y moneda');
    throw error;
  }
  return data as Caja;
}

export async function renombrarCaja(id: string, nombre: string): Promise<Caja> {
  const limpio = nombre.trim();
  if (!limpio) throw new Error('El nombre no puede estar vacío');
  const { data, error } = await supabase
    .from(TABLE)
    .update({ nombre: limpio, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ya existe una caja con ese nombre y moneda');
    throw error;
  }
  return data as Caja;
}

export async function deshabilitarCaja(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ estado: 'inactivo', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function habilitarCaja(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ estado: 'activo', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Lee una caja (saldo actual). */
async function getCaja(id: string): Promise<Caja> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Caja no encontrada');
  return data as Caja;
}

/** Ajuste manual del saldo (deja registro en el libro). */
export async function ajustarSaldo(id: string, nuevoSaldo: number, motivo: string, actor: string, actorName?: string | null): Promise<void> {
  const caja = await getCaja(id);
  const saldoAntes = Number(caja.saldo) || 0;
  const saldoDespues = round2(Number(nuevoSaldo) || 0);
  const delta = round2(saldoDespues - saldoAntes);
  await supabase.from(LIBRO).insert({
    caja_id: id, tipo: 'ajuste', monto: Math.abs(delta), moneda: caja.moneda,
    saldo_antes: saldoAntes, saldo_despues: saldoDespues,
    motivo: motivo || 'Ajuste de saldo', actor, actor_name: actorName ?? null,
  });
  const { error } = await supabase.from(TABLE).update({ saldo: saldoDespues, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/* ───────────── Ingreso de dinero (entrada · suma al saldo) ───────────── */

/**
 * Ingresa dinero a una caja: SUMA el monto al saldo actual (no lo fija).
 * Ej.: caja con 100 + ingreso de 100 = 200. Queda como movimiento 'ingreso'.
 */
export async function ingresarDinero(
  id: string, monto: number, motivo: string, actor: string, actorName?: string | null,
): Promise<void> {
  const m = round2(Number(monto) || 0);
  if (m <= 0) throw new Error('El monto a ingresar debe ser mayor que 0.');
  const caja = await getCaja(id);
  const saldoAntes = Number(caja.saldo) || 0;
  const saldoDespues = round2(saldoAntes + m);
  await supabase.from(LIBRO).insert({
    caja_id: id, tipo: 'ingreso', monto: m, moneda: caja.moneda,
    saldo_antes: saldoAntes, saldo_despues: saldoDespues,
    motivo: motivo || 'Ingreso de dinero', actor, actor_name: actorName ?? null,
  });
  const { error } = await supabase.from(TABLE).update({ saldo: saldoDespues, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/* ───────────── Salida de dinero (anticipo · queda pendiente) ───────────── */

export interface SalidaDineroInput {
  cajaId: string;
  destino: string;
  motivo: string;
  monto: number;
  actor: string;
  actorName?: string | null;
}

export async function salidaDinero(input: SalidaDineroInput): Promise<MovimientoCaja> {
  const monto = round2(Number(input.monto) || 0);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const caja = await getCaja(input.cajaId);
  const saldoAntes = Number(caja.saldo) || 0;
  if (monto > saldoAntes) throw new Error(`Saldo insuficiente en ${caja.nombre}. Disponible: ${saldoAntes} ${caja.moneda}.`);
  const saldoDespues = round2(saldoAntes - monto);

  const { data, error } = await supabase.from(LIBRO).insert({
    caja_id: input.cajaId, tipo: 'salida', monto, moneda: caja.moneda,
    saldo_antes: saldoAntes, saldo_despues: saldoDespues,
    motivo: input.motivo || null, destino: input.destino || null,
    estado_mineral: 'pendiente',
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;

  const { error: uErr } = await supabase.from(TABLE).update({ saldo: saldoDespues, updated_at: new Date().toISOString() }).eq('id', input.cajaId);
  if (uErr) throw uErr;
  return data as MovimientoCaja;
}

/* ───────────── Traslado de dinero entre cajas (misma moneda) ───────────── */

export interface TrasladoDineroInput {
  origenId: string;
  destinoId: string;
  monto: number;
  motivo?: string | null;
  /** Texto de la nota de entrega (se imprime en el PDF cuando está marcada). */
  notaEntrega?: string | null;
  actor: string;
  actorName?: string | null;
}

export async function trasladoDinero(input: TrasladoDineroInput): Promise<MovimientoCaja> {
  const monto = round2(Number(input.monto) || 0);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  if (input.origenId === input.destinoId) throw new Error('La caja origen y destino deben ser distintas.');

  // Las dos patas del traslado (descuento del origen + acreditación del destino) y sus
  // movimientos de libro ocurren en UN RPC transaccional con `FOR UPDATE` de ambas cajas.
  // Antes eran dos updates de saldo sueltos: si fallaba el segundo, el origen quedaba
  // descontado y el destino sin acreditar (dinero descuadrado permanente).
  const { data: movId, error } = await supabase.rpc('caja_trasladar_dinero', {
    p_origen: input.origenId,
    p_destino: input.destinoId,
    p_monto: monto,
    p_motivo: input.motivo?.trim() || null,
    p_nota_entrega: input.notaEntrega?.trim() || null,
    p_actor: input.actor,
    p_actor_name: input.actorName ?? null,
  });
  if (error) throw error;

  // El RPC devuelve el id de la pata «traslado_salida»; se trae la fila para trazar la solicitud.
  const { data: mov, error: eMov } = await supabase.from(LIBRO).select('*').eq('id', movId).single();
  if (eMov) throw eMov;
  return mov as MovimientoCaja;
}

/* ───────────── Conciliación con recepción de mineral ───────────── */

function slugSku(nombre: string): string {
  const base = nombre.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16);
  const suf = Math.floor(performance.now() % 100000).toString(36).toUpperCase();
  return `MIN-${base || 'MINERAL'}-${suf}`;
}

export interface ConciliarMineralInput {
  movId: string;
  /** Producto existente; si es null se crea uno nuevo con `productoNuevo`. */
  productoId: string | null;
  productoNuevo?: { nombre: string; unidad: 'KG' | 'G' } | null;
  almacen: string;
  cantidad: number;
  unidad: 'KG' | 'G';
  costoUnit: number;
  descripcion: string;
  actor: string;
  actorName?: string | null;
}

/**
 * Concilia una salida de dinero pendiente con la recepción del mineral:
 * registra la entrada al inventario (suma stock + PMP) y marca el movimiento
 * de caja como conciliado, guardando los datos del mineral recibido.
 */
export async function conciliarConMineral(input: ConciliarMineralInput): Promise<void> {
  const cantidad = Number(input.cantidad) || 0;
  if (cantidad <= 0) throw new Error('El total de mineral debe ser mayor que 0.');
  const costo = Number(input.costoUnit) || 0;

  // 1) Resolver el producto mineral (existente o nuevo).
  let productoId = input.productoId;
  let productoNombre = '';
  if (!productoId) {
    if (!input.productoNuevo?.nombre.trim()) throw new Error('Indicá el mineral recibido.');
    const nombre = input.productoNuevo.nombre.trim().toUpperCase();
    const sku = slugSku(nombre);
    if (await findBySku(sku)) throw new Error(`Ya existe un producto con el SKU ${sku}.`);
    const prod = await createProducto({
      sku, nombre, categoria: 'MINERALES', unidad: input.productoNuevo.unidad,
      stock: 0, stock_min: 0, precio: costo, almacen: input.almacen, estado: 'activo',
    });
    productoId = prod.id;
    productoNombre = prod.nombre;
  }

  // 2) Entrada al inventario (suma stock + recalcula PMP del almacén).
  const mov = await registrarMovimiento({
    producto_id: productoId,
    tipo: 'entrada',
    delta: cantidad,
    almacen: input.almacen,
    actor: input.actor,
    actor_name: input.actorName ?? null,
    ref_tipo: 'conciliacion_mineral',
    ref_id: input.movId,
    detalle: `Recepción de mineral por anticipo · ${input.descripcion || ''}`.trim(),
    precio_unitario: costo,
  });

  // 3) Marcar la salida de dinero como conciliada.
  const { error } = await supabase.from(LIBRO).update({
    estado_mineral: 'conciliada',
    mineral_producto_id: productoId,
    mineral_producto_nombre: productoNombre || null,
    mineral_cantidad: cantidad,
    mineral_unidad: input.unidad,
    mineral_costo_unit: costo,
    mineral_descripcion: input.descripcion || null,
    mineral_mov_id: mov.id,
    conciliada_at: new Date().toISOString(),
  }).eq('id', input.movId);
  if (error) throw error;
}

/* ───────────── Consultas ───────────── */

export async function listMovimientosCaja(): Promise<MovimientoCaja[]> {
  const { data, error } = await supabase
    .from(LIBRO)
    .select('*, caja:cajas!movimientos_caja_caja_id_fkey(nombre, moneda)')
    .order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MovimientoCaja[];
}

/** Salidas de dinero (anticipos a conciliar con mineral), con su estado.
 *  Solo anticipos: los gastos/pagos planos de Tesorería (estado_mineral null) se excluyen. */
export async function listSalidasDinero(): Promise<MovimientoCaja[]> {
  const { data, error } = await supabase
    .from(LIBRO)
    .select('*, caja:cajas!movimientos_caja_caja_id_fkey(nombre, moneda)')
    .eq('tipo', 'salida')
    .not('estado_mineral', 'is', null)
    .order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MovimientoCaja[];
}

/** Traslados de dinero (solo el lado de salida, para no duplicar). */
export async function listTrasladosDinero(): Promise<MovimientoCaja[]> {
  const { data, error } = await supabase
    .from(LIBRO)
    .select('*, caja:cajas!movimientos_caja_caja_id_fkey(nombre, moneda)')
    .eq('tipo', 'traslado_salida')
    .order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MovimientoCaja[];
}
