/* ============================================================
   MGG · Servicio Directo (Supabase)
   Igual que la Compra Directa pero COMO SERVICIO: sin inventario.
   Varios servicios (categoría · tipo · equipo de maquinaria) sin
   precio al crear. NO lleva aprobación. Flujo: EN PROCESO → FINALIZADA.
   Al completar se adjunta la FACTURA, se colocan los montos por
   servicio y la CAJA de la que sale el dinero (pasa por Tesorería:
   egreso en el Libro Mayor). Queda vinculado al equipo de maquinaria
   (aparece en Control de Mantenimiento / bitácora del equipo).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarGasto, editarMovimientoCaja, getMovimientoCajaPorId, eliminarMovimientoCaja } from '@/modules/tesoreria/tesoreria.repository';
import { egresarDivisa } from '@/modules/tesoreria/cajaSaldos.repository';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import type { PagoLeg, AdjuntoFactura } from './compras.repository';

export type { AdjuntoFactura } from './compras.repository';

const BUCKET = 'compras-directas'; // se reutiliza el bucket existente (prefijo sd/)

export type EstadoServicioDirecto = 'en_proceso' | 'por_pagar' | 'finalizada';

export interface ServicioDirectoItem {
  servicio_categoria: string;
  servicio_tipo: string | null;
  equipo_id: string | null;
  equipo_nombre: string | null;
  descripcion: string;          // nombre del renglón (categoría · equipo · tipo)
  cantidad: number;
  /** Recarga (gas / oxígeno / extintores): nº de bombonas y KG a recargar. */
  bombonas?: number | null;
  kg_recarga?: number | null;
  /** Monto del renglón (se carga al finalizar). */
  gasto?: number | null;
  /** Repuesto tomado del inventario para este mantenimiento (si aplica): se descuenta
   *  del stock al crear el servicio y se restituye si el servicio se elimina. */
  producto_id?: string | null;
  producto_nombre?: string | null;
  producto_cantidad?: number | null;
  producto_almacen?: string | null;
}

/** ¿La categoría es de recarga (gas / oxígeno / extintores)? → pide bombonas + KG. */
export function esRecargaGas(cat: string): boolean {
  return /gas|ox[ií]geno|extintor|bombona/i.test(cat);
}

export interface ServicioDirecto {
  id: string;
  codigo: string | null;
  descripcion: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  equipo_id: string | null;
  equipo_nombre: string | null;
  cantidad: number;
  items: ServicioDirectoItem[];
  estado: EstadoServicioDirecto;
  gasto: number | null;
  /** Etiquetas de gasto (se eligen al montar; Tesorería las usa al pagar). */
  gasto_categoria: string | null;
  gasto_subcategoria: string | null;
  /** Pago a externo: una persona externa YA pagó el servicio; MGG debe reintegrarle. */
  pago_externo: boolean;
  /** Datos de la persona externa que pagó (nombre, contacto, CI…). */
  pago_externo_datos: string | null;
  /** Nota / motivo libre del servicio (se ve en el detalle, en Tesorería y en el PDF). */
  nota: string | null;
  caja_id: string | null;
  caja_mov_id: string | null;
  adjunto_path: string | null;
  adjunto_nombre: string | null;
  /** Facturas adjuntas (PDF o imagen). La primera se refleja en adjunto_path/nombre. */
  facturas: AdjuntoFactura[];
  solicitante: string | null;
  solicitante_persona: string | null;
  actor: string | null;
  actor_name: string | null;
  /** Quién pagó desde Tesorería (en el flujo montar → pagar). */
  pagada_por: string | null;
  created_at: string;
  finalizada_at: string | null;
  updated_at: string;
}

function normalizar(row: Record<string, unknown>): ServicioDirecto {
  const r = row as unknown as ServicioDirecto;
  let facturas = Array.isArray(r.facturas) ? r.facturas : [];
  // Legado: un servicio con factura suelta se expone como una factura en la lista.
  if (!facturas.length && r.adjunto_path) {
    facturas = [{ path: r.adjunto_path, filename: r.adjunto_nombre ?? 'factura', at: r.finalizada_at ?? r.created_at }];
  }
  return {
    ...r, items: Array.isArray(r.items) ? r.items : [], facturas,
    pago_externo: !!r.pago_externo, pago_externo_datos: r.pago_externo_datos ?? null,
    nota: r.nota ?? null,
  };
}

/** Próximo correlativo SD-YYYY-#### por el MÁXIMO del año + 1 (robusto ante borrados). */
export async function nextCodigoServicioDirecto(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SD-${year}-`;
  const { data, error } = await supabase.from('servicios_directos').select('codigo').like('codigo', `${prefix}%`);
  if (error) throw error;
  let max = 0;
  for (const r of data ?? []) {
    const m = /-(\d+)$/.exec(String(r.codigo ?? ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export async function listServiciosDirectos(): Promise<ServicioDirecto[]> {
  const { data, error } = await supabase
    .from('servicios_directos').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

/* ───────── Alta (varios servicios) ───────── */

export interface LineaServicioInput {
  servicioCategoria: string;
  servicioTipo?: string | null;
  equipoId?: string | null;
  equipoNombre?: string | null;
  cantidad: number;
  bombonas?: number | null;
  kgRecarga?: number | null;
  /** Repuesto del inventario (opcional): se descuenta al crear el servicio. */
  productoId?: string | null;
  productoNombre?: string | null;
  productoCantidad?: number | null;
  productoAlmacen?: string | null;
}

export interface CrearServicioDirectoInput {
  lineas: LineaServicioInput[];
  proveedorId?: string | null;
  proveedorNombre?: string | null;
  solicitante?: string | null;
  solicitantePersona?: string | null;
  actor: string;
  actorName?: string | null;
}

export async function crearServicioDirecto(input: CrearServicioDirectoInput): Promise<ServicioDirecto> {
  const lineas = input.lineas.filter((l) => (Number(l.cantidad) || 0) > 0 && l.servicioCategoria.trim());
  if (!lineas.length) throw new Error('Agregá al menos un servicio con su categoría y cantidad.');

  const items: ServicioDirectoItem[] = lineas.map((l) => {
    const cat = l.servicioCategoria.trim().toUpperCase();
    const tipo = (l.servicioTipo ?? '').trim().toUpperCase() || null;
    const eq = (l.equipoNombre ?? '').trim() || null;
    const recarga = esRecargaGas(cat);
    const bombonas = recarga ? (l.bombonas ?? null) : null;
    const kg = recarga ? (l.kgRecarga ?? null) : null;
    // La descripción incluye bombonas/KG para que se vea en tarjetas, Tesorería y PDF.
    const extra = recarga ? [bombonas != null ? `${bombonas} bombona(s)` : '', kg != null ? `${kg} KG` : ''].filter(Boolean).join(' · ') : '';
    // Repuesto del inventario (solo en mantenimiento, nunca en recarga de gas).
    const prodId = !recarga ? (l.productoId?.trim() || null) : null;
    const prodCant = prodId ? Math.max(0, Number(l.productoCantidad) || 0) : null;
    const prodNombre = prodId ? (l.productoNombre?.trim() || null) : null;
    const prodAlmacen = prodId ? (l.productoAlmacen?.trim() || null) : null;
    const desc = [cat, eq, tipo].filter(Boolean).join(' · ') + (extra ? ` · ${extra}` : '')
      + (prodId && prodCant ? ` · ${prodCant} ${prodNombre ?? 'repuesto'} del inventario` : '');
    return {
      servicio_categoria: cat, servicio_tipo: tipo,
      equipo_id: l.equipoId ?? null, equipo_nombre: eq,
      descripcion: desc, cantidad: Number(l.cantidad) || 0,
      bombonas, kg_recarga: kg,
      producto_id: prodId, producto_nombre: prodNombre,
      producto_cantidad: prodCant && prodCant > 0 ? prodCant : null, producto_almacen: prodAlmacen,
    };
  });

  const totalCantidad = items.reduce((a, i) => a + i.cantidad, 0);
  const resumen = items.length === 1 ? items[0].descripcion : `${items.length} servicios`;
  // Equipo principal: si todos los renglones son del mismo equipo, se guarda en la cabecera.
  const equiposUnicos = Array.from(new Set(items.map((i) => i.equipo_id).filter(Boolean)));
  const equipoId = equiposUnicos.length === 1 ? equiposUnicos[0] : null;
  const equipoNombre = equipoId ? (items.find((i) => i.equipo_id === equipoId)?.equipo_nombre ?? null) : null;
  const codigo = await nextCodigoServicioDirecto();

  const { data, error } = await supabase
    .from('servicios_directos')
    .insert({
      codigo, descripcion: resumen,
      proveedor_id: input.proveedorId ?? null,
      proveedor_nombre: input.proveedorNombre?.trim() || null,
      equipo_id: equipoId, equipo_nombre: equipoNombre,
      cantidad: totalCantidad, items, estado: 'en_proceso',
      solicitante: input.solicitante?.trim() || null,
      solicitante_persona: input.solicitantePersona?.trim() || null,
      actor: input.actor, actor_name: input.actorName ?? null,
    })
    .select('*').single();
  if (error) throw error;
  const servicio = normalizar(data as Record<string, unknown>);

  // Descuento de inventario: los repuestos tomados del stock salen del almacén elegido.
  await descontarRepuestos(servicio);
  return servicio;
}

/** Descuenta del inventario los repuestos de un servicio (salida por cada ítem con producto). */
async function descontarRepuestos(servicio: ServicioDirecto): Promise<void> {
  for (const it of servicio.items) {
    const qty = Number(it.producto_cantidad) || 0;
    if (!it.producto_id || qty <= 0) continue;
    try {
      await registrarMovimiento({
        producto_id: it.producto_id, tipo: 'salida', delta: -qty,
        almacen: it.producto_almacen ?? undefined,
        actor: servicio.actor ?? 'sistema', actor_name: servicio.actor_name ?? null,
        ref_tipo: 'servicio_directo', ref_id: servicio.id, ref_codigo: servicio.codigo ?? undefined,
        detalle: `Servicio directo · repuesto de mantenimiento · ${servicio.codigo ?? servicio.descripcion}`,
        precio_unitario: null,
      });
    } catch { /* el descuento no bloquea la creación del servicio (queda en el kardex si se reintenta) */ }
  }
}

/** Restituye al inventario los repuestos de un servicio (entrada por cada ítem con producto). */
async function restituirRepuestos(servicio: ServicioDirecto): Promise<void> {
  for (const it of servicio.items) {
    const qty = Number(it.producto_cantidad) || 0;
    if (!it.producto_id || qty <= 0) continue;
    try {
      await registrarMovimiento({
        producto_id: it.producto_id, tipo: 'entrada', delta: qty,
        almacen: it.producto_almacen ?? undefined,
        actor: servicio.actor ?? 'sistema', actor_name: servicio.actor_name ?? null,
        ref_tipo: 'servicio_directo_reversa', ref_id: servicio.id, ref_codigo: servicio.codigo ?? undefined,
        detalle: `Reversa de repuesto · servicio ${servicio.codigo ?? servicio.descripcion} eliminado`,
        precio_unitario: null,
      });
    } catch { /* la reversa no bloquea el borrado del servicio */ }
  }
}

/* ───────── Adjunto (factura) ───────── */

export async function subirAdjuntoServicio(servicioId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  // Prefijo de tiempo: permite varias facturas con el mismo nombre sin pisarse.
  const path = `sd/${servicioId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' });
  if (error) throw error;
  return path;
}

export async function urlAdjuntoServicio(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Gestiona las FACTURAS de un servicio ya creado (sirve para finalizados): sube las nuevas
 * (PDF o imagen), borra del Storage las que se quitaron y guarda la lista resultante.
 * adjunto_path/nombre quedan apuntando a la primera factura (compatibilidad).
 */
export async function gestionarFacturasServicio(
  servicio: ServicioDirecto,
  nuevos: File[],
  quitarPaths: string[],
): Promise<ServicioDirecto> {
  const subidas: AdjuntoFactura[] = [];
  for (const f of nuevos) {
    const path = await subirAdjuntoServicio(servicio.id, f);
    subidas.push({ path, filename: f.name, at: new Date().toISOString() });
  }
  if (quitarPaths.length) {
    try { await supabase.storage.from(BUCKET).remove(quitarPaths); } catch { /* el Storage no bloquea */ }
  }
  const facturas = [...(servicio.facturas ?? []).filter((a) => !quitarPaths.includes(a.path)), ...subidas];
  const primera = facturas[0] ?? null;
  const { data, error } = await supabase
    .from('servicios_directos')
    .update({
      facturas,
      adjunto_path: primera?.path ?? null,
      adjunto_nombre: primera?.filename ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', servicio.id)
    .select('*')
    .single();
  if (error) throw error;
  return normalizar(data as Record<string, unknown>);
}

/* ───────── Montar (analista: factura + montos → POR PAGAR) ───────── */

export interface MontarServicioDirectoInput {
  servicio: ServicioDirecto;
  items: ServicioDirectoItem[];   // con el monto (gasto) por renglón
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  /** Pago a externo: una persona externa YA pagó; MGG debe reintegrarle (Tesorería lo ve al pagar). */
  pagoExterno?: boolean;
  pagoExternoDatos?: string | null;
  /** Nota / motivo libre (se ve en el detalle, en Tesorería y en el PDF). */
  nota?: string | null;
  file?: File | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Monta el servicio directo (el analista carga FACTURA + montos). NO toca caja todavía:
 * lo deja POR PAGAR para que Tesorería lo pague.
 */
export async function montarServicioDirecto(input: MontarServicioDirectoInput): Promise<void> {
  const { servicio } = input;
  if (servicio.estado === 'finalizada') throw new Error('Este servicio ya fue pagado.');
  const items = input.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  if (!items.length) throw new Error('El servicio no tiene renglones.');
  const total = Math.round(items.reduce((a, i) => a + (i.gasto || 0), 0) * 100) / 100;
  if (total <= 0) throw new Error('Indicá cuánto costó el servicio.');

  const facturas: AdjuntoFactura[] = [...(servicio.facturas ?? [])];
  if (input.file) {
    const path = await subirAdjuntoServicio(servicio.id, input.file);
    facturas.push({ path, filename: input.file.name, at: new Date().toISOString() });
  }
  const primera = facturas[0] ?? null;

  const { error } = await supabase
    .from('servicios_directos')
    .update({
      estado: 'por_pagar', gasto: total, items,
      gasto_categoria: input.gastoCategoria ?? null, gasto_subcategoria: input.gastoSubcategoria ?? null,
      pago_externo: !!input.pagoExterno,
      pago_externo_datos: input.pagoExterno ? (input.pagoExternoDatos?.trim() || null) : null,
      nota: input.nota?.trim() || null,
      adjunto_path: primera?.path ?? null, adjunto_nombre: primera?.filename ?? null, facturas,
      updated_at: new Date().toISOString(),
    })
    .eq('id', servicio.id);
  if (error) throw error;
}

/* ───────── Pagar (Tesorería: caja → egreso → FINALIZADA) ───────── */

export interface PagarServicioDirectoInput {
  servicio: ServicioDirecto;
  cajaId: string;
  legs?: PagoLeg[];               // multimoneda
  gastoCategoria?: string | null; // categoría de gasto: la elige Tesorería al pagar
  gastoSubcategoria?: string | null;
  actor: string;                  // quién paga (Tesorería)
  actorName?: string | null;
}

/**
 * Paga un servicio directo POR PAGAR (lo hace Tesorería): descuenta el monto de la caja
 * (egreso en el Libro Mayor con la categoría de gasto que elige TESORERÍA al pagar) y lo
 * marca FINALIZADO. NO toca inventario (es un servicio). Queda casado al equipo.
 */
export async function pagarServicioDirecto(input: PagarServicioDirectoInput): Promise<void> {
  const { servicio } = input;
  if (servicio.estado !== 'por_pagar') throw new Error('Solo se paga un servicio que esté POR PAGAR.');
  if (!input.cajaId) throw new Error('Elegí la caja de la que sale el dinero.');
  const total = Math.round(servicio.items.reduce((a, i) => a + (Number(i.gasto) || 0), 0) * 100) / 100;
  if (total <= 0) throw new Error('El servicio no tiene montos cargados.');

  // La categoría/subcategoría de gasto la fija Tesorería al pagar (fallback: lo que trajera el servicio).
  const gCat = input.gastoCategoria ?? servicio.gasto_categoria ?? null;
  const gSub = input.gastoSubcategoria ?? servicio.gasto_subcategoria ?? null;

  const concepto = `Servicio directo · ${servicio.descripcion}`;
  const legs = (input.legs ?? []).filter((l) => Number(l.monto) > 0);
  let movCajaId: string;
  if (legs.length) {
    let primero: string | null = null;
    for (const leg of legs) {
      const r = await egresarDivisa({
        cajaId: input.cajaId, cuenta: leg.cuenta, moneda: leg.moneda, monto: Number(leg.monto),
        concepto, categoria: 'servicio_directo',
        gastoCategoria: gCat, gastoSubcategoria: gSub,
        actor: input.actor, actorName: input.actorName ?? null,
      });
      if (!primero) primero = r.id;
    }
    if (!primero) throw new Error('Indicá cuánto pagar en al menos una moneda.');
    movCajaId = primero;
  } else {
    const movCaja = await registrarGasto({
      cajaId: input.cajaId, monto: total,
      concepto, categoria: 'servicio_directo',
      gastoCategoria: gCat, gastoSubcategoria: gSub,
      actor: input.actor, actorName: input.actorName ?? null,
    });
    movCajaId = movCaja.id;
  }

  const { error } = await supabase
    .from('servicios_directos')
    .update({
      estado: 'finalizada', gasto: total,
      gasto_categoria: gCat, gasto_subcategoria: gSub,
      caja_id: input.cajaId, caja_mov_id: movCajaId,
      pagada_por: input.actorName || input.actor,
      finalizada_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    .eq('id', servicio.id);
  if (error) throw error;
}

/** Servicios directos POR PAGAR (los monta el analista; Tesorería los paga). */
export async function listServiciosPorPagar(): Promise<ServicioDirecto[]> {
  const { data, error } = await supabase
    .from('servicios_directos').select('*').eq('estado', 'por_pagar')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

export interface EditarServicioFinalizadoInput {
  servicio: ServicioDirecto;
  /** Ítems con el nuevo monto (gasto) por renglón. */
  items: ServicioDirectoItem[];
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  /** Pago a externo (editable al corregir montos). */
  pagoExterno?: boolean;
  pagoExternoDatos?: string | null;
  /** Nota / motivo (editable al corregir montos). */
  nota?: string | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Edita un servicio directo YA FINALIZADO y sincroniza todo:
 *  · Tesorería: ajusta el egreso (mismo movimiento) al nuevo total (saldo + Libro Mayor).
 *  · Maquinaria / Control de Mantenimiento: lee servicios_directos en vivo, así que los
 *    nuevos montos y datos quedan reflejados al instante (no entra al inventario).
 * Solo soporta pagos en una sola moneda (el movimiento debe coincidir con el total previo).
 */
export async function editarServicioDirectoFinalizado(input: EditarServicioFinalizadoInput): Promise<void> {
  const { servicio } = input;
  if (servicio.estado !== 'finalizada') throw new Error('Solo se edita un servicio ya finalizado.');
  const items = input.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  const nuevoTotal = Math.round(items.reduce((a, i) => a + (i.gasto || 0), 0) * 100) / 100;
  if (nuevoTotal <= 0) throw new Error('El total debe ser mayor que 0.');
  const totalPrevio = Math.round(Number(servicio.gasto || 0) * 100) / 100;

  if (!servicio.caja_mov_id) throw new Error('El servicio no tiene egreso de caja asociado.');
  const mov = await getMovimientoCajaPorId(servicio.caja_mov_id);
  if (!mov) throw new Error('No se encontró el egreso en Tesorería; corregí el monto manualmente.');
  if (Math.round(Number(mov.monto) * 100) / 100 !== totalPrevio) {
    throw new Error('Este servicio se pagó con multimoneda (varias monedas). Corregí el egreso desde Tesorería y volvé a intentar.');
  }
  await editarMovimientoCaja(mov, {
    monto: nuevoTotal,
    motivo: `Servicio directo · ${servicio.descripcion}`,
    gastoCategoria: input.gastoCategoria ?? undefined,
    gastoSubcategoria: input.gastoSubcategoria ?? undefined,
  });

  const updatePago = input.pagoExterno !== undefined
    ? { pago_externo: !!input.pagoExterno, pago_externo_datos: input.pagoExterno ? (input.pagoExternoDatos?.trim() || null) : null }
    : {};
  const updateNota = input.nota !== undefined ? { nota: input.nota?.trim() || null } : {};
  const { error } = await supabase
    .from('servicios_directos')
    .update({ items, gasto: nuevoTotal, ...updatePago, ...updateNota, updated_at: new Date().toISOString() })
    .eq('id', servicio.id);
  if (error) throw error;
}

/**
 * Elimina un servicio directo en CUALQUIER estado y deja todo consistente:
 *  · FINALIZADO: reversa el egreso de caja (devuelve el dinero a la caja y recomputa la cadena).
 *    Si se pagó con multimoneda (varios movimientos), pide reversarlo antes desde Tesorería.
 *  · POR PAGAR / EN PROCESO: no tocaron caja, solo se borra.
 *  En todos los casos devuelve al inventario los repuestos que se habían descontado al crear.
 */
export async function eliminarServicioDirecto(servicio: ServicioDirecto): Promise<void> {
  if (servicio.estado === 'finalizada' && servicio.caja_mov_id) {
    const mov = await getMovimientoCajaPorId(servicio.caja_mov_id);
    if (mov) {
      const total = Math.round(Number(servicio.gasto || 0) * 100) / 100;
      if (Math.round(Number(mov.monto) * 100) / 100 !== total) {
        throw new Error('Este servicio se pagó con multimoneda (varias monedas). Reversá el egreso desde Tesorería y luego eliminá.');
      }
      await eliminarMovimientoCaja(mov);   // devuelve el dinero a la caja + recomputa saldos
    }
  }
  // Devuelve al inventario los repuestos que se habían descontado al crear el servicio.
  await restituirRepuestos(servicio);
  if (servicio.adjunto_path) {
    try { await supabase.storage.from(BUCKET).remove([servicio.adjunto_path]); } catch { /* el adjunto no bloquea el borrado */ }
  }
  const { error } = await supabase.from('servicios_directos').delete().eq('id', servicio.id);
  if (error) throw error;
}

/** Servicios directos vinculados a equipos, agrupados por equipo_id (para Control de Maquinaria). */
export async function serviciosDirectosPorEquipo(): Promise<Map<string, ServicioDirecto[]>> {
  const { data, error } = await supabase
    .from('servicios_directos').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  const out = new Map<string, ServicioDirecto[]>();
  for (const row of data ?? []) {
    const s = normalizar(row as Record<string, unknown>);
    const vistos = new Set<string>();
    for (const it of s.items) {
      const eq = it.equipo_id;
      if (!eq || vistos.has(eq)) continue;
      vistos.add(eq);
      const arr = out.get(eq) ?? [];
      arr.push(s);
      out.set(eq, arr);
    }
  }
  return out;
}
