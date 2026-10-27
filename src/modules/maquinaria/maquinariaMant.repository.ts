/* ============================================================
   Golden Touch · Control de Maquinaria · bitácora de horómetro
   Registro cronológico de mantenimientos por equipo. Las HRS
   trabajadas y el consumo (Lts/h) NO se guardan: se calculan en
   la app, replicando las fórmulas del Excel:
     HRS         = horómetro de este registro − el del registro anterior
     Consumo L/h = gasoil de este registro ÷ HRS
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

/** Tipos de mantenimiento / servicio (trazabilidad): catálogo con etiqueta legible.
 *  Cubre todo lo que se le puede cambiar/hacer a un vehículo o maquinaria. */
export const TIPOS_MANTENIMIENTO: ReadonlyArray<{ value: string; label: string; icon: string }> = [
  { value: 'cambio_aceite', label: 'Cambio de aceite', icon: '🛢' },
  { value: 'cambio_filtro', label: 'Cambio de filtro', icon: '🧯' },
  { value: 'cambio_caucho', label: 'Cambio de cauchos / neumáticos', icon: '🛞' },
  { value: 'repuestos', label: 'Repuestos', icon: '🔩' },
  { value: 'cambio_pieza', label: 'Cambio de pieza', icon: '⚙' },
  { value: 'pintura', label: 'Pintura / latonería', icon: '🎨' },
  { value: 'frenos', label: 'Frenos', icon: '🛑' },
  { value: 'bateria', label: 'Batería', icon: '🔋' },
  { value: 'sistema_electrico', label: 'Sistema eléctrico', icon: '💡' },
  { value: 'sistema_hidraulico', label: 'Sistema hidráulico', icon: '💧' },
  { value: 'soldadura', label: 'Soldadura', icon: '🔥' },
  { value: 'engrase', label: 'Engrase / lubricación', icon: '🧴' },
  { value: 'refrigerante', label: 'Refrigerante', icon: '❄' },
  { value: 'servicio', label: 'Servicio / preventivo', icon: '🔧' },
  { value: 'reparacion', label: 'Reparación', icon: '🛠' },
  { value: 'inspeccion', label: 'Inspección', icon: '🔍' },
  { value: 'lectura', label: 'Lectura de horómetro', icon: '⏱' },
  { value: 'otro', label: 'Otro', icon: '•' },
];

/** Etiqueta legible (con ícono) de un tipo de mantenimiento; '—' si no tiene. */
export function etiquetaTipoMant(tipo?: string | null): string {
  const t = TIPOS_MANTENIMIENTO.find((x) => x.value === tipo);
  return t ? `${t.icon} ${t.label}` : '—';
}

export interface MantenimientoMaquinaria {
  id: string;
  equipo_id: string;
  fecha: string;
  /** Tipo de mantenimiento (cambio_aceite, cambio_pieza, …). */
  tipo: string | null;
  /** Pieza cambiada cuando tipo = cambio_pieza (ej. MOTOR). */
  pieza: string | null;
  horometro: number | null;
  /** Kilometraje (lectura del odómetro) registrado en este servicio. */
  kilometraje: number | null;
  /** Km al que se quiere recibir alerta de próximo mantenimiento (lo indica el usuario). */
  alerta_km: number | null;
  aceite_lts: number | null;
  refrigerante_lts: number | null;
  gasoil_lts: number | null;
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

function sanitize(input: MantenimientoInput): Record<string, unknown> {
  const v = (s?: string | null) => (s == null ? null : String(s).trim() || null);
  return {
    equipo_id: input.equipo_id,
    fecha: input.fecha || new Date().toISOString().slice(0, 10),
    tipo: v(input.tipo),
    pieza: v(input.pieza),
    horometro: num(input.horometro),
    kilometraje: num(input.kilometraje),
    alerta_km: num(input.alerta_km),
    aceite_lts: num(input.aceite_lts),
    refrigerante_lts: num(input.refrigerante_lts),
    gasoil_lts: num(input.gasoil_lts),
    trabajo: v(input.trabajo), consumibles: v(input.consumibles),
    mecanico: v(input.mecanico), ubicacion: v(input.ubicacion), observacion: v(input.observacion),
  };
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

/** Consumos acumulados de la bitácora (en un rango opcional de fechas), por equipo. */
export interface ConsumoMant {
  aceite: number;        // Σ aceite_lts
  refrigerante: number;  // Σ refrigerante_lts
  gasoil: number;        // Σ gasoil_lts
  filtros: number;       // Σ filtros_cant
  registros: number;     // cantidad de registros
}

const ceroConsumo = (): ConsumoMant => ({ aceite: 0, refrigerante: 0, gasoil: 0, filtros: 0, registros: 0 });

/**
 * Suma por equipo el aceite, refrigerante, gasoil y filtros registrados en la bitácora,
 * acotado por fechas (inclusive). Una sola consulta; se agrupa en memoria por equipo_id.
 * Lo usa el Resumen del submódulo Servicio de Mantenimiento.
 */
export async function consumosPorEquipo(desde?: string, hasta?: string): Promise<Map<string, ConsumoMant>> {
  let q = supabase.from(TABLE).select('equipo_id, aceite_lts, refrigerante_lts, gasoil_lts, filtros_cant, fecha');
  if (desde) q = q.gte('fecha', desde);
  if (hasta) q = q.lte('fecha', hasta);
  const { data, error } = await q;
  if (error) throw error;
  const out = new Map<string, ConsumoMant>();
  for (const r of (data ?? []) as Array<{ equipo_id: string; aceite_lts: number | null; refrigerante_lts: number | null; gasoil_lts: number | null; filtros_cant: number | null }>) {
    const c = out.get(r.equipo_id) ?? ceroConsumo();
    c.aceite += num(r.aceite_lts) ?? 0;
    c.refrigerante += num(r.refrigerante_lts) ?? 0;
    c.gasoil += num(r.gasoil_lts) ?? 0;
    c.filtros += num(r.filtros_cant) ?? 0;
    c.registros += 1;
    out.set(r.equipo_id, c);
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

/** Estado de alerta por KILOMETRAJE de un equipo. */
export interface AlertaKmEquipo {
  ultimoKm: number | null;   // última lectura de odómetro registrada
  alertaKm: number | null;   // km al que el usuario pidió la alerta
  restante: number | null;   // alertaKm − ultimoKm (negativo = ya pasó)
  alerta: boolean;           // está dentro del 10% (o ya alcanzó/pasó) el km de alerta
}

/**
 * Por equipo: último kilometraje registrado y el último km de alerta indicado en la
 * bitácora. Marca `alerta` cuando el equipo está PRÓXIMO (dentro del 10%) o ya alcanzó
 * el km de alerta. Una sola consulta a toda la bitácora; se agrupa en memoria.
 */
export async function kmAlertaPorEquipo(): Promise<Map<string, AlertaKmEquipo>> {
  const { data, error } = await supabase.from(TABLE)
    .select('equipo_id, kilometraje, alerta_km, fecha, created_at')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out = new Map<string, AlertaKmEquipo>();
  // data viene de más nuevo a más viejo: el primer no-nulo de cada campo es el vigente.
  for (const r of (data ?? []) as { equipo_id: string; kilometraje: number | null; alerta_km: number | null }[]) {
    const cur = out.get(r.equipo_id) ?? { ultimoKm: null, alertaKm: null, restante: null, alerta: false };
    if (cur.ultimoKm == null && r.kilometraje != null) cur.ultimoKm = Number(r.kilometraje);
    if (cur.alertaKm == null && r.alerta_km != null) cur.alertaKm = Number(r.alerta_km);
    out.set(r.equipo_id, cur);
  }
  for (const v of out.values()) {
    if (v.alertaKm != null && v.alertaKm > 0 && v.ultimoKm != null) {
      v.restante = Math.round((v.alertaKm - v.ultimoKm) * 100) / 100;
      v.alerta = v.restante <= v.alertaKm * 0.1; // dentro del 10% o ya alcanzado/pasado
    }
  }
  return out;
}

/* ───────── Vínculo con la Solicitud de Servicio (Pedidos → 🔧 Servicios) ───────── */

/** Estados en los que la solicitud de servicio ya NO está en curso. */
const ESTADOS_SERVICIO_CERRADO = new Set(['finalizada', 'cancelada', 'anulada', 'rechazada', 'desistida_proveedor', 'reasignada']);

/** Una solicitud de servicio (orden tipo='servicio') casada a un equipo. */
export interface SolicitudServicioEquipo {
  id: string;              // id de la orden (servicio)
  codigo: string;          // SS/SV-AAAA-NNNN
  estado: string;
  created_at: string;
  solicitante: string | null;          // unidad solicitante
  solicitante_persona: string | null;  // persona que pidió el servicio
  equipo_id: string;
  equipo_nombre: string | null;
  descripcion: string;     // nombre del ítem (categoría · equipo · tipo)
  abierta: boolean;        // sigue en curso (no finalizada/cancelada…)
}

/**
 * Solicitudes de servicio (órdenes tipo='servicio') agrupadas por equipo. Sirve al
 * submódulo «Servicio de Mantenimiento»: desde Pedidos se pide/cotiza el servicio y
 * aquí, en la tarjeta del equipo, se ve y se le da seguimiento. Una sola consulta;
 * se agrupa en memoria por equipo_id (un renglón por equipo por orden).
 */
export async function solicitudesServicioPorEquipo(): Promise<Map<string, SolicitudServicioEquipo[]>> {
  const { data, error } = await supabase
    .from('ordenes')
    .select('id, codigo, estado, created_at, solicitante, solicitante_persona, items')
    .eq('clase', 'servicio') // MGG: la clase de la orden va en `clase`; la unidad en `solicitante` y la persona en `solicitante_persona`
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
        solicitante: o.solicitante ?? null, solicitante_persona: o.solicitante_persona ?? null,
        equipo_id: eqId, equipo_nombre: it.equipo_nombre ?? null,
        descripcion: it.nombre ?? o.codigo, abierta: !ESTADOS_SERVICIO_CERRADO.has(o.estado),
      };
      const arr = out.get(eqId) ?? [];
      arr.push(fila);
      out.set(eqId, arr);
    }
  }
  return out;
}
