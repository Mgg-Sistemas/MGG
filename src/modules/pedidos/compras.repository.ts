/* ============================================================
   MGG · Compra Directa (Supabase)
   Compras sin proveedor con VARIOS materiales + cantidad (sin
   precios al crear). NO lleva aprobación. Flujo: EN PROCESO → FINALIZADA.
   Al completar se adjunta la factura, se colocan los precios por material
   y la CAJA de la que sale el dinero (pasa por Tesorería: egreso en el
   Libro Mayor); cada material entra al inventario como ENTRADA
   (costo = gasto/cant → PMP).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { createProducto, siguienteSku } from '@/modules/inventario/inventario.repository';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { registrarGasto } from '@/modules/tesoreria/tesoreria.repository';
import { egresarDivisa } from '@/modules/tesoreria/cajaSaldos.repository';
import type { Producto, CuentaCaja } from '@/shared/lib/types';

/** Pata de pago multimoneda: cuánto sale de cada (cuenta, moneda) de la caja. */
export interface PagoLeg { cuenta: CuentaCaja; moneda: string; monto: number; }

const BUCKET = 'compras-directas';

export type EstadoCompraDirecta = 'en_proceso' | 'finalizada';

export interface CompraDirectaItem {
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  cantidad: number;
  /** Gasto del renglón (se carga al finalizar). */
  gasto?: number | null;
}

/** Una factura adjunta (PDF o imagen) guardada en Storage. */
export interface AdjuntoFactura {
  path: string;
  filename: string;
  at: string;
}

export interface CompraDirecta {
  id: string;
  codigo: string | null;
  producto_id: string | null;
  producto_nombre: string;
  producto_sku: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  almacen: string;
  cantidad: number;
  items: CompraDirectaItem[];
  estado: EstadoCompraDirecta;
  gasto: number | null;
  caja_id: string | null;
  caja_mov_id: string | null;
  adjunto_path: string | null;
  adjunto_nombre: string | null;
  /** Facturas adjuntas (PDF o imagen). La primera se refleja en adjunto_path/nombre. */
  facturas: AdjuntoFactura[];
  mov_id: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
  aprobada_at: string | null;
  aprobada_por: string | null;
  finalizada_at: string | null;
  updated_at: string;
}

/** Normaliza una fila: las antiguas (un solo producto) se exponen como items[]. */
function normalizar(row: Record<string, unknown>): CompraDirecta {
  const r = row as unknown as CompraDirecta;
  let items = Array.isArray(r.items) ? r.items : [];
  if (!items.length && r.producto_id) {
    items = [{
      producto_id: r.producto_id, producto_nombre: r.producto_nombre,
      producto_sku: r.producto_sku, cantidad: Number(r.cantidad) || 0, gasto: r.gasto ?? null,
    }];
  }
  let facturas = Array.isArray(r.facturas) ? r.facturas : [];
  // Legado: una compra con adjunto suelto se expone como una factura en la lista.
  if (!facturas.length && r.adjunto_path) {
    facturas = [{ path: r.adjunto_path, filename: r.adjunto_nombre ?? 'factura', at: r.finalizada_at ?? r.created_at }];
  }
  return { ...r, items, facturas };
}

/** Próximo correlativo CD-YYYY-#### (Compra Directa) por el MÁXIMO del año + 1 (robusto
 *  ante borrados: contar filas se desincronizaba al eliminar una compra). */
export async function nextCodigoCompraDirecta(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CD-${year}-`;
  const { data, error } = await supabase
    .from('compras_directas')
    .select('codigo')
    .like('codigo', `${prefix}%`);
  if (error) throw error;
  let max = 0;
  for (const r of data ?? []) {
    const m = /-(\d+)$/.exec(String(r.codigo ?? ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export async function listComprasDirectas(): Promise<CompraDirecta[]> {
  const { data, error } = await supabase
    .from('compras_directas')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

/* ───────── Alta (varios materiales) ───────── */

export interface LineaExistente { modo: 'existente'; productoId: string; cantidad: number }
export interface LineaNueva { modo: 'nuevo'; nombre: string; categoria: string; unidad: string; cantidad: number }
export type LineaCompra = LineaExistente | LineaNueva;

export interface CrearCompraInput {
  lineas: LineaCompra[];
  almacen: string;
  /** Proveedor de la compra (opcional). Si es nuevo, ya viene creado en `proveedores`. */
  proveedorId?: string | null;
  proveedorNombre?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Crea una compra directa EN PROCESO con uno o varios materiales. Los materiales
 * nuevos se dan de alta en el inventario (stock 0, sin precio) y se usan sus ids.
 */
export async function crearCompraDirecta(
  input: CrearCompraInput,
  productosExistentes: Producto[] = [],
): Promise<CompraDirecta> {
  const almacen = input.almacen.trim() || 'General';
  const lineas = input.lineas.filter((l) => (Number(l.cantidad) || 0) > 0);
  if (!lineas.length) throw new Error('Agregá al menos un material con cantidad.');

  const items: CompraDirectaItem[] = [];
  for (const l of lineas) {
    const cantidad = Number(l.cantidad) || 0;
    if (l.modo === 'existente') {
      if (!l.productoId) throw new Error('Elegí el material en cada renglón.');
      const p = productosExistentes.find((x) => x.id === l.productoId) ?? null;
      items.push({ producto_id: l.productoId, producto_nombre: p?.nombre ?? '', producto_sku: p?.sku ?? null, cantidad });
    } else {
      const nom = l.nombre.trim().toUpperCase();
      if (!nom) throw new Error('Indicá el nombre del material nuevo.');
      const nuevo = await createProducto({
        sku: siguienteSku(l.categoria, productosExistentes),
        nombre: nom, categoria: l.categoria, unidad: l.unidad,
        stock: 0, stock_min: 0, precio: 0, almacen, estado: 'activo',
      });
      productosExistentes = [...productosExistentes, nuevo];
      items.push({ producto_id: nuevo.id, producto_nombre: nuevo.nombre, producto_sku: nuevo.sku, cantidad });
    }
  }

  const totalCantidad = items.reduce((a, i) => a + i.cantidad, 0);
  const resumen = items.length === 1 ? items[0].producto_nombre : `${items.length} materiales`;
  const codigo = await nextCodigoCompraDirecta();

  const { data, error } = await supabase
    .from('compras_directas')
    .insert({
      codigo,
      producto_id: items.length === 1 ? items[0].producto_id : null,
      producto_nombre: resumen,
      producto_sku: items.length === 1 ? items[0].producto_sku : null,
      proveedor_id: input.proveedorId ?? null,
      proveedor_nombre: input.proveedorNombre?.trim() || null,
      almacen,
      cantidad: totalCantidad,
      items,
      estado: 'en_proceso',
      actor: input.actor,
      actor_name: input.actorName ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return normalizar(data as Record<string, unknown>);
}

/* ───────── Adjunto en Storage ───────── */

export async function subirAdjuntoCompra(compraId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  // Prefijo de tiempo: permite varias facturas con el mismo nombre sin pisarse.
  const path = `${compraId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true, contentType: file.type || 'application/pdf',
  });
  if (error) throw error;
  return path;
}

export async function urlAdjuntoCompra(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Gestiona las FACTURAS de una compra ya creada (sirve para finalizadas): sube las nuevas
 * (PDF o imagen), borra del Storage las que se quitaron y guarda la lista resultante.
 * adjunto_path/nombre quedan apuntando a la primera factura (compatibilidad con el resto).
 */
export async function gestionarFacturasCompra(
  compra: CompraDirecta,
  nuevos: File[],
  quitarPaths: string[],
): Promise<CompraDirecta> {
  const subidas: AdjuntoFactura[] = [];
  for (const f of nuevos) {
    const path = await subirAdjuntoCompra(compra.id, f);
    subidas.push({ path, filename: f.name, at: new Date().toISOString() });
  }
  if (quitarPaths.length) {
    try { await supabase.storage.from(BUCKET).remove(quitarPaths); } catch { /* el Storage no bloquea */ }
  }
  const facturas = [...(compra.facturas ?? []).filter((a) => !quitarPaths.includes(a.path)), ...subidas];
  const primera = facturas[0] ?? null;
  const { data, error } = await supabase
    .from('compras_directas')
    .update({
      facturas,
      adjunto_path: primera?.path ?? null,
      adjunto_nombre: primera?.filename ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', compra.id)
    .select('*')
    .single();
  if (error) throw error;
  return normalizar(data as Record<string, unknown>);
}

/* ───────── Completar (factura + precios + caja de Tesorería) ───────── */

export interface FinalizarCompraInput {
  compra: CompraDirecta;
  /** Gasto (precio) por material (alineado con compra.items). */
  items: CompraDirectaItem[];
  /** Caja de Tesorería de la que sale el dinero. */
  cajaId: string;
  /** Si la caja es Multimoneda: cuánto sale de cada moneda/cuenta (en su moneda).
   *  Cuando viene, el egreso descuenta cada saldo real (no la caja legacy). */
  legs?: PagoLeg[];
  /** Categoría → subcategoría de gasto de Tesorería con la que se etiqueta el egreso. */
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  file?: File | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Completa la compra directa (estaba EN PROCESO): adjunta la factura, descuenta el
 * gasto total de la caja elegida (egreso en Tesorería/Libro Mayor), registra la
 * ENTRADA de cada material al inventario (costo = precio_renglón / cantidad → PMP)
 * y cierra la compra.
 */
export async function finalizarCompraDirecta(input: FinalizarCompraInput): Promise<void> {
  const { compra } = input;
  if (compra.estado !== 'en_proceso') throw new Error('Esta compra ya fue completada.');
  if (!input.cajaId) throw new Error('Elegí la caja de la que sale el dinero.');
  const items = input.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  if (!items.length) throw new Error('La compra no tiene materiales.');
  const total = Math.round(items.reduce((a, i) => a + (i.gasto || 0), 0) * 100) / 100;
  if (total <= 0) throw new Error('Indicá cuánto se gastó.');

  // 1) Egreso de la caja (valida saldo) → pasa por Tesorería.
  const concepto = `Compra directa · ${compra.producto_nombre}`;
  const legs = (input.legs ?? []).filter((l) => Number(l.monto) > 0);
  let movCajaId: string;
  if (legs.length) {
    // Caja Multimoneda: descuenta cada moneda/cuenta de su saldo real.
    let primero: string | null = null;
    for (const leg of legs) {
      const r = await egresarDivisa({
        cajaId: input.cajaId, cuenta: leg.cuenta, moneda: leg.moneda, monto: Number(leg.monto),
        concepto, categoria: 'compra_directa',
        gastoCategoria: input.gastoCategoria ?? null, gastoSubcategoria: input.gastoSubcategoria ?? null,
        actor: input.actor, actorName: input.actorName ?? null,
      });
      if (!primero) primero = r.id;
    }
    if (!primero) throw new Error('Indicá cuánto pagar en al menos una moneda.');
    movCajaId = primero;
  } else {
    const movCaja = await registrarGasto({
      cajaId: input.cajaId, monto: total,
      concepto, categoria: 'compra_directa',
      gastoCategoria: input.gastoCategoria ?? null, gastoSubcategoria: input.gastoSubcategoria ?? null,
      actor: input.actor, actorName: input.actorName ?? null,
    });
    movCajaId = movCaja.id;
  }

  // 2) Adjunto opcional (factura PDF o imagen). Inicia la lista de facturas.
  let adjuntoPath: string | null = null;
  let adjuntoNombre: string | null = null;
  const facturas: AdjuntoFactura[] = [];
  if (input.file) {
    adjuntoPath = await subirAdjuntoCompra(compra.id, input.file);
    adjuntoNombre = input.file.name;
    facturas.push({ path: adjuntoPath, filename: adjuntoNombre, at: new Date().toISOString() });
  }

  // 3) Entrada al inventario por cada material (costo = gasto / cantidad).
  let primerMov: string | null = null;
  for (const it of items) {
    const cantidad = Number(it.cantidad) || 0;
    if (cantidad <= 0 || !it.producto_id) continue;
    const costoUnit = (it.gasto || 0) > 0 ? Math.round(((it.gasto || 0) / cantidad) * 100) / 100 : 0;
    const mov = await registrarMovimiento({
      producto_id: it.producto_id, tipo: 'entrada', delta: cantidad, almacen: compra.almacen,
      actor: input.actor, actor_name: input.actorName ?? null,
      ref_tipo: 'compra_directa', ref_id: compra.id,
      detalle: `Compra directa · ${it.producto_nombre}`, precio_unitario: costoUnit,
    });
    if (!primerMov) primerMov = mov.id;
  }

  // 4) Cerrar la OCD.
  const { error } = await supabase
    .from('compras_directas')
    .update({
      estado: 'finalizada', gasto: total, items,
      caja_id: input.cajaId, caja_mov_id: movCajaId,
      adjunto_path: adjuntoPath, adjunto_nombre: adjuntoNombre, facturas,
      mov_id: primerMov,
      finalizada_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    .eq('id', compra.id);
  if (error) throw error;
}

/**
 * Elimina una compra directa que sigue EN PROCESO (todavía no tocó caja ni inventario).
 * Las finalizadas NO se borran por esta vía porque ya generaron egreso de caja y entrada
 * al inventario (habría que reversar ambos). Si tiene adjunto, también se quita del Storage.
 */
export async function eliminarCompraDirecta(compra: CompraDirecta): Promise<void> {
  if (compra.estado !== 'en_proceso')
    throw new Error('Solo se puede eliminar una compra EN PROCESO (las finalizadas ya afectaron caja e inventario).');
  if (compra.adjunto_path) {
    try { await supabase.storage.from(BUCKET).remove([compra.adjunto_path]); } catch { /* el adjunto no bloquea el borrado */ }
  }
  const { error } = await supabase.from('compras_directas').delete().eq('id', compra.id);
  if (error) throw error;
}
