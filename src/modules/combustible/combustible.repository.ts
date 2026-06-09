/* ============================================================
   MGG · Combustible (Supabase)
   Inventario de combustible por tipo (litros + costo promedio por
   litro) y solicitudes de salida con flujo de aprobación:
     por_aprobar → aprobada → finalizada (descuenta litros).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type {
  Combustible,
  EventoHistorial,
  MovimientoCombustible,
  SolicitudCombustible,
  Tanque,
} from '@/shared/lib/types';
import { createProducto, listProductos, siguienteSku } from '@/modules/inventario/inventario.repository';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';

/** Categoría y unidad con que se da de alta cada combustible en el inventario. */
const CATEGORIA_COMBUSTIBLE = 'Combustible';
const UNIDAD_COMBUSTIBLE = 'l';

/* ───────────── Inventario de combustible ───────────── */

export async function listCombustibles(): Promise<Combustible[]> {
  const { data, error } = await supabase
    .from('combustibles')
    .select('*, producto:producto_id(almacen)')
    .order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const { producto, ...rest } = row as { producto?: { almacen?: string | null } | null } & Record<string, unknown>;
    return { ...(rest as unknown as Combustible), home_almacen: producto?.almacen ?? null };
  });
}

/**
 * Garantiza que el combustible tenga un producto vinculado en el inventario.
 * Si no existe (combustible legado), lo da de alta en el almacén indicado y
 * guarda el `producto_id`. Devuelve el id del producto.
 */
async function ensureProductoCombustible(comb: Pick<Combustible, 'id' | 'nombre' | 'producto_id' | 'costo_litro'>, almacen: string): Promise<string> {
  if (comb.producto_id) return comb.producto_id;
  const productos = await listProductos();
  const sku = siguienteSku(CATEGORIA_COMBUSTIBLE, productos);
  const prod = await createProducto({
    sku,
    nombre: comb.nombre,
    categoria: CATEGORIA_COMBUSTIBLE,
    unidad: UNIDAD_COMBUSTIBLE,
    stock: 0,
    stock_min: 0,
    precio: Math.max(0, Number(comb.costo_litro) || 0),
    almacen,
    estado: 'activo',
  });
  await supabase.from('combustibles').update({ producto_id: prod.id }).eq('id', comb.id);
  return prod.id;
}

/** Stock disponible de un producto en un almacén concreto (existencia). */
async function stockEnAlmacen(productoId: string, almacen: string): Promise<number> {
  const { data } = await supabase
    .from('existencias')
    .select('stock')
    .eq('producto_id', productoId)
    .eq('almacen', almacen)
    .maybeSingle();
  return Number(data?.stock) || 0;
}

export async function crearCombustible(input: {
  nombre: string;
  /** Almacén del inventario donde se registra el combustible (traza Inventario → Combustible). */
  almacen: string;
  litrosIniciales?: number;
  costoLitro?: number;
  actorEmail?: string;
}): Promise<Combustible> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('El nombre del combustible es obligatorio.');
  const almacen = (input.almacen || '').trim();
  if (!almacen) throw new Error('Indicá el almacén donde se registra el combustible.');
  const litros = Math.max(0, Number(input.litrosIniciales) || 0);
  const costo = Math.max(0, Number(input.costoLitro) || 0);

  // 1) Se registra PRIMERO en el inventario: alta del producto en el almacén elegido.
  const productos = await listProductos();
  const sku = siguienteSku(CATEGORIA_COMBUSTIBLE, productos);
  const prod = await createProducto({
    sku,
    nombre,
    categoria: CATEGORIA_COMBUSTIBLE,
    unidad: UNIDAD_COMBUSTIBLE,
    stock: 0,
    stock_min: 0,
    precio: costo,
    almacen,
    estado: 'activo',
  });

  // 2) Se crea el combustible vinculado a ese producto.
  const { data, error } = await supabase
    .from('combustibles')
    .insert({ nombre, litros: 0, costo_litro: costo, producto_id: prod.id, created_by: input.actorEmail ?? null })
    .select('*')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ya existe un combustible con ese nombre.');
    throw error;
  }

  // 3) Si arranca con litros, los ingresamos (entra al inventario + kardex de combustible).
  if (litros > 0) {
    await registrarIngreso({
      combustibleId: (data as Combustible).id,
      almacen,
      litros,
      costoLitro: costo,
      actor: input.actorEmail ?? 'sistema',
      detalle: 'Ingreso inicial',
    });
  }
  return { ...(data as Combustible), home_almacen: almacen };
}

export async function renombrarCombustible(id: string, nombre: string): Promise<void> {
  const n = nombre.trim();
  if (!n) throw new Error('El nombre no puede estar vacío.');
  const { error } = await supabase.from('combustibles').update({ nombre: n, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ya existe un combustible con ese nombre.');
    throw error;
  }
}

export async function setEstadoCombustible(id: string, estado: 'activo' | 'inactivo'): Promise<void> {
  const { error } = await supabase.from('combustibles').update({ estado, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Promedio móvil ponderado por litro. */
function pmpLitro(litrosPrev: number, costoPrev: number, litros: number, costo: number): number {
  const total = litrosPrev + litros;
  if (total <= 0) return costo;
  return Math.round(((litrosPrev * costoPrev + litros * costo) / total) * 10000) / 10000;
}

/**
 * Registra un INGRESO de litros: entra automáticamente al inventario del
 * combustible (suma litros) y recalcula el costo promedio por litro (PMP).
 */
export async function registrarIngreso(input: {
  combustibleId: string;
  /** Almacén del inventario al que entra el combustible. */
  almacen: string;
  litros: number;
  costoLitro: number;
  /** Tanque destino opcional: además del inventario, suma litros a ese tanque. */
  tanqueId?: string | null;
  actor: string;
  actorName?: string | null;
  detalle?: string | null;
}): Promise<void> {
  const litros = Number(input.litros) || 0;
  if (litros <= 0) throw new Error('Los litros deben ser mayores que 0.');
  const almacen = (input.almacen || '').trim();
  if (!almacen) throw new Error('Indicá el almacén del ingreso.');
  const costo = Math.max(0, Number(input.costoLitro) || 0);

  // Si entra a un tanque, validamos capacidad antes de tocar el inventario.
  if (input.tanqueId) {
    const { data: tq } = await supabase.from('combustible_tanques').select('litros, capacidad_litros, nombre').eq('id', input.tanqueId).maybeSingle();
    if (tq) {
      const nuevos = (Number(tq.litros) || 0) + litros;
      if (nuevos > (Number(tq.capacidad_litros) || 0) + 0.0001) {
        throw new Error(`El ingreso supera la capacidad del tanque "${tq.nombre}" (${tq.capacidad_litros} L).`);
      }
    }
  }

  const { data: comb, error: cErr } = await supabase
    .from('combustibles')
    .select('id, nombre, litros, costo_litro, producto_id')
    .eq('id', input.combustibleId)
    .single();
  if (cErr || !comb) throw cErr ?? new Error('Combustible no encontrado.');

  // 1) Entra al INVENTARIO (entrada en el almacén elegido, recalcula el PMP de la existencia).
  const productoId = await ensureProductoCombustible(comb as Combustible, almacen);
  await registrarMovimiento({
    producto_id: productoId,
    tipo: 'entrada',
    delta: litros,
    almacen,
    precio_unitario: costo,
    actor: input.actor,
    actor_name: input.actorName ?? null,
    ref_tipo: 'combustible_ingreso',
    ref_id: input.combustibleId,
    detalle: input.detalle ?? 'Ingreso de combustible',
  });

  // 2) Tarjeta de combustible: suma litros + PMP por litro, y kardex propio.
  const litrosAntes = Number(comb.litros) || 0;
  const costoAntes = Number(comb.costo_litro) || 0;
  const litrosDespues = litrosAntes + litros;
  const nuevoCosto = pmpLitro(litrosAntes, costoAntes, litros, costo);

  const { error: mErr } = await supabase.from('combustible_movimientos').insert({
    combustible_id: input.combustibleId,
    tipo: 'ingreso',
    litros,
    costo_litro: costo,
    litros_antes: litrosAntes,
    litros_despues: litrosDespues,
    detalle: `${input.detalle ?? 'Ingreso'} · ${almacen}`,
    actor: input.actor,
    actor_name: input.actorName ?? null,
  });
  if (mErr) throw mErr;

  const { error: uErr } = await supabase
    .from('combustibles')
    .update({ litros: litrosDespues, costo_litro: nuevoCosto, updated_at: new Date().toISOString() })
    .eq('id', input.combustibleId);
  if (uErr) throw uErr;

  // 3) Tanque destino: suma los litros (se refleja en el tanque además del inventario).
  if (input.tanqueId) {
    const { data: tq } = await supabase.from('combustible_tanques').select('litros').eq('id', input.tanqueId).maybeSingle();
    if (tq) {
      await supabase.from('combustible_tanques')
        .update({ litros: (Number(tq.litros) || 0) + litros, updated_at: new Date().toISOString() })
        .eq('id', input.tanqueId);
    }
  }
}

export async function listMovimientosCombustible(combustibleId: string): Promise<MovimientoCombustible[]> {
  const { data, error } = await supabase
    .from('combustible_movimientos')
    .select('*')
    .eq('combustible_id', combustibleId)
    .order('at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MovimientoCombustible[];
}

/** Una fila de consumo de combustible (litros + $). */
export interface ConsumoCombustibleItem {
  id: string;
  nombre: string;
  cantidad: number;   // litros consumidos en el período
  valor: number;      // equivalente en $ (litros × costo por litro)
}

/**
 * Consumo de combustible POR TIPO en un rango de fechas (salidas). El valor en $
 * usa el costo por litro registrado en cada salida.
 */
export async function consumoCombustiblePeriodo(desde: Date, hasta: Date): Promise<ConsumoCombustibleItem[]> {
  const { data, error } = await supabase
    .from('combustible_movimientos')
    .select('combustible_id, litros, costo_litro, at, combustible:combustibles(nombre)')
    .eq('tipo', 'salida')
    .gte('at', desde.toISOString())
    .lte('at', hasta.toISOString());
  if (error) throw error;

  const acc = new Map<string, ConsumoCombustibleItem>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const cid = row.combustible_id as string;
    const litros = Math.abs(Number(row.litros) || 0);
    if (litros <= 0) continue;
    const comb = (row.combustible ?? {}) as { nombre?: string };
    const costo = Number(row.costo_litro) || 0;
    const cur = acc.get(cid) ?? { id: cid, nombre: comb.nombre ?? '—', cantidad: 0, valor: 0 };
    cur.cantidad += litros;
    cur.valor += litros * costo;
    acc.set(cid, cur);
  }
  return Array.from(acc.values()).map((x) => ({
    ...x,
    cantidad: Math.round(x.cantidad * 100) / 100,
    valor: Math.round(x.valor * 100) / 100,
  }));
}

/* ───────────── Tanques (depósitos físicos de combustible) ───────────── */

export async function listTanques(): Promise<Tanque[]> {
  const { data, error } = await supabase
    .from('combustible_tanques')
    .select('*, combustible:combustible_id(nombre)')
    .order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const { combustible, ...rest } = row as { combustible?: { nombre?: string | null } | null } & Record<string, unknown>;
    return { ...(rest as unknown as Tanque), combustible_nombre: combustible?.nombre ?? null };
  });
}

export async function crearTanque(input: {
  nombre: string;
  combustibleId?: string | null;
  capacidadLitros: number;
  litrosIniciales?: number;
  ubicacion?: string | null;
  actorEmail?: string | null;
}): Promise<Tanque> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('El nombre del tanque es obligatorio.');
  const capacidad = Number(input.capacidadLitros) || 0;
  if (capacidad <= 0) throw new Error('La capacidad debe ser mayor que 0.');
  const litros = Math.max(0, Number(input.litrosIniciales) || 0);
  if (litros > capacidad) throw new Error('Los litros actuales no pueden superar la capacidad del tanque.');

  const { data, error } = await supabase
    .from('combustible_tanques')
    .insert({
      nombre,
      combustible_id: input.combustibleId || null,
      capacidad_litros: capacidad,
      litros,
      ubicacion: input.ubicacion?.trim() || null,
      created_by: input.actorEmail ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Tanque;
}

export async function actualizarTanque(id: string, input: {
  nombre?: string;
  combustibleId?: string | null;
  capacidadLitros?: number;
  litros?: number;
  ubicacion?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.nombre !== undefined) {
    const n = input.nombre.trim();
    if (!n) throw new Error('El nombre no puede estar vacío.');
    patch.nombre = n;
  }
  if (input.combustibleId !== undefined) patch.combustible_id = input.combustibleId || null;
  if (input.capacidadLitros !== undefined) patch.capacidad_litros = Number(input.capacidadLitros) || 0;
  if (input.litros !== undefined) patch.litros = Math.max(0, Number(input.litros) || 0);
  if (input.ubicacion !== undefined) patch.ubicacion = input.ubicacion?.trim() || null;
  const { error } = await supabase.from('combustible_tanques').update(patch).eq('id', id);
  if (error) throw error;
}

export async function setEstadoTanque(id: string, estado: 'activo' | 'inactivo'): Promise<void> {
  const { error } = await supabase.from('combustible_tanques').update({ estado, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function eliminarTanque(id: string): Promise<void> {
  const { error } = await supabase.from('combustible_tanques').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Solicitudes de salida ───────────── */

function appendHistorial(s: Pick<SolicitudCombustible, 'historial'>, evento: string, actor: string, meta: Record<string, unknown> = {}): EventoHistorial[] {
  const ev = { at: new Date().toISOString(), evento, actor, ...meta } as EventoHistorial;
  return [...(s.historial ?? []), ev];
}

/** Próximo código CMB-AAAA-NNNN. */
async function nextCodigoSolicitud(): Promise<string> {
  const year = new Date().getFullYear();
  const { count, error } = await supabase
    .from('combustible_solicitudes')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return `CMB-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

export async function listSolicitudesCombustible(): Promise<SolicitudCombustible[]> {
  const { data, error } = await supabase
    .from('combustible_solicitudes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SolicitudCombustible[];
}

export async function crearSolicitudCombustible(input: {
  combustibleId: string;
  combustibleNombre: string;
  solicitante: string;
  destino: string;
  /** Almacén del inventario de donde saldrá el combustible. */
  almacen: string;
  /** Tanque origen opcional: al finalizar descuenta del tanque y del inventario. */
  tanqueId?: string | null;
  tanqueNombre?: string | null;
  litros: number;
  motivo?: string | null;
  actor: string;
  actorName?: string | null;
}): Promise<SolicitudCombustible> {
  const litros = Number(input.litros) || 0;
  if (litros <= 0) throw new Error('Los litros solicitados deben ser mayores que 0.');
  if (!input.solicitante.trim()) throw new Error('Indicá quién hace la solicitud.');
  if (!input.destino.trim()) throw new Error('Indicá a dónde va el combustible.');
  const almacen = (input.almacen || '').trim();
  if (!almacen) throw new Error('Indicá de qué almacén sale el combustible.');

  const codigo = await nextCodigoSolicitud();
  const historial = appendHistorial({ historial: [] }, 'creada', input.actor, { litros, almacen });
  const { data, error } = await supabase
    .from('combustible_solicitudes')
    .insert({
      codigo,
      combustible_id: input.combustibleId,
      combustible_nombre: input.combustibleNombre,
      solicitante: input.solicitante.trim(),
      destino: input.destino.trim(),
      almacen,
      tanque_id: input.tanqueId || null,
      tanque_nombre: input.tanqueNombre?.trim() || null,
      litros,
      estado: 'por_aprobar',
      motivo: input.motivo?.trim() || null,
      historial,
      actor: input.actor,
      actor_name: input.actorName ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as SolicitudCombustible;
}

export async function aprobarSolicitudCombustible(s: SolicitudCombustible, actor: string): Promise<void> {
  if (s.estado !== 'por_aprobar') throw new Error('Solo se aprueban solicitudes por aprobar.');
  const { error } = await supabase
    .from('combustible_solicitudes')
    .update({
      estado: 'aprobada',
      aprobada_por: actor,
      aprobada_en: new Date().toISOString(),
      historial: appendHistorial(s, 'aprobada', actor),
    })
    .eq('id', s.id);
  if (error) throw error;
}

/**
 * Finaliza la solicitud: descuenta los litros del inventario del combustible
 * (movimiento tipo 'salida') y cierra el trámite.
 */
export async function finalizarSolicitudCombustible(s: SolicitudCombustible, actor: string, actorName?: string | null): Promise<void> {
  if (s.estado !== 'aprobada') throw new Error('Solo se finalizan solicitudes aprobadas.');
  if (!s.combustible_id) throw new Error('La solicitud no tiene un combustible asociado.');
  const litros = Number(s.litros) || 0;

  const { data: comb, error: cErr } = await supabase
    .from('combustibles')
    .select('id, nombre, litros, costo_litro, producto_id')
    .eq('id', s.combustible_id)
    .single();
  if (cErr || !comb) throw cErr ?? new Error('Combustible no encontrado.');
  const litrosAntes = Number(comb.litros) || 0;
  const costo = Number(comb.costo_litro) || 0;

  // Almacén de origen: el de la solicitud (o el del producto como respaldo para datos legados).
  const productoId = await ensureProductoCombustible(comb as Combustible, s.almacen?.trim() || 'General');
  const almacen = (s.almacen?.trim()) || (await (async () => {
    const { data } = await supabase.from('productos').select('almacen').eq('id', productoId).maybeSingle();
    return (data?.almacen as string) || 'General';
  })());

  // Validamos contra la existencia REAL de ese almacén (fuente de verdad del inventario).
  const stockAlmacen = await stockEnAlmacen(productoId, almacen);
  if (litros > stockAlmacen) throw new Error(`Stock insuficiente en ${almacen}. Disponible: ${stockAlmacen} L.`);
  // Si la salida es de un tanque, validamos también sus litros propios.
  let tanqueLitrosAntes: number | null = null;
  if (s.tanque_id) {
    const { data: tq } = await supabase.from('combustible_tanques').select('litros, nombre').eq('id', s.tanque_id).maybeSingle();
    if (tq) {
      tanqueLitrosAntes = Number(tq.litros) || 0;
      if (litros > tanqueLitrosAntes) throw new Error(`El tanque "${tq.nombre}" no tiene litros suficientes. Disponible: ${tanqueLitrosAntes} L.`);
    }
  }
  const litrosDespues = Math.max(0, litrosAntes - litros);

  // 1) Sale del INVENTARIO (salida en el almacén de origen).
  await registrarMovimiento({
    producto_id: productoId,
    tipo: 'salida',
    delta: -litros,
    almacen,
    destino: s.destino,
    actor,
    actor_name: actorName ?? null,
    ref_tipo: 'combustible_salida',
    ref_id: s.id,
    ref_codigo: s.codigo,
    detalle: `Salida ${s.codigo} → ${s.destino}`,
  });

  // 2) Tarjeta de combustible + kardex propio.
  const { data: mov, error: mErr } = await supabase
    .from('combustible_movimientos')
    .insert({
      combustible_id: s.combustible_id,
      tipo: 'salida',
      litros: -litros,
      costo_litro: costo,
      litros_antes: litrosAntes,
      litros_despues: litrosDespues,
      ref_solicitud_id: s.id,
      detalle: `Salida ${s.codigo} → ${s.destino} · ${almacen}`,
      actor,
      actor_name: actorName ?? null,
    })
    .select('id')
    .single();
  if (mErr) throw mErr;

  const { error: uErr } = await supabase
    .from('combustibles')
    .update({ litros: litrosDespues, updated_at: new Date().toISOString() })
    .eq('id', s.combustible_id);
  if (uErr) throw uErr;

  // 3) Tanque origen: descuenta sus litros propios (se refleja en el tanque además del inventario).
  if (s.tanque_id && tanqueLitrosAntes != null) {
    await supabase.from('combustible_tanques')
      .update({ litros: Math.max(0, tanqueLitrosAntes - litros), updated_at: new Date().toISOString() })
      .eq('id', s.tanque_id);
  }

  const { error: sErr } = await supabase
    .from('combustible_solicitudes')
    .update({
      estado: 'finalizada',
      finalizada_por: actor,
      finalizada_en: new Date().toISOString(),
      mov_id: (mov as { id: string }).id,
      historial: appendHistorial(s, 'finalizada', actor, { litros }),
    })
    .eq('id', s.id);
  if (sErr) throw sErr;
}

export async function cancelarSolicitudCombustible(s: SolicitudCombustible, actor: string, motivo: string): Promise<void> {
  if (s.estado === 'finalizada') throw new Error('No se puede cancelar una solicitud finalizada.');
  const { error } = await supabase
    .from('combustible_solicitudes')
    .update({
      estado: 'cancelada',
      historial: appendHistorial(s, 'cancelada', actor, { motivo }),
    })
    .eq('id', s.id);
  if (error) throw error;
}
