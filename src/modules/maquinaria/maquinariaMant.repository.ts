/* ============================================================
   MGG · Control de Maquinaria · bitácora de horómetro
   Registro cronológico de mantenimientos por equipo. Las HRS
   trabajadas y el consumo (Lts/h) NO se guardan: se calculan en
   la app, replicando las fórmulas del Excel:
     HRS         = horómetro de este registro − el del registro anterior
     Consumo L/h = gasoil de este registro ÷ HRS
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

/** Un repuesto/insumo cambiado en un mantenimiento (caucho, pintura, batería, repuesto…). */
export interface InsumoMant {
  concepto: string;          // CAUCHOS, PINTURA, BATERÍA, CORREA, REPUESTO…
  cantidad: number | null;
  unidad: string | null;     // UND, GAL, LTS, JGO…
}

export interface MantenimientoMaquinaria {
  id: string;
  equipo_id: string;
  fecha: string;
  horometro: number | null;
  /** Lectura del odómetro (km) en este registro. */
  kilometraje: number | null;
  /** Km objetivo de aviso: al acercarse, salta alerta en Servicio de Mantenimiento. */
  alerta_km: number | null;
  tipo: string | null;
  pieza: string | null;
  aceite_lts: number | null;
  refrigerante_lts: number | null;
  gasoil_lts: number | null;
  filtros_cant: number | null;
  filtros_tipo: string | null;
  /** Repuestos/insumos cambiados (cauchos, pintura, batería…) con su cantidad. */
  insumos: InsumoMant[] | null;
  /** Vínculo con la Solicitud de Servicio atendida (clase='servicio'). */
  solicitud_id: string | null;
  solicitud_codigo: string | null;
  /** Cuánto se colocó/aplicó del servicio solicitado. */
  cantidad_colocada: number | null;
  trabajo: string | null;
  consumibles: string | null;
  mecanico: string | null;
  ubicacion: string | null;
  observacion: string | null;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
}

/** Registro con los campos derivados (horas trabajadas + consumo Lts/h). */
export interface MantenimientoCalc extends MantenimientoMaquinaria {
  horas: number | null;       // horómetro − lectura anterior (más antigua)
  consumoLh: number | null;   // gasoil ÷ horas
}

export type MantenimientoInput = Partial<Omit<MantenimientoMaquinaria, 'id' | 'created_at'>> & { equipo_id: string };

const TABLE = 'maquinaria_mantenimientos';

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Lista la bitácora de un equipo (más reciente primero) y calcula HRS y consumo Lts/h.
 * HRS = lectura de este registro − lectura del registro inmediatamente anterior en el
 * tiempo (el de fecha más vieja contiguo). El más antiguo no tiene HRS (no hay base).
 */
export async function listMantenimientos(equipoId: string): Promise<MantenimientoCalc[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .eq('equipo_id', equipoId)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as MantenimientoMaquinaria[];
  // rows está en orden descendente (nuevo→viejo). El "anterior" de la fila i es la fila i+1.
  return rows.map((r, i) => {
    const actual = num(r.horometro);
    const prev = num(rows[i + 1]?.horometro);
    const horas = actual != null && prev != null ? Math.round((actual - prev) * 100) / 100 : null;
    const gasoil = num(r.gasoil_lts);
    const consumoLh = gasoil != null && horas != null && horas > 0 ? Math.round((gasoil / horas) * 10000) / 10000 : null;
    return { ...r, horas, consumoLh };
  });
}

/** Limpia la lista de insumos: concepto obligatorio, cantidad numérica, unidad opcional. */
function sanitizeInsumos(insumos?: InsumoMant[] | null): InsumoMant[] {
  return (insumos ?? [])
    .map((i) => ({
      concepto: String(i.concepto ?? '').trim().toUpperCase(),
      cantidad: num(i.cantidad),
      unidad: i.unidad ? String(i.unidad).trim().toUpperCase() || null : null,
    }))
    .filter((i) => i.concepto !== '');
}

function sanitize(input: MantenimientoInput): Record<string, unknown> {
  const v = (s?: string | null) => (s == null ? null : String(s).trim() || null);
  return {
    equipo_id: input.equipo_id,
    fecha: input.fecha || new Date().toISOString().slice(0, 10),
    horometro: num(input.horometro),
    kilometraje: num(input.kilometraje),
    alerta_km: num(input.alerta_km),
    tipo: v(input.tipo), pieza: v(input.pieza),
    aceite_lts: num(input.aceite_lts),
    refrigerante_lts: num(input.refrigerante_lts),
    gasoil_lts: num(input.gasoil_lts),
    filtros_cant: num(input.filtros_cant),
    filtros_tipo: v(input.filtros_tipo),
    insumos: sanitizeInsumos(input.insumos),
    solicitud_id: input.solicitud_id ?? null,
    solicitud_codigo: v(input.solicitud_codigo),
    cantidad_colocada: num(input.cantidad_colocada),
    trabajo: v(input.trabajo), consumibles: v(input.consumibles),
    mecanico: v(input.mecanico), ubicacion: v(input.ubicacion), observacion: v(input.observacion),
  };
}

/** Suma las cantidades de insumos/repuestos por concepto en una lista de registros. */
export function insumosPorConcepto(rows: MantenimientoMaquinaria[]): Array<{ concepto: string; cantidad: number; unidad: string | null }> {
  const m = new Map<string, { concepto: string; cantidad: number; unidad: string | null }>();
  for (const r of rows) {
    for (const i of (r.insumos ?? [])) {
      const concepto = String(i.concepto ?? '').trim().toUpperCase();
      if (!concepto) continue;
      const cur = m.get(concepto) ?? { concepto, cantidad: 0, unidad: i.unidad ?? null };
      cur.cantidad += num(i.cantidad) ?? 0;
      if (!cur.unidad && i.unidad) cur.unidad = i.unidad;
      m.set(concepto, cur);
    }
  }
  return Array.from(m.values()).sort((a, b) => b.cantidad - a.cantidad);
}

export async function addMantenimiento(input: MantenimientoInput, actor: string, actorName?: string | null): Promise<MantenimientoMaquinaria> {
  const { data, error } = await supabase.from(TABLE)
    .insert({ ...sanitize(input), created_by: actor, actor_name: actorName ?? null })
    .select('*').single();
  if (error) throw error;
  return data as MantenimientoMaquinaria;
}

export async function updateMantenimiento(id: string, input: MantenimientoInput): Promise<void> {
  const { error } = await supabase.from(TABLE).update(sanitize(input)).eq('id', id);
  if (error) throw error;
}

export async function eliminarMantenimiento(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/** Consumos acumulados de la bitácora (en un rango opcional de fechas). */
export interface ConsumoMant {
  aceite: number;        // Σ aceite_lts
  refrigerante: number;  // Σ refrigerante_lts
  gasoil: number;        // Σ gasoil_lts
  filtros: number;       // Σ filtros_cant
  registros: number;     // cantidad de registros de mantenimiento
}

const cero = (): ConsumoMant => ({ aceite: 0, refrigerante: 0, gasoil: 0, filtros: 0, registros: 0 });

/**
 * Suma por equipo el aceite, refrigerante, gasoil y filtros registrados en la bitácora,
 * acotado por fechas (inclusive). Una sola consulta; se agrupa en memoria por equipo_id.
 */
export async function consumosPorEquipo(desde?: string, hasta?: string): Promise<Map<string, ConsumoMant>> {
  let q = supabase.from(TABLE).select('equipo_id, aceite_lts, refrigerante_lts, gasoil_lts, filtros_cant, fecha');
  if (desde) q = q.gte('fecha', desde);
  if (hasta) q = q.lte('fecha', hasta);
  const { data, error } = await q;
  if (error) throw error;
  const out = new Map<string, ConsumoMant>();
  for (const r of (data ?? []) as Array<{ equipo_id: string; aceite_lts: number | null; refrigerante_lts: number | null; gasoil_lts: number | null; filtros_cant: number | null }>) {
    const c = out.get(r.equipo_id) ?? cero();
    c.aceite += num(r.aceite_lts) ?? 0;
    c.refrigerante += num(r.refrigerante_lts) ?? 0;
    c.gasoil += num(r.gasoil_lts) ?? 0;
    c.filtros += num(r.filtros_cant) ?? 0;
    c.registros += 1;
    out.set(r.equipo_id, c);
  }
  return out;
}

/** Suma los consumos de una lista de registros ya cargados (para el detalle filtrado en memoria). */
export function sumarConsumos(rows: MantenimientoMaquinaria[]): ConsumoMant {
  const c = cero();
  for (const r of rows) {
    c.aceite += num(r.aceite_lts) ?? 0;
    c.refrigerante += num(r.refrigerante_lts) ?? 0;
    c.gasoil += num(r.gasoil_lts) ?? 0;
    c.filtros += num(r.filtros_cant) ?? 0;
    c.registros += 1;
  }
  return c;
}

/** Horómetro del ÚLTIMO servicio de cada ítem (aceite/filtro/combustible) por equipo. */
export interface UltimoServicio {
  aceite: number | null;        // horómetro del último registro con aceite_lts > 0
  filtro: number | null;        // horómetro del último registro con filtros_cant > 0
  combustible: number | null;   // horómetro del último registro con gasoil_lts > 0
}

/**
 * Para el control de ESTADO CRÍTICO: por equipo, el horómetro del último registro
 * de bitácora en el que se hizo cada ítem (cambió aceite, cambió filtro, cargó
 * gasoil). Se compara contra el horómetro vigente y el intervalo del equipo para
 * saber si el servicio está vencido. Una sola consulta, agrupada en memoria.
 */
export async function ultimoServicioPorEquipo(): Promise<Map<string, UltimoServicio>> {
  const { data, error } = await supabase.from(TABLE)
    .select('equipo_id, horometro, aceite_lts, filtros_cant, gasoil_lts, fecha, created_at')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out = new Map<string, UltimoServicio>();
  // Las filas vienen de nuevo→viejo: el PRIMER registro de cada ítem con valor > 0 es el último servicio.
  for (const r of (data ?? []) as Array<{ equipo_id: string; horometro: number | null; aceite_lts: number | null; filtros_cant: number | null; gasoil_lts: number | null }>) {
    const horo = num(r.horometro);
    if (horo == null) continue;
    const cur = out.get(r.equipo_id) ?? { aceite: null, filtro: null, combustible: null };
    if (cur.aceite == null && (num(r.aceite_lts) ?? 0) > 0) cur.aceite = horo;
    if (cur.filtro == null && (num(r.filtros_cant) ?? 0) > 0) cur.filtro = horo;
    if (cur.combustible == null && (num(r.gasoil_lts) ?? 0) > 0) cur.combustible = horo;
    out.set(r.equipo_id, cur);
  }
  return out;
}

/** Kilometraje vigente (última lectura) + km de alerta (último indicado) por equipo. */
export interface KmAlertaEquipo {
  km: number | null;        // última lectura de odómetro registrada
  alertaKm: number | null;  // km objetivo de aviso (el último indicado en bitácora)
  fecha: string | null;     // fecha de la última lectura
}

/**
 * Por equipo: la última lectura de kilometraje y el último km de alerta indicado en
 * la bitácora. Sirve para avisar en Servicio de Mantenimiento cuando un equipo está
 * cerca (o ya superó) el kilometraje objetivo. Una sola consulta, agrupada en memoria.
 */
export async function kilometrajeAlertaPorEquipo(): Promise<Map<string, KmAlertaEquipo>> {
  const { data, error } = await supabase.from(TABLE)
    .select('equipo_id, kilometraje, alerta_km, fecha, created_at')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out = new Map<string, KmAlertaEquipo>();
  // Filas de nuevo→viejo: el PRIMER valor no nulo de cada campo es el vigente.
  for (const r of (data ?? []) as Array<{ equipo_id: string; kilometraje: number | null; alerta_km: number | null; fecha: string | null }>) {
    const km = num(r.kilometraje);
    const al = num(r.alerta_km);
    const cur = out.get(r.equipo_id) ?? { km: null, alertaKm: null, fecha: null };
    if (cur.km == null && km != null) { cur.km = km; cur.fecha = r.fecha ?? null; }
    if (cur.alertaKm == null && al != null) cur.alertaKm = al;
    out.set(r.equipo_id, cur);
  }
  return out;
}

/* ============================================================
   Vínculo Solicitud de Servicio (Pedidos) → Control de Mantenimiento
   Un servicio de "mantenimiento de maquinaria" (clase='servicio')
   guarda el equipo en sus ítems. Acá se exponen agrupados por equipo
   para que aparezcan en el módulo de mantenimiento: de donde se pidió
   el servicio → donde se ve el equipo.
   ============================================================ */

/** Estados de un servicio que ya NO está en curso (cerrado: no cuenta como pendiente). */
const ESTADOS_SERVICIO_CERRADO = new Set(['finalizada', 'cancelada', 'anulada', 'rechazada', 'desistida_proveedor', 'reasignada']);

export interface SolicitudServicioEquipo {
  id: string;              // id de la orden (clase servicio)
  codigo: string;          // SV-AAAA-NNNN
  estado: string;
  created_at: string;
  solicitante: string | null;        // unidad solicitante
  solicitante_persona: string | null; // persona que pidió el servicio
  equipo_id: string;
  equipo_nombre: string | null;
  descripcion: string;     // nombre del ítem (categoría · equipo · tipo)
  abierta: boolean;        // sigue en curso (no finalizada/cancelada…)
}

/**
 * Solicitudes de servicio vinculadas a equipos de Control de Maquinaria, agrupadas
 * por equipo_id (más reciente primero). Una sola consulta a `ordenes`; se recorre
 * `items` en memoria tomando un renglón por equipo dentro de cada orden.
 */
export async function solicitudesServicioPorEquipo(): Promise<Map<string, SolicitudServicioEquipo[]>> {
  const { data, error } = await supabase
    .from('ordenes')
    .select('id, codigo, estado, created_at, solicitante, solicitante_persona, items')
    .eq('clase', 'servicio')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out = new Map<string, SolicitudServicioEquipo[]>();
  for (const o of (data ?? []) as Array<{ id: string; codigo: string; estado: string; created_at: string; solicitante: string | null; solicitante_persona: string | null; items: unknown }>) {
    const items = Array.isArray(o.items)
      ? (o.items as Array<{ equipo_id?: string | null; equipo_nombre?: string | null; nombre?: string | null }>)
      : [];
    const vistos = new Set<string>();
    for (const it of items) {
      const eqId = it.equipo_id ?? null;
      if (!eqId || vistos.has(eqId)) continue; // un renglón por equipo por orden
      vistos.add(eqId);
      const fila: SolicitudServicioEquipo = {
        id: o.id, codigo: o.codigo, estado: o.estado, created_at: o.created_at,
        solicitante: o.solicitante, solicitante_persona: o.solicitante_persona ?? null,
        equipo_id: eqId, equipo_nombre: it.equipo_nombre ?? null,
        descripcion: it.nombre ?? o.codigo, abierta: !ESTADOS_SERVICIO_CERRADO.has(o.estado),
      };
      const arr = out.get(eqId) ?? [];
      arr.push(fila);
      out.set(eqId, arr);
    }
  }

  // También los SERVICIOS DIRECTOS (servicios_directos): se casan al mismo equipo.
  // Consulta directa a la tabla (sin importar el repo de Pedidos, para no acoplar módulos).
  const { data: sd } = await supabase
    .from('servicios_directos')
    .select('id, codigo, estado, created_at, solicitante, solicitante_persona, items')
    .order('created_at', { ascending: false });
  for (const s of (sd ?? []) as Array<{ id: string; codigo: string | null; estado: string; created_at: string; solicitante: string | null; solicitante_persona: string | null; items: unknown }>) {
    const items = Array.isArray(s.items)
      ? (s.items as Array<{ equipo_id?: string | null; equipo_nombre?: string | null; descripcion?: string | null }>)
      : [];
    const vistos = new Set<string>();
    for (const it of items) {
      const eqId = it.equipo_id ?? null;
      if (!eqId || vistos.has(eqId)) continue;
      vistos.add(eqId);
      const fila: SolicitudServicioEquipo = {
        id: s.id, codigo: s.codigo ?? '—', estado: s.estado, created_at: s.created_at,
        solicitante: s.solicitante, solicitante_persona: s.solicitante_persona ?? null,
        equipo_id: eqId, equipo_nombre: it.equipo_nombre ?? null,
        descripcion: it.descripcion ?? (s.codigo ?? 'Servicio directo'), abierta: s.estado === 'en_proceso',
      };
      const arr = out.get(eqId) ?? [];
      arr.push(fila);
      out.set(eqId, arr);
    }
  }
  return out;
}

/** Resumen del estado de horómetro de un equipo a partir de su bitácora. */
export interface ResumenHorometro {
  ultimoHorometro: number | null;   // lectura más reciente
  horasUltimo: number | null;       // HRS del último período
  horasDesdeUltimoServicio: number | null; // acumulado desde el último mantenimiento con trabajo
}

export function resumenHorometro(rows: MantenimientoCalc[]): ResumenHorometro {
  const conLectura = rows.filter((r) => r.horometro != null);
  const ultimoHorometro = conLectura[0]?.horometro ?? null;
  const horasUltimo = rows[0]?.horas ?? null;
  return { ultimoHorometro, horasUltimo, horasDesdeUltimoServicio: horasUltimo };
}

/**
 * Para el resumen general: por cada equipo, las horas del último período (la
 * diferencia entre sus dos lecturas más recientes) y su último horómetro. Una
 * sola consulta a toda la bitácora; se agrupa en memoria.
 */
export async function horasUltimoPorEquipo(): Promise<Map<string, { horasUltimo: number | null; ultimoHorometro: number | null }>> {
  const { data, error } = await supabase.from(TABLE)
    .select('equipo_id, horometro, fecha, created_at')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const byEq = new Map<string, number[]>();
  for (const r of (data ?? []) as { equipo_id: string; horometro: number | null }[]) {
    const arr = byEq.get(r.equipo_id) ?? [];
    if (r.horometro != null) arr.push(Number(r.horometro));
    byEq.set(r.equipo_id, arr);
  }
  const out = new Map<string, { horasUltimo: number | null; ultimoHorometro: number | null }>();
  for (const [eq, lect] of byEq) {
    const ultimoHorometro = lect[0] ?? null;
    const horasUltimo = lect.length >= 2 ? Math.round((lect[0] - lect[1]) * 100) / 100 : null;
    out.set(eq, { horasUltimo, ultimoHorometro });
  }
  return out;
}
