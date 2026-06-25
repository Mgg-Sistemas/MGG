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
import { registrarGasto } from '@/modules/tesoreria/tesoreria.repository';
import { egresarDivisa } from '@/modules/tesoreria/cajaSaldos.repository';
import type { PagoLeg } from './compras.repository';

const BUCKET = 'compras-directas'; // se reutiliza el bucket existente (prefijo sd/)

export type EstadoServicioDirecto = 'en_proceso' | 'finalizada';

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
  caja_id: string | null;
  caja_mov_id: string | null;
  adjunto_path: string | null;
  adjunto_nombre: string | null;
  solicitante: string | null;
  solicitante_persona: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
  finalizada_at: string | null;
  updated_at: string;
}

function normalizar(row: Record<string, unknown>): ServicioDirecto {
  const r = row as unknown as ServicioDirecto;
  return { ...r, items: Array.isArray(r.items) ? r.items : [] };
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
    const desc = [cat, eq, tipo].filter(Boolean).join(' · ') + (extra ? ` · ${extra}` : '');
    return {
      servicio_categoria: cat, servicio_tipo: tipo,
      equipo_id: l.equipoId ?? null, equipo_nombre: eq,
      descripcion: desc, cantidad: Number(l.cantidad) || 0,
      bombonas, kg_recarga: kg,
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
  return normalizar(data as Record<string, unknown>);
}

/* ───────── Adjunto (factura) ───────── */

export async function subirAdjuntoServicio(servicioId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `sd/${servicioId}/${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' });
  if (error) throw error;
  return path;
}

export async function urlAdjuntoServicio(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

/* ───────── Finalizar (factura + montos + caja de Tesorería) ───────── */

export interface FinalizarServicioDirectoInput {
  servicio: ServicioDirecto;
  items: ServicioDirectoItem[];   // con el monto (gasto) por renglón
  cajaId: string;
  legs?: PagoLeg[];               // multimoneda
  gastoCategoria?: string | null;
  gastoSubcategoria?: string | null;
  file?: File | null;
  actor: string;
  actorName?: string | null;
}

/**
 * Completa el servicio directo: adjunta la factura, descuenta el monto total de la
 * caja elegida (egreso en Tesorería / Libro Mayor) y cierra el servicio. NO toca el
 * inventario (es un servicio, no entra stock).
 */
export async function finalizarServicioDirecto(input: FinalizarServicioDirectoInput): Promise<void> {
  const { servicio } = input;
  if (servicio.estado !== 'en_proceso') throw new Error('Este servicio ya fue completado.');
  if (!input.cajaId) throw new Error('Elegí la caja de la que sale el dinero.');
  const items = input.items.map((i) => ({ ...i, gasto: Math.max(0, Number(i.gasto) || 0) }));
  if (!items.length) throw new Error('El servicio no tiene renglones.');
  const total = Math.round(items.reduce((a, i) => a + (i.gasto || 0), 0) * 100) / 100;
  if (total <= 0) throw new Error('Indicá cuánto costó el servicio.');

  // 1) Egreso de la caja (valida saldo) → pasa por Tesorería.
  const concepto = `Servicio directo · ${servicio.descripcion}`;
  const legs = (input.legs ?? []).filter((l) => Number(l.monto) > 0);
  let movCajaId: string;
  if (legs.length) {
    let primero: string | null = null;
    for (const leg of legs) {
      const r = await egresarDivisa({
        cajaId: input.cajaId, cuenta: leg.cuenta, moneda: leg.moneda, monto: Number(leg.monto),
        concepto, categoria: 'servicio_directo',
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
      concepto, categoria: 'servicio_directo',
      gastoCategoria: input.gastoCategoria ?? null, gastoSubcategoria: input.gastoSubcategoria ?? null,
      actor: input.actor, actorName: input.actorName ?? null,
    });
    movCajaId = movCaja.id;
  }

  // 2) Factura (opcional).
  let adjuntoPath: string | null = null;
  let adjuntoNombre: string | null = null;
  if (input.file) {
    adjuntoPath = await subirAdjuntoServicio(servicio.id, input.file);
    adjuntoNombre = input.file.name;
  }

  // 3) Cerrar el servicio directo.
  const { error } = await supabase
    .from('servicios_directos')
    .update({
      estado: 'finalizada', gasto: total, items,
      caja_id: input.cajaId, caja_mov_id: movCajaId,
      adjunto_path: adjuntoPath, adjunto_nombre: adjuntoNombre,
      finalizada_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    .eq('id', servicio.id);
  if (error) throw error;
}

/** Elimina un servicio directo EN PROCESO (todavía no tocó caja). */
export async function eliminarServicioDirecto(servicio: ServicioDirecto): Promise<void> {
  if (servicio.estado !== 'en_proceso')
    throw new Error('Solo se puede eliminar un servicio EN PROCESO (los finalizados ya afectaron la caja).');
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
