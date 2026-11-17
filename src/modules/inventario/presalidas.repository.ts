/* ============================================================
   MGG · Pre-salidas de Almacén · Repositorio y persistencia
   17-11-2026.
   Manejo híbrido: lee y guarda en Supabase (tabla `inventario_presalidas`)
   con respaldo y sincronización transparente en `localStorage` por si
   la tabla aún no fue creada en la base de datos de producción.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { siguienteCodigoPreSalida, type LineaPreSalida, type PreSalida, type PreSalidaInput } from './presalidas';

const TABLE = 'inventario_presalidas';
const STORAGE_KEY = 'mgg.inventario.presalidas';

const faltaSql = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || e.code === 'PGRST204'
    || /does not exist|Could not find the (table|.*column)/i.test(e.message ?? ''));

function leerLocal(): PreSalida[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function guardarLocal(lista: PreSalida[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  } catch {
    // quota exceeded or disabled
  }
}

function normalizarFila(r: Record<string, unknown>): PreSalida {
  return {
    id: String(r.id),
    codigo: String(r.codigo || ''),
    almacen: String(r.almacen || ''),
    motivo: String(r.motivo || ''),
    retorna: Boolean(r.retorna),
    equipo: r.equipo_id ? { id: String(r.equipo_id), nombre: String(r.equipo_nombre || '') } : null,
    tipoMant: r.tipo_mant ? String(r.tipo_mant) : null,
    lineas: Array.isArray(r.lineas) ? (r.lineas as LineaPreSalida[]) : [],
    estado: (r.estado as PreSalida['estado']) || 'pendiente',
    autorizadoPor: r.autorizado_por ? String(r.autorizado_por) : null,
    salidaCodigo: r.salida_codigo ? String(r.salida_codigo) : null,
    actor: String(r.actor || ''),
    actorName: r.actor_name ? String(r.actor_name) : null,
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || new Date().toISOString()),
  };
}

/** Obtiene las pre-salidas (por defecto solo pendientes, opcionalmente de un almacén). */
export async function listPreSalidas(almacen?: string, soloPendientes = true): Promise<PreSalida[]> {
  try {
    let q = supabase.from(TABLE).select('*').order('created_at', { ascending: false });
    if (almacen) q = q.eq('almacen', almacen);
    if (soloPendientes) q = q.eq('estado', 'pendiente');

    const { data, error } = await q;
    if (error) {
      if (faltaSql(error)) {
        const local = leerLocal();
        return local
          .filter((x) => (!almacen || x.almacen === almacen) && (!soloPendientes || x.estado === 'pendiente'))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      throw error;
    }

    const remotas = ((data ?? []) as Record<string, unknown>[]).map(normalizarFila);
    // Sincronizar en local
    guardarLocal(remotas);
    return remotas;
  } catch {
    const local = leerLocal();
    return local
      .filter((x) => (!almacen || x.almacen === almacen) && (!soloPendientes || x.estado === 'pendiente'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/** Guarda una nueva pre-salida (borrador) con su código correlativo. */
export async function guardarPreSalida(input: PreSalidaInput): Promise<PreSalida> {
  const existentes = await listPreSalidas(input.almacen, false).catch(() => leerLocal());
  const codigo = input.codigo || siguienteCodigoPreSalida(existentes);
  const ahora = new Date().toISOString();
  const id = input.id || crypto.randomUUID();

  const nueva: PreSalida = {
    id,
    codigo,
    almacen: input.almacen,
    motivo: input.motivo.trim(),
    retorna: Boolean(input.retorna),
    equipo: input.equipo || null,
    tipoMant: input.tipoMant || null,
    lineas: input.lineas,
    estado: 'pendiente',
    autorizadoPor: null,
    salidaCodigo: null,
    actor: input.actor,
    actorName: input.actorName,
    createdAt: ahora,
    updatedAt: ahora,
  };

  // Guardar en local de respaldo
  const local = leerLocal().filter((x) => x.id !== id);
  guardarLocal([nueva, ...local]);

  try {
    const fila = {
      id,
      codigo,
      almacen: input.almacen,
      motivo: input.motivo.trim(),
      retorna: Boolean(input.retorna),
      equipo_id: input.equipo?.id || null,
      equipo_nombre: input.equipo?.nombre || null,
      tipo_mant: input.tipoMant || null,
      lineas: input.lineas,
      estado: 'pendiente',
      actor: input.actor,
      actor_name: input.actorName,
      created_at: ahora,
      updated_at: ahora,
    };

    const { data, error } = await supabase.from(TABLE).insert(fila).select('*').single();
    if (error && !faltaSql(error)) throw error;
    if (data) return normalizarFila(data as Record<string, unknown>);
  } catch (e) {
    if (!faltaSql(e as { code?: string })) {
      console.warn('Error al guardar pre-salida en Supabase, guardada en local:', e);
    }
  }

  return nueva;
}

/** Modifica un borrador existente de pre-salida (cambiar o quitar materiales, motivo, etc.). */
export async function actualizarPreSalida(id: string, cambios: Partial<PreSalidaInput>): Promise<PreSalida> {
  const ahora = new Date().toISOString();
  const local = leerLocal();
  const index = local.findIndex((x) => x.id === id);
  if (index === -1) throw new Error('No se encontró la pre-salida a editar.');

  const previa = local[index];
  const actualizada: PreSalida = {
    ...previa,
    motivo: cambios.motivo !== undefined ? cambios.motivo.trim() : previa.motivo,
    retorna: cambios.retorna !== undefined ? Boolean(cambios.retorna) : previa.retorna,
    equipo: cambios.equipo !== undefined ? cambios.equipo : previa.equipo,
    tipoMant: cambios.tipoMant !== undefined ? cambios.tipoMant : previa.tipoMant,
    lineas: cambios.lineas !== undefined ? cambios.lineas : previa.lineas,
    updatedAt: ahora,
  };

  local[index] = actualizada;
  guardarLocal(local);

  try {
    const fila: Record<string, unknown> = { updated_at: ahora };
    if (cambios.motivo !== undefined) fila.motivo = cambios.motivo.trim();
    if (cambios.retorna !== undefined) fila.retorna = Boolean(cambios.retorna);
    if (cambios.equipo !== undefined) {
      fila.equipo_id = cambios.equipo?.id || null;
      fila.equipo_nombre = cambios.equipo?.nombre || null;
    }
    if (cambios.tipoMant !== undefined) fila.tipo_mant = cambios.tipoMant;
    if (cambios.lineas !== undefined) fila.lineas = cambios.lineas;

    const { data, error } = await supabase.from(TABLE).update(fila).eq('id', id).select('*').single();
    if (error && !faltaSql(error)) throw error;
    if (data) return normalizarFila(data as Record<string, unknown>);
  } catch (e) {
    if (!faltaSql(e as { code?: string })) {
      console.warn('Error al actualizar pre-salida en Supabase:', e);
    }
  }

  return actualizada;
}

/** Marca una pre-salida como procesada cuando ya se ejecutó la salida formal con su autorizado. */
export async function marcarPreSalidaProcesada(id: string, salidaCodigo: string, autorizadoPor: string): Promise<void> {
  const ahora = new Date().toISOString();
  const local = leerLocal();
  const idx = local.findIndex((x) => x.id === id);
  if (idx !== -1) {
    local[idx] = { ...local[idx], estado: 'procesada', salidaCodigo, autorizadoPor, updatedAt: ahora };
    guardarLocal(local);
  }

  try {
    const { error } = await supabase.from(TABLE).update({
      estado: 'procesada',
      salida_codigo: salidaCodigo,
      autorizado_por: autorizadoPor,
      updated_at: ahora,
    }).eq('id', id);
    if (error && !faltaSql(error)) throw error;
  } catch (e) {
    if (!faltaSql(e as { code?: string })) console.warn('Error al procesar pre-salida en Supabase:', e);
  }
}

/** Descarta / anula una pre-salida cuando el supervisor la rechaza en WhatsApp. */
export async function descartarPreSalida(id: string): Promise<void> {
  const ahora = new Date().toISOString();
  const local = leerLocal();
  const idx = local.findIndex((x) => x.id === id);
  if (idx !== -1) {
    local[idx] = { ...local[idx], estado: 'descartada', updatedAt: ahora };
    guardarLocal(local);
  }

  try {
    const { error } = await supabase.from(TABLE).update({
      estado: 'descartada',
      updated_at: ahora,
    }).eq('id', id);
    if (error && !faltaSql(error)) throw error;
  } catch (e) {
    if (!faltaSql(e as { code?: string })) console.warn('Error al descartar pre-salida en Supabase:', e);
  }
}
