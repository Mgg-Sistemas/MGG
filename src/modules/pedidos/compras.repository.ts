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
import { registrarGasto, editarMovimientoCaja, getMovimientoCajaPorId } from '@/modules/tesoreria/tesoreria.repository';
import { egresarDivisa } from '@/modules/tesoreria/cajaSaldos.repository';
import type { Producto, CuentaCaja } from '@/shared/lib/types';

/** Pata de pago multimoneda: cuánto sale de cada (cuenta, moneda) de la caja. */
export interface PagoLeg { cuenta: CuentaCaja; moneda: string; monto: number; }

const BUCKET = 'compras-directas';

export type EstadoCompraDirecta = 'en_proceso' | 'por_pagar' | 'finalizada';

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
  /** Etiquetas de gasto (se eligen al montar; Tesorería las usa al pagar). */
  gasto_categoria: string | null;
  gasto_subcategoria: string | null;
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
  /** Quién pagó desde Tesorería (en el flujo montar → pagar). */
  pagada_por: string | null;
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

/* ───────── Montar (analista: factura + precios → POR PAGAR) ───────── */

export interface MontarCompraInput {
  compra: CompraDirecta;
  /** Gasto (precio) por material (alineado con compra.items). */
  items: CompraDirectaItem[];
  /** Categoría → subcategoría de gasto (se persiste; Tesorería la usa al pagar). */
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  file?: File | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Monta la compra directa (el analista carga FACTURA + precios). NO toca caja ni
 * inventario todavía: deja la compra en POR PAGAR para que Tesorería la pague.
 */
export async function montarCompraDirecta(input: MontarCompraInput): Promise<void> {
  const { compra } = input;
  if (compra.estado === 'finalizada') throw new Error('Esta compra ya fue pagada.');
  const items = input.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  if (!items.length) throw new Error('La compra no tiene materiales.');
  const total = Math.round(items.reduce((a, i) => a + (i.gasto || 0), 0) * 100) / 100;
  if (total <= 0) throw new Error('Indicá cuánto se gastó.');

  // Factura opcional (PDF o imagen). Se suma a la lista existente.
  const facturas: AdjuntoFactura[] = [...(compra.facturas ?? [])];
  if (input.file) {
    const path = await subirAdjuntoCompra(compra.id, input.file);
    facturas.push({ path, filename: input.file.name, at: new Date().toISOString() });
  }
  const primera = facturas[0] ?? null;

  const { error } = await supabase
    .from('compras_directas')
    .update({
      estado: 'por_pagar', gasto: total, items,
      gasto_categoria: input.gastoCategoria ?? null, gasto_subcategoria: input.gastoSubcategoria ?? null,
      adjunto_path: primera?.path ?? null, adjunto_nombre: primera?.filename ?? null, facturas,
      updated_at: new Date().toISOString(),
    })
    .eq('id', compra.id);
  if (error) throw error;
}

/* ───────── Pagar (Tesorería: caja → egreso + inventario → FINALIZADA) ───────── */

export interface PagarCompraInput {
  compra: CompraDirecta;
  /** Caja de Tesorería de la que sale el dinero. */
  cajaId: string;
  /** Si la caja es Multimoneda: cuánto sale de cada moneda/cuenta (en su moneda). */
  legs?: PagoLeg[];
  /** Quién paga (usuario de Tesorería). */
  actor: string;
  actorName?: string | null;
}

/**
 * Paga una compra directa POR PAGAR (lo hace Tesorería): descuenta el gasto de la caja
 * (egreso en el Libro Mayor con la categoría que eligió el analista), registra la ENTRADA
 * de cada material al inventario (PMP) y la marca FINALIZADA con quién pagó.
 */
export async function pagarCompraDirecta(input: PagarCompraInput): Promise<void> {
  const { compra } = input;
  if (compra.estado !== 'por_pagar') throw new Error('Solo se paga una compra que esté POR PAGAR.');
  if (!input.cajaId) throw new Error('Elegí la caja de la que sale el dinero.');
  const items = compra.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  const total = Math.round(items.reduce((a, i) => a + (i.gasto || 0), 0) * 100) / 100;
  if (total <= 0) throw new Error('La compra no tiene montos cargados.');

  // 1) Egreso de la caja (valida saldo) → pasa por Tesorería.
  const concepto = `Compra directa · ${compra.producto_nombre}`;
  const legs = (input.legs ?? []).filter((l) => Number(l.monto) > 0);
  let movCajaId: string;
  if (legs.length) {
    let primero: string | null = null;
    for (const leg of legs) {
      const r = await egresarDivisa({
        cajaId: input.cajaId, cuenta: leg.cuenta, moneda: leg.moneda, monto: Number(leg.monto),
        concepto, categoria: 'compra_directa',
        gastoCategoria: compra.gasto_categoria ?? null, gastoSubcategoria: compra.gasto_subcategoria ?? null,
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
      gastoCategoria: compra.gasto_categoria ?? null, gastoSubcategoria: compra.gasto_subcategoria ?? null,
      actor: input.actor, actorName: input.actorName ?? null,
    });
    movCajaId = movCaja.id;
  }

  // 2) Entrada al inventario por cada material (costo = gasto / cantidad).
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

  // 3) Cerrar la OCD (pagada).
  const { error } = await supabase
    .from('compras_directas')
    .update({
      estado: 'finalizada', gasto: total, items,
      caja_id: input.cajaId, caja_mov_id: movCajaId, mov_id: primerMov,
      pagada_por: input.actorName || input.actor,
      finalizada_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    .eq('id', compra.id);
  if (error) throw error;
}

/** Compras directas POR PAGAR (las monta el analista; Tesorería las paga). */
export async function listComprasPorPagar(): Promise<CompraDirecta[]> {
  const { data, error } = await supabase
    .from('compras_directas').select('*').eq('estado', 'por_pagar')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

export interface EditarCompraFinalizadaInput {
  compra: CompraDirecta;
  /** Ítems con el nuevo gasto (precio) por material; la cantidad NO cambia. */
  items: CompraDirectaItem[];
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Edita una compra directa YA FINALIZADA y sincroniza todo:
 *  · Tesorería: ajusta el egreso (mismo movimiento) al nuevo total (saldo + Libro Mayor).
 *  · Inventario: reversa la entrada anterior de cada material y la vuelve a registrar al
 *    nuevo costo (cantidad igual), recalculando el PMP del almacén.
 * Solo soporta pagos en una sola moneda (el movimiento guardado debe coincidir con el
 * total previo). Si se pagó con multimoneda, hay que corregir el egreso desde Tesorería.
 */
export async function editarCompraDirectaFinalizada(input: EditarCompraFinalizadaInput): Promise<void> {
  const { compra } = input;
  if (compra.estado !== 'finalizada') throw new Error('Solo se edita una compra ya finalizada.');
  const items = input.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  const nuevoTotal = Math.round(items.reduce((a, i) => a + (i.gasto || 0), 0) * 100) / 100;
  if (nuevoTotal <= 0) throw new Error('El total debe ser mayor que 0.');
  const totalPrevio = Math.round(Number(compra.gasto || 0) * 100) / 100;

  // 1) Tesorería: ajustar el egreso al nuevo total.
  if (!compra.caja_mov_id) throw new Error('La compra no tiene egreso de caja asociado.');
  const mov = await getMovimientoCajaPorId(compra.caja_mov_id);
  if (!mov) throw new Error('No se encontró el egreso en Tesorería; corregí el monto manualmente.');
  if (Math.round(Number(mov.monto) * 100) / 100 !== totalPrevio) {
    throw new Error('Esta compra se pagó con multimoneda (varias monedas). Corregí el egreso desde Tesorería y volvé a intentar.');
  }
  await editarMovimientoCaja(mov, {
    monto: nuevoTotal,
    motivo: `Compra directa · ${compra.producto_nombre}`,
    gastoCategoria: input.gastoCategoria ?? undefined,
    gastoSubcategoria: input.gastoSubcategoria ?? undefined,
  });

  // 2) Inventario: reversar la entrada previa y reingresar al nuevo costo (misma cantidad).
  for (const it of items) {
    const cantidad = Number(it.cantidad) || 0;
    if (cantidad <= 0 || !it.producto_id) continue;
    // Reversa: salida de la cantidad ingresada (no altera el PMP).
    await registrarMovimiento({
      producto_id: it.producto_id, tipo: 'salida', delta: -cantidad, almacen: compra.almacen,
      actor: input.actor, actor_name: input.actorName ?? null,
      ref_tipo: 'compra_directa', ref_id: compra.id,
      detalle: `Ajuste por edición · reversa ${it.producto_nombre}`,
    });
    // Reingreso al nuevo costo (recalcula el PMP del almacén hacia adelante).
    const costoNuevo = (it.gasto || 0) > 0 ? Math.round(((it.gasto || 0) / cantidad) * 100) / 100 : 0;
    await registrarMovimiento({
      producto_id: it.producto_id, tipo: 'entrada', delta: cantidad, almacen: compra.almacen,
      actor: input.actor, actor_name: input.actorName ?? null,
      ref_tipo: 'compra_directa', ref_id: compra.id,
      detalle: `Ajuste por edición · ${it.producto_nombre}`, precio_unitario: costoNuevo,
    });
  }

  // 3) Guardar los nuevos montos en la compra.
  const { error } = await supabase
    .from('compras_directas')
    .update({ items, gasto: nuevoTotal, updated_at: new Date().toISOString() })
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
