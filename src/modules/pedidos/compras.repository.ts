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

// Flujo nuevo: 'abierta' = pago y recepción PENDIENTES en paralelo (Tesorería paga y
// el almacenista recibe en cualquier orden). 'por_pagar'/'por_recibir' quedan por
// compatibilidad con compras del flujo secuencial anterior.
export type EstadoCompraDirecta = 'en_proceso' | 'abierta' | 'por_pagar' | 'por_recibir' | 'finalizada';

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
  /** Moneda de la compra: 'USD' ($) o 'Bs'. El IVA sólo aplica cuando es Bs. */
  moneda: string;
  /** Descuento (en % o en monto, sincronizados): baja la base antes del IVA. */
  descuento_pct: number;
  descuento_monto: number;
  /** Monto de IVA (16% sugerido) que se SUMA al total cuando la compra es en Bs. */
  iva: number;
  /** Retención de IVA: % aplicado sobre el IVA + monto retenido. Vincula a Retenciones. */
  retencion_pct: number;
  retencion_monto: number;
  retencion_iva_path: string | null;
  retencion_iva_nombre: string | null;
  retencion_finalizada: boolean;
  retencion_finalizada_por: string | null;
  retencion_finalizada_en: string | null;
  /** Total (incluye IVA cuando aplica). Es lo que paga Tesorería. */
  gasto: number | null;
  /** Etiquetas de gasto: las elige TESORERÍA al pagar (ya no en el montaje). */
  gasto_categoria: string | null;
  gasto_subcategoria: string | null;
  /** Nota libre del analista para que Tesorería la lea al pagar (ej. reembolso). */
  nota: string | null;
  caja_id: string | null;
  caja_mov_id: string | null;
  /** Si la compra se maneja A CRÉDITO: apunta a la cuenta por pagar (Tesorería) que
   *  representa la deuda. Con esto la compra sale de "por pagar" (se salda con abonos). */
  credito_cxp_id: string | null;
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
  /** Quién recibió y le dio entrada al inventario (almacenista) + cuándo. */
  recibida_por: string | null;
  recibida_at: string | null;
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
  return {
    ...r, items, facturas,
    credito_cxp_id: r.credito_cxp_id ?? null,
    moneda: r.moneda ?? 'USD',
    descuento_pct: Number(r.descuento_pct) || 0,
    descuento_monto: Number(r.descuento_monto) || 0,
    iva: Number(r.iva) || 0,
    retencion_pct: Number(r.retencion_pct) || 0,
    retencion_monto: Number(r.retencion_monto) || 0,
    retencion_finalizada: !!r.retencion_finalizada,
  };
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

/** Trae la compra directa cuyo pago generó un movimiento de caja concreto (por su
 *  `caja_mov_id`). Lo usa el Detalle del movimiento en Tesorería para mostrar qué
 *  se compró y el requerimiento. Devuelve null si el movimiento no es de una compra. */
export async function getCompraDirectaByCajaMov(movId: string): Promise<CompraDirecta | null> {
  if (!movId) return null;
  const { data, error } = await supabase
    .from('compras_directas')
    .select('*')
    .eq('caja_mov_id', movId)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizar(data as Record<string, unknown>) : null;
}

/** Vínculo compra directa a crédito → cuenta por pagar (Tesorería). Identifica qué
 *  cuenta por pagar respalda a cada compra directa a crédito, para poder mostrarla
 *  en "Compras a crédito" además de en "Cliente / Proveedor". */
export interface CompraDirectaCredito {
  compraId: string;
  codigo: string | null;
  proveedorNombre: string | null;
  cxpId: string;
}

/** Compras directas que se manejan A CRÉDITO (tienen `credito_cxp_id`): devuelve el
 *  código de la compra y el id de la cuenta por pagar que la respalda. */
export async function listComprasDirectasCredito(): Promise<CompraDirectaCredito[]> {
  const { data, error } = await supabase
    .from('compras_directas')
    .select('id, codigo, proveedor_nombre, credito_cxp_id')
    .not('credito_cxp_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    compraId: String((r as Record<string, unknown>).id),
    codigo: ((r as Record<string, unknown>).codigo as string) ?? null,
    proveedorNombre: ((r as Record<string, unknown>).proveedor_nombre as string) ?? null,
    cxpId: String((r as Record<string, unknown>).credito_cxp_id),
  }));
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
  /** Moneda de la compra: 'USD' o 'Bs'. El IVA/retención sólo aplican en Bs. */
  moneda?: string;
  /** Descuento en % sobre el subtotal (sincronizado con el monto). */
  descuentoPct?: number;
  /** Descuento en monto (baja la base antes del IVA). Prevalece sobre el %. */
  descuentoMonto?: number;
  /** Monto de IVA (se suma al total cuando la compra es en Bs). */
  iva?: number;
  /** Retención de IVA: % aplicado sobre el IVA (el monto retenido se calcula acá). */
  retencionPct?: number;
  /** Categoría → subcategoría de gasto: ahora las pone TESORERÍA al pagar (opcionales acá). */
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  /** Nota libre del analista para que Tesorería la lea al pagar (ej. reembolso). */
  nota?: string | null;
  file?: File | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Monta la compra directa (el analista carga FACTURA + precios). NO toca caja ni
 * inventario todavía: deja la compra en POR PAGAR para que Tesorería la pague.
 * En Bs se puede sumar IVA (se agrega al total) y registrar la retención de IVA
 * (% sobre el IVA), que vincula la compra al módulo de Retenciones.
 */
export async function montarCompraDirecta(input: MontarCompraInput): Promise<void> {
  const { compra } = input;
  if (compra.estado === 'finalizada') throw new Error('Esta compra ya fue pagada.');
  const items = input.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  if (!items.length) throw new Error('La compra no tiene materiales.');
  const subtotal = Math.round(items.reduce((a, i) => a + (i.gasto || 0), 0) * 100) / 100;
  if (subtotal <= 0) throw new Error('Indicá cuánto se gastó.');

  // Descuento (en monto; el % es sólo la forma de ingresarlo). Baja la base antes del IVA.
  // Puede ser NEGATIVO (recargo) cuando el total se ajusta hacia arriba a mano.
  let descuentoMonto = Math.round((Number(input.descuentoMonto) || 0) * 100) / 100;
  if (descuentoMonto > subtotal) descuentoMonto = subtotal;   // nunca deja la base negativa
  const base = Math.round((subtotal - descuentoMonto) * 100) / 100;
  const descuentoPct = subtotal > 0 ? Math.round((descuentoMonto / subtotal) * 10000) / 100 : 0;

  // Moneda + IVA + retención. El IVA (y por ende la retención) sólo aplican en Bs.
  const moneda = input.moneda === 'Bs' ? 'Bs' : 'USD';
  const iva = moneda === 'Bs' ? Math.round(Math.max(0, Number(input.iva) || 0) * 100) / 100 : 0;
  const retencionPct = iva > 0 ? Math.max(0, Number(input.retencionPct) || 0) : 0;
  const retencionMonto = Math.round(iva * (retencionPct / 100) * 100) / 100;
  const total = Math.round((base + iva) * 100) / 100;

  // Factura opcional (PDF o imagen). Se suma a la lista existente.
  const facturas: AdjuntoFactura[] = [...(compra.facturas ?? [])];
  if (input.file) {
    const path = await subirAdjuntoCompra(compra.id, input.file);
    facturas.push({ path, filename: input.file.name, at: new Date().toISOString() });
  }
  const primera = facturas[0] ?? null;
  // La cantidad del encabezado sigue la suma de los renglones (puede cambiar al montar).
  const cantidadTotal = Math.round(items.reduce((a, i) => a + (Number(i.cantidad) || 0), 0) * 1e6) / 1e6;

  const { error } = await supabase
    .from('compras_directas')
    .update({
      // Cargar factura y precios deja la compra ABIERTA: pendiente por pagar (Tesorería)
      // Y pendiente por recibir (Inventario) al mismo tiempo (el guard de arriba ya
      // descarta las finalizadas).
      estado: 'abierta',
      gasto: total, items, cantidad: cantidadTotal,
      moneda, descuento_pct: descuentoPct, descuento_monto: descuentoMonto,
      iva, retencion_pct: retencionPct, retencion_monto: retencionMonto,
      gasto_categoria: input.gastoCategoria ?? null, gasto_subcategoria: input.gastoSubcategoria ?? null,
      nota: input.nota?.trim() || null,
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
  /** Categoría → subcategoría de gasto: las elige TESORERÍA al pagar. */
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  /** Comisión bancaria (opcional): egreso extra de la caja, NO suma a la factura. */
  comision?: { cuenta: CuentaCaja; moneda: string; monto: number } | null;
  /** Quién paga (usuario de Tesorería). */
  actor: string;
  actorName?: string | null;
}

/**
 * Paga una compra directa POR PAGAR (lo hace Tesorería): descuenta el gasto de la caja
 * (egreso en el Libro Mayor con la categoría que eligió Tesorería) y la deja EN
 * 'por_recibir'. La mercancía NO entra al inventario todavía: el almacenista le da
 * entrada desde Inventario → Recepciones (recibirCompraDirecta), eligiendo el almacén.
 */
export async function pagarCompraDirecta(input: PagarCompraInput): Promise<void> {
  const { compra } = input;
  // Se paga una compra ABIERTA (flujo nuevo) o POR PAGAR (legado). Nunca dos veces.
  if (!['abierta', 'por_pagar'].includes(compra.estado)) throw new Error('Solo se paga una compra que esté pendiente de pago.');
  if (compra.caja_mov_id) throw new Error('Esta compra ya fue pagada.');
  if (compra.credito_cxp_id) throw new Error('Esta compra está a crédito: se salda desde Cuentas por pagar (Tesorería).');
  if (!input.cajaId) throw new Error('Elegí la caja de la que sale el dinero.');
  const items = compra.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  const iva = Math.round((Number(compra.iva) || 0) * 100) / 100;             // IVA suma al total (Bs)
  const descuento = Math.round((Number(compra.descuento_monto) || 0) * 100) / 100;  // descuento baja el total
  const total = Math.round((items.reduce((a, i) => a + (i.gasto || 0), 0) - descuento + iva) * 100) / 100;
  if (total <= 0) throw new Error('La compra no tiene montos cargados.');

  // Categoría de gasto: la que eligió Tesorería al pagar (override) o la guardada.
  const gcat = input.gastoCategoria !== undefined ? input.gastoCategoria : compra.gasto_categoria;
  const gsub = input.gastoSubcategoria !== undefined ? input.gastoSubcategoria : compra.gasto_subcategoria;

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
        gastoCategoria: gcat ?? null, gastoSubcategoria: gsub ?? null,
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
      gastoCategoria: gcat ?? null, gastoSubcategoria: gsub ?? null,
      actor: input.actor, actorName: input.actorName ?? null,
    });
    movCajaId = movCaja.id;
  }

  // 1b) Comisión bancaria (opcional): egreso extra de la MISMA caja, NO suma a la factura.
  const comMonto = input.comision ? Math.round((Number(input.comision.monto) || 0) * 100) / 100 : 0;
  if (input.comision && comMonto > 0) {
    await egresarDivisa({
      cajaId: input.cajaId, cuenta: input.comision.cuenta, moneda: input.comision.moneda, monto: comMonto,
      concepto: `Comisión bancaria · compra directa ${compra.codigo ?? compra.producto_nombre}`, categoria: 'comision_bancaria',
      gastoCategoria: gcat ?? null, gastoSubcategoria: gsub ?? null,
      actor: input.actor, actorName: input.actorName ?? null,
    });
  }

  // 2) Pago hecho. Si la mercancía YA se recibió (entró al inventario), la compra queda
  //    FINALIZADA; si no, sigue ABIERTA esperando la recepción (pago y recepción son
  //    independientes: pueden ocurrir en cualquier orden).
  const yaRecibida = !!compra.recibida_at || !!compra.mov_id;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('compras_directas')
    .update({
      estado: yaRecibida ? 'finalizada' : 'abierta', gasto: total, items,
      gasto_categoria: gcat ?? null, gasto_subcategoria: gsub ?? null,
      caja_id: input.cajaId, caja_mov_id: movCajaId,
      pagada_por: input.actorName || input.actor,
      finalizada_at: yaRecibida ? nowIso : null,
      updated_at: nowIso,
    })
    .eq('id', compra.id);
  if (error) throw error;
}

/* ───────── Recibir (Inventario: almacenista → ENTRADA al inventario → FINALIZADA) ───────── */

export interface RecibirCompraInput {
  compra: CompraDirecta;
  /** Almacén/subalmacén destino (elegido con el picker Sede → Almacén). */
  almacen: string;
  actor: string;
  actorName?: string | null;
}

/**
 * El almacenista RECIBE una compra directa POR RECIBIR: registra la ENTRADA de cada
 * material al inventario (PMP, costo = gasto / cantidad) en el almacén elegido y la
 * marca FINALIZADA con quién la recibió. El pago ya lo hizo Tesorería.
 */
export async function recibirCompraDirecta(input: RecibirCompraInput): Promise<void> {
  const { compra } = input;
  // Se recibe una compra ABIERTA (flujo nuevo: puede llegar la mercancía antes de pagar)
  // o POR RECIBIR (legado). Nunca dos veces.
  if (!['abierta', 'por_recibir'].includes(compra.estado)) throw new Error('Solo se recibe una compra que esté pendiente de recepción.');
  if (compra.recibida_at || compra.mov_id) throw new Error('Esta compra ya fue recibida en el inventario.');
  const almacen = input.almacen.trim();
  if (!almacen) throw new Error('Elegí el almacén / subalmacén donde entran los materiales.');
  const items = compra.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));

  // Entrada al inventario por cada material (costo = gasto / cantidad).
  let primerMov: string | null = null;
  for (const it of items) {
    const cantidad = Number(it.cantidad) || 0;
    if (cantidad <= 0 || !it.producto_id) continue;
    const costoUnit = (it.gasto || 0) > 0 ? Math.round(((it.gasto || 0) / cantidad) * 100) / 100 : 0;
    const mov = await registrarMovimiento({
      producto_id: it.producto_id, tipo: 'entrada', delta: cantidad, almacen,
      actor: input.actor, actor_name: input.actorName ?? null,
      ref_tipo: 'compra_directa', ref_id: compra.id,
      detalle: `Compra directa · ${it.producto_nombre}`, precio_unitario: costoUnit,
    });
    if (!primerMov) primerMov = mov.id;
  }

  // Recepción hecha. Si la compra YA está pagada (o se maneja a crédito), queda
  // FINALIZADA; si no, sigue ABIERTA esperando el pago (la mercancía ya está en inventario).
  const yaPagada = !!compra.caja_mov_id || !!compra.credito_cxp_id;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('compras_directas')
    .update({
      estado: yaPagada ? 'finalizada' : 'abierta', almacen, mov_id: primerMov,
      recibida_por: input.actorName || input.actor, recibida_at: nowIso,
      finalizada_at: yaPagada ? nowIso : null, updated_at: nowIso,
    })
    .eq('id', compra.id);
  if (error) throw error;
}

/** Compras directas PENDIENTES DE RECEPCIÓN: abiertas (flujo nuevo) o legado 'por_recibir',
 *  que todavía no entraron al inventario (puede llegar la mercancía antes de pagar). */
export async function listComprasPorRecibir(): Promise<CompraDirecta[]> {
  const { data, error } = await supabase
    .from('compras_directas').select('*')
    .in('estado', ['abierta', 'por_recibir'])
    .is('recibida_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

/** Compras directas PENDIENTES DE PAGO: abiertas (flujo nuevo) o legado 'por_pagar',
 *  que todavía no se pagaron (Tesorería las paga en cualquier momento). */
export async function listComprasPorPagar(): Promise<CompraDirecta[]> {
  const { data, error } = await supabase
    .from('compras_directas').select('*')
    .in('estado', ['abierta', 'por_pagar'])
    .is('caja_mov_id', null)
    .is('credito_cxp_id', null)   // las que están a crédito no se pagan desde acá (van por cuentas por pagar)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

/* ───────── Retención de IVA (vínculo con el módulo Retenciones) ───────── */

/**
 * Compras directas con retención de IVA (monto > 0) para el módulo de Retenciones.
 * Se toman las ya montadas (no 'en_proceso'). `finalizada` filtra pendientes vs hechas.
 */
export async function listComprasConRetencion(finalizada: boolean): Promise<CompraDirecta[]> {
  const { data, error } = await supabase
    .from('compras_directas').select('*')
    .neq('estado', 'en_proceso')
    .gt('retencion_monto', 0)
    .eq('retencion_finalizada', finalizada)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

/**
 * Finaliza la retención de IVA de una compra directa: sube el comprobante (PDF o
 * imagen) y marca la retención como finalizada. Espeja el flujo de las OC.
 */
export async function finalizarRetencionCompraDirecta(input: {
  compra: CompraDirecta;
  file: File;
  actor: string;
}): Promise<void> {
  const { compra, file } = input;
  if (!file) throw new Error('Cargá el comprobante de la retención de IVA (PDF o imagen).');
  if (file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
    throw new Error('El comprobante debe ser un PDF o una imagen.');
  }
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${compra.id}/retencion_iva_${Date.now()}-${safe}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true, contentType: file.type || 'application/pdf',
  });
  if (upErr) throw upErr;
  const { error } = await supabase
    .from('compras_directas')
    .update({
      retencion_iva_path: path, retencion_iva_nombre: file.name,
      retencion_finalizada: true, retencion_finalizada_por: input.actor,
      retencion_finalizada_en: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    .eq('id', compra.id);
  if (error) throw error;
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
  const iva = Math.round((Number(compra.iva) || 0) * 100) / 100;             // IVA y descuento se conservan
  const descuento = Math.round((Number(compra.descuento_monto) || 0) * 100) / 100;
  const nuevoTotal = Math.round((items.reduce((a, i) => a + (i.gasto || 0), 0) - descuento + iva) * 100) / 100;
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
